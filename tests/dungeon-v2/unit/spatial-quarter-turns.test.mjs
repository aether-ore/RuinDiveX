import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeYawQuarterTurns,
  rotateBoundarySideQuarterTurns,
  rotatePointQuarterTurns,
  transformBoundsQuarterTurns,
  transformPointQuarterTurns,
} from '../../../src/dungeon-v2/DungeonSpatialMathV2.js';
import {
  GOLDEN_MODULE_DESCRIPTORS_V2,
  TRAVERSAL_LAB_MODULE_DESCRIPTORS_V2,
} from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';

test('quarter-turn point transforms are exact at all four supported yaws', () => {
  const point = { x: 2, y: 3, z: 5 };
  assert.deepEqual([0, 1, 2, 3].map((yaw) => rotatePointQuarterTurns(point, yaw)), [
    { x: 2, y: 3, z: 5 },
    { x: 5, y: 3, z: -2 },
    { x: -2, y: 3, z: -5 },
    { x: -5, y: 3, z: 2 },
  ]);
  assert.equal(normalizeYawQuarterTurns(-1), 3);
  assert.equal(normalizeYawQuarterTurns(5), 1);
});

test('quarter-turn placements apply yaw before world translation', () => {
  assert.deepEqual(transformPointQuarterTurns(
    { x: 2, y: 3, z: 5 },
    { yawQuarterTurns: 1, translation: { x: 10, y: -2, z: 4 } },
  ), { x: 15, y: 1, z: 2 });
});

test('bounds transforms remain normalized at all four supported yaws', () => {
  const local = { min: { x: -2, y: 1, z: -5 }, max: { x: 4, y: 7, z: 3 } };
  const expectedSizes = [
    { x: 6, y: 6, z: 8 },
    { x: 8, y: 6, z: 6 },
    { x: 6, y: 6, z: 8 },
    { x: 8, y: 6, z: 6 },
  ];
  for (const yawQuarterTurns of [0, 1, 2, 3]) {
    const transformed = transformBoundsQuarterTurns(local, {
      yawQuarterTurns,
      translation: { x: 20, y: 2, z: -9 },
    });
    assert.ok(['x', 'y', 'z'].every((axis) => transformed.max[axis] >= transformed.min[axis]));
    assert.deepEqual({
      x: transformed.max.x - transformed.min.x,
      y: transformed.max.y - transformed.min.y,
      z: transformed.max.z - transformed.min.z,
    }, expectedSizes[yawQuarterTurns]);
  }
});

test('boundary facing rotates consistently and vertical faces remain vertical', () => {
  assert.deepEqual([0, 1, 2, 3].map((yaw) => rotateBoundarySideQuarterTurns('north', yaw)), [
    'north', 'west', 'south', 'east',
  ]);
  assert.equal(rotateBoundarySideQuarterTurns('floor', 3), 'floor');
  assert.equal(rotateBoundarySideQuarterTurns('ceiling', 1), 'ceiling');
});

test('spatial transform contract rejects free rotation and invalid vectors', () => {
  assert.throws(() => normalizeYawQuarterTurns(0.5), /integer/);
  assert.throws(() => rotatePointQuarterTurns({ x: 0, y: Number.NaN, z: 0 }, 0), /finite/);
});

test('every authored module descriptor remains valid at all four quarter-turn yaws', () => {
  const descriptors = [
    ...GOLDEN_MODULE_DESCRIPTORS_V2,
    ...TRAVERSAL_LAB_MODULE_DESCRIPTORS_V2,
  ];
  assert.ok(descriptors.length >= 20);
  for (const descriptor of descriptors) {
    const serializedBefore = JSON.stringify(descriptor);
    for (const yawQuarterTurns of [0, 1, 2, 3]) {
      const worldBounds = transformBoundsQuarterTurns(descriptor.bounds, { yawQuarterTurns });
      assert.ok(['x', 'y', 'z'].every((axis) => worldBounds.max[axis] > worldBounds.min[axis]), descriptor.id);
      for (const volume of descriptor.occupiedVolumes) {
        const transformed = transformBoundsQuarterTurns(volume.bounds, { yawQuarterTurns });
        assert.ok(['x', 'y', 'z'].every((axis) => transformed.max[axis] > transformed.min[axis]), `${descriptor.id}:${volume.id}`);
      }
      for (const socket of descriptor.sockets) {
        assert.doesNotThrow(() => rotateBoundarySideQuarterTurns(socket.side, yawQuarterTurns), `${descriptor.id}:${socket.id}`);
        assert.ok(socket.minimumPlayerClearance.width >= 1.2);
        assert.ok(socket.minimumPlayerClearance.height >= 3.2);
      }
    }
    assert.equal(JSON.stringify(descriptor), serializedBefore);
    assert.equal(Object.isFrozen(descriptor), true);
  }
});

test('golden module descriptors carry their immutable V1/new functional source details', () => {
  for (const descriptor of GOLDEN_MODULE_DESCRIPTORS_V2) {
    assert.equal(typeof descriptor.authoredSourceMaterial, 'string', descriptor.id);
    assert.ok(descriptor.authoredSourceMaterial.length > 12, descriptor.id);
    assert.ok(Array.isArray(descriptor.authoredFunctionalFixtures), descriptor.id);
    assert.ok(descriptor.authoredFunctionalFixtures.length >= 3,
      `${descriptor.id} must describe a chamber-specific machinery layout`);
    assert.equal(Object.isFrozen(descriptor.authoredFunctionalFixtures), true, descriptor.id);
    assert.ok(descriptor.authoredFunctionalFixtures.every((fixture) => (
      typeof fixture.id === 'string'
      && typeof fixture.type === 'string'
      && typeof fixture.purpose === 'string'
    )), descriptor.id);
  }
});
