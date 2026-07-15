import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSTER_BALANCE_DISTANCES,
  BUSTER_BALANCE_LEGACY_FIXTURES,
  BUSTER_BALANCE_ROLE_CONTRACTS,
  BUSTER_BALANCE_TARGET_PROFILES,
  BusterBalanceGateError,
  STORED_BUSTER_BALANCE_CONSTANTS,
  compileCanonicalBusterBalancePresets,
  compareBusterBalanceOutcomes,
  createBusterBalanceRoleScenarios,
  createBusterBalanceScenarioMatrix,
  createCanonicalBusterBalanceSources,
  createLegacyBalanceFixture,
  evaluateBusterBalanceScenario,
  evaluateBusterHardCorrectness,
  runBusterBalanceSearch,
  runBusterSensitivityDiagnostics,
  summarizeBusterBalanceResult,
  validateBusterBalanceContractRegistry,
  verifyBusterBalanceSelection,
} from '../src/buster/BusterBalanceGate.js';

test('canonical programs include direct Explosion and both Guidance scopes', () => {
  const sources = createCanonicalBusterBalanceSources();
  assert.deepEqual(Object.keys(sources), [
    'balancedBarePulse',
    'balancedBareMortar',
    'pursuitPulse',
    'directExplosion',
    'directSpreadExplosion',
    'delayedMortarExplosion',
    'delayedMortarClusterExplosion',
    'rootGuidedDelayedMortarClusterExplosion',
    'childGuidedDelayedMortarClusterExplosion',
    'apexMortarExplosion',
    'terminalMortarExplosion',
  ]);
  assert.deepEqual(
    sources.directExplosion.program.edges,
    [{ from: 'emitter', port: 'next', to: 'payload' }],
  );
  assert.equal(
    sources.rootGuidedDelayedMortarClusterExplosion.program.edges[1].to,
    'trigger',
  );
  assert.equal(
    sources.childGuidedDelayedMortarClusterExplosion.program.edges[1].to,
    'guidance',
  );
  assert.ok(Object.isFrozen(sources));
});
test('benchmark matrix freezes signed aim geometry and non-overlapping target capsules', () => {
  const matrix = createBusterBalanceScenarioMatrix();
  assert.equal(matrix.length, 2700);
  assert.equal(new Set(matrix.map((scenario) => scenario.id)).size, matrix.length);
  assert.deepEqual(BUSTER_BALANCE_DISTANCES, { near: 3.2, mid: 4.8, far: 6 });
  assert.equal(BUSTER_BALANCE_TARGET_PROFILES.weakPoint.weakPointMultiplier, 2.4);

  const compactTwo = createBusterBalanceRoleScenarios().compactTwo;
  const [left, right] = compactTwo.targets;
  const separation = Math.hypot(
    left.root.position.x - right.root.position.x,
    left.root.position.z - right.root.position.z,
  );
  assert.ok(Math.abs(separation - 1.2) < 1e-9);
  assert.ok(separation > left.radius + right.radius);
  assert.ok(Object.isFrozen(matrix));
});

test('canonical compiler path preserves neutral parity and live Mega identity', () => {
  const presets = compileCanonicalBusterBalancePresets();
  assert.ok(Object.values(presets).every((plan) => plan.ok));
  assert.equal(presets.neutralMega.stats.effectivePower, 8);
  assert.equal(presets.balancedBarePulse.stats.effectivePower, 8);
  assert.equal(presets.neutralMega.stats.maxEnergy, 6);
  assert.equal(presets.neutralMega.stats.energyCost, 2);
  assert.ok(Math.abs(presets.liveCalibratedMega.stats.effectivePower - 9.12) < 1e-12);
  assert.equal(presets.liveCalibratedMega.actions[0].power, presets.liveCalibratedMega.stats.effectivePower);
  assert.equal(presets.balancedBareMortar.stats.energyCost, 3);
  assert.equal(presets.delayedMortarClusterExplosion.stats.energyCost, 6);
  assert.equal(presets.rootGuidedDelayedMortarClusterExplosion.rootGuidance, true);
  assert.equal(presets.rootGuidedDelayedMortarClusterExplosion.childGuidance, false);
  assert.equal(presets.childGuidedDelayedMortarClusterExplosion.rootGuidance, false);
  assert.equal(presets.childGuidedDelayedMortarClusterExplosion.childGuidance, true);
  assert.deepEqual(STORED_BUSTER_BALANCE_CONSTANTS, {
    level10Scalar: 1,
    mortarPower: 15,
    clusterEnergySurcharge: 2,
  });
});

