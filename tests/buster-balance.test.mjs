import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSTER_BALANCE_DISTANCES,
  BUSTER_BALANCE_LEGACY_FIXTURES,
  BUSTER_BALANCE_TARGET_PROFILES,
  BusterBalanceGateError,
  compileCanonicalBusterBalancePresets,
  createBusterBalanceScenarioMatrix,
  createCanonicalBusterBalanceSources,
  createLegacyBalanceFixture,
  evaluateBusterBalanceScenario,
  evaluateFullBusterBalanceMatrix,
  runBusterBalanceSearch,
  summarizeBusterBalanceResult,
  verifyBusterBalanceSelection,
} from '../src/buster/BusterBalanceGate.js';

test('canonical balance sources and the complete deterministic matrix stay stable', () => {
  const sources = createCanonicalBusterBalanceSources();
  assert.deepEqual(Object.keys(sources), [
    'balancedBarePulse',
    'balancedBareMortar',
    'pursuitPulse',
    'directSpreadExplosion',
    'delayedMortarClusterExplosion',
    'delayedMortarExplosion',
  ]);
  assert.equal(sources.directSpreadExplosion.program.edges[0].from, 'emitter');
  assert.equal(sources.directSpreadExplosion.program.edges[0].to, 'spread');
  assert.equal(sources.delayedMortarClusterExplosion.program.edges[1].port, 'child');

  const matrix = createBusterBalanceScenarioMatrix();
  assert.equal(matrix.length, 3 * 3 * 5 * 3 * 2 * 3 * 2);
  assert.equal(new Set(matrix.map((scenario) => scenario.id)).size, matrix.length);
  assert.deepEqual(BUSTER_BALANCE_DISTANCES, { near: 3.2, mid: 4.8, far: 6 });
  assert.equal(BUSTER_BALANCE_TARGET_PROFILES.weakPoint.weakPointMultiplier, 2.4);
  assert.equal(BUSTER_BALANCE_LEGACY_FIXTURES.missile.reportOnly, true);
  assert.ok(Object.isFrozen(matrix));
});

test('legacy fixtures reproduce standard midpoint production scaling without affixes', () => {
  const level1MachineGun = createLegacyBalanceFixture('machineGun', 1);
  const level10Cannon = createLegacyBalanceFixture('cannon', 10);
  assert.deepEqual(level1MachineGun.item, {
    attackDamage: 4,
    maxEnergy: 17,
    attackRange: 6.488,
    attackSpeed: 0.433,
    areaDamage: 0,
  });
  assert.equal(level1MachineGun.maxEnergy, 25);
  assert.ok(level1MachineGun.shotDamage > 10);
  assert.deepEqual(level10Cannon.item, {
    attackDamage: 25,
    maxEnergy: 3,
    attackRange: 8.99,
    attackSpeed: 0.07,
    areaDamage: 0.419,
  });
  assert.equal(level10Cannon.maxEnergy, 11);
  assert.ok(level10Cannon.shotDamage > level1MachineGun.shotDamage);
});

test('canonical v0.2 presets use 6/2 parity, Mortar 3, and bounded projectile occupancy', () => {
  const presets = compileCanonicalBusterBalancePresets({ level: 1, level10Scalar: 1, mortarPower: 15 });
  assert.equal(presets.liveCalibratedMega.maxEnergy, 6);
  assert.equal(presets.liveCalibratedMega.energyCost, 2);
  assert.equal(presets.liveCalibratedMega.shotsPerMagazine, 3);
  assert.ok(Math.abs(presets.liveCalibratedMega.shotDamage - 9.12) < 1e-12);
  assert.equal(presets.balancedBarePulse.shotDamage, 8);
  assert.equal(presets.balancedBarePulse.shotsPerMagazine, 3);
  assert.equal(presets.balancedBareMortar.energyCost, 3);
  assert.equal(presets.balancedBareMortar.shotsPerMagazine, 2);
  assert.equal(presets.delayedMortarClusterExplosion.peakProjectileReservation, 5);
  assert.ok(Object.values(presets).every((preset) => preset.peakProjectileReservation <= 24));
});

test('scenario metrics expose battery, output, weak-point, delivery, and occupancy views', () => {
  const scenario = createBusterBalanceScenarioMatrix().find((entry) => (
    entry.level === 5
    && entry.targetCount === 4
    && entry.targetProfileId === 'weakPoint'
    && entry.aimOffset === 'half-radius'
    && entry.motion === 'lateral'
    && entry.distanceBand === 'mid'
    && entry.layout === 'compact'
  ));
  const weapon = compileCanonicalBusterBalancePresets({ level: 5 }).delayedMortarClusterExplosion;
  const metrics = evaluateBusterBalanceScenario(weapon, scenario);
  assert.equal(metrics.openingMagazineShots, 1);
  assert.ok(metrics.openingBatteryPower > 0);
  assert.ok(metrics.output10s > 0);
  assert.ok(metrics.output30s > metrics.output10s);
  assert.ok(metrics.deliveryDelay >= 0.6);
  assert.ok(metrics.projectileOccupancy > 0);
  assert.equal(metrics.occupancyWithinReservation, true);
  assert.equal(metrics.precisionWeakPointCapable, false);
  assert.equal(metrics.weakPointDamagePerTrigger, 0);
  assert.ok(Number.isFinite(metrics.roomClearTime));
});

test('the full benchmark report evaluates all canonical presets and report-only fixtures', () => {
  const report = evaluateFullBusterBalanceMatrix({ includeMissile: true });
  assert.equal(report.scenarioCount, 1620);
  assert.equal(report.rows.length, 1620);
  const first = report.rows[0];
  assert.deepEqual(Object.keys(first.presets), [
    'liveCalibratedMega',
    'balancedBarePulse',
    'balancedBareMortar',
    'pursuitPulse',
    'directSpreadExplosion',
    'delayedMortarClusterExplosion',
  ]);
  assert.deepEqual(Object.keys(first.fixtures), ['machineGun', 'cannon', 'missile']);
  assert.ok(Object.isFrozen(report.rows));
  assert.ok(Object.hasOwn(first.presets.balancedBarePulse, 'sustained30s'));
  assert.ok(Object.hasOwn(first.presets.balancedBarePulse, 'roomClearTime'));
});

test('the exhaustive authorized search deterministically reports the current release blocker', () => {
  const result = runBusterBalanceSearch();
  assert.equal(result.releaseReady, false);
  assert.equal(result.evaluatedCandidates, 26 * 13);
  assert.equal(result.selected, null);
  assert.ok(result.nearest);
  assert.ok(result.nearest.constants.level10Scalar >= 1 && result.nearest.constants.level10Scalar <= 1.25);
  assert.ok(result.nearest.constants.mortarPower >= 12 && result.nearest.constants.mortarPower <= 18);
  assert.ok(result.nearest.gates.failedCount > 0);
  assert.ok(result.nearest.detectors.failures.some((failure) => failure.code === 'LEVEL_10_TTK_ENVELOPE'));
  assert.equal(result.clusterFallback.reason, 'fallback-not-authorized');

  const summary = summarizeBusterBalanceResult(result);
  assert.equal(summary.releaseReady, false);
  assert.ok(summary.failures.length > 0);
  assert.throws(
    () => verifyBusterBalanceSelection(),
    (error) => error instanceof BusterBalanceGateError
      && error.code === 'BUSTER_BALANCE_GATE_FAILED'
      && error.result.nearest.constants.level10Scalar === result.nearest.constants.level10Scalar,
  );
});
