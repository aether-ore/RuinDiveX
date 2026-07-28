import {
  DUNGEON_REGION_THEME_SCHEMA,
  DUNGEON_THEME_CAPABILITIES_SCHEMA,
  createDungeonThemeCapabilities,
  validateDungeonRegionThemeBinding,
} from './contracts.js';

export const DUNGEON_THEME_SESSION_SCHEMA = 'ruindivex-dungeon-theme-session/v1';
export const DUNGEON_THEME_RESOURCE_REFERENCE_SCHEMA =
  'ruindivex-dungeon-theme-resource-reference/v1';

export const DUNGEON_THEME_RESOURCE_OWNERSHIP = Object.freeze({
  BORROWED: 'borrowed',
  OWNED: 'owned',
});

export const DUNGEON_THEME_MATERIAL_ROLES = Object.freeze([
  'primaryFloor',
  'corridorFloor',
  'wall',
  'ceiling',
  'ramp',
  'catwalk',
  'support',
  'rail',
  'door',
  'lockedDoor',
  'cap',
  'terminal',
  'warning',
  'emissiveAccent',
]);

export const DUNGEON_THEME_ASSET_ROLES = Object.freeze([
  'support',
  'arch',
  'frame',
  'prop',
  'decal',
  'control',
  'lightFixture',
  'hazard',
  'cap',
  'transitionFrame',
]);

export const DUNGEON_THEME_CONNECTOR_FAMILIES = Object.freeze([
  'serviceGallery',
  'slope',
  'ladder',
  'lift',
  'trackTrap',
  'transitionBay',
]);

export const DUNGEON_THEME_TRANSITION_TYPES = Object.freeze([
  'levelTransitionBay',
]);

export const DUNGEON_THEME_ENVIRONMENT_CAPABILITIES = Object.freeze([
  'localLights',
  'audioEmitters',
]);

const MATERIAL_ROLE_ALIASES = Object.freeze({
  'primary-floor': 'primaryFloor',
  'corridor-floor': 'corridorFloor',
  'locked-door': 'lockedDoor',
  'emissive-accent': 'emissiveAccent',
});

const ASSET_ROLE_ALIASES = Object.freeze({
  'light-fixture': 'lightFixture',
  'transition-frame': 'transitionFrame',
});

const CONNECTOR_FAMILY_ALIASES = Object.freeze({
  'service-gallery': 'serviceGallery',
  'track-trap': 'trackTrap',
  'transition-bay': 'transitionBay',
});

const TRANSITION_TYPE_ALIASES = Object.freeze({
  'level-transition-bay': 'levelTransitionBay',
});

const ENVIRONMENT_CAPABILITY_ALIASES = Object.freeze({
  'local-lights': 'localLights',
  'audio-emitters': 'audioEmitters',
});

function normalizeCapabilityName(value, aliases) {
  const name = typeof value === 'string' ? value.trim() : '';
  return aliases[name] ?? name;
}

export function normalizeDungeonThemeMaterialRole(value) {
  return normalizeCapabilityName(value, MATERIAL_ROLE_ALIASES);
}

export function normalizeDungeonThemeAssetRole(value) {
  return normalizeCapabilityName(value, ASSET_ROLE_ALIASES);
}

export function normalizeDungeonThemeConnectorFamily(value) {
  return normalizeCapabilityName(value, CONNECTOR_FAMILY_ALIASES);
}

export function normalizeDungeonThemeTransitionType(value) {
  return normalizeCapabilityName(value, TRANSITION_TYPE_ALIASES);
}

export function normalizeDungeonThemeEnvironmentCapability(value) {
  return normalizeCapabilityName(value, ENVIRONMENT_CAPABILITY_ALIASES);
}

