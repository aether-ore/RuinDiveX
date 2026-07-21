import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';
import { Game } from '../../../src/Game.js';
import { Player } from '../../../src/Player.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';

const UPPER_Y = 10;
const LOWER_Y = 0;
const FRAME_DT = 1 / 60;

function platform(id, {
  centerX = 0,
  centerZ = 0,
  halfWidth,
  halfDepth,
  topY,
}) {
  return {
    id,
    center: new THREE.Vector3(centerX, topY - 0.15, centerZ),
    position: new THREE.Vector3(centerX, topY - 0.15, centerZ),
    halfWidth,
    halfDepth,
    verticalHalfHeight: 0.15,
    topY,
    baseY: topY - 0.3,
    height: 0.3,
    blocksBelow: true,
    createsLedgeCandidates: false,
    enabled: true,
    dynamic: false,
    obstacleKind: 'floor',
  };
}

function createPhysicalPlayer(position) {
  const player = Object.create(Player.prototype);
  player.root = new THREE.Group();
  player.root.position.copy(position);
  player.modelRoot = new THREE.Group();
  player.radius = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
  player.dead = false;
  player.velocity = new THREE.Vector3();
  player.takeoffHorizontalVelocity = new THREE.Vector3();
  player.lastMoveDirection = new THREE.Vector3(1, 0, 0);
  player.jumpDirection = new THREE.Vector3(1, 0, 0);
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
  player.jumpStartY = position.y;
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
    state: 'idle',
    actionState: null,
    hurtTimer: 0,
    attackTimer: 0,
    externalControlLocked: false,
    setState(state) { this.state = state; },
    isFullBodyActionActive: () => false,
  };
  return player;
}

function createStackedHallwayHarness({ authorizedFall = false, rail = false } = {}) {
  const player = createPhysicalPlayer(new THREE.Vector3(1.72, UPPER_Y, 0));
  const upper = platform('surface.upper-hallway', {
    halfWidth: 2,
    halfDepth: 4,
    topY: UPPER_Y,
  });
  const lower = platform('surface.lower-playable-room', {
    halfWidth: 9,
    halfDepth: 9,
    topY: LOWER_Y,
  });
  const runtimeErrors = [];
  const environmentRuntime = {
    isAuthorizedFallTrajectory: () => authorizedFall,
    getAuthorizedFallGroundY: () => (authorizedFall ? LOWER_Y : null),
    reportUnauthorizedFallCorrection(position, reason) {
      runtimeErrors.push({ reason, position: position.clone() });
    },
  };
  const solidZones = rail
    ? [{
        id: 'fixture.upper-hallway.edge-rail',
        position: new THREE.Vector3(2.12, UPPER_Y + 0.5, 0),
        halfWidth: 0.12,
        halfDepth: 4,
        verticalHalfHeight: 0.6,
        obstacleKind: 'railing',
        playerCollisionPadding: 0,
      }]
    : [];
  const dungeon = {
    kind: 'DungeonV2',
    generationMode: 'v2',
    tileSize: 2.8,
    tiles: new Map(),
    floorTiles: [],
    doors: [],
    platforms: [upper, lower],
    solidZones,
    aerialBoundaryZones: [],
    environmentRuntime,
    specialEnvironment: environmentRuntime,
    plan: { actions: [] },
    getExactStairSurfaceAt: () => null,
    getExactStairSurfaceElevationAt: () => null,
    isPositionOnExactStairSurface: () => false,
  };
  const game = {
    player,
    dungeon,
    enemies: [],
    elapsedTime: 0,
    ruinCompleted: false,
    platformingPlatforms: [upper, lower],
    dynamicPlatformingPlatforms: [],
    debugSpawnedPlatforms: [],
    debugLedgePlatform: null,
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
    'getPlayerPlatformFloorElevation',
    '_getPlayerGroundY',
    '_isPositionInsidePlatformBlock',
    'isPositionInsidePlatformBlock',
  ]) {
    game[methodName] = Game.prototype[methodName].bind(game);
  }
  const controller = new DungeonController(game, dungeon);
  game.dungeonController = controller;
  return { controller, dungeon, environmentRuntime, game, lower, player, runtimeErrors, upper };
}

function resetGrounded(player, controller, position) {
  player.root.position.copy(position);
  player.velocity.set(0, 0, 0);
  player.jumpState = 'Grounded';
  player._jumpGroundY = position.y;
  player._coyoteTimer = 0.03;
  controller.lastSafePlayerPosition.copy(position);
  controller.pendingPlayerJumpOffLanding = null;
}

function advancePhysicalFrame(harness, direction = new THREE.Vector3()) {
  const { controller, game, player } = harness;
  const groundY = game._getPlayerGroundY();
  player._updatePhysicalJumpAndMovement(FRAME_DT, direction.clone().multiplyScalar(6.2), {
    arenaRadius: 100,
    movementOptions: { groundY },
  });
  controller._constrainPlayerToWalkable();
  return groundY;
}