test('legacy context fixtures use profile-specific production Range rules', () => {
  const machineGun = createLegacyBalanceFixture('machineGun', 1);
  const cannon = createLegacyBalanceFixture('cannon', 10);
  const missile = createLegacyBalanceFixture('missile', 1);
  assert.equal(machineGun.range, 6.2 + machineGun.item.attackRange);
  assert.equal(cannon.range, 6.2 + cannon.item.attackRange);
  assert.equal(missile.range, Math.max(6.2 + missile.item.attackRange + 1.8, 9.5));
  assert.equal(machineGun.rangePolicy, 'resolved-base');
  assert.equal(cannon.rangePolicy, 'resolved-base');
  assert.equal(missile.rangePolicy, 'missile-plus-1.8');
  assert.ok(Object.values(BUSTER_BALANCE_LEGACY_FIXTURES).every((fixture) => fixture.profile.rangePolicy));
});

test('declarative role registry rejects malformed plans, scenarios, and coverage contracts', () => {
  const valid = validateBusterBalanceContractRegistry();
  assert.equal(valid.valid, true);

  const malformed = structuredClone(BUSTER_BALANCE_ROLE_CONTRACTS);
  malformed.push({
    id: 'bad-coverage',
    type: 'simulation',
    actualPlanId: 'missing-plan',
    comparatorPlanId: 'balancedBarePulse',
    scenarioIds: ['missing-scenario'],
    metric: 'output10s',
    direction: 'sideways',
    minimumTargetDelta: 1,
  });
  const result = validateBusterBalanceContractRegistry(malformed);
  assert.equal(result.valid, false);
  assert.deepEqual(new Set(result.errors.map((error) => error.code)), new Set([
    'UNKNOWN_ACTUAL_PLAN',
    'UNKNOWN_SCENARIO',
    'UNKNOWN_METRIC_DIRECTION',
    'COVERAGE_METRIC_REQUIRED',
  ]));
});

