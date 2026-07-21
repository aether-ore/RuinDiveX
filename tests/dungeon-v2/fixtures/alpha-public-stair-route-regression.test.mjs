import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';
import { Game } from '../../../src/Game.js';
import { Player } from '../../../src/Player.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

const ALPHA_LINK_ID = 'traversal.security.security-sorting-alpha';

function createPhysicalPlayer(position) {
  const player = Object.create(Player.prototype);
  player.root = new THREE.Group();
  player.root.position.copy(position);
  player.radius = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
  player.dead = false;
  player.velocity = new THREE.Vector3();
  player.takeoffHorizontalVelocity = new THREE.Vector3();
  player.lastMoveDirection = new THREE.Vector3(0, 0, 1);
  player.jumpDirection = new THREE.Vector3(0, 0, 1);
  player.jumpSettings = {
    forwardSpeed: 6.2,
    groundAcceleration: 24,
    groundDeceleration: 22,
    coyoteTime: 0.03,
  };
  player.environmentTraversalProfile = {
    flooded: false,
    movementMultiplier: 1,
    jumpHeight: null,
    gravityScale: 1,
  };
  player.takeoffEnvironmentTraversalProfile = null;
  player.gearEffects = {};
  player.jetSkateState = { active: false };
  player.powerKnockbackState = null;
  player.externalControl = null;
  player.externalBallisticMotion = null;
  player.ladderTraversal = null;
  player.ladderDismountConstraintPasses = 0;
  player.ledgeCling = null;
  player.jumpState = 'Grounded';
  player._jumpGroundY = position.y;
  player._jumpBufferTimer = 0;
  player._coyoteTimer = 0.03;
  player._landingRecoveryTimer = 0;
  player._jumpAirTimer = 0;
  player._jumpFallTransitionActive = false;
  player._jumpKind = 'forwardJump';
  player._jumpLandingVisualTimer = 0;
  player._jumpLandingVisualState = null;
  player._jumpLandingVisualClipKey = null;
  player._jumpSlashVisualState = null;
  player.animation = {
    actionState: null,
    hurtTimer: 0,
    attackTimer: 0,
    externalControlLocked: false,
    isFullBodyActionActive: () => false,
  };
  return player;
}

function createProductionSupportGame(player, facade) {
  const game = {
    player,
    dungeon: facade,
    enemies: [],
    elapsedTime: 0,
    ruinCompleted: false,
    platformingPlatforms: (facade.platforms ?? []).filter(({ dynamic }) => dynamic !== true),
    dynamicPlatformingPlatforms: (facade.platforms ?? []).filter(({ dynamic }) => dynamic === true),
    debugSpawnedPlatforms: [],
    bossStageRuntime: null,
    ui: { showToast() {} },
    scene: new THREE.Scene(),
  };
  for (const methodName of [
    '_getPlatformingSurfaces',
    '_recordPlatformQuery',
    '_getPlatformFloorElevation',
    'getPlatformSupport',
    'getPlatformFloorElevation',
    '_isPositionInsidePlatformBlock',
    'isPositionInsidePlatformBlock',
  ]) {
    game[methodName] = Game.prototype[methodName].bind(game);
  }
  return game;
}

function resolveGroundY(controller, game, position) {
  const stairY = controller.getRampSurfaceElevationAt(position);
  if (Number.isFinite(stairY)) return stairY;
  const platformY = game.getPlatformFloorElevation(position);
  if (Number.isFinite(platformY)) return platformY;
  return controller.getFloorElevationAt(position);
}

function advanceOneClampedHeartbeat(player, controller, game, target) {
  const direction = target.clone().sub(player.root.position).setY(0).normalize();
  const groundY = resolveGroundY(controller, game, player.root.position);
  player._updatePhysicalJumpAndMovement(
    1 / 20,
    direction.multiplyScalar(6.2),
    { arenaRadius: 1_000, movementOptions: { groundY } },
  );
  controller._constrainPlayerToWalkable();
}

