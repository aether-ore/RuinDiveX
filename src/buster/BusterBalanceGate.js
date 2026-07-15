import {
  BUSTER_MAX_MOVING_PROJECTILES,
  BUSTER_MODULE_CATALOG,
  BUSTER_RULESET_VERSION,
} from './catalog.js';
import { compileBusterBuild, compileMegaBusterPlan } from './compiler.js';
import {
  BUSTER_BENCHMARK_FIXTURE,
  BUSTER_BALANCE_TARGET_PROFILES as SIMULATOR_TARGET_PROFILES,
  createBusterBalanceScenarioMatrix as createSimulatorScenarioMatrix,
  createBusterBenchmarkScenario,
  simulateBusterEncounter,
  simulateBusterRotation,
  summarizeBusterSimulation,
} from './BusterBalanceSimulator.js';

const EPSILON = 1e-9;
const BALANCED_TUNING = Object.freeze({ power: 4, energy: 4, range: 4, rapid: 4 });
const LIVE_MEGA_TUNING = Object.freeze({ power: 6, energy: 4, range: 4, rapid: 4 });
const ROLE_LEVEL = 5;
const ROLE_MARGIN = 0.02;
const DEFAULT_FAILURE_LIMIT = 12;

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
export const BUSTER_BALANCE_MOTIONS = Object.freeze(['stationary', 'lateral', 'crossing']);
export const BUSTER_BALANCE_DISTANCES = BUSTER_BENCHMARK_FIXTURE.distances;
export const BUSTER_BALANCE_LAYOUTS = Object.freeze(['compact', 'separated']);
export const BUSTER_BALANCE_TARGET_PROFILES = SIMULATOR_TARGET_PROFILES;