function isTrackableResource(value) {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function freezeArray(values) {
  return Object.freeze([...values]);
}

function freezeDiagnosticResult(result) {
  for (const diagnostic of result.diagnostics) Object.freeze(diagnostic);
  Object.freeze(result.diagnostics);
  Object.freeze(result.errors);
  for (const values of Object.values(result.missing)) Object.freeze(values);
  Object.freeze(result.missing);
  return Object.freeze(result);
}

export class DungeonThemeCapabilityError extends Error {
  constructor(message, {
    code = 'dungeon-theme-capability-error',
    capabilityType = null,
    capability = null,
    validation = null,
  } = {}) {
    super(message);
    this.name = 'DungeonThemeCapabilityError';
    this.code = code;
    this.capabilityType = capabilityType;
    this.capability = capability;
    this.validation = validation;
  }
}

/**
 * Explicitly labels the lifetime of a value returned by a theme provider.
 * Raw material-provider values default to borrowed, while raw asset, connector,
 * environment, and transition factory values default to owned.
 */
export function createDungeonThemeResourceReference(
  value,
  ownershipOrOptions = DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED,
  dispose = null,
) {
  const options = typeof ownershipOrOptions === 'string'
    ? { ownership: ownershipOrOptions, dispose }
    : (ownershipOrOptions ?? {});
  const ownership = options.ownership ?? DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED;
  if (!Object.values(DUNGEON_THEME_RESOURCE_OWNERSHIP).includes(ownership)) {
    throw new TypeError(`Unknown dungeon theme resource ownership: ${ownership}`);
  }
  return Object.freeze({
    schema: DUNGEON_THEME_RESOURCE_REFERENCE_SCHEMA,
    value,
    ownership,
    dispose: typeof options.dispose === 'function' ? options.dispose : null,
    label: typeof options.label === 'string' ? options.label : null,
  });
}

function isDungeonThemeResourceReference(value) {
  return value?.schema === DUNGEON_THEME_RESOURCE_REFERENCE_SCHEMA
    || (
      value
      && typeof value === 'object'
      && Object.hasOwn(value, 'value')
      && Object.values(DUNGEON_THEME_RESOURCE_OWNERSHIP).includes(value.ownership)
    );
}

function normalizeResourceReference(value, defaultOwnership) {
  if (isDungeonThemeResourceReference(value)) {
    return {
      value: value.value,
      ownership: value.ownership,
      dispose: typeof value.dispose === 'function' ? value.dispose : null,
      label: typeof value.label === 'string' ? value.label : null,
    };
  }
  return {
    value,
    ownership: defaultOwnership,
    dispose: null,
    label: null,
  };
}

export function createDungeonThemeResourceLedger() {
  const borrowed = new Map();
  const owned = new Map();
  const disposedOwnedValues = new WeakSet();
  let disposed = false;
  let disposedCount = 0;

  const assertOpen = () => {
    if (disposed) {
      throw new DungeonThemeCapabilityError(
        'Cannot register a dungeon theme resource after the session ledger was disposed.',
        { code: 'theme-resource-ledger-disposed' },
      );
    }
  };

  const track = (value, ownership, options = {}) => {
    if (!isTrackableResource(value)) return value;
    assertOpen();
    if (disposedOwnedValues.has(value)) {
      throw new DungeonThemeCapabilityError(
        `Cannot register an already disposed dungeon theme resource for ${options.label ?? 'unnamed resource'}.`,
        { code: 'theme-resource-already-disposed' },
      );
    }
    const mine = ownership === DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED ? owned : borrowed;
    const other = ownership === DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED ? borrowed : owned;
    if (other.has(value)) {
      throw new DungeonThemeCapabilityError(
        `Dungeon theme resource ownership conflict for ${options.label ?? 'unnamed resource'}.`,
        { code: 'theme-resource-ownership-conflict' },
      );
    }
    if (!mine.has(value)) {
      mine.set(value, {
        value,
        label: typeof options.label === 'string' ? options.label : null,
        dispose: typeof options.dispose === 'function' ? options.dispose : null,
      });
    }
    return value;
  };

  const disposeEntry = (entry, fallbackDispose = null) => {
    if (!entry || disposedOwnedValues.has(entry.value)) {
      return { disposed: false, error: null };
    }
    const disposer = entry.dispose ?? entry.value?.dispose;
    const fallback = typeof fallbackDispose === 'function' ? fallbackDispose : null;
    if (typeof disposer !== 'function' && !fallback) {
      return { disposed: false, error: null };
    }
    try {
      if (entry.dispose) entry.dispose(entry.value);
      else if (typeof disposer === 'function') disposer.call(entry.value);
      else fallback(entry.value);
      disposedOwnedValues.add(entry.value);
      owned.delete(entry.value);
      disposedCount += 1;
      return { disposed: true, error: null };
    } catch (error) {
      return {
        disposed: false,
        error: Object.freeze({ label: entry.label, error }),
      };
    }
  };

  const ledger = {
    borrow(value, options = {}) {
      return track(value, DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED, options);
    },

    own(value, options = {}) {
      return track(value, DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED, options);
    },

    isBorrowed(value) {
      return borrowed.has(value);
    },

    isOwned(value) {
      return owned.has(value);
    },

    ownershipOf(value) {
      if (borrowed.has(value)) return DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED;
      if (owned.has(value)) return DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED;
      return null;
    },

    snapshot() {
      return Object.freeze({
        disposed,
        borrowedCount: borrowed.size,
        ownedCount: owned.size,
        disposedCount,
        borrowedLabels: freezeArray([...borrowed.values()].map(({ label }) => label).filter(Boolean)),
        ownedLabels: freezeArray([...owned.values()].map(({ label }) => label).filter(Boolean)),
      });
    },

    disposeOwnedValue(value, { fallbackDispose = null } = {}) {
      if (disposed) {
        return Object.freeze({
          disposed: false,
          disposedCount: 0,
          totalDisposedCount: disposedCount,
          errors: Object.freeze([]),
        });
      }
      const entry = owned.get(value);
      const result = disposeEntry(entry, fallbackDispose);
      return Object.freeze({
        disposed: result.disposed,
        disposedCount: result.disposed ? 1 : 0,
        totalDisposedCount: disposedCount,
        errors: Object.freeze(result.error ? [result.error] : []),
      });
    },

    disposeOwned({ fallbackDispose = null } = {}) {
      if (disposed) {
        return Object.freeze({
          disposed: false,
          disposedCount: 0,
          totalDisposedCount: disposedCount,
          errors: Object.freeze([]),
        });
      }
      disposed = true;
      const errors = [];
      let currentDisposedCount = 0;
      for (const entry of [...owned.values()].reverse()) {
        const result = disposeEntry(entry, fallbackDispose);
        if (result.disposed) currentDisposedCount += 1;
        if (result.error) errors.push(result.error);
      }
      return Object.freeze({
        disposed: true,
        disposedCount: currentDisposedCount,
        totalDisposedCount: disposedCount,
        errors: Object.freeze(errors),
      });
    },
  };

  return Object.freeze(ledger);
}

function providerEntries(providers) {
  if (providers instanceof Map) return [...providers.entries()];
  if (!providers || typeof providers !== 'object') return [];
  return Object.entries(providers);
}

function normalizeProviderMap(providers, normalizeName, capabilityType) {
  const normalized = new Map();
  for (const [rawName, provider] of providerEntries(providers)) {
    const name = normalizeName(rawName);
    if (!name || provider == null) continue;
    if (normalized.has(name) && normalized.get(name) !== provider) {
      throw new DungeonThemeCapabilityError(
        `Conflicting ${capabilityType} providers were registered for ${name}.`,
        {
          code: 'duplicate-theme-capability-provider',
          capabilityType,
          capability: name,
        },
      );
    }
    normalized.set(name, provider);
  }
  return normalized;
}

function getProviderValue(provider, methodName, args, context) {
  if (typeof provider === 'function') {
    return {
      invokedFactory: true,
      result: provider(...args, context),
    };
  }
  if (provider && typeof provider[methodName] === 'function') {
    return {
      invokedFactory: true,
      result: provider[methodName](...args, context),
    };
  }
  return { invokedFactory: false, result: provider };
}

function trackMaterialDependencies(material, ownership, ledger, label, dispose = null) {
  const track = ownership === DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED
    ? ledger.own
    : ledger.borrow;
  if (Array.isArray(material)
    && ownership === DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED
    && typeof dispose === 'function') {
    // A ResourceReference disposer owns the value it wrapped. Preserve array
    // identity so the custom teardown runs once for the complete material set
    // rather than once per element (or not at all).
    ledger.own(material, { label, dispose });
    return;
  }
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) {
    track(entry, {
      label,
      dispose: ownership === DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED
        ? dispose
        : null,
    });
    if (!entry || typeof entry !== 'object') continue;
    for (const value of Object.values(entry)) {
      if (value?.isTexture === true) track(value, { label: `${label}:texture` });
    }
  }
}

