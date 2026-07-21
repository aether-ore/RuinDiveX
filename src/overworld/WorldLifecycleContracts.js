export const LOADED_WORLD_BUNDLE_KIND = 'loadedWorldBundle';

export const WORLD_KINDS = Object.freeze(['overworld', 'dungeon']);

export const WORLD_LIFECYCLE_STATES = Object.freeze([
  'overworld',
  'enteringDungeon',
  'dungeon',
  'returningOverworld',
]);

const freezeTransitionMap = (transitions) => Object.freeze(Object.fromEntries(
  Object.entries(transitions).map(([state, nextStates]) => [state, Object.freeze([...nextStates])]),
));

// Transitional states may either commit to their destination or roll back to
// their stable origin. No other edge is legal.
export const WORLD_LIFECYCLE_TRANSITIONS = freezeTransitionMap({
  overworld: ['enteringDungeon'],
  enteringDungeon: ['dungeon', 'overworld'],
  dungeon: ['returningOverworld'],
  returningOverworld: ['overworld', 'dungeon'],
});

export const PERSISTENT_HOST_STATE_FIELDS = Object.freeze([
  'renderer',
  'scene',
  'camera',
  'cameraController',
  'player',
  'inventory',
  'equipment',
  'salvage',
  'gold',
  'campaignStorage',
  'bossRecords',
  'largeRefractorsSecured',
  'ui',
  'keys',
  'pointer',
  'busterLabStorage',
  'worldLifecycle',
]);

// These fields are physically present on every LoadedWorldBundle and form the
// validated disposable-root contract.
export const LOADED_WORLD_BUNDLE_FIELDS = Object.freeze([
  'root',
  'lighting',
  'controller',
  'facade',
  'npcAnimators',
  'collisionData',
  'cullingData',
  'disposableResources',
]);

// V1 exposes these through Game for compatibility, so they are not physical
// LoadedWorldBundle fields. They still have mounted-world lifetime and must be
// cleared/replaced at each lifecycle commit.
export const MOUNTED_RUNTIME_LOCAL_STATE_FIELDS = Object.freeze([
  'enemies',
  'hazards',
  'projectiles',
  'activeMines',
  'lootSystem',
  'refractors',
  'spawner',
  'mapEvents',
  'bossStageRuntime',
  'cameraOcclusionEntries',
  'dungeonRenderCullGroups',
]);

export const BUNDLE_LOCAL_STATE_FIELDS = LOADED_WORLD_BUNDLE_FIELDS;

export const PERSISTENT_HOST_STATE_OWNERSHIP = Object.freeze({
  id: 'persistent-world-host',
  scope: 'persistent-host',
  lifetime: 'game-session',
  description: 'Survives overworld and dungeon bundle replacement.',
  fields: PERSISTENT_HOST_STATE_FIELDS,
});

export const BUNDLE_LOCAL_STATE_OWNERSHIP = Object.freeze({
  id: 'loaded-world-bundle',
  scope: 'bundle-local',
  lifetime: 'mounted-world',
  description: 'Released when its loaded world bundle is replaced or abandoned.',
  fields: BUNDLE_LOCAL_STATE_FIELDS,
});

export const MOUNTED_RUNTIME_LOCAL_STATE_OWNERSHIP = Object.freeze({
  id: 'mounted-world-runtime',
  scope: 'mounted-runtime-local',
  lifetime: 'mounted-world',
  description: 'V1 compatibility systems held by Game and cleared or replaced at world commits.',
  fields: MOUNTED_RUNTIME_LOCAL_STATE_FIELDS,
});

export const WORLD_STATE_OWNERSHIP = Object.freeze({
  persistentHost: PERSISTENT_HOST_STATE_FIELDS,
  bundleLocal: BUNDLE_LOCAL_STATE_FIELDS,
  mountedRuntimeLocal: MOUNTED_RUNTIME_LOCAL_STATE_FIELDS,
});

export const WORLD_STATE_OWNERSHIP_DESCRIPTORS = Object.freeze({
  persistentHost: PERSISTENT_HOST_STATE_OWNERSHIP,
  bundleLocal: BUNDLE_LOCAL_STATE_OWNERSHIP,
  mountedRuntimeLocal: MOUNTED_RUNTIME_LOCAL_STATE_OWNERSHIP,
});

const isObjectLike = (value) => (
  value !== null && (typeof value === 'object' || typeof value === 'function')
);

const hasOwn = (value, field) => Object.prototype.hasOwnProperty.call(value, field);