/** Production values are inputs to the verdict, never outputs selected by it. */
export const STORED_BUSTER_BALANCE_CONSTANTS = Object.freeze({
  level10Scalar: 1,
  mortarPower: 15,
  clusterEnergySurcharge: 2,
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

function nearlyEqual(left, right, epsilon = EPSILON) {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= epsilon * Math.max(1, Math.abs(left), Math.abs(right));
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

/** Canonical source graphs for every frozen role and its direct comparator. */
export function createCanonicalBusterBalanceSources() {
  return deepFreeze({
    balancedBarePulse: sourceBuild('balance-bare-pulse', [node('emitter', 'pulseBolt')]),
    balancedBareMortar: sourceBuild('balance-bare-mortar', [node('emitter', 'mortarShell')]),
    pursuitPulse: sourceBuild(
      'balance-pursuit-pulse',
      [node('emitter', 'pulseBolt'), node('guidance', 'pursuitGuidance')],
      [edge('emitter', 'next', 'guidance')],
    ),
    directExplosion: sourceBuild(
      'balance-direct-explosion',
      [node('emitter', 'pulseBolt'), node('payload', 'explosion')],
      [edge('emitter', 'next', 'payload')],
    ),
    directSpreadExplosion: sourceBuild(
      'balance-spread-explosion',
      [node('emitter', 'pulseBolt'), node('spread', 'spread3'), node('payload', 'explosion')],
      [edge('emitter', 'next', 'spread'), edge('spread', 'next', 'payload')],
    ),
    delayedMortarExplosion: sourceBuild(
      'balance-delayed-mortar-explosion',
      [node('emitter', 'mortarShell'), node('trigger', 'afterDelay'), node('payload', 'explosion')],
      [edge('emitter', 'next', 'trigger'), edge('trigger', 'child', 'payload')],
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
    rootGuidedDelayedMortarClusterExplosion: sourceBuild(
      'balance-root-guided-delayed-cluster-explosion',
      [
        node('emitter', 'mortarShell'),
        node('guidance', 'pursuitGuidance'),
        node('trigger', 'afterDelay'),
        node('cluster', 'cluster5'),
        node('payload', 'explosion'),
      ],
      [
        edge('emitter', 'next', 'guidance'),
        edge('guidance', 'next', 'trigger'),
        edge('trigger', 'child', 'cluster'),
        edge('cluster', 'next', 'payload'),
      ],
    ),
    childGuidedDelayedMortarClusterExplosion: sourceBuild(
      'balance-child-guided-delayed-cluster-explosion',
      [
        node('emitter', 'mortarShell'),
        node('trigger', 'afterDelay'),
        node('guidance', 'pursuitGuidance'),
        node('cluster', 'cluster5'),
        node('payload', 'explosion'),
      ],
      [
        edge('emitter', 'next', 'trigger'),
        edge('trigger', 'child', 'guidance'),
        edge('guidance', 'next', 'cluster'),
        edge('cluster', 'next', 'payload'),
      ],
    ),
    apexMortarExplosion: sourceBuild(
      'balance-apex-mortar-explosion',
      [node('emitter', 'mortarShell'), node('trigger', 'atApex'), node('payload', 'explosion')],
      [edge('emitter', 'next', 'trigger'), edge('trigger', 'child', 'payload')],
    ),
    terminalMortarExplosion: sourceBuild(
      'balance-terminal-mortar-explosion',
      [node('emitter', 'mortarShell'), node('trigger', 'onImpact'), node('payload', 'explosion')],
      [edge('emitter', 'next', 'trigger'), edge('trigger', 'child', 'payload')],
    ),
  });
}

const CANONICAL_SOURCES = createCanonicalBusterBalanceSources();

function diagnosticCompileOptions({
  level,
  level10Scalar,
  mortarPower,
  clusterEnergySurcharge,
}) {
  const balanceOverrides = {};
  if (mortarPower !== BUSTER_MODULE_CATALOG.mortarShell.basePower) {
    balanceOverrides.mortarShell = { basePower: mortarPower };
  }
  if (clusterEnergySurcharge !== BUSTER_MODULE_CATALOG.cluster5.energyCost) {
    balanceOverrides.cluster5 = { energyCost: clusterEnergySurcharge };
  }
  const diagnostic = Object.keys(balanceOverrides).length > 0 || level10Scalar !== 1;
  return {
    combatDepthLevel: level,
    throwOnError: false,
    ...(diagnostic ? {
      diagnosticContext: true,
      level10PowerScalar: level10Scalar,
      balanceOverrides,
    } : {}),
  };
}

/**
 * Compile the frozen catalog or a clearly marked diagnostic candidate. No
 * value is patched after compilation, so packets, ledgers, occupancy, and
 * validation always describe the plan that is simulated.
 */
export function compileCanonicalBusterBalancePresets({
  level = ROLE_LEVEL,
  level10Scalar = STORED_BUSTER_BALANCE_CONSTANTS.level10Scalar,
  mortarPower = STORED_BUSTER_BALANCE_CONSTANTS.mortarPower,
  clusterEnergySurcharge = STORED_BUSTER_BALANCE_CONSTANTS.clusterEnergySurcharge,
} = {}) {
  const options = diagnosticCompileOptions({
    level,
    level10Scalar,
    mortarPower,
    clusterEnergySurcharge,
  });
  const compile = (source) => compileBusterBuild(source, options);
  return deepFreeze({
    neutralMega: compileMegaBusterPlan({
      resolvedTuning: BALANCED_TUNING,
      ...options,
    }),
    liveCalibratedMega: compileMegaBusterPlan({
      resolvedTuning: LIVE_MEGA_TUNING,
      ...options,
    }),
    balancedBarePulse: compile(CANONICAL_SOURCES.balancedBarePulse),
    balancedBareMortar: compile(CANONICAL_SOURCES.balancedBareMortar),
    pursuitPulse: compile(CANONICAL_SOURCES.pursuitPulse),
    directExplosion: compile(CANONICAL_SOURCES.directExplosion),
    directSpreadExplosion: compile(CANONICAL_SOURCES.directSpreadExplosion),
    delayedMortarExplosion: compile(CANONICAL_SOURCES.delayedMortarExplosion),
    delayedMortarClusterExplosion: compile(CANONICAL_SOURCES.delayedMortarClusterExplosion),
    rootGuidedDelayedMortarClusterExplosion: compile(
      CANONICAL_SOURCES.rootGuidedDelayedMortarClusterExplosion,
    ),
    childGuidedDelayedMortarClusterExplosion: compile(
      CANONICAL_SOURCES.childGuidedDelayedMortarClusterExplosion,
    ),
    apexMortarExplosion: compile(CANONICAL_SOURCES.apexMortarExplosion),
    terminalMortarExplosion: compile(CANONICAL_SOURCES.terminalMortarExplosion),
  });
}

export function createBusterBalanceScenarioMatrix() {
  return createSimulatorScenarioMatrix();
}

const ROLE_SCENARIO_OPTIONS = deepFreeze({
  single: {
    level: ROLE_LEVEL, targetCount: 1, profile: 'ordinary', distanceBand: 'mid',
    layout: 'compact', motion: 'stationary', aimOffset: 'center', nonlethal: true, duration: 30,
  },
  pursuit: {
    level: ROLE_LEVEL, targetCount: 1, profile: 'ordinary', distanceBand: 'far',
    layout: 'compact', motion: 'lateral', aimOffset: 'half-radius', aimSign: 1,
    nonlethal: true, duration: 30,
  },
  compactTwo: {
    level: ROLE_LEVEL, targetCount: 2, profile: 'ordinary', distanceBand: 'mid',
    layout: 'compact', motion: 'stationary', aimOffset: 'center', nonlethal: true, duration: 30,
  },
  compactFour: {
    level: ROLE_LEVEL, targetCount: 4, profile: 'ordinary', distanceBand: 'mid',
    layout: 'compact', motion: 'stationary', aimOffset: 'center', nonlethal: true, duration: 30,
  },
  spreadSeparated: {
    level: ROLE_LEVEL, targetCount: 4, profile: 'ordinary', distanceBand: 'mid',
    layout: 'separated', motion: 'stationary', aimOffset: 'half-radius', aimSign: 1,
    nonlethal: true, duration: 30,
  },
  clusterSeparated: {
    level: ROLE_LEVEL, targetCount: 4, profile: 'ordinary', distanceBand: 'mid',
    layout: 'separated', motion: 'stationary', aimOffset: 'center', nonlethal: true, duration: 30,
  },
  crossing: {
    level: ROLE_LEVEL, targetCount: 2, profile: 'ordinary', distanceBand: 'far',
    layout: 'separated', motion: 'crossing', aimOffset: 'half-radius', aimSign: -1,
    nonlethal: true, duration: 30,
  },
  weakPoint: {
    level: ROLE_LEVEL, targetCount: 1, profile: 'weakPoint', distanceBand: 'mid',
    layout: 'compact', motion: 'stationary', aimOffset: 'center', nonlethal: true, duration: 30,
  },
});

export function createBusterBalanceRoleScenarios() {
  return deepFreeze(Object.fromEntries(Object.entries(ROLE_SCENARIO_OPTIONS).map(
    ([id, options]) => [id, createBusterBenchmarkScenario({ id: `role:${id}`, ...options })],
  )));
}

/** Declarative metadata is validated before any role predicate is run. */
export const BUSTER_BALANCE_ROLE_CONTRACTS = deepFreeze([
  {
    id: 'neutral-mega-parity', type: 'static', actualPlanId: 'neutralMega',
    comparatorPlanId: 'balancedBarePulse', metrics: ['packet', 'energy', 'range', 'cadence'],
  },
  {
    id: 'live-mega-identity', type: 'static', actualPlanId: 'liveCalibratedMega',
    comparatorPlanId: 'balancedBarePulse', metrics: ['packet', 'energy', 'range', 'cadence'],
  },
  {
    id: 'pursuit-delivery', type: 'simulation', actualPlanId: 'pursuitPulse',
    comparatorPlanId: 'balancedBarePulse', scenarioIds: ['pursuit'],
    metric: 'output10s', direction: 'greater', ratio: 1.02,
  },
  {
    id: 'mortar-heavy-role', type: 'static', actualPlanId: 'balancedBareMortar',
    comparatorPlanId: 'balancedBarePulse', metrics: ['packet', 'stagger', 'magazine', 'cadence'],
  },
  {
    id: 'direct-explosion-compact-role', type: 'simulation', actualPlanId: 'directExplosion',
    comparatorPlanId: 'balancedBarePulse', scenarioIds: ['compactTwo', 'compactFour', 'single', 'weakPoint'],
    metric: 'output10s', direction: 'mixed', ratio: 1.02,
  },
  {
    id: 'spread-explosion-width-role', type: 'simulation', actualPlanId: 'directSpreadExplosion',
    comparatorPlanId: 'directExplosion', scenarioIds: ['spreadSeparated', 'single'],
    metric: 'output10s', direction: 'mixed', ratio: 1.02,
    coverageMetric: 'uniqueTargetsDamaged10s', minimumTargetDelta: 1,
  },
  {
    id: 'delayed-cluster-width-role', type: 'simulation',
    actualPlanId: 'delayedMortarClusterExplosion', comparatorPlanId: 'delayedMortarExplosion',
    scenarioIds: ['clusterSeparated', 'single'], metric: 'output10s', direction: 'mixed',
    ratio: 1.02, coverageMetric: 'uniqueTargetsDamaged10s', minimumTargetDelta: 1,
  },
  {
    id: 'root-guidance-scope', type: 'simulation',
    actualPlanId: 'rootGuidedDelayedMortarClusterExplosion',
    comparatorPlanId: 'delayedMortarClusterExplosion', scenarioIds: ['crossing'],
    metric: 'output10s', direction: 'greater', ratio: 1.02,
  },
  {
    id: 'child-guidance-scope', type: 'simulation',
    actualPlanId: 'childGuidedDelayedMortarClusterExplosion',
    comparatorPlanId: 'delayedMortarClusterExplosion', scenarioIds: ['crossing'],
    metric: 'output10s', direction: 'greater', ratio: 1.02,
  },
  {
    id: 'trigger-semantics', type: 'static', actualPlanId: 'apexMortarExplosion',
    comparatorPlanId: 'terminalMortarExplosion', metrics: ['event', 'transfer', 'single-delivery'],
  },
  {
    id: 'declared-module-dominance', type: 'aggregate',
    actualPlanId: 'pursuitPulse', comparatorPlanId: 'balancedBarePulse',
    metrics: ['declared-role-output'],
  },
]);

const BUSTER_BALANCE_CONTRACT_TYPES = new Set(['static', 'simulation', 'aggregate']);
const BUSTER_BALANCE_COMPARISON_CONTRACT_TYPES = new Set(['static', 'simulation', 'aggregate']);
const BUSTER_BALANCE_METRIC_DIRECTIONS = new Set(['greater', 'less', 'mixed']);
const BUSTER_BALANCE_STATIC_METRICS = new Set([
  'packet',
  'energy',
  'range',
  'cadence',
  'stagger',
  'magazine',
  'event',
  'transfer',
  'single-delivery',
]);
const BUSTER_BALANCE_AGGREGATE_METRICS = new Set(['declared-role-output']);
const BUSTER_BALANCE_SIMULATION_METRICS = new Set([
  'output10s',
  'output30s',
  'deliveredPower',
  'deliveredEncounterPower',
  'incomingPower',
  'mitigation',
  'mitigatedPower',
  'openingMagazinePower',
  'recoveryTime',
  'peakOccupancy',
  'peakProjectileOccupancy',
  'shotsReleased',
  'explosions',
  'explosionTargetHits',
  'weakPointHits',
  'staggerGranted',
  'misses',
  'uniqueTargetsDamagedPerTrigger',
  'uniqueTargetsDamaged10s',
  'releaseToFirstImpact',
  'inputToFirstImpact',
  'releaseRoomClear',
  'inputRoomClear',
  'singleTargetTtk',
  'roomClearTime',
  'preFanOutBudgetPower',
  'preFanOutAllocatedPower',
  'preFanOutConservationDelta',
]);
const BUSTER_BALANCE_COVERAGE_METRICS = new Set([
  'uniqueTargetsDamagedPerTrigger',
  'uniqueTargetsDamaged10s',
]);
const BUSTER_BALANCE_FIXED_HORIZON_OUTPUT_METRICS = new Set(['output10s', 'output30s']);

export function validateBusterBalanceContractRegistry(
  registry = BUSTER_BALANCE_ROLE_CONTRACTS,
  { planIds = Object.keys(compileCanonicalBusterBalancePresets()), scenarioIds = Object.keys(ROLE_SCENARIO_OPTIONS) } = {},
) {
  const errors = [];
  const ids = new Set();
  const knownPlans = new Set(planIds);
  const knownScenarios = new Set(scenarioIds);
  for (const [index, contract] of registry.entries()) {
    const path = `/contracts/${index}`;
    if (!contract?.id || ids.has(contract.id)) {
      errors.push({ code: 'INVALID_CONTRACT_ID', path: `${path}/id`, contractId: contract?.id ?? null });
    } else ids.add(contract.id);
    const type = contract?.type;
    if (!BUSTER_BALANCE_CONTRACT_TYPES.has(type)) {
      errors.push({ code: 'UNKNOWN_CONTRACT_TYPE', path: `${path}/type`, contractId: contract?.id, type });
    }
    if (!knownPlans.has(contract?.actualPlanId)) {
      errors.push({ code: 'UNKNOWN_ACTUAL_PLAN', path: `${path}/actualPlanId`, contractId: contract?.id });
    }
    if (BUSTER_BALANCE_COMPARISON_CONTRACT_TYPES.has(type) && !contract?.comparatorPlanId) {
      errors.push({ code: 'MISSING_COMPARATOR_PLAN', path: `${path}/comparatorPlanId`, contractId: contract?.id });
    } else if (contract?.comparatorPlanId && !knownPlans.has(contract.comparatorPlanId)) {
      errors.push({ code: 'UNKNOWN_COMPARATOR_PLAN', path: `${path}/comparatorPlanId`, contractId: contract?.id });
    }
    if (contract?.ratio != null
      && (!Number.isFinite(contract.ratio) || contract.ratio < 1)) {
      errors.push({ code: 'INVALID_CONTRACT_RATIO', path: `${path}/ratio`, contractId: contract?.id, ratio: contract.ratio });
    }
    if (type === 'simulation') {
      if (!Array.isArray(contract.scenarioIds) || contract.scenarioIds.length === 0) {
        errors.push({ code: 'EMPTY_SCENARIO_SET', path: `${path}/scenarioIds`, contractId: contract?.id });
      }
      for (const scenarioId of contract?.scenarioIds ?? []) {
        if (!knownScenarios.has(scenarioId)) {
          errors.push({ code: 'UNKNOWN_SCENARIO', path: `${path}/scenarioIds`, contractId: contract?.id, scenarioId });
        }
      }
      if (!BUSTER_BALANCE_METRIC_DIRECTIONS.has(contract.direction)) {
        errors.push({ code: 'UNKNOWN_METRIC_DIRECTION', path: `${path}/direction`, contractId: contract?.id });
      }
      if (!BUSTER_BALANCE_SIMULATION_METRICS.has(contract.metric)) {
        errors.push({ code: 'UNKNOWN_CONTRACT_METRIC', path: `${path}/metric`, contractId: contract?.id, metric: contract.metric });
      }
      if (contract.minimumTargetDelta != null && !contract.coverageMetric) {
        errors.push({ code: 'COVERAGE_METRIC_REQUIRED', path: `${path}/coverageMetric`, contractId: contract?.id });
      }
      if (contract.coverageMetric != null
        && !BUSTER_BALANCE_COVERAGE_METRICS.has(contract.coverageMetric)) {
        errors.push({ code: 'UNKNOWN_COVERAGE_METRIC', path: `${path}/coverageMetric`, contractId: contract?.id, metric: contract.coverageMetric });
      }
      if (contract.coverageMetric != null && contract.minimumTargetDelta == null) {
        errors.push({ code: 'COVERAGE_THRESHOLD_REQUIRED', path: `${path}/minimumTargetDelta`, contractId: contract?.id });
      }
      if (contract.minimumTargetDelta != null
        && (!Number.isInteger(contract.minimumTargetDelta) || contract.minimumTargetDelta < 1)) {
        errors.push({
          code: 'INVALID_COVERAGE_THRESHOLD',
          path: `${path}/minimumTargetDelta`,
          contractId: contract?.id,
          minimumTargetDelta: contract.minimumTargetDelta,
        });
      }
      if (contract.coverageMetric != null && contract.direction === 'less') {
        errors.push({ code: 'INVALID_COVERAGE_DIRECTION', path: `${path}/direction`, contractId: contract?.id });
      }
    } else if (type === 'static' || type === 'aggregate') {
      const knownMetrics = type === 'static'
        ? BUSTER_BALANCE_STATIC_METRICS
        : BUSTER_BALANCE_AGGREGATE_METRICS;
      if (!Array.isArray(contract.metrics) || contract.metrics.length === 0) {
        errors.push({ code: 'EMPTY_CONTRACT_METRICS', path: `${path}/metrics`, contractId: contract?.id });
      } else {
        for (const metric of contract.metrics) {
          if (!knownMetrics.has(metric)) {
            errors.push({ code: 'UNKNOWN_CONTRACT_METRIC', path: `${path}/metrics`, contractId: contract?.id, metric });
          }
        }
      }
      if (contract.coverageMetric != null || contract.minimumTargetDelta != null) {
        errors.push({ code: 'COVERAGE_NOT_SUPPORTED', path, contractId: contract?.id, type });
      }
    }
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

function simulationMetric(result, metric) {
  return result?.metrics?.[metric] ?? result?.[metric];
}

/** Explicit comparison semantics avoid treating unresolved infinities as parity. */
export function compareBusterBalanceOutcomes(actual, comparator, {
  metric,
  direction = 'greater',
  ratio = 1,
  fixedHorizon = true,
} = {}) {
  if (comparator?.status === 'invalid' || comparator?.status === 'candidate-invalid') {
    return { passed: false, configurationError: true, reason: 'comparator-invalid' };
  }
  if (actual?.status === 'invalid' || actual?.status === 'candidate-invalid') {
    return { passed: false, reason: 'actual-invalid' };
  }
  const actualValue = simulationMetric(actual, metric);
  const comparatorValue = simulationMetric(comparator, metric);
  if (actual?.status === 'cleared' && comparator?.status === 'unresolved') {
    return {
      passed: true,
      reason: 'actual-clears-comparator-unresolved',
      actual: actualValue,
      comparator: comparatorValue,
    };
  }
  if (actual?.status === 'unresolved' && comparator?.status === 'cleared') {
    return {
      passed: false,
      reason: 'actual-unresolved-comparator-clears',
      actual: actualValue,
      comparator: comparatorValue,
    };
  }
  if (actual?.status === 'unresolved' && comparator?.status === 'unresolved'
    && !(fixedHorizon && BUSTER_BALANCE_FIXED_HORIZON_OUTPUT_METRICS.has(metric))) {
    return {
      passed: false,
      inconclusive: true,
      reason: 'both-unresolved',
      actual: actualValue,
      comparator: comparatorValue,
    };
  }
  if (!Number.isFinite(actualValue) || !Number.isFinite(comparatorValue)) {
    return { passed: false, reason: 'metric-unresolved', actual: actualValue, comparator: comparatorValue };
  }
  const passed = direction === 'less'
    ? actualValue <= comparatorValue / ratio + EPSILON
    : actualValue + EPSILON >= comparatorValue * ratio;
  return { passed, reason: passed ? 'threshold-met' : 'threshold-missed', actual: actualValue, comparator: comparatorValue, ratio };
}

function terminalAllocatedPower(plan) {
  if (!plan?.ok) return Number.NaN;
  const root = plan.actions.find((action) => action.type === 'emit' && action.scope === 'root');
  const child = plan.actions.find((action) => action.type === 'emit' && action.scope === 'child');
  if (!child) return root?.totalPower ?? root?.power ?? Number.NaN;
  return (root?.damagePower ?? 0) + (child.totalPower ?? child.power * child.count ?? 0);
}

function makeCheck(id, passed, details = {}) {
  return deepFreeze({ id, passed: Boolean(passed), ...details });
}

export function evaluateBusterHardCorrectness({ presets = compileCanonicalBusterBalancePresets() } = {}) {
  const checks = [];
  const registry = validateBusterBalanceContractRegistry(BUSTER_BALANCE_ROLE_CONTRACTS, {
    planIds: Object.keys(presets),
    scenarioIds: Object.keys(ROLE_SCENARIO_OPTIONS),
  });
  checks.push(makeCheck('contract-registry-valid', registry.valid, { errors: registry.errors }));

  const invalidPlans = Object.entries(presets)
    .filter(([, plan]) => !plan?.ok)
    .map(([planId, plan]) => ({ planId, errors: plan?.errors ?? [] }));
  checks.push(makeCheck('canonical-plans-compile', invalidPlans.length === 0, { invalidPlans }));

  const reservationFailures = Object.entries(presets)
    .filter(([, plan]) => plan?.ok && plan.peakProjectileReservation > BUSTER_MAX_MOVING_PROJECTILES)
    .map(([planId, plan]) => ({ planId, reservation: plan.peakProjectileReservation }));
  checks.push(makeCheck('projectile-reservations-bounded', reservationFailures.length === 0, {
    maximum: BUSTER_MAX_MOVING_PROJECTILES,
    failures: reservationFailures,
  }));

  const conservationFailures = Object.entries(presets)
    .filter(([, plan]) => plan?.ok && !nearlyEqual(terminalAllocatedPower(plan), plan.stats.effectivePower))
    .map(([planId, plan]) => ({
      planId,
      allocated: terminalAllocatedPower(plan),
      effectivePower: plan.stats.effectivePower,
    }));
  checks.push(makeCheck('pre-fanout-power-conservation', conservationFailures.length === 0, {
    failures: conservationFailures,
  }));

  const overrideWithoutContext = compileBusterBuild(CANONICAL_SOURCES.balancedBareMortar, {
    throwOnError: false,
    balanceOverrides: { mortarShell: { basePower: 16 } },
  });
  const overrideWithContext = compileBusterBuild(CANONICAL_SOURCES.balancedBareMortar, {
    throwOnError: false,
    diagnosticContext: true,
    balanceOverrides: { mortarShell: { basePower: 16 } },
  });
  checks.push(makeCheck(
    'diagnostic-overrides-contained',
    !overrideWithoutContext.ok
      && overrideWithoutContext.errors?.some((error) => error.code === 'DIAGNOSTIC_CONTEXT_REQUIRED')
      && overrideWithContext.ok
      && overrideWithContext.diagnostic?.overrideOnly === true
      && overrideWithContext.stats.basePower === 16,
    { rejectedErrors: overrideWithoutContext.errors, diagnostic: overrideWithContext.diagnostic },
  ));

  const neutral = presets.neutralMega;
  const pulse = presets.balancedBarePulse;
  checks.push(makeCheck(
    'shared-neutral-mega-compiler-path',
    neutral?.ok && pulse?.ok
      && nearlyEqual(neutral.stats.effectivePower, 8)
      && nearlyEqual(pulse.stats.effectivePower, 8)
      && neutral.actions[0]?.power === neutral.stats.effectivePower,
    {
      neutralPower: neutral?.stats?.effectivePower,
      pulsePower: pulse?.stats?.effectivePower,
      actionPower: neutral?.actions?.[0]?.power,
    },
  ));

  const failures = checks.filter((check) => !check.passed);
  return deepFreeze({ passed: failures.length === 0, checks, failures });
}

function simulateCached(cache, planId, plan, scenarioId, scenario) {
  const key = `${planId}:${scenarioId}`;
  if (!cache.has(key)) cache.set(key, simulateBusterEncounter(plan, scenario, { duration: 30 }));
  return cache.get(key);
}

function simulationCheck(id, actualId, comparatorId, scenarioId, presets, scenarios, cache, options) {
  const actual = simulateCached(cache, actualId, presets[actualId], scenarioId, scenarios[scenarioId]);
  const comparator = simulateCached(cache, comparatorId, presets[comparatorId], scenarioId, scenarios[scenarioId]);
  const comparison = compareBusterBalanceOutcomes(actual, comparator, options);
  return makeCheck(id, comparison.passed, {
    actualPlanId: actualId,
    comparatorPlanId: comparatorId,
    scenarioId,
    metric: options.metric,
    comparison,
    ...(!comparison.passed ? {
      actualTranscript: actual.transcript,
      comparatorTranscript: comparator.transcript,
    } : {}),
  });
}

function countChildTriggers(result) {
  return result?.transcript?.filter((event) => event.type === 'child-trigger').length ?? 0;
}

export function evaluateBusterRoleContracts({
  presets = compileCanonicalBusterBalancePresets(),
  scenarios = createBusterBalanceRoleScenarios(),
} = {}) {
  const checks = [];
  const cache = new Map();
  const pulse = presets.balancedBarePulse;
  const neutral = presets.neutralMega;
  const liveMega = presets.liveCalibratedMega;
  const pursuit = presets.pursuitPulse;
  const mortar = presets.balancedBareMortar;

  const neutralFields = ['effectivePower', 'maxEnergy', 'energyCost', 'rootRange', 'cycleTime', 'projectileSpeed'];
  const neutralDifferences = neutralFields.filter((field) => !nearlyEqual(neutral?.stats?.[field], pulse?.stats?.[field]));
  checks.push(makeCheck('neutral-mega-parity', neutralDifferences.length === 0, {
    comparedFields: neutralFields,
    differences: neutralDifferences,
  }));

  const megaRatio = liveMega?.stats?.effectivePower / pulse?.stats?.effectivePower;
  const megaDimensionsMatch = ['maxEnergy', 'energyCost', 'rootRange', 'cycleTime', 'projectileSpeed']
    .every((field) => nearlyEqual(liveMega?.stats?.[field], pulse?.stats?.[field]));
  checks.push(makeCheck('live-mega-identity', megaRatio >= 1.1 - EPSILON && megaRatio <= 1.2 + EPSILON
    && nearlyEqual(megaRatio, 1.14) && megaDimensionsMatch, { powerRatio: megaRatio, dimensionsMatch: megaDimensionsMatch }));

  const pursuitTheory = pursuit?.stats?.effectivePower / pulse?.stats?.effectivePower;
  checks.push(makeCheck('pursuit-authored-tax', nearlyEqual(pursuitTheory, 0.9)
    && pursuit?.stats?.energyCost === pulse?.stats?.energyCost
    && nearlyEqual(pursuit?.stats?.cycleTime, pulse?.stats?.cycleTime), {
    powerRatio: pursuitTheory,
    pursuitEnergy: pursuit?.stats?.energyCost,
    pulseEnergy: pulse?.stats?.energyCost,
    pursuitCycle: pursuit?.stats?.cycleTime,
    pulseCycle: pulse?.stats?.cycleTime,
  }));
  checks.push(simulationCheck('pursuit-delivery', 'pursuitPulse', 'balancedBarePulse', 'pursuit',
    presets, scenarios, cache, { metric: 'output10s', direction: 'greater', ratio: 1.02 }));

  const mortarOpening = mortar?.stats?.effectivePower * mortar?.stats?.shotsPerCharge;
  const pulseOpening = pulse?.stats?.effectivePower * pulse?.stats?.shotsPerCharge;
  checks.push(makeCheck('mortar-heavy-role', mortar?.stats?.effectivePower > pulse?.stats?.effectivePower
    && mortar?.stats?.stagger > pulse?.stats?.stagger
    && mortarOpening > pulseOpening
    && mortar?.stats?.cycleTime > pulse?.stats?.cycleTime
    && mortar?.stats?.shotsPerCharge < pulse?.stats?.shotsPerCharge, {
    mortarPower: mortar?.stats?.effectivePower,
    pulsePower: pulse?.stats?.effectivePower,
    mortarStagger: mortar?.stats?.stagger,
    pulseStagger: pulse?.stats?.stagger,
    mortarOpening,
    pulseOpening,
  }));

  for (const scenarioId of ['compactTwo', 'compactFour']) {
    checks.push(simulationCheck(`direct-explosion-${scenarioId}`, 'directExplosion', 'balancedBarePulse', scenarioId,
      presets, scenarios, cache, { metric: 'output10s', direction: 'greater', ratio: 1.02 }));
  }
  checks.push(simulationCheck('direct-explosion-single-cost', 'directExplosion', 'balancedBarePulse', 'single',
    presets, scenarios, cache, { metric: 'output10s', direction: 'less', ratio: 1.02 }));
  const explosionWeak = simulateCached(cache, 'directExplosion', presets.directExplosion, 'weakPoint', scenarios.weakPoint);
  checks.push(makeCheck('explosion-is-body-only', explosionWeak.metrics.weakPointHits === 0, {
    weakPointHits: explosionWeak.metrics.weakPointHits,
    scenarioId: 'weakPoint',
  }));

  const spread = simulateCached(cache, 'directSpreadExplosion', presets.directSpreadExplosion,
    'spreadSeparated', scenarios.spreadSeparated);
  const direct = simulateCached(cache, 'directExplosion', presets.directExplosion,
    'spreadSeparated', scenarios.spreadSeparated);
  checks.push(makeCheck('spread-explosion-separated-coverage',
    spread.metrics.uniqueTargetsDamaged10s >= direct.metrics.uniqueTargetsDamaged10s + 1
      && spread.metrics.output10s + EPSILON >= direct.metrics.output10s * 1.02, {
    scenarioId: 'spreadSeparated',
    actualUniqueTargets: spread.metrics.uniqueTargetsDamaged10s,
    comparatorUniqueTargets: direct.metrics.uniqueTargetsDamaged10s,
    actualOutput10s: spread.metrics.output10s,
    comparatorOutput10s: direct.metrics.output10s,
    ...(!(spread.metrics.uniqueTargetsDamaged10s >= direct.metrics.uniqueTargetsDamaged10s + 1
      && spread.metrics.output10s + EPSILON >= direct.metrics.output10s * 1.02)
      ? { actualTranscript: spread.transcript, comparatorTranscript: direct.transcript } : {}),
  }));
  checks.push(simulationCheck('spread-explosion-single-cost', 'directSpreadExplosion', 'directExplosion', 'single',
    presets, scenarios, cache, { metric: 'output10s', direction: 'less', ratio: 1.02 }));

  const cluster = simulateCached(cache, 'delayedMortarClusterExplosion', presets.delayedMortarClusterExplosion,
    'clusterSeparated', scenarios.clusterSeparated);
  const delayed = simulateCached(cache, 'delayedMortarExplosion', presets.delayedMortarExplosion,
    'clusterSeparated', scenarios.clusterSeparated);
  const clusterCoveragePassed = cluster.metrics.uniqueTargetsDamaged10s >= delayed.metrics.uniqueTargetsDamaged10s + 1;
  const clusterRetentionPassed = cluster.metrics.output10s + EPSILON >= delayed.metrics.output10s * 0.98;
  checks.push(makeCheck('delayed-cluster-separated-role', clusterCoveragePassed && clusterRetentionPassed
    && presets.delayedMortarClusterExplosion.stats.cycleTime > presets.delayedMortarExplosion.stats.cycleTime, {
    scenarioId: 'clusterSeparated',
    actualUniqueTargets: cluster.metrics.uniqueTargetsDamaged10s,
    comparatorUniqueTargets: delayed.metrics.uniqueTargetsDamaged10s,
    actualOutput10s: cluster.metrics.output10s,
    comparatorOutput10s: delayed.metrics.output10s,
    actualCycle: presets.delayedMortarClusterExplosion.stats.cycleTime,
    comparatorCycle: presets.delayedMortarExplosion.stats.cycleTime,
    ...(!(clusterCoveragePassed && clusterRetentionPassed)
      ? { actualTranscript: cluster.transcript, comparatorTranscript: delayed.transcript } : {}),
  }));
  checks.push(simulationCheck('delayed-cluster-single-cost', 'delayedMortarClusterExplosion',
    'delayedMortarExplosion', 'single', presets, scenarios, cache,
    { metric: 'output10s', direction: 'less', ratio: 1.02 }));

  for (const [scope, actualId] of [
    ['root', 'rootGuidedDelayedMortarClusterExplosion'],
    ['child', 'childGuidedDelayedMortarClusterExplosion'],
  ]) {
    const plan = presets[actualId];
    const scopeCorrect = scope === 'root'
      ? plan?.rootGuidance === true && plan?.childGuidance === false
      : plan?.rootGuidance === false && plan?.childGuidance === true;
    checks.push(makeCheck(`${scope}-guidance-action-scope`, scopeCorrect, {
      rootGuidance: plan?.rootGuidance,
      childGuidance: plan?.childGuidance,
    }));
    checks.push(simulationCheck(`${scope}-guidance-delivery`, actualId,
      'delayedMortarClusterExplosion', 'crossing', presets, scenarios, cache,
      { metric: 'output10s', direction: 'greater', ratio: 1.02 }));
    const guidedResult = simulateCached(cache, actualId, plan, 'crossing', scenarios.crossing);
    checks.push(makeCheck(`${scope}-guidance-branch-safety`, countChildTriggers(guidedResult) > 0, {
      childTriggerCount: countChildTriggers(guidedResult),
      scenarioId: 'crossing',
    }));
  }

  const apex = presets.apexMortarExplosion?.trigger;
  const terminal = presets.terminalMortarExplosion?.trigger;
  checks.push(makeCheck('apex-terminal-authored-semantics',
    apex?.event === 'apex' && apex?.childTransfer === 1 && apex?.carrierAllocation === 0
      && apex?.carrierTerminationBehavior === 'deliver-child'
      && terminal?.event === 'impact' && terminal?.childTransfer === 0.8
      && terminal?.carrierAllocation === 0.2
      && terminal?.carrierTerminationBehavior === 'trigger-child', { apex, terminal }));

  const apexRuntime = simulateCached(cache, 'apexMortarExplosion', presets.apexMortarExplosion,
    'single', scenarios.single);
  const terminalRuntime = simulateCached(cache, 'terminalMortarExplosion', presets.terminalMortarExplosion,
    'single', scenarios.single);
  const triggerCounts = (result) => {
    const counts = new Map();
    for (const event of result.transcript.filter((entry) => entry.type === 'child-trigger')) {
      counts.set(event.executionId, (counts.get(event.executionId) ?? 0) + 1);
    }
    return counts;
  };
  const apexCounts = triggerCounts(apexRuntime);
  const terminalCounts = triggerCounts(terminalRuntime);
  const apexReasons = new Set(apexRuntime.transcript
    .filter((entry) => entry.type === 'child-trigger').map((entry) => entry.reason));
  const terminalReasons = new Set(terminalRuntime.transcript
    .filter((entry) => entry.type === 'child-trigger').map((entry) => entry.reason));
  checks.push(makeCheck('trigger-single-delivery-runtime',
    apexCounts.size > 0 && terminalCounts.size > 0
      && [...apexCounts.values(), ...terminalCounts.values()].every((count) => count === 1)
      && apexReasons.has('apexTrigger') && terminalReasons.has('terminalRelay'), {
    apexExecutions: apexCounts.size,
    terminalExecutions: terminalCounts.size,
    apexReasons: [...apexReasons],
    terminalReasons: [...terminalReasons],
  }));

  const dominanceRelationships = [
    { actualId: 'pursuitPulse', comparatorId: 'balancedBarePulse', scenarios: ['pursuit'] },
    { actualId: 'directExplosion', comparatorId: 'balancedBarePulse', scenarios: ['compactTwo', 'compactFour', 'single'] },
    { actualId: 'directSpreadExplosion', comparatorId: 'directExplosion', scenarios: ['spreadSeparated', 'single'] },
    { actualId: 'delayedMortarClusterExplosion', comparatorId: 'delayedMortarExplosion', scenarios: ['clusterSeparated', 'single'] },
  ];
  const dominated = dominanceRelationships.filter((relationship) => relationship.scenarios.every((scenarioId) => {
    const actual = simulateCached(cache, relationship.actualId, presets[relationship.actualId], scenarioId, scenarios[scenarioId]);
    const comparator = simulateCached(cache, relationship.comparatorId, presets[relationship.comparatorId], scenarioId, scenarios[scenarioId]);
    return comparator.metrics.output10s > EPSILON
      && actual.metrics.output10s <= comparator.metrics.output10s * 0.98 + EPSILON;
  }));
  checks.push(makeCheck('declared-module-dominance', dominated.length === 0, { dominated }));

  const failures = checks.filter((check) => !check.passed);
  return deepFreeze({
    passed: failures.length === 0,
    checks,
    failures,
    scenarioIds: Object.keys(scenarios),
  });
}

function midpoint([minimum, maximum]) {
  return (minimum + maximum) / 2;
}

function scaleLegacyItemStat(range, level, { integer = false } = {}) {
  const scaled = midpoint(range) * (1 + level * 0.055);
  return integer ? Math.round(scaled) : Number(scaled.toFixed(3));
}

const LEGACY_FIXTURE_DEFINITIONS = deepFreeze({
  machineGun: {
    id: 'machineGun', label: 'Standard Midpoint Machine Gun Arm', itemType: 'machineGunArm',
    itemStats: { attackDamage: [2, 5], maxEnergy: [12, 20], attackRange: [5.5, 6.8], attackSpeed: [0.3, 0.52] },
    profile: {
      energyCost: 0.55, cooldownMultiplier: 0.56, damageMultiplier: 0.68,
      projectileSpeed: 10.8, rangePolicy: 'resolved-base', outputCost: 0.045,
      outputRequired: 0.03, outputRecovery: 0.55, outputVent: 0.38,
      outputStarvedCooldown: 0.08,
    },
  },
  cannon: {
    id: 'cannon', label: 'Standard Midpoint Cannon Arm', itemType: 'cannonArm',
    itemStats: { attackDamage: [12, 20], maxEnergy: [1, 3], attackRange: [5, 6.6], attackSpeed: [0.01, 0.08], areaDamage: [0.18, 0.36] },
    profile: {
      energyCost: 2, cooldownMultiplier: 1.65, damageMultiplier: 1.45,
      projectileSpeed: 7.4, splashMultiplier: 0.62, splashRadius: 1.75,
      rangePolicy: 'resolved-base', outputCost: 1, outputRequired: 0.78,
      outputRecovery: 0.36, outputVent: 0.74, outputStarvedCooldown: 0.08,
    },
  },
  missile: {
    id: 'missile', label: 'Standard Midpoint Missile Arm', itemType: 'missileArm',
    itemStats: { attackDamage: [9, 16], maxEnergy: [3, 6], attackRange: [6, 8], attackSpeed: [0.04, 0.12] },
    profile: {
      energyCost: 1.5, cooldownMultiplier: 1.28, damageMultiplier: 1.22 * 1.12,
      projectileSpeed: 6.8, splashMultiplier: 0.62, splashRadius: 1.35,
      guidance: true, homingRange: 9.5, rangePolicy: 'missile-plus-1.8',
      outputCost: 0.38, outputRequired: 0.22, outputRecovery: 0.38,
      outputVent: 0.58, outputStarvedCooldown: 0.08,
    },
  },
});

export const BUSTER_BALANCE_LEGACY_FIXTURES = LEGACY_FIXTURE_DEFINITIONS;

/** Report-only expected-value fixtures; none participates in a release contract. */
export function createLegacyBalanceFixture(fixtureId, level) {
  const definition = LEGACY_FIXTURE_DEFINITIONS[fixtureId];
  if (!definition) throw new Error(`Unknown legacy balance fixture: ${fixtureId}`);
  const item = {
    attackDamage: scaleLegacyItemStat(definition.itemStats.attackDamage, level, { integer: true }),
    maxEnergy: scaleLegacyItemStat(definition.itemStats.maxEnergy, level, { integer: true }),
    attackRange: scaleLegacyItemStat(definition.itemStats.attackRange, level),
    attackSpeed: scaleLegacyItemStat(definition.itemStats.attackSpeed, level),
    areaDamage: definition.itemStats.areaDamage ? scaleLegacyItemStat(definition.itemStats.areaDamage, level) : 0,
  };
  const profile = definition.profile;
  const resolvedBaseRange = PLAYER_BASE_RANGE + item.attackRange;
  const range = profile.rangePolicy === 'missile-plus-1.8'
    ? Math.max(resolvedBaseRange + 1.8, profile.homingRange)
    : resolvedBaseRange;
  const playerAttack = PLAYER_BASE_ATTACK + Math.max(0, level - 1) * PLAYER_ATTACK_PER_LEVEL;
  const shotDamage = (playerAttack + item.attackDamage)
    * LEGACY_RANDOM_ROLL_MEAN
    * (1 + item.areaDamage)
    * profile.damageMultiplier
    * LEGACY_EXPECTED_CRITICAL_MULTIPLIER;
  const rapid = PLAYER_BASE_RAPID + item.attackSpeed;
  const rapidOutputModifier = Math.max(0.65, Math.min(1.75, Math.sqrt(rapid / PLAYER_BASE_RAPID)));
  return deepFreeze({
    kind: 'legacy-report',
    id: definition.id,
    label: definition.label,
    reportOnly: true,
    level,
    item,
    profile,
    shotDamage,
    directPower: shotDamage,
    splashPower: shotDamage * (profile.splashMultiplier ?? 0),
    maxEnergy: PLAYER_BASE_ENERGY + item.maxEnergy,
    energyCost: profile.energyCost,
    cycleTime: profile.cooldownMultiplier / rapid,
    range,
    projectileSpeed: profile.projectileSpeed,
    guidance: Boolean(profile.guidance),
    splashRadius: profile.splashRadius ?? 0,
    rangePolicy: profile.rangePolicy,
    outputCost: profile.outputCost / rapidOutputModifier,
    outputRequired: profile.outputRequired / Math.sqrt(rapidOutputModifier),
    outputRecovery: profile.outputRecovery * rapidOutputModifier,
    outputRecoveryDelay: LEGACY_OUTPUT_RECOVERY_DELAY,
    outputVent: profile.outputVent,
    outputStarvedCooldown: profile.outputStarvedCooldown,
    reloadDuration: Math.max(0.42, 1.35 - Math.min(PLAYER_BASE_ENERGY_RECHARGE, 0.9) * 0.36),
  });
}

function simulateLegacyShotSchedule(fixture, horizon = 30) {
  const dt = 1 / 240;
  const releases = [];
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
    if (outputDelay <= EPSILON) output = Math.min(1, output + fixture.outputRecovery * dt);
    if (reload <= EPSILON && cooldown <= EPSILON) {
      if (energy + EPSILON < fixture.energyCost) {
        reload = fixture.reloadDuration;
      } else if (output + EPSILON < fixture.outputRequired) {
        cooldown = output <= EPSILON ? fixture.outputVent : fixture.outputStarvedCooldown;
      } else {
        releases.push(time);
        energy = Math.max(0, energy - fixture.energyCost);
        output = Math.max(0, output - fixture.outputCost);
        outputDelay = fixture.outputRecoveryDelay;
        const lowOutputCycleScale = fixture.id === 'machineGun' ? 1 + (1 - output) * 0.42 : 1;
        cooldown = fixture.cycleTime * lowOutputCycleScale;
        if (energy <= EPSILON) reload = fixture.reloadDuration;
      }
    }
    time += dt;
  }
  return releases;
}

function legacyReportMetrics(fixture) {
  const releases = simulateLegacyShotSchedule(fixture, 30);
  const shotsPerMagazine = Math.max(1, Math.floor(fixture.maxEnergy / fixture.energyCost));
  const shots10s = releases.filter((time) => time <= 10 + EPSILON).length;
  const shots30s = releases.length;
  const packetPower = fixture.directPower + fixture.splashPower;
  return {
    status: 'report-only',
    output10s: round(shots10s * packetPower),
    output30s: round(shots30s * packetPower),
    shotsPerMagazine,
    directPower: round(fixture.directPower),
    secondaryExplosionPower: round(fixture.splashPower),
    range: fixture.range,
    rangePolicy: fixture.rangePolicy,
  };
}

export function createLegacyContextReports() {
  return deepFreeze(BUSTER_BALANCE_LEVELS.flatMap((level) => Object.keys(LEGACY_FIXTURE_DEFINITIONS).map((fixtureId) => {
    const fixture = createLegacyBalanceFixture(fixtureId, level);
    return { fixtureId, level, label: fixture.label, ...legacyReportMetrics(fixture) };
  })));
}

/** Compatibility adapter for callers of the former aggregate evaluator. */
export function evaluateBusterBalanceScenario(weapon, scenario, options = {}) {
  if (weapon?.kind === 'legacy-report') return deepFreeze(legacyReportMetrics(weapon));
  const simulation = simulateBusterEncounter(weapon, scenario, options);
  const summary = summarizeBusterSimulation(simulation);
  const metrics = summary.metrics ?? summary;
  return deepFreeze({
    status: simulation.status,
    ...metrics,
    sustained10s: metrics.output10s,
    sustained30s: metrics.output30s,
    roomClearTime: metrics.releaseRoomClear,
    transcript: simulation.transcript,
  });
}

/**
 * Compatibility report. The 2,700-scenario matrix remains enumerable, while
 * expensive packet rows are opt-in instead of running implicitly in CI.
 */
export function evaluateFullBusterBalanceMatrix({ includeScenarioRows = false, scenarioLimit = null } = {}) {
  const matrix = createBusterBalanceScenarioMatrix();
  const scenarios = includeScenarioRows
    ? matrix.slice(0, scenarioLimit == null ? matrix.length : Math.max(0, scenarioLimit))
    : [];
  const rows = scenarios.map((scenario) => {
    const presets = compileCanonicalBusterBalancePresets({ level: scenario.level });
    return deepFreeze({
      scenarioId: scenario.id,
      presets: Object.fromEntries(Object.entries(presets).map(
        ([id, plan]) => [id, evaluateBusterBalanceScenario(plan, scenario)],
      )),
    });
  });
  return deepFreeze({
    scenarioCount: matrix.length,
    evaluatedScenarioCount: rows.length,
    rows,
    legacyReports: createLegacyContextReports(),
  });
}

function inclusiveValues(minimum, maximum, step) {
  const count = Math.round((maximum - minimum) / step);
  return Array.from({ length: count + 1 }, (_, index) => round(minimum + index * step, 3));
}

export function runBusterSensitivityDiagnostics({ includeRows = false } = {}) {
  const scalars = inclusiveValues(1, 1.25, 0.01);
  const mortarValues = inclusiveValues(12, 18, 0.5);
  const clusterValues = [1, 2];
  const rows = [];
  let validCandidates = 0;
  let invalidCandidates = 0;
  const invalidExamples = [];
  for (const level10Scalar of scalars) {
    for (const mortarPower of mortarValues) {
      for (const clusterEnergySurcharge of clusterValues) {
        const constants = { level10Scalar, mortarPower, clusterEnergySurcharge };
        const options = diagnosticCompileOptions({ level: 10, ...constants });
        const mortar = compileBusterBuild(CANONICAL_SOURCES.balancedBareMortar, options);
        const cluster = compileBusterBuild(CANONICAL_SOURCES.delayedMortarClusterExplosion, options);
        const valid = mortar.ok && cluster.ok;
        const row = {
          status: valid ? 'valid' : 'candidate-invalid',
          constants,
          ...(valid ? {
            mortarPower: mortar.stats.effectivePower,
            mortarEnergyCost: mortar.stats.energyCost,
            clusterPower: cluster.stats.effectivePower,
            clusterEnergyCost: cluster.stats.energyCost,
          } : {
            errors: [...(mortar.errors ?? []), ...(cluster.errors ?? [])],
          }),
        };
        if (valid) validCandidates += 1;
        else {
          invalidCandidates += 1;
          if (invalidExamples.length < DEFAULT_FAILURE_LIMIT) invalidExamples.push(row);
        }
        if (includeRows) rows.push(row);
      }
    }
  }
  return deepFreeze({
    diagnosticOnly: true,
    selected: null,
    candidateCount: scalars.length * mortarValues.length * clusterValues.length,
    validCandidates,
    invalidCandidates,
    dimensions: { level10Scalars: scalars.length, mortarPowers: mortarValues.length, clusterEnergyValues: clusterValues.length },
    invalidExamples,
    rows,
  });
}

function createRuntimePolicyWarnings(presets, scenarios) {
  const rotation = simulateBusterRotation(
    [presets.liveCalibratedMega, presets.balancedBarePulse, presets.balancedBareMortar],
    scenarios.single,
    // Rotation is report-only. Keep its state search bounded so the strict
    // verifier remains a fast, deterministic command. The result is a
    // feasible lower bound and advertises why global optimality is unproven.
    { horizons: [30, 60], maxTransitions: 120000 },
  );
  return deepFreeze([{
    code: 'THREE_WEAPON_ROTATION_REPORT_ONLY',
    severity: 'report-only',
    rotation: {
      status: rotation.status,
      exact: rotation.exact,
      optimality: rotation.optimality,
      inputPolicy: rotation.inputPolicy,
      searchPolicy: rotation.searchPolicy,
      output30s: rotation.output30s,
      output60s: rotation.output60s,
      outputLowerBound30s: rotation.outputLowerBound30s,
      outputLowerBound60s: rotation.outputLowerBound60s,
      bestSingleOutput: rotation.bestSingleOutput,
      advantageRatio: rotation.advantageRatio,
      swaps: rotation.swaps,
      braceTime: rotation.braceTime,
      swapTime: rotation.swapTime,
      transitionLockTime: rotation.transitionLockTime,
      transitions: rotation.transitions,
      termination: rotation.termination,
      clocks: rotation.clocks,
    },
  }]);
}

let cachedDefaultResult = null;

/** Compatibility name retained: this evaluates; it never searches or selects. */
export function runBusterBalanceSearch({ includeDiagnosticRows = false, bypassCache = false } = {}) {
  if (!includeDiagnosticRows && !bypassCache && cachedDefaultResult) return cachedDefaultResult;
  const presets = compileCanonicalBusterBalancePresets();
  const scenarios = createBusterBalanceRoleScenarios();
  const hardCorrectness = evaluateBusterHardCorrectness({ presets });
  const roleContracts = evaluateBusterRoleContracts({ presets, scenarios });
  const sensitivityDiagnostics = runBusterSensitivityDiagnostics({ includeRows: includeDiagnosticRows });
  const legacyContextReports = createLegacyContextReports();
  const runtimePolicyWarnings = createRuntimePolicyWarnings(presets, scenarios);
  const releaseReady = hardCorrectness.passed && roleContracts.passed;
  const result = deepFreeze({
    releaseReady,
    simulatorCorrect: hardCorrectness.passed,
    frozenCatalogPassed: roleContracts.passed,
    constants: STORED_BUSTER_BALANCE_CONSTANTS,
    hardCorrectness,
    roleContracts,
    legacyContextReports,
    sensitivityDiagnostics,
    runtimePolicyWarnings,
    evaluatedCandidates: sensitivityDiagnostics.candidateCount,
    selected: releaseReady ? { constants: STORED_BUSTER_BALANCE_CONSTANTS, diagnostic: false } : null,
    nearest: null,
    // Compatibility aliases. These do not restore the retired legacy-parity gate.
    gates: roleContracts,
    detectors: hardCorrectness,
  });
  if (!includeDiagnosticRows && !bypassCache) cachedDefaultResult = result;
  return result;
}

export class BusterBalanceGateError extends Error {
  constructor(result) {
    const hard = result?.hardCorrectness?.failures?.length ?? 0;
    const roles = result?.roleContracts?.failures?.length ?? 0;
    super(`Custom Buster release verification failed: ${hard} hard correctness failure(s), ${roles} frozen-catalog role failure(s).`);
    this.name = 'BusterBalanceGateError';
    this.code = 'BUSTER_BALANCE_GATE_FAILED';
    this.result = result;
  }
}

/** Strict verifier: diagnostics and legacy context never select production values. */
export function verifyBusterBalanceSelection(options = {}) {
  const result = runBusterBalanceSearch(options);
  if (!result.releaseReady) throw new BusterBalanceGateError(result);
  return result;
}

function conciseFailures(failures, limit) {
  // Role failures deliberately retain their immutable packet transcripts.
  // The strict verifier is a diagnostic boundary, and a blocked catalog must
  // identify the exact authored scenario and lifecycle evidence rather than
  // reducing the result to one aggregate number.
  return failures.slice(0, limit);
}

export function summarizeBusterBalanceResult(result, { failureLimit = DEFAULT_FAILURE_LIMIT } = {}) {
  if (!result) return deepFreeze({ releaseReady: false, message: 'No balance result was supplied.' });
  return deepFreeze({
    releaseReady: result.releaseReady,
    constants: result.constants,
    sections: {
      'HARD CORRECTNESS': {
        passed: result.hardCorrectness.passed,
        failureCount: result.hardCorrectness.failures.length,
        failures: conciseFailures(result.hardCorrectness.failures, failureLimit),
      },
      'INTERNAL ROLE CONTRACTS': {
        passed: result.roleContracts.passed,
        failureCount: result.roleContracts.failures.length,
        failures: conciseFailures(result.roleContracts.failures, failureLimit),
      },
      'LEGACY CONTEXT REPORTS': result.legacyContextReports,
      'SENSITIVITY DIAGNOSTICS': result.sensitivityDiagnostics,
      'RUNTIME POLICY WARNINGS': result.runtimePolicyWarnings,
    },
  });
}