function resolveProvider({
  provider,
  methodName,
  args,
  context,
  capabilityType,
  capability,
  defaultFactoryOwnership,
  defaultDirectOwnership = DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED,
  material = false,
}) {
  const { invokedFactory, result } = getProviderValue(provider, methodName, args, context);
  const reference = normalizeResourceReference(
    result,
    invokedFactory ? defaultFactoryOwnership : defaultDirectOwnership,
  );
  if (reference.value == null) {
    throw new DungeonThemeCapabilityError(
      `Dungeon theme ${capabilityType} provider returned no value for ${capability}.`,
      {
        code: 'theme-capability-returned-empty',
        capabilityType,
        capability,
      },
    );
  }
  const label = reference.label ?? `${capabilityType}:${capability}`;
  if (material) {
    trackMaterialDependencies(
      reference.value,
      reference.ownership,
      context.resources,
      label,
      reference.dispose,
    );
  } else if (reference.ownership === DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED) {
    context.resources.own(reference.value, { dispose: reference.dispose, label });
  } else {
    context.resources.borrow(reference.value, { label });
  }
  return reference.value;
}

function capabilityError(capabilityType, capability) {
  return new DungeonThemeCapabilityError(
    `Dungeon theme session does not provide ${capabilityType} capability ${capability}.`,
    {
      code: 'missing-theme-capability',
      capabilityType,
      capability,
    },
  );
}

