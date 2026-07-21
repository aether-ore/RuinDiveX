import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import Game from '../../../src/Game.js';
import { Player, PLAYER_FBX_ANIMATION_DEFINITIONS } from '../../../src/Player.js';
import { SkeletalModelRig } from '../../../src/SkeletalModelRig.js';

function createTraversalPlayer() {
  const player = Object.create(Player.prototype);
  player.dead = false;
  player.root = new THREE.Group();
  player.root.position.set(0, 0, 0);
  player.modelRoot = new THREE.Group();
  player.lastMoveDirection = new THREE.Vector3(0, 0, 1);
  player.jumpDirection = new THREE.Vector3(0, 0, 1);
  player.velocity = new THREE.Vector3();
  player.takeoffHorizontalVelocity = new THREE.Vector3();
  player.animation = {
    state: 'idle',
    actionState: null,
    hurtTimer: 0,
    attackTimer: 0,
    externalControlLocked: false,
    setState(state) { this.state = state; },
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
  player.jumpState = 'grounded';
  player._coyoteTimer = 1;
  player._jumpBufferTimer = 1;
  player._prepareForExternalControl = () => {};
  player.cancelTraversalMechanismLaunch = () => false;
  player.isPowerKnockbackActive = () => false;
  player.isExternalMotionActive = () => false;
  player.isSwordJumpSlashVisualActive = () => false;
  player.faceDirection = (direction) => {
    player.lastFacedDirection = direction.clone();
    Player.prototype.faceDirection.call(player, direction);
  };
  player.updateWeaponVisualState = () => {};
  player._updateExternalModelMotion = () => {};
  return player;
}

const TEST_LADDER = Object.freeze({
  id: 'ladder.test',
  label: 'Service ladder',
  center: Object.freeze({ x: 4, z: -3 }),
  planeCenter: Object.freeze({ x: 4.4, z: -3 }),
  planeNormal: Object.freeze({ x: -1, z: 0 }),
  bodyClearance: 0.4,
  bottomY: 1,
  topY: 7,
  facing: Object.freeze({ x: 1, z: 0 }),
  bottomExit: Object.freeze({ x: 2.5, y: 1, z: -3 }),
  topExit: Object.freeze({ x: 5.5, y: 7, z: -3 }),
});

test('authoritative ladder FBX is present and byte-stable', async () => {
  const bytes = await readFile(new URL('../../../assets/models/animations/Climbing Ladder.fbx', import.meta.url));
  assert.equal(bytes.byteLength, 841_664);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    'b142aa64400db361555e8e326a0287ec0dba40be8adc129d0e45b0c20b510f62',
  );
});

