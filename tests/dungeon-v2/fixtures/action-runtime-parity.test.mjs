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

function accepted(rawPlan) {
  const validation = validateDungeonPlanV2(rawPlan);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  return validation.plan;
}

function controllerHarness(facade) {
  const player = {
    root: new THREE.Object3D(),
    radius: 0.45,
    collisionHeight: 2.6,
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
  return { player, game, controller: new DungeonController(game, facade) };
}

function normalizedRuntimeAction(facade, action) {
  if (action.type === 'extraction') {
    assert.equal(facade.shrine?.extractionActionId, action.id,
      `${action.id} has no extraction runtime consumer`);
    return {
      id: action.id,
      position: facade.shrine.extractionPosition,
      interactionRadius: facade.shrine.extractionInteractionRadius,
      planFixtureIds: facade.shrine.extractionPlanFixtureIds,
      visualFixtureIds: facade.shrine.extractionVisualFixtureIds,
      colliderIds: facade.shrine.extractionColliderIds,
    };
  }
  const candidates = [
    ...(facade.doors ?? []).filter((entry) => entry.v2ActionId === action.id),
    ...(facade.rewards ?? []).filter((entry) => entry.actionId === action.id),
    ...(facade.mechanisms ?? []).filter((entry) => entry.v2ActionId === action.id),
    ...(facade.safeInteractables ?? []).filter((entry) => entry.id === action.id),
  ];
  assert.equal(candidates.length, 1,
    `${action.id} must have exactly one runtime prompt/interaction consumer`);
  const entry = candidates[0];
  return {
    id: entry.id,
    position: entry.interactionPosition ?? entry.position,
    interactionRadius: entry.interactionRadius,
    planFixtureIds: entry.planFixtureIds,
    visualFixtureIds: entry.visualFixtureIds,
    colliderIds: entry.colliderIds,
  };
}

function assertSelectableActionRuntimeParity(plan, facade) {
  const anchorById = new Map([
    ...(plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
    ...(plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
  ]);
  const { controller } = controllerHarness(facade);
  for (const action of plan.actions.filter(({ interaction }) => (
    interaction?.activationSide && interaction.activationSide !== 'system'
  ))) {
    const anchor = anchorById.get(action.anchorId);
    const runtime = normalizedRuntimeAction(facade, action);
    assert.ok(runtime.position?.isVector3, `${action.id} runtime position is not physical`);
    assert.ok(runtime.position.distanceTo(new THREE.Vector3(
      anchor.position.x, anchor.position.y, anchor.position.z,
    )) <= 0.0001, `${action.id} runtime prompt drifted from its plan anchor`);
    assert.equal(runtime.interactionRadius, action.interaction.radius,
      `${action.id} runtime prompt radius drifted from the shared action contract`);
    assert.deepEqual(runtime.planFixtureIds, [...new Set([
      ...(action.visualFixtureIds ?? []),
      ...(action.colliderIds ?? []),
    ])], `${action.id} runtime physical fixture ownership drifted from the plan`);
    assert.deepEqual(runtime.visualFixtureIds, action.visualFixtureIds,
      `${action.id} runtime visual fixture ownership drifted from the plan`);
    assert.deepEqual(runtime.colliderIds, action.colliderIds,
      `${action.id} runtime collider ownership drifted from the plan`);

    if (action.interaction.requiresLineOfSight === true) {
      const facing = new THREE.Vector3(anchor.forward.x, 0, anchor.forward.z).normalize();
      if (action.interaction.activationSide === 'back') facing.multiplyScalar(-1);
      const standingPosition = new THREE.Vector3(
        anchor.position.x, anchor.position.y, anchor.position.z,
      ).addScaledVector(facing, Math.min(1, action.interaction.radius - 0.1));
      const eye = standingPosition.clone().add(new THREE.Vector3(0, 0.9, 0));
      const target = new THREE.Vector3(
        anchor.position.x, anchor.position.y + 0.8, anchor.position.z,
      );
      assert.equal(controller.isAerialPathClear(eye, target, {
        radius: 0.04,
        verticalRadius: 0.04,
        ignoreAirspace: true,
      }), true, `${action.id} declared selectable side is blocked by its assembled console/collider`);
    }
  }
}

for (const [fixtureId, rawPlan] of [
  ['lab', createTraversalLabPlanV2({ seed: 'runtime-action-parity-lab' })],
  ['golden-magma', createGoldenDungeonPlanV2({ seed: 'runtime-action-parity-magma', undercroftType: 'magma' })],
  ['golden-electrical', createGoldenDungeonPlanV2({ seed: 'runtime-action-parity-electrical', undercroftType: 'electrical' })],
]) {
  test(`${fixtureId} assembles every selectable action at its exact plan-owned physical prompt`, () => {
    const plan = accepted(rawPlan);
    const facade = assembleDungeonPlanV2(plan);
    try {
      assertSelectableActionRuntimeParity(plan, facade);
    } finally {
      facade.dispose();
    }
  });
}

test('Large Refractor and extraction proximity use plan-owned radii instead of legacy constants', () => {
  const plan = accepted(createGoldenDungeonPlanV2({
    seed: 'runtime-objective-prompt-radius',
    undercroftType: 'magma',
  }));
  const facade = assembleDungeonPlanV2(plan);
  try {
    const refractorAction = plan.actions.find(({ id }) => id === 'action.collect.large-refractor');
    const extractionAction = plan.actions.find(({ id }) => id === 'action.extract');
    const shrineDoor = facade.doors.find(({ id }) => id === 'Door_Shrine');
    const { player, game, controller } = controllerHarness(facade);
    shrineDoor.setOpen(true);

    player.root.position.copy(facade.shrine.position)
      .add(new THREE.Vector3(refractorAction.interaction.radius - 0.05, 0, 0));
    controller._updateNearestInteractable();
    assert.equal(controller.getNearestInteractable()?.kind, 'shrine');
    player.root.position.copy(facade.shrine.position)
      .add(new THREE.Vector3(refractorAction.interaction.radius + 0.05, 0, 0));
    controller._updateNearestInteractable();
    assert.notEqual(controller.getNearestInteractable()?.kind, 'shrine',
      'Large Refractor prompt still uses the legacy 2.8m constant');

    facade.shrine.collected = true;
    game.ruinCompleted = true;
    player.root.position.copy(facade.shrine.extractionPosition)
      .add(new THREE.Vector3(extractionAction.interaction.radius - 0.05, 0, 0));
    controller._updateNearestInteractable();
    assert.equal(controller.getNearestInteractable()?.kind, 'extraction');
    player.root.position.copy(facade.shrine.extractionPosition)
      .add(new THREE.Vector3(extractionAction.interaction.radius + 0.05, 0, 0));
    controller._updateNearestInteractable();
    assert.notEqual(controller.getNearestInteractable()?.kind, 'extraction',
      'extraction prompt still uses the legacy 3m constant');
  } finally {
    facade.dispose();
  }
});
