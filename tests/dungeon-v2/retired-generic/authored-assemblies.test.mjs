// RETIRED: documents the rejected generic Golden/lab assembly; not acceptance coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createGoldenDungeonPlanV2,
  createTraversalLabPlanV2,
} from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';
import { DungeonController } from '../../../src/DungeonController.js';
import { assertAcceptedDungeonFixture } from '../helpers/accepted-fixture.mjs';
import {
  buildIndependentPortalRouteProofs,
  buildMechanismStateProofs,
  buildOffscreenStructuralRenderProof,
  buildStructuralAssemblyProof,
} from '../helpers/assembly-proofs.mjs';

function maximumBoundsDelta(left, right) {
  return Math.max(...['x', 'y', 'z'].flatMap((axis) => [
    Math.abs(left.min[axis] - right.min[axis]),
    Math.abs(left.max[axis] - right.max[axis]),
  ]));
}

function assertGateFacadeAndControllerParity(plan, facade) {
  const player = {
    root: new THREE.Object3D(),
    radius: 0.45,
    isClimbingLadder: () => false,
  };
  const game = {
    player,
    enemies: [],
    ruinCompleted: false,
    elapsedTime: 0,
    platformingPlatforms: [],
    debugSpawnedPlatforms: [],
    isPositionInsidePlatformBlock: () => false,
    getPlatformFloorElevation: () => null,
    _getPlatformingSurfaces: () => [],
  };
  const controller = new DungeonController(game, facade);
  const portalById = new Map(plan.portals.map((portal) => [portal.id, portal]));
  const anchorById = new Map(plan.anchors.map((anchor) => [anchor.id, anchor]));
  const boundaryById = new Map(plan.structuralBoundaries.map((boundary) => [boundary.id, boundary]));
  for (const gate of plan.progression.gateContracts) {
    const door = facade.doors.find(({ id }) => id === gate.id);
    const anchor = anchorById.get(gate.anchorId);
    const barrier = boundaryById.get(gate.barrierBoundaryId ?? gate.barrierId);
    const portal = portalById.get(gate.portalId);
    assert.ok(door && anchor && barrier && portal, `${gate.id} lacks facade/plan parity data`);
    assert.ok(door.interactionPosition.distanceTo(new THREE.Vector3(
      anchor.position.x, anchor.position.y, anchor.position.z,
    )) <= 0.05, `${gate.id} prompt is not at its plan-owned console anchor`);
    const barrierCenter = new THREE.Vector3(
      (barrier.bounds.min.x + barrier.bounds.max.x) * 0.5,
      (barrier.bounds.min.y + barrier.bounds.max.y) * 0.5,
      (barrier.bounds.min.z + barrier.bounds.max.z) * 0.5,
    );
    assert.ok(door.collisionPosition.distanceTo(barrierCenter) <= 0.05,
      `${gate.id} collision is not in the portal aperture`);
    assert.ok(Math.hypot(
      door.interactionPosition.x - door.collisionPosition.x,
      door.interactionPosition.z - door.collisionPosition.z,
    ) >= 0.75, `${gate.id} console clips the gate walkway`);

    facade.group.updateMatrixWorld(true);
    const closedVisualBounds = new THREE.Box3().setFromObject(door.barrierObject);
    const authoredBounds = new THREE.Box3(
      new THREE.Vector3(barrier.bounds.min.x, barrier.bounds.min.y, barrier.bounds.min.z),
      new THREE.Vector3(barrier.bounds.max.x, barrier.bounds.max.y, barrier.bounds.max.z),
    );
    assert.ok(maximumBoundsDelta(closedVisualBounds, authoredBounds) <= 0.05,
      `${gate.id} closed visual does not fill its exact authored aperture`);
    assert.equal(door.object.position.y, door.closedY);
    assert.equal(door.barrierColliders.every(({ active }) => active !== false), true);
    assert.equal(controller._isResolvedFloorPositionWalkable(door.collisionPosition), false,
      `${gate.id} closed state does not physically block the aperture`);
    assert.equal(controller._isResolvedFloorPositionWalkable(door.interactionPosition), true,
      `${gate.id} interaction console is itself blocking the player`);

    player.root.position.copy(door.interactionPosition);
    controller._updateNearestInteractable();
    assert.equal(controller.getNearestInteractable()?.target?.id, gate.id,
      `${gate.id} prompt is not selected from interactionPosition`);
    player.root.position.copy(door.collisionPosition);
    controller._updateNearestInteractable();
    if (door.interactionPosition.distanceTo(door.collisionPosition) > door.interactionRadius) {
      assert.notEqual(controller.getNearestInteractable()?.target?.id, gate.id,
        `${gate.id} incorrectly prompts from its collider instead of its side console`);
    }

    door.setOpen(true);
    controller._updateDoorVisuals(1);
    assert.ok(Math.abs(door.object.position.y - door.openY) <= 0.001,
      `${gate.id} visual did not move to its declared openY`);
    assert.equal(door.barrierColliders.every(({ active }) => active === false), true);
    assert.equal(controller._isResolvedFloorPositionWalkable(door.collisionPosition), true,
      `${gate.id} opened state did not clear the portal aperture`);
    door.setOpen(false);
    controller._updateDoorVisuals(1);
  }
}

function assertAuthoredAssembly(rawPlan) {
  assert.equal(rawPlan.accepted, undefined, 'raw authored plans are not assembly inputs');
  const validation = validateDungeonPlanV2(rawPlan);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const plan = validation.plan;
  assertAcceptedDungeonFixture(plan, { stage: 'plan' });
  const facade = assembleDungeonPlanV2(plan);
  try {
    const fixture = {
      stage: 'assembly',
      plan,
      facade,
      proofs: {
        visualCollider: buildStructuralAssemblyProof(plan, facade),
        portalRoutes: buildIndependentPortalRouteProofs(plan, facade),
        mechanismStates: buildMechanismStateProofs(plan, facade),
        offscreenStructuralRender: buildOffscreenStructuralRenderProof(plan, facade),
      },
    };
    assertAcceptedDungeonFixture(fixture);
    assert.equal(facade.rooms.length, plan.regions.length);
    assert.equal(facade.connectorRouteProofs.length, plan.portals.length);
    assert.ok(facade.group.children.length > 0);
    if (plan.acceptanceProfile === 'golden') assertGateFacadeAndControllerParity(plan, facade);
  } finally {
    facade.dispose();
  }
}

test('assembler deterministically rejects unvalidated authored plan data', () => {
  const rawPlan = createTraversalLabPlanV2({ seed: 'm1-raw-plan-rejection' });
  assert.throws(() => assembleDungeonPlanV2(rawPlan), /accepted|validated/i);
});

test('three-floor traversal lab assembly passes registry and independent route proofs', () => {
  assertAuthoredAssembly(createTraversalLabPlanV2({ seed: 'm1-traversal-lab-assembly' }));
});

for (const undercroftType of ['magma', 'electrical']) {
  test(`${undercroftType} golden assembly passes registry and independent route proofs`, () => {
    assertAuthoredAssembly(createGoldenDungeonPlanV2({ seed: `m1-${undercroftType}-assembly`, undercroftType }));
  });
}