test('declarative role registry rejects schema and threshold mutations', () => {
  const mutated = structuredClone(BUSTER_BALANCE_ROLE_CONTRACTS);
  mutated.push(
    {
      id: 'unknown-type',
      type: 'mystery',
      actualPlanId: 'balancedBarePulse',
      comparatorPlanId: 'neutralMega',
      metrics: ['packet'],
    },
    {
      id: 'missing-comparator',
      type: 'simulation',
      actualPlanId: 'balancedBarePulse',
      scenarioIds: ['compactTwo'],
      metric: 'output10s',
      direction: 'greater',
      ratio: 1.02,
    },
    {
      id: 'unknown-simulation-metric',
      type: 'simulation',
      actualPlanId: 'balancedBarePulse',
      comparatorPlanId: 'neutralMega',
      scenarioIds: ['compactTwo'],
      metric: 'imaginaryOutput',
      direction: 'greater',
      ratio: 1.02,
    },
    {
      id: 'unknown-static-metric',
      type: 'static',
      actualPlanId: 'balancedBarePulse',
      comparatorPlanId: 'neutralMega',
      metrics: ['imaginaryRelationship'],
    },
    {
      id: 'unknown-coverage-metric',
      type: 'simulation',
      actualPlanId: 'directSpreadExplosion',
      comparatorPlanId: 'directExplosion',
      scenarioIds: ['compactTwo'],
      metric: 'output10s',
      direction: 'greater',
      ratio: 1.02,
      coverageMetric: 'imaginaryCoverage',
      minimumTargetDelta: 1,
    },
    {
      id: 'empty-scenarios',
      type: 'simulation',
      actualPlanId: 'balancedBarePulse',
      comparatorPlanId: 'neutralMega',
      scenarioIds: [],
      metric: 'output10s',
      direction: 'greater',
      ratio: 1.02,
    },
    {
      id: 'nonfinite-ratio',
      type: 'simulation',
      actualPlanId: 'balancedBarePulse',
      comparatorPlanId: 'neutralMega',
      scenarioIds: ['compactTwo'],
      metric: 'output10s',
      direction: 'greater',
      ratio: Number.POSITIVE_INFINITY,
    },
    {
      id: 'subunit-ratio',
      type: 'simulation',
      actualPlanId: 'balancedBarePulse',
      comparatorPlanId: 'neutralMega',
      scenarioIds: ['compactTwo'],
      metric: 'output10s',
      direction: 'greater',
      ratio: 0.99,
    },
    {
      id: 'coverage-without-threshold',
      type: 'simulation',
      actualPlanId: 'directSpreadExplosion',
      comparatorPlanId: 'directExplosion',
      scenarioIds: ['compactTwo'],
      metric: 'output10s',
      direction: 'greater',
      ratio: 1.02,
      coverageMetric: 'uniqueTargetsDamaged10s',
    },
    {
      id: 'nonfinite-coverage-threshold',
      type: 'simulation',
      actualPlanId: 'directSpreadExplosion',
      comparatorPlanId: 'directExplosion',
      scenarioIds: ['compactTwo'],
      metric: 'output10s',
      direction: 'greater',
      ratio: 1.02,
      coverageMetric: 'uniqueTargetsDamaged10s',
      minimumTargetDelta: Number.NaN,
    },
    {
      id: 'invalid-coverage-direction',
      type: 'simulation',
      actualPlanId: 'directSpreadExplosion',
      comparatorPlanId: 'directExplosion',
      scenarioIds: ['compactTwo'],
      metric: 'output10s',
      direction: 'less',
      ratio: 1.02,
      coverageMetric: 'uniqueTargetsDamaged10s',
      minimumTargetDelta: 1,
    },
    {
      id: 'coverage-on-static-contract',
      type: 'static',
      actualPlanId: 'balancedBarePulse',
      comparatorPlanId: 'neutralMega',
      metrics: ['packet'],
      coverageMetric: 'uniqueTargetsDamaged10s',
      minimumTargetDelta: 1,
    },
  );

  const result = validateBusterBalanceContractRegistry(mutated);
  assert.equal(result.valid, false);
  const codesFor = (contractId) => result.errors
    .filter((error) => error.contractId === contractId)
    .map((error) => error.code);
  assert.deepEqual(codesFor('unknown-type'), ['UNKNOWN_CONTRACT_TYPE']);
  assert.deepEqual(codesFor('missing-comparator'), ['MISSING_COMPARATOR_PLAN']);
  assert.deepEqual(codesFor('unknown-simulation-metric'), ['UNKNOWN_CONTRACT_METRIC']);
  assert.deepEqual(codesFor('unknown-static-metric'), ['UNKNOWN_CONTRACT_METRIC']);
  assert.deepEqual(codesFor('unknown-coverage-metric'), ['UNKNOWN_COVERAGE_METRIC']);
  assert.deepEqual(codesFor('empty-scenarios'), ['EMPTY_SCENARIO_SET']);
  assert.deepEqual(codesFor('nonfinite-ratio'), ['INVALID_CONTRACT_RATIO']);
  assert.deepEqual(codesFor('subunit-ratio'), ['INVALID_CONTRACT_RATIO']);
  assert.deepEqual(codesFor('coverage-without-threshold'), ['COVERAGE_THRESHOLD_REQUIRED']);
  assert.deepEqual(codesFor('nonfinite-coverage-threshold'), ['INVALID_COVERAGE_THRESHOLD']);
  assert.deepEqual(codesFor('invalid-coverage-direction'), ['INVALID_COVERAGE_DIRECTION']);
  assert.deepEqual(codesFor('coverage-on-static-contract'), ['COVERAGE_NOT_SUPPORTED']);
});