function validateSessionThemeBinding(themeBinding) {
  const validation = validateDungeonRegionThemeBinding(themeBinding);
  const errors = [...validation.errors];
  for (const key of [
    'presentationVariantId',
    'localLightingProfileId',
    'soundscapeProfileId',
  ]) {
    if (typeof themeBinding?.[key] !== 'string' || themeBinding[key].trim() === '') {
      errors.push(`missing-theme-binding-${key}`);
    }
  }
  return { accepted: errors.length === 0, errors };
}

function normalizeCapabilityArray(values, normalizer) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizer)
    .filter(Boolean))]
    .sort();
}

export function createDungeonThemeCapabilityManifest({
  materials = [],
  materialRoles = materials,
  assets = [],
  assetRoles = assets,
  connectors = [],
  connectorFamilies = connectors,
  transitions = [],
  transitionTypes = transitions,
} = {}) {
  return createDungeonThemeCapabilities({
    materials: normalizeCapabilityArray(materialRoles, normalizeDungeonThemeMaterialRole),
    assets: normalizeCapabilityArray(assetRoles, normalizeDungeonThemeAssetRole),
    connectors: normalizeCapabilityArray(connectorFamilies, normalizeDungeonThemeConnectorFamily),
    transitions: normalizeCapabilityArray(transitionTypes, normalizeDungeonThemeTransitionType),
  });
}

