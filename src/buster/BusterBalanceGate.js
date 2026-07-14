import {
  BUSTER_BALANCE_SEARCH,
  BUSTER_MAX_MOVING_PROJECTILES,
  BUSTER_MODULE_CATALOG,
  BUSTER_RECHARGE_DELAY,
  BUSTER_RECHARGE_DURATION,
  BUSTER_RULESET_VERSION,
  getBusterMaxEnergy,
  getBusterTuningMultiplier,
} from './catalog.js';
import { compileBusterBuild } from './compiler.js';

const EPSILON = 1e-9;
const BALANCED_TUNING = Object.freeze({ power: 4, energy: 4, range: 4, rapid: 4 });
const DEFAULT_HORIZON = 180;
const LEGACY_RANDOM_ROLL_MEAN = (0.9 + 1.12) / 2;
const PLAYER_BASE_CRITICAL_CHANCE = 0.08;
const PLAYER_BASE_CRITICAL_MULTIPLIER = 1.55;
const LEGACY_EXPECTED_CRITICAL_MULTIPLIER = 1
  + PLAYER_BASE_CRITICAL_CHANCE * (PLAYER_BASE_CRITICAL_MULTIPLIER - 1);
const PLAYER_BASE_ATTACK = 12;
const PLAYER_ATTACK_PER_LEVEL = 1.5;
const PLAYER_BASE_RAPID = 1.25;
const PLAYER_BASE_RANGE = 6.2;
const PLAYER_BASE_ENERGY = 8;
const PLAYER_BASE_ENERGY_RECHARGE = 1;
const LEGACY_OUTPUT_RECOVERY_DELAY = 0.5;

export const BUSTER_BALANCE_LEVELS = Object.freeze([1, 5, 10]);
export const BUSTER_BALANCE_TARGET_COUNTS = Object.freeze([1, 2, 4]);
export const BUSTER_BALANCE_AIM_OFFSETS = Object.freeze(['center', 'half-radius', 'edge']);
export const BUSTER_BALANCE_MOTIONS = Object.freeze(['stationary', 'lateral']);
export const BUSTER_BALANCE_DISTANCES = Object.freeze({ near: 3.2, mid: 4.8, far: 6 });
export const BUSTER_BALANCE_LAYOUTS = Object.freeze(['compact', 'separated']);

/**
 * These are the production constants currently stored by the v0.2 catalog.
 * `runBusterBalanceSearch` is intentionally authoritative about whether they
 * are releasable; this declaration is not a claim that the gate passes.
 */
export const STORED_BUSTER_BALANCE_CONSTANTS = Object.freeze({
  level10Scalar: 1,
  mortarPower: 15,
  clusterEnergySurcharge: 2,
  clusterExplosionCompoundSurcharge: 3,
});

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function node(nodeId, moduleId) {
  return { nodeId, moduleId, moduleInstanceId: null };
}

function edge(from, port, to) {
  return { from, port, to };
}

function sourceBuild(buildId, nodes, edges = []) {
  return {
    schemaVersion: 1,
    rulesetVersion: BUSTER_RULESET_VERSION,
    buildId,
    chassisId: `balance:${buildId}`,
    tuning: { ...BALANCED_TUNING },
    program: {
      rootNodeId: nodes[0]?.nodeId ?? null,
      nodes,
      edges,
    },
  };
}

/** Canonical source programs used by the deterministic release matrix. */
export function createCanonicalBusterBalanceSources() {
  return deepFreeze({
    balancedBarePulse: sourceBuild('balance-bare-pulse', [node('emitter', 'pulseBolt')]),
    balancedBareMortar: sourceBuild('balance-bare-mortar', [node('emitter', 'mortarShell')]),
    pursuitPulse: sourceBuild(
      'balance-pursuit-pulse',
      [node('emitter', 'pulseBolt'), node('guidance', 'pursuitGuidance')],
      [edge('emitter', 'next', 'guidance')],
    ),
    directSpreadExplosion: sourceBuild(
      'balance-spread-explosion',
      [node('emitter', 'pulseBolt'), node('spread', 'spread3'), node('payload', 'explosion')],
      [edge('emitter', 'next', 'spread'), edge('spread', 'next', 'payload')],
    ),
    delayedMortarClusterExplosion: sourceBuild(
      'balance-delayed-mortar-cluster-explosion',
      [
        node('emitter', 'mortarShell'),
        node('trigger', 'afterDelay'),
        node('cluster', 'cluster5'),
        node('payload', 'explosion'),
      ],
      [
        edge('emitter', 'next', 'trigger'),
        edge('trigger', 'child', 'cluster'),
        edge('cluster', 'next', 'payload'),
      ],
    ),
    delayedMortarExplosion: sourceBuild(
      'balance-delayed-mortar-explosion',
      [node('emitter', 'mortarShell'), node('trigger', 'afterDelay'), node('payload', 'explosion')],
      [edge('emitter', 'next', 'trigger'), edge('trigger', 'child', 'payload')],
    ),
  });
}

const CANONICAL_SOURCES = createCanonicalBusterBalanceSources();

const TARGET_PROFILE_DEFINITIONS = Object.freeze({
  ordinary: Object.freeze({
    id: 'ordinary', label: 'Ordinary Reaverbot', baseHealth: 24, healthPerLevel: 0.16,
    baseArmor: 0, armorPerLevel: 0,
  }),
  armored: Object.freeze({
    id: 'armored', label: 'Armored Reaverbot', baseHealth: 58, healthPerLevel: 0.16,
    baseArmor: 12, armorPerLevel: 0.08,
  }),
  elite: Object.freeze({
    id: 'elite', label: 'Elite Reaverbot', baseHealth: 43.2, healthPerLevel: 0.18,
    baseArmor: 10, armorPerLevel: 0.1,
  }),
  medianProcedural: Object.freeze({
    id: 'medianProcedural', label: 'Median Procedural Reaverbot', procedural: true,
    baseHealth: 34, baseArmor: 8,
  }),
  weakPoint: Object.freeze({
    id: 'weakPoint', label: 'Weak-point Reaverbot', procedural: true,
    baseHealth: 34, baseArmor: 8, weakPointMultiplier: 2.4,
  }),
});

export const BUSTER_BALANCE_TARGET_PROFILES = deepFreeze(TARGET_PROFILE_DEFINITIONS);

