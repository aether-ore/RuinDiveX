import {
  DUNGEON_THEME_MATERIAL_ROLES,
  DUNGEON_THEME_RESOURCE_OWNERSHIP,
  DungeonThemeCapabilityError,
  assertDungeonThemeSession,
  createDungeonThemeCapabilityManifest,
  createDungeonThemeResourceLedger,
  createDungeonThemeResourceReference,
  createDungeonThemeSession,
  normalizeDungeonThemeAssetRole,
  normalizeDungeonThemeConnectorFamily,
  normalizeDungeonThemeMaterialRole,
  normalizeDungeonThemeTransitionType,
} from './ThemeSession.js';

export const INDUSTRIAL_THEME_MATERIAL_ROLE_MAP = Object.freeze({
  primaryFloor: 'floor',
  corridorFloor: 'hallway',
  wall: 'wall',
  ceiling: 'ceiling',
  ramp: 'industrialRamp',
  catwalk: 'catwalkFloor',
  support: 'supportMetal',
  rail: 'factoryRail',
  door: 'door',
  lockedDoor: 'lockedDoor',
  cap: 'wallTrim',
  terminal: 'terminal',
  warning: 'hazardStripe',
  emissiveAccent: 'glowBlue',
});

export const MAGMA_THEME_MATERIAL_ROLE_MAP = Object.freeze({
  primaryFloor: 'ceramic',
  corridorFloor: 'serviceGrate',
  wall: 'basalt',
  ceiling: 'ashStone',
  ramp: 'ceramic',
  catwalk: 'serviceGrate',
  support: 'blackMetal',
  rail: 'rails',
  door: 'bronze',
  lockedDoor: 'bronze',
  cap: 'basalt',
  terminal: 'ceramic',
  warning: 'magma',
  emissiveAccent: 'magma',
});

const DEFAULT_ADAPTER_REQUIREMENTS = Object.freeze({
  materials: DUNGEON_THEME_MATERIAL_ROLES,
});

function entries(value) {
  if (value instanceof Map) return [...value.entries()];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value);
}

function hasCollectionValue(collection, key) {
  if (collection instanceof Map) return collection.has(key) && collection.get(key) != null;
  return collection != null && Object.hasOwn(collection, key) && collection[key] != null;
}

function getCollectionValue(collection, key) {
  return collection instanceof Map ? collection.get(key) : collection?.[key];
}

function normalizeFactoryMap({
  factories = {},
  factory = null,
  advertisedCapabilities = [],
  normalize,
}) {
  const result = {};
  for (const [name, provider] of entries(factories)) {
    if (provider == null) continue;
    result[normalize(name)] = provider;
  }
  if (typeof factory === 'function') {
    for (const rawName of advertisedCapabilities) {
      const name = normalize(rawName);
      if (!name || result[name]) continue;
      result[name] = (specification, context) => factory(name, specification, context);
    }
  }
  return result;
}

function normalizeResolverMap(...resolverMaps) {
  const result = {};
  for (const resolverMap of resolverMaps) {
    for (const [role, resolver] of entries(resolverMap)) {
      if (typeof resolver !== 'function' && resolver == null) continue;
      result[normalizeDungeonThemeMaterialRole(role)] = resolver;
    }
  }
  return result;
}

function normalizeRoleMap(roleMap) {
  const result = {};
  for (const [role, source] of entries(roleMap)) {
    const normalizedRole = normalizeDungeonThemeMaterialRole(role);
    if (normalizedRole && source != null) result[normalizedRole] = source;
  }
  return result;
}

function materialKeyForVariant(source, variant) {
  if (typeof source === 'string') return source;
  if (!source || typeof source !== 'object') return null;
  if (typeof source.key === 'string') return source.key;
  const variants = source.variants && typeof source.variants === 'object'
    ? source.variants
    : source;
  if (variant != null && typeof variants[variant] === 'string') return variants[variant];
  return typeof variants.default === 'string' ? variants.default : null;
}

function possibleMaterialKeys(source) {
  if (typeof source === 'string') return [source];
  if (!source || typeof source !== 'object') return [];
  if (typeof source.key === 'string') return [source.key];
  const variants = source.variants && typeof source.variants === 'object'
    ? source.variants
    : source;
  return [...new Set(Object.values(variants).filter((value) => typeof value === 'string'))];
}