function normalizeRequirements(requirements = {}) {
  const materialRoles = requirements.materialRoles ?? requirements.materials ?? [];
  const assetRoles = requirements.assetRoles ?? requirements.assets ?? [];
  const connectorFamilies = requirements.connectorFamilies ?? requirements.connectors ?? [];
  const transitionTypes = requirements.transitionTypes ?? requirements.transitions ?? [];
  const environmentCapabilities = requirements.environmentCapabilities
    ?? requirements.environment
    ?? [];
  const normalized = {
    materialRoles: normalizeCapabilityArray(materialRoles, normalizeDungeonThemeMaterialRole),
    assetRoles: normalizeCapabilityArray(assetRoles, normalizeDungeonThemeAssetRole),
    connectorFamilies: normalizeCapabilityArray(
      connectorFamilies,
      normalizeDungeonThemeConnectorFamily,
    ),
    transitionTypes: normalizeCapabilityArray(
      transitionTypes,
      normalizeDungeonThemeTransitionType,
    ),
    environmentCapabilities: normalizeCapabilityArray(
      environmentCapabilities,
      normalizeDungeonThemeEnvironmentCapability,
    ),
  };
  if (requirements.requireTransitionFrame === true) {
    normalized.assetRoles = normalizeCapabilityArray(
      [...normalized.assetRoles, 'transitionFrame'],
      normalizeDungeonThemeAssetRole,
    );
    normalized.transitionTypes = normalizeCapabilityArray(
      [...normalized.transitionTypes, 'levelTransitionBay'],
      normalizeDungeonThemeTransitionType,
    );
  }
  return normalized;
}

export function validateDungeonThemeCapabilityManifest(manifest, requirements = {}) {
  const diagnostics = [];
  const missing = {
    materialRoles: [],
    assetRoles: [],
    connectorFamilies: [],
    transitionTypes: [],
    environmentCapabilities: [],
  };
  if (manifest?.schema !== DUNGEON_THEME_CAPABILITIES_SCHEMA) {
    diagnostics.push({
      code: 'invalid-theme-capabilities-schema',
      capabilityType: 'manifest',
      capability: null,
      message: 'Dungeon theme capability manifest has an invalid schema.',
    });
  }
  const normalizedRequirements = normalizeRequirements(requirements);
  const available = {
    materialRoles: new Set(normalizeCapabilityArray(
      manifest?.materials,
      normalizeDungeonThemeMaterialRole,
    )),
    assetRoles: new Set(normalizeCapabilityArray(manifest?.assets, normalizeDungeonThemeAssetRole)),
    connectorFamilies: new Set(normalizeCapabilityArray(
      manifest?.connectors,
      normalizeDungeonThemeConnectorFamily,
    )),
    transitionTypes: new Set(normalizeCapabilityArray(
      manifest?.transitions,
      normalizeDungeonThemeTransitionType,
    )),
    environmentCapabilities: new Set(normalizeCapabilityArray(
      manifest?.environmentCapabilities,
      normalizeDungeonThemeEnvironmentCapability,
    )),
  };
  for (const [capabilityType, required] of Object.entries(normalizedRequirements)) {
    for (const capability of required) {
      if (available[capabilityType].has(capability)) continue;
      missing[capabilityType].push(capability);
      diagnostics.push({
        code: 'missing-theme-capability',
        capabilityType,
        capability,
        message: `Dungeon theme is missing ${capabilityType} capability ${capability}.`,
      });
    }
  }
  const errors = diagnostics.map(({ code, capabilityType, capability }) => (
    capability ? `${code}:${capabilityType}:${capability}` : code
  ));
  return freezeDiagnosticResult({
    ok: diagnostics.length === 0,
    accepted: diagnostics.length === 0,
    diagnostics,
    errors,
    missing,
  });
}

function createEnvironmentSession(environment, themeBinding, resources) {
  const providers = new Map();
  if (typeof environment?.createLocalLights === 'function') {
    providers.set('localLights', environment.createLocalLights.bind(environment));
  }
  if (typeof environment?.createAudioEmitters === 'function') {
    providers.set('audioEmitters', environment.createAudioEmitters.bind(environment));
  }
  const capabilities = freezeArray([...providers.keys()].sort());
  const context = Object.freeze({ themeBinding, resources });
  const create = (capability, specification = {}) => {
    const normalized = normalizeDungeonThemeEnvironmentCapability(capability);
    const provider = providers.get(normalized);
    if (!provider) throw capabilityError('environment', normalized);
    return resolveProvider({
      provider,
      methodName: 'create',
      args: [specification],
      context,
      capabilityType: 'environment',
      capability: normalized,
      defaultFactoryOwnership: DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED,
    });
  };
  return Object.freeze({
    localLightingProfileId: environment?.localLightingProfileId
      ?? themeBinding.localLightingProfileId,
    soundscapeProfileId: environment?.soundscapeProfileId
      ?? themeBinding.soundscapeProfileId,
    capabilities,
    has(capability) {
      return providers.has(normalizeDungeonThemeEnvironmentCapability(capability));
    },
    create,
    createLocalLights(specification = {}) {
      return create('localLights', specification);
    },
    createAudioEmitters(specification = {}) {
      return create('audioEmitters', specification);
    },
  });
}