function resolveTargetProfile(profileId, level) {
  const definition = TARGET_PROFILE_DEFINITIONS[profileId];
  if (!definition) throw new Error(`Unknown Buster balance target profile: ${profileId}`);
  if (definition.procedural) {
    const tier = clamp(Math.round(level), 1, 8);
    return {
      ...definition,
      level,
      health: definition.baseHealth * (1 + (tier - 1) * 0.2) * 1.12,
      armor: definition.baseArmor * (1 + (tier - 1) * 0.12),
    };
  }
  return {
    ...definition,
    level,
    health: definition.baseHealth * (1 + Math.max(0, level - 1) * definition.healthPerLevel),
    armor: definition.baseArmor * (1 + Math.max(0, level - 1) * definition.armorPerLevel),
  };
}

/**
 * Full deterministic scenario matrix. It is data-only and deliberately has no
 * dependency on Three.js, enemies, or mutable game state.
 */
export function createBusterBalanceScenarioMatrix() {
  const scenarios = [];
  for (const level of BUSTER_BALANCE_LEVELS) {
    for (const targetCount of BUSTER_BALANCE_TARGET_COUNTS) {
      for (const targetProfileId of Object.keys(TARGET_PROFILE_DEFINITIONS)) {
        for (const aimOffset of BUSTER_BALANCE_AIM_OFFSETS) {
          for (const motion of BUSTER_BALANCE_MOTIONS) {
            for (const [distanceBand, distance] of Object.entries(BUSTER_BALANCE_DISTANCES)) {
              for (const layout of BUSTER_BALANCE_LAYOUTS) {
                const target = resolveTargetProfile(targetProfileId, level);
                scenarios.push({
                  id: [level, targetCount, targetProfileId, aimOffset, motion, distanceBand, layout].join(':'),
                  level,
                  combatDepthLevel: level,
                  targetCount,
                  targetProfileId,
                  target,
                  aimOffset,
                  motion,
                  distanceBand,
                  distance,
                  layout,
                });
              }
            }
          }
        }
      }
    }
  }
  return deepFreeze(scenarios);
}

const SCENARIO_MATRIX = createBusterBalanceScenarioMatrix();

function midpoint([minimum, maximum]) {
  return (minimum + maximum) / 2;
}

function scaleLegacyItemStat(range, level, { integer = false } = {}) {
  const scaled = midpoint(range) * (1 + level * 0.055);
  return integer ? Math.round(scaled) : Number(scaled.toFixed(3));
}

const LEGACY_FIXTURE_DEFINITIONS = deepFreeze({
  machineGun: {
    id: 'machineGun',
    label: 'Standard Midpoint Machine Gun Arm',
    itemType: 'machineGunArm',
    itemStats: {
      attackDamage: [2, 5], maxEnergy: [12, 20], attackRange: [5.5, 6.8], attackSpeed: [0.3, 0.52],
    },
    profile: {
      energyCost: 0.55, outputCost: 0.045, outputRequired: 0.03,
      outputRecovery: 0.55, outputVent: 0.38, outputStarvedCooldown: 0.08,
      cooldownMultiplier: 0.56, damageMultiplier: 0.68, projectileSpeed: 10.8,
      projectileCount: 1, spread: 0.08, direct: true, splashMultiplier: 0, splashRadius: 0,
    },
  },
  cannon: {
    id: 'cannon',
    label: 'Standard Midpoint Cannon Arm',
    itemType: 'cannonArm',
    itemStats: {
      attackDamage: [12, 20], maxEnergy: [1, 3], attackRange: [5, 6.6], attackSpeed: [0.01, 0.08],
      areaDamage: [0.18, 0.36],
    },
    profile: {
      energyCost: 2, outputCost: 1, outputRequired: 0.78,
      outputRecovery: 0.36, outputVent: 0.74, outputStarvedCooldown: 0.08,
      cooldownMultiplier: 1.65, damageMultiplier: 1.45, projectileSpeed: 7.4,
      projectileCount: 1, direct: true, splashMultiplier: 0.62, splashRadius: 1.75,
    },
  },
  missile: {
    id: 'missile',
    label: 'Standard Midpoint Missile Arm (report only)',
    itemType: 'missileArm',
    reportOnly: true,
    itemStats: {
      attackDamage: [9, 16], maxEnergy: [3, 6], attackRange: [6, 8], attackSpeed: [0.04, 0.12],
    },
    profile: {
      energyCost: 1.5, outputCost: 0.38, outputRequired: 0.22,
      outputRecovery: 0.38, outputVent: 0.58, outputStarvedCooldown: 0.08,
      cooldownMultiplier: 1.28, damageMultiplier: 1.22 * 1.12, projectileSpeed: 6.8,
      projectileCount: 1, direct: true, splashMultiplier: 0.62, splashRadius: 1.35,
      guidance: true,
    },
  },
});

export const BUSTER_BALANCE_LEGACY_FIXTURES = LEGACY_FIXTURE_DEFINITIONS;

const LEGACY_FIXTURE_CACHE = new Map();
const SHOT_SCHEDULE_CACHE = new WeakMap();