test('outcome comparison resolves status semantics before metric finiteness', () => {
  const outcome = (status, metrics = {}) => ({ status, metrics });

  assert.deepEqual(
    compareBusterBalanceOutcomes(
      outcome('cleared', { roomClearTime: 3 }),
      outcome('unresolved', { roomClearTime: Number.POSITIVE_INFINITY }),
      { metric: 'roomClearTime', direction: 'less', ratio: 1.02, fixedHorizon: false },
    ),
    {
      passed: true,
      reason: 'actual-clears-comparator-unresolved',
      actual: 3,
      comparator: Number.POSITIVE_INFINITY,
    },
  );
  assert.deepEqual(
    compareBusterBalanceOutcomes(
      outcome('unresolved', { roomClearTime: Number.POSITIVE_INFINITY }),
      outcome('cleared', { roomClearTime: 3 }),
      { metric: 'roomClearTime', direction: 'less', ratio: 1.02, fixedHorizon: false },
    ),
    {
      passed: false,
      reason: 'actual-unresolved-comparator-clears',
      actual: Number.POSITIVE_INFINITY,
      comparator: 3,
    },
  );

  const bothUnresolved = compareBusterBalanceOutcomes(
    outcome('unresolved', { roomClearTime: 8 }),
    outcome('unresolved', { roomClearTime: 10 }),
    { metric: 'roomClearTime', direction: 'less', ratio: 1.02, fixedHorizon: true },
  );
  assert.equal(bothUnresolved.passed, false);
  assert.equal(bothUnresolved.inconclusive, true);
  assert.equal(bothUnresolved.reason, 'both-unresolved');

  const fixedHorizon = compareBusterBalanceOutcomes(
    outcome('unresolved', { output10s: 102 }),
    outcome('unresolved', { output10s: 100 }),
    { metric: 'output10s', direction: 'greater', ratio: 1.02, fixedHorizon: true },
  );
  assert.equal(fixedHorizon.passed, true);
  assert.equal(fixedHorizon.reason, 'threshold-met');

  const disabledFixedHorizon = compareBusterBalanceOutcomes(
    outcome('unresolved', { output10s: 102 }),
    outcome('unresolved', { output10s: 100 }),
    { metric: 'output10s', direction: 'greater', ratio: 1.02, fixedHorizon: false },
  );
  assert.equal(disabledFixedHorizon.inconclusive, true);

  assert.deepEqual(
    compareBusterBalanceOutcomes(
      outcome('cleared', { output10s: 100 }),
      outcome('candidate-invalid', { output10s: 0 }),
      { metric: 'output10s' },
    ),
    { passed: false, configurationError: true, reason: 'comparator-invalid' },
  );
  assert.deepEqual(
    compareBusterBalanceOutcomes(
      outcome('invalid', { output10s: 0 }),
      outcome('cleared', { output10s: 100 }),
      { metric: 'output10s' },
    ),
    { passed: false, reason: 'actual-invalid' },
  );

  const nonfiniteCleared = compareBusterBalanceOutcomes(
    outcome('cleared', { output10s: Number.POSITIVE_INFINITY }),
    outcome('cleared', { output10s: 100 }),
    { metric: 'output10s' },
  );
  assert.equal(nonfiniteCleared.passed, false);
  assert.equal(nonfiniteCleared.reason, 'metric-unresolved');
});

test('hard correctness is independent of frozen-catalog role verdicts and detects mutations', () => {
  const presets = compileCanonicalBusterBalancePresets();
  const correct = evaluateBusterHardCorrectness({ presets });
  assert.equal(correct.passed, true);

  const mutated = structuredClone(presets);
  mutated.balancedBarePulse.peakProjectileReservation = 25;
  mutated.balancedBarePulse.actions[0].totalPower *= 2;
  const detected = evaluateBusterHardCorrectness({ presets: mutated });
  assert.equal(detected.passed, false);
  assert.ok(detected.failures.some((failure) => failure.id === 'projectile-reservations-bounded'));
  assert.ok(detected.failures.some((failure) => failure.id === 'pre-fanout-power-conservation'));
});