test('grounded capsule keeps upper hallway support at edges and corners over a lower room', () => {
  const harness = createStackedHallwayHarness();
  const { controller, game, player, upper } = harness;
  const partialContactLimit = upper.halfWidth + player.radius - 0.15;

  // Move with the real grounded acceleration/integration path until the root
  // point has left the visual tile but the capsule still overlaps it.
  while (player.root.position.x < partialContactLimit) {
    const groundY = advancePhysicalFrame(harness, new THREE.Vector3(1, 0, 0));
    assert.equal(groundY, UPPER_Y);
    assert.equal(player.jumpState, 'Grounded');
    assert.equal(player.root.position.y, UPPER_Y);
    assert.equal(controller.lastSafePlayerPosition.y, UPPER_Y);
  }
  assert.ok(player.root.position.x > upper.halfWidth + 0.08,
    'fixture must cross the old root-point support margin');
  assert.ok(player.root.position.x <= upper.halfWidth + player.radius,
    'fixture must retain real partial capsule contact');
  assert.equal(game.getPlayerPlatformFloorElevation(player.root.position), UPPER_Y);

  // The same ownership rule applies at a two-axis corner; a lower registered
  // room must not win merely because the capsule centre crossed both seams.
  resetGrounded(player, controller, new THREE.Vector3(
    upper.halfWidth + player.radius * 0.55,
    UPPER_Y,
    upper.halfDepth + player.radius * 0.55,
  ));
  controller._constrainPlayerToWalkable();
  assert.equal(game.getPlayerPlatformFloorElevation(player.root.position), UPPER_Y);
  assert.equal(player.root.position.y, UPPER_Y);
  assert.equal(player.jumpState, 'Grounded');
  assert.equal(controller.lastSafePlayerPosition.y, UPPER_Y);
});

test('expanded edge support is player-only and default floor sync keeps the ordinary margin', () => {
  const harness = createStackedHallwayHarness();
  const { controller, game, player, upper } = harness;
  const partialContactPosition = new THREE.Vector3(
    upper.halfWidth + player.radius * 0.55,
    UPPER_Y,
    0,
  );
  const retainedSupportQuery = game.getPlayerPlatformFloorElevation.bind(game);
  let retainedSupportQueries = 0;
  game.getPlayerPlatformFloorElevation = (position) => {
    retainedSupportQueries += 1;
    return retainedSupportQuery(position);
  };

  const ordinaryActorPosition = partialContactPosition.clone();
  controller._syncPositionToFloor(ordinaryActorPosition);
  assert.equal(retainedSupportQueries, 0,
    'enemy/cargo/default floor sync must not query grounded player support');
  assert.equal(ordinaryActorPosition.y, LOWER_Y,
    'ordinary floor sync must retain the existing 0.08m point margin');

  const playerPosition = partialContactPosition.clone();
  controller._syncPositionToFloor(playerPosition, {
    retainGroundedPlayerSupport: true,
  });
  assert.equal(retainedSupportQueries, 1);
  assert.equal(playerPosition.y, UPPER_Y,
    'the player-only floor sync must retain partial capsule support');
});

test('upper railing correction cannot acquire the lower stacked room', () => {
  const harness = createStackedHallwayHarness({ rail: true });
  const { controller, player } = harness;
  const safe = new THREE.Vector3(1.72, UPPER_Y, 0);
  resetGrounded(player, controller, safe);

  // Model a loaded-frame horizontal push into the rail. The real constraint
  // resolver must project to the upper safe axis without changing elevation.
  player.root.position.set(2.16, UPPER_Y, 0.12);
  assert.equal(controller._isPositionInsideSolidZone(player.root.position), true,
    'rail fixture must exercise the production solid-zone correction path');
  controller._constrainPlayerToWalkable();
  assert.equal(player.root.position.y, UPPER_Y);
  assert.equal(controller.lastSafePlayerPosition.y, UPPER_Y);
  assert.equal(player.jumpState, 'Grounded');
  assert.ok(player.root.position.x <= safe.x + 0.001,
    `rail correction failed to restore the upper hallway: ${player.root.position.toArray()}`);
});

test('clearing an authored opening starts a continuous fall without a lower-floor snap', () => {
  const harness = createStackedHallwayHarness({ authorizedFall: true });
  const { controller, player, upper } = harness;
  const takeoff = new THREE.Vector3(upper.halfWidth - 0.08, UPPER_Y, 0);
  resetGrounded(player, controller, takeoff);

  // The root and complete capsule are now clear of the upper support inside a
  // plan-authorized trajectory. It must become airborne, not stay glued to the
  // deck and not teleport to the lower room.
  player.root.position.x = upper.halfWidth + player.radius + 0.08;
  const firstGroundY = advancePhysicalFrame(harness);
  assert.equal(firstGroundY, LOWER_Y);
  assert.equal(player.jumpState, 'Falling');
  assert.ok(player.root.position.y < UPPER_Y && player.root.position.y > UPPER_Y - 0.2,
    `authored fall snapped vertically on its first frame: ${player.root.position.y}`);
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), takeoff.toArray(),
    'airborne fall must not replace the last supported upper anchor');

  let previousY = player.root.position.y;
  let landed = false;
  for (let frame = 0; frame < 180; frame += 1) {
    advancePhysicalFrame(harness);
    assert.ok(player.root.position.y <= previousY + 1e-9,
      `authored fall moved upward on frame ${frame}`);
    assert.ok(previousY - player.root.position.y < 0.7,
      `authored fall warped ${previousY - player.root.position.y}m on frame ${frame}`);
    previousY = player.root.position.y;
    if (player.jumpState === 'Grounded' || player.jumpState === 'LandRecovery') {
      landed = true;
      break;
    }
  }
  assert.equal(landed, true, 'authorized opening never reached its playable lower room');
  assert.equal(player.root.position.y, LOWER_Y);
});