/** Reproduces the standard/no-affix midpoint item and player-level math. */
export function createLegacyBalanceFixture(fixtureId, level) {
  const definition = LEGACY_FIXTURE_DEFINITIONS[fixtureId];
  if (!definition) throw new Error(`Unknown legacy balance fixture: ${fixtureId}`);
  const item = {
    attackDamage: scaleLegacyItemStat(definition.itemStats.attackDamage, level, { integer: true }),
    maxEnergy: scaleLegacyItemStat(definition.itemStats.maxEnergy, level, { integer: true }),
    attackRange: scaleLegacyItemStat(definition.itemStats.attackRange, level),
    attackSpeed: scaleLegacyItemStat(definition.itemStats.attackSpeed, level),
    areaDamage: definition.itemStats.areaDamage
      ? scaleLegacyItemStat(definition.itemStats.areaDamage, level)
      : 0,
  };
  const playerAttack = PLAYER_BASE_ATTACK + Math.max(0, level - 1) * PLAYER_ATTACK_PER_LEVEL;
  const rapid = PLAYER_BASE_RAPID + item.attackSpeed;
  const rapidOutputModifier = clamp(Math.sqrt(rapid / PLAYER_BASE_RAPID), 0.65, 1.75);
  const profile = definition.profile;
  const shotDamage = (playerAttack + item.attackDamage)
    * LEGACY_RANDOM_ROLL_MEAN
    * (1 + item.areaDamage)
    * profile.damageMultiplier
    * LEGACY_EXPECTED_CRITICAL_MULTIPLIER;
  const reloadDuration = Math.max(
    0.42,
    1.35 - Math.min(PLAYER_BASE_ENERGY_RECHARGE, 0.9) * 0.36,
  );
  return deepFreeze({
    kind: 'legacy',
    id: definition.id,
    label: definition.label,
    reportOnly: Boolean(definition.reportOnly),
    level,
    item,
    profile,
    shotDamage,
    directPower: profile.direct ? shotDamage : 0,
    splashPower: shotDamage * profile.splashMultiplier,
    maxEnergy: PLAYER_BASE_ENERGY + item.maxEnergy,
    energyCost: profile.energyCost,
    cycleTime: profile.cooldownMultiplier / rapid,
    range: PLAYER_BASE_RANGE + item.attackRange + 1.8,
    projectileSpeed: profile.projectileSpeed,
    projectileCount: profile.projectileCount,
    outputCost: profile.outputCost / rapidOutputModifier,
    outputRequired: profile.outputRequired / Math.sqrt(rapidOutputModifier),
    outputRecovery: profile.outputRecovery * rapidOutputModifier,
    outputRecoveryDelay: LEGACY_OUTPUT_RECOVERY_DELAY,
    outputVent: profile.outputVent,
    outputStarvedCooldown: profile.outputStarvedCooldown,
    reloadDuration,
    guidance: Boolean(profile.guidance),
    spread: profile.spread ?? 0,
    splashRadius: profile.splashRadius,
    weakPointCapable: Boolean(profile.direct),
    stagger: fixtureId === 'cannon' ? 0.32 : fixtureId === 'missile' ? 0.22 : 0,
  });
}

function getCachedLegacyBalanceFixture(fixtureId, level) {
  const key = `${level}:${fixtureId}`;
  if (!LEGACY_FIXTURE_CACHE.has(key)) {
    LEGACY_FIXTURE_CACHE.set(key, createLegacyBalanceFixture(fixtureId, level));
  }
  return LEGACY_FIXTURE_CACHE.get(key);
}

function simulateLegacyShotSchedule(fixture, horizon = DEFAULT_HORIZON) {
  // A fixed 240 Hz request loop mirrors held-fire browser updates while
  // remaining deterministic and independent of display frame rate.
  const dt = 1 / 240;
  const shotTimes = [];
  let time = 0;
  let energy = fixture.maxEnergy;
  let output = 1;
  let outputDelay = 0;
  let cooldown = 0;
  let reload = 0;
  while (time <= horizon + EPSILON) {
    cooldown = Math.max(0, cooldown - dt);
    outputDelay = Math.max(0, outputDelay - dt);
    if (reload > 0) {
      reload = Math.max(0, reload - dt);
      if (reload <= EPSILON) energy = fixture.maxEnergy;
    }
    if (outputDelay <= EPSILON) {
      output = Math.min(1, output + fixture.outputRecovery * dt);
    }

    if (reload <= EPSILON && cooldown <= EPSILON) {
      if (energy + EPSILON < fixture.energyCost) {
        reload = fixture.reloadDuration;
      } else if (output + EPSILON < fixture.outputRequired) {
        cooldown = output <= EPSILON ? fixture.outputVent : fixture.outputStarvedCooldown;
      } else {
        shotTimes.push(time);
        energy = Math.max(0, energy - fixture.energyCost);
        output = Math.max(0, output - fixture.outputCost);
        outputDelay = fixture.outputRecoveryDelay;
        const lowOutput = 1 - output;
        const lowOutputCycleScale = fixture.id === 'machineGun' ? 1 + lowOutput * 0.42 : 1;
        cooldown = fixture.cycleTime * lowOutputCycleScale;
        if (energy <= EPSILON) reload = fixture.reloadDuration;
      }
    }
    time += dt;
  }
  return shotTimes;
}

function simulateBusterShotSchedule(weapon, horizon = DEFAULT_HORIZON) {
  const shotTimes = [];
  let requestTime = 0;
  let energy = weapon.maxEnergy;
  let lastShotTime = Number.NEGATIVE_INFINITY;
  while (requestTime <= horizon + EPSILON) {
    if (energy + EPSILON >= weapon.energyCost) {
      shotTimes.push(requestTime);
      energy = Math.max(0, energy - weapon.energyCost);
      lastShotTime = requestTime;
      requestTime += weapon.cycleTime;
      continue;
    }
    // Any insufficient request enters recovery lock. Held fire does not refill
    // before this transition, and the failed request does not restart delay.
    const rechargeStart = Math.max(requestTime, lastShotTime + BUSTER_RECHARGE_DELAY);
    const rechargeRate = weapon.maxEnergy / BUSTER_RECHARGE_DURATION;
    requestTime = rechargeStart + (weapon.maxEnergy - energy) / rechargeRate;
    energy = weapon.maxEnergy;
  }
  return shotTimes;
}

function countShotsAtOrBefore(shotTimes, horizon) {
  let low = 0;
  let high = shotTimes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (shotTimes[middle] <= horizon + EPSILON) low = middle + 1;
    else high = middle;
  }
  return low;
}

function adaptCompiledPlan(id, plan, {
  powerScale = 1,
  energyCost = plan.stats.energyCost,
  isMega = false,
} = {}) {
  const triggerDistance = plan.trigger?.event === 'delay'
    ? Math.min(plan.stats.rootRange, plan.stats.projectileSpeed * (plan.trigger.delay ?? 0))
    : 0;
  const effectiveRange = plan.trigger
    ? triggerDistance + plan.stats.childRange
    : plan.stats.rootRange;
  return deepFreeze({
    kind: 'buster',
    id,
    label: id,
    plan,
    isMega,
    directPower: plan.payload.type === 'explosion' ? 0 : plan.stats.effectivePower * powerScale,
    splashPower: plan.payload.type === 'explosion' ? plan.stats.effectivePower * powerScale : 0,
    shotDamage: plan.stats.effectivePower * powerScale,
    maxEnergy: plan.stats.maxEnergy,
    energyCost,
    cycleTime: plan.stats.cycleTime,
    range: effectiveRange,
    rootRange: plan.stats.rootRange,
    childRange: plan.stats.childRange,
    triggerDistance,
    triggerDelay: plan.trigger?.event === 'delay' ? plan.trigger.delay : 0,
    projectileSpeed: plan.stats.projectileSpeed,
    projectileCount: plan.stats.projectileCount,
    guidance: Boolean(plan.rootGuidance || plan.childGuidance),
    splitterPattern: plan.splitter?.pattern ?? null,
    splashRadius: plan.payload.radius ?? 0,
    weakPointCapable: plan.payload.type !== 'explosion',
    stagger: plan.stats.stagger * powerScale,
    peakProjectileReservation: plan.peakProjectileReservation,
    projectileSecondsPerExecution: plan.occupancy.projectileSecondsPerExecution,
    occupancyEstimate: plan.occupancy.estimatedSteadyMovingProjectiles,
    shotsPerMagazine: Math.floor(plan.stats.maxEnergy / energyCost),
    rawPowerMultiplier: plan.stats.rawEffectiveMultiplier,
    softCapActive: plan.stats.powerSoftCap.active,
    warnings: plan.warnings,
  });
}