function canResolveMappedMaterial(source, availableKeys) {
  if (typeof source === 'function') return true;
  const keys = possibleMaterialKeys(source);
  return keys.length > 0 && keys.every((key) => availableKeys.has(key));
}

function createMappedMaterialProviders({
  roleMap,
  resolvers,
  availableKeys,
  getCollection,
  collectionOwnership,
}) {
  const providers = {};
  for (const role of new Set([...Object.keys(roleMap), ...Object.keys(resolvers)])) {
    if (resolvers[role] != null) {
      providers[role] = resolvers[role];
      continue;
    }
    const source = roleMap[role];
    if (!canResolveMappedMaterial(source, availableKeys)) continue;
    providers[role] = (variant, context) => {
      const collectionState = getCollection(context);
      if (typeof source === 'function') {
        const value = source({
          role,
          variant,
          materials: collectionState.collection,
          context,
        });
        if (value?.ownership) return value;
        return createDungeonThemeResourceReference(value, collectionState.ownership);
      }
      const key = materialKeyForVariant(source, variant);
      const value = getCollectionValue(collectionState.collection, key);
      if (value == null) {
        throw new DungeonThemeCapabilityError(
          `Theme material source ${key ?? '(none)'} is unavailable for role ${role}.`,
          {
            code: 'theme-material-source-missing',
            capabilityType: 'material',
            capability: role,
          },
        );
      }
      return createDungeonThemeResourceReference(value, collectionState.ownership);
    };
  }
  return providers;
}

function createCapabilityManifest({
  materialProviders,
  assetProviders,
  connectorSkinProviders,
  transitionProviders,
}) {
  return createDungeonThemeCapabilityManifest({
    materials: Object.keys(materialProviders),
    assets: Object.keys(assetProviders),
    connectors: Object.keys(connectorSkinProviders),
    transitions: Object.keys(transitionProviders),
  });
}

function availableCollectionKeys(collection) {
  if (collection instanceof Map) return new Set(collection.keys());
  return new Set(Object.keys(collection ?? {}));
}

function createAdapterProviders({
  materials,
  getMaterials,
  availableMaterialKeys = [],
  roleMap,
  materialResolvers,
  materialLoaders,
  materialFactories,
  collectionOwnership,
  assetFactories,
  assetFactory,
  assetRoles,
  connectorSkinFactories,
  connectorSkinFactory,
  connectorFamilies,
  transitionFactories,
  transitionFactory,
  transitionTypes,
}) {
  const normalizedRoleMap = normalizeRoleMap(roleMap);
  const resolvers = normalizeResolverMap(
    materialLoaders,
    materialFactories,
    materialResolvers,
  );
  const knownKeys = new Set([
    ...availableCollectionKeys(materials),
    ...availableMaterialKeys,
  ]);
  const getCollection = typeof getMaterials === 'function'
    ? getMaterials
    : () => ({ collection: materials, ownership: collectionOwnership });
  const materialProviders = createMappedMaterialProviders({
    roleMap: normalizedRoleMap,
    resolvers,
    availableKeys: knownKeys,
    getCollection,
    collectionOwnership,
  });
  const normalizedAssetProviders = normalizeFactoryMap({
    factories: assetFactories,
    factory: assetFactory,
    advertisedCapabilities: assetRoles,
    normalize: normalizeDungeonThemeAssetRole,
  });
  const normalizedConnectorProviders = normalizeFactoryMap({
    factories: connectorSkinFactories,
    factory: connectorSkinFactory,
    advertisedCapabilities: connectorFamilies,
    normalize: normalizeDungeonThemeConnectorFamily,
  });
  const normalizedTransitionProviders = normalizeFactoryMap({
    factories: transitionFactories,
    factory: transitionFactory,
    advertisedCapabilities: transitionTypes,
    normalize: normalizeDungeonThemeTransitionType,
  });
  return {
    materialProviders,
    assetProviders: normalizedAssetProviders,
    connectorSkinProviders: normalizedConnectorProviders,
    transitionProviders: normalizedTransitionProviders,
  };
}

