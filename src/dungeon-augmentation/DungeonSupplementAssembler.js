import * as THREE from 'three';

export const DUNGEON_SUPPLEMENT_ROOT_NAME = 'DungeonSupplementRoot';
export const DUNGEON_SUPPLEMENT_FRAGMENT_SCHEMA = 'ruindivex-dungeon-supplement-fragment/v1';

const DEFAULT_TILE_SIZE = 2.8;
const DEFAULT_ROOM_HEIGHT = 8.4;
const DEFAULT_WALL_THICKNESS = 0.22;
const DEFAULT_FLOOR_THICKNESS = 0.18;
const DEFAULT_CEILING_THICKNESS = 0.14;
const EPSILON = 0.0001;

const CONNECTOR_FAMILY_ALIASES = Object.freeze({
  'service-gallery': 'serviceGallery',
  service_gallery: 'serviceGallery',
  serviceGallery: 'serviceGallery',
  slope: 'slope',
  ladder: 'ladder',
  lift: 'lift',
  'track-trap': 'trackTrap',
  track_trap: 'trackTrap',
  trackTrap: 'trackTrap',
  'transition-bay': 'transitionBay',
  transition_bay: 'transitionBay',
  transitionBay: 'transitionBay',
});

const FRAGMENT_ARRAY_FIELDS = Object.freeze([
  'rooms',
  'floorTiles',
  'solidZones',
  'aerialBoundaryZones',
  'platforms',
  'encounters',
  'enemySpawnPoints',
  'doors',
  'keycards',
  'chests',
  'mechanisms',
  'ladders',
  'connectorLifts',
  'traps',
  'conveyors',
  'safeInteractables',
  'safeZones',
  'environmentalHazards',
  'localLights',
  'audioEmitters',
  'connectionPlans',
  'verticalConnectors',
  'renderCullGroups',
  'progressionAssignments',
  'progressionAnchors',
  'socketCaps',
]);

export class DungeonSupplementAssemblyError extends Error {
  constructor(message, {
    code = 'DUNGEON_SUPPLEMENT_ASSEMBLY_FAILED',
    diagnostics = [],
    cause = null,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DungeonSupplementAssemblyError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function sanitizeName(value, fallback = 'unnamed') {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function stableId(prefix, ...parts) {
  return [prefix, ...parts]
    .filter((part) => part !== null && part !== undefined && part !== '')
    .map((part) => sanitizeName(part))
    .join('__');
}

function cloneBinding(binding) {
  if (!binding || typeof binding !== 'object') return null;
  return {
    ...binding,
    themeRef: binding.themeRef ? { ...binding.themeRef } : binding.themeRef,
  };
}

function cloneSerializableRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const clone = { ...record };
  for (const key of ['themeBinding', 'sourceThemeBinding', 'destinationThemeBinding']) {
    if (record[key]) clone[key] = cloneBinding(record[key]);
  }
  return clone;
}

function vectorFrom(value, fallbackY = 0) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) {
    return new THREE.Vector3(
      finite(value[0]),
      finite(value[1], fallbackY),
      finite(value[2]),
    );
  }
  if (!value || typeof value !== 'object') return null;
  const y = value.y ?? value.elevation ?? value.baseElevation ?? fallbackY;
  if (!Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.z))) return null;
  return new THREE.Vector3(finite(value.x), finite(y, fallbackY), finite(value.z));
}

function usesParentGrid(record, inherited = false) {
  const coordinateSpace = record?.coordinateSpace
    ?? record?.placement?.coordinateSpace
    ?? record?.sourceContract?.coordinateSpace;
  return coordinateSpace === 'grid'
    || coordinateSpace === 'tile'
    || coordinateSpace === 'tiles'
    || record?.units === 'tiles'
    || record?.gridCoordinates === true
    || inherited;
}

function usesParentPlanCoordinates(record) {
  const coordinateSpace = record?.coordinateSpace
    ?? record?.placement?.coordinateSpace
    ?? record?.sourceContract?.coordinateSpace;
  return coordinateSpace === 'parent-plan' || coordinateSpace === 'parentPlan';
}

function gridVectorToWorld(vector, tileSize) {
  if (!vector) return null;
  return new THREE.Vector3(vector.x * tileSize, vector.y, vector.z * tileSize);
}

function resolveRecordPosition(record, tileSize, {
  fallback = new THREE.Vector3(),
  inheritedGrid = false,
} = {}) {
  const explicitWorld = vectorFrom(
    record?.worldPosition
    ?? record?.worldCenter
    ?? record?.placement?.worldCenter,
  );
  if (explicitWorld) return explicitWorld;

  const placement = record?.placement ?? record;
  const candidate = vectorFrom(
    placement?.center
    ?? placement?.position
    ?? record?.center
    ?? record?.position
    ?? record?.origin,
    finite(record?.baseElevation ?? record?.elevation),
  );
  if (candidate) {
    return usesParentGrid(record, inheritedGrid)
      ? gridVectorToWorld(candidate, tileSize)
      : candidate;
  }

  if (Number.isFinite(Number(record?.gridX)) && Number.isFinite(Number(record?.gridZ))) {
    return new THREE.Vector3(
      finite(record.gridX) * tileSize,
      finite(record.elevation ?? record.y),
      finite(record.gridZ) * tileSize,
    );
  }

  if (Number.isFinite(Number(record?.x)) && Number.isFinite(Number(record?.z))) {
    const raw = new THREE.Vector3(
      finite(record.x),
      finite(record.y ?? record.elevation ?? record.baseElevation),
      finite(record.z),
    );
    // Industrial parent contracts expose scalar x/z in macro-grid units, but
    // their normalized `position`/`placement.center` fields are world meters.
    // Only this scalar compatibility path treats parent-plan coordinates as a
    // grid, preventing an already-normalized overlay from being scaled twice.
    return usesParentGrid(record, inheritedGrid) || usesParentPlanCoordinates(record)
      ? gridVectorToWorld(raw, tileSize)
      : raw;
  }
  return fallback.clone();
}

function resolveRecordSize(record, tileSize, {
  fallbackWidth = tileSize * 5,
  fallbackDepth = tileSize * 5,
  fallbackHeight = DEFAULT_ROOM_HEIGHT,
  inheritedGrid = false,
} = {}) {
  const source = record?.placement?.size
    ?? record?.size
    ?? record?.dimensions
    ?? record?.occupiedVolume?.size
    ?? record?.occupiedVolumes?.[0]?.size
    ?? {};
  const explicitMeters = {
    x: record?.widthMeters ?? source.widthMeters,
    y: record?.heightMeters ?? source.heightMeters,
    z: record?.depthMeters ?? source.depthMeters,
  };
  const tileValues = {
    x: record?.widthTiles ?? source.widthTiles,
    y: record?.heightTiles ?? source.heightTiles,
    z: record?.depthTiles ?? source.depthTiles,
  };
  const raw = {
    x: source.x ?? source.width ?? record?.width,
    y: source.y ?? source.height ?? record?.height,
    z: source.z ?? source.depth ?? record?.depth,
  };
  const grid = usesParentGrid(record, inheritedGrid);
  const resolveHorizontal = (meters, tiles, value, fallback) => {
    if (Number.isFinite(Number(meters)) && Number(meters) > 0) return Number(meters);
    if (Number.isFinite(Number(tiles)) && Number(tiles) > 0) return Number(tiles) * tileSize;
    if (Number.isFinite(Number(value)) && Number(value) > 0) {
      return Number(value) * (grid ? tileSize : 1);
    }
    return fallback;
  };
  const resolveVertical = (meters, tiles, value, fallback) => {
    if (Number.isFinite(Number(meters)) && Number(meters) > 0) return Number(meters);
    if (Number.isFinite(Number(tiles)) && Number(tiles) > 0) return Number(tiles) * tileSize;
    if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
    return fallback;
  };
  return new THREE.Vector3(
    resolveHorizontal(explicitMeters.x, tileValues.x, raw.x, fallbackWidth),
    resolveVertical(explicitMeters.y, tileValues.y, raw.y, fallbackHeight),
    resolveHorizontal(explicitMeters.z, tileValues.z, raw.z, fallbackDepth),
  );
}

function resolveQuarterTurn(record) {
  const placement = record?.placement ?? record;
  if (Number.isFinite(Number(placement.rotationY))) return finite(placement.rotationY);
  if (Number.isFinite(Number(placement.yaw))) return finite(placement.yaw);
  // The renderer-free planner defines positive quarter turns clockwise in X/Z
  // (local +Z -> world +X). Three.js positive Y rotation is counter-clockwise.
  return -finite(
    placement.rotationQuarterTurns
    ?? placement.quarterTurns
    ?? record?.rotationQuarterTurns,
  ) * Math.PI * 0.5;
}

function localToWorld(local, center, yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return new THREE.Vector3(
    center.x + local.x * cos - local.z * sin,
    center.y + local.y,
    center.z + local.x * sin + local.z * cos,
  );
}

function worldToLocal(world, center, yaw) {
  const x = world.x - center.x;
  const z = world.z - center.z;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return new THREE.Vector3(
    x * cos + z * sin,
    world.y - center.y,
    -x * sin + z * cos,
  );
}

function rotateDirection(direction, yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return new THREE.Vector3(
    direction.x * cos - direction.z * sin,
    direction.y,
    direction.x * sin + direction.z * cos,
  );
}

function directionFrom(value) {
  if (!value || typeof value !== 'object') return null;
  const direction = vectorFrom(value, 0);
  if (!direction || direction.lengthSq() <= EPSILON) return null;
  direction.y = 0;
  if (direction.lengthSq() <= EPSILON) return null;
  return direction.normalize();
}

function recordThemeBinding(record, operationById, bindingByRegion) {
  if (record?.themeBinding) return cloneBinding(record.themeBinding);
  const operation = operationById.get(record?.operationId);
  if (operation?.themeBinding) return cloneBinding(operation.themeBinding);
  const regionId = record?.parentRegionId ?? operation?.parentRegionId;
  return cloneBinding(bindingByRegion.get(regionId) ?? null);
}

function sessionLookupKeys(binding, regionId) {
  return [...new Set([
    regionId,
    binding?.parentRegionId,
  ].filter(Boolean))];
}

function themeSessionMatchesBinding(session, binding, regionId) {
  if (!session) return false;
  const actual = session.themeBinding;
  const expectedRegionId = String(regionId ?? binding?.parentRegionId ?? '');
  if (!binding) {
    return !expectedRegionId
      || String(actual?.parentRegionId ?? '') === expectedRegionId;
  }
  if (!actual) return false;
  return [
    'schema',
    'parentMapId',
    'parentMapRevision',
    'parentRegionId',
    'presentationVariantId',
    'localLightingProfileId',
    'soundscapeProfileId',
  ].every((key) => String(actual[key] ?? '') === String(binding[key] ?? ''))
    && ['id', 'revision', 'contentHash'].every((key) => (
      String(actual.themeRef?.[key] ?? '') === String(binding.themeRef?.[key] ?? '')
    ))
    && (!expectedRegionId || String(actual.parentRegionId ?? '') === expectedRegionId);
}