const COMPILED_CANONICAL_PLAN_CACHE = new Map();

function getCompiledCanonicalPlans(level, level10Scalar) {
  const key = `${level}:${level10Scalar}`;
  if (!COMPILED_CANONICAL_PLAN_CACHE.has(key)) {
    const compile = (source) => compileBusterBuild(source, {
      combatDepthLevel: level,
      level10PowerScalar: level10Scalar,
    });
    COMPILED_CANONICAL_PLAN_CACHE.set(key, deepFreeze({
      pulse: compile(CANONICAL_SOURCES.balancedBarePulse),
      mortar: compile(CANONICAL_SOURCES.balancedBareMortar),
      pursuit: compile(CANONICAL_SOURCES.pursuitPulse),
      spreadExplosion: compile(CANONICAL_SOURCES.directSpreadExplosion),
      delayedCluster: compile(CANONICAL_SOURCES.delayedMortarClusterExplosion),
      delayedExplosion: compile(CANONICAL_SOURCES.delayedMortarExplosion),
    }));
  }
  return COMPILED_CANONICAL_PLAN_CACHE.get(key);
}

/** Compile the six approved canonical presets for one search candidate. */
export function compileCanonicalBusterBalancePresets({
  level = 1,
  level10Scalar = STORED_BUSTER_BALANCE_CONSTANTS.level10Scalar,
  mortarPower = STORED_BUSTER_BALANCE_CONSTANTS.mortarPower,
  clusterEnergySurcharge = STORED_BUSTER_BALANCE_CONSTANTS.clusterEnergySurcharge,
  clusterExplosionCompoundSurcharge = STORED_BUSTER_BALANCE_CONSTANTS.clusterExplosionCompoundSurcharge,
} = {}) {
  const {
    pulse,
    mortar,
    pursuit,
    spreadExplosion,
    delayedCluster,
    delayedExplosion,
  } = getCompiledCanonicalPlans(level, level10Scalar);
  const mortarScale = mortarPower / BUSTER_MODULE_CATALOG.mortarShell.basePower;
  const megaPowerScale = getBusterTuningMultiplier(6) / getBusterTuningMultiplier(4);
  const delayedClusterEnergy = BUSTER_MODULE_CATALOG.mortarShell.energyCost
    + Math.min(clusterEnergySurcharge + BUSTER_MODULE_CATALOG.explosion.energyCost,
      clusterExplosionCompoundSurcharge);
  return deepFreeze({
    liveCalibratedMega: adaptCompiledPlan('liveCalibratedMega', pulse, {
      powerScale: megaPowerScale,
      energyCost: 2,
      isMega: true,
    }),
    balancedBarePulse: adaptCompiledPlan('balancedBarePulse', pulse),
    balancedBareMortar: adaptCompiledPlan('balancedBareMortar', mortar, { powerScale: mortarScale }),
    pursuitPulse: adaptCompiledPlan('pursuitPulse', pursuit),
    directSpreadExplosion: adaptCompiledPlan('directSpreadExplosion', spreadExplosion),
    delayedMortarClusterExplosion: adaptCompiledPlan('delayedMortarClusterExplosion', delayedCluster, {
      powerScale: mortarScale,
      energyCost: delayedClusterEnergy,
    }),
    delayedMortarExplosion: adaptCompiledPlan('delayedMortarExplosion', delayedExplosion, {
      powerScale: mortarScale,
    }),
  });
}

function getAimFactor(weapon, scenario) {
  const baseline = { center: 1, 'half-radius': 0.88, edge: 0.64 }[scenario.aimOffset];
  let factor = baseline;
  if (weapon.guidance) factor = 1 - (1 - factor) * 0.18;
  if (weapon.splitterPattern === 'spread') factor = 1 - (1 - factor) * 0.52;
  if (weapon.splashRadius > 0) factor = 1 - (1 - factor) * 0.62;
  if (scenario.motion === 'lateral') {
    if (weapon.guidance) factor *= 0.97;
    else if (weapon.splitterPattern === 'spread') factor *= 0.9;
    else if (weapon.splashRadius > 0) factor *= 0.86;
    else if (weapon.id === 'balancedBareMortar') factor *= 0.68;
    else factor *= 0.76;
  }
  const rangeRatio = scenario.distance / Math.max(EPSILON, weapon.range);
  if (rangeRatio > 1 + EPSILON) return 0;
  if (rangeRatio > 0.82) factor *= 0.92;
  else if (rangeRatio > 0.62) factor *= 0.98;
  return clamp(factor, 0, 1);
}

function getWeakPointChance(weapon, scenario) {
  if (!weapon.weakPointCapable || !scenario.target.weakPointMultiplier) return 0;
  let chance = { center: 0.9, 'half-radius': 0.46, edge: 0.1 }[scenario.aimOffset];
  if (weapon.guidance) chance = 1 - (1 - chance) * 0.5;
  if (scenario.motion === 'lateral') chance *= weapon.guidance ? 0.88 : 0.58;
  return clamp(chance, 0, 1);
}

function getCompactOverlapFactor(weapon) {
  if (weapon.id === 'delayedMortarClusterExplosion') return 0.76;
  if (weapon.splitterPattern === 'spread') return 0.9;
  return 1;
}