test('packet scenario adapter returns explicit status and exact sustained metrics', () => {
  const presets = compileCanonicalBusterBalancePresets();
  const scenario = createBusterBalanceRoleScenarios().compactTwo;
  const metrics = evaluateBusterBalanceScenario(presets.directExplosion, scenario, { duration: 30 });
  assert.equal(metrics.status, 'unresolved');
  assert.ok(metrics.output10s > 0);
  assert.ok(metrics.output30s >= metrics.output10s);
  assert.ok(metrics.uniqueTargetsDamaged10s >= 1);
  assert.equal(metrics.weakPointHits, 0);
  assert.ok(Array.isArray(metrics.transcript));
});

test('the sensitivity grid evaluates 676 diagnostic candidates without selection', () => {
  const diagnostics = runBusterSensitivityDiagnostics();
  assert.equal(diagnostics.candidateCount, 26 * 13 * 2);
  assert.equal(diagnostics.dimensions.level10Scalars, 26);
  assert.equal(diagnostics.dimensions.mortarPowers, 13);
  assert.equal(diagnostics.dimensions.clusterEnergyValues, 2);
  assert.equal(diagnostics.selected, null);
  assert.equal(diagnostics.diagnosticOnly, true);
  assert.equal(diagnostics.validCandidates + diagnostics.invalidCandidates, 676);
});

test('release result separates simulator correctness from the frozen catalog verdict', () => {
  const result = runBusterBalanceSearch();
  assert.equal(result.simulatorCorrect, true);
  assert.equal(result.hardCorrectness.passed, true);
  assert.equal(result.evaluatedCandidates, 676);
  assert.equal(result.sensitivityDiagnostics.selected, null);
  assert.equal(result.releaseReady, result.hardCorrectness.passed && result.roleContracts.passed);

  const summary = summarizeBusterBalanceResult(result);
  assert.deepEqual(Object.keys(summary.sections), [
    'HARD CORRECTNESS',
    'INTERNAL ROLE CONTRACTS',
    'LEGACY CONTEXT REPORTS',
    'SENSITIVITY DIAGNOSTICS',
    'RUNTIME POLICY WARNINGS',
  ]);
  assert.ok(summary.sections['LEGACY CONTEXT REPORTS'].every((entry) => entry.status === 'report-only'));
  const rotation = summary.sections['RUNTIME POLICY WARNINGS']
    .find((entry) => entry.code === 'THREE_WEAPON_ROTATION_REPORT_ONLY')?.rotation;
  assert.equal(rotation?.status, 'bounded');
  assert.equal(rotation?.exact, false);
  assert.equal(rotation?.optimality, 'unproven');
  assert.equal(rotation?.inputPolicy, 'precision-tap/no-insufficient-requests');
  assert.deepEqual(rotation?.searchPolicy, {
    consecutiveNoFireSwaps: 'omitted-unproven',
    statePrecisionDecimals: 6,
    movingScenarios: 'unsupported',
  });
  assert.equal(rotation?.outputLowerBound30s, rotation?.output30s);
  assert.equal(rotation?.outputLowerBound60s, rotation?.output60s);
  assert.deepEqual(rotation?.transitions, { 30: 120001, 60: 120001 });
  assert.equal(rotation?.termination?.[30]?.reason, 'transition-limit');
  assert.equal(rotation?.termination?.[60]?.reason, 'transition-limit');
  assert.ok(Math.abs(rotation.braceTime - 1.62) < 1e-9);
  assert.ok(Math.abs(rotation.swapTime - 2.72) < 1e-9);
  assert.ok(Math.abs(rotation.transitionLockTime - 4.34) < 1e-9);

  if (result.releaseReady) {
    assert.equal(verifyBusterBalanceSelection(), result);
  } else {
    assert.throws(
      () => verifyBusterBalanceSelection(),
      (error) => error instanceof BusterBalanceGateError
        && error.code === 'BUSTER_BALANCE_GATE_FAILED'
        && error.result === result,
    );
  }
});