function resolveThemeSession(source, binding, regionId, fallback = null) {
  const accept = (candidate) => (
    themeSessionMatchesBinding(candidate, binding, regionId) ? candidate : null
  );
  if (typeof source === 'function') {
    return accept(source(binding, regionId)) ?? accept(fallback);
  }
  const keys = sessionLookupKeys(binding, regionId);
  if (source instanceof Map) {
    for (const key of keys) {
      if (source.has(key)) {
        const candidate = accept(source.get(key));
        if (candidate) return candidate;
      }
    }
  } else if (Array.isArray(source)) {
    for (const session of source) {
      const candidate = accept(session);
      if (candidate) return candidate;
    }
  } else if (source && typeof source === 'object') {
    for (const key of keys) {
      const candidate = accept(source[key]);
      if (candidate) return candidate;
    }
  }
  return accept(fallback);
}

function unwrapFactoryProduct(product) {
  if (product && typeof product === 'object'
    && Object.hasOwn(product, 'value')
    && (product.ownership === 'owned' || product.ownership === 'borrowed')) {
    return { value: product.value, ownership: product.ownership };
  }
  return { value: product, ownership: 'owned' };
}

function requireSynchronousProduct(product, context) {
  if (product && typeof product.then === 'function') {
    throw new DungeonSupplementAssemblyError(
      `${context} returned a Promise. Dungeon supplement assembly is synchronous.`,
      { code: 'ASYNC_THEME_FACTORY_UNSUPPORTED' },
    );
  }
  return product;
}

function createResourceLedger() {
  const owned = new Set();
  const borrowed = new Set();
  const factoryProducts = [];
  const sessionManagedResources = new Map();
  let disposed = false;

  const markBorrowed = (resource, session = null) => {
    if (!resource) return resource;
    const registeredOwnership = session?.resources?.ownershipOf?.(resource)
      ?? (session?.resources?.isBorrowed?.(resource) ? 'borrowed' : null)
      ?? (session?.resources?.isOwned?.(resource) ? 'owned' : null);
    if (Array.isArray(resource)) {
      if (registeredOwnership === 'owned') {
        owned.add(resource);
        sessionManagedResources.set(resource, session);
      } else {
        borrowed.add(resource);
      }
      resource.forEach((entry) => markBorrowed(entry, session));
      return resource;
    }
    if (registeredOwnership === 'owned') {
      owned.add(resource);
      sessionManagedResources.set(resource, session);
    } else {
      borrowed.add(resource);
    }
    if (!registeredOwnership) {
      session?.resources?.borrow?.(resource);
    }
    if (resource?.isMaterial) {
      for (const value of Object.values(resource)) {
        if (value?.isTexture) markBorrowed(value, session);
      }
    }
    return resource;
  };
  const markOwned = (resource, session = null) => {
    if (!resource) return resource;
    owned.add(resource);
    const registeredOwnership = session?.resources?.ownershipOf?.(resource)
      ?? (session?.resources?.isBorrowed?.(resource) ? 'borrowed' : null)
      ?? (session?.resources?.isOwned?.(resource) ? 'owned' : null);
    if (!registeredOwnership) {
      session?.resources?.own?.(resource);
    }
    if (session && registeredOwnership !== 'borrowed') {
      sessionManagedResources.set(resource, session);
    }
    return resource;
  };
  const markProduct = (product, session, context) => {
    const normalized = unwrapFactoryProduct(requireSynchronousProduct(product, context));
    if (normalized.value) {
      const registeredOwnership = session?.resources?.ownershipOf?.(normalized.value)
        ?? (session?.resources?.isBorrowed?.(normalized.value) ? 'borrowed' : null)
        ?? (session?.resources?.isOwned?.(normalized.value) ? 'owned' : null);
      const ownership = registeredOwnership ?? normalized.ownership;
      factoryProducts.push({ ...normalized, ownership, session });
      if (ownership === 'borrowed') markBorrowed(normalized.value, session);
      else markOwned(normalized.value, session);
    }
    return normalized.value;
  };

  const disposeMaterial = (material, session, forceOwned = false) => {
    if (!material) return;
    if (Array.isArray(material)) {
      material.forEach((entry) => disposeMaterial(entry, session, forceOwned));
      return;
    }
    const isBorrowed = borrowed.has(material) || session?.resources?.isBorrowed?.(material);
    const isOwned = forceOwned || owned.has(material) || session?.resources?.isOwned?.(material);
    if (!isBorrowed && isOwned) material.dispose?.();
  };

  const disposeObject = (object, session, forceOwned = false) => {
    if (!object?.traverse) return;
    object.traverse((child) => {
      const geometryBorrowed = borrowed.has(child.geometry)
        || session?.resources?.isBorrowed?.(child.geometry);
      const geometryOwned = forceOwned || owned.has(child.geometry)
        || session?.resources?.isOwned?.(child.geometry);
      if (child.geometry && !geometryBorrowed && geometryOwned) child.geometry.dispose?.();
      disposeMaterial(child.material, session, forceOwned);
    });
  };

  const disposeResource = (resource, session, forceOwned = false, seen = new Set()) => {
    if (!resource || (typeof resource !== 'object' && typeof resource !== 'function')) return;
    if (seen.has(resource)) return;
    seen.add(resource);
    if (Array.isArray(resource)) {
      resource.forEach((entry) => disposeResource(entry, session, forceOwned, seen));
      return;
    }
    if (resource.isBufferGeometry) {
      const isBorrowed = borrowed.has(resource) || session?.resources?.isBorrowed?.(resource);
      const isOwned = forceOwned || owned.has(resource) || session?.resources?.isOwned?.(resource);
      if (!isBorrowed && isOwned) resource.dispose?.();
      return;
    }
    if (resource.isMaterial) {
      disposeMaterial(resource, session, forceOwned);
      return;
    }
    if (resource.traverse) {
      disposeObject(resource, session, forceOwned);
      return;
    }
    for (const key of ['object', 'root', 'group', 'fragment', 'facade']) {
      disposeResource(resource[key], session, forceOwned, seen);
    }
    for (const field of FRAGMENT_ARRAY_FIELDS) {
      disposeResource(resource[field], session, forceOwned, seen);
    }
  };

  return {
    owned,
    borrowed,
    markBorrowed,
    markOwned,
    markProduct,
    snapshot(sessions = []) {
      return {
        ownedCount: owned.size,
        borrowedCount: borrowed.size,
        themeSessions: sessions.map((session) => session?.resources?.snapshot?.() ?? null),
      };
    },
    dispose(root) {
      if (disposed) return;
      disposed = true;
      root?.removeFromParent?.();
      for (const resource of owned) {
        if (resource?.isBufferGeometry && !sessionManagedResources.has(resource)) {
          resource.dispose?.();
        }
      }
      for (const [resource, session] of sessionManagedResources) {
        if (typeof session?.resources?.disposeOwnedValue === 'function') {
          session.resources.disposeOwnedValue(resource, {
            fallbackDispose: (value) => disposeResource(value, session, true),
          });
        } else {
          disposeResource(resource, session, true);
        }
      }
      for (const product of factoryProducts) {
        if (product.ownership === 'owned' && !sessionManagedResources.has(product.value)) {
          disposeResource(product.value, product.session, true);
        }
      }
    },
    get disposed() {
      return disposed;
    },
  };
}

function assertThemeSession(session, context) {
  if (!session) {
    throw new DungeonSupplementAssemblyError(
      `No parent theme session resolved for ${context}.`,
      { code: 'MISSING_PARENT_THEME_SESSION' },
    );
  }
  if (typeof session.materials?.resolve !== 'function') {
    throw new DungeonSupplementAssemblyError(
      `Parent theme session ${session.id ?? '(unnamed)'} cannot resolve semantic materials for ${context}.`,
      { code: 'INVALID_PARENT_THEME_SESSION' },
    );
  }
  return session;
}

function requireCapabilities(session, required = {}, context = 'supplement element') {
  const missing = [];
  const materialRoles = required.materialRoles ?? required.materials ?? [];
  const assetRoles = required.assetRoles ?? required.assets ?? [];
  const connectorFamilies = required.connectorFamilies ?? required.connectors ?? [];
  const transitionTypes = required.transitionTypes ?? required.transitions ?? [];
  for (const role of materialRoles) {
    if (session.materials?.has && !session.materials.has(role)) missing.push(`material:${role}`);
  }
  for (const role of assetRoles) {
    if (!session.assets?.has?.(role)) missing.push(`asset:${role}`);
  }
  for (const family of connectorFamilies) {
    const normalized = CONNECTOR_FAMILY_ALIASES[family] ?? family;
    if (!session.connectors?.has?.(normalized)) missing.push(`connector:${normalized}`);
  }
  for (const type of transitionTypes) {
    if (!session.transitions?.has?.(type)) missing.push(`transition:${type}`);
  }
  if (missing.length > 0) {
    throw new DungeonSupplementAssemblyError(
      `Parent theme session ${session.id ?? '(unnamed)'} is missing required capabilities for ${context}: ${missing.join(', ')}.`,
      {
        code: 'MISSING_THEME_CAPABILITY',
        diagnostics: missing.map((capability) => ({ severity: 'error', capability, context })),
      },
    );
  }
}

function resolveMaterial(session, role, variant, ledger, context) {
  if (session.materials?.has && !session.materials.has(role)) {
    throw new DungeonSupplementAssemblyError(
      `Parent theme session ${session.id ?? '(unnamed)'} does not provide material role "${role}" for ${context}.`,
      { code: 'MISSING_THEME_MATERIAL' },
    );
  }
  let material;
  try {
    material = session.materials.resolve(role, variant);
  } catch (cause) {
    throw new DungeonSupplementAssemblyError(
      `Failed to resolve parent material role "${role}" for ${context}.`,
      { code: 'THEME_MATERIAL_RESOLUTION_FAILED', cause },
    );
  }
  if (!material || (!material.isMaterial && !Array.isArray(material))) {
    throw new DungeonSupplementAssemblyError(
      `Parent material role "${role}" did not resolve to a Three.js material for ${context}.`,
      { code: 'INVALID_THEME_MATERIAL' },
    );
  }
  ledger.markBorrowed(material, session);
  return material;
}

function invokeAsset(session, role, specification, ledger, context, { optional = false } = {}) {
  if (!session.assets?.has?.(role)) {
    if (optional) return null;
    throw new DungeonSupplementAssemblyError(
      `Parent theme session ${session.id ?? '(unnamed)'} does not provide asset role "${role}" for ${context}.`,
      { code: 'MISSING_THEME_ASSET' },
    );
  }
  try {
    return ledger.markProduct(
      session.assets.create(role, specification),
      session,
      `Theme asset factory "${role}" for ${context}`,
    );
  } catch (cause) {
    if (cause instanceof DungeonSupplementAssemblyError) throw cause;
    throw new DungeonSupplementAssemblyError(
      `Failed to create parent asset role "${role}" for ${context}.`,
      { code: 'THEME_ASSET_CREATION_FAILED', cause },
    );
  }
}