function getDamagePackets(weapon, scenario) {
  const accuracy = getAimFactor(weapon, scenario);
  const mitigation = 100 / (100 + scenario.target.armor);
  const weakPointChance = getWeakPointChance(weapon, scenario);
  const weakMultiplier = scenario.target.weakPointMultiplier ?? 1;
  const direct = weapon.directPower
    * (1 + weakPointChance * (weakMultiplier - 1))
    * accuracy
    * mitigation;
  const splash = weapon.splashPower * accuracy * mitigation;
  const count = scenario.targetCount;
  let encounterDamage;
  if (count === 1) {
    encounterDamage = direct + splash;
  } else if (scenario.layout === 'compact' && splash > 0) {
    const overlap = getCompactOverlapFactor(weapon);
    encounterDamage = direct + splash * count * overlap;
  } else if (weapon.projectileCount > 1 && weapon.splitterPattern && splash <= 0) {
    encounterDamage = (direct + splash) * Math.min(count, weapon.projectileCount);
  } else {
    encounterDamage = direct + splash;
  }
  const weakPointDamage = weapon.directPower
    * weakPointChance
    * weakMultiplier
    * accuracy
    * mitigation;
  return {
    accuracy,
    mitigation,
    weakPointChance,
    weakPointDamage,
    perTargetDamage: encounterDamage / count,
    encounterDamage,
  };
}

function getDeliveryDelay(weapon, scenario) {
  if (weapon.triggerDelay > 0) {
    if (scenario.distance <= weapon.triggerDistance + EPSILON) {
      // Approved early-carrier termination delivers the programmed child at
      // contact instead of discarding it.
      return scenario.distance / weapon.projectileSpeed;
    }
    return weapon.triggerDelay
      + (scenario.distance - weapon.triggerDistance) / weapon.projectileSpeed;
  }
  return scenario.distance / weapon.projectileSpeed;
}

function shotTimeForDamage(shotTimes, requiredDamage, damagePerShot, deliveryDelay) {
  if (damagePerShot <= EPSILON || requiredDamage <= 0) return Number.POSITIVE_INFINITY;
  const requiredShots = Math.max(1, Math.ceil((requiredDamage - EPSILON) / damagePerShot));
  const shotTime = shotTimes[requiredShots - 1];
  return Number.isFinite(shotTime) ? shotTime + deliveryDelay : Number.POSITIVE_INFINITY;
}

/** Evaluate one weapon in one deterministic scenario. */
export function evaluateBusterBalanceScenario(weapon, scenario, { horizon = DEFAULT_HORIZON } = {}) {
  let scheduleByHorizon = SHOT_SCHEDULE_CACHE.get(weapon);
  if (!scheduleByHorizon) {
    scheduleByHorizon = new Map();
    SHOT_SCHEDULE_CACHE.set(weapon, scheduleByHorizon);
  }
  if (!scheduleByHorizon.has(horizon)) {
    scheduleByHorizon.set(
      horizon,
      weapon.kind === 'legacy'
        ? simulateLegacyShotSchedule(weapon, horizon)
        : simulateBusterShotSchedule(weapon, horizon),
    );
  }
  const shotTimes = scheduleByHorizon.get(horizon);
  const packets = getDamagePackets(weapon, scenario);
  const deliveryDelay = getDeliveryDelay(weapon, scenario);
  const openingShots = weapon.kind === 'legacy'
    ? Math.floor(weapon.maxEnergy / weapon.energyCost)
    : Math.floor(weapon.maxEnergy / weapon.energyCost);
  const openingShotTimes = shotTimes.slice(0, openingShots);
  const shots10 = countShotsAtOrBefore(shotTimes, Math.max(0, 10 - deliveryDelay));
  const shots30 = countShotsAtOrBefore(shotTimes, Math.max(0, 30 - deliveryDelay));
  const totalHealth = scenario.target.health * scenario.targetCount;
  const singleTargetTtk = shotTimeForDamage(
    shotTimes,
    scenario.target.health,
    packets.perTargetDamage,
    deliveryDelay,
  );
  const roomClearTime = shotTimeForDamage(
    shotTimes,
    totalHealth,
    packets.encounterDamage,
    deliveryDelay,
  );
  const cadenceOver30 = shots30 / 30;
  const occupancy = weapon.kind === 'buster'
    ? weapon.projectileSecondsPerExecution * cadenceOver30
    : weapon.projectileCount * (scenario.distance / weapon.projectileSpeed) * cadenceOver30;
  const firstRecoveryLock = weapon.kind === 'buster'
    ? openingShots * weapon.cycleTime
    : null;
  const weakPointBreakThreshold = scenario.target.health * 0.32;
  const weakPointBreakTime = packets.weakPointDamage > EPSILON
    ? shotTimeForDamage(shotTimes, weakPointBreakThreshold, packets.weakPointDamage, deliveryDelay)
    : Number.POSITIVE_INFINITY;
  return deepFreeze({
    weaponId: weapon.id,
    scenarioId: scenario.id,
    deliveredPowerPerTarget: round(packets.perTargetDamage),
    deliveredEncounterPower: round(packets.encounterDamage),
    rawPowerPerTrigger: round(weapon.directPower + weapon.splashPower),
    mitigation: round(packets.mitigation),
    hitProbability: round(packets.accuracy),
    missTolerance: round(1 - packets.accuracy),
    openingMagazineShots: openingShots,
    openingMagazineDuration: round(openingShotTimes.at(-1) ?? 0),
    openingBatteryPower: round(packets.encounterDamage * openingShots),
    timeToFirstRecoveryLock: round(firstRecoveryLock),
    recoveryTimeFromEmpty: weapon.kind === 'buster' ? BUSTER_RECHARGE_DURATION : weapon.reloadDuration,
    output10s: round(packets.encounterDamage * shots10),
    output30s: round(packets.encounterDamage * shots30),
    sustained10s: round(packets.encounterDamage * shots10 / 10),
    sustained30s: round(packets.encounterDamage * shots30 / 30),
    projectileOccupancy: round(occupancy),
    occupancyWithinReservation: occupancy <= BUSTER_MAX_MOVING_PROJECTILES + EPSILON,
    precisionWeakPointCapable: weapon.weakPointCapable,
    weakPointHitProbability: round(packets.weakPointChance),
    weakPointDamagePerTrigger: round(packets.weakPointDamage),
    weakPointBreakTime: round(weakPointBreakTime),
    deliveryDelay: round(deliveryDelay),
    singleTargetTtk: round(singleTargetTtk),
    roomClearTime: round(roomClearTime),
    staggerSecondsPerTrigger: round(weapon.stagger * packets.accuracy),
    shots10,
    shots30,
  });
}

