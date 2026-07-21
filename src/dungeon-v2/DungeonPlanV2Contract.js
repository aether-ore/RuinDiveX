export const DUNGEON_PLAN_V2_SCHEMA_VERSION = 1;

export const DUNGEON_PLAN_V2_COLLECTIONS = Object.freeze([
  'districts',
  'regions',
  'modulePlacements',
  'semanticRoomPackPlacements',
  'progression',
  'encounters',
  'rewards',
  'objectives',
  'environmentStates',
  'mechanisms',
  'minimap',
  'spatialCells',
  'structuralBoundaries',
  'portals',
  'walkableSurfaces',
  'falls',
  'anchors',
  'safeAnchors',
  'actions',
  'traversalLinks',
  'structuralFixtures',
]);

export const CONDITION_OPERATIONS_V2 = Object.freeze([
  'all',
  'any',
  'stateEquals',
  'hasKey',
  'gateOpen',
  'encounterComplete',
  'objectiveComplete',
  'rewardCollected',
]);

export const EFFECT_OPERATIONS_V2 = Object.freeze([
  'setState',
  'setWaterState',
  'setMechanismState',
  'grantKey',
  'openGate',
  'completeEncounter',
  'completeObjective',
  'collectReward',
  'collectRefractor',
  'discoverRegion',
  'extract',
]);

export const BOUNDARY_SIDES_V2 = Object.freeze([
  'north',
  'south',
  'east',
  'west',
  'floor',
  'ceiling',
]);

export const CONNECTOR_FORMS_V2 = Object.freeze([
  'arched-bulkhead',
  'stair-gallery',
  'pipe-tunnel',
  'ladder-shaft',
  'security-bulkhead',
  'water-breach',
  'pump-catwalk',
  'submerged-pipe',
  'drainage-stair',
  'cargo-lift',
  'pressure-gate',
  'conveyor-bridge',
  'service-ladder',
  'gear-bridge',
  'maintenance-pipe',
  'corkscrew-descent',
  'hazard-catwalk',
  'return-lift',
  'blast-gate',
  'shrine-bulkhead',
  'intentional-drop',
  'overflow-tunnel',
  'ramped-service-tunnel',
  'freight-elevator',
]);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

export function deepFreezePlan(value, seen = new WeakSet()) {
  // A frozen container can still contain mutable descendants (for example a
  // solver may freeze its trace array but not each trace record).  Always walk
  // the full graph before deciding whether the current node itself needs to be
  // frozen.
  if (!isObject(value) || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreezePlan(value[key], seen);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

export function clonePlanData(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function createDungeonModuleDescriptorV2(descriptor) {
  const copy = clonePlanData(descriptor);
  copy.schemaVersion = DUNGEON_PLAN_V2_SCHEMA_VERSION;
  copy.revision = Number.isInteger(copy.revision) ? copy.revision : 1;
  return deepFreezePlan(copy);
}

export function createDungeonPlanV2(plan) {
  const copy = clonePlanData(plan);
  copy.schemaVersion = DUNGEON_PLAN_V2_SCHEMA_VERSION;
  copy.generatorVersion = copy.generatorVersion ?? 'restart-m1';
  return deepFreezePlan(copy);
}

export function isSerializablePlanValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || typeof value === 'undefined') {
    return false;
  }
  if (!isObject(value)) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) {
    return false;
  }
  seen.add(value);
  const valid = (Array.isArray(value) ? value : Object.values(value))
    .every((entry) => isSerializablePlanValue(entry, seen));
  seen.delete(value);
  return valid;
}

export default createDungeonPlanV2;