export function getWorldStateOwner(field) {
  if (PERSISTENT_HOST_STATE_FIELDS.includes(field)) return 'persistent-host';
  if (BUNDLE_LOCAL_STATE_FIELDS.includes(field)) return 'bundle-local';
  if (MOUNTED_RUNTIME_LOCAL_STATE_FIELDS.includes(field)) return 'mounted-runtime-local';
  return null;
}

export function validateMountedRuntimeStateHost(host) {
  const errors = [];
  if (!isObjectLike(host)) errors.push('host-required');
  if (!Array.isArray(host?.enemies)) errors.push('enemies-must-be-array');
  if (!Array.isArray(host?.hazards)) errors.push('hazards-must-be-array');
  if (!isObjectLike(host?.projectiles)) errors.push('projectile-system-required');
  if (!Array.isArray(host?.combat?.activeMines)) errors.push('active-mines-must-be-array');
  if (!isObjectLike(host?.lootSystem)) errors.push('loot-system-required');
  if (!isObjectLike(host?.refractors)) errors.push('refractor-system-required');
  if (!isObjectLike(host?.spawner)) errors.push('spawner-required');
  if (!isObjectLike(host?.mapEvents)) errors.push('map-events-required');
  if (host?.bossStageRuntime !== null && host?.bossStageRuntime !== undefined
    && !isObjectLike(host.bossStageRuntime)) errors.push('invalid-boss-stage-runtime');
  if (!Array.isArray(host?.cameraOcclusionEntries)) errors.push('camera-occlusion-cache-must-be-array');
  if (!Array.isArray(host?.dungeonRenderCullGroups)) errors.push('render-culling-cache-must-be-array');
  return Object.freeze({
    accepted: errors.length === 0,
    errors: Object.freeze(errors),
    diagnostics: Object.freeze({
      enemyCount: host?.enemies?.length ?? 0,
      hazardCount: host?.hazards?.length ?? 0,
      mineCount: host?.combat?.activeMines?.length ?? 0,
      cameraOcclusionEntryCount: host?.cameraOcclusionEntries?.length ?? 0,
      renderCullGroupCount: host?.dungeonRenderCullGroups?.length ?? 0,
    }),
  });
}

export function assertMountedRuntimeStateHost(host) {
  const validation = validateMountedRuntimeStateHost(host);
  if (!validation.accepted) {
    throw new TypeError(`Invalid mounted world runtime: ${validation.errors.join(', ')}`);
  }
  return host;
}

export function validateLoadedWorldBundle(bundle, { requireController = false } = {}) {
  const errors = [];
  if (!isObjectLike(bundle)) errors.push('bundle-required');
  if (bundle?.kind !== LOADED_WORLD_BUNDLE_KIND) errors.push('invalid-bundle-kind');
  if (!WORLD_KINDS.includes(bundle?.worldKind)) errors.push('invalid-world-kind');

  for (const field of LOADED_WORLD_BUNDLE_FIELDS) {
    if (!hasOwn(bundle ?? {}, field)) errors.push(`missing-owned-field:${field}`);
  }

  if (!isObjectLike(bundle?.root)) errors.push('root-required');
  if (!isObjectLike(bundle?.lighting)) errors.push('lighting-required');
  if (!isObjectLike(bundle?.facade)) errors.push('facade-required');
  if (bundle?.controller !== null && bundle?.controller !== undefined
    && !isObjectLike(bundle.controller)) {
    errors.push('invalid-controller');
  }
  if (requireController && !isObjectLike(bundle?.controller)) errors.push('controller-required');
  if (!Array.isArray(bundle?.npcAnimators)) errors.push('npc-animators-must-be-array');
  if (!Array.isArray(bundle?.collisionData)) errors.push('collision-data-must-be-array');
  if (!Array.isArray(bundle?.cullingData)) errors.push('culling-data-must-be-array');
  if (!Array.isArray(bundle?.disposableResources)) errors.push('disposable-resources-must-be-array');
  if (typeof bundle?.disposed !== 'boolean') errors.push('disposed-flag-required');
  if (bundle?.ownership !== BUNDLE_LOCAL_STATE_OWNERSHIP) {
    errors.push('invalid-bundle-ownership');
  }

  return Object.freeze({
    accepted: errors.length === 0,
    errors: Object.freeze(errors),
    diagnostics: Object.freeze({
      worldKind: bundle?.worldKind ?? null,
      hasController: isObjectLike(bundle?.controller),
      npcAnimatorCount: bundle?.npcAnimators?.length ?? 0,
      collisionEntryCount: bundle?.collisionData?.length ?? 0,
      cullingEntryCount: bundle?.cullingData?.length ?? 0,
      disposableResourceCount: bundle?.disposableResources?.length ?? 0,
    }),
  });
}