test('authoritative ladder animation cannot add FBX root height to physical climbing', async () => {
  const bytes = await readFile(new URL('../../../assets/models/animations/Climbing Ladder.fbx', import.meta.url));
  const baseBytes = await readFile(new URL('../../../assets/models/Mega Man Volnutt.fbx', import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const baseBuffer = baseBytes.buffer.slice(baseBytes.byteOffset, baseBytes.byteOffset + baseBytes.byteLength);
  const previousWarn = console.warn;
  let animationModel;
  let baseModel;
  try {
    // FBXLoader reports benign >4-weight normalization warnings for this
    // source model. They are unrelated to the root-motion contract below.
    console.warn = () => {};
    animationModel = new FBXLoader().parse(buffer, './assets/models/animations/');
    baseModel = new FBXLoader().parse(baseBuffer, './assets/models/');
  } finally {
    console.warn = previousWarn;
  }

  const sourceClip = animationModel.animations[0];
  const sourceHips = sourceClip.tracks.find((track) => (
    /hips\.position$/i.test(track.name)
  ));
  assert.ok(sourceHips, 'ladder source must retain its authored hip track');
  const sourceY = Array.from(sourceHips.values).filter((_, index) => index % 3 === 1);
  assert.ok(Math.max(...sourceY) - Math.min(...sourceY) > 0.4,
    'fixture must prove the source clip really contains vertical root travel');

  const definition = PLAYER_FBX_ANIMATION_DEFINITIONS.find(({ key }) => key === 'climbingLadder');
  assert.equal(definition?.lockRootY, true,
    'physical ladder height must remain authoritative over the looping FBX root');
  assert.equal(definition?.lockRootYToRest, true,
    'ladder clip must use Volnutt rig height instead of the Mixamo source height');
  assert.equal(definition?.normalizeRootRotationToRest, true,
    'ladder clip must not import its reversed Mixamo root orientation');
  const rig = new SkeletalModelRig(baseModel);
  assert.equal(rig.setAnimationClips(new Map([
    ['climbingLadder', { ...definition, clip: sourceClip }],
  ])), 1);
  const preparedHips = rig.animationClips.get('climbingLadder').tracks.find((track) => (
    /hips\.position$/i.test(track.name)
  ));
  const preparedY = Array.from(preparedHips.values).filter((_, index) => index % 3 === 1);
  assert.ok(Math.max(...preparedY) - Math.min(...preparedY) < 1e-6,
    'prepared looping ladder clip must be in-place vertically');
  const hipsJoint = rig.joints.get('hips');
  const restHipsPosition = hipsJoint?.userData?.restLocalPosition;
  assert.ok(restHipsPosition && Math.abs(preparedY[0] - restHipsPosition.y) < 1e-6,
    'prepared ladder hip height must exactly match Volnutt rig rest height');
  assert.ok(Math.abs(sourceY[0] - restHipsPosition.y) > 0.5,
    'fixture must prove the source and target rigs use materially different hip heights');

  const sourceHipsRotation = sourceClip.tracks.find((track) => (
    /hips\.quaternion$/i.test(track.name)
  ));
  const preparedHipsRotation = rig.animationClips.get('climbingLadder').tracks.find((track) => (
    /hips\.quaternion$/i.test(track.name)
  ));
  assert.ok(sourceHipsRotation && preparedHipsRotation,
    'ladder source and prepared clip require an authoritative hip rotation track');
  const restHipsRotation = rig.restLocalQuaternions.get(hipsJoint);
  const sourceStartRotation = new THREE.Quaternion().fromArray(sourceHipsRotation.values, 0).normalize();
  const preparedStartRotation = new THREE.Quaternion().fromArray(preparedHipsRotation.values, 0).normalize();
  assert.ok(sourceStartRotation.angleTo(restHipsRotation) > 3,
    'fixture must retain the source clip\'s nearly reversed root orientation');
  assert.ok(preparedStartRotation.angleTo(restHipsRotation) < 1e-6,
    'prepared ladder root must begin at Volnutt\'s rig-rest orientation');
  for (const sampleIndex of [
    Math.floor((sourceHipsRotation.times.length - 1) * 0.25),
    Math.floor((sourceHipsRotation.times.length - 1) * 0.5),
    sourceHipsRotation.times.length - 1,
  ]) {
    const sourceSample = new THREE.Quaternion()
      .fromArray(sourceHipsRotation.values, sampleIndex * 4).normalize();
    const preparedSample = new THREE.Quaternion()
      .fromArray(preparedHipsRotation.values, sampleIndex * 4).normalize();
    const sourceRelative = sourceStartRotation.clone().invert().multiply(sourceSample);
    const preparedRelative = preparedStartRotation.clone().invert().multiply(preparedSample);
    assert.ok(sourceRelative.angleTo(preparedRelative) < 1e-5,
      'root normalization must preserve authored relative ladder motion');
  }

  rig.update(1 / 60, {
    state: 'climbingLadder', clipKey: 'climbingLadder', moving: true, moveAmount: 1,
  });
  assert.equal(rig.activeAction.getEffectiveTimeScale(), 1,
    'ascending must play the authored ladder cycle forward');
  rig.update(1 / 60, {
    state: 'climbingLadder', clipKey: 'climbingLadder', moving: false, moveAmount: 0,
  });
  assert.equal(rig.activeAction.getEffectiveTimeScale(), 0,
    'stationary ladder traversal must hold its current authored pose');
  rig.update(1 / 60, {
    state: 'climbingLadder', clipKey: 'climbingLadder', moving: true, moveAmount: -1,
  });
  assert.equal(rig.activeAction.getEffectiveTimeScale(), -1,
    'descending must reverse the authored ladder cycle');

  rig.update(1 / 60, {
    state: 'climbingLadder', clipKey: 'climbingLadder', moving: true, moveAmount: 1,
    actionProgress: 0.35,
  });
  baseModel.updateMatrixWorld(true);
  const hips = rig.joints.get('hips').getWorldPosition(new THREE.Vector3());
  const hands = rig.joints.get('leftWrist').getWorldPosition(new THREE.Vector3())
    .add(rig.joints.get('rightWrist').getWorldPosition(new THREE.Vector3()))
    .multiplyScalar(0.5);
  const reach = hands.sub(hips);
  assert.ok(reach.z > 0.25 && Math.abs(reach.x) < 0.1,
    'normalized Volnutt rig must reach toward its local +Z ladder-facing plane');
});

test('ladder traversal mounts, climbs, follows a finite camera anchor, and exits at the authored top', () => {
  const player = createTraversalPlayer();
  assert.equal(player.mountLadder(TEST_LADDER), true);
  assert.equal(player.animation.state, 'climbingLadder');
  assert.deepEqual(player.root.position.toArray(), [4, 1, -3]);
  assert.ok(Math.abs(player.root.rotation.y - Math.PI * 0.5) < 1e-12,
    'an axis-aligned facing with z=0 must not become diagonal');
  assert.ok(Math.abs(player.getLadderTraversalDiagnostics().signedPlaneClearance - 0.4) < 1e-12);
  assert.ok(player.getLadderTraversalDiagnostics().facingAlignment > 0.999);

  for (let frame = 0; frame < 120 && player.isClimbingLadder(); frame += 1) {
    player._updateLadderTraversal(1 / 60, new Set(['KeyW']));
    const cameraAnchor = player.getCameraFocusPosition(new THREE.Vector3());
    assert.ok(cameraAnchor.toArray().every(Number.isFinite));
  }

  assert.equal(player.isClimbingLadder(), false);
  assert.deepEqual(player.root.position.toArray(), [5.5, 7, -3]);
  assert.equal(player.animation.state, 'idle');
});

test('ladder traversal rejects missing or body-intersecting visual-plane contracts', () => {
  const player = createTraversalPlayer();
  assert.equal(player.mountLadder({ ...TEST_LADDER, planeCenter: undefined }), false);
  assert.equal(player.mountLadder({ ...TEST_LADDER, bodyClearance: 0 }), false);
  assert.equal(player.mountLadder({ ...TEST_LADDER, planeCenter: { x: 4, z: -3 } }), false);
  assert.equal(player.mountLadder({ ...TEST_LADDER, planeNormal: { x: 1, z: 0 } }), false);
});

test('ladder traversal supports authored bottom exit and damage interruption', () => {
  const player = createTraversalPlayer();
  const motionSamples = [];
  player._updateExternalModelMotion = (_dt, moving, moveAmount, _backpedaling, _running, options) => {
    motionSamples.push({ moving, moveAmount, clipKey: options.clipKey });
  };
  player.root.position.y = 6;
  assert.equal(player.mountLadder(TEST_LADDER), true);
  player._updateLadderTraversal(1 / 60, new Set());
  assert.deepEqual(motionSamples.at(-1), {
    moving: false,
    moveAmount: 0,
    clipKey: 'climbingLadder',
  });
  for (let frame = 0; frame < 120 && player.isClimbingLadder(); frame += 1) {
    player._updateLadderTraversal(1 / 60, new Set(['KeyS']));
  }
  assert.equal(motionSamples.some(({ moving, moveAmount }) => moving && moveAmount === -1), true);
  assert.deepEqual(player.root.position.toArray(), [2.5, 1, -3]);

  player.root.position.set(4, 4, -3);
  assert.equal(player.mountLadder(TEST_LADDER), true);
  player.health = 100;
  const damage = player.takeIncomingHit({ amount: 4, guardable: false, reactionTier: 0 });
  assert.equal(damage.healthDamage, 4);
  assert.equal(player.isClimbingLadder(), false);
  assert.equal(player.jumpState, 'Falling');
  assert.ok(player.velocity.y < 0);
  assert.equal(player.root.userData.lastLadderExitReason, 'damage');
});

test('ladder traversal advances expedition timers instead of pausing status effects', () => {
  const player = createTraversalPlayer();
  const advanced = [];
  player._updatePistolRunArcCameraTurnAmount = () => 0;
  player._updateBarrierState = () => {};
  player._updateSwordJumpSlashVisualState = () => {};
  player._updateExternalMotion = () => false;
  for (const method of [
    '_updateStatusEffects',
    '_updateTemporaryStatBonuses',
    '_updateBracedFireState',
    '_updateShieldGuardState',
    '_updateMovementLockState',
    '_updateAttackFacingState',
  ]) {
    player[method] = (dt) => advanced.push([method, dt]);
  }
  assert.equal(player.mountLadder(TEST_LADDER), true);

  player.update(0.02, new Set(), { arenaRadius: 100 });

  assert.deepEqual(advanced, [
    ['_updateStatusEffects', 0.02],
    ['_updateTemporaryStatBonuses', 0.02],
    ['_updateBracedFireState', 0.02],
    ['_updateShieldGuardState', 0.02],
    ['_updateMovementLockState', 0.02],
    ['_updateAttackFacingState', 0.02],
  ]);
  assert.equal(player.isClimbingLadder(), true);
});

test('flooded movement values are exact and captured at takeoff', () => {
  const player = createTraversalPlayer();
  const drySpeed = player._getTunedForwardSpeed();
  player.setEnvironmentalTraversalProfile({
    flooded: true,
    movementMultiplier: 0.76,
    jumpHeight: 4.95,
    gravityScale: 0.28,
  });
  assert.ok(Math.abs(player._getTunedForwardSpeed() / drySpeed - 0.76) < 1e-12);
  assert.equal(player._getConfiguredJumpHeight(), 4.95);
  assert.equal(player._getGravityScale(), 0.28);

  player._startPhysicalJump();
  player.setEnvironmentalTraversalProfile({ flooded: false });
  assert.deepEqual(player.getEnvironmentalTraversalDiagnostics(), {
    flooded: true,
    movementMultiplier: 0.76,
    jumpHeight: 4.95,
    gravityScale: 0.28,
    takeoffCaptured: true,
  });
  assert.equal(player._getConfiguredJumpHeight(), 4.95);
  assert.equal(player._getGravityScale(), 0.28);
  assert.ok(Number.isFinite(player.velocity.y) && player.velocity.y > 0);
});

test('physical jump advances through finite states and lands under frame-sized updates', () => {
  const player = createTraversalPlayer();
  player.root.position.set(0, 0, 0);
  player.velocity.set(2.2, 0, 1.1);
  player._startPhysicalJump();
  const targetVelocity = new THREE.Vector3(2.2, 0, 1.1);
  const visited = new Set();
  let peakY = player.root.position.y;
  let landed = false;

  for (let frame = 0; frame < 600; frame += 1) {
    player._updatePhysicalJumpAndMovement(1 / 120, targetVelocity, {
      arenaRadius: 100,
      movementOptions: { groundY: 0 },
    });
    visited.add(player.jumpState);
    peakY = Math.max(peakY, player.root.position.y);
    assert.ok([
      ...player.root.position.toArray(),
      ...player.velocity.toArray(),
      player._jumpAirTimer,
      player._jumpBufferTimer,
    ].every(Number.isFinite), `jump state became non-finite at frame ${frame}`);
    if (player.jumpState === 'Grounded' && frame > 0) {
      landed = true;
      break;
    }
  }

  assert.equal(landed, true, 'finite jump must return to Grounded without stalling');
  assert.ok(peakY > 2, 'jump input must produce a real vertical arc');
  assert.equal(visited.has('Rising'), true);
  assert.equal(visited.has('Falling'), true);
  assert.equal(player.root.position.y, 0);
});

test('physics recovery resets motion without changing expedition resources', () => {
  const player = createTraversalPlayer();
  player.health = 37;
  player.barrier = { current: 9, capacity: 12 };
  player.ammunition = { cannon: 4 };
  player.salvage = 123;
  player.keys = new Set(['alpha']);
  player.rewards = new Set(['cache-a']);
  player.clearExternalMotion = () => false;
  player.root.position.set(9, -50, 8);
  player.velocity.set(8, -40, 2);
  const resources = {
    health: player.health,
    barrier: structuredClone(player.barrier),
    ammunition: structuredClone(player.ammunition),
    salvage: player.salvage,
    keys: [...player.keys],
    rewards: [...player.rewards],
  };

  assert.equal(player.restorePhysicsRecoveryAnchor({
    position: { x: 1, y: 2, z: 3 },
    facing: { x: 0, z: -1 },
  }), true);
  assert.deepEqual(player.root.position.toArray(), [1, 2, 3]);
  assert.deepEqual(player.velocity.toArray(), [0, 0, 0]);
  assert.deepEqual({
    health: player.health,
    barrier: player.barrier,
    ammunition: player.ammunition,
    salvage: player.salvage,
    keys: [...player.keys],
    rewards: [...player.rewards],
  }, resources);
});

test('Utility Arms swap during an expedition while sub-weapons and Gear remain camp-only', async () => {
  const calls = [];
  const game = {
    dungeonController: {
      isPlayerInCamp: () => false,
      isPlayerAtRollWorkshop: () => false,
    },
    busterSandboxSession: { active: false },
    busterTestRange: { active: false },
    busterLabStorage: {
      readOnly: false,
      equipArmLoadoutSlot: async (slot, selection) => {
        calls.push({ kind: 'arm', slot, selection });
        return { ok: true };
      },
      equipGearLoadoutSlot: async (slot, gearId) => {
        calls.push({ kind: 'gear', slot, gearId });
        return { ok: true };
      },
    },
    _queueBusterStorageOperation: (operation) => operation(),
    _applyPersistedArmsGear: () => {},
    ui: { renderInventory: () => {} },
  };
  game.canEditArmsGear = () => Game.prototype.canEditArmsGear.call(game);
  game.canEditUtilityArm = () => Game.prototype.canEditUtilityArm.call(game);

  const utility = await Game.prototype.equipArmLoadoutSlot.call(game, 'utility', 'liftArm');
  const drillUtility = await Game.prototype.equipArmLoadoutSlot.call(game, 'utility', 'drillArm');
  const sword = await Game.prototype.equipArmLoadoutSlot.call(game, 'special1', 'laserBeamBlade');
  const cannon = await Game.prototype.equipArmLoadoutSlot.call(game, 'special2', 'cannonArm');
  const customBuster = await Game.prototype.equipArmLoadoutSlot.call(game, 'special1', {
    kind: 'customBuster',
    buildId: 'build-a',
  });
  const gear = await Game.prototype.equipGearLoadoutSlot.call(game, 'mobility', 'jetSkates');

  assert.equal(utility.ok, true);
  assert.match(utility.message, /field use/i);
  assert.equal(drillUtility.ok, true);
  assert.match(drillUtility.message, /field use/i);
  assert.deepEqual(calls, [
    {
      kind: 'arm',
      slot: 'utility',
      selection: { kind: 'fixedArm', armId: 'liftArm' },
    },
    {
      kind: 'arm',
      slot: 'utility',
      selection: { kind: 'fixedArm', armId: 'drillArm' },
    },
  ]);
  const campOnly = {
    ok: false,
    reason: 'unsafe-area',
    message: 'Arms can be changed only with Roll at camp.',
  };
  assert.deepEqual(sword, campOnly);
  assert.deepEqual(cannon, campOnly);
  assert.deepEqual(customBuster, campOnly);
  assert.deepEqual(gear, {
    ok: false,
    reason: 'unsafe-area',
    message: 'Gear can be changed only with Roll at camp.',
  });
});