function prepareIndustrialAdapter(options = {}) {
  const {
    materials,
    materialRoleMap = INDUSTRIAL_THEME_MATERIAL_ROLE_MAP,
    materialResolvers = {},
    materialLoaders = {},
    materialFactories = {},
    availableMaterialKeys = [],
    assetFactories = {},
    assetFactory = null,
    assetRoles = [],
    connectorSkinFactories = {},
    connectorSkinFactory = null,
    connectorFamilies = [],
    transitionFactories = {},
    transitionFactory = null,
    transitionTypes = [],
  } = options;
  const providers = createAdapterProviders({
    materials,
    availableMaterialKeys,
    roleMap: materialRoleMap,
    materialResolvers,
    materialLoaders,
    materialFactories,
    collectionOwnership: DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED,
    assetFactories,
    assetFactory,
    assetRoles,
    connectorSkinFactories,
    connectorSkinFactory,
    connectorFamilies,
    transitionFactories,
    transitionFactory,
    transitionTypes,
  });
  return {
    providers,
    capabilities: createCapabilityManifest(providers),
  };
}

/**
 * Returns Industrial's capabilities without resolving a material or invoking a
 * loader/factory. Existing `_createMaterials()` values are inspected by key.
 */
export function createIndustrialThemeCapabilityManifest(options = {}) {
  return prepareIndustrialAdapter(options).capabilities;
}

/**
 * Wraps Industrial V1's already-created material cache and parent factories.
 * It intentionally imports neither Three.js nor Industrial texture paths.
 */
export function createIndustrialThemeAdapter({
  themeBinding,
  environment = {},
  resources = createDungeonThemeResourceLedger(),
  requiredCapabilities = DEFAULT_ADAPTER_REQUIREMENTS,
  ...options
} = {}) {
  const { providers } = prepareIndustrialAdapter(options);
  const session = createDungeonThemeSession({
    id: `industrial-theme:${themeBinding?.parentRegionId ?? 'unknown-region'}`,
    themeBinding,
    ...providers,
    environment,
    resources,
  });
  return requiredCapabilities
    ? assertDungeonThemeSession(session, requiredCapabilities)
    : session;
}

export const createIndustrialDungeonThemeSession = createIndustrialThemeAdapter;

function magmaTextureContractErrors(textureContract, requiredSetKeys = []) {
  const errors = [];
  if (!textureContract || typeof textureContract !== 'object') {
    return ['missing-magma-texture-contract'];
  }
  if (typeof textureContract.root !== 'string' || textureContract.root.trim() === '') {
    errors.push('missing-magma-texture-root');
  }
  if (!Number.isFinite(textureContract.metersPerRepeat)
    || textureContract.metersPerRepeat <= 0) {
    errors.push('invalid-magma-texture-repeat-scale');
  }
  if (!textureContract.sets || typeof textureContract.sets !== 'object') {
    errors.push('missing-magma-texture-sets');
  }
  for (const key of requiredSetKeys) {
    if (typeof textureContract.sets?.[key] !== 'string'
      || textureContract.sets[key].trim() === '') {
      errors.push(`missing-magma-texture-set:${key}`);
    }
  }
  return errors;
}

