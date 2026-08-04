import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdaptiveDungeonQualityController,
  AUTO_DUNGEON_QUALITY_POLICY,
  DUNGEON_QUALITY_MODES,
  DUNGEON_QUALITY_PRESETS,
  DUNGEON_QUALITY_TIERS,
  dungeonFrameTimeP95,
  dungeonQualitySettingsForTier,
} from '../src/dungeon-augmentation/AdaptiveDungeonQualityController.js';

function evaluateWindow(controller, windowEndMs, frameDurationMs) {
  const sampleResult = controller.sample(frameDurationMs, windowEndMs - 1);
  assert.equal(sampleResult.evaluated, false);
  const result = controller.tick(windowEndMs);
  assert.equal(result.evaluated, true);
  assert.equal(result.evaluations.length, 1);
  return result;
}

test('quality presets are immutable and expose the approved tier settings', () => {
  assert.deepEqual(DUNGEON_QUALITY_PRESETS, {
    High: {
      dprCap: 2,
      shadowMapSize: 2048,
      activeLocalLightCap: 8,
      noncriticalDetailDistance: 68,
    },
    Balanced: {
      dprCap: 1.25,
      shadowMapSize: 1024,
      activeLocalLightCap: 6,
      noncriticalDetailDistance: 52,
    },
    Performance: {
      dprCap: 1,
      shadowMapSize: 512,
      activeLocalLightCap: 4,
      noncriticalDetailDistance: 40,
    },
  });
  assert.equal(Object.isFrozen(DUNGEON_QUALITY_PRESETS), true);
  for (const preset of Object.values(DUNGEON_QUALITY_PRESETS)) {
    assert.equal(Object.isFrozen(preset), true);
  }
  assert.equal(
    dungeonQualitySettingsForTier('balanced'),
    DUNGEON_QUALITY_PRESETS.Balanced,
  );
  assert.throws(() => {
    DUNGEON_QUALITY_PRESETS.High.dprCap = 3;
  }, TypeError);
});

test('nearest-rank p95 is deterministic at the 95 percent boundary', () => {
  assert.equal(dungeonFrameTimeP95([]), null);
  assert.equal(dungeonFrameTimeP95([4, 3, 2, 1]), 4);
  assert.equal(dungeonFrameTimeP95([
    ...Array(95).fill(10),
    ...Array(5).fill(50),
  ]), 10);
  assert.equal(dungeonFrameTimeP95([
    ...Array(94).fill(10),
    ...Array(6).fill(50),
  ]), 50);
});

test('fixed High, Balanced, and Performance modes never adapt', () => {
  for (const mode of [
    DUNGEON_QUALITY_MODES.HIGH,
    DUNGEON_QUALITY_MODES.BALANCED,
    DUNGEON_QUALITY_MODES.PERFORMANCE,
  ]) {
    const controller = new AdaptiveDungeonQualityController({ mode });
    for (let window = 1; window <= 4; window += 1) {
      const result = evaluateWindow(controller, window * 2_000, 80);
      assert.equal(result.change, null);
      assert.equal(result.tier, mode);
      assert.equal(result.settings, DUNGEON_QUALITY_PRESETS[mode]);
    }
  }
});

test('Auto downshifts one tier after three consecutive slow p95 windows', () => {
  const controller = new AdaptiveDungeonQualityController({
    mode: DUNGEON_QUALITY_MODES.AUTO,
    initialTier: DUNGEON_QUALITY_TIERS.HIGH,
  });

  let result = evaluateWindow(controller, 2_000, 40);
  assert.equal(result.consecutiveSlowWindows, 1);
  result = evaluateWindow(controller, 4_000, 33.3);
  assert.equal(result.consecutiveSlowWindows, 0, 'the slow threshold is strict');
  result = evaluateWindow(controller, 6_000, 40);
  assert.equal(result.change, null);
  result = evaluateWindow(controller, 8_000, 40);
  assert.equal(result.change, null);
  result = evaluateWindow(controller, 10_000, 40);

  assert.deepEqual(result.change, {
    from: DUNGEON_QUALITY_TIERS.HIGH,
    to: DUNGEON_QUALITY_TIERS.BALANCED,
    reason: 'sustained-slow-p95',
    atMs: 10_000,
  });
  assert.equal(result.tier, DUNGEON_QUALITY_TIERS.BALANCED);
  assert.equal(result.settings, DUNGEON_QUALITY_PRESETS.Balanced);
  assert.equal(result.cooldownRemainingMs, 10_000);
});