/**
 * Materializes every approved matrix row for tooling and benchmark-arena
 * inspection. Search uses a smaller declared hard-gate projection, while this
 * report retains all target counts, profiles, offsets, motions, ranges, and
 * layouts, including the report-only Missile fixture.
 */
export function evaluateFullBusterBalanceMatrix({
  constants = STORED_BUSTER_BALANCE_CONSTANTS,
  includeMissile = true,
} = {}) {
  const presetsByLevel = new Map();
  const fixturesByLevel = new Map();
  for (const level of BUSTER_BALANCE_LEVELS) {
    presetsByLevel.set(level, compileCanonicalBusterBalancePresets({ level, ...constants }));
    fixturesByLevel.set(level, {
      machineGun: getCachedLegacyBalanceFixture('machineGun', level),
      cannon: getCachedLegacyBalanceFixture('cannon', level),
      ...(includeMissile ? { missile: getCachedLegacyBalanceFixture('missile', level) } : {}),
    });
  }
  const rows = SCENARIO_MATRIX.map((scenario) => {
    const presets = presetsByLevel.get(scenario.level);
    const fixtures = fixturesByLevel.get(scenario.level);
    return {
      scenario,
      presets: Object.fromEntries(Object.entries(presets)
        .filter(([id]) => id !== 'delayedMortarExplosion')
        .map(([id, weapon]) => [id, evaluateBusterBalanceScenario(weapon, scenario)])),
      fixtures: Object.fromEntries(Object.entries(fixtures)
        .map(([id, weapon]) => [id, evaluateBusterBalanceScenario(weapon, scenario)])),
    };
  });
  return deepFreeze({
    constants: { ...constants },
    scenarioCount: rows.length,
    rows,
  });
}

const GATE_PRESET_DEFINITIONS = deepFreeze({
  liveCalibratedMega: {
    fixtureId: 'machineGun', targetCount: 1, aimOffset: 'center', motion: 'stationary',
    distanceBand: 'mid', layout: 'separated', metric: 'singleTargetTtk',
  },
  balancedBarePulse: {
    fixtureId: 'machineGun', targetCount: 1, aimOffset: 'center', motion: 'stationary',
    distanceBand: 'mid', layout: 'separated', metric: 'singleTargetTtk',
  },
  pursuitPulse: {
    fixtureId: 'machineGun', targetCount: 1, aimOffset: 'half-radius', motion: 'lateral',
    distanceBand: 'mid', layout: 'separated', metric: 'singleTargetTtk',
  },
  balancedBareMortar: {
    fixtureId: 'cannon', targetCount: 1, aimOffset: 'center', motion: 'stationary',
    distanceBand: 'mid', layout: 'separated', metric: 'singleTargetTtk',
  },
  directSpreadExplosion: {
    fixtureId: 'cannon', targetCount: 2, aimOffset: 'half-radius', motion: 'stationary',
    distanceBand: 'mid', layout: 'compact', metric: 'roomClearTime',
  },
  delayedMortarClusterExplosion: {
    fixtureId: 'cannon', targetCount: 4, aimOffset: 'half-radius', motion: 'lateral',
    distanceBand: 'mid', layout: 'compact', metric: 'roomClearTime',
  },
});

export const BUSTER_BALANCE_HARD_GATE_PRESETS = GATE_PRESET_DEFINITIONS;

function relativeError(actual, reference) {
  if (!Number.isFinite(actual) || !Number.isFinite(reference) || reference <= EPSILON) {
    return actual === reference ? 0 : Number.POSITIVE_INFINITY;
  }
  return Math.abs(actual - reference) / reference;
}

function scenarioMatchesGate(scenario, gate) {
  return scenario.targetCount === gate.targetCount
    && scenario.aimOffset === gate.aimOffset
    && scenario.motion === gate.motion
    && scenario.distanceBand === gate.distanceBand
    && scenario.layout === gate.layout;
}

function evaluateCandidateGates(candidate, { includeScenarioMetrics = false } = {}) {
  const failures = [];
  const comparisons = [];
  const reportOnlyMissile = [];
  let totalError = 0;
  let maximumError = 0;
  let comparisonCount = 0;
  const presetCache = new Map();
  const fixtureCache = new Map();

  for (const level of BUSTER_BALANCE_LEVELS) {
    presetCache.set(level, compileCanonicalBusterBalancePresets({ level, ...candidate }));
    for (const fixtureId of Object.keys(LEGACY_FIXTURE_DEFINITIONS)) {
      fixtureCache.set(`${level}:${fixtureId}`, getCachedLegacyBalanceFixture(fixtureId, level));
    }
  }

  for (const [presetId, gate] of Object.entries(GATE_PRESET_DEFINITIONS)) {
    for (const scenario of SCENARIO_MATRIX) {
      if (!scenarioMatchesGate(scenario, gate)) continue;
      const preset = presetCache.get(scenario.level)[presetId];
      const fixture = fixtureCache.get(`${scenario.level}:${gate.fixtureId}`);
      const actual = evaluateBusterBalanceScenario(preset, scenario);
      const reference = evaluateBusterBalanceScenario(fixture, scenario);
      const actualValue = actual[gate.metric];
      const referenceValue = reference[gate.metric];
      const error = relativeError(actualValue, referenceValue);
      const comparison = {
        id: `${presetId}:${scenario.id}:${gate.metric}`,
        presetId,
        fixtureId: gate.fixtureId,
        scenarioId: scenario.id,
        level: scenario.level,
        targetProfileId: scenario.targetProfileId,
        metric: gate.metric,
        actual: actualValue,
        reference: referenceValue,
        relativeError: round(error),
        tolerance: BUSTER_BALANCE_SEARCH.ttkTolerance,
        passed: error <= BUSTER_BALANCE_SEARCH.ttkTolerance + EPSILON,
        ...(includeScenarioMetrics ? { actualMetrics: actual, referenceMetrics: reference } : {}),
      };
      comparisons.push(comparison);
      comparisonCount += 1;
      totalError += Number.isFinite(error) ? error : 1000;
      maximumError = Math.max(maximumError, Number.isFinite(error) ? error : 1000);
      if (!comparison.passed) failures.push(comparison);

      const missile = fixtureCache.get(`${scenario.level}:missile`);
      const missileMetrics = evaluateBusterBalanceScenario(missile, scenario);
      reportOnlyMissile.push({
        presetId,
        scenarioId: scenario.id,
        metric: gate.metric,
        buster: actualValue,
        missile: missileMetrics[gate.metric],
        relativeError: round(relativeError(actualValue, missileMetrics[gate.metric])),
      });
    }
  }
  return {
    passed: failures.length === 0,
    comparisonCount,
    comparisons,
    failures,
    failedCount: failures.length,
    meanRelativeError: comparisonCount > 0 ? totalError / comparisonCount : 0,
    maximumRelativeError: maximumError,
    reportOnlyMissile,
    presetCache,
  };
}

