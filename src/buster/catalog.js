export const BUSTER_SCHEMA_VERSION = 1;
export const BUSTER_RULESET_VERSION = 'custom-buster-v0.2';
export const BUSTER_CHASSIS_CAPACITY = 5;
export const BUSTER_TUNING_TOTAL = 16;
export const BUSTER_TUNING_MIN = 1;
export const BUSTER_TUNING_MAX = 10;
export const BUSTER_CHILD_RANGE_MULTIPLIER = 0.65;
// Kept as a compatibility alias for the old hard-cap symbol. In v0.2 this is
// the knee of a continuous soft cap rather than a maximum.
export const BUSTER_POWER_SOFT_CAP_KNEE = 1.25;
export const BUSTER_POWER_SOFT_CAP_ASYMPTOTE = 1.5;
export const BUSTER_POWER_SOFT_CAP_STEEPNESS = 4;
export const BUSTER_EFFECTIVE_POWER_CAP_MULTIPLIER = BUSTER_POWER_SOFT_CAP_KNEE;
export const BUSTER_TRIGGER_WINDOW_WARNING_SECONDS = 0.1;
export const BUSTER_TRIGGER_TIME_EPSILON = 1e-9;
export const BUSTER_RECHARGE_DELAY = 0.65;
export const BUSTER_RECHARGE_DURATION = 1.8;
export const BUSTER_MAX_MOVING_PROJECTILES = 24;
export const BUSTER_LEVEL_10_POWER_SCALAR = 1;
export const BUSTER_BALANCE_SEARCH = Object.freeze({
  level10PowerScalar: Object.freeze({ min: 1, max: 1.25, step: 0.01 }),
  mortarPower: Object.freeze({ min: 12, max: 18, step: 0.5, preferred: 15 }),
  ttkTolerance: 0.15,
  dominanceMargin: 0.02,
});

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function moduleDefinition(definition) {
  return deepFreeze({
    energyCost: 0,
    cycleDelay: 0,
    physical: true,
    semanticCapacity: 1,
    compatibleEmitterTags: ['pulse', 'ballistic'],
    ...definition,
  });
}

export const CUSTOM_BUSTER_RULESET = deepFreeze({
  schemaVersion: BUSTER_SCHEMA_VERSION,
  rulesetVersion: BUSTER_RULESET_VERSION,
  tuningPoints: BUSTER_TUNING_TOTAL,
  ratingMin: BUSTER_TUNING_MIN,
  ratingMax: BUSTER_TUNING_MAX,
  programCapacity: BUSTER_CHASSIS_CAPACITY,
  tuningStats: ['power', 'energy', 'range', 'rapid'],
  ratingMultiplierBase: 0.72,
  ratingMultiplierPerPoint: 0.07,
  maxEnergyBase: 2,
  maxEnergyPerEnergyRating: 1,
  childRangeMultiplier: BUSTER_CHILD_RANGE_MULTIPLIER,
  effectivePowerCapMultiplier: BUSTER_EFFECTIVE_POWER_CAP_MULTIPLIER,
  powerSoftCap: {
    knee: BUSTER_POWER_SOFT_CAP_KNEE,
    asymptote: BUSTER_POWER_SOFT_CAP_ASYMPTOTE,
    steepness: BUSTER_POWER_SOFT_CAP_STEEPNESS,
  },
  triggerWindowWarningSeconds: BUSTER_TRIGGER_WINDOW_WARNING_SECONDS,
  triggerTimeEpsilon: BUSTER_TRIGGER_TIME_EPSILON,
  level10PowerScalar: BUSTER_LEVEL_10_POWER_SCALAR,
  balanceSearch: BUSTER_BALANCE_SEARCH,
  rechargeDelay: BUSTER_RECHARGE_DELAY,
  rechargeDuration: BUSTER_RECHARGE_DURATION,
  maxMovingProjectiles: BUSTER_MAX_MOVING_PROJECTILES,
});

function calibrationDefinition(id, name, bonuses) {
  return deepFreeze({ id, name, bonuses });
}

export const MEGA_BUSTER_CALIBRATION_CATALOG = deepFreeze({
  powerRaiser: calibrationDefinition('powerRaiser', 'Power Calibration', { power: 2 }),
  energyBattery: calibrationDefinition('energyBattery', 'Energy Calibration', { energy: 2 }),
  rangeBooster: calibrationDefinition('rangeBooster', 'Range Calibration', { range: 2 }),
  rapidFireUnit: calibrationDefinition('rapidFireUnit', 'Rapid Calibration', { rapid: 2 }),
  sniperScope: calibrationDefinition('sniperScope', 'Sniper Calibration', { power: 1, range: 1 }),
  heatSinkCore: calibrationDefinition('heatSinkCore', 'Heat Sink Calibration', { energy: 1, rapid: 1 }),
});

export const MEGA_BUSTER_BASE_PROFILE = deepFreeze({
  buildId: 'megaBuster',
  chassisId: 'mega-buster-fixed',
  emitterModuleId: 'pulseBolt',
  tuning: { power: 4, energy: 4, range: 4, rapid: 4 },
  baseMaxEnergy: 6,
  energyCost: 2,
  socketCount: 4,
});

/**
 * The complete, versioned Custom Buster compiler vocabulary.
 *
 * The catalog intentionally contains data only. Runtime code may consume the
 * compiled plan without importing it, and save data always retains its raw
 * module id so an unknown/future id can be reported rather than substituted.
 */
