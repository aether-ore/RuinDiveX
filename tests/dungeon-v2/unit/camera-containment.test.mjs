import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

function inside(bounds, point, tolerance = 0.05) {
  return point.x >= bounds.min.x - tolerance && point.x <= bounds.max.x + tolerance
    && point.y >= bounds.min.y - tolerance && point.y <= bounds.max.y + tolerance
    && point.z >= bounds.min.z - tolerance && point.z <= bounds.max.z + tolerance;
}

test('third-person containment clamps a Security camera escape at the native V1 south wall', () => {
  const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
    seed: 'm1-golden-magma',
    undercroftType: 'magma',
    deferSemanticRoomPackIntegration: true,
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const plan = validation.plan;
  const facade = assembleDungeonPlanV2(plan);
  try {
    const camera = new THREE.PerspectiveCamera();
    // Stay west of the real south socket. The retired coordinate was inside
    // the newly authored opening and correctly ceased to be a wall probe.
    camera.position.set(-52, 3.6, 55);
    const desired = camera.position.clone();
    const player = {
      root: { position: new THREE.Vector3(-52, 0, 45) },
      getCameraFocusPosition(target) { return target.copy(this.root.position); },
    };

    assert.equal(facade.environmentRuntime.constrainThirdPersonCamera(camera, player), true);
    const containmentBoundary = plan.structuralBoundaries.find(({ id }) => (
      id === facade.environmentRuntime.lastCameraContainment.planId
    ));
    assert.equal(containmentBoundary?.presentationOwnerId, 'placement.security');
    assert.equal(containmentBoundary?.side, 'south');
    assert.ok(camera.position.distanceTo(desired) > 1);
    assert.ok(camera.position.z < 52.6);
    assert.ok(plan.spatialCells.some((cell) => inside(cell.bounds, camera.position)),
      `constrained camera remained outside every authored cell: ${camera.position.toArray()}`);
    assert.equal(facade.environmentRuntime.cameraContainmentAdjustments, 1);
    const queryStats = facade.environmentRuntime.cameraContainmentQueryStats;
    assert.equal(queryStats.queryCount, 1);
    assert.ok(queryStats.lastCandidateCount > 0);
    assert.ok(queryStats.lastCandidateCount < queryStats.totalColliderCount * 0.35,
      `camera index tested ${queryStats.lastCandidateCount}/${queryStats.totalColliderCount} boundary colliders`);
    assert.ok(queryStats.candidateTests < queryStats.bruteForceEquivalentTests);
  } finally {
    facade.dispose();
  }
});
