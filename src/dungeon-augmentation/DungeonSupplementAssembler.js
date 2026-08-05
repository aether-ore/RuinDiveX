import * as THREE from 'three';
import {
  createDungeonJunctionGeometryRecord,
  createDungeonSocketLandingOverlapVolume,
} from './geometry.js';
import { inspectConnectorOnlyParentAnchoredProjection } from './parentAnchoredConnectorForest.js';

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
  'shortcut-lift': 'lift',
  shortcutLift: 'lift',
  'drop-ladder': 'ladder',
  dropLadder: 'ladder',
});

const FRAGMENT_ARRAY_FIELDS = Object.freeze([
  'rooms',
  'connectorJunctionProxies',
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
  'junctions',
  'landingClearances',
]);

const PRESENTATION_FACTORY_ARRAY_FIELDS = new Set([
  'localLights',
  'audioEmitters',
  'renderCullGroups',
]);

const V4_STORY_PRESENTATION_SURFACES = new Set([
  'floor-flush-decal',
  'wall-mounted-decal',
]);
const V4_STORY_PRESENTATION_MAX_THICKNESS_METERS = 0.035 + 1e-6;

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

function requiresAuthoritativeThemePreflight(overlayPlan) {
  return overlayPlan?.authoritativeManifestRealization === true
    || overlayPlan?.profileId === 'industrial-supplement-preview-v4';
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

function addFactoryProductToGroup(
  product,
  parent,
  fragment,
  { facadeOnly = false, context = 'theme factory product' } = {},
) {
  if (!product) return;
  if (Array.isArray(product)) {
    product.forEach((entry) => addFactoryProductToGroup(
      entry,
      parent,
      fragment,
      { facadeOnly, context },
    ));
    return;
  }
  const facade = product.fragment ?? product.facade ?? product;
  const topologySources = [...new Set([
    product,
    product.fragment,
    product.facade,
  ].filter((source) => source && typeof source === 'object'))];
  const forbiddenFields = [...new Set(topologySources.flatMap((source) => (
    FRAGMENT_ARRAY_FIELDS.filter((field) => (
      !PRESENTATION_FACTORY_ARRAY_FIELDS.has(field)
        && Array.isArray(source[field])
        && source[field].length > 0
    ))
  )))];
  if (forbiddenFields.length > 0) {
    throw new DungeonSupplementAssemblyError(
      `${context} attempted to inject unvalidated topology: ${forbiddenFields.join(', ')}.`,
      {
        code: facadeOnly
          ? 'FACADE_ONLY_FACTORY_TOPOLOGY_FORBIDDEN'
          : 'THEME_FACTORY_TOPOLOGY_FORBIDDEN',
        diagnostics: [{ forbiddenFields, structuralMode: facadeOnly ? 'facadeOnly' : 'complete' }],
      },
    );
  }
  if (product.isObject3D) {
    parent.add(product);
    return;
  }
  const object = product.object ?? product.root ?? product.group;
  if (object?.isObject3D) parent.add(object);
  for (const field of FRAGMENT_ARRAY_FIELDS) {
    if (!PRESENTATION_FACTORY_ARRAY_FIELDS.has(field)) continue;
    if (Array.isArray(facade[field])) fragment[field].push(...facade[field]);
  }
}

function presentationFactoryObjectRoots(product, roots = new Set()) {
  if (!product) return roots;
  if (Array.isArray(product)) {
    for (const entry of product) presentationFactoryObjectRoots(entry, roots);
    return roots;
  }
  if (product.isObject3D) {
    roots.add(product);
    return roots;
  }
  for (const key of ['object', 'root', 'group']) {
    if (product[key]?.isObject3D) roots.add(product[key]);
  }
  return roots;
}

function createPresentationAssetSpecification({
  record,
  nodeId,
  themeBinding,
  variant,
}) {
  const position = vectorFrom(record.transform?.position ?? record.position);
  const width = Number(record.authoredFootprint?.widthMeters ?? record.widthMeters);
  const height = Number(record.authoredFootprint?.heightMeters ?? record.heightMeters);
  const depth = Number(record.authoredFootprint?.depthMeters ?? record.depthMeters);
  const rotationY = Number(record.transform?.rotationY ?? record.rotationY ?? 0);
  if (!position || !Number.isFinite(width) || width <= 0
    || !Number.isFinite(height) || height <= 0
    || !Number.isFinite(depth) || depth <= 0
    || !Number.isFinite(rotationY)) {
    throw new DungeonSupplementAssemblyError(
      `Presentation record ${record.id ?? '(unnamed)'} has an invalid authored transform or footprint.`,
      { code: 'INVALID_PRESENTATION_TRANSFORM' },
    );
  }
  const authoredFacing = directionFrom(record.transform?.facing ?? record.facing);
  const facing = authoredFacing ?? new THREE.Vector3(
    Math.sin(rotationY),
    0,
    Math.cos(rotationY),
  );
  return {
    ...cloneSerializableRecord(record),
    id: String(record.id),
    nodeId,
    sourceFeatureId: String(record.sourceFeatureId),
    sourceFeatureRuntimeId: String(record.sourceFeatureRuntimeId),
    presentationRecord: cloneSerializableRecord(record),
    position: position.clone(),
    width,
    height,
    depth,
    rotationY,
    facing: facing.clone(),
    themeBinding: cloneBinding(themeBinding),
    variant,
  };
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

function operationType(operation) {
  return operation?.type ?? operation?.operationType ?? operation?.kind ?? null;
}

function isSupplementConnectorProxyNode(node = {}) {
  return ['supplementConnectorJunction', 'supplementConnectorModule'].includes(node.kind)
    || ['supplementConnectorJunction', 'supplementConnectorModule'].includes(node.nodeKind)
    || node.isSupplementConnectorJunction === true
    || node.isSupplementConnectorModule === true;
}

function segmentOperationId(segment) {
  return segment?.operationId ?? segment?.parentOperationId ?? segment?.operation?.id ?? null;
}

function endpointSocketId(endpoint) {
  return endpoint?.socketId ?? endpoint?.id ?? endpoint?.sourceSocketId ?? null;
}

function validateRouteNetworkSocketBindings(elements, overlayPlan = null) {
  const nodeById = new Map(elements.nodes.map((node) => [String(node.id), node]));
  for (const operation of elements.operations.filter((entry) => operationType(entry) === 'routeNetwork')) {
    const parentAnchoredForest = overlayPlan?.schema
      === 'ruindivex-dungeon-augmentation-overlay/v2'
      && (
        Number(overlayPlan?.profileRevision) === 5
        || (
          Number(overlayPlan?.profileRevision) === 6
          && overlayPlan?.generationMode === 'authored-artifact'
        )
      )
      && operation?.realizationMode === 'parent-anchored-forest';
    if (operation?.realizationMode != null && !parentAnchoredForest) {
      throw new DungeonSupplementAssemblyError(
        `Route network ${operation.id ?? '(unnamed)'} declares an unsupported realization mode.`,
        { code: 'INVALID_ROUTE_NETWORK_REALIZATION_MODE' },
      );
    }
    const selectedSocketIdSequence = asArray(operation.endpointSocketIds).map(String);
    const selectedSocketIds = new Set(selectedSocketIdSequence);
    const minimumEndpointCount = parentAnchoredForest ? 1 : 2;
    if (selectedSocketIds.size < minimumEndpointCount
      || selectedSocketIds.size !== selectedSocketIdSequence.length) {
      throw new DungeonSupplementAssemblyError(
        `Route network ${operation.id ?? '(unnamed)'} must declare at least ${minimumEndpointCount} unique exact endpoint socket ID${minimumEndpointCount === 1 ? '' : 's'}.`,
        { code: 'INVALID_ROUTE_NETWORK_SOCKET_BINDING' },
      );
    }
    const declaredSegmentIds = new Set(asArray(operation.segmentIds).map(String));
    const operationSegments = elements.segments.filter((segment) => (
      String(segmentOperationId(segment)) === String(operation.id)
      || declaredSegmentIds.has(String(segment.id))
    ));
    if (operationSegments.length === 0) {
      throw new DungeonSupplementAssemblyError(
        `Route network ${operation.id ?? '(unnamed)'} has no physical segments.`,
        { code: 'INVALID_ROUTE_NETWORK_SOCKET_BINDING' },
      );
    }
    const parentUseCounts = new Map();
    for (const segment of operationSegments) {
      for (const [role, endpoint] of [['from', segment.from], ['to', segment.to]]) {
        const nodeId = endpoint?.nodeId ?? endpoint?.roomId;
        const socketId = endpointSocketId(endpoint);
        if (!nodeId || !socketId) {
          throw new DungeonSupplementAssemblyError(
            `Route network segment ${segment.id ?? '(unnamed)'} ${role} endpoint lacks an exact nodeId/socketId binding.`,
            { code: 'INVALID_ROUTE_NETWORK_SOCKET_BINDING' },
          );
        }
        const supplementNode = nodeById.get(String(nodeId));
        if (supplementNode) {
          const socket = asArray(supplementNode.sockets).find((candidate) => (
            String(candidate.id) === String(socketId)
          ));
          if (!socket) {
            throw new DungeonSupplementAssemblyError(
              `Route network segment ${segment.id ?? '(unnamed)'} ${role} endpoint references missing supplement socket ${socketId}.`,
              { code: 'INVALID_ROUTE_NETWORK_SOCKET_BINDING' },
            );
          }
          const endpointPosition = vectorFrom(endpoint.position ?? endpoint.worldPosition);
          const socketPosition = vectorFrom(socket.position ?? socket.worldPosition);
          if (endpointPosition && socketPosition
            && endpointPosition.distanceToSquared(socketPosition) > EPSILON ** 2) {
            throw new DungeonSupplementAssemblyError(
              `Route network segment ${segment.id ?? '(unnamed)'} ${role} endpoint position does not match supplement socket ${socketId}.`,
              { code: 'INVALID_ROUTE_NETWORK_SOCKET_BINDING' },
            );
          }
          const endpointFacing = directionFrom(endpoint.facing ?? endpoint.worldFacing);
          const socketFacing = directionFrom(socket.facing ?? socket.worldFacing);
          if (endpointFacing && socketFacing && endpointFacing.dot(socketFacing) < 1 - EPSILON) {
            throw new DungeonSupplementAssemblyError(
              `Route network segment ${segment.id ?? '(unnamed)'} ${role} endpoint facing does not match supplement socket ${socketId}.`,
              { code: 'INVALID_ROUTE_NETWORK_SOCKET_BINDING' },
            );
          }
          continue;
        }
        if (!selectedSocketIds.has(String(socketId))) {
          throw new DungeonSupplementAssemblyError(
            `Route network segment ${segment.id ?? '(unnamed)'} uses ungranted parent socket ${socketId}.`,
            { code: 'INVALID_ROUTE_NETWORK_SOCKET_BINDING' },
          );
        }
        if (!endpoint.position && !endpoint.worldPosition
          && !Number.isFinite(Number(endpoint.x))) {
          throw new DungeonSupplementAssemblyError(
            `Route network parent socket ${socketId} has no exact position.`,
            { code: 'INVALID_ROUTE_NETWORK_SOCKET_BINDING' },
          );
        }
        parentUseCounts.set(String(socketId), (parentUseCounts.get(String(socketId)) ?? 0) + 1);
      }
    }
    const invalidUsage = [...selectedSocketIds].filter((socketId) => (
      parentUseCounts.get(socketId) !== 1
    ));
    if (invalidUsage.length > 0) {
      throw new DungeonSupplementAssemblyError(
        `Route network ${operation.id ?? '(unnamed)'} must use each granted endpoint once: ${invalidUsage.join(', ')}.`,
        { code: 'INVALID_ROUTE_NETWORK_SOCKET_BINDING' },
      );
    }
    const missingNodes = asArray(operation.nodeIds).map(String).filter((nodeId) => !nodeById.has(nodeId));
    if (missingNodes.length > 0) {
      throw new DungeonSupplementAssemblyError(
        `Route network ${operation.id ?? '(unnamed)'} references missing nodes: ${missingNodes.join(', ')}.`,
        { code: 'INVALID_ROUTE_NETWORK_NODE_BINDING' },
      );
    }
  }
}

function validatePresentationRecords(elements, overlayPlan = null) {
  const selectedStoryByOperationId = new Map();
  const claimedDelegatedOwnerBindings = new Map();
  const validRealizationOwners = new Set([
    'supplement-assembler',
    'gameplay-runtime',
    'supplement-connector-assembler',
  ]);
  for (const node of elements.nodes) {
    const records = asArray(node.presentationRecords);
    const authoritativeBlueprint = node.authoritativeBlueprintRealization === true;
    const authoritativeV4Blueprint = Boolean(
      authoritativeBlueprint
        && (
          overlayPlan?.profileId === 'industrial-supplement-preview-v4'
            || node.physicalRealization?.profileId === 'industrial-supplement-preview-v4'
            || node.structureMetadata?.profileId === 'industrial-supplement-preview-v4'
        )
    );
    if (records.length === 0 && !authoritativeBlueprint) continue;
    const recordIds = new Set();
    const sourceFeatureRuntimeIds = new Set();
    const collisionIds = new Set(asArray(node.collisionRecords).map(({ id }) => String(id)));
    const anchorRecords = asArray(node.anchors);
    const transferRecords = asArray(node.transfers);
    const inventoryRecordsForOwner = (owner) => (
      owner === 'gameplay-runtime'
        ? anchorRecords
        : owner === 'supplement-connector-assembler'
          ? transferRecords
          : []
    );
    const inventoryContainsExactlyOnce = (owner, bindingId) => (
      inventoryRecordsForOwner(owner).filter((entry) => (
        String(entry?.id ?? '') === bindingId
          || String(entry?.runtimeId ?? '') === bindingId
      )).length === 1
    );
    for (const record of records) {
      const recordId = String(record?.id ?? '');
      const sourceFeatureRuntimeId = String(record?.sourceFeatureRuntimeId ?? '');
      if (!recordId || recordIds.has(recordId) || !sourceFeatureRuntimeId
        || sourceFeatureRuntimeIds.has(sourceFeatureRuntimeId)) {
        throw new DungeonSupplementAssemblyError(
          `Supplement node ${node.id ?? '(unnamed)'} has duplicate or incomplete presentation identity.`,
          { code: 'INVALID_PRESENTATION_RECORD_IDENTITY' },
        );
      }
      recordIds.add(recordId);
      sourceFeatureRuntimeIds.add(sourceFeatureRuntimeId);
      const missingCollisionIds = asArray(record.collisionRecordIds).map(String).filter((id) => (
        !collisionIds.has(id)
      ));
      if (missingCollisionIds.length > 0) {
        throw new DungeonSupplementAssemblyError(
          `Presentation record ${recordId} references missing collision records: ${missingCollisionIds.join(', ')}.`,
          { code: 'INVALID_PRESENTATION_COLLISION_BINDING' },
        );
      }
      const realizationOwner = String(record.realizationOwner ?? '');
      const realizationKind = String(record.realizationKind ?? '');
      const ownerBindingIds = asArray(record.ownerBindingIds).map(String);
      const runtimeConsumerBindingIds = asArray(record.runtimeConsumerBindingIds).map(String);
      const realizationRequired = record.realizationRequired === true;
      const storyMarking = record.semanticRole === 'story-marking';
      if (
        !validRealizationOwners.has(realizationOwner)
          || realizationOwner !== String(record.presentationOwner ?? '')
          || !realizationKind
      ) {
        throw new DungeonSupplementAssemblyError(
          `Presentation record ${recordId} has an invalid owner-aware realization contract.`,
          { code: 'INVALID_PRESENTATION_REALIZATION_CONTRACT' },
        );
      }
      if (storyMarking) {
        if (
          record.optional !== true
            || record.required === true
            || realizationRequired !== true
        ) {
          throw new DungeonSupplementAssemblyError(
            `Story presentation record ${recordId} has inconsistent optional realization coverage.`,
            { code: 'INVALID_STORY_PRESENTATION_RECORD' },
          );
        }
        if (authoritativeV4Blueprint) {
          const presentationSurface = String(record.presentationSurface ?? '');
          const footprint = record.authoredFootprint ?? record.worldFootprint ?? {};
          const presentationThickness = presentationSurface === 'floor-flush-decal'
            ? Number(footprint.heightMeters)
            : Number(footprint.depthMeters);
          if (
            !V4_STORY_PRESENTATION_SURFACES.has(presentationSurface)
              || !Number.isFinite(presentationThickness)
              || presentationThickness <= 0
              || presentationThickness > V4_STORY_PRESENTATION_MAX_THICKNESS_METERS
          ) {
            throw new DungeonSupplementAssemblyError(
              `Story presentation record ${recordId} is not mounted on an approved nonblocking decal surface.`,
              { code: 'INVALID_STORY_PRESENTATION_SURFACE' },
            );
          }
        }
      } else if (
        record.required !== true
          || record.optional === true
          || realizationRequired !== true
      ) {
        throw new DungeonSupplementAssemblyError(
          `Authored gameplay presentation record ${recordId} was made optional or dormant at the source-identity layer.`,
          { code: 'INVALID_REQUIRED_PRESENTATION_RECORD' },
        );
      }
      if (realizationOwner === 'supplement-assembler'
        && record.required === true
        && record.selectedForRendering !== true) {
        throw new DungeonSupplementAssemblyError(
          `Required presentation record ${recordId} was not selected for assembly.`,
          { code: 'REQUIRED_PRESENTATION_RECORD_UNSELECTED' },
        );
      }
      if (realizationOwner === 'supplement-assembler') {
        if (
          realizationKind !== 'theme-object-root'
            || ownerBindingIds.length !== 0
            || record.renderedBySupplementAssembler !== (record.selectedForRendering === true)
        ) {
          throw new DungeonSupplementAssemblyError(
            `Assembler presentation record ${recordId} has invalid theme-root ownership.`,
            { code: 'INVALID_PRESENTATION_OWNER_BINDING' },
          );
        }
      } else if (realizationRequired) {
        const expectedKind = realizationOwner === 'gameplay-runtime'
          ? 'gameplay-anchor'
          : 'physical-transfer';
        const [ownerBindingId] = ownerBindingIds;
        if (
          realizationKind !== expectedKind
            || ownerBindingIds.length !== 1
            || !ownerBindingId
            || !inventoryContainsExactlyOnce(realizationOwner, ownerBindingId)
            || record.selectedForRendering === true
            || record.renderedBySupplementAssembler === true
        ) {
          throw new DungeonSupplementAssemblyError(
            `Delegated presentation record ${recordId} has no exact owner binding.`,
            { code: 'INVALID_PRESENTATION_OWNER_BINDING' },
          );
        }
        const ownerBindingKey = `${realizationOwner}:${ownerBindingId}`;
        if (claimedDelegatedOwnerBindings.has(ownerBindingKey)) {
          throw new DungeonSupplementAssemblyError(
            `Presentation records ${claimedDelegatedOwnerBindings.get(ownerBindingKey)} and ${recordId} share ${ownerBindingKey}.`,
            { code: 'DUPLICATE_PRESENTATION_OWNER_BINDING' },
          );
        }
        claimedDelegatedOwnerBindings.set(ownerBindingKey, recordId);
        if (realizationOwner === 'gameplay-runtime') {
          const runtimeActivation = String(record.runtimeActivation ?? '');
          if (!['active', 'dormant'].includes(runtimeActivation)) {
            throw new DungeonSupplementAssemblyError(
              `Gameplay presentation record ${recordId} has invalid runtime activation ${runtimeActivation || '(missing)'}.`,
              { code: 'INVALID_PRESENTATION_REALIZATION_CONTRACT' },
            );
          }
          if (
            runtimeActivation === 'active'
              && (
                runtimeConsumerBindingIds.length === 0
                  || runtimeConsumerBindingIds.some((bindingId) => (
                    !inventoryContainsExactlyOnce('gameplay-runtime', bindingId)
                  ))
              )
          ) {
            throw new DungeonSupplementAssemblyError(
              `Active gameplay presentation record ${recordId} has no exact runtime consumer.`,
              { code: 'ACTIVE_PRESENTATION_CONSUMER_MISSING' },
            );
          }
          if (runtimeActivation === 'dormant' && runtimeConsumerBindingIds.length > 0) {
            throw new DungeonSupplementAssemblyError(
              `Dormant gameplay presentation record ${recordId} claims active runtime consumers.`,
              { code: 'INVALID_PRESENTATION_REALIZATION_CONTRACT' },
            );
          }
        } else if (
          record.runtimeActivation !== 'not-applicable'
            || runtimeConsumerBindingIds.length > 0
        ) {
          throw new DungeonSupplementAssemblyError(
            `Transfer presentation record ${recordId} has invalid runtime activation metadata.`,
            { code: 'INVALID_PRESENTATION_REALIZATION_CONTRACT' },
          );
        }
      }
      if (storyMarking && record.selectedForRendering === true) {
        if (record.optional !== true || record.nonblocking !== true
          || record.storyPlacementLegal !== true) {
          throw new DungeonSupplementAssemblyError(
            `Story presentation record ${recordId} is not an optional legal nonblocking marking.`,
            { code: 'INVALID_STORY_PRESENTATION_RECORD' },
          );
        }
        const operationId = String(record.operationId ?? node.operationId ?? '');
        if (selectedStoryByOperationId.has(operationId)) {
          throw new DungeonSupplementAssemblyError(
            `Route network ${operationId} selected more than one story marking.`,
            { code: 'DUPLICATE_STORY_PRESENTATION_SELECTION' },
          );
        }
        selectedStoryByOperationId.set(operationId, recordId);
      }
    }
    if (authoritativeBlueprint) {
      const featureSourceIds = new Set(asArray(node.features).map((feature) => String(
        feature.sourceFeatureRuntimeId ?? feature.runtimeId ?? feature.id ?? '',
      )).filter(Boolean));
      const missingPresentationSourceIds = [...featureSourceIds].filter((id) => (
        !sourceFeatureRuntimeIds.has(id)
      ));
      const inventedPresentationSourceIds = [...sourceFeatureRuntimeIds].filter((id) => (
        !featureSourceIds.has(id)
      ));
      if (missingPresentationSourceIds.length > 0 || inventedPresentationSourceIds.length > 0) {
        throw new DungeonSupplementAssemblyError(
          `Supplement node ${node.id ?? '(unnamed)'} presentation/source feature sets differ.`,
          {
            code: 'INVALID_PRESENTATION_SOURCE_COVERAGE',
            diagnostics: [{ missingPresentationSourceIds, inventedPresentationSourceIds }],
          },
        );
      }
      const genericBlueprintDuplicates = asArray(node.anchors).filter((anchor) => (
        anchor.isManifestCover === true || anchor.isManifestLandmark === true
      ));
      if (genericBlueprintDuplicates.length > 0) {
        throw new DungeonSupplementAssemblyError(
          `Supplement node ${node.id ?? '(unnamed)'} still promotes authored blueprint solids through generic prop anchors.`,
          { code: 'DUPLICATE_BLUEPRINT_PRESENTATION_PATH' },
        );
      }
      const internalDoorwayFrames = authoritativeV4Blueprint
        ? asArray(node.anchors).filter((anchor) => (
            String(anchor?.kind ?? anchor?.type ?? anchor?.anchorKind ?? '')
              === 'doorway-frame'
          ))
        : [];
      if (internalDoorwayFrames.length > 0) {
        throw new DungeonSupplementAssemblyError(
          `Supplement node ${node.id ?? '(unnamed)'} reintroduced V4 internal doorway frames.`,
          {
            code: 'V4_INTERNAL_DOORWAY_FRAME_PRESENTATION_FORBIDDEN',
            diagnostics: [{
              anchorIds: internalDoorwayFrames.map(({ id }) => String(id)).sort(),
            }],
          },
        );
      }
    }
  }
}

function validatePresentationRealizationCoverage(elements, fragment) {
  const expectedRecords = elements.nodes.flatMap((node) => asArray(node.presentationRecords));
  const expectedIds = expectedRecords
    .map(({ id }) => String(id))
    .sort();
  const realizedIds = fragment.presentationRealizations
    .map(({ presentationRecordId }) => String(presentationRecordId))
    .sort();
  if (expectedIds.length !== new Set(expectedIds).size
    || realizedIds.length !== new Set(realizedIds).size
    || expectedIds.length !== realizedIds.length
    || expectedIds.some((id, index) => id !== realizedIds[index])) {
    throw new DungeonSupplementAssemblyError(
      'Required presentation records and owner-aware realizations differ.',
      {
        code: 'PRESENTATION_REALIZATION_COVERAGE_MISMATCH',
        diagnostics: [{ expectedIds, realizedIds }],
      },
    );
  }
  const realizationByRecordId = new Map(fragment.presentationRealizations.map((realization) => (
    [String(realization.presentationRecordId), realization]
  )));
  for (const record of expectedRecords) {
    const recordId = String(record.id);
    const realization = realizationByRecordId.get(recordId);
    const realizationOwner = String(record.realizationOwner);
    const delegated = realizationOwner !== 'supplement-assembler';
    const rendered = realizationOwner === 'supplement-assembler'
      && record.selectedForRendering === true;
    const expectedDisposition = rendered
      ? 'rendered'
      : delegated
        ? 'delegated-to-owner'
        : 'optional-not-selected';
    if (
      !realization
        || realization.realizationOwner !== realizationOwner
        || realization.realizationKind !== record.realizationKind
        || realization.realizationDisposition !== expectedDisposition
        || realization.renderedBySupplementAssembler !== rendered
        || (delegated && (
          realization.rootObjectCount !== 0
            || realization.rendererObjectId != null
            || realization.ownerBindingId !== String(record.ownerBindingIds[0])
        ))
        || (rendered && (
          realization.rootObjectCount !== 1
            || !realization.rendererObjectId
            || realization.ownerBindingId != null
        ))
        || (!delegated && !rendered && (
          realization.rootObjectCount !== 0
            || realization.rendererObjectId != null
            || realization.ownerBindingId != null
        ))
    ) {
      throw new DungeonSupplementAssemblyError(
        `Presentation record ${recordId} has an invalid ${realizationOwner} realization ledger entry.`,
        {
          code: 'PRESENTATION_REALIZATION_COVERAGE_MISMATCH',
          diagnostics: [{ recordId, realizationOwner, realization }],
        },
      );
    }
  }
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
    presentationRealizations: [],
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

function createConnectorProxyProgressionCandidates(
  elements,
  connectorOnlyParentAnchoredProjection = {
    proxyIds: new Set(),
    collapseRoomIdBySegmentId: new Map(),
  },
) {
  const connectorIds = new Set(elements.nodes
    .filter(isSupplementConnectorProxyNode)
    .map(({ id }) => String(id)));
  const roomIds = new Set(elements.nodes
    .filter((node) => !isSupplementConnectorProxyNode(node))
    .map(({ id }) => String(id)));
  const adjacency = new Map();
  const armIdsByProxyId = new Map([...connectorIds].map((id) => [id, new Set()]));
  const connect = (fromId, toId) => {
    if (!fromId || !toId) return;
    const from = String(fromId);
    const to = String(toId);
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };
  for (const [segmentOrdinal, segment] of elements.segments.entries()) {
    const fromId = segment.from?.nodeId ?? segment.fromNodeId ?? null;
    const toId = segment.to?.nodeId ?? segment.toNodeId ?? null;
    connect(fromId, toId);
    connect(toId, fromId);
    const segmentId = String(segment.id ?? `segment:${segmentOrdinal}`);
    if (connectorIds.has(String(fromId))) armIdsByProxyId.get(String(fromId)).add(segmentId);
    if (connectorIds.has(String(toId))) armIdsByProxyId.get(String(toId)).add(segmentId);
  }
  for (const node of elements.nodes) {
    const nodeId = String(node?.id ?? '');
    if (!connectorIds.has(nodeId)
      || node?.exactParentEndpoint !== true
      || node?.parentEndpointSocketKind !== 'authored-corridor-station'
      || Number(node?.parentThroughRouteDegreeContribution ?? 0) !== 1) {
      continue;
    }
    armIdsByProxyId.get(nodeId).add(String(
      node.parentThroughPhysicalArmId ?? `${nodeId}:authored-parent-through-arm`,
    ));
  }

  const candidatesByProxyId = new Map();
  for (const proxyId of [...connectorIds].sort()) {
    const queue = [{ id: proxyId, distance: 0 }];
    const visited = new Set([proxyId]);
    const candidates = [];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const neighborId of [...(adjacency.get(current.id) ?? [])].sort()) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const distance = current.distance + 1;
        if (roomIds.has(neighborId)) {
          candidates.push({ roomId: neighborId, distance });
        } else if (connectorIds.has(neighborId)) {
          queue.push({ id: neighborId, distance });
        }
      }
    }
    candidates.sort((left, right) => (
      left.distance - right.distance || left.roomId.localeCompare(right.roomId)
    ));
    const node = elements.nodes.find(({ id }) => String(id) === proxyId);
    const minimumArmCount = node?.kind === 'supplementConnectorJunction' ? 3 : 2;
    const armCount = armIdsByProxyId.get(proxyId)?.size ?? 0;
    if (armCount < minimumArmCount) {
      throw new DungeonSupplementAssemblyError(
        `Connector proxy ${proxyId} has ${armCount} physical arms; ${minimumArmCount} are required.`,
        { code: 'INVALID_SUPPLEMENT_CONNECTOR_JUNCTION_ARMS' },
      );
    }
    if (candidates.length === 0
      && !connectorOnlyParentAnchoredProjection.proxyIds.has(proxyId)) {
      throw new DungeonSupplementAssemblyError(
        `Connector proxy ${proxyId} cannot reach a substantive supplemental room.`,
        { code: 'INVALID_SUPPLEMENT_CONNECTOR_JUNCTION_PROGRESSION' },
      );
    }
    candidatesByProxyId.set(proxyId, candidates);
  }
  return {
    candidatesByProxyId,
    armIdsByProxyId,
    collapseRoomIdBySegmentId:
      connectorOnlyParentAnchoredProjection.collapseRoomIdBySegmentId,
  };
}