test('Auto upgrades after sustained fast p95 and enforces its cooldown', () => {
  const controller = new AdaptiveDungeonQualityController({
    mode: DUNGEON_QUALITY_MODES.AUTO,
    initialTier: DUNGEON_QUALITY_TIERS.PERFORMANCE,
  });

  let result = null;
  for (let window = 1; window <= 7; window += 1) {
    result = evaluateWindow(controller, window * 2_000, 20);
    assert.equal(result.change, null);
  }
  assert.equal(result.sustainedFastDurationMs, 14_000);
  result = evaluateWindow(controller, 16_000, 20);
  assert.equal(result.tier, DUNGEON_QUALITY_TIERS.BALANCED);
  assert.equal(result.change?.reason, 'sustained-fast-p95');
  assert.equal(result.change?.atMs, 16_000);

  for (const windowEndMs of [18_000, 20_000, 22_000, 24_000]) {
    result = evaluateWindow(controller, windowEndMs, 50);
    assert.equal(result.change, null);
    assert.equal(result.consecutiveSlowWindows, 0);
    assert.equal(result.evaluations[0].cooldownActive, true);
  }
  result = evaluateWindow(controller, 26_000, 50);
  assert.equal(result.evaluations[0].cooldownActive, false);
  assert.equal(result.consecutiveSlowWindows, 1);
  result = evaluateWindow(controller, 28_000, 50);
  assert.equal(result.change, null);
  result = evaluateWindow(controller, 30_000, 50);
  assert.deepEqual(result.change, {
    from: DUNGEON_QUALITY_TIERS.BALANCED,
    to: DUNGEON_QUALITY_TIERS.PERFORMANCE,
    reason: 'sustained-slow-p95',
    atMs: 30_000,
  });
});

test('sample and tick process deterministic two-second rolling windows', () => {
  const controller = new AdaptiveDungeonQualityController();
  assert.deepEqual(AUTO_DUNGEON_QUALITY_POLICY, {
    windowDurationMs: 2_000,
    downshiftP95ThresholdMs: 33.3,
    downshiftConsecutiveWindows: 3,
    upgradeP95ThresholdMs: 25,
    upgradeSustainedDurationMs: 15_000,
    tierChangeCooldownMs: 10_000,
  });

  controller.sample(8, 500);
  controller.sample(12, 1_500);
  const first = controller.tick(2_000);
  assert.equal(first.evaluations[0].sampleCount, 2);
  assert.equal(first.lastWindowP95Ms, 12);
  assert.equal(first.nextEvaluationAtMs, 4_000);

  const empty = controller.tick(4_000);
  assert.equal(empty.evaluations[0].sampleCount, 0);
  assert.equal(empty.lastWindowP95Ms, null);
  assert.equal(empty.sustainedFastDurationMs, 0);
});

test('mode changes reset sampling state and timestamp validation rejects reordering', () => {
  const controller = new AdaptiveDungeonQualityController();
  evaluateWindow(controller, 2_000, 40);
  const unchanged = controller.setMode(DUNGEON_QUALITY_MODES.AUTO, 2_100);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.consecutiveSlowWindows, 1);
  assert.equal(unchanged.nextEvaluationAtMs, 4_000);
  const fixed = controller.setMode(DUNGEON_QUALITY_MODES.PERFORMANCE, 2_500);
  assert.equal(fixed.changed, true);
  assert.equal(fixed.tier, DUNGEON_QUALITY_TIERS.PERFORMANCE);
  assert.equal(fixed.consecutiveSlowWindows, 0);
  assert.equal(fixed.nextEvaluationAtMs, 4_500);
  assert.throws(() => controller.tick(2_499), /monotonic/);
  assert.throws(() => controller.sample(Number.NaN, 2_600), /Frame duration/);
  assert.doesNotThrow(() => controller.tick(2_500));
  assert.throws(() => controller.setMode('Cinematic', 2_700), /must be one of/);
  assert.doesNotThrow(() => controller.tick(2_600));
});