export function createDungeonThemeSession({
  id = null,
  themeBinding,
  materialProviders = {},
  assetProviders = {},
  connectorSkinProviders = {},
  transitionProviders = {},
  environment = {},
  resources = createDungeonThemeResourceLedger(),
  requiredCapabilities = null,
} = {}) {
  const bindingValidation = validateSessionThemeBinding(themeBinding);
  if (!bindingValidation.accepted) {
    throw new DungeonThemeCapabilityError(
      `Invalid dungeon region theme binding: ${bindingValidation.errors.join(', ')}`,
      {
        code: 'invalid-theme-binding',
        validation: bindingValidation,
      },
    );
  }
  if (!resources || typeof resources.borrow !== 'function' || typeof resources.own !== 'function') {
    throw new TypeError('Dungeon theme session requires a resource ownership ledger.');
  }

  const materials = normalizeProviderMap(
    materialProviders,
    normalizeDungeonThemeMaterialRole,
    'material',
  );
  const assets = normalizeProviderMap(assetProviders, normalizeDungeonThemeAssetRole, 'asset');
  const connectors = normalizeProviderMap(
    connectorSkinProviders,
    normalizeDungeonThemeConnectorFamily,
    'connector',
  );
  const transitions = normalizeProviderMap(
    transitionProviders,
    normalizeDungeonThemeTransitionType,
    'transition',
  );
  const environmentSession = createEnvironmentSession(environment, themeBinding, resources);
  const context = Object.freeze({ themeBinding, resources });
  const capabilityManifest = {
    ...createDungeonThemeCapabilityManifest({
      materialRoles: [...materials.keys()],
      assetRoles: [...assets.keys()],
      connectorFamilies: [...connectors.keys()],
      transitionTypes: [...transitions.keys()],
    }),
    environmentCapabilities: environmentSession.capabilities,
  };
  Object.freeze(capabilityManifest);

  const session = {
    schema: DUNGEON_THEME_SESSION_SCHEMA,
    id: id ?? `${themeBinding.themeRef.id}:${themeBinding.parentRegionId}`,
    themeBinding,
    capabilities: capabilityManifest,
    materials: Object.freeze({
      roles: freezeArray([...materials.keys()].sort()),
      has(role) {
        return materials.has(normalizeDungeonThemeMaterialRole(role));
      },
      resolve(role, variant = null) {
        const normalized = normalizeDungeonThemeMaterialRole(role);
        const provider = materials.get(normalized);
        if (!provider) throw capabilityError('material', normalized);
        return resolveProvider({
          provider,
          methodName: 'resolve',
          args: [variant],
          context,
          capabilityType: 'material',
          capability: normalized,
          defaultFactoryOwnership: DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED,
          material: true,
        });
      },
    }),
    assets: Object.freeze({
      roles: freezeArray([...assets.keys()].sort()),
      has(role) {
        return assets.has(normalizeDungeonThemeAssetRole(role));
      },
      create(role, specification = {}) {
        const normalized = normalizeDungeonThemeAssetRole(role);
        const provider = assets.get(normalized);
        if (!provider) throw capabilityError('asset', normalized);
        return resolveProvider({
          provider,
          methodName: 'create',
          args: [specification],
          context,
          capabilityType: 'asset',
          capability: normalized,
          defaultFactoryOwnership: DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED,
        });
      },
    }),
    connectors: Object.freeze({
      families: freezeArray([...connectors.keys()].sort()),
      has(family) {
        return connectors.has(normalizeDungeonThemeConnectorFamily(family));
      },
      createSkin(family, contract = {}) {
        const normalized = normalizeDungeonThemeConnectorFamily(family);
        const provider = connectors.get(normalized);
        if (!provider) throw capabilityError('connector', normalized);
        return resolveProvider({
          provider,
          methodName: 'createSkin',
          args: [contract],
          context,
          capabilityType: 'connector',
          capability: normalized,
          defaultFactoryOwnership: DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED,
        });
      },
    }),
    transitions: Object.freeze({
      types: freezeArray([...transitions.keys()].sort()),
      has(type) {
        return transitions.has(normalizeDungeonThemeTransitionType(type));
      },
      create(type, contract = {}) {
        const normalized = normalizeDungeonThemeTransitionType(type);
        const provider = transitions.get(normalized);
        if (!provider) throw capabilityError('transition', normalized);
        return resolveProvider({
          provider,
          methodName: 'create',
          args: [contract],
          context,
          capabilityType: 'transition',
          capability: normalized,
          defaultFactoryOwnership: DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED,
        });
      },
    }),
    environment: environmentSession,
    resources,
  };
  Object.freeze(session);
  if (requiredCapabilities) assertDungeonThemeSession(session, requiredCapabilities);
  return session;
}