function selectConnectorProxyProgressionCandidate(candidates = [], excludedRoomId = null) {
  return candidates.find(({ roomId }) => roomId !== excludedRoomId)
    ?? candidates[0]
    ?? null;
}

function selectConnectorProxyProgressionPair(fromCandidates = [], toCandidates = []) {
  const pairs = [];
  for (const from of fromCandidates) {
    for (const to of toCandidates) {
      pairs.push({ from, to, selfEdge: from.roomId === to.roomId });
    }
  }
  pairs.sort((left, right) => (
    Number(left.selfEdge) - Number(right.selfEdge)
      || left.from.distance + left.to.distance - right.from.distance - right.to.distance
      || left.from.distance - right.from.distance
      || left.to.distance - right.to.distance
      || left.from.roomId.localeCompare(right.from.roomId)
      || left.to.roomId.localeCompare(right.to.roomId)
  ));
  return pairs[0] ?? null;
}

function resolveConnectorProxyProgressionEndpoints(
  fromNodeId,
  toNodeId,
  candidatesByProxyId,
  collapseRoomId = null,
) {
  const fromProxyId = candidatesByProxyId.has(String(fromNodeId)) ? String(fromNodeId) : null;
  const toProxyId = candidatesByProxyId.has(String(toNodeId)) ? String(toNodeId) : null;
  let fromProgressionRoomId = collapseRoomId ?? fromNodeId;
  let toProgressionRoomId = collapseRoomId ?? toNodeId;
  if (collapseRoomId) {
    // A connector-only parent-anchored component is a physical supplement,
    // not a local progression arc. Collapse its room projection onto the
    // component's canonical authored parent root while preserving the exact
    // physical endpoints and connection plan below.
  } else if (fromProxyId && toProxyId) {
    const pair = selectConnectorProxyProgressionPair(
      candidatesByProxyId.get(fromProxyId),
      candidatesByProxyId.get(toProxyId),
    );
    fromProgressionRoomId = pair?.from.roomId ?? fromProgressionRoomId;
    toProgressionRoomId = pair?.to.roomId ?? toProgressionRoomId;
  } else if (fromProxyId) {
    fromProgressionRoomId = selectConnectorProxyProgressionCandidate(
      candidatesByProxyId.get(fromProxyId),
      toProgressionRoomId,
    )?.roomId ?? fromProgressionRoomId;
  } else if (toProxyId) {
    toProgressionRoomId = selectConnectorProxyProgressionCandidate(
      candidatesByProxyId.get(toProxyId),
      fromProgressionRoomId,
    )?.roomId ?? toProgressionRoomId;
  }
  return {
    fromProgressionRoomId,
    toProgressionRoomId,
    fromProxyId,
    toProxyId,
    selfEdge: fromProgressionRoomId === toProgressionRoomId,
    physicalOnlyParentAnchoredComponent: Boolean(collapseRoomId),
  };
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

function floorOwnerIds(tile = {}) {
  return [...new Set([
    tile.roomId,
    tile.connectorJunctionProxyId,
    tile.connectorJunctionOwnerId,
    tile.connectorId,
    tile.connectionId,
    ...(tile.mergedFloorOwnerIds ?? []),
    ...(tile.sharedThresholdOwnerIds ?? []),
  ].filter(Boolean).map(String))].sort();
}

function floorSourceCount(tile = {}) {
  return Math.max(1, Number(tile.mergedFloorSourceCount ?? 1));
}

function unownedFloorSourceCount(tile = {}) {
  if (Number.isFinite(Number(tile.mergedUnownedFloorSourceCount))) {
    return Math.max(0, Number(tile.mergedUnownedFloorSourceCount));
  }
  return floorOwnerIds(tile).length === 0 ? 1 : 0;
}

function explicitSharedThresholdOwnerIds(...tiles) {
  return new Set(tiles.flatMap((tile) => [
    ...(tile?.sharedThresholdOwnerIds ?? []),
    ...(tile?.sharedFloorOwnerIds ?? []),
  ]).filter(Boolean).map(String));
}

function mergeCompatibleFloorProvenance(existing, incoming, key) {
  const existingOwners = floorOwnerIds(existing);
  const incomingOwners = floorOwnerIds(incoming);
  const combinedOwners = [...new Set([...existingOwners, ...incomingOwners])].sort();
  const sharedOwners = explicitSharedThresholdOwnerIds(existing, incoming);
  const sameOwnedSurface = existingOwners.length > 0
    && incomingOwners.length > 0
    && existingOwners.every((ownerId) => incomingOwners.includes(ownerId))
    && incomingOwners.every((ownerId) => existingOwners.includes(ownerId));
  const explicitThresholdSharing = sharedOwners.size > 0
    && combinedOwners.every((ownerId) => sharedOwners.has(ownerId));
  const unownedSourceCount = unownedFloorSourceCount(existing)
    + unownedFloorSourceCount(incoming);
  if (
    unownedSourceCount > 0
    || (!sameOwnedSurface && !explicitThresholdSharing)
  ) {
    throw new DungeonSupplementAssemblyError(
      `Dungeon supplement floor ${key} has incompatible or unowned overlapping sources.`,
      {
        code: 'DUNGEON_SUPPLEMENT_FLOOR_OWNERSHIP_CONFLICT',
        diagnostics: [{
          floorKey: key,
          existingOwnerIds: existingOwners,
          incomingOwnerIds: incomingOwners,
          sharedThresholdOwnerIds: [...sharedOwners].sort(),
          unownedSourceCount,
        }],
      },
    );
  }
  existing.mergedFloorOwnerIds = combinedOwners;
  existing.mergedFloorSourceCount = floorSourceCount(existing) + floorSourceCount(incoming);
  existing.mergedUnownedFloorSourceCount = 0;
  if (sharedOwners.size > 0) {
    existing.sharedThresholdOwnerIds = [...sharedOwners].sort();
    existing.sharedThresholdContractIds = [...new Set([
      ...(existing.sharedThresholdContractIds ?? []),
      ...(incoming.sharedThresholdContractIds ?? []),
    ].filter(Boolean).map(String))].sort();
  }
  return existing;
}

function addFloorTile(fragment, tile) {
  const elevation = finite(tile.elevation);
  const key = `${tile.x},${tile.z}@${elevation.toFixed(3)}`;
  const existing = fragment._floorTileByKey.get(key);
  if (existing) {
    mergeCompatibleFloorProvenance(existing, tile, key);
    return existing;
  }
  tile.mergedFloorOwnerIds = floorOwnerIds(tile);
  tile.mergedFloorSourceCount = floorSourceCount(tile);
  tile.mergedUnownedFloorSourceCount = unownedFloorSourceCount(tile);
  fragment._floorTileKeys.add(key);
  fragment._floorTileByKey.set(key, tile);
  fragment.floorTiles.push(tile);
  const planarKey = `${tile.x},${tile.z}`;
  const planarExisting = fragment.tiles.get(planarKey);
  if (!planarExisting || finite(planarExisting.elevation) > elevation) {
    fragment.tiles.set(planarKey, tile);
  }
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
  sharedThresholdContracts = [],
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
      const sharedThresholdContractsAtTile = sharedThresholdContracts.filter((contract) => {
        const delta = world.clone().sub(contract.center);
        const direction = contract.direction;
        const longitudinal = delta.x * direction.x + delta.z * direction.z;
        const lateral = -delta.x * direction.z + delta.z * direction.x;
        return Math.abs(longitudinal) <= tileSize * 1.05
          && Math.abs(lateral) <= contract.width * 0.5 + tileSize * 0.05;
      });
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
        ...(sharedThresholdContractsAtTile.length > 0 ? {
          sharedThresholdOwnerIds: [...new Set(sharedThresholdContractsAtTile.flatMap((contract) => (
            [contract.roomId, contract.connectorId]
          )).filter(Boolean).map(String))].sort(),
          sharedThresholdContractIds: sharedThresholdContractsAtTile
            .map((contract) => contract.id)
            .filter(Boolean)
            .map(String)
            .sort(),
        } : {}),
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
    contentRole: room.source?.contentRole ?? room.source?.networkRole ?? null,
    junctionKind: room.source?.junction?.junctionKind
      ?? room.source?.junctionKind
      ?? null,
    accessDomainId: room.source?.accessDomainId ?? null,
    progressionBandId: room.source?.progressionBandId ?? null,
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

function nodeStructureRecords(node, key) {
  return asArray(node?.structure?.[key]);
}

function supplementalNodeOwnerReferences(room) {
  return room?.isConnectorJunctionProxy
    ? { connectorJunctionProxyId: room.id }
    : { roomId: room.id };
}

function nodeStructuralDescriptors(node) {
  return {
    platforms: stableUnique([
      ...nodeStructureRecords(node, 'platforms'),
      ...nodeStructureRecords(node, 'catwalks'),
    ], (record) => record.id),
    ramps: stableUnique(nodeStructureRecords(node, 'ramps'), (record) => record.id),
    rails: stableUnique(nodeStructureRecords(node, 'rails'), (record) => record.id),
  };
}

function structureMaterialRole(descriptor, fallback) {
  return descriptor?.materialRole
    ?? descriptor?.surfaceRole
    ?? descriptor?.role
    ?? fallback;
}

function requiredNodeStructureMaterialRoles(descriptors) {
  return [...new Set([
    ...descriptors.platforms.map((descriptor) => structureMaterialRole(descriptor, 'catwalk')),
    ...descriptors.ramps.map((descriptor) => structureMaterialRole(descriptor, 'ramp')),
    ...descriptors.rails.map((descriptor) => structureMaterialRole(descriptor, 'rail')),
  ].filter(Boolean))];
}

function structureLocalPoint(descriptor, {
  gridKeys = [],
  meterKeys = [],
  tileSize,
  fallback = new THREE.Vector3(),
} = {}) {
  for (const key of gridKeys) {
    const point = vectorFrom(descriptor?.[key]);
    if (point) return new THREE.Vector3(point.x * tileSize, point.y, point.z * tileSize);
  }
  for (const key of meterKeys) {
    const point = vectorFrom(descriptor?.[key]);
    if (point) return point;
  }
  return fallback.clone();
}

function platformAnchorForStructure(node, room, descriptor, localTop, tileSize) {
  const explicitAnchorId = descriptor.anchorId ?? descriptor.platformAnchorId;
  if (explicitAnchorId) {
    return asArray(node?.anchors).find((anchor) => (
      anchor.id === explicitAnchorId || anchor.localAnchorId === explicitAnchorId
    )) ?? null;
  }
  const worldTop = localToWorld(localTop, room.center, room.yaw);
  return asArray(node?.anchors).find((anchor) => {
    const kind = anchor.kind ?? anchor.type ?? anchor.anchorKind;
    if (kind !== 'platform') return false;
    const world = resolveAnchorWorld(node, anchor, tileSize);
    return world.distanceToSquared(worldTop) <= 0.05 * 0.05;
  }) ?? null;
}

function resolveStructurePlatform(node, room, descriptor, tileSize) {
  const localTop = structureLocalPoint(descriptor, {
    gridKeys: ['localCenterGrid'],
    meterKeys: ['localCenter', 'localPosition', 'center'],
    tileSize,
  });
  localTop.y = finite(
    descriptor.elevation ?? descriptor.localElevation,
    localTop.y,
  );
  const width = positive(
    descriptor.widthMeters ?? descriptor.width,
    positive(descriptor.widthTiles, 3) * tileSize,
  );
  const depth = positive(
    descriptor.depthMeters ?? descriptor.depth,
    positive(descriptor.depthTiles, 3) * tileSize,
  );
  const thickness = positive(
    descriptor.thicknessMeters ?? descriptor.thickness,
    DEFAULT_FLOOR_THICKNESS,
  );
  const worldTop = localToWorld(localTop, room.center, room.yaw);
  const anchor = platformAnchorForStructure(node, room, descriptor, localTop, tileSize);
  const id = anchor?.id ?? stableId('supplementPlatform', room.id, descriptor.id);
  const surfaceRole = structureMaterialRole(descriptor, 'catwalk');
  return {
    descriptor,
    anchor,
    id,
    surfaceRole,
    localTop,
    worldTop,
    width,
    depth,
    thickness,
    record: {
      ...cloneSerializableRecord(descriptor),
      id,
      sourceStructureId: descriptor.id ?? null,
      ...supplementalNodeOwnerReferences(room),
      operationId: room.operationId,
      parentRegionId: room.parentRegionId,
      center: worldTop.clone(),
      position: worldTop.clone(),
      halfWidth: width * 0.5,
      halfDepth: depth * 0.5,
      elevation: worldTop.y,
      topY: worldTop.y,
      baseY: worldTop.y - thickness,
      thickness,
      surfaceRole,
      platformPurpose: descriptor.platformPurpose ?? descriptor.purpose ?? null,
      requiredTraversalAction: descriptor.requiredTraversalAction ?? null,
      blocksBelow: descriptor.blocksBelow === true,
      dynamic: false,
      themeBinding: cloneBinding(room.themeBinding),
      dungeonSupplement: true,
    },
  };
}

function resolveStructureRamp(room, descriptor, tileSize) {
  const localStart = structureLocalPoint(descriptor, {
    gridKeys: ['localStartGrid'],
    meterKeys: ['localStart', 'start'],
    tileSize,
  });
  const localEnd = structureLocalPoint(descriptor, {
    gridKeys: ['localEndGrid'],
    meterKeys: ['localEnd', 'end'],
    tileSize,
  });
  localStart.y = finite(descriptor.fromElevation, localStart.y);
  localEnd.y = finite(descriptor.toElevation, localEnd.y);
  const horizontalLength = Math.hypot(
    localEnd.x - localStart.x,
    localEnd.z - localStart.z,
  );
  if (horizontalLength <= EPSILON) {
    throw new DungeonSupplementAssemblyError(
      `Supplement ramp ${descriptor.id ?? '(unnamed)'} has no horizontal run.`,
      { code: 'INVALID_SUPPLEMENT_STRUCTURE_RAMP' },
    );
  }
  const width = positive(
    descriptor.widthMeters ?? descriptor.width,
    positive(descriptor.widthTiles, 3) * tileSize,
  );
  const thickness = positive(
    descriptor.thicknessMeters ?? descriptor.thickness,
    DEFAULT_FLOOR_THICKNESS,
  );
  const worldStart = localToWorld(localStart, room.center, room.yaw);
  const worldEnd = localToWorld(localEnd, room.center, room.yaw);
  return {
    descriptor,
    id: stableId('supplementRamp', room.id, descriptor.id),
    surfaceRole: structureMaterialRole(descriptor, 'ramp'),
    localStart,
    localEnd,
    worldStart,
    worldEnd,
    horizontalLength,
    width,
    thickness,
  };
}

function upsertPlatform(fragment, record) {
  const existingIndex = fragment.platforms.findIndex((entry) => entry.id === record.id);
  if (existingIndex >= 0) {
    fragment.platforms[existingIndex] = { ...fragment.platforms[existingIndex], ...record };
  } else {
    fragment.platforms.push(record);
  }
}

function rasterizeStructureRamp(fragment, ramp, room, tileSize) {
  const delta = ramp.localEnd.clone().sub(ramp.localStart);
  const horizontalDirection = new THREE.Vector3(delta.x, 0, delta.z).normalize();
  const lateral = new THREE.Vector3(-horizontalDirection.z, 0, horizontalDirection.x);
  const longitudinalSteps = Math.max(1, Math.round(ramp.horizontalLength / tileSize));
  const laneCount = Math.max(1, Math.round(ramp.width / tileSize));
  const firstLaneOffset = -(laneCount - 1) * 0.5;
  const worldDirection = rotateDirection(horizontalDirection, room.yaw);
  for (let longitudinal = 0; longitudinal <= longitudinalSteps; longitudinal += 1) {
    const t = longitudinal / longitudinalSteps;
    const center = ramp.localStart.clone().lerp(ramp.localEnd, t);
    for (let lane = 0; lane < laneCount; lane += 1) {
      const local = center.clone().addScaledVector(
        lateral,
        (firstLaneOffset + lane) * tileSize,
      );
      const world = localToWorld(local, room.center, room.yaw);
      addFloorTile(fragment, {
        id: stableId('supplementRampTile', ramp.id, longitudinal, lane),
        x: Math.round(world.x / tileSize),
        z: Math.round(world.z / tileSize),
        elevation: world.y,
        baseElevation: world.y,
        type: 'floor',
        surface: 'dungeonSupplementRamp',
        surfaceRole: ramp.surfaceRole,
        ...supplementalNodeOwnerReferences(room),
        operationId: room.operationId,
        rampId: ramp.id,
        rampStartElevation: ramp.worldStart.y,
        rampEndElevation: ramp.worldEnd.y,
        rampDirectionX: worldDirection.x,
        rampDirectionZ: worldDirection.z,
        isRampSurface: true,
        dungeonSupplement: true,
      });
    }
  }
}

function rampOpeningSides(platform, ramps, tileSize) {
  const result = new Set();
  const minimumX = platform.localTop.x - platform.width * 0.5;
  const maximumX = platform.localTop.x + platform.width * 0.5;
  const minimumZ = platform.localTop.z - platform.depth * 0.5;
  const maximumZ = platform.localTop.z + platform.depth * 0.5;
  const margin = tileSize * 0.76;
  for (const ramp of ramps) {
    for (const endpoint of [ramp.localStart, ramp.localEnd]) {
      if (Math.abs(endpoint.y - platform.localTop.y) > 0.1) continue;
      if (endpoint.z >= minimumZ - margin && endpoint.z <= maximumZ + margin) {
        if (Math.abs(endpoint.x - minimumX) <= margin) result.add('west');
        if (Math.abs(endpoint.x - maximumX) <= margin) result.add('east');
      }
      if (endpoint.x >= minimumX - margin && endpoint.x <= maximumX + margin) {
        if (Math.abs(endpoint.z - minimumZ) <= margin) result.add('north');
        if (Math.abs(endpoint.z - maximumZ) <= margin) result.add('south');
      }
    }
  }
  return result;
}

function assembleNodeStructures({
  node,
  room,
  nodeGroup,
  session,
  variant,
  tileSize,
  ledger,
  fragment,
  structuralMode,
  descriptors,
}) {
  // Facade-only assembly never owns physical traversal surfaces. Publishing a
  // platform or vertical-connector descriptor here without its floor/mesh
  // would let downstream navigation count geometry that does not exist. The
  // parent still receives the node's immutable structure contract and may
  // publish realized records only after its own floor/connector validation.
  // Complete assembly remains the single mode in which this function emits
  // both the physical structure and its matching facade records.
  if (structuralMode === 'facadeOnly') return;
  const platforms = descriptors.platforms.map((descriptor) => (
    resolveStructurePlatform(node, room, descriptor, tileSize)
  ));
  const ramps = descriptors.ramps.map((descriptor) => (
    resolveStructureRamp(room, descriptor, tileSize)
  ));
  const platformById = new Map();
  for (const platform of platforms) {
    platformById.set(String(platform.descriptor.id ?? platform.id), platform);
    upsertPlatform(fragment, platform.record);
  }

  if (structuralMode !== 'facadeOnly') {
    for (const platform of platforms) {
      const material = resolveMaterial(
        session,
        platform.surfaceRole,
        variant,
        ledger,
        `structure platform ${platform.descriptor.id ?? platform.id} in ${room.id}`,
      );
      makeMesh({
        parent: nodeGroup,
        geometry: makeGeometry(
          ledger,
          platform.width,
          platform.thickness,
          platform.depth,
        ),
        material,
        name: stableId('supplementStructurePlatform', room.id, platform.descriptor.id),
        position: new THREE.Vector3(
          platform.localTop.x,
          platform.localTop.y - platform.thickness * 0.5,
          platform.localTop.z,
        ),
        userData: {
          dungeonSupplement: true,
          supplementNodeId: room.id,
          supplementPlatformId: platform.id,
          surfaceRole: platform.surfaceRole,
          cameraOcclusionSurface: true,
        },
      });
      rasterizeRectangle(fragment, {
        id: platform.id,
        center: platform.worldTop,
        size: new THREE.Vector3(platform.width, platform.thickness, platform.depth),
        yaw: room.yaw,
        tileSize,
        ...(room.isConnectorJunctionProxy
          ? { connectorId: room.id }
          : { roomId: room.id }),
        surfaceRole: platform.surfaceRole,
        operationId: room.operationId,
      });
    }

    for (const ramp of ramps) {
      const material = resolveMaterial(
        session,
        ramp.surfaceRole,
        variant,
        ledger,
        `structure ramp ${ramp.descriptor.id ?? ramp.id} in ${room.id}`,
      );
      const delta = ramp.localEnd.clone().sub(ramp.localStart);
      const length = delta.length();
      const xAxis = delta.clone().normalize();
      const zAxis = new THREE.Vector3(-delta.z, 0, delta.x).normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
      const orientation = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      const position = ramp.localStart.clone().add(ramp.localEnd).multiplyScalar(0.5)
        .addScaledVector(yAxis, -ramp.thickness * 0.5);
      const mesh = makeMesh({
        parent: nodeGroup,
        geometry: makeGeometry(ledger, length, ramp.thickness, ramp.width),
        material,
        name: stableId('supplementStructureRamp', room.id, ramp.descriptor.id),
        position,
        userData: {
          dungeonSupplement: true,
          supplementNodeId: room.id,
          supplementRampId: ramp.id,
          surfaceRole: ramp.surfaceRole,
          cameraOcclusionSurface: true,
        },
      });
      mesh.quaternion.setFromRotationMatrix(orientation);
      rasterizeStructureRamp(fragment, ramp, room, tileSize);
    }
  }

  for (const ramp of ramps) {
    fragment.verticalConnectors.push({
      ...cloneSerializableRecord(ramp.descriptor),
      id: ramp.id,
      type: 'slope',
      kind: 'structuralRamp',
      connectorFamily: 'slope',
      ...supplementalNodeOwnerReferences(room),
      operationId: room.operationId,
      parentRegionId: room.parentRegionId,
      start: ramp.worldStart.clone(),
      end: ramp.worldEnd.clone(),
      fromElevation: ramp.worldStart.y,
      toElevation: ramp.worldEnd.y,
      elevationDelta: ramp.worldEnd.y - ramp.worldStart.y,
      width: ramp.width,
      widthMeters: ramp.width,
      themeBinding: cloneBinding(room.themeBinding),
      dungeonSupplement: true,
    });
  }

  for (const railDescriptor of descriptors.rails) {
    const platform = platformById.get(String(railDescriptor.platformId ?? ''));
    if (!platform) {
      throw new DungeonSupplementAssemblyError(
        `Supplement rail ${railDescriptor.id ?? '(unnamed)'} references missing platform ${railDescriptor.platformId ?? '(none)'}.`,
        { code: 'INVALID_SUPPLEMENT_STRUCTURE_RAIL' },
      );
    }
    const requestedSides = asArray(railDescriptor.sides).length > 0
      ? asArray(railDescriptor.sides)
      : ['north', 'south', 'east', 'west'];
    const openSides = new Set([
      ...asArray(railDescriptor.openSides),
      ...rampOpeningSides(platform, ramps, tileSize),
    ]);
    const sides = requestedSides.filter((side) => !openSides.has(side));
    platform.record.railSides = [...sides];
    upsertPlatform(fragment, platform.record);
    if (structuralMode === 'facadeOnly') continue;
    const role = structureMaterialRole(railDescriptor, 'rail');
    const material = resolveMaterial(
      session,
      role,
      variant,
      ledger,
      `structure rail ${railDescriptor.id ?? '(unnamed)'} in ${room.id}`,
    );
    const height = positive(railDescriptor.heightMeters ?? railDescriptor.height, 1.1);
    const thickness = positive(railDescriptor.thicknessMeters ?? railDescriptor.thickness, 0.12);
    for (const side of sides) {
      const northOrSouth = side === 'north' || side === 'south';
      const localPosition = new THREE.Vector3(
        northOrSouth
          ? platform.localTop.x
          : platform.localTop.x + (side === 'east' ? 1 : -1) * platform.width * 0.5,
        platform.localTop.y + height * 0.5,
        northOrSouth
          ? platform.localTop.z + (side === 'south' ? 1 : -1) * platform.depth * 0.5
          : platform.localTop.z,
      );
      const width = northOrSouth ? platform.width : thickness;
      const depth = northOrSouth ? thickness : platform.depth;
      makeMesh({
        parent: nodeGroup,
        geometry: makeGeometry(ledger, width, height, depth),
        material,
        name: stableId('supplementStructureRail', room.id, railDescriptor.id, side),
        position: localPosition,
        userData: {
          dungeonSupplement: true,
          supplementNodeId: room.id,
          supplementPlatformId: platform.id,
          supplementRailId: railDescriptor.id,
          railSide: side,
          surfaceRole: role,
          cameraOcclusionSurface: true,
        },
      });
      const worldPosition = localToWorld(localPosition, room.center, room.yaw);
      addCollisionZone(fragment, makeZone({
        id: stableId('supplementRailZone', room.id, railDescriptor.id, side),
        label: 'Dungeon supplement safety rail',
        obstacleKind: 'safetyRail',
        position: worldPosition,
        halfWidth: width * 0.5,
        halfDepth: depth * 0.5,
        verticalHalfHeight: height * 0.5,
        rotationY: room.yaw,
        metadata: {
          ...supplementalNodeOwnerReferences(room),
          platformId: platform.id,
          railId: railDescriptor.id,
          railSide: side,
        },
      }));
    }
  }
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
    const absoluteElevation = finite(position.y);
    const existingIndex = fragment.platforms.findIndex((entry) => entry.id === id);
    const existing = existingIndex >= 0 ? fragment.platforms[existingIndex] : null;
    const localTopY = finite(anchor.elevation ?? anchor.localPosition?.y);
    const declaredLocalBaseY = Number(anchor.baseY);
    const absoluteBaseY = Number.isFinite(existing?.baseY)
      ? existing.baseY
      : Number.isFinite(declaredLocalBaseY)
        ? absoluteElevation + declaredLocalBaseY - localTopY
        : absoluteElevation;
    const platform = {
      ...common,
      center: position.clone(),
      halfWidth: positive(anchor.halfWidth, 1),
      halfDepth: positive(anchor.halfDepth, 1),
      // Anchor elevation is grammar-local. Runtime platform metadata is
      // always world-space, matching center.y and the floor facade.
      elevation: absoluteElevation,
      topY: absoluteElevation,
      baseY: absoluteBaseY,
    };
    if (existingIndex >= 0) {
      fragment.platforms[existingIndex] = {
        ...fragment.platforms[existingIndex],
        ...platform,
      };
    } else {
      fragment.platforms.push(platform);
    }
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

function connectorProxyAnchorIsPresentationOnly(anchor = {}) {
  const kind = String(anchor.kind ?? anchor.type ?? anchor.anchorKind ?? '');
  return ![
    'encounter', 'enemyEncounter', 'enemySpawn', 'spawn',
    'reward', 'chest', 'mechanism', 'control', 'terminal',
    'door', 'gate', 'keycard', 'progressionKey', 'progression', 'objective',
    'platform', 'trap', 'hazard', 'environmentalHazard', 'safeInteractable',
  ].includes(kind);
}

function assembleDelegatedProgression(fragment, overlayPlan, nodeById, segmentById, tileSize) {
  for (const assignment of asArray(overlayPlan.progressionAssignments)) {
    const node = nodeById.get(assignment.nodeId);
    if (isSupplementConnectorProxyNode(node)) continue;
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

function createAssembledJunctionContract(node, room, normalizedSockets, tileSize) {
  const source = node.junction ?? node.junctionContract;
  const junctionKind = source?.junctionKind ?? node.junctionKind;
  if (!junctionKind) return null;
  const connectedSocketIds = normalizedSockets
    .filter((socket) => !socket.capped)
    .map((socket) => String(socket.id));
  const activeSocketIds = Array.isArray(source?.activeSocketIds)
    ? [...new Set(source.activeSocketIds.map(String))]
    : connectedSocketIds;
  const generated = createDungeonJunctionGeometryRecord({
    id: source?.id ?? stableId('supplementJunction', room.id),
    nodeId: room.id,
    junctionKind,
    center: room.center,
    elevation: room.center.y,
    heightMeters: source?.clearanceHeightMeters ?? 3.6,
    tileSize,
    throughSocketPairs: source?.throughSocketPairs,
    decisionSocketIds: source?.decisionSocketIds,
    activeSocketIds,
    operationId: room.operationId,
    accessDomainId: node.accessDomainId,
    progressionBandId: node.progressionBandId,
  });
  if (!generated) return null;
  return {
    ...cloneSerializableRecord(source ?? {}),
    ...generated,
    clearCoreVolume: cloneSerializableRecord(source?.clearCoreVolume ?? generated.clearCoreVolume),
    activeSocketIds,
    countsAsMeaningfulStation: source?.countsAsMeaningfulStation
      ?? node.countsAsMeaningfulStation
      ?? generated.countsAsMeaningfulStation,
    parentRegionId: room.parentRegionId,
    themeBinding: cloneBinding(room.themeBinding),
    dungeonSupplement: true,
  };
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
  connectorProxyProgression,
  authoritativeThemePreflight = false,
}) {
  const connectorProxy = isSupplementConnectorProxyNode(node);
  const connectorKind = node.kind === 'supplementConnectorModule'
    ? 'supplementConnectorModule'
    : 'supplementConnectorJunction';
  const id = node.id ?? stableId(
    'supplementNode',
    node.operationId,
    node.ordinal ?? fragment.rooms.length + fragment.connectorJunctionProxies.length,
  );
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
    isConnectorJunctionProxy: connectorProxy,
  };
  const structuralDescriptors = nodeStructuralDescriptors(node);
  const presentationRecords = asArray(node.presentationRecords);
  const selectedPresentationRecords = presentationRecords.filter((record) => (
    record?.presentationOwner === 'supplement-assembler'
      && record?.selectedForRendering === true
  ));
  const delegatedPresentationRecords = presentationRecords.filter((record) => (
    record?.realizationRequired === true
      && record?.realizationOwner !== 'supplement-assembler'
  ));
  const unselectedOptionalPresentationRecords = presentationRecords.filter((record) => (
    record?.realizationRequired === true
      && record?.realizationOwner === 'supplement-assembler'
      && record?.selectedForRendering !== true
  ));
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
    ...(connectorProxy ? {
      kind: connectorKind,
      isDungeonSupplement: false,
      isSupplementConnectorJunction: connectorKind === 'supplementConnectorJunction',
      isSupplementConnectorModule: connectorKind === 'supplementConnectorModule',
      isConnectorJunctionProxy: true,
      suppressRoomGeometry: true,
      stampConnectorJunctionFloor: true,
      countsAsMeaningfulStation: connectorKind === 'supplementConnectorJunction',
      connectorJunctionSockets: asArray(node.sockets).map(cloneSerializableRecord),
      minimumPhysicalArmCount: connectorKind === 'supplementConnectorJunction' ? 3 : 2,
      minimumPhysicalConnectorArms: connectorKind === 'supplementConnectorJunction' ? 3 : 2,
      physicalArmIds: [...(
        connectorProxyProgression?.armIdsByProxyId?.get(String(id)) ?? []
      )].sort(),
    } : {
      isDungeonSupplement: true,
    }),
  };
  if (connectorProxy) {
    facadeRoom.anchors = asArray(node.anchors)
      .filter(connectorProxyAnchorIsPresentationOnly)
      .map(cloneSerializableRecord);
    for (const field of [
      'encounters', 'rewards', 'chests', 'mechanisms', 'doors', 'keycards',
      'progressionAssignments', 'progressionAnchors', 'objectives', 'traps',
    ]) {
      delete facadeRoom[field];
    }
    facadeRoom.physicalArmCount = facadeRoom.physicalArmIds.length;
    fragment.connectorJunctionProxies.push(facadeRoom);
  } else {
    fragment.rooms.push(facadeRoom);
    fragment.minimap.rooms.push(createMinimapRoom(room));
  }

  const nodeGroup = new THREE.Group();
  nodeGroup.name = stableId(
    connectorProxy ? 'DungeonSupplementConnectorJunction' : 'DungeonSupplementRoom',
    id,
  );
  nodeGroup.position.copy(center);
  nodeGroup.rotation.y = yaw;
  nodeGroup.userData.dungeonSupplement = true;
  nodeGroup.userData.supplementNodeId = id;
  nodeGroup.userData.operationId = room.operationId;
  nodeGroup.userData.parentRegionId = room.parentRegionId;
  nodeGroup.userData.themeBinding = cloneBinding(themeBinding);
  nodeGroup.userData.isConnectorJunctionProxy = connectorProxy;
  nodeGroup.userData.suppressRoomGeometry = connectorProxy;
  fragment.root.add(nodeGroup);

  const resolvedSession = resolveThemeSession(
    themeSources,
    themeBinding,
    parentRegionId,
    fallbackSession,
  );
  const session = structuralMode === 'facadeOnly' && !authoritativeThemePreflight
    ? resolvedSession
    : assertThemeSession(resolvedSession, `supplement node ${id}`);
  if (session) {
    const authoritativeMaterialRoles = authoritativeThemePreflight
      ? [
          ...(connectorProxy ? ['corridorFloor'] : ['primaryFloor', 'wall', 'ceiling']),
          ...requiredNodeStructureMaterialRoles(structuralDescriptors),
        ]
      : structuralMode !== 'facadeOnly'
        ? requiredNodeStructureMaterialRoles(structuralDescriptors)
        : [];
    const authoritativeAssetRoles = authoritativeThemePreflight
      ? [
          ...asArray(node.anchors).map((anchor) => (
            anchor.assetRole ?? anchor.presentationAssetRole ?? null
          )),
          ...selectedPresentationRecords.map((record) => (
            record.presentationAssetRole ?? record.themeRole ?? null
          )),
        ].filter(Boolean)
      : [];
    requireCapabilities(session, {
      ...(node.requiredThemeCapabilities ?? {}),
      materialRoles: [
        ...asArray(node.requiredThemeCapabilities?.materialRoles),
        ...asArray(node.requiredThemeCapabilities?.materials),
        ...authoritativeMaterialRoles,
      ],
      assetRoles: [
        ...asArray(node.requiredThemeCapabilities?.assetRoles),
        ...asArray(node.requiredThemeCapabilities?.assets),
        ...authoritativeAssetRoles,
      ],
    }, `supplement node ${id}`);
  }
  const variant = node.presentationVariantId
    ?? themeBinding?.presentationVariantId
    ?? session?.themeBinding?.presentationVariantId;
  const sockets = asArray(node.sockets).map((socket) => (
    normalizeRoomSocket(node, socket, room, tileSize, connectedSocketIds)
  ));
  const junction = createAssembledJunctionContract(node, room, sockets, tileSize);
  if (junction) {
    facadeRoom.junction = junction;
    facadeRoom.junctionKind = junction.junctionKind;
    facadeRoom.countsAsMeaningfulStation = junction.countsAsMeaningfulStation;
    nodeGroup.userData.junctionKind = junction.junctionKind;
    nodeGroup.userData.countsAsMeaningfulStation = junction.countsAsMeaningfulStation;
    fragment.junctions.push(junction);
  }

  if (!connectorProxy && structuralMode !== 'facadeOnly') {
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
        ...(connectorProxy ? { connectorJunctionProxyId: id } : { roomId: id }),
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
      addFactoryProductToGroup(asset, fragment.root, fragment, {
        facadeOnly: structuralMode === 'facadeOnly',
        context: `socket cap factory for ${socket.id}`,
      });
    }
  }

  assembleNodeStructures({
    node,
    room,
    nodeGroup,
    session,
    variant,
    tileSize,
    ledger,
    fragment,
    structuralMode,
    descriptors: structuralDescriptors,
  });

  for (const anchor of asArray(node.anchors).filter((entry) => (
    !connectorProxy || connectorProxyAnchorIsPresentationOnly(entry)
  ))) {
    const anchorKind = anchor.kind ?? anchor.type ?? anchor.anchorKind;
    // A platform anchor is a request for physical traversal geometry, not an
    // independently valid facade witness. In facade-only mode the parent must
    // realize and validate that surface before publishing a platform record.
    if (structuralMode === 'facadeOnly' && anchorKind === 'platform') continue;
    const doorwaySocketLocalId = anchorKind === 'doorway-frame'
      ? String(
        anchor.socketId
          ?? anchor.localSocketId
          ?? anchor.doorwaySocketId
          ?? anchor.localAnchorId
          ?? '',
      ).replace(/-frame$/, '')
      : null;
    const doorwaySocket = doorwaySocketLocalId
      ? sockets.find((socket) => (
        String(socket.id) === doorwaySocketLocalId
          || String(socket.source?.localSocketId ?? '') === doorwaySocketLocalId
      )) ?? null
      : null;
    // Doorway frames are connector dressing. A capped or unbound arm gets the
    // parent-themed cap only; emitting its free-standing pillars produced the
    // disconnected columns seen in augmented layouts.
    if (anchorKind === 'doorway-frame' && (!doorwaySocket || doorwaySocket.capped)) continue;
    const effectiveAnchor = doorwaySocket
      ? {
        ...anchor,
        socketId: doorwaySocket.id,
        width: doorwaySocket.width,
        widthMeters: doorwaySocket.width,
        height: doorwaySocket.height,
        heightMeters: doorwaySocket.height,
        facing: resolveSocketFacing(node, doorwaySocket.source),
      }
      : anchor;
    const anchorPosition = doorwaySocket?.world?.clone?.()
      ?? resolveAnchorWorld(node, effectiveAnchor, tileSize);
    appendAnchorFacade(fragment, facadeRoom, effectiveAnchor, anchorPosition);
    const assetRole = effectiveAnchor.assetRole
      ?? anchor.presentationAssetRole
      ?? (session?.assets?.has?.(anchorKind) ? anchorKind : null);
    if (assetRole && session) {
      const product = invokeAsset(session, assetRole, {
        ...cloneSerializableRecord(effectiveAnchor),
        id: effectiveAnchor.id ?? stableId(id, assetRole),
        nodeId: id,
        position: anchorPosition.clone(),
        themeBinding: cloneBinding(themeBinding),
        variant,
      }, ledger, `anchor ${effectiveAnchor.id ?? assetRole} in ${id}`);
      addFactoryProductToGroup(product, fragment.root, fragment, {
        facadeOnly: structuralMode === 'facadeOnly',
        context: `anchor factory for ${effectiveAnchor.id ?? assetRole}`,
      });
    }
  }
  for (const presentationRecord of delegatedPresentationRecords) {
    if (fragment.presentationRealizations.some(({ presentationRecordId }) => (
      String(presentationRecordId) === String(presentationRecord.id)
    ))) {
      throw new DungeonSupplementAssemblyError(
        `Presentation record ${presentationRecord.id} was realized more than once.`,
        { code: 'DUPLICATE_PRESENTATION_REALIZATION' },
      );
    }
    const [ownerBindingId] = asArray(presentationRecord.ownerBindingIds).map(String);
    fragment.presentationRealizations.push({
      id: `${presentationRecord.id}:realization`,
      presentationRecordId: String(presentationRecord.id),
      sourceFeatureId: String(presentationRecord.sourceFeatureId),
      sourceFeatureRuntimeId: String(presentationRecord.sourceFeatureRuntimeId),
      nodeId: id,
      operationId: presentationRecord.operationId ?? node.operationId ?? null,
      semanticRole: presentationRecord.semanticRole,
      assetRole: null,
      realizationOwner: presentationRecord.realizationOwner,
      realizationKind: presentationRecord.realizationKind,
      realizationDisposition: 'delegated-to-owner',
      ownerBindingId,
      ownerBindingIds: [ownerBindingId],
      runtimeActivation: presentationRecord.runtimeActivation,
      runtimeConsumerBindingIds: asArray(presentationRecord.runtimeConsumerBindingIds).map(String),
      renderedBySupplementAssembler: false,
      rendererObjectId: null,
      rootObjectCount: 0,
      meshCount: 0,
      drawCallCount: 0,
      collisionRecordIds: [...asArray(presentationRecord.collisionRecordIds)].map(String),
      required: presentationRecord.required === true,
      optional: presentationRecord.optional === true,
      nonblocking: presentationRecord.nonblocking === true,
      authoritative: true,
    });
  }
  for (const presentationRecord of unselectedOptionalPresentationRecords) {
    if (fragment.presentationRealizations.some(({ presentationRecordId }) => (
      String(presentationRecordId) === String(presentationRecord.id)
    ))) {
      throw new DungeonSupplementAssemblyError(
        `Presentation record ${presentationRecord.id} was realized more than once.`,
        { code: 'DUPLICATE_PRESENTATION_REALIZATION' },
      );
    }
    fragment.presentationRealizations.push({
      id: `${presentationRecord.id}:realization`,
      presentationRecordId: String(presentationRecord.id),
      sourceFeatureId: String(presentationRecord.sourceFeatureId),
      sourceFeatureRuntimeId: String(presentationRecord.sourceFeatureRuntimeId),
      nodeId: id,
      operationId: presentationRecord.operationId ?? node.operationId ?? null,
      semanticRole: presentationRecord.semanticRole,
      assetRole: presentationRecord.presentationAssetRole
        ?? presentationRecord.themeRole
        ?? null,
      realizationOwner: presentationRecord.realizationOwner,
      realizationKind: presentationRecord.realizationKind,
      realizationDisposition: 'optional-not-selected',
      ownerBindingId: null,
      ownerBindingIds: [],
      runtimeActivation: presentationRecord.runtimeActivation,
      runtimeConsumerBindingIds: asArray(presentationRecord.runtimeConsumerBindingIds).map(String),
      renderedBySupplementAssembler: false,
      rendererObjectId: null,
      rootObjectCount: 0,
      meshCount: 0,
      drawCallCount: 0,
      collisionRecordIds: [...asArray(presentationRecord.collisionRecordIds)].map(String),
      required: presentationRecord.required === true,
      optional: presentationRecord.optional === true,
      nonblocking: presentationRecord.nonblocking === true,
      authoritative: true,
    });
  }
  for (const presentationRecord of selectedPresentationRecords) {
    const assetRole = presentationRecord.presentationAssetRole
      ?? presentationRecord.themeRole
      ?? null;
    if (!assetRole) {
      throw new DungeonSupplementAssemblyError(
        `Selected presentation record ${presentationRecord.id ?? '(unnamed)'} has no theme asset role.`,
        { code: 'MISSING_PRESENTATION_THEME_ROLE' },
      );
    }
    const presentationSession = assertThemeSession(
      session,
      `presentation record ${presentationRecord.id ?? '(unnamed)'}`,
    );
    const specification = createPresentationAssetSpecification({
      record: presentationRecord,
      nodeId: id,
      themeBinding,
      variant,
    });
    const product = invokeAsset(
      presentationSession,
      assetRole,
      specification,
      ledger,
      `presentation record ${presentationRecord.id} in ${id}`,
    );
    const objectRoots = [...presentationFactoryObjectRoots(product)];
    if (objectRoots.length !== 1) {
      throw new DungeonSupplementAssemblyError(
        `Presentation record ${presentationRecord.id} must produce exactly one attachable root; received ${objectRoots.length}.`,
        { code: 'INVALID_PRESENTATION_REALIZATION_ROOT_COUNT' },
      );
    }
    if (fragment.presentationRealizations.some(({ presentationRecordId }) => (
      String(presentationRecordId) === String(presentationRecord.id)
    ))) {
      throw new DungeonSupplementAssemblyError(
        `Presentation record ${presentationRecord.id} was realized more than once.`,
        { code: 'DUPLICATE_PRESENTATION_REALIZATION' },
      );
    }
    const [objectRoot] = objectRoots;
    objectRoot.userData.dungeonSupplementPresentation = true;
    objectRoot.userData.presentationRecordId = String(presentationRecord.id);
    objectRoot.userData.sourceFeatureId = String(presentationRecord.sourceFeatureId);
    objectRoot.userData.sourceFeatureRuntimeId = String(
      presentationRecord.sourceFeatureRuntimeId,
    );
    objectRoot.userData.presentationSemanticRole = presentationRecord.semanticRole;
    objectRoot.userData.presentationAssetRole = assetRole;
    let meshCount = 0;
    let drawCallCount = 0;
    objectRoot.traverse((object) => {
      if (!object.isMesh) return;
      meshCount += 1;
      drawCallCount += Array.isArray(object.material) ? object.material.length : 1;
    });
    // The theme factory receives the one authoritative world transform and
    // positions its returned root. The assembler only attaches that root once.
    addFactoryProductToGroup(product, fragment.root, fragment, {
      facadeOnly: structuralMode === 'facadeOnly',
      context: `presentation factory for ${presentationRecord.id}`,
    });
    fragment.presentationRealizations.push({
      id: `${presentationRecord.id}:realization`,
      presentationRecordId: String(presentationRecord.id),
      sourceFeatureId: String(presentationRecord.sourceFeatureId),
      sourceFeatureRuntimeId: String(presentationRecord.sourceFeatureRuntimeId),
      nodeId: id,
      operationId: presentationRecord.operationId ?? node.operationId ?? null,
      semanticRole: presentationRecord.semanticRole,
      assetRole,
      realizationOwner: presentationRecord.realizationOwner,
      realizationKind: presentationRecord.realizationKind,
      realizationDisposition: 'rendered',
      ownerBindingId: null,
      ownerBindingIds: [],
      runtimeActivation: presentationRecord.runtimeActivation,
      runtimeConsumerBindingIds: asArray(presentationRecord.runtimeConsumerBindingIds).map(String),
      renderedBySupplementAssembler: true,
      rendererObjectId: objectRoot.name || null,
      rootObjectCount: 1,
      meshCount,
      drawCallCount,
      position: specification.position.clone(),
      width: specification.width,
      height: specification.height,
      depth: specification.depth,
      rotationY: specification.rotationY,
      collisionRecordIds: [...asArray(presentationRecord.collisionRecordIds)].map(String),
      required: presentationRecord.required === true,
      optional: presentationRecord.optional === true,
      nonblocking: presentationRecord.nonblocking === true,
      authoritative: true,
    });
  }
  for (const encounter of connectorProxy ? [] : asArray(node.encounters)) {
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
      addFactoryProductToGroup(product, fragment.root, fragment, {
        facadeOnly: structuralMode === 'facadeOnly',
        context: `environment factory ${capability} for ${id}`,
      });
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
  openStart = false,
  openEnd = false,
  sharedThresholdContracts = [],
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
  const startTrim = openStart ? Math.min(width * 0.5, horizontalLength * 0.5) : 0;
  const endTrim = openEnd ? Math.min(width * 0.5, horizontalLength * 0.5) : 0;
  const wallLength = Math.max(0, horizontalLength - startTrim - endTrim);
  const wallCenterX = (startTrim - endTrim) * 0.5;
  for (const [side, z] of [['left', -width * 0.5], ['right', width * 0.5]]) {
    if (wallLength <= EPSILON) continue;
    const wallPosition = new THREE.Vector3(wallCenterX, height * 0.5, z);
    makeMesh({
      parent: group,
      geometry: makeGeometry(ledger, wallLength, height, DEFAULT_WALL_THICKNESS),
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
      halfWidth: wallLength * 0.5,
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
    sharedThresholdContracts,
  });
  return { group, center, yaw, horizontalLength };
}

function appendRouteNetworkRuntimeRecords({
  fragment,
  segment,
  operation,
  connection,
  path,
  tileSize,
  themeBinding,
}) {
  if (operationType(operation) !== 'routeNetwork') return;
  const selectedSocketIds = new Set(asArray(operation.endpointSocketIds).map(String));
  for (const [role, endpoint] of [['from', segment.from], ['to', segment.to]]) {
    const socketId = endpointSocketId(endpoint);
    if (!socketId || !selectedSocketIds.has(String(socketId))) continue;
    fragment.landingClearances.push({
      ...createDungeonSocketLandingOverlapVolume(endpoint, {
        id: stableId('supplementLandingClearance', operation.id, socketId),
        tileSize,
        operationId: operation.id,
        grantId: operation.grantId,
      }),
      endpointRole: role,
      connectionId: connection.id,
      parentRegionId: operation.parentRegionId ?? null,
      themeBinding: cloneBinding(themeBinding),
      dungeonSupplement: true,
    });
  }

  const doorId = segment.doorId
    ?? segment.gateId
    ?? segment.localGate?.doorId
    ?? segment.localGate?.gateId
    ?? segment.localGate?.id
    ?? null;
  const requiresEncounterId = segment.requiresEncounterId
    ?? segment.localGate?.requiresEncounterId
    ?? segment.localGate?.encounterId
    ?? null;
  const requiredKeycardId = segment.requiredKeycardId
    ?? segment.localGate?.requiredKeycardId
    ?? segment.localGate?.credentialId
    ?? null;
  if (doorId || requiresEncounterId || requiredKeycardId) {
    if (segment.gatePlacementSide && segment.gatePlacementSide !== 'source') {
      throw new DungeonSupplementAssemblyError(
        `Route network segment ${connection.id} places its lock away from the source entrance.`,
        { code: 'INVALID_ROUTE_NETWORK_GATE_PLACEMENT' },
      );
    }
    fragment.doors.push({
      id: String(doorId ?? stableId('supplementEncounterGate', connection.id)),
      doorId: doorId == null ? null : String(doorId),
      gateId: doorId == null ? null : String(doorId),
      roomId: connection.fromNodeId,
      sourceRoomId: connection.fromNodeId,
      connectionId: connection.id,
      position: path[0].clone(),
      gatePlacementSide: 'source',
      requiresEncounterId: requiresEncounterId == null ? null : String(requiresEncounterId),
      requiredKeycardId: requiredKeycardId == null ? null : String(requiredKeycardId),
      credentialRequirement: requiredKeycardId == null ? null : String(requiredKeycardId),
      operationId: operation.id,
      accessDomainId: operation.accessDomainId ?? null,
      progressionBandId: operation.progressionBandId ?? null,
      themeBinding: cloneBinding(themeBinding),
      dungeonSupplement: true,
    });
  }

  const shortcutMode = segment.shortcutMode
    ?? segment.shortcut?.kind
    ?? segment.traversal?.shortcutMode
    ?? (['shortcut-lift', 'drop-ladder'].includes(String(segment.connectorFamily))
      ? String(segment.connectorFamily)
      : null);
  if (!shortcutMode) return;
  const stateId = segment.shortcutStateId
    ?? segment.shortcut?.stateId
    ?? segment.stableRuntimeStateId
    ?? segment.traversal?.stateId
    ?? stableId('supplementShortcutState', operation.id, connection.id);
  const mechanismId = segment.shortcutMechanismId
    ?? stableId('supplementShortcutMechanism', operation.id, connection.id);
  const shortcutAction = shortcutMode === 'drop-ladder'
    ? 'deploy-ladder'
    : shortcutMode === 'shortcut-lift'
      ? 'unlock-lift'
      : 'unlock-route';
  connection.shortcutMechanismId = mechanismId;
  connection.shortcutStateId = String(stateId);
  connection.runtimeStateIds = [String(stateId)];
  fragment.mechanisms.push({
    id: mechanismId,
    mechanismId,
    stateId,
    shortcutStateId: String(stateId),
    runtimeStateIds: [String(stateId)],
    type: 'dungeonSupplementShortcut',
    label: shortcutMode === 'drop-ladder' ? 'Deploy shortcut ladder' : 'Enable shortcut route',
    shortcutMode,
    shortcutAction,
    scopedAction: 'unlockShortcut',
    connectionId: connection.id,
    targetConnectionId: connection.id,
    roomId: connection.toNodeId,
    position: path.at(-1).clone(),
    initialState: segment.shortcut?.initialState
      ?? (shortcutMode === 'shortcut-lift' ? 'unavailable' : 'retracted'),
    activatedState: segment.shortcut?.activatedState
      ?? (shortcutMode === 'shortcut-lift' ? 'available' : 'deployed'),
    activationSide: segment.shortcut?.activationSide ?? 'far-side',
    oneSideActivated: true,
    permanentOnActivation: segment.shortcut?.persistent !== false,
    action: {
      type: 'activateDungeonSupplementShortcut',
      scope: 'connection',
      connectionId: connection.id,
      stateId,
    },
    operationId: operation.id,
    parentRegionId: operation.parentRegionId ?? null,
    themeBinding: cloneBinding(themeBinding),
    dungeonSupplement: true,
  });
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
  connectorProxyProgression,
  authoritativeThemePreflight = false,
}) {
  const id = segment.id ?? stableId('supplementSegment', segment.operationId, fragment.connectionPlans.length);
  const operation = operationById.get(segment.operationId) ?? null;
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
  const resolvedSession = resolveThemeSession(
    themeSources,
    themeBinding,
    parentRegionId,
    fallbackSession,
  );
  const session = structuralMode === 'facadeOnly' && !authoritativeThemePreflight
    ? resolvedSession
    : assertThemeSession(resolvedSession, `supplement segment ${id}`);
  if (session) {
    requireCapabilities(session, {
      ...(segment.requiredThemeCapabilities ?? {}),
      materialRoles: [
        ...asArray(segment.requiredThemeCapabilities?.materialRoles),
        ...asArray(segment.requiredThemeCapabilities?.materials),
        ...(authoritativeThemePreflight
          ? [family === 'slope' ? 'ramp' : 'corridorFloor', 'wall', 'ceiling']
          : []),
      ],
      connectorFamilies: [
        ...asArray(segment.requiredThemeCapabilities?.connectorFamilies),
        ...asArray(segment.requiredThemeCapabilities?.connectors),
        ...(structuralMode === 'facadeOnly' && !authoritativeThemePreflight ? [] : [family]),
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

  const fromNodeId = segment.from?.nodeId ?? segment.fromNodeId ?? null;
  const toNodeId = segment.to?.nodeId ?? segment.toNodeId ?? null;
  const thresholdContract = (role, roomId, center, adjacent, endpoint) => {
    if (!roomId || !center || !adjacent) return null;
    const direction = adjacent.clone().sub(center);
    direction.y = 0;
    if (direction.lengthSq() <= EPSILON) return null;
    direction.normalize();
    return {
      id: stableId('supplementSharedThreshold', id, role, endpointSocketId(endpoint) ?? roomId),
      roomId,
      connectorId: id,
      center,
      direction,
      width: positive(endpoint?.widthMeters ?? endpoint?.landingWidth, width),
    };
  };
  const fromThreshold = thresholdContract(
    'from',
    fromNodeId,
    path[0],
    path[1],
    segment.from,
  );
  const toThreshold = thresholdContract(
    'to',
    toNodeId,
    path.at(-1),
    path.at(-2),
    segment.to,
  );

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
          openStart: index > 1,
          openEnd: index < path.length - 1,
          sharedThresholdContracts: [
            ...(index === 1 && fromThreshold ? [fromThreshold] : []),
            ...(index === path.length - 1 && toThreshold ? [toThreshold] : []),
          ],
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

  const progressionEndpoints = resolveConnectorProxyProgressionEndpoints(
    fromNodeId,
    toNodeId,
    connectorProxyProgression?.candidatesByProxyId ?? new Map(),
    connectorProxyProgression?.collapseRoomIdBySegmentId?.get(String(id)) ?? null,
  );
  const parentAnchoredComponent = asArray(operation?.parentAnchoredComponents).find((component) => (
    asArray(component?.segmentIds).some((segmentId) => String(segmentId) === String(id))
  ));
  const connection = {
    ...cloneSerializableRecord(segment),
    id,
    connectorId: id,
    connectorFamily: family,
    from: fromNodeId ?? segment.from,
    to: toNodeId ?? segment.to,
    fromNodeId,
    toNodeId,
    progressionFromRoomId: progressionEndpoints.fromProgressionRoomId,
    progressionToRoomId: progressionEndpoints.toProgressionRoomId,
    progressionCollapsedSelfEdge: progressionEndpoints.selfEdge,
    routeNetworkProgressionProjectionMode:
      progressionEndpoints.physicalOnlyParentAnchoredComponent
        ? 'parent-anchored-component-physical-only'
        : null,
    connectorJunctionProxyIds: [
      progressionEndpoints.fromProxyId,
      progressionEndpoints.toProxyId,
    ].filter(Boolean),
    fromSocket: {
      ...cloneSerializableRecord(segment.from ?? {}),
      roomId: fromNodeId,
      progressionRoomId: progressionEndpoints.fromProgressionRoomId,
      ...(progressionEndpoints.fromProxyId ? {
        connectorJunctionProxyId: progressionEndpoints.fromProxyId,
      } : {}),
    },
    toSocket: {
      ...cloneSerializableRecord(segment.to ?? {}),
      roomId: toNodeId,
      progressionRoomId: progressionEndpoints.toProgressionRoomId,
      ...(progressionEndpoints.toProxyId ? {
        connectorJunctionProxyId: progressionEndpoints.toProxyId,
      } : {}),
    },
    fromSocketId: endpointSocketId(segment.from),
    toSocketId: endpointSocketId(segment.to),
    exactEndpointSocketIds: operationType(operation) === 'routeNetwork'
      ? [endpointSocketId(segment.from), endpointSocketId(segment.to)].filter(Boolean)
      : [],
    logicalEdgeId: segment.logicalEdgeId ?? segment.originalEdgeId ?? null,
    physicalOrdinal: segment.physicalOrdinal ?? 0,
    path: path.map((point) => point.clone()),
    themeBinding: cloneBinding(themeBinding),
    routeNetworkGrantId: operation?.grantId ?? null,
    routeNetworkKind: operation?.routeNetworkKind ?? null,
    routeNetworkRealizationMode: operation?.realizationMode ?? null,
    routeNetworkLocalProgressionArcRealized:
      operation?.localProgressionArcRealized ?? null,
    parentAnchoredDeclaredComponentIds: asArray(operation?.parentAnchoredComponents)
      .map(({ id: componentId }) => String(componentId)),
    parentAnchoredComponentId: parentAnchoredComponent?.id ?? null,
    parentAnchoredAttachmentSocketId: parentAnchoredComponent?.attachmentSocketId ?? null,
    parentAnchoredAttachmentSocketIds: asArray(
      parentAnchoredComponent?.attachmentSocketIds,
    ).map(String),
    parentAnchoredDeclaredNodeIds: asArray(parentAnchoredComponent?.nodeIds).map(String),
    parentAnchoredDeclaredSegmentIds: asArray(parentAnchoredComponent?.segmentIds).map(String),
    topologyTemplateId: operation?.topologyTemplateId ?? null,
    elevationModes: asArray(operation?.elevationModes).map(String),
    accessDomainId: operation?.accessDomainId ?? null,
    progressionBandId: operation?.progressionBandId ?? null,
    stableRuntimeStateIds: asArray(operation?.stableRuntimeStateIds).map((entry) => (
      typeof entry === 'object' ? cloneSerializableRecord(entry) : entry
    )),
    dungeonSupplement: true,
  };
  fragment.connectionPlans.push(connection);
  appendRouteNetworkRuntimeRecords({
    fragment,
    segment,
    operation,
    connection,
    path,
    tileSize,
    themeBinding,
  });
  const minimapConnection = {
    id,
    from: progressionEndpoints.fromProgressionRoomId,
    to: progressionEndpoints.toProgressionRoomId,
    fromRoomId: progressionEndpoints.fromProgressionRoomId,
    toRoomId: progressionEndpoints.toProgressionRoomId,
    path: path.map((point) => ({ x: point.x / tileSize, z: point.z / tileSize, elevation: point.y })),
    logicalEdgeId: connection.logicalEdgeId,
    routeNetworkGrantId: operation?.grantId ?? null,
    routeNetworkKind: operation?.routeNetworkKind ?? null,
    routeNetworkRealizationMode: operation?.realizationMode ?? null,
    routeNetworkLocalProgressionArcRealized:
      operation?.localProgressionArcRealized ?? null,
    routeNetworkProgressionProjectionMode:
      progressionEndpoints.physicalOnlyParentAnchoredComponent
        ? 'parent-anchored-component-physical-only'
        : null,
    parentAnchoredDeclaredComponentIds: asArray(operation?.parentAnchoredComponents)
      .map(({ id: componentId }) => String(componentId)),
    parentAnchoredComponentId: parentAnchoredComponent?.id ?? null,
    parentAnchoredAttachmentSocketId: parentAnchoredComponent?.attachmentSocketId ?? null,
    parentAnchoredAttachmentSocketIds: asArray(
      parentAnchoredComponent?.attachmentSocketIds,
    ).map(String),
    parentAnchoredDeclaredNodeIds: asArray(parentAnchoredComponent?.nodeIds).map(String),
    parentAnchoredDeclaredSegmentIds: asArray(parentAnchoredComponent?.segmentIds).map(String),
    topologyTemplateId: operation?.topologyTemplateId ?? null,
    accessDomainId: operation?.accessDomainId ?? null,
    progressionBandId: operation?.progressionBandId ?? null,
    dungeonSupplement: true,
  };
  if (!progressionEndpoints.selfEdge) {
    fragment.minimap.hallways.push(minimapConnection);
    fragment.minimap.connections.push({
      ...minimapConnection,
      path: minimapConnection.path.map((point) => ({ ...point })),
    });
  }
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
  authoritativeThemePreflight = false,
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
  const resolvedSourceSession = resolveThemeSession(
    themeSources,
    sourceBinding,
    sourceBinding?.parentRegionId,
    fallbackSession,
  );
  const resolvedDestinationSession = resolveThemeSession(
    themeSources,
    destinationBinding,
    destinationBinding?.parentRegionId,
    fallbackSession,
  );
  const sourceSession = structuralMode === 'facadeOnly' && !authoritativeThemePreflight
    ? resolvedSourceSession
    : assertThemeSession(resolvedSourceSession, `source side of transition bay ${id}`);
  const destinationSession = structuralMode === 'facadeOnly' && !authoritativeThemePreflight
    ? resolvedDestinationSession
    : assertThemeSession(resolvedDestinationSession, `destination side of transition bay ${id}`);
  const transitionRequirements = structuralMode === 'facadeOnly' && !authoritativeThemePreflight
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
        { facadeOnly: true, context: `${side} facade transition frame for ${id}` },
      );
      addFactoryProductToGroup(
        invokeConnectorSkin(session, 'transitionBay', contract, ledger, `${side} facade skin of transition bay ${id}`),
        group,
        fragment,
        { facadeOnly: true, context: `${side} facade transition skin for ${id}` },
      );
      addFactoryProductToGroup(
        invokeTransition(session, 'levelTransitionBay', contract, ledger, `${side} facade transition provider of ${id}`),
        group,
        fragment,
        { facadeOnly: true, context: `${side} facade transition provider for ${id}` },
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
  delete fragment._floorTileByKey;
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
  fragment.root.userData.supplementalRoomIds = fragment.rooms.map(({ id }) => id).sort();
  fragment.root.userData.connectorJunctionProxyIds = fragment.connectorJunctionProxies
    .map(({ id }) => id)
    .sort();
  fragment.root.userData.presentationRecordIds = fragment.presentationRealizations
    .map(({ presentationRecordId }) => presentationRecordId)
    .sort();
  fragment.root.updateMatrixWorld(true);
  fragment.diagnostics.assembled = {
    ...elementCounts,
    roomCount: fragment.rooms.length,
    connectorJunctionProxyCount: fragment.connectorJunctionProxies.length,
    floorTileCount: fragment.floorTiles.length,
    solidZoneCount: fragment.solidZones.length,
    aerialBoundaryZoneCount: fragment.aerialBoundaryZones.length,
    encounterCount: fragment.encounters.length,
    junctionCount: fragment.junctions.length,
    landingClearanceCount: fragment.landingClearances.length,
    presentationRealizationCount: fragment.presentationRealizations.length,
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
  fragment._floorTileByKey = new Map();
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
  let connectorProxyProgression = null;
  const authoritativeThemePreflight = requiresAuthoritativeThemePreflight(overlayPlan);

  try {
    validateRouteNetworkSocketBindings(elements, overlayPlan);
    validatePresentationRecords(elements, overlayPlan);
    const connectorOnlyParentAnchoredProjection =
      inspectConnectorOnlyParentAnchoredProjection({
        overlayPlan,
        nodes: elements.nodes,
        segments: elements.segments,
        isConnectorNode: isSupplementConnectorProxyNode,
      });
    connectorProxyProgression = createConnectorProxyProgressionCandidates(
      elements,
      connectorOnlyParentAnchoredProjection,
    );
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
        connectorProxyProgression,
        authoritativeThemePreflight,
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
        connectorProxyProgression,
        authoritativeThemePreflight,
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
        authoritativeThemePreflight,
      });
    }
    validatePresentationRealizationCoverage(elements, fragment);
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