function invokeConnectorSkin(session, family, contract, ledger, context) {
  const normalizedFamily = CONNECTOR_FAMILY_ALIASES[family] ?? family;
  if (!session.connectors?.has?.(normalizedFamily)) {
    throw new DungeonSupplementAssemblyError(
      `Parent theme session ${session.id ?? '(unnamed)'} does not provide connector family "${normalizedFamily}" for ${context}.`,
      { code: 'MISSING_THEME_CONNECTOR' },
    );
  }
  try {
    return ledger.markProduct(
      session.connectors.createSkin(normalizedFamily, contract),
      session,
      `Theme connector factory "${normalizedFamily}" for ${context}`,
    );
  } catch (cause) {
    if (cause instanceof DungeonSupplementAssemblyError) throw cause;
    throw new DungeonSupplementAssemblyError(
      `Failed to create parent connector family "${normalizedFamily}" for ${context}.`,
      { code: 'THEME_CONNECTOR_CREATION_FAILED', cause },
    );
  }
}

function invokeEnvironment(session, capability, specification, ledger, context) {
  if (!session.environment?.has?.(capability)) return null;
  try {
    const factory = capability === 'localLights'
      ? session.environment.createLocalLights
      : capability === 'audioEmitters'
        ? session.environment.createAudioEmitters
        : null;
    const product = factory
      ? factory.call(session.environment, specification)
      : session.environment.create?.(capability, specification);
    return ledger.markProduct(
      product,
      session,
      `Theme environment factory "${capability}" for ${context}`,
    );
  } catch (cause) {
    if (cause instanceof DungeonSupplementAssemblyError) throw cause;
    throw new DungeonSupplementAssemblyError(
      `Failed to create parent environment capability "${capability}" for ${context}.`,
      { code: 'THEME_ENVIRONMENT_CREATION_FAILED', cause },
    );
  }
}

function invokeTransition(session, type, contract, ledger, context) {
  if (!session.transitions?.has?.(type)) {
    throw new DungeonSupplementAssemblyError(
      `Parent theme session ${session.id ?? '(unnamed)'} does not provide transition type "${type}" for ${context}.`,
      { code: 'MISSING_THEME_TRANSITION' },
    );
  }
  try {
    return ledger.markProduct(
      session.transitions.create(type, contract),
      session,
      `Theme transition factory "${type}" for ${context}`,
    );
  } catch (cause) {
    if (cause instanceof DungeonSupplementAssemblyError) throw cause;
    throw new DungeonSupplementAssemblyError(
      `Failed to create parent transition type "${type}" for ${context}.`,
      { code: 'THEME_TRANSITION_CREATION_FAILED', cause },
    );
  }
}

function addFactoryProductToGroup(product, parent, fragment) {
  if (!product) return;
  if (Array.isArray(product)) {
    product.forEach((entry) => addFactoryProductToGroup(entry, parent, fragment));
    return;
  }
  if (product.isObject3D) {
    parent.add(product);
    return;
  }
  const object = product.object ?? product.root ?? product.group;
  if (object?.isObject3D) parent.add(object);
  const facade = product.fragment ?? product.facade ?? product;
  for (const field of FRAGMENT_ARRAY_FIELDS) {
    if (Array.isArray(facade[field])) fragment[field].push(...facade[field]);
  }
}

function appendEnvironmentProduct(fragment, capability, product) {
  if (!product) return;
  const destination = capability === 'localLights'
    ? fragment.localLights
    : fragment.audioEmitters;
  if (Array.isArray(product)) {
    destination.push(...product);
    return;
  }
  const records = capability === 'localLights'
    ? product.localLights ?? product.lights
    : product.audioEmitters ?? product.emitters;
  // Facade-shaped products are merged by addFactoryProductToGroup below.
  // Record only raw products here so descriptor arrays are not duplicated.
  if (!Array.isArray(records)) destination.push(product);
}

function makeGeometry(ledger, ...args) {
  return ledger.markOwned(new THREE.BoxGeometry(...args));
}

function makeMesh({
  parent,
  geometry,
  material,
  name,
  position,
  rotationY = 0,
  userData = {},
  castShadow = true,
  receiveShadow = true,
}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = sanitizeName(name);
  if (position) mesh.position.copy(position);
  mesh.rotation.y = rotationY;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  Object.assign(mesh.userData, userData);
  parent.add(mesh);
  return mesh;
}

function makeZone({
  id,
  label,
  obstacleKind,
  position,
  halfWidth,
  halfDepth,
  verticalHalfHeight,
  rotationY = 0,
  metadata = {},
}) {
  return {
    id: sanitizeName(id),
    label,
    obstacleKind,
    position: position.clone(),
    halfWidth,
    halfDepth,
    verticalHalfHeight,
    rotationY,
    allowFlyOver: false,
    dungeonSupplement: true,
    ...metadata,
  };
}

function addCollisionZone(fragment, zone, { aerial = true } = {}) {
  fragment.solidZones.push(zone);
  if (aerial) fragment.aerialBoundaryZones.push({ ...zone, position: zone.position.clone() });
}

function stableUnique(records, identity = (record) => record?.id) {
  const result = [];
  const seen = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const key = identity(record) ?? record;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result.sort((left, right) => String(identity(left) ?? '').localeCompare(String(identity(right) ?? '')));
}

function collectPlanElements(overlayPlan) {
  const operations = asArray(overlayPlan?.operations);
  const nested = (keys) => operations.flatMap((operation) => keys.flatMap((key) => (
    asArray(operation?.[key]).map((record) => ({
      ...record,
      operationId: record?.operationId ?? operation.id,
      parentRegionId: record?.parentRegionId ?? operation.parentRegionId,
      themeBinding: record?.themeBinding ?? operation.themeBinding,
    }))
  )));
  const nodes = stableUnique([
    ...asArray(overlayPlan?.nodes),
    ...asArray(overlayPlan?.rooms),
    ...asArray(overlayPlan?.modules),
    ...nested(['nodes', 'rooms', 'modules', 'chain']),
  ], (record) => record.id);
  const segments = stableUnique([
    ...asArray(overlayPlan?.segments),
    ...asArray(overlayPlan?.corridors),
    ...nested(['segments', 'corridors', 'physicalSegments']),
  ], (record) => record.id);
  const transitionBays = stableUnique([
    ...asArray(overlayPlan?.transitionBays),
    ...asArray(overlayPlan?.transitions),
    ...nested(['transitionBays', 'transitions']),
  ], (record) => record.id);
  const caps = stableUnique([
    ...asArray(overlayPlan?.caps),
    ...nested(['caps']),
  ], (record) => record.id ?? `${record.nodeId}:${record.socketId}`);
  return { operations, nodes, segments, transitionBays, caps };
}

function createFragment(overlayPlan, root, tileSize, ledger) {
  const fragment = {
    schema: DUNGEON_SUPPLEMENT_FRAGMENT_SCHEMA,
    overlaySchema: overlayPlan?.schema ?? null,
    overlayRevision: overlayPlan?.revision ?? null,
    profileId: overlayPlan?.profileId ?? null,
    augmentationSeed: overlayPlan?.augmentationSeed ?? null,
    basePlanHash: overlayPlan?.basePlanHash ?? null,
    augmentationPlanHash: overlayPlan?.augmentationPlanHash ?? null,
    effectivePlanHash: overlayPlan?.effectivePlanHash ?? null,
    root,
    group: root,
    supplementRoot: root,
    tileSize,
    tiles: new Map(),
    minimap: { rooms: [], hallways: [], connections: [], bounds: null },
    diagnostics: { accepted: true, errors: [], warnings: [], assembled: {} },
    resources: ledger,
    dispose: () => ledger.dispose(root),
  };
  for (const field of FRAGMENT_ARRAY_FIELDS) fragment[field] = [];
  return fragment;
}

function nodeSocketById(node, socketId) {
  return asArray(node?.sockets).find((socket) => socket.id === socketId) ?? null;
}

function resolveSocketPosition(node, socket, tileSize) {
  const center = resolveRecordPosition(node, tileSize);
  const yaw = resolveQuarterTurn(node);
  if (!socket) return center;
  const explicitWorld = vectorFrom(socket.worldPosition ?? socket.worldCenter);
  if (explicitWorld) return explicitWorld;
  const normalizedWorld = vectorFrom(socket.position);
  if (normalizedWorld && socket.space !== 'local' && socket.coordinateSpace !== 'local') {
    return usesParentGrid(socket) ? gridVectorToWorld(normalizedWorld, tileSize) : normalizedWorld;
  }
  const localSource = socket.localPosition
    ?? (Number.isFinite(Number(socket.localX)) && Number.isFinite(Number(socket.localZ))
      ? { x: socket.localX, y: socket.localY ?? socket.elevation ?? 0, z: socket.localZ }
      : null);
  if (localSource) {
    let local = vectorFrom(localSource);
    if (usesParentGrid(socket)) local = gridVectorToWorld(local, tileSize);
    return localToWorld(local, center, yaw);
  }
  const raw = vectorFrom(
    Number.isFinite(Number(socket.x)) && Number.isFinite(Number(socket.z)) ? socket : null,
    center.y,
  );
  if (!raw) return center;
  const socketIsLocal = socket.space === 'local' || socket.coordinateSpace === 'local';
  if (socketIsLocal) return localToWorld(raw, center, yaw);
  const grid = usesParentGrid(socket, usesParentGrid(node))
    || (usesParentPlanCoordinates(socket) && !socket.position);
  return grid ? gridVectorToWorld(raw, tileSize) : raw;
}

function resolveSocketFacing(node, socket) {
  const yaw = resolveQuarterTurn(node);
  const explicit = directionFrom(
    socket?.worldFacing
    ?? socket?.facing
    ?? (Number.isFinite(Number(socket?.facingX)) || Number.isFinite(Number(socket?.facingZ))
      ? { x: socket.facingX, y: 0, z: socket.facingZ }
      : null),
  );
  if (!explicit) return null;
  const local = socket?.facingSpace === 'local'
    || socket?.space === 'local'
    || socket?.coordinateSpace === 'local';
  return local ? rotateDirection(explicit, yaw) : explicit;
}

