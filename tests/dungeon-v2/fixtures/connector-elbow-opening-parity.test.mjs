import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { buildIndependentPortalRouteProofs } from '../helpers/assembly-proofs.mjs';

const GOLDEN_SEED = 'm1-golden-magma';
const SAMPLE_SPACING = 0.21;
const PARITY_TOLERANCE = 0.05;

function goldenCandidate() {
  return createGoldenDungeonPlanV2({
    seed: GOLDEN_SEED,
    undercroftType: 'magma',
  });
}

function acceptedGolden() {
  const validation = validateDungeonPlanV2(goldenCandidate());
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  return validation.plan;
}

function faceContract(boundary, cell) {
  const axis = ['east', 'west'].includes(boundary.side) ? 'x'
    : ['north', 'south'].includes(boundary.side) ? 'z' : 'y';
  const plane = ['west', 'north', 'floor'].includes(boundary.side)
    ? cell.bounds.min[axis]
    : cell.bounds.max[axis];
  return { axis, plane };
}

function routeSamples(points, spacing = SAMPLE_SPACING) {
  const samples = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const count = Math.max(1, Math.ceil(distance / spacing));
    for (let sampleIndex = index === 1 ? 0 : 1; sampleIndex <= count; sampleIndex += 1) {
      const ratio = sampleIndex / count;
      samples.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        z: start.z + (end.z - start.z) * ratio,
      });
    }
  }
  return samples;
}

function capsuleIntersectsBounds(point, bounds) {
  const radius = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
  const height = Math.max(PLAYER_TRAVERSAL_ENVELOPE.standingHeight, 3.2);
  const bottom = point.y + 0.025;
  const top = point.y + height;
  if (bounds.max.y <= bottom + 0.005 || bounds.min.y >= top - 0.005) return false;
  const deltaX = Math.max(bounds.min.x - point.x, 0, point.x - bounds.max.x);
  const deltaZ = Math.max(bounds.min.z - point.z, 0, point.z - bounds.max.z);
  return deltaX * deltaX + deltaZ * deltaZ < radius * radius - 1e-8;
}

function colliderBounds(collider) {
  if (collider?.bounds?.min && collider?.bounds?.max) {
    return new THREE.Box3(
      new THREE.Vector3(collider.bounds.min.x, collider.bounds.min.y, collider.bounds.min.z),
      new THREE.Vector3(collider.bounds.max.x, collider.bounds.max.y, collider.bounds.max.z),
    );
  }
  return null;
}

test('actual golden seed keeps every connector elbow aperture on its owning cell face', () => {
  const plan = acceptedGolden();
  const cellById = new Map(plan.spatialCells.map((cell) => [cell.id, cell]));
  const jointOpenings = plan.structuralBoundaries.flatMap((boundary) => (
    (boundary.openings ?? [])
      .filter((opening) => opening.jointId)
      .map((opening) => ({ boundary, opening }))
  ));
  assert.ok(jointOpenings.length > 0, 'golden seed must exercise internal connector elbows');
  for (const { boundary, opening } of jointOpenings) {
    const cell = cellById.get(boundary.cellId);
    assert.ok(cell, `${boundary.id} has no owning connector cell`);
    const { axis, plane } = faceContract(boundary, cell);
    assert.ok(Math.abs(opening.center[axis] - plane) <= 0.001,
      `${opening.id} is ${Math.abs(opening.center[axis] - plane)}m off ${boundary.side} face`);
  }
});

test('validator rejects a connector elbow aperture displaced into its cell', () => {
  const candidate = structuredClone(goldenCandidate());
  const boundary = candidate.structuralBoundaries.find((entry) => (
    (entry.openings ?? []).some((opening) => opening.jointId)
  ));
  const opening = boundary.openings.find((entry) => entry.jointId);
  const cell = candidate.spatialCells.find(({ id }) => id === boundary.cellId);
  const { axis, plane } = faceContract(boundary, cell);
  opening.center[axis] = plane + (['west', 'north', 'floor'].includes(boundary.side) ? 2.4 : -2.4);
  const validation = validateDungeonPlanV2(candidate);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, details }) => (
    code === 'connector-elbow-opening-off-plane'
      && details.openingId === opening.id
      && details.boundaryId === boundary.id
  )), JSON.stringify(validation.errors, null, 2));
});

test('actual Security to Assembly elbow is clear for the production capsule with visual/collider parity', () => {
  const plan = acceptedGolden();
  const portal = plan.portals.find(({ id }) => id === 'portal.security-assembly');
  assert.ok(portal, 'actual golden seed must contain the Security to Assembly portal');
  const facade = assembleDungeonPlanV2(plan);
  try {
    const proof = buildIndependentPortalRouteProofs(plan, facade)
      .find(({ portalId }) => portalId === portal.id);
    assert.equal(proof.traversable, true, JSON.stringify(proof, null, 2));
    assert.deepEqual(proof.uncoveredSamples, []);
    assert.deepEqual(proof.blockedSamples, []);
    assert.equal(proof.approachClearanceAccepted, true, JSON.stringify(proof, null, 2));

    const activeBlockers = [...facade.structuralRegistry.colliders.values()]
      .filter((collider) => collider?.active !== false
        && collider?.enabled !== false
        && collider?.obstacleKind !== 'floor'
        && collider?.bounds?.min && collider?.bounds?.max);
    for (const sample of routeSamples(portal.physicalRoute.routePoints)) {
      const blocker = activeBlockers.find((collider) => capsuleIntersectsBounds(sample, collider.bounds));
      assert.equal(blocker, undefined,
        `production capsule at ${JSON.stringify(sample)} intersects ${blocker?.id ?? blocker?.planId}`);
    }

    const elbowBoundaries = plan.structuralBoundaries.filter((boundary) => (
      (boundary.openings ?? []).some((opening) => opening.portalId === portal.id && opening.jointId)
    ));
    assert.ok(elbowBoundaries.length >= 2, 'Security to Assembly must retain a real elbow');
    for (const boundary of elbowBoundaries) {
      const record = facade.structuralRegistry.byPlanId.get(boundary.id);
      assert.ok(record?.visualIds?.length > 0, `${boundary.id} has no assembled visual segments`);
      assert.equal(record.visualIds.length, record.colliderIds?.length,
        `${boundary.id} visual/collider segment counts diverged`);
      for (let index = 0; index < record.visualIds.length; index += 1) {
        const visual = facade.structuralRegistry.visuals.get(record.visualIds[index]);
        const collider = facade.structuralRegistry.colliders.get(record.colliderIds[index]);
        visual.updateWorldMatrix(true, true);
        const visualBounds = new THREE.Box3().setFromObject(visual);
        const physicalBounds = colliderBounds(collider);
        assert.ok(physicalBounds, `${record.colliderIds[index]} has no exact bounds`);
        for (const axis of ['x', 'y', 'z']) {
          assert.ok(Math.abs(visualBounds.min[axis] - physicalBounds.min[axis]) <= PARITY_TOLERANCE
            && Math.abs(visualBounds.max[axis] - physicalBounds.max[axis]) <= PARITY_TOLERANCE,
          `${boundary.id}:${index} ${axis} visual/collider bounds diverged`);
        }
      }
    }
  } finally {
    facade.dispose();
  }
});