export function validateMagmaTextureContract(textureContract, {
  requiredSetKeys = [],
} = {}) {
  const errors = magmaTextureContractErrors(textureContract, requiredSetKeys);
  return Object.freeze({
    ok: errors.length === 0,
    accepted: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

function normalizeCreatedMaterialCollection(result) {
  if (result?.materials && typeof result.materials === 'object') {
    return {
      collection: result.materials,
      resources: Array.isArray(result.resources) ? result.resources : [],
      ownership: result.ownership ?? DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED,
    };
  }
  return {
    collection: result,
    resources: [],
    ownership: DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED,
  };
}

function trackSharedMaterialFactoryResource(resource, defaultOwnership, ledger) {
  const isReference = resource
    && typeof resource === 'object'
    && Object.hasOwn(resource, 'value')
    && Object.values(DUNGEON_THEME_RESOURCE_OWNERSHIP).includes(resource.ownership);
  const value = isReference ? resource.value : resource;
  const ownership = isReference ? resource.ownership : defaultOwnership;
  const options = {
    label: resource?.label ?? 'magma:shared-material-resource',
    dispose: typeof resource?.dispose === 'function' ? resource.dispose : null,
  };
  if (ownership === DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED) ledger.own(value, options);
  else ledger.borrow(value, options);
}

function prepareMagmaAdapter(options = {}) {
  const {
    textureContract,
    materials = null,
    createSharedMaterials = null,
    materialRoleMap = MAGMA_THEME_MATERIAL_ROLE_MAP,
    materialResolvers = {},
    materialLoaders = {},
    materialFactories = {},
    availableMaterialKeys = [],
    assetFactories = {},
    assetFactory = null,
    assetRoles = [],
    connectorSkinFactories = {},
    connectorSkinFactory = null,
    connectorFamilies = [],
    transitionFactories = {},
    transitionFactory = null,
    transitionTypes = [],
  } = options;
  if (!materials && typeof createSharedMaterials !== 'function') {
    throw new DungeonThemeCapabilityError(
      'Magma theme adapter requires supplied materials or createSharedMaterials().',
      { code: 'missing-magma-material-source' },
    );
  }
  const normalizedRoleMap = normalizeRoleMap(materialRoleMap);
  const requiredSetKeys = [...new Set(Object.values(normalizedRoleMap)
    .flatMap(possibleMaterialKeys))];
  const contractValidation = validateMagmaTextureContract(textureContract, {
    requiredSetKeys,
  });
  if (!contractValidation.ok) {
    throw new DungeonThemeCapabilityError(
      `Magma texture contract rejected: ${contractValidation.errors.join(', ')}`,
      {
        code: 'invalid-magma-texture-contract',
        validation: contractValidation,
      },
    );
  }

  let createdState = null;
  const getCreatedMaterials = (context) => {
    if (materials) {
      return {
        collection: materials,
        ownership: DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED,
      };
    }
    if (createdState) return createdState;
    const result = normalizeCreatedMaterialCollection(
      createSharedMaterials(textureContract, context),
    );
    if (!result.collection || typeof result.collection !== 'object') {
      throw new DungeonThemeCapabilityError(
        'Magma createSharedMaterials() returned no material collection.',
        { code: 'magma-material-factory-returned-empty' },
      );
    }
    for (const resource of result.resources) {
      trackSharedMaterialFactoryResource(resource, result.ownership, context.resources);
    }
    createdState = {
      collection: result.collection,
      ownership: result.ownership,
    };
    return createdState;
  };
  const knownMaterialKeys = materials
    ? [...availableCollectionKeys(materials)]
    : [...new Set([
      ...Object.keys(textureContract.sets),
      ...availableMaterialKeys,
    ])];
  const providers = createAdapterProviders({
    materials,
    getMaterials: getCreatedMaterials,
    availableMaterialKeys: knownMaterialKeys,
    roleMap: normalizedRoleMap,
    materialResolvers,
    materialLoaders,
    materialFactories,
    collectionOwnership: materials
      ? DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED
      : DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED,
    assetFactories,
    assetFactory,
    assetRoles,
    connectorSkinFactories,
    connectorSkinFactory,
    connectorFamilies,
    transitionFactories,
    transitionFactory,
    transitionTypes,
  });
  return {
    providers,
    capabilities: createCapabilityManifest(providers),
  };
}

/**
 * Preflights Magma's explicit texture contract without loading a texture or
 * calling createSharedMaterials().
 */
export function createMagmaThemeCapabilityManifest(options = {}) {
  return prepareMagmaAdapter(options).capabilities;
}

/**
 * Uses only the supplied Magma texture contract/material source. There is no
 * Industrial import, material alias, or neutral presentation fallback.
 */
export function createMagmaThemeAdapter({
  themeBinding,
  environment = {},
  resources = createDungeonThemeResourceLedger(),
  requiredCapabilities = DEFAULT_ADAPTER_REQUIREMENTS,
  ...options
} = {}) {
  const { providers } = prepareMagmaAdapter(options);
  const session = createDungeonThemeSession({
    id: `magma-theme:${themeBinding?.parentRegionId ?? 'unknown-region'}`,
    themeBinding,
    ...providers,
    environment,
    resources,
  });
  return requiredCapabilities
    ? assertDungeonThemeSession(session, requiredCapabilities)
    : session;
}

export const createMagmaDungeonThemeSession = createMagmaThemeAdapter;
