import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { createTraversalLabPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

function createGroundedPlayer(position) {
  return {
    root: new THREE.Group(),
    radius: 0.42,
    jumpState: 'Grounded',
    jetSkateState: { active: false },
    animation: {
      actionState: null,
      isFullBodyActionActive: () => false,
    },
    isPhysicalJumpActive: () => false,
    isDodgeRollAirborne: () => false,
    isPowerKnockbackAirborne: () => false,
    isPowerKnockbackActive: () => false,
    isLedgeClinging: () => false,
    isClimbingLadder: () => false,
    consumeLadderDismountConstraintHandoff: () => false,
    shouldIgnoreGroundConstraint: () => false,
  };
}

function createGame(player) {
  return {
    player,
    enemies: [],
    elapsedTime: 0,
    ruinCompleted: false,
    platformingPlatforms: [],
    debugSpawnedPlatforms: [],
    bossStageRuntime: null,
    getPlatformFloorElevation: () => null,
    isPositionInsidePlatformBlock: () => false,
    _getPlatformingSurfaces: () => [],
    ui: { showToast: () => {} },
    scene: new THREE.Scene(),
  };
}

test('live V2 grounding follows an authored stair continuously without a multi-metre capture', () => {
  const validation = validateDungeonPlanV2(createTraversalLabPlanV2({
    seed: 'stair-runtime-floor-ownership',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const facade = assembleDungeonPlanV2(validation.plan);
  try {
    const surface = validation.plan.walkableSurfaces.find(
      ({ id }) => id === 'surface.lab-entry.approach-lab-entry-reservoir',
    );
    assert.ok(surface);
    const [start, end] = surface.geometry.path;
    const player = createGroundedPlayer(start);
    player.root.position.set(start.x, start.y, start.z);
    const controller = new DungeonController(createGame(player), facade);
    const run = Math.hypot(end.x - start.x, end.z - start.z);
    const direction = {
      x: (end.x - start.x) / run,
      z: (end.z - start.z) / run,
    };
    const sampleSpacing = 0.12;
    const landingRun = 0.72;
    const sampleCount = Math.ceil((run + landingRun) / sampleSpacing);

    for (let index = 1; index <= sampleCount; index += 1) {
      const along = Math.min(run + landingRun, index * sampleSpacing);
      const progress = Math.min(1, along / run);
      const expectedY = THREE.MathUtils.lerp(start.y, end.y, progress);
      // Reproduce an ordinary frame: horizontal movement advances first while
      // Y still belongs to the preceding grounded sample. The ramp may capture
      // only that small physical step, never a remote floor in the same column.
      player.root.position.x = start.x + direction.x * along;
      player.root.position.z = start.z + direction.z * along;
      controller._constrainPlayerToWalkable();
      assert.ok(Math.abs(player.root.position.y - expectedY) <= 1e-9,
        `continuous stair support diverged at ${along.toFixed(2)}m: ${player.root.position.y} != ${expectedY}`);
      assert.equal(player.isLedgeClinging(), false);
    }
  } finally {
    facade.dispose();
  }
});

test('raised portal stair keeps an off-center player capsule supported through the exact deck seam', () => {
  const validation = validateDungeonPlanV2(createTraversalLabPlanV2({
    seed: 'raised-portal-capsule-clearance',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const facade = assembleDungeonPlanV2(validation.plan);
  try {
    const surface = validation.plan.walkableSurfaces.find(
      ({ id }) => id === 'surface.lab-entry.approach-lab-entry-reservoir',
    );
    const landing = validation.plan.walkableSurfaces.find(
      ({ id }) => id === 'surface.lab-entry.landing-lab-entry-reservoir',
    );
    assert.ok(surface);
    assert.ok(landing);
    const [start, end] = surface.geometry.path;
    const run = Math.hypot(end.x - start.x, end.z - start.z);
    const direction = {
      x: (end.x - start.x) / run,
      z: (end.z - start.z) / run,
    };
    const tangent = { x: -direction.z, z: direction.x };
    // This is the lateral offset captured from the public tank-steering
    // journey that previously stepped off the old 3.2m strip and entered
    // LandRecovery. The complete capsule, not merely its root, must fit.
    const publicSteeringOffset = 1.46;
    assert.ok(
      publicSteeringOffset + PLAYER_TRAVERSAL_ENVELOPE.collisionRadius
        <= surface.geometry.width * 0.5 + 1e-9,
      'raised portal stair does not retain a capsule-wide walking margin',
    );

    const progress = 0.76;
    const expected = new THREE.Vector3(
      THREE.MathUtils.lerp(start.x, end.x, progress) + tangent.x * publicSteeringOffset,
      THREE.MathUtils.lerp(start.y, end.y, progress),
      THREE.MathUtils.lerp(start.z, end.z, progress) + tangent.z * publicSteeringOffset,
    );
    const exact = facade.getExactStairSurfaceAt(expected, {
      maxVerticalGap: 0.05,
      tolerance: 0.001,
    });
    assert.equal(exact?.surfaceId, surface.id,
      'the public steering envelope left the authored stair collision strip');

    const player = createGroundedPlayer(expected);
    player.root.position.copy(expected);
    const controller = new DungeonController(createGame(player), facade);
    assert.equal(controller.isPositionWalkable(expected), true);
    controller._constrainPlayerToWalkable();
    assert.ok(Math.abs(player.root.position.y - expected.y) <= 1e-9,
      `off-center stair grounding lost support at y=${player.root.position.y}`);
    assert.equal(player.jumpState, 'Grounded');

    // The incline ends only 1.2m inside the near edge. It must not continue
    // invisibly beneath the remaining three metres of the raised deck.
    assert.ok(Math.abs(end.z - landing.bounds.min.z - 1.2) <= 1e-9,
      `upper stair seam overlaps the landing by ${end.z - landing.bounds.min.z}m`);
  } finally {
    facade.dispose();
  }
});
