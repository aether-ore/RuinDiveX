import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasClearedAuthoredPortalIngress,
  requiresHorizontalPortalIngressProof,
} from '../helpers/journey-runtime.mjs';

const CONTRACT = Object.freeze({
  boundaryPoint: Object.freeze({ x: -70, y: 0.35, z: 47 }),
  interiorPoint: Object.freeze({ x: -71.2, y: 0.35, z: 47 }),
  minimumDepth: 1.2,
  halfWidth: 2.4,
  capsuleRadius: 0.46,
  regionId: 'assembly',
  destinationSurfaceId: 'surface.assembly.floor-east',
  surfaceBounds: Object.freeze({
    min: Object.freeze({ x: -80, y: 0, z: 43 }),
    max: Object.freeze({ x: -70, y: 0.35, z: 51 }),
  }),
  surfaceTopY: 0.35,
});

function diagnostics(position, overrides = {}) {
  return {
    playerPosition: position,
    currentRegionId: 'assembly',
    jumpState: 'Grounded',
    ...overrides,
  };
}

test('portal ingress does not accept an early destination-region flip', () => {
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -70.55, y: 0.35, z: 47 }),
    CONTRACT,
  ), false, 'region ownership at the boundary is not full capsule ingress');
});

test('portal ingress accepts exact authored depth and valid forward overshoot without backtracking', () => {
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -71.2, y: 0.35, z: 47 }),
    CONTRACT,
  ), true, 'the exact authored 1.2m ingress depth must pass');
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -75.4, y: 0.35, z: 48.1 }),
    CONTRACT,
  ), true, 'deeper movement on the same landing must pass without steering backward');
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -71.19, y: 0.35, z: 47 }),
    CONTRACT,
  ), false, 'the proof must not subtract tolerance from authored ingress depth');
});

test('portal ingress rejects a lateral capsule miss outside the clear aperture', () => {
  const usableHalfWidth = CONTRACT.halfWidth - CONTRACT.capsuleRadius;
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -72, y: 0.35, z: 47 + usableHalfWidth + 0.001 }),
    CONTRACT,
  ), false);
});

test('portal ingress requires grounded contact at the declared destination floor height', () => {
  const geometricallyValid = { x: -72, y: 0.35, z: 47 };
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics(geometricallyValid, { jumpState: 'Falling' }),
    CONTRACT,
  ), false, 'an airborne region crossing is not a completed landing');
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ ...geometricallyValid, y: 0.401 }),
    CONTRACT,
  ), false, 'a different floor height must fail the 0.05m support-height proof');
});

test('portal ingress requires full capsule support inside the declared destination surface', () => {
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -79.55, y: 0.35, z: 47 }),
    CONTRACT,
  ), false, 'the player centre alone cannot mask a capsule overhanging the landing');
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -72, y: 0.35, z: 47 }),
    { ...CONTRACT, destinationSurfaceId: null },
  ), false, 'a geometric box without a declared endpoint-surface identity is not plan-owned support');
});

test('portal ingress rejects the wrong region even at valid destination geometry', () => {
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -72, y: 0.35, z: 47 }, { currentRegionId: 'security' }),
    CONTRACT,
  ), false);
});

test('horizontal portal ingress proof explicitly excludes lifts and intentional drops', () => {
  for (const traversalMode of ['walk', 'catwalk', 'bottom-walk', 'stairs']) {
    assert.equal(requiresHorizontalPortalIngressProof({ traversalMode }), true, traversalMode);
  }
  for (const traversalMode of ['lift', 'intentional-drop', 'ladder', 'gear-platform']) {
    assert.equal(requiresHorizontalPortalIngressProof({ traversalMode }), false, traversalMode);
  }
});

test('zero-length boundary-to-interior geometry can never satisfy ingress', () => {
  assert.equal(hasClearedAuthoredPortalIngress(
    diagnostics({ x: -72, y: 0.35, z: 47 }),
    { ...CONTRACT, interiorPoint: CONTRACT.boundaryPoint },
  ), false);
});