function findScenario(criteria) {
  return SCENARIO_MATRIX.find((scenario) => Object.entries(criteria).every(
    ([key, value]) => scenario[key] === value,
  ));
}

function evaluateDominance(candidate) {
  const relationships = [
    ['pursuitPulse', 'balancedBarePulse'],
    ['directSpreadExplosion', 'balancedBarePulse'],
    ['delayedMortarClusterExplosion', 'delayedMortarExplosion'],
  ];
  const results = [];
  for (const [addedId, baseId] of relationships) {
    let strictlyWorseEverywhere = true;
    let compared = 0;
    for (const level of BUSTER_BALANCE_LEVELS) {
      const presets = compileCanonicalBusterBalancePresets({ level, ...candidate });
      for (const targetCount of BUSTER_BALANCE_TARGET_COUNTS) {
        for (const aimOffset of BUSTER_BALANCE_AIM_OFFSETS) {
          for (const motion of BUSTER_BALANCE_MOTIONS) {
            for (const layout of BUSTER_BALANCE_LAYOUTS) {
              const scenario = findScenario({
                level, targetCount, targetProfileId: 'ordinary', aimOffset, motion,
                distanceBand: 'mid', layout,
              });
              const added = evaluateBusterBalanceScenario(presets[addedId], scenario);
              const base = evaluateBusterBalanceScenario(presets[baseId], scenario);
              compared += 1;
              const isAtLeastTwoPercentWorse = added.roomClearTime >= base.roomClearTime
                * (1 + BUSTER_BALANCE_SEARCH.dominanceMargin) - EPSILON;
              if (!isAtLeastTwoPercentWorse) strictlyWorseEverywhere = false;
            }
          }
        }
      }
    }
    results.push({
      addedId,
      baseId,
      compared,
      dominated: strictlyWorseEverywhere,
    });
  }
  return results;
}

function evaluateNonsenseDetectors(candidate, gateEvaluation) {
  const failures = [];
  const presets = compileCanonicalBusterBalancePresets({ level: 10, ...candidate });
  for (const weapon of Object.values(presets)) {
    if (weapon.energyCost <= 0) {
      failures.push({ code: 'NON_POSITIVE_HELD_ENERGY_DRAIN', weaponId: weapon.id });
    }
    if (weapon.peakProjectileReservation > BUSTER_MAX_MOVING_PROJECTILES) {
      failures.push({ code: 'PROJECTILE_RESERVATION_OVERFLOW', weaponId: weapon.id });
    }
    for (const warning of weapon.warnings ?? []) {
      if (warning.code === 'TRIGGER_UNREACHABLE') {
        failures.push({ code: 'TIMED_TRIGGER_UNREACHABLE', weaponId: weapon.id });
      }
    }
  }

  const delayed = presets.delayedMortarClusterExplosion;
  if (delayed.plan.trigger?.carrierTerminationBehavior !== 'deliver-child') {
    failures.push({ code: 'GUIDANCE_BRANCH_SABOTAGE', weaponId: delayed.id });
  }
  if (getBusterMaxEnergy(4) !== 6) {
    failures.push({ code: 'UNDEFINED_SHARED_ENERGY_RATING', energyRating: 4 });
  }

  // Shots per magazine depend only on Energy cost, never on module-added cycle
  // delay, because held unlocked weapons do not recharge.
  const barePulseShots = presets.balancedBarePulse.shotsPerMagazine;
  const pursuitShots = presets.pursuitPulse.shotsPerMagazine;
  if (pursuitShots > barePulseShots) {
    failures.push({ code: 'CYCLE_DELAY_ENERGY_REFUND', weaponId: 'pursuitPulse' });
  }

  const dominance = evaluateDominance(candidate);
  for (const result of dominance) {
    if (result.dominated) failures.push({ code: 'STRICT_MODULE_DOMINANCE', ...result });
  }

  const mega = presets.liveCalibratedMega;
  const pulse = presets.balancedBarePulse;
  const customDominatesMega = pulse.shotDamage > mega.shotDamage + EPSILON
    && pulse.shotsPerMagazine > mega.shotsPerMagazine
    && pulse.range > mega.range + EPSILON
    && 1 / pulse.cycleTime > 1 / mega.cycleTime + EPSILON;
  if (customDominatesMega) failures.push({ code: 'CUSTOM_PULSE_DOMINATES_MEGA' });

  const level10Failures = gateEvaluation.failures.filter((failure) => failure.level === 10);
  if (level10Failures.length > 0) {
    failures.push({
      code: 'LEVEL_10_TTK_ENVELOPE',
      failedComparisons: level10Failures.length,
      worst: [...level10Failures]
        .sort((left, right) => right.relativeError - left.relativeError)
        .slice(0, 5),
    });
  }

  return { passed: failures.length === 0, failures, dominance };
}

function mortarPreferenceOrder() {
  const { min, max, step, preferred } = BUSTER_BALANCE_SEARCH.mortarPower;
  const values = [];
  for (let value = min; value <= max + EPSILON; value += step) values.push(round(value, 3));
  return values.sort((left, right) => (
    Math.abs(left - preferred) - Math.abs(right - preferred)
    || left - right
  ));
}

function scalarSearchOrder() {
  const { min, max, step } = BUSTER_BALANCE_SEARCH.level10PowerScalar;
  const values = [];
  for (let value = min; value <= max + EPSILON; value += step) values.push(round(value, 3));
  return values;
}

function candidateRank(evaluation) {
  return [
    evaluation.gates.failedCount + evaluation.detectors.failures.length * 100,
    evaluation.gates.meanRelativeError,
    evaluation.gates.maximumRelativeError,
    evaluation.constants.level10Scalar,
    Math.abs(evaluation.constants.mortarPower - BUSTER_BALANCE_SEARCH.mortarPower.preferred),
    evaluation.constants.mortarPower,
  ];
}

function compareRanks(left, right) {
  const leftRank = candidateRank(left);
  const rightRank = candidateRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return leftRank[index] - rightRank[index];
  }
  return 0;
}