test('native V1 Alpha-ramp descent stays on authored support with heartbeat-bounded KeyW', () => {
  const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
    seed: 'm1-golden-magma',
    undercroftType: 'magma',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  const { plan } = validation;
  const facade = assembleDungeonPlanV2(plan);
  try {
    const link = plan.traversalLinks.find(({ id }) => id === ALPHA_LINK_ID);
    assert.ok(link, `${ALPHA_LINK_ID} missing from the actual golden seed`);
    const stair = plan.walkableSurfaces.find(({ id }) => id === link.viaSurfaceId);
    assert.ok(stair, `${link.viaSurfaceId} missing from the actual golden seed`);
    assert.equal(stair.presentationOwnerId, 'placement.security');
    assert.equal(stair.id.startsWith(
      'placement.security:surface.v1-room.security-entrance.',
    ), true);
    assert.equal(link.nativeRampSurfaceIds.length, 3);
    assert.equal(link.approachContract?.jumpAllowed, false);
    assert.equal(link.approachContract?.ledgeClimbAllowed, false);
    assert.deepEqual(stair.supportBoundaryIds, [
      'placement.security:boundary.v1-room.security-entrance.floor.foundation',
    ]);

    const start = link.stairWaypoints.at(-2);
    const targetRecord = link.stairWaypoints.at(-3);
    assert.ok(start && targetRecord, 'native Alpha ramp requires public centerline checkpoints');
    for (const [label, sample] of [
      ['native upper descent sample', start],
      ['native next descent checkpoint', targetRecord],
    ]) {
      const exact = facade.getExactStairSurfaceAt(new THREE.Vector3(sample.x, sample.y, sample.z), {
        maxVerticalGap: 0.001,
        tolerance: 0.025,
      });
      assert.equal(exact?.surfaceId, stair.id, `${label} lost Alpha stair ownership`);
      assert.ok(Math.abs(exact.elevation - sample.y) <= 1e-9,
        `${label} has stale Y ${sample.y}; authored elevation is ${exact.elevation}`);
    }

    const [foot, top] = stair.stairs.path;
    const run = Math.hypot(top.x - foot.x, top.z - foot.z);
    const tangent = {
      x: -(top.z - foot.z) / run,
      z: (top.x - foot.x) / run,
    };
    const overshoot = new THREE.Vector3(
      (foot.x + top.x) * 0.5 + tangent.x * (
        stair.stairs.width * 0.5 + PLAYER_TRAVERSAL_ENVELOPE.collisionRadius + 0.1
      ),
      (foot.y + top.y) * 0.5,
      (foot.z + top.z) * 0.5 + tangent.z * (
        stair.stairs.width * 0.5 + PLAYER_TRAVERSAL_ENVELOPE.collisionRadius + 0.1
      ),
    );
    assert.equal(facade.getExactStairSurfaceAt(overshoot, {
      maxVerticalGap: Infinity,
      tolerance: 0.025,
    }), null, 'a full-capsule lateral overshoot is not falsely owned by the native ramp');

    const player = createPhysicalPlayer(new THREE.Vector3(
      start.x,
      start.y,
      start.z,
    ));
    const game = createProductionSupportGame(player, facade);
    const controller = new DungeonController(game, facade);
    const target = new THREE.Vector3(targetRecord.x, targetRecord.y, targetRecord.z);
    let reachedTarget = false;
    for (let frame = 0; frame < 30; frame += 1) {
      advanceOneClampedHeartbeat(player, controller, game, target);
      const exact = facade.getExactStairSurfaceAt(player.root.position, {
        maxVerticalGap: 0.001,
        tolerance: 0.025,
      });
      assert.equal(exact?.surfaceId, stair.id,
        `one-heartbeat KeyW drifted off the Alpha stair on frame ${frame}: ${JSON.stringify(player.root.position.toArray())}`);
      assert.ok(Math.abs(player.root.position.y - exact.elevation) <= 1e-9);
      assert.equal(player.jumpState, 'Grounded');
      assert.equal(player.ledgeCling, null);
      if (Math.hypot(
        player.root.position.x - target.x,
        player.root.position.z - target.z,
      ) <= 0.35) {
        reachedTarget = true;
        break;
      }
    }
    assert.equal(reachedTarget, true,
      `heartbeat-bounded walk did not reach the next exact waypoint: ${JSON.stringify(player.root.position.toArray())}`);
  } finally {
    facade.dispose();
  }
});
