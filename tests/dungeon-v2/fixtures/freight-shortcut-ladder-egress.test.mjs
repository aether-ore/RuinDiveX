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

const LADDER_SURFACE_ID = 'surface.freight.approach-freight-security-shortcut';
const RETURN_STAIR_SURFACE_ID = 'surface.freight.catchment-return-stairs';

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

function resolveProductionGroundY(controller, game, position) {
  const ramp = controller.getRampSurfaceElevationAt(position);
  if (Number.isFinite(ramp)) return ramp;
  const platform = game.getPlatformFloorElevation(position);
  if (Number.isFinite(platform)) return platform;
  return controller.getFloorElevationAt(position);
}

function advanceGroundedFrame(player, controller, game, direction, dt = 1 / 20) {
  const groundY = resolveProductionGroundY(controller, game, player.root.position);
  player._updatePhysicalJumpAndMovement(dt, new THREE.Vector3(
    direction.x * 6.2,
    0,
    direction.z * 6.2,
  ), {
    arenaRadius: 1_000,
    movementOptions: { groundY },
  });
  controller._constrainPlayerToWalkable();
}

for (const undercroftType of ['magma', 'electrical']) {
  test(`${undercroftType} actual seed gives the freight shortcut ladder a physical bottom egress`, () => {
    const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
      seed: `m1-golden-${undercroftType}`,
      undercroftType,
    }));
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    const facade = assembleDungeonPlanV2(validation.plan);
    try {
      const ladder = validation.plan.walkableSurfaces.find(({ id }) => id === LADDER_SURFACE_ID);
      const returnStair = validation.plan.walkableSurfaces.find(({ id }) => (
        id === RETURN_STAIR_SURFACE_ID
      ));
      assert.ok(ladder?.geometry?.landings?.bottom, 'freight shortcut ladder bottom landing missing');
      assert.ok(returnStair?.geometry?.path, 'freight catchment return stair missing');

      const landing = ladder.geometry.landings.bottom;
      assert.ok(landing.minimumClearLength >= 1.2);
      assert.ok(landing.minimumClearWidth >= 1.2);
      assert.ok(landing.minimumHeadroom >= 3.2);
      const exit = new THREE.Vector3(
        landing.exit.x,
        landing.exit.y,
        landing.exit.z,
      );
      const egress = new THREE.Vector3(
        landing.egressDirection.x,
        0,
        landing.egressDirection.z,
      ).normalize();
      const lateral = new THREE.Vector3(-egress.z, 0, egress.x);

      // Prove the complete declared landing width and walk-away length are
      // not underneath the unrelated catchment staircase. This is the exact
      // production query that formerly resolved the remote incline at y=-9.31
      // and rejected the real floor at y=-11.65.
      for (let distance = 0; distance <= landing.minimumClearLength + 1e-9; distance += 0.21) {
        for (const lateralOffset of [-0.6, 0, 0.6]) {
          const sample = exit.clone()
            .addScaledVector(egress, distance)
            .addScaledVector(lateral, lateralOffset);
          const remoteStair = facade.getExactStairSurfaceAt(sample, {
            maxVerticalGap: Infinity,
            tolerance: 0.025,
          });
          assert.notEqual(remoteStair?.surfaceId, RETURN_STAIR_SURFACE_ID,
            `remote return stair occupies ladder egress sample ${JSON.stringify(sample.toArray())}`);
        }
      }

      const player = createPhysicalPlayer(exit);
      const game = createProductionSupportGame(player, facade);
      const controller = new DungeonController(game, facade);
      const start = player.root.position.clone();
      for (let frame = 0; frame < 12; frame += 1) {
        advanceGroundedFrame(player, controller, game, egress);
        assert.equal(player.jumpState, 'Grounded');
        assert.equal(player.ledgeCling, null);
        assert.ok(Math.abs(player.root.position.y - exit.y) <= 0.001,
          `production support warped the ladder egress on frame ${frame}`);
      }
      const progress = player.root.position.clone().sub(start).dot(egress);
      assert.ok(progress >= landing.minimumClearLength,
        `player advanced only ${progress.toFixed(3)}m through the ${landing.minimumClearLength}m ladder egress`);
    } finally {
      facade.dispose();
    }
  });
}