function resolveSegmentPath(segment, nodeById, tileSize) {
  const pathSource = segment.path
    ?? segment.fullPath
    ?? segment.points
    ?? segment.centerline
    ?? segment.sourceContract?.fullPath;
  const inheritedGrid = usesParentGrid(segment)
    || (!segment.path && !segment.points && !segment.centerline
      && (segment.fullPath || segment.sourceContract?.fullPath)
      && usesParentPlanCoordinates(segment));
  const points = asArray(pathSource)
    .map((point) => {
      const raw = vectorFrom(point, finite(point?.elevation));
      if (!raw) return null;
      return usesParentGrid(point, inheritedGrid) ? gridVectorToWorld(raw, tileSize) : raw;
    })
    .filter(Boolean);
  if (points.length >= 2) return points;

  const endpoint = (reference, fallbackSocket) => {
    if (reference?.position || reference?.worldPosition
      || Number.isFinite(Number(reference?.x))) {
      const raw = resolveRecordPosition(reference, tileSize, { inheritedGrid });
      if (raw) return raw;
    }
    const node = nodeById.get(reference?.nodeId ?? fallbackSocket?.nodeId);
    const socketId = reference?.socketId ?? fallbackSocket?.socketId ?? fallbackSocket?.id;
    return resolveSocketPosition(node, nodeSocketById(node, socketId) ?? fallbackSocket, tileSize);
  };
  const from = endpoint(segment.from, segment.fromSocket);
  const to = endpoint(segment.to, segment.toSocket);
  return from && to ? [from, to] : [];
}

function getConnectedSocketIds(segments) {
  const connected = new Set();
  for (const segment of segments) {
    for (const endpoint of [segment.from, segment.to]) {
      if (endpoint?.nodeId && endpoint?.socketId) connected.add(`${endpoint.nodeId}:${endpoint.socketId}`);
    }
    for (const socket of [segment.fromSocket, segment.toSocket]) {
      if (socket?.nodeId && socket?.id) connected.add(`${socket.nodeId}:${socket.id}`);
    }
  }
  return connected;
}

function normalizeRoomSocket(node, socket, room, tileSize, connectedSocketIds) {
  const world = resolveSocketPosition(node, socket, tileSize);
  const local = worldToLocal(world, room.center, room.yaw);
  const worldFacing = resolveSocketFacing(node, socket);
  const localFacing = worldFacing ? rotateDirection(worldFacing, -room.yaw) : null;
  let side = socket.side;
  if (!side && localFacing) {
    if (Math.abs(localFacing.x) > Math.abs(localFacing.z)) side = localFacing.x >= 0 ? 'east' : 'west';
    else side = localFacing.z >= 0 ? 'south' : 'north';
  }
  if (!side) {
    const xDistance = Math.abs(Math.abs(local.x) - room.size.x * 0.5);
    const zDistance = Math.abs(Math.abs(local.z) - room.size.z * 0.5);
    side = xDistance <= zDistance ? (local.x >= 0 ? 'east' : 'west') : (local.z >= 0 ? 'south' : 'north');
  }
  const state = socket.state ?? socket.status;
  const explicitlyConnected = state === 'connected'
    || state === 'paired'
    || state === 'used'
    || state === 'open'
    || Boolean(socket.connectedTo ?? socket.connectionId);
  const referenced = connectedSocketIds.has(`${node.id}:${socket.id}`);
  const explicitlyCapped = state === 'capped'
    || state === 'unused'
    || state === 'closed'
    || socket.capped === true;
  const capped = explicitlyCapped || (!explicitlyConnected && !referenced);
  return {
    id: socket.id ?? stableId(node.id, 'socket', side, local.x, local.z),
    source: socket,
    side,
    along: side === 'north' || side === 'south' ? local.x : local.z,
    local,
    world,
    width: positive(socket.widthMeters ?? socket.width, tileSize * 3),
    height: positive(socket.heightMeters ?? socket.height, Math.min(4.2, room.size.y - 0.4)),
    capped,
  };
}

function wallIntervals(length, sockets) {
  const half = length * 0.5;
  const intervals = sockets
    .map((socket) => ({
      start: Math.max(-half, socket.along - socket.width * 0.5),
      end: Math.min(half, socket.along + socket.width * 0.5),
      height: socket.height,
      sockets: [socket],
    }))
    .filter((interval) => interval.end - interval.start > EPSILON)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + EPSILON) {
      previous.end = Math.max(previous.end, interval.end);
      previous.height = Math.max(previous.height, interval.height);
      previous.sockets.push(...interval.sockets);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function sideConfiguration(side, room) {
  if (side === 'north') return { length: room.size.x, normalOffset: -room.size.z * 0.5, localYaw: 0 };
  if (side === 'south') return { length: room.size.x, normalOffset: room.size.z * 0.5, localYaw: 0 };
  if (side === 'west') return { length: room.size.z, normalOffset: -room.size.x * 0.5, localYaw: Math.PI * 0.5 };
  return { length: room.size.z, normalOffset: room.size.x * 0.5, localYaw: Math.PI * 0.5 };
}

function sideLocalPosition(side, along, verticalCenter, normalOffset) {
  if (side === 'north' || side === 'south') return new THREE.Vector3(along, verticalCenter, normalOffset);
  return new THREE.Vector3(normalOffset, verticalCenter, along);
}

function addWallPanel({
  roomGroup,
  fragment,
  ledger,
  material,
  room,
  side,
  panelIndex,
  along,
  width,
  bottom,
  height,
  normalOffset,
  localYaw,
  kind = 'boundaryWall',
}) {
  if (width <= EPSILON || height <= EPSILON) return null;
  const localPosition = sideLocalPosition(side, along, bottom + height * 0.5, normalOffset);
  const mesh = makeMesh({
    parent: roomGroup,
    geometry: makeGeometry(ledger, width, height, room.wallThickness),
    material,
    name: stableId('supplementWall', room.id, side, panelIndex),
    position: localPosition,
    rotationY: localYaw,
    userData: {
      dungeonSupplement: true,
      supplementNodeId: room.id,
      cameraOcclusionOwner: true,
      cameraOcclusionSurface: true,
      cameraOcclusionWall: true,
    },
  });
  const worldPosition = localToWorld(localPosition, room.center, room.yaw);
  const zone = makeZone({
    id: stableId('supplementWallZone', room.id, side, panelIndex),
    label: 'Dungeon supplement boundary wall',
    obstacleKind: kind,
    position: worldPosition,
    halfWidth: width * 0.5,
    halfDepth: room.wallThickness * 0.5,
    verticalHalfHeight: height * 0.5,
    rotationY: room.yaw + localYaw,
    metadata: { roomId: room.id, supplementNodeId: room.id },
  });
  addCollisionZone(fragment, zone);
  return mesh;
}

function addRoomWalls({ roomGroup, fragment, room, sockets, materials, ledger, session, variant }) {
  const socketsBySide = new Map(['north', 'south', 'east', 'west'].map((side) => [side, []]));
  for (const socket of sockets) socketsBySide.get(socket.side)?.push(socket);

  for (const side of ['north', 'south', 'east', 'west']) {
    const configuration = sideConfiguration(side, room);
    const intervals = wallIntervals(configuration.length, socketsBySide.get(side));
    const half = configuration.length * 0.5;
    let cursor = -half;
    let panelIndex = 0;
    for (const interval of intervals) {
      if (interval.start > cursor + EPSILON) {
        addWallPanel({
          roomGroup,
          fragment,
          ledger,
          material: materials.wall,
          room,
          side,
          panelIndex: panelIndex++,
          along: (cursor + interval.start) * 0.5,
          width: interval.start - cursor,
          bottom: 0,
          height: room.size.y,
          normalOffset: configuration.normalOffset,
          localYaw: configuration.localYaw,
        });
      }
      const headerHeight = Math.max(0, room.size.y - interval.height);
      if (headerHeight > EPSILON) {
        addWallPanel({
          roomGroup,
          fragment,
          ledger,
          material: materials.wall,
          room,
          side,
          panelIndex: panelIndex++,
          along: (interval.start + interval.end) * 0.5,
          width: interval.end - interval.start,
          bottom: interval.height,
          height: headerHeight,
          normalOffset: configuration.normalOffset,
          localYaw: configuration.localYaw,
        });
      }
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor < half - EPSILON) {
      addWallPanel({
        roomGroup,
        fragment,
        ledger,
        material: materials.wall,
        room,
        side,
        panelIndex: panelIndex++,
        along: (cursor + half) * 0.5,
        width: half - cursor,
        bottom: 0,
        height: room.size.y,
        normalOffset: configuration.normalOffset,
        localYaw: configuration.localYaw,
      });
    }

    for (const socket of socketsBySide.get(side).filter((entry) => entry.capped)) {
      const capLocal = sideLocalPosition(
        side,
        socket.along,
        socket.height * 0.5,
        configuration.normalOffset,
      );
      makeMesh({
        parent: roomGroup,
        geometry: makeGeometry(ledger, socket.width, socket.height, room.wallThickness * 1.18),
        material: materials.cap,
        name: stableId('supplementSocketCap', room.id, socket.id),
        position: capLocal,
        rotationY: configuration.localYaw,
        userData: {
          dungeonSupplement: true,
          supplementNodeId: room.id,
          supplementSocketId: socket.id,
          socketCap: true,
          cameraOcclusionSurface: true,
          cameraOcclusionWall: true,
        },
      });
      const capWorld = localToWorld(capLocal, room.center, room.yaw);
      addCollisionZone(fragment, makeZone({
        id: stableId('supplementCapZone', room.id, socket.id),
        label: 'Dungeon supplement socket cap',
        obstacleKind: 'socketCap',
        position: capWorld,
        halfWidth: socket.width * 0.5,
        halfDepth: room.wallThickness * 0.59,
        verticalHalfHeight: socket.height * 0.5,
        rotationY: room.yaw + configuration.localYaw,
        metadata: { roomId: room.id, supplementSocketId: socket.id },
      }));
      fragment.socketCaps.push({
        id: stableId('supplementCap', room.id, socket.id),
        nodeId: room.id,
        roomId: room.id,
        socketId: socket.id,
        position: capWorld.clone(),
        width: socket.width,
        height: socket.height,
        rotationY: room.yaw + configuration.localYaw,
        themeBinding: cloneBinding(room.themeBinding),
        dungeonSupplement: true,
      });
      const asset = invokeAsset(session, 'cap', {
        id: stableId('supplementCapAsset', room.id, socket.id),
        nodeId: room.id,
        socketId: socket.id,
        position: capWorld.clone(),
        facing: resolveSocketFacing(room.source, socket.source),
        width: socket.width,
        height: socket.height,
        variant,
        themeBinding: room.themeBinding,
      }, ledger, `socket ${socket.id}`, { optional: true });
      // Parent factories receive a world-space specification and may position
      // their returned root themselves. Attach under the identity supplement
      // root so a transformed room group cannot apply the placement twice.
      addFactoryProductToGroup(asset, fragment.root, fragment);
    }
  }
}

function addRoomSupports({ roomGroup, room, supportDescriptors, material, ledger }) {
  if (supportDescriptors.length === 0 || !material) return;
  const inset = Math.max(room.wallThickness * 1.75, 0.32);
  const halfX = Math.max(0, room.size.x * 0.5 - inset);
  const halfZ = Math.max(0, room.size.z * 0.5 - inset);
  const locations = [
    [-halfX, -halfZ],
    [halfX, -halfZ],
    [-halfX, halfZ],
    [halfX, halfZ],
  ];
  const descriptor = supportDescriptors[0] ?? {};
  const thickness = positive(
    descriptor.widthMeters ?? descriptor.thicknessMeters,
    Math.min(0.42, Math.max(0.22, room.wallThickness * 1.5)),
  );
  for (const [index, [x, z]] of locations.entries()) {
    makeMesh({
      parent: roomGroup,
      geometry: makeGeometry(ledger, thickness, room.size.y, thickness),
      material,
      name: stableId('supplementSupport', room.id, index),
      position: new THREE.Vector3(x, room.size.y * 0.5, z),
      userData: {
        dungeonSupplement: true,
        supplementNodeId: room.id,
        structuralSupport: true,
        supportBaseY: room.center.y,
        surfaceRole: descriptor.role ?? 'support',
      },
    });
  }
}

function tileRange(center, size, tileSize) {
  const minimum = Math.ceil(((center - size * 0.5) / tileSize) + EPSILON);
  const maximum = Math.floor(((center + size * 0.5) / tileSize) - EPSILON);
  if (maximum < minimum) {
    const index = Math.round(center / tileSize);
    return [index, index];
  }
  return [minimum, maximum];
}

function addFloorTile(fragment, tile) {
  const elevation = finite(tile.elevation);
  const key = `${tile.x},${tile.z}@${elevation.toFixed(3)}`;
  if (fragment._floorTileKeys.has(key)) return;
  fragment._floorTileKeys.add(key);
  fragment.floorTiles.push(tile);
  const planarKey = `${tile.x},${tile.z}`;
  const existing = fragment.tiles.get(planarKey);
  if (!existing || finite(existing.elevation) > elevation) fragment.tiles.set(planarKey, tile);
}

function rasterizeRectangle(fragment, {
  id,
  center,
  size,
  yaw,
  tileSize,
  roomId = null,
  connectorId = null,
  surfaceRole,
  operationId = null,
}) {
  const radius = Math.hypot(size.x, size.z) * 0.5;
  const [minX, maxX] = tileRange(center.x, radius * 2, tileSize);
  const [minZ, maxZ] = tileRange(center.z, radius * 2, tileSize);
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const world = new THREE.Vector3(x * tileSize, center.y, z * tileSize);
      const local = worldToLocal(world, center, yaw);
      if (Math.abs(local.x) > size.x * 0.5 + tileSize * 0.45
        || Math.abs(local.z) > size.z * 0.5 + tileSize * 0.45) continue;
      addFloorTile(fragment, {
        id: stableId('supplementFloorTile', id, x, z, center.y.toFixed(3)),
        x,
        z,
        elevation: center.y,
        baseElevation: center.y,
        type: 'floor',
        surface: 'dungeonSupplementFloor',
        surfaceRole,
        roomId,
        connectorId,
        connectionId: connectorId,
        operationId,
        dungeonSupplement: true,
      });
    }
  }
}

