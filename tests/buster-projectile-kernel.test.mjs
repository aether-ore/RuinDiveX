import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseEarlierBusterProjectileEvent,
  chooseEarlierBusterProjectileImpact,
  chooseStableBusterGuidanceCandidate,
  createBusterSegmentPositionSampler,
  findSampledBusterCapsuleHitFraction,
  findStraightBusterCapsuleHitFraction,
  getBusterVerticalCapsule,
  getPointToVerticalCapsuleAxisDistanceSquared,
  getPointToVerticalCapsuleSurfaceDistance,
  sphereIntersectsTargetCapsule,
  steerBusterDirection,
} from '../src/buster/BusterProjectileKernel.js';

function target(id, x, z, options = {}) {
  return {
    id,
    root: { position: { x, y: options.y ?? 0, z } },
    radius: options.radius ?? 0.58,
    collisionHeight: options.collisionHeight ?? 1.8,
  };
}

test('vertical capsule helpers expose production body geometry and sphere inclusion', () => {
  const body = target('body', 0, 0);
  const capsule = getBusterVerticalCapsule(body);
  assert.deepEqual({
    x: capsule.x,
    z: capsule.z,
    radius: capsule.radius,
    bottomY: capsule.bottomY,
  }, { x: 0, z: 0, radius: 0.58, bottomY: 0.58 });
  assert.ok(Math.abs(capsule.topY - 1.22) < 1e-12);
  assert.equal(getPointToVerticalCapsuleAxisDistanceSquared({ x: 0, y: 1.05, z: 0 }, body), 0);
  assert.ok(Math.abs(
    getPointToVerticalCapsuleSurfaceDistance({ x: 0, y: 2, z: 0 }, body) - 0.2,
  ) < 1e-12);
  assert.equal(sphereIntersectsTargetCapsule({
    center: { x: 0, y: 2, z: 0 },
    radius: 0.2,
    target: body,
  }), true);
  assert.equal(sphereIntersectsTargetCapsule({
    center: { x: 2.1311, y: 1.05, z: 0 },
    radius: 1.55,
    target: body,
  }), false);
});

test('straight swept collision returns the first combined-radius boundary', () => {
  const body = target('body', 0, 5);
  const fraction = findStraightBusterCapsuleHitFraction(
    { x: 0, y: 1.05, z: 0 },
    { x: 0, y: 1.05, z: 10 },
    body,
    0.17,
  );
  assert.ok(Math.abs(fraction - 0.425) < 1e-8);
  assert.equal(findStraightBusterCapsuleHitFraction(
    { x: 1, y: 1.05, z: 0 },
    { x: 1, y: 1.05, z: 10 },
    body,
    0.17,
  ), null);
});

test('shared segment sampler preserves straight and ballistic swept paths', () => {
  const straight = createBusterSegmentPositionSampler({
    start: { x: 0, y: 1.05, z: 0 },
    direction: { x: 0, y: 0, z: 1 },
    travel: 6,
    range: 6,
  });
  assert.deepEqual(straight(0.5), { x: 0, y: 1.05, z: 3 });

  const ballistic = createBusterSegmentPositionSampler({
    start: { x: 0, y: 1.05, z: 0 },
    direction: { x: 0, y: 0, z: 1 },
    travel: 6,
    range: 6,
    baseY: 1.05,
    endY: 1.05,
    arcHeight: 1.2,
  });
  assert.ok(Math.abs(ballistic(0.5).y - 2.25) < 1e-12);

  const lowBody = target('low-body', 0, 3);
  assert.equal(findSampledBusterCapsuleHitFraction(ballistic, lowBody, 0.22), null);
  const tallBody = target('tall-body', 0, 3, { collisionHeight: 3 });
  const hit = findSampledBusterCapsuleHitFraction(ballistic, tallBody, 0.22);
  assert.ok(hit > 0 && hit < 1);
});

test('event and impact arbitration keep chronological priority and stable IDs', () => {
  const impact = { type: 'impact', time: 0.5, priority: 1, stableId: 'target-b' };
  const range = { type: 'range', time: 0.5, priority: 2, stableId: 'range' };
  const apex = { type: 'apex', time: 0.5, priority: 0, stableId: 'apex' };
  assert.equal(chooseEarlierBusterProjectileEvent(impact, range), impact);
  assert.equal(chooseEarlierBusterProjectileEvent(impact, apex), apex);
  assert.equal(chooseEarlierBusterProjectileEvent(
    impact,
    { ...impact, stableId: 'target-a' },
  ).stableId, 'target-a');

  const laterId = { enemy: { id: 'target-b' }, fraction: 0.4 };
  const earlierId = { enemy: { id: 'target-a' }, fraction: 0.4 };
  assert.equal(chooseEarlierBusterProjectileImpact(laterId, earlierId), earlierId);
  assert.equal(chooseEarlierBusterProjectileImpact(
    earlierId,
    { enemy: { id: 'target-z' }, fraction: 0.39 },
  ).enemy.id, 'target-z');
});

test('guidance selection and steering use deterministic controlled-projectile ties', () => {
  const boundary = { target: null, stableId: '\uffff', distanceSquared: 25 };
  const targetB = { target: { id: 'target-b' }, stableId: 'target-b', distanceSquared: 9 };
  const targetA = { target: { id: 'target-a' }, stableId: 'target-a', distanceSquared: 9 };
  const selectedB = chooseStableBusterGuidanceCandidate(boundary, targetB);
  assert.equal(chooseStableBusterGuidanceCandidate(selectedB, targetA).target.id, 'target-a');
  assert.equal(chooseStableBusterGuidanceCandidate(
    selectedB,
    targetA,
    { stableTies: false },
  ).target.id, 'target-b');
  assert.equal(chooseStableBusterGuidanceCandidate(
    selectedB,
    { ...targetA, distanceSquared: 9 - 0.0000005 },
    { stableTies: false },
  ).target.id, 'target-a');

  const steered = steerBusterDirection(
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 0 },
    4.2,
    1 / 30,
  );
  const expectedLength = Math.hypot(0.14, 0.86);
  assert.ok(Math.abs(steered.x - 0.14 / expectedLength) < 1e-12);
  assert.ok(Math.abs(steered.z - 0.86 / expectedLength) < 1e-12);
});