function evaluateCandidate(constants, options = {}) {
  const gates = evaluateCandidateGates(constants, options);
  const detectors = options.evaluateDetectors === false
    ? { passed: true, failures: [], dominance: [], deferred: true }
    : evaluateNonsenseDetectors(constants, gates);
  const passed = gates.passed && detectors.passed;
  const { presetCache, ...serializableGates } = gates;
  return deepFreeze({
    passed,
    constants: { ...constants },
    gates: serializableGates,
    detectors,
  });
}

function clusterFallbackPolicy() {
  const base = {
    level10Scalar: 1,
    mortarPower: BUSTER_BALANCE_SEARCH.mortarPower.preferred,
    clusterEnergySurcharge: 2,
    clusterExplosionCompoundSurcharge: 3,
  };
  const dominance = evaluateDominance(base);
  const clusterRelationship = dominance.find(
    (entry) => entry.addedId === 'delayedMortarClusterExplosion',
  );
  if (clusterRelationship?.dominated) {
    return {
      clusterEnergySurcharge: 1,
      clusterExplosionCompoundSurcharge: 2,
      reason: 'cluster-broadly-dominated',
    };
  }
  const strongestAuthorized = evaluateCandidateGates({
    level10Scalar: BUSTER_BALANCE_SEARCH.level10PowerScalar.max,
    mortarPower: BUSTER_BALANCE_SEARCH.mortarPower.max,
    clusterEnergySurcharge: 2,
    clusterExplosionCompoundSurcharge: 3,
  });
  const failedPresetIds = new Set(strongestAuthorized.failures.map((failure) => failure.presetId));
  if (failedPresetIds.size === 1 && failedPresetIds.has('delayedMortarClusterExplosion')) {
    return {
      clusterEnergySurcharge: 2,
      clusterExplosionCompoundSurcharge: 2,
      reason: 'cluster-explosion-only-envelope-failure',
    };
  }
  return {
    clusterEnergySurcharge: 2,
    clusterExplosionCompoundSurcharge: 3,
    reason: 'fallback-not-authorized',
  };
}

/**
 * Exhaustively searches only the authorized scalar and Mortar ranges. It does
 * not mutate catalog constants and does not invent a fallback when no candidate
 * passes. The nearest candidate is diagnostic only.
 */
export function runBusterBalanceSearch({ includeScenarioMetrics = false } = {}) {
  const fallback = clusterFallbackPolicy();
  let selected = null;
  let nearest = null;
  let evaluatedCandidates = 0;
  for (const level10Scalar of scalarSearchOrder()) {
    for (const mortarPower of mortarPreferenceOrder()) {
      const constants = {
        level10Scalar,
        mortarPower,
        clusterEnergySurcharge: fallback.clusterEnergySurcharge,
        clusterExplosionCompoundSurcharge: fallback.clusterExplosionCompoundSurcharge,
      };
      const envelopeEvaluation = evaluateCandidate(constants, {
        includeScenarioMetrics,
        evaluateDetectors: false,
      });
      evaluatedCandidates += 1;
      if (!nearest || compareRanks(envelopeEvaluation, nearest) < 0) nearest = envelopeEvaluation;
      if (envelopeEvaluation.gates.passed) {
        const fullEvaluation = evaluateCandidate(constants, { includeScenarioMetrics });
        if (fullEvaluation.passed) {
          selected = fullEvaluation;
          break;
        }
      }
    }
    if (selected) break;
  }
  if (!selected && nearest) {
    nearest = evaluateCandidate(nearest.constants, { includeScenarioMetrics });
  }
  const result = {
    releaseReady: Boolean(selected),
    evaluatedCandidates,
    selected,
    nearest,
    authorizedSearch: BUSTER_BALANCE_SEARCH,
    clusterFallback: fallback,
    matrix: {
      scenarioCount: SCENARIO_MATRIX.length,
      levels: BUSTER_BALANCE_LEVELS,
      targetCounts: BUSTER_BALANCE_TARGET_COUNTS,
      targetProfiles: Object.keys(TARGET_PROFILE_DEFINITIONS),
      aimOffsets: BUSTER_BALANCE_AIM_OFFSETS,
      motions: BUSTER_BALANCE_MOTIONS,
      distances: BUSTER_BALANCE_DISTANCES,
      layouts: BUSTER_BALANCE_LAYOUTS,
    },
  };
  return deepFreeze(result);
}

export class BusterBalanceGateError extends Error {
  constructor(result) {
    const nearest = result?.nearest;
    const suffix = nearest
      ? ` Nearest authorized candidate: level10Scalar=${nearest.constants.level10Scalar}, mortarPower=${nearest.constants.mortarPower}; ${nearest.gates.failedCount} envelope failures.`
      : '';
    super(`Custom Buster deterministic balance gate has no releasable candidate.${suffix}`);
    this.name = 'BusterBalanceGateError';
    this.code = 'BUSTER_BALANCE_GATE_FAILED';
    this.result = result;
  }
}

/** Strict release verifier used by the CLI and eventual hard-CI wiring. */
export function verifyBusterBalanceSelection(options = {}) {
  const result = runBusterBalanceSearch(options);
  if (!result.releaseReady) throw new BusterBalanceGateError(result);
  return result.selected;
}

export function summarizeBusterBalanceResult(result, { failureLimit = 12 } = {}) {
  const candidate = result.selected ?? result.nearest;
  if (!candidate) return { releaseReady: false, message: 'No candidates were evaluated.' };
  const failures = [...candidate.gates.failures]
    .sort((left, right) => right.relativeError - left.relativeError)
    .slice(0, failureLimit)
    .map((failure) => ({
      presetId: failure.presetId,
      fixtureId: failure.fixtureId,
      scenarioId: failure.scenarioId,
      metric: failure.metric,
      actual: failure.actual,
      reference: failure.reference,
      relativeError: failure.relativeError,
    }));
  return deepFreeze({
    releaseReady: result.releaseReady,
    evaluatedCandidates: result.evaluatedCandidates,
    constants: candidate.constants,
    failedComparisons: candidate.gates.failedCount,
    comparisonCount: candidate.gates.comparisonCount,
    meanRelativeError: round(candidate.gates.meanRelativeError),
    maximumRelativeError: round(candidate.gates.maximumRelativeError),
    detectorFailures: candidate.detectors.failures,
    clusterFallback: result.clusterFallback,
    failures,
  });
}