function createMinimapRoom(room) {
  return {
    id: room.id,
    roomId: room.id,
    x: room.center.x / room.tileSize,
    z: room.center.z / room.tileSize,
    width: room.size.x / room.tileSize,
    depth: room.size.z / room.tileSize,
    baseElevation: room.center.y,
    discovered: false,
    operationId: room.operationId,
    parentRegionId: room.parentRegionId,
    dungeonSupplement: true,
  };
}

function resolveAnchorWorld(node, anchor, tileSize) {
  const center = resolveRecordPosition(node, tileSize);
  const yaw = resolveQuarterTurn(node);
  const explicitWorld = vectorFrom(anchor.worldPosition ?? anchor.position);
  if (explicitWorld && anchor.space !== 'local' && anchor.coordinateSpace !== 'local') {
    return usesParentGrid(anchor) ? gridVectorToWorld(explicitWorld, tileSize) : explicitWorld;
  }
  const local = anchor.localPosition
    ?? (Number.isFinite(Number(anchor.localX)) && Number.isFinite(Number(anchor.localZ))
      ? { x: anchor.localX, y: anchor.localY ?? 0, z: anchor.localZ }
      : null);
  if (local) {
    let localVector = vectorFrom(local);
    if (usesParentGrid(anchor)) localVector = gridVectorToWorld(localVector, tileSize);
    return localToWorld(localVector, center, yaw);
  }
  return resolveRecordPosition(anchor, tileSize, { fallback: center, inheritedGrid: usesParentGrid(node) });
}

function cloneVectorRecords(records) {
  return asArray(records).map((position) => vectorFrom(position)).filter(Boolean);
}

function appendAnchorFacade(fragment, node, anchor, position) {
  const kind = anchor.kind ?? anchor.type ?? anchor.anchorKind;
  const id = anchor.id ?? stableId(node.id, 'anchor', kind, fragment._anchorSequence++);
  const common = {
    ...cloneSerializableRecord(anchor),
    id,
    roomId: anchor.roomId ?? node.id,
    operationId: node.operationId,
    parentRegionId: node.parentRegionId,
    position: position.clone(),
    dungeonSupplement: true,
  };
  if (kind === 'encounter' || kind === 'enemyEncounter') {
    const spawnPoints = cloneVectorRecords(anchor.spawnPoints);
    if (spawnPoints.length === 0) spawnPoints.push(position.clone());
    fragment.encounters.push({ ...common, spawnPoints });
    fragment.enemySpawnPoints.push(...spawnPoints.map((point) => point.clone()));
  } else if (kind === 'enemySpawn' || kind === 'spawn') {
    fragment.enemySpawnPoints.push(position.clone());
  } else if (kind === 'reward' || kind === 'chest') {
    fragment.chests.push(common);
  } else if (kind === 'mechanism' || kind === 'control' || kind === 'terminal') {
    fragment.mechanisms.push(common);
  } else if (kind === 'door' || kind === 'gate') {
    fragment.doors.push(common);
  } else if (kind === 'keycard' || kind === 'progressionKey') {
    fragment.keycards.push(common);
  } else if (kind === 'progression' || kind === 'objective') {
    fragment.progressionAnchors.push(common);
  } else if (kind === 'platform') {
    fragment.platforms.push({
      ...common,
      center: position.clone(),
      halfWidth: positive(anchor.halfWidth, 1),
      halfDepth: positive(anchor.halfDepth, 1),
      elevation: finite(anchor.elevation, position.y),
    });
  } else if (kind === 'trap' || kind === 'hazard') {
    fragment.traps.push(common);
  } else if (kind === 'environmentalHazard') {
    fragment.environmentalHazards.push(common);
  } else if (kind === 'safeInteractable') {
    fragment.safeInteractables.push(common);
  } else if (kind === 'localLight'
    || kind === 'light'
    || kind === 'lightFixture'
    || kind === 'light-fixture') {
    fragment.localLights.push(common);
  } else if (kind === 'audioEmitter' || kind === 'soundscape') {
    fragment.audioEmitters.push(common);
  }
}

function assembleDelegatedProgression(fragment, overlayPlan, nodeById, segmentById, tileSize) {
  for (const assignment of asArray(overlayPlan.progressionAssignments)) {
    const node = nodeById.get(assignment.nodeId);
    const anchor = asArray(node?.anchors).find((candidate) => candidate.id === assignment.anchorId);
    const gateBeat = /gate|door/i.test(String(assignment.beatKind ?? ''));
    const gatedSegment = gateBeat ? segmentById.get(assignment.gatedSegmentId) : null;
    const gateEndpoint = gatedSegment
      ? [gatedSegment.from, gatedSegment.to].find((endpoint) => (
        endpoint?.nodeId === assignment.nodeId
      ))
      : null;
    const position = gateEndpoint
      ? resolveRecordPosition(gateEndpoint, tileSize, { inheritedGrid: usesParentGrid(node) })
      : node
        ? resolveAnchorWorld(node, anchor ?? {}, tileSize)
        : new THREE.Vector3();
    const record = {
      ...cloneSerializableRecord(assignment),
      id: assignment.id,
      stateId: assignment.stateId ?? assignment.id,
      beatId: assignment.beatId,
      beatKind: assignment.beatKind ?? 'objective',
      roomId: assignment.nodeId,
      nodeId: assignment.nodeId,
      anchorId: assignment.anchorId,
      gatedSegmentId: assignment.gatedSegmentId ?? null,
      connectionId: assignment.gatedSegmentId ?? null,
      logicalConnectionId: gatedSegment?.logicalEdgeId ?? null,
      position,
      parentAuthorityRequired: true,
      dungeonSupplement: true,
    };
    fragment.progressionAssignments.push(record);
    if (/key|credential/i.test(record.beatKind)) {
      fragment.keycards.push({ ...record, keycardId: record.beatId });
    } else if (/gate|door/i.test(record.beatKind)) {
      fragment.doors.push({ ...record, gateId: record.beatId });
    } else {
      fragment.mechanisms.push({ ...record, objectiveId: record.beatId });
    }
  }
  if (fragment.progressionAssignments.length > 0) {
    fragment.progressionPatch = {
      beats: fragment.progressionAssignments.map((assignment) => ({ ...assignment, position: assignment.position.clone() })),
      keycards: fragment.keycards.filter(({ parentAuthorityRequired }) => parentAuthorityRequired),
      doors: fragment.doors.filter(({ parentAuthorityRequired }) => parentAuthorityRequired),
      objectives: fragment.mechanisms.filter(({ parentAuthorityRequired }) => parentAuthorityRequired),
    };
  }
}