export function assertLoadedWorldBundle(bundle, options) {
  const validation = validateLoadedWorldBundle(bundle, options);
  if (!validation.accepted) {
    throw new TypeError(`Invalid LoadedWorldBundle: ${validation.errors.join(', ')}`);
  }
  return bundle;
}

export function isLoadedWorldBundle(bundle, options) {
  return validateLoadedWorldBundle(bundle, options).accepted;
}

export function createLoadedWorldBundle({
  worldKind,
  root,
  lighting,
  controller = null,
  facade,
  npcAnimators = facade?.npcAnimators ?? [],
  collisionData = facade?.solidZones ?? [],
  cullingData = facade?.renderCullGroups ?? [],
  disposableResources = [],
  disposed = false,
  ...metadata
} = {}) {
  const bundle = {
    ...metadata,
    kind: LOADED_WORLD_BUNDLE_KIND,
    worldKind,
    root,
    lighting,
    controller,
    facade,
    npcAnimators: Array.isArray(npcAnimators) ? npcAnimators : [...npcAnimators],
    collisionData: Array.isArray(collisionData) ? collisionData : [...collisionData],
    cullingData: Array.isArray(cullingData) ? cullingData : [...cullingData],
    disposableResources: Array.isArray(disposableResources)
      ? disposableResources
      : [...disposableResources],
    ownership: BUNDLE_LOCAL_STATE_OWNERSHIP,
    disposed: Boolean(disposed),
  };
  return assertLoadedWorldBundle(bundle);
}

export function validateWorldLifecycleTransition(fromState, toState) {
  const errors = [];
  if (!WORLD_LIFECYCLE_STATES.includes(fromState)) errors.push(`unknown-from-state:${fromState}`);
  if (!WORLD_LIFECYCLE_STATES.includes(toState)) errors.push(`unknown-to-state:${toState}`);
  const legalNextStates = WORLD_LIFECYCLE_TRANSITIONS[fromState] ?? Object.freeze([]);
  if (errors.length === 0 && !legalNextStates.includes(toState)) {
    errors.push(`illegal-transition:${fromState}->${toState}`);
  }
  return Object.freeze({
    accepted: errors.length === 0,
    errors: Object.freeze(errors),
    fromState,
    toState,
    legalNextStates,
  });
}

export const canTransitionWorldLifecycle = (fromState, toState) => (
  validateWorldLifecycleTransition(fromState, toState).accepted
);

export const isWorldLifecycleTransitionAllowed = canTransitionWorldLifecycle;

export class WorldLifecycleTransitionError extends Error {
  constructor(validation) {
    super(`Illegal world lifecycle transition ${validation.fromState} -> ${validation.toState}`);
    this.name = 'WorldLifecycleTransitionError';
    this.code = 'illegal-world-lifecycle-transition';
    this.fromState = validation.fromState;
    this.toState = validation.toState;
    this.legalNextStates = validation.legalNextStates;
  }
}

export function assertWorldLifecycleTransition(fromState, toState) {
  const validation = validateWorldLifecycleTransition(fromState, toState);
  if (!validation.accepted) throw new WorldLifecycleTransitionError(validation);
  return toState;
}

export class WorldLifecycleState {
  #state;

  #sequence;

  #lastTransition;

  constructor(initialState = 'overworld') {
    if (!WORLD_LIFECYCLE_STATES.includes(initialState)) {
      throw new TypeError(`Unknown initial world lifecycle state: ${initialState}`);
    }
    this.#state = initialState;
    this.#sequence = 0;
    this.#lastTransition = null;
    Object.seal(this);
  }

  get state() {
    return this.#state;
  }

  get sequence() {
    return this.#sequence;
  }

  get lastTransition() {
    return this.#lastTransition;
  }

  get legalNextStates() {
    return WORLD_LIFECYCLE_TRANSITIONS[this.#state];
  }

  canTransitionTo(nextState) {
    return canTransitionWorldLifecycle(this.#state, nextState);
  }

  transitionTo(nextState) {
    assertWorldLifecycleTransition(this.#state, nextState);
    const fromState = this.#state;
    this.#state = nextState;
    this.#sequence += 1;
    this.#lastTransition = Object.freeze({
      sequence: this.#sequence,
      fromState,
      toState: nextState,
    });
    return this.#state;
  }

  transition(nextState) {
    return this.transitionTo(nextState);
  }

  snapshot() {
    return Object.freeze({
      state: this.#state,
      sequence: this.#sequence,
      legalNextStates: this.legalNextStates,
      lastTransition: this.#lastTransition,
    });
  }
}

export function createWorldLifecycleState(initialState = 'overworld') {
  return new WorldLifecycleState(initialState);
}
