import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import Game from '../../../src/Game.js';
import { DungeonController } from '../../../src/DungeonController.js';
import { Player } from '../../../src/Player.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../../../src/TraversalCapabilities.js';
import { createGoldenDungeonPlanV2 } from '../../../src/dungeon-v2/GoldenDungeonPlansV2.js';
import { validateDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonPlanV2Validator.js';
import { assembleDungeonPlanV2 } from '../../../src/dungeon-v2/DungeonSceneAssemblerV2.js';

const NON_BYPASSABLE_GATE_CLASSIFICATION = 'non-bypassable-progression';
const FRAME_DT = 1 / 60;

function acceptedGolden(seed) {
  const validation = validateDungeonPlanV2(createGoldenDungeonPlanV2({
    seed,
    undercroftType: 'magma',
  }));
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
  return validation.plan;
}

function createTraversalPlayer(position) {
  const player = Object.create(Player.prototype);
  player.dead = false;
  player.radius = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
  player.collisionHeight = PLAYER_TRAVERSAL_ENVELOPE.standingHeight;
  player.root = new THREE.Group();
  player.root.position.copy(position);
  player.modelRoot = new THREE.Group();
  player.lastMoveDirection = new THREE.Vector3(0, 0, 1);
  player.jumpDirection = new THREE.Vector3(0, 0, 1);
  player.velocity = new THREE.Vector3();
  player.takeoffHorizontalVelocity = new THREE.Vector3();
  player.animation = {
    state: 'idle',
    actionState: null,
    actionTimer: 0,
    actionDuration: 0,
    hurtTimer: 0,
    attackTimer: 0,
    externalControlLocked: false,
    setState(state) { this.state = state; },
    isFullBodyActionActive: () => false,
  };
  player.environmentTraversalProfile = {
    flooded: false,
    movementMultiplier: 1,
    jumpHeight: null,
    gravityScale: 1,
  };
  player.takeoffEnvironmentTraversalProfile = null;
  player.stats = { moveSpeed: 5.35 };
  player.jumpSettings = {
    forwardSpeed: 5.35,
    jumpHeight: 2.35,
    jumpHeightMultiplier: 1,
    gravityScale: 1,
    jumpTimeToApex: 0.46,
  };
  player.gearEffects = { jumpReachMultiplier: 1 };
  player.jetSkateState = { active: false, windup: 0, speed: 0 };
  player._jumpSlashVisualState = null;
  player.jumpState = 'Grounded';
  player._coyoteTimer = 1;
  player._jumpBufferTimer = 1;
  player.ledgeCling = null;
  player._prepareForExternalControl = () => {};
  player.cancelTraversalMechanismLaunch = () => false;
  player.isPowerKnockbackActive = () => false;
  player.isPowerKnockbackAirborne = () => false;
  player.isDodgeRollAirborne = () => false;
  player.isExternalMotionActive = () => false;
  player.isSwordJumpSlashVisualActive = () => false;
  player.isClimbingLadder = () => false;
  player.consumeLadderDismountConstraintHandoff = () => false;
  player.shouldIgnoreGroundConstraint = () => false;
  player.updateWeaponVisualState = () => {};
  player._updateExternalModelMotion = () => {};
  player.faceDirection = (direction) => {
    player.lastMoveDirection.copy(direction).setY(0).normalize();
  };
  return player;
}

function createRuntimeGame(player, facade) {
  const game = {
    player,
    enemies: [],
    elapsedTime: 0,
    ruinCompleted: false,
    platformingPlatforms: facade.platforms,
    dynamicPlatformingPlatforms: [],
    debugSpawnedPlatforms: [],
    debugLedgeCandidates: [],
    platformingLedgeCandidates: [],
    debugLedgePlatform: null,
    bossStageRuntime: null,
    ui: { showToast: () => {} },
    scene: new THREE.Scene(),
  };
  for (const methodName of [
    '_getPlatformingSurfaces',
    '_getPlatformFloorElevation',
    'getPlatformFloorElevation',
    'getPlatformSupport',
    '_isPositionInsidePlatformBlock',
    'isPositionInsidePlatformBlock',
    '_createPlatformLedgeCandidates',
    '_tryResolveDebugLedgeCling',
    '_tryResolvePlatformLedgeCling',
  ]) {
    game[methodName] = Game.prototype[methodName].bind(game);
  }
  game.platformingLedgeCandidates = facade.platforms.flatMap((platform) => (
    game._createPlatformLedgeCandidates(platform)
  ));
  player.jumpLedgeClingResolver = (context) => game._tryResolvePlatformLedgeCling(context);
  return game;
}

function gateCrossingFixture(plan, facade, gate) {
  const portal = plan.portals.find(({ id }) => id === gate.portalId);
  const door = facade.doors.find(({ id }) => id === gate.id);
  const sourceSurface = plan.walkableSurfaces.find(({ id }) => (
    id === portal.physicalRoute.endpointSurfaceIds.from
  ));
  assert.ok(portal && door && sourceSurface, `${gate.id} lacks its physical source route`);
  const routePoints = portal.physicalRoute.routePoints;
  const origin = new THREE.Vector3(
    portal.from.center.x,
    sourceSurface.bounds.max.y,
    portal.from.center.z,
  );
  const next = routePoints.find((point) => (
    Math.hypot(point.x - origin.x, point.z - origin.z) > 0.05
  ));
  assert.ok(next, `${gate.id} lacks an outward route point`);
  const direction = new THREE.Vector3(next.x - origin.x, 0, next.z - origin.z).normalize();
  const doorDepth = Math.abs(direction.x) * door.collisionHalfWidth
    + Math.abs(direction.z) * door.collisionHalfDepth;
  const stagingDistance = doorDepth + PLAYER_TRAVERSAL_ENVELOPE.collisionRadius + 0.18;
  const start = origin.clone().addScaledVector(direction, -stagingDistance);
  const crossed = origin.clone().addScaledVector(direction, stagingDistance + 0.45);
  return { door, direction, start, crossed };
}

function simulateForwardJump({ facade, fixture, gateOpen }) {
  fixture.door.setOpen(gateOpen);
  const player = createTraversalPlayer(fixture.start);
  player.lastMoveDirection.copy(fixture.direction);
  player.jumpDirection.copy(fixture.direction);
  player.velocity.copy(fixture.direction).multiplyScalar(player.jumpSettings.forwardSpeed);
  const game = createRuntimeGame(player, facade);
  const controller = new DungeonController(game, facade);
  const targetVelocity = fixture.direction.clone().multiplyScalar(player.jumpSettings.forwardSpeed);
  const originProgress = fixture.start.dot(fixture.direction);
  const requiredProgress = fixture.crossed.dot(fixture.direction) - originProgress;
  let maximumProgress = 0;
  let ledgeCandidateId = null;

  for (let frame = 0; frame < 180; frame += 1) {
    const groundY = controller.getSurfaceElevationAt(player.root.position);
    player._updatePhysicalJumpAndMovement(FRAME_DT, targetVelocity, {
      arenaRadius: 512,
      movementOptions: { groundY },
    });
    ledgeCandidateId ??= player.ledgeCling?.id ?? null;
    controller._constrainPlayerToWalkable();
    maximumProgress = Math.max(
      maximumProgress,
      player.root.position.dot(fixture.direction) - originProgress,
    );
    if (maximumProgress >= requiredProgress) break;
    if (frame > 1 && player.jumpState === 'Grounded') break;
  }

  return { maximumProgress, requiredProgress, ledgeCandidateId, playerPosition: player.root.position.clone() };
}

test('seeded golden non-bypassable gates reject real jump/ledge traversal while closed and pass it when open', () => {
  const plan = acceptedGolden('m1-closed-key-gate-physical');
  const facade = assembleDungeonPlanV2(plan);
  try {
    const gates = plan.progression.gateContracts.filter(({ classification }) => (
      classification === NON_BYPASSABLE_GATE_CLASSIFICATION
    ));
    assert.deepEqual(gates.map(({ id }) => id), [
      'Door_Alpha', 'Door_Beta', 'Door_Gamma', 'Door_Shrine',
    ]);
    for (const gate of gates) {
      const fixture = gateCrossingFixture(plan, facade, gate);
      const closed = simulateForwardJump({ facade, fixture, gateOpen: false });
      assert.ok(closed.maximumProgress < closed.requiredProgress,
        `${gate.id} closed barrier was crossed by a normal public jump: ${JSON.stringify(closed)}`);
      assert.equal(closed.ledgeCandidateId, null,
        `${gate.id} closed barrier exposed a cross-gate ledge candidate ${closed.ledgeCandidateId}`);

      const opened = simulateForwardJump({ facade, fixture, gateOpen: true });
      assert.ok(opened.maximumProgress >= opened.requiredProgress,
        `${gate.id} open aperture did not admit the same normal jump: ${JSON.stringify(opened)}`);
    }
  } finally {
    facade.dispose();
  }
});

test('seeded golden key-gate actions accept either physically reachable side but still require their exact key', () => {
  const plan = acceptedGolden('m1-key-gate-action-side');
  const facade = assembleDungeonPlanV2(plan);
  const player = createTraversalPlayer(facade.playerStart);
  const game = createRuntimeGame(player, facade);
  const controller = new DungeonController(game, facade);
  try {
    const gates = plan.progression.gateContracts.filter(({ classification }) => (
      classification === NON_BYPASSABLE_GATE_CLASSIFICATION
    ));
    for (const gate of gates) {
      const action = plan.actions.find(({ id }) => id === gate.actionId);
      const anchor = plan.anchors.find(({ id }) => id === action.anchorId);
      const door = facade.doors.find(({ id }) => id === gate.id);
      assert.ok(action && anchor && door, `${gate.id} lacks action/runtime parity`);
      const anchorPosition = new THREE.Vector3(
        anchor.position.x, anchor.position.y, anchor.position.z,
      );
      const facing = new THREE.Vector3(
        anchor.forward.x, 0, anchor.forward.z,
      ).normalize();
      assert.equal(action.interaction.activationSide, 'either',
        `${gate.id} credential reader must not reject a reachable approach side`);
      assert.equal(action.interaction.requiresLineOfSight, false);
      const frontPosition = anchorPosition.clone().addScaledVector(facing, 1.15);
      const backPosition = anchorPosition.clone().addScaledVector(facing, -1.15);
      const context = (position, hasKey) => ({
        player,
        playerPosition: position,
        controller,
        hasKey: (keyId) => hasKey && keyId === gate.requiredKeycardId,
        actionId: action.id,
      });

      door.setOpen(false);
      assert.deepEqual(
        facade.environmentRuntime.activateAction(action.id, context(frontPosition, false)),
        { ok: false, reason: 'conditions-not-met' },
        `${gate.id} front approach was rejected before its key condition was evaluated`,
      );
      assert.deepEqual(
        facade.environmentRuntime.activateAction(action.id, context(backPosition, false)),
        { ok: false, reason: 'conditions-not-met' },
        `${gate.id} back approach bypassed its key condition`,
      );
      assert.deepEqual(
        facade.environmentRuntime.activateAction(action.id, context(frontPosition, true)),
        { ok: true, actionId: action.id },
        `${gate.id} front approach did not open after its key was supplied`,
      );
      assert.equal(door.closed, false, `${gate.id} action did not clear the physical barrier`);
      door.setOpen(false);
      assert.deepEqual(
        facade.environmentRuntime.activateAction(action.id, context(backPosition, true)),
        { ok: true, actionId: action.id },
        `${gate.id} back approach rejected the same held key`,
      );
      assert.equal(door.closed, false, `${gate.id} back approach did not clear the physical barrier`);
    }
  } finally {
    facade.dispose();
  }
});