function assembleNode({
  node,
  operationById,
  bindingByRegion,
  connectedSocketIds,
  themeSources,
  fallbackSession,
  tileSize,
  ledger,
  fragment,
  structuralMode,
}) {
  const id = node.id ?? stableId('supplementNode', node.operationId, node.ordinal ?? fragment.rooms.length);
  const themeBinding = recordThemeBinding(node, operationById, bindingByRegion);
  const parentRegionId = node.parentRegionId ?? themeBinding?.parentRegionId
    ?? operationById.get(node.operationId)?.parentRegionId;
  const center = resolveRecordPosition(node, tileSize);
  const size = resolveRecordSize(node, tileSize, { inheritedGrid: usesParentGrid(node) });
  const yaw = resolveQuarterTurn(node);
  const room = {
    id,
    source: node,
    operationId: node.operationId ?? null,
    parentRegionId: parentRegionId ?? null,
    themeBinding,
    center,
    size,
    yaw,
    tileSize,
    wallThickness: positive(node.wallThicknessMeters, DEFAULT_WALL_THICKNESS),
  };
  const facadeRoom = {
    ...cloneSerializableRecord(node),
    id,
    type: node.type ?? 'supplement',
    kind: node.kind ?? 'supplementRoom',
    archetype: node.archetype ?? node.grammarId ?? 'dungeonSupplement',
    x: center.x / tileSize,
    z: center.z / tileSize,
    width: size.x / tileSize,
    depth: size.z / tileSize,
    baseElevation: center.y,
    minY: center.y,
    maxY: center.y + size.y,
    ceilingY: center.y + size.y,
    rotationY: yaw,
    operationId: room.operationId,
    parentRegionId: room.parentRegionId,
    themeBinding: cloneBinding(themeBinding),
    dungeonSupplement: true,
  };
  fragment.rooms.push(facadeRoom);
  fragment.minimap.rooms.push(createMinimapRoom(room));

  const nodeGroup = new THREE.Group();
  nodeGroup.name = stableId('DungeonSupplementRoom', id);
  nodeGroup.position.copy(center);
  nodeGroup.rotation.y = yaw;
  nodeGroup.userData.dungeonSupplement = true;
  nodeGroup.userData.supplementNodeId = id;
  nodeGroup.userData.operationId = room.operationId;
  nodeGroup.userData.parentRegionId = room.parentRegionId;
  nodeGroup.userData.themeBinding = cloneBinding(themeBinding);
  fragment.root.add(nodeGroup);

  const session = structuralMode === 'facadeOnly'
    ? resolveThemeSession(themeSources, themeBinding, parentRegionId, fallbackSession)
    : assertThemeSession(
      resolveThemeSession(themeSources, themeBinding, parentRegionId, fallbackSession),
      `supplement node ${id}`,
    );
  if (session) requireCapabilities(session, node.requiredThemeCapabilities, `supplement node ${id}`);
  const variant = node.presentationVariantId
    ?? themeBinding?.presentationVariantId
    ?? session?.themeBinding?.presentationVariantId;
  const sockets = asArray(node.sockets).map((socket) => (
    normalizeRoomSocket(node, socket, room, tileSize, connectedSocketIds)
  ));

  if (structuralMode !== 'facadeOnly') {
    const supportDescriptors = asArray(node.structure?.supports);
    const hasCappedSockets = sockets.some((socket) => socket.capped);
    const materials = {
      floor: resolveMaterial(session, 'primaryFloor', variant, ledger, `supplement node ${id}`),
      wall: resolveMaterial(session, 'wall', variant, ledger, `supplement node ${id}`),
      ceiling: resolveMaterial(session, 'ceiling', variant, ledger, `supplement node ${id}`),
      cap: hasCappedSockets
        ? resolveMaterial(session, 'cap', variant, ledger, `supplement node ${id}`)
        : null,
      support: supportDescriptors.length > 0
        ? resolveMaterial(session, 'support', variant, ledger, `supplement node ${id}`)
        : null,
    };
    const localFloor = new THREE.Vector3(0, -DEFAULT_FLOOR_THICKNESS * 0.5, 0);
    makeMesh({
      parent: nodeGroup,
      geometry: makeGeometry(ledger, size.x, DEFAULT_FLOOR_THICKNESS, size.z),
      material: materials.floor,
      name: stableId('supplementFloor', id),
      position: localFloor,
      userData: {
        dungeonSupplement: true,
        supplementNodeId: id,
        cameraOcclusionOwner: true,
        cameraOcclusionSurface: true,
        surfaceRole: 'primaryFloor',
      },
    });
    makeMesh({
      parent: nodeGroup,
      geometry: makeGeometry(ledger, size.x, DEFAULT_CEILING_THICKNESS, size.z),
      material: materials.ceiling,
      name: stableId('supplementCeiling', id),
      position: new THREE.Vector3(0, size.y + DEFAULT_CEILING_THICKNESS * 0.5, 0),
      userData: {
        dungeonSupplement: true,
        supplementNodeId: id,
        ceilingHeight: center.y + size.y,
        surfaceRole: 'ceiling',
      },
    });
    addRoomWalls({ roomGroup: nodeGroup, fragment, room, sockets, materials, ledger, session, variant });
    addRoomSupports({ roomGroup: nodeGroup, room, supportDescriptors, material: materials.support, ledger });
    rasterizeRectangle(fragment, {
      id,
      center,
      size,
      yaw,
      tileSize,
      roomId: id,
      surfaceRole: 'primaryFloor',
      operationId: node.operationId,
    });
  } else {
    for (const socket of sockets.filter((entry) => entry.capped)) {
      fragment.socketCaps.push({
        id: stableId('supplementCap', id, socket.id),
        nodeId: id,
        roomId: id,
        socketId: socket.id,
        position: socket.world.clone(),
        width: socket.width,
        height: socket.height,
        themeBinding: cloneBinding(themeBinding),
        dungeonSupplement: true,
      });
      const asset = session
        ? invokeAsset(session, 'cap', {
          id: stableId('supplementCapAsset', id, socket.id),
          nodeId: id,
          socketId: socket.id,
          position: socket.world.clone(),
          facing: resolveSocketFacing(node, socket.source),
          width: socket.width,
          height: socket.height,
          variant,
          themeBinding: cloneBinding(themeBinding),
        }, ledger, `socket ${socket.id}`, { optional: true })
        : null;
      addFactoryProductToGroup(asset, fragment.root, fragment);
    }
  }

  for (const anchor of asArray(node.anchors)) {
    const anchorPosition = resolveAnchorWorld(node, anchor, tileSize);
    appendAnchorFacade(fragment, facadeRoom, anchor, anchorPosition);
    const anchorKind = anchor.kind ?? anchor.type ?? anchor.anchorKind;
    const assetRole = anchor.assetRole
      ?? anchor.presentationAssetRole
      ?? (session?.assets?.has?.(anchorKind) ? anchorKind : null);
    if (assetRole && session) {
      const product = invokeAsset(session, assetRole, {
        ...cloneSerializableRecord(anchor),
        id: anchor.id ?? stableId(id, assetRole),
        nodeId: id,
        position: anchorPosition.clone(),
        themeBinding: cloneBinding(themeBinding),
        variant,
      }, ledger, `anchor ${anchor.id ?? assetRole} in ${id}`);
      addFactoryProductToGroup(product, fragment.root, fragment);
    }
  }
  for (const encounter of asArray(node.encounters)) {
    appendAnchorFacade(
      fragment,
      facadeRoom,
      { kind: 'encounter', ...encounter },
      resolveAnchorWorld(node, encounter, tileSize),
    );
  }
  if (session && node.environment !== false) {
    const environmentSpecification = {
      id: stableId('supplementEnvironment', id),
      nodeId: id,
      operationId: node.operationId ?? null,
      parentRegionId,
      center: center.clone(),
      size: size.clone(),
      bounds: {
        center: center.clone().add(new THREE.Vector3(0, size.y * 0.5, 0)),
        halfWidth: size.x * 0.5,
        halfDepth: size.z * 0.5,
        verticalHalfHeight: size.y * 0.5,
      },
      localLightingProfileId: themeBinding?.localLightingProfileId,
      soundscapeProfileId: themeBinding?.soundscapeProfileId,
      themeBinding: cloneBinding(themeBinding),
      ...(node.environment ?? {}),
    };
    for (const capability of ['localLights', 'audioEmitters']) {
      const product = invokeEnvironment(
        session,
        capability,
        environmentSpecification,
        ledger,
        `supplement node ${id}`,
      );
      appendEnvironmentProduct(fragment, capability, product);
      addFactoryProductToGroup(product, fragment.root, fragment);
    }
  }
  return { room, facadeRoom, nodeGroup, session };
}

function addTunnelSegment({
  id,
  segment,
  pointA,
  pointB,
  width,
  height,
  operationId,
  themeBinding,
  session,
  variant,
  ledger,
  fragment,
  parent,
  tileSize,
  materialRoles = null,
}) {
  const delta = pointB.clone().sub(pointA);
  const horizontalLength = Math.hypot(delta.x, delta.z);
  if (horizontalLength <= EPSILON) return null;
  const center = pointA.clone().add(pointB).multiplyScalar(0.5);
  const yaw = Math.atan2(delta.z, delta.x);
  const roles = materialRoles ?? {
    floor: 'corridorFloor',
    wall: 'wall',
    ceiling: 'ceiling',
  };
  const materials = {
    floor: resolveMaterial(session, roles.floor, variant, ledger, `supplement segment ${id}`),
    wall: resolveMaterial(session, roles.wall, variant, ledger, `supplement segment ${id}`),
    ceiling: resolveMaterial(session, roles.ceiling, variant, ledger, `supplement segment ${id}`),
  };
  const group = new THREE.Group();
  group.name = stableId('DungeonSupplementCorridorSpan', id);
  group.position.copy(center);
  group.rotation.y = yaw;
  group.userData.dungeonSupplement = true;
  group.userData.supplementSegmentId = segment.id;
  parent.add(group);

  makeMesh({
    parent: group,
    geometry: makeGeometry(ledger, horizontalLength, DEFAULT_FLOOR_THICKNESS, width),
    material: materials.floor,
    name: stableId('supplementCorridorFloor', id),
    position: new THREE.Vector3(0, -DEFAULT_FLOOR_THICKNESS * 0.5, 0),
    userData: {
      dungeonSupplement: true,
      supplementSegmentId: segment.id,
      cameraOcclusionOwner: true,
      cameraOcclusionSurface: true,
      surfaceRole: roles.floor,
    },
  });
  makeMesh({
    parent: group,
    geometry: makeGeometry(ledger, horizontalLength, DEFAULT_CEILING_THICKNESS, width),
    material: materials.ceiling,
    name: stableId('supplementCorridorCeiling', id),
    position: new THREE.Vector3(0, height + DEFAULT_CEILING_THICKNESS * 0.5, 0),
    userData: { dungeonSupplement: true, supplementSegmentId: segment.id, surfaceRole: roles.ceiling },
  });
  for (const [side, z] of [['left', -width * 0.5], ['right', width * 0.5]]) {
    const wallPosition = new THREE.Vector3(0, height * 0.5, z);
    makeMesh({
      parent: group,
      geometry: makeGeometry(ledger, horizontalLength, height, DEFAULT_WALL_THICKNESS),
      material: materials.wall,
      name: stableId('supplementCorridorWall', id, side),
      position: wallPosition,
      userData: {
        dungeonSupplement: true,
        supplementSegmentId: segment.id,
        cameraOcclusionOwner: true,
        cameraOcclusionSurface: true,
        cameraOcclusionWall: true,
      },
    });
    const zonePosition = localToWorld(wallPosition, center, yaw);
    addCollisionZone(fragment, makeZone({
      id: stableId('supplementCorridorWallZone', id, side),
      label: 'Dungeon supplement corridor wall',
      obstacleKind: 'boundaryWall',
      position: zonePosition,
      halfWidth: horizontalLength * 0.5,
      halfDepth: DEFAULT_WALL_THICKNESS * 0.5,
      verticalHalfHeight: height * 0.5,
      rotationY: yaw,
      metadata: { connectorId: segment.id, connectionId: segment.id, operationId },
    }));
  }

  rasterizeRectangle(fragment, {
    id,
    center,
    size: new THREE.Vector3(horizontalLength, height, width),
    yaw,
    tileSize,
    connectorId: segment.id,
    surfaceRole: roles.floor,
    operationId,
  });
  return { group, center, yaw, horizontalLength };
}

