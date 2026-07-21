import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DungeonAcceptanceError,
  deriveExpectedNativeRampTileProfile,
} from '../helpers/accepted-fixture.mjs';

function rampTile({
  direction,
  startY = 3,
  endY = 5,
  bounds = {
    min: { x: 10, y: 2.8, z: 20 },
    max: { x: 14, y: 5, z: 26 },
  },
} = {}) {
  return {
    id: 'surface.native-ramp.unit',
    shape: 'ramp-tile',
    bounds,
    // Deliberately wrong duplicates prove that the independent acceptance
    // oracle derives its result from bounds plus the serializable ramp data.
    center: { x: 999, y: 999, z: 999 },
    size: { x: 999, y: 999, z: 999 },
    ramp: { direction, startY, endY },
  };
}

const CARDINAL_CASES = Object.freeze([
  Object.freeze({
    label: '+X', direction: Object.freeze({ x: 2, z: 0 }),
    start: Object.freeze({ x: 10, y: 3, z: 23 }),
    end: Object.freeze({ x: 14, y: 5, z: 23 }),
    length: 4, width: 6,
  }),
  Object.freeze({
    label: '-X', direction: Object.freeze({ x: -2, z: 0 }),
    start: Object.freeze({ x: 14, y: 3, z: 23 }),
    end: Object.freeze({ x: 10, y: 5, z: 23 }),
    length: 4, width: 6,
  }),
  Object.freeze({
    label: '+Z', direction: Object.freeze({ x: 0, z: 3 }),
    start: Object.freeze({ x: 12, y: 3, z: 20 }),
    end: Object.freeze({ x: 12, y: 5, z: 26 }),
    length: 6, width: 4,
  }),
  Object.freeze({
    label: '-Z', direction: Object.freeze({ x: 0, z: -3 }),
    start: Object.freeze({ x: 12, y: 3, z: 26 }),
    end: Object.freeze({ x: 12, y: 5, z: 20 }),
    length: 6, width: 4,
  }),
]);

test('native ramp facade oracle independently derives all four yaw profiles from serialized bounds', () => {
  for (const fixture of CARDINAL_CASES) {
    const serializedSurface = JSON.parse(JSON.stringify(rampTile({ direction: fixture.direction })));
    const profile = deriveExpectedNativeRampTileProfile(serializedSurface);
    assert.deepEqual(profile.start, fixture.start, `${fixture.label} start`);
    assert.deepEqual(profile.end, fixture.end, `${fixture.label} end`);
    assert.equal(profile.length, fixture.length, `${fixture.label} length`);
    assert.equal(profile.width, fixture.width, `${fixture.label} width`);
    assert.ok(Math.abs(Math.hypot(profile.direction.x, profile.direction.z) - 1) <= 1e-12,
      `${fixture.label} direction must be normalized by the acceptance oracle`);
  }
});

function rejectsWithCode(surface, code) {
  assert.throws(
    () => deriveExpectedNativeRampTileProfile(surface),
    (error) => error instanceof DungeonAcceptanceError && error.code === code,
    `expected ${code}`,
  );
}

test('native ramp facade oracle fails closed on missing, zero, or non-finite traversal contracts', () => {
  rejectsWithCode({ ...rampTile({ direction: { x: 1, z: 0 } }), shape: 'floor' },
    'facade-ramp-contract-missing');
  rejectsWithCode(rampTile({ direction: { x: 0, z: 0 } }),
    'facade-ramp-direction-invalid');
  rejectsWithCode(rampTile({ direction: { x: Number.NaN, z: 0 } }),
    'facade-ramp-direction-invalid');
  rejectsWithCode(rampTile({ direction: { x: 1, z: 0 }, endY: Number.POSITIVE_INFINITY }),
    'facade-ramp-level-invalid');
  rejectsWithCode(rampTile({
    direction: { x: 1, z: 0 },
    bounds: {
      min: { x: 10, y: 2.8, z: 20 },
      max: { x: 10, y: 5, z: 26 },
    },
  }), 'facade-ramp-footprint-invalid');
});
