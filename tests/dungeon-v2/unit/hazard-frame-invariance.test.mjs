import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCyclicHazardPhaseAt,
  integrateCyclicHazardActiveSeconds,
  integrateHazardExposureV2,
} from '../../../src/dungeon-v2/DungeonHazardMathV2.js';

const MAGMA = Object.freeze({
  entryGraceSeconds: 0.5,
  pulseSeconds: 0.25,
  damagePerSecond: 12,
});

const ELECTRICAL = Object.freeze({
  damagePerSecond: 9,
  phases: Object.freeze([
    Object.freeze({ id: 'safe', durationSeconds: 1.25 }),
    Object.freeze({ id: 'charging', durationSeconds: 0.75 }),
    Object.freeze({ id: 'energized', durationSeconds: 1.5 }),
  ]),
});

function integrateChunks(definition, chunks, globalStartSeconds = 0) {
  let state = {};
  let elapsed = globalStartSeconds;
  let damage = 0;
  let pulses = 0;
  for (const durationSeconds of chunks) {
    state = integrateHazardExposureV2(definition, state, {
      durationSeconds,
      globalStartSeconds: elapsed,
      inside: true,
    });
    damage += state.damage;
    pulses += state.pulses;
    elapsed += durationSeconds;
  }
  return { state, damage, pulses };
}

test('magma entry grace, damage, and pulse accumulation are frame-chunk invariant', () => {
  const oneFrame = integrateChunks(MAGMA, [2]);
  const manyFrames = integrateChunks(MAGMA, Array.from({ length: 120 }, () => 1 / 60));
  assert.ok(Math.abs(oneFrame.damage - 18) < 1e-9);
  assert.ok(Math.abs(manyFrames.damage - oneFrame.damage) < 1e-9);
  assert.equal(oneFrame.pulses, 6);
  assert.equal(manyFrames.pulses, oneFrame.pulses);
});

test('electrical phase timing and active damage are frame-chunk invariant across cycle boundaries', () => {
  const start = 1.1;
  const duration = 5.7;
  const oneFrame = integrateChunks(ELECTRICAL, [duration], start);
  const manyFrames = integrateChunks(ELECTRICAL, Array.from({ length: 342 }, () => 1 / 60), start);
  assert.ok(Math.abs(manyFrames.damage - oneFrame.damage) < 1e-9);
  assert.ok(Math.abs(
    integrateCyclicHazardActiveSeconds(ELECTRICAL, start, duration) * 9 - oneFrame.damage,
  ) < 1e-9);
  assert.equal(getCyclicHazardPhaseAt(ELECTRICAL, 1.3).id, 'charging');
  assert.equal(getCyclicHazardPhaseAt(ELECTRICAL, 2.1).id, 'energized');
  assert.equal(getCyclicHazardPhaseAt(ELECTRICAL, 3.6).id, 'safe');
});

test('leaving a hazard resets entry-grace exposure state', () => {
  const entered = integrateHazardExposureV2(MAGMA, {}, { durationSeconds: 0.4, inside: true });
  const outside = integrateHazardExposureV2(MAGMA, entered, { durationSeconds: 1, inside: false });
  const reentered = integrateHazardExposureV2(MAGMA, outside, { durationSeconds: 0.4, inside: true });
  assert.equal(entered.damage, 0);
  assert.equal(reentered.damage, 0);
  assert.equal(reentered.exposureSeconds, 0.4);
});