function assembleSegment({
  segment,
  nodeById,
  operationById,
  bindingByRegion,
  themeSources,
  fallbackSession,
  tileSize,
  ledger,
  fragment,
  structuralMode,
}) {
  const id = segment.id ?? stableId('supplementSegment', segment.operationId, fragment.connectionPlans.length);
  const themeBinding = recordThemeBinding(segment, operationById, bindingByRegion);
  const parentRegionId = segment.parentRegionId ?? themeBinding?.parentRegionId
    ?? operationById.get(segment.operationId)?.parentRegionId;
  const path = resolveSegmentPath(segment, nodeById, tileSize);
  if (path.length < 2) {
    throw new DungeonSupplementAssemblyError(
      `Supplement segment ${id} has no resolvable path or socket endpoints.`,
      { code: 'INVALID_SUPPLEMENT_SEGMENT_PATH' },
    );
  }
  const width = positive(
    segment.widthMeters
    ?? segment.width
    ?? segment.sourceContract?.widthMeters,
    tileSize * 3,
  );
  const height = positive(
    segment.heightMeters
    ?? segment.height
    ?? segment.sourceContract?.heightMeters,
    DEFAULT_ROOM_HEIGHT,
  );
  const family = CONNECTOR_FAMILY_ALIASES[
    segment.connectorFamily ?? segment.family ?? segment.connectorVariantId ?? 'serviceGallery'
  ] ?? segment.connectorFamily ?? segment.family ?? 'serviceGallery';
  const session = structuralMode === 'facadeOnly'
    ? resolveThemeSession(themeSources, themeBinding, parentRegionId, fallbackSession)
    : assertThemeSession(
      resolveThemeSession(themeSources, themeBinding, parentRegionId, fallbackSession),
      `supplement segment ${id}`,
    );
  if (session) {
    requireCapabilities(session, {
      ...(segment.requiredThemeCapabilities ?? {}),
      connectorFamilies: [
        ...asArray(segment.requiredThemeCapabilities?.connectorFamilies),
        ...(structuralMode === 'facadeOnly' ? [] : [family]),
      ],
    }, `supplement segment ${id}`);
  }
  const variant = segment.presentationVariantId
    ?? themeBinding?.presentationVariantId
    ?? session?.themeBinding?.presentationVariantId;
  const segmentGroup = new THREE.Group();
  segmentGroup.name = stableId('DungeonSupplementCorridor', id);
  segmentGroup.userData.dungeonSupplement = true;
  segmentGroup.userData.supplementSegmentId = id;
  segmentGroup.userData.operationId = segment.operationId ?? null;
  segmentGroup.userData.themeBinding = cloneBinding(themeBinding);
  fragment.root.add(segmentGroup);

  if (structuralMode !== 'facadeOnly') {
    for (let index = 1; index < path.length; index += 1) {
      addTunnelSegment({
        id: stableId(id, 'span', index - 1),
        segment: { ...segment, id },
        pointA: path[index - 1],
        pointB: path[index],
        width,
        height,
        operationId: segment.operationId,
        themeBinding,
        session,
        variant,
        ledger,
        fragment,
        parent: segmentGroup,
        tileSize,
        materialRoles: {
          floor: family === 'slope' ? 'ramp' : 'corridorFloor',
          wall: 'wall',
          ceiling: 'ceiling',
        },
      });
    }
    const skin = invokeConnectorSkin(session, family, {
      ...cloneSerializableRecord(segment),
      id,
      path: path.map((point) => point.clone()),
      width,
      height,
      tileSize,
      themeBinding: cloneBinding(themeBinding),
      variant,
      supplementRoot: segmentGroup,
    }, ledger, `supplement segment ${id}`);
    addFactoryProductToGroup(skin, segmentGroup, fragment);
  }

  const fromNodeId = segment.from?.nodeId ?? segment.fromNodeId ?? null;
  const toNodeId = segment.to?.nodeId ?? segment.toNodeId ?? null;
  const connection = {
    ...cloneSerializableRecord(segment),
    id,
    connectorId: id,
    connectorFamily: family,
    from: fromNodeId ?? segment.from,
    to: toNodeId ?? segment.to,
    fromNodeId,
    toNodeId,
    logicalEdgeId: segment.logicalEdgeId ?? segment.originalEdgeId ?? null,
    physicalOrdinal: segment.physicalOrdinal ?? 0,
    path: path.map((point) => point.clone()),
    themeBinding: cloneBinding(themeBinding),
    dungeonSupplement: true,
  };
  fragment.connectionPlans.push(connection);
  const minimapConnection = {
    id,
    from: fromNodeId,
    to: toNodeId,
    fromRoomId: fromNodeId,
    toRoomId: toNodeId,
    path: path.map((point) => ({ x: point.x / tileSize, z: point.z / tileSize, elevation: point.y })),
    logicalEdgeId: connection.logicalEdgeId,
    dungeonSupplement: true,
  };
  fragment.minimap.hallways.push(minimapConnection);
  fragment.minimap.connections.push({ ...minimapConnection, path: minimapConnection.path.map((point) => ({ ...point })) });
}

function validateTransitionBay(transition) {
  const forbidden = [];
  if (transition.gatesAllowed === true || transition.gate || asArray(transition.gates).length > 0) forbidden.push('gates');
  if (transition.hazardsAllowed === true || transition.hazard || asArray(transition.hazards).length > 0) forbidden.push('hazards');
  if (transition.encounter || asArray(transition.encounters).length > 0) forbidden.push('encounters');
  const family = transition.connectorFamily ?? transition.family;
  if (family && !['service-gallery', 'serviceGallery', 'transitionBay'].includes(family)) forbidden.push(`connector:${family}`);
  if (forbidden.length > 0) {
    throw new DungeonSupplementAssemblyError(
      `Transition bay ${transition.id ?? '(unnamed)'} contains forbidden capabilities: ${forbidden.join(', ')}.`,
      { code: 'INVALID_TRANSITION_BAY' },
    );
  }
}

function assembleTransitionBay({
  transition,
  operationById,
  bindingByRegion,
  themeSources,
  fallbackSession,
  tileSize,
  ledger,
  fragment,
  structuralMode,
}) {
  validateTransitionBay(transition);
  const id = transition.id ?? stableId('supplementTransition', transition.operationId, fragment.connectionPlans.length);
  const sourceBinding = cloneBinding(
    transition.sourceThemeBinding
    ?? bindingByRegion.get(transition.sourceParentRegionId),
  );
  const destinationBinding = cloneBinding(
    transition.destinationThemeBinding
    ?? bindingByRegion.get(transition.destinationParentRegionId),
  );
  const sourceSession = structuralMode === 'facadeOnly'
    ? resolveThemeSession(themeSources, sourceBinding, sourceBinding?.parentRegionId, fallbackSession)
    : assertThemeSession(
      resolveThemeSession(themeSources, sourceBinding, sourceBinding?.parentRegionId, fallbackSession),
      `source side of transition bay ${id}`,
    );
  const destinationSession = structuralMode === 'facadeOnly'
    ? resolveThemeSession(themeSources, destinationBinding, destinationBinding?.parentRegionId, fallbackSession)
    : assertThemeSession(
      resolveThemeSession(themeSources, destinationBinding, destinationBinding?.parentRegionId, fallbackSession),
      `destination side of transition bay ${id}`,
    );
  const transitionRequirements = structuralMode === 'facadeOnly'
    ? {
      materialRoles: [],
      assetRoles: ['transitionFrame'],
      connectorFamilies: ['transitionBay'],
      transitionTypes: ['levelTransitionBay'],
    }
    : {
      materialRoles: ['corridorFloor', 'wall', 'ceiling'],
      assetRoles: ['transitionFrame'],
      connectorFamilies: ['transitionBay'],
      transitionTypes: ['levelTransitionBay'],
    };
  // Preflight both parent sessions before allocating any transition geometry
  // or invoking a presentation factory. A partial seam is never committed.
  for (const [side, session] of [['source', sourceSession], ['destination', destinationSession]]) {
    requireCapabilities(session, transitionRequirements, `${side} side of transition bay ${id}`);
  }
  const center = resolveRecordPosition(transition, tileSize);
  const size = resolveRecordSize(transition, tileSize, {
    fallbackWidth: tileSize * 6,
    fallbackDepth: tileSize * 3,
    fallbackHeight: DEFAULT_ROOM_HEIGHT,
    inheritedGrid: usesParentGrid(transition),
  });
  const yaw = resolveQuarterTurn(transition);
  const splitRatio = Math.min(0.75, Math.max(0.25, finite(transition.splitRatio, 0.5)));
  // Transition placement follows the grammar convention: local X is bay
  // width and local +Z follows the route. The planner's quarter-turn facing
  // rotates that local forward vector into the parent path direction.
  const routeLength = size.z;
  const routeWidth = size.x;
  const sourceLength = routeLength * splitRatio;
  const axis = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const start = center.clone().addScaledVector(axis, -routeLength * 0.5);
  const split = start.clone().addScaledVector(axis, sourceLength);
  const end = start.clone().addScaledVector(axis, routeLength);
  const group = new THREE.Group();
  group.name = stableId('DungeonSupplementTransitionBay', id);
  group.userData.dungeonSupplement = true;
  group.userData.supplementTransitionId = id;
  group.userData.sourceThemeBinding = sourceBinding;
  group.userData.destinationThemeBinding = destinationBinding;
  fragment.root.add(group);

  if (structuralMode !== 'facadeOnly') {
    addTunnelSegment({
      id: stableId(id, 'source'),
      segment: { id, operationId: transition.operationId },
      pointA: start,
      pointB: split,
      width: routeWidth,
      height: size.y,
      operationId: transition.operationId,
      themeBinding: sourceBinding,
      session: sourceSession,
      variant: sourceBinding?.presentationVariantId,
      ledger,
      fragment,
      parent: group,
      tileSize,
    });
    addTunnelSegment({
      id: stableId(id, 'destination'),
      segment: { id, operationId: transition.operationId },
      pointA: split,
      pointB: end,
      width: routeWidth,
      height: size.y,
      operationId: transition.operationId,
      themeBinding: destinationBinding,
      session: destinationSession,
      variant: destinationBinding?.presentationVariantId,
      ledger,
      fragment,
      parent: group,
      tileSize,
    });
    for (const [side, session, binding] of [
      ['source', sourceSession, sourceBinding],
      ['destination', destinationSession, destinationBinding],
    ]) {
      const contract = {
        ...cloneSerializableRecord(transition),
        id: stableId(id, side),
        transitionId: id,
        side,
        position: split.clone(),
        yaw,
        width: routeWidth,
        height: size.y,
        flatThreshold: true,
        themeBinding: cloneBinding(binding),
      };
      addFactoryProductToGroup(
        invokeAsset(session, 'transitionFrame', contract, ledger, `${side} frame of transition bay ${id}`),
        group,
        fragment,
      );
      addFactoryProductToGroup(
        invokeConnectorSkin(session, 'transitionBay', contract, ledger, `${side} skin of transition bay ${id}`),
        group,
        fragment,
      );
      addFactoryProductToGroup(
        invokeTransition(session, 'levelTransitionBay', contract, ledger, `${side} transition provider of ${id}`),
        group,
        fragment,
      );
    }
  } else {
    // The parent owns the surrounding corridor shell in facade-only mode,
    // but a cross-theme seam is still presentation, not neutral structure.
    // Both bound sessions must contribute their own frame/skin/provider at
    // the deterministic midpoint or assembly fails with no fallback skin.
    for (const [side, session, binding] of [
      ['source', sourceSession, sourceBinding],
      ['destination', destinationSession, destinationBinding],
    ]) {
      const contract = {
        ...cloneSerializableRecord(transition),
        id: stableId(id, side, 'facadeSeam'),
        transitionId: id,
        side,
        position: split.clone(),
        yaw,
        width: routeWidth,
        height: size.y,
        flatThreshold: true,
        facadeOnly: true,
        themeBinding: cloneBinding(binding),
      };
      addFactoryProductToGroup(
        invokeAsset(session, 'transitionFrame', contract, ledger, `${side} facade frame of transition bay ${id}`),
        group,
        fragment,
      );
      addFactoryProductToGroup(
        invokeConnectorSkin(session, 'transitionBay', contract, ledger, `${side} facade skin of transition bay ${id}`),
        group,
        fragment,
      );
      addFactoryProductToGroup(
        invokeTransition(session, 'levelTransitionBay', contract, ledger, `${side} facade transition provider of ${id}`),
        group,
        fragment,
      );
    }
  }

  const connection = {
    ...cloneSerializableRecord(transition),
    id,
    connectorFamily: 'transitionBay',
    logicalEdgeId: transition.originalEdgeId ?? transition.logicalEdgeId ?? null,
    path: [start.clone(), split.clone(), end.clone()],
    sourceThemeBinding: sourceBinding,
    destinationThemeBinding: destinationBinding,
    gatesAllowed: false,
    hazardsAllowed: false,
    dungeonSupplement: true,
  };
  fragment.connectionPlans.push(connection);
  const operation = operationById.get(transition.operationId);
  const transitionRoom = {
    ...cloneSerializableRecord(transition),
    id,
    type: 'transition',
    kind: 'levelTransitionBay',
    x: center.x / tileSize,
    z: center.z / tileSize,
    width: routeWidth / tileSize,
    depth: routeLength / tileSize,
    baseElevation: center.y,
    minY: center.y,
    maxY: center.y + size.y,
    ceilingY: center.y + size.y,
    rotationY: yaw,
    operationId: transition.operationId ?? null,
    parentRegionId: operation?.parentRegionId ?? sourceBinding?.parentRegionId ?? null,
    sourceThemeBinding: sourceBinding,
    destinationThemeBinding: destinationBinding,
    transitionBay: true,
    encounterEligible: false,
    hazardEligible: false,
    dungeonSupplement: true,
  };
  fragment.rooms.push(transitionRoom);
  fragment.minimap.rooms.push({
    id,
    roomId: id,
    x: transitionRoom.x,
    z: transitionRoom.z,
    width: transitionRoom.width,
    depth: transitionRoom.depth,
    baseElevation: center.y,
    discovered: false,
    operationId: transition.operationId ?? null,
    parentRegionId: transitionRoom.parentRegionId,
    transitionBay: true,
    dungeonSupplement: true,
  });
  const minimapConnection = {
    id,
    from: transition.from?.nodeId ?? transition.fromNodeId ?? id,
    to: transition.to?.nodeId ?? transition.toNodeId ?? id,
    fromRoomId: transition.from?.nodeId ?? transition.fromNodeId ?? id,
    toRoomId: transition.to?.nodeId ?? transition.toNodeId ?? id,
    path: connection.path.map((point) => ({ x: point.x / tileSize, z: point.z / tileSize, elevation: point.y })),
    logicalEdgeId: connection.logicalEdgeId,
    transitionBay: true,
    dungeonSupplement: true,
  };
  fragment.minimap.hallways.push(minimapConnection);
  fragment.minimap.connections.push({ ...minimapConnection, path: minimapConnection.path.map((point) => ({ ...point })) });
}