export function validateDungeonThemeSession(session, requirements = {}) {
  const diagnostics = [];
  if (session?.schema !== DUNGEON_THEME_SESSION_SCHEMA) {
    diagnostics.push({
      code: 'invalid-theme-session-schema',
      capabilityType: 'session',
      capability: null,
      message: 'Dungeon theme session has an invalid schema.',
    });
  }
  const bindingValidation = session?.themeBinding?.schema === DUNGEON_REGION_THEME_SCHEMA
    ? validateSessionThemeBinding(session.themeBinding)
    : { accepted: false, errors: ['invalid-theme-binding-schema'] };
  for (const error of bindingValidation.errors) {
    diagnostics.push({
      code: error,
      capabilityType: 'themeBinding',
      capability: null,
      message: `Dungeon theme session binding failed validation: ${error}.`,
    });
  }
  for (const [key, method] of [
    ['materials', 'resolve'],
    ['assets', 'create'],
    ['connectors', 'createSkin'],
    ['transitions', 'create'],
  ]) {
    if (typeof session?.[key]?.has !== 'function' || typeof session?.[key]?.[method] !== 'function') {
      diagnostics.push({
        code: 'invalid-theme-session-interface',
        capabilityType: key,
        capability: null,
        message: `Dungeon theme session is missing ${key}.${method}().`,
      });
    }
  }
  if (typeof session?.resources?.borrow !== 'function'
    || typeof session?.resources?.own !== 'function'
    || typeof session?.resources?.disposeOwned !== 'function') {
    diagnostics.push({
      code: 'invalid-theme-resource-ledger',
      capabilityType: 'resources',
      capability: null,
      message: 'Dungeon theme session is missing its resource ownership interface.',
    });
  }

  const capabilityValidation = validateDungeonThemeCapabilityManifest(
    session?.capabilities,
    requirements,
  );
  diagnostics.push(...capabilityValidation.diagnostics);
  const missing = {
    materialRoles: [...capabilityValidation.missing.materialRoles],
    assetRoles: [...capabilityValidation.missing.assetRoles],
    connectorFamilies: [...capabilityValidation.missing.connectorFamilies],
    transitionTypes: [...capabilityValidation.missing.transitionTypes],
    environmentCapabilities: [...capabilityValidation.missing.environmentCapabilities],
  };
  const errors = diagnostics.map(({ code, capabilityType, capability }) => (
    capability ? `${code}:${capabilityType}:${capability}` : code
  ));
  return freezeDiagnosticResult({
    ok: diagnostics.length === 0,
    accepted: diagnostics.length === 0,
    diagnostics,
    errors,
    missing,
  });
}

export function assertDungeonThemeSession(session, requirements = {}) {
  const validation = validateDungeonThemeSession(session, requirements);
  if (!validation.ok) {
    throw new DungeonThemeCapabilityError(
      `Dungeon theme session rejected: ${validation.errors.join(', ')}`,
      {
        code: 'dungeon-theme-session-rejected',
        validation,
      },
    );
  }
  return session;
}