export const BUSTER_MODULE_CATALOG = deepFreeze({
  pulseBolt: moduleDefinition({
    id: 'pulseBolt',
    label: 'Pulse Bolt',
    kind: 'emitter',
    basePower: 8,
    baseRange: 6.9,
    baseRapid: 4.2,
    projectileSpeed: 9.5,
    energyCost: 2,
    trajectory: 'linear',
    nativePayload: 'pulse',
    emitterTags: ['projectile', 'pulse'],
  }),
  mortarShell: moduleDefinition({
    id: 'mortarShell',
    label: 'Mortar Shell',
    kind: 'emitter',
    basePower: 15,
    baseRange: 6.2,
    baseRapid: 1.15,
    projectileSpeed: 5.8,
    energyCost: 3,
    trajectory: 'ballistic',
    nativePayload: 'ballistic',
    emitterTags: ['projectile', 'ballistic', 'mortar'],
  }),
  pursuitGuidance: moduleDefinition({
    id: 'pursuitGuidance',
    label: 'Pursuit Guidance',
    kind: 'modifier',
    energyCost: 0,
    cycleDelay: 0,
    powerMultiplier: 0.9,
    guidance: 'pursuit',
  }),
  atApex: moduleDefinition({
    id: 'atApex',
    label: 'At Apex',
    kind: 'trigger',
    energyCost: 0,
    cycleDelay: 0.08,
    event: 'apex',
    delay: 0,
    carrierAllocation: 0,
    childTransfer: 1,
    compatibleEmitterTags: ['mortar'],
  }),
  onImpact: moduleDefinition({
    id: 'onImpact',
    label: 'Terminal Relay',
    kind: 'trigger',
    energyCost: 0,
    cycleDelay: 0.08,
    physical: false,
    builtIn: true,
    event: 'impact',
    delay: 0,
    carrierAllocation: 0.2,
    childTransfer: 0.8,
  }),
  afterDelay: moduleDefinition({
    id: 'afterDelay',
    label: 'After Delay',
    kind: 'trigger',
    energyCost: 0,
    cycleDelay: 0.08,
    physical: false,
    builtIn: true,
    event: 'delay',
    delay: 0.6,
    carrierAllocation: 0,
    childTransfer: 1.04,
  }),
  spread3: moduleDefinition({
    id: 'spread3',
    label: 'Spread 3',
    kind: 'splitter',
    energyCost: 1,
    cycleDelay: 0.08,
    count: 3,
    pattern: 'spread',
    angleOffsets: [-0.14, 0, 0.14],
    totalPowerMultiplier: 1.1,
  }),
  cluster5: moduleDefinition({
    id: 'cluster5',
    label: 'Cluster 5',
    kind: 'splitter',
    energyCost: 2,
    cycleDelay: 0.16,
    count: 5,
    pattern: 'radial',
    radialCount: 5,
    totalPowerMultiplier: 1.2,
    childOnly: true,
  }),
  pulsePayload: moduleDefinition({
    id: 'pulsePayload',
    label: 'Native Pulse',
    kind: 'payload',
    physical: false,
    builtIn: true,
    semanticCapacity: 0,
    payload: 'pulse',
    replacesDirect: false,
  }),
  explosion: moduleDefinition({
    id: 'explosion',
    label: 'Explosion',
    kind: 'payload',
    energyCost: 1,
    cycleDelay: 0.1,
    payload: 'explosion',
    radius: 1.55,
    replacesDirect: true,
  }),
});

export const BUSTER_MODULE_LIST = Object.freeze(Object.values(BUSTER_MODULE_CATALOG));
export const BUSTER_MODULE_KINDS = Object.freeze({
  emitter: Object.freeze(BUSTER_MODULE_LIST.filter((module) => module.kind === 'emitter')),
  modifier: Object.freeze(BUSTER_MODULE_LIST.filter((module) => module.kind === 'modifier')),
  trigger: Object.freeze(BUSTER_MODULE_LIST.filter((module) => module.kind === 'trigger')),
  splitter: Object.freeze(BUSTER_MODULE_LIST.filter((module) => module.kind === 'splitter')),
  payload: Object.freeze(BUSTER_MODULE_LIST.filter((module) => module.kind === 'payload')),
});

export function getBusterModuleDefinition(moduleId) {
  return typeof moduleId === 'string' ? BUSTER_MODULE_CATALOG[moduleId] ?? null : null;
}

export function getBusterTuningMultiplier(rating) {
  return 0.72 + 0.07 * rating;
}

export function getBusterMaxEnergy(energyRating) {
  return 2 + energyRating;
}

export function applyBusterPowerSoftCap(rawMultiplier) {
  const numeric = Number(rawMultiplier);
  if (!Number.isFinite(numeric)) return 0;
  const raw = Math.max(0, numeric);
  if (raw <= BUSTER_POWER_SOFT_CAP_KNEE) return raw;
  const excess = raw - BUSTER_POWER_SOFT_CAP_KNEE;
  return BUSTER_POWER_SOFT_CAP_KNEE
    + excess / (1 + BUSTER_POWER_SOFT_CAP_STEEPNESS * excess);
}

export function getBusterCombatDepthLevel(value = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(10, Math.round(numeric)));
}

export function getBusterCombatDepthScalar(
  combatDepthLevel = 1,
  level10Scalar = BUSTER_LEVEL_10_POWER_SCALAR,
) {
  const level = getBusterCombatDepthLevel(combatDepthLevel);
  const endpoint = Number(level10Scalar);
  const normalizedEndpoint = Number.isFinite(endpoint)
    ? Math.max(1, Math.min(1.25, endpoint))
    : BUSTER_LEVEL_10_POWER_SCALAR;
  return 1 + ((level - 1) / 9) * (normalizedEndpoint - 1);
}