function computeMinimapBounds(fragment) {
  const points = [];
  for (const room of fragment.minimap.rooms) {
    points.push(
      { x: room.x - room.width * 0.5, z: room.z - room.depth * 0.5 },
      { x: room.x + room.width * 0.5, z: room.z + room.depth * 0.5 },
    );
  }
  for (const hallway of fragment.minimap.hallways) points.push(...asArray(hallway.path));
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((point) => finite(point.x))),
    maxX: Math.max(...points.map((point) => finite(point.x))),
    minZ: Math.min(...points.map((point) => finite(point.z))),
    maxZ: Math.max(...points.map((point) => finite(point.z))),
  };
}

function finalizeFragment(fragment, elementCounts, sessions) {
  delete fragment._floorTileKeys;
  delete fragment._anchorSequence;
  fragment.floorTiles.sort((left, right) => (
    finite(left.elevation) - finite(right.elevation)
    || left.z - right.z
    || left.x - right.x
    || String(left.id).localeCompare(String(right.id))
  ));
  fragment.minimap.rooms.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  fragment.minimap.hallways.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  fragment.minimap.connections.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  fragment.minimap.bounds = computeMinimapBounds(fragment);
  fragment.root.updateMatrixWorld(true);
  fragment.diagnostics.assembled = {
    ...elementCounts,
    roomCount: fragment.rooms.length,
    floorTileCount: fragment.floorTiles.length,
    solidZoneCount: fragment.solidZones.length,
    aerialBoundaryZoneCount: fragment.aerialBoundaryZones.length,
    encounterCount: fragment.encounters.length,
    resourceCounts: fragment.resources.snapshot(sessions),
  };
  return fragment;
}

/**
 * Assemble a validated, serializable augmentation overlay with presentation
 * supplied exclusively by its parent region theme sessions.
 *
 * `structuralMode: 'complete'` creates enclosed Three.js rooms/corridors plus
 * facade data. `structuralMode: 'facadeOnly'` emits room/connection/anchor
 * facade records without duplicate structural meshes or collision, for hosts
 * that already stamped the accepted overlay into their own tile assembler.
 */
export function assembleDungeonSupplement({
  overlayPlan,
  themeSessions = null,
  themeSession = null,
  tileSize = DEFAULT_TILE_SIZE,
  structuralMode = 'complete',
  rootName = DUNGEON_SUPPLEMENT_ROOT_NAME,
} = {}) {
  if (!overlayPlan || typeof overlayPlan !== 'object') {
    throw new DungeonSupplementAssemblyError('A serializable overlayPlan is required.', {
      code: 'MISSING_AUGMENTATION_OVERLAY_PLAN',
    });
  }
  if (!['complete', 'facadeOnly'].includes(structuralMode)) {
    throw new DungeonSupplementAssemblyError(`Unknown structuralMode "${structuralMode}".`, {
      code: 'INVALID_SUPPLEMENT_STRUCTURAL_MODE',
    });
  }
  const resolvedTileSize = positive(tileSize, DEFAULT_TILE_SIZE);
  const root = new THREE.Group();
  root.name = sanitizeName(rootName, DUNGEON_SUPPLEMENT_ROOT_NAME);
  root.userData.dungeonSupplement = true;
  root.userData.augmentationPlanHash = overlayPlan.augmentationPlanHash ?? null;
  root.userData.effectivePlanHash = overlayPlan.effectivePlanHash ?? null;
  root.userData.profileId = overlayPlan.profileId ?? null;
  const ledger = createResourceLedger();
  const fragment = createFragment(overlayPlan, root, resolvedTileSize, ledger);
  fragment._floorTileKeys = new Set();
  fragment._anchorSequence = 0;
  fragment.structuralMode = structuralMode;

  const elements = collectPlanElements(overlayPlan);
  const operationById = new Map(elements.operations.map((operation) => [operation.id, operation]));
  const bindingByRegion = new Map();
  const planBindings = Array.isArray(overlayPlan.themeBindings)
    ? overlayPlan.themeBindings
    : Object.entries(overlayPlan.themeBindings ?? {}).map(([parentRegionId, binding]) => ({
      parentRegionId,
      ...binding,
    }));
  for (const entry of planBindings) {
    const binding = entry?.binding ?? entry;
    const regionId = binding?.parentRegionId ?? entry?.parentRegionId ?? binding?.id;
    if (regionId) bindingByRegion.set(regionId, binding);
  }
  for (const operation of elements.operations) {
    if (operation.parentRegionId && operation.themeBinding) {
      bindingByRegion.set(operation.parentRegionId, operation.themeBinding);
    }
  }
  const themeSources = themeSessions ?? themeSession;
  const nodeById = new Map(elements.nodes.map((node) => [node.id, node]));
  const segmentById = new Map(elements.segments.map((segment) => [segment.id, segment]));
  const connectedSocketIds = getConnectedSocketIds(elements.segments);
  const resolvedSessions = new Set();

  try {
    for (const node of elements.nodes) {
      const assembled = assembleNode({
        node,
        operationById,
        bindingByRegion,
        connectedSocketIds,
        themeSources,
        fallbackSession: themeSession,
        tileSize: resolvedTileSize,
        ledger,
        fragment,
        structuralMode,
      });
      if (assembled.session) resolvedSessions.add(assembled.session);
    }
    assembleDelegatedProgression(
      fragment,
      overlayPlan,
      nodeById,
      segmentById,
      resolvedTileSize,
    );
    for (const segment of elements.segments) {
      assembleSegment({
        segment,
        nodeById,
        operationById,
        bindingByRegion,
        themeSources,
        fallbackSession: themeSession,
        tileSize: resolvedTileSize,
        ledger,
        fragment,
        structuralMode,
      });
    }
    for (const transition of elements.transitionBays) {
      assembleTransitionBay({
        transition,
        operationById,
        bindingByRegion,
        themeSources,
        fallbackSession: themeSession,
        tileSize: resolvedTileSize,
        ledger,
        fragment,
        structuralMode,
      });
    }
  } catch (error) {
    ledger.dispose(root);
    if (error instanceof DungeonSupplementAssemblyError) throw error;
    throw new DungeonSupplementAssemblyError('Unexpected dungeon supplement assembly failure.', {
      cause: error,
    });
  }

  return finalizeFragment(fragment, {
    planNodeCount: elements.nodes.length,
    planSegmentCount: elements.segments.length,
    planTransitionBayCount: elements.transitionBays.length,
    planExplicitCapCount: elements.caps.length,
  }, [...resolvedSessions]);
}

export const assembleDungeonSupplementPlan = assembleDungeonSupplement;
