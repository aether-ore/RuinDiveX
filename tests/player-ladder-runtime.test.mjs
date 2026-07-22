import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import {
  Player,
  PLAYER_FBX_ANIMATION_DEFINITIONS,
} from '../src/Player.js';
import { DungeonController } from '../src/DungeonController.js';
import { SkeletalModelRig } from '../src/SkeletalModelRig.js';

function createPlayerHarness(position = new THREE.Vector3(0, 0, -1.45)) {
  const player = Object.create(Player.prototype);
  player.dead = false;
  player.root = new THREE.Group();
  player.root.position.copy(position);
  player.modelRoot = new THREE.Group();
  player.root.add(player.modelRoot);
  player.lastMoveDirection = new THREE.Vector3(0, 0, 1);
  player.velocity = new THREE.Vector3();
  player.takeoffHorizontalVelocity = new THREE.Vector3();
  player.jumpState = 'Grounded';
  player.jumpStartY = position.y;
  player._jumpGroundY = position.y;
  player.ladderTraversal = null;
  player.ladderDismountHandoff = null;
  player.externalBallisticMotion = null;
  player.externalControl = null;
  player.powerKnockbackState = null;
  player.animation = {
    externalControlLocked: false,
    state: 'idle',
    setState(state) { this.state = state; },
  };
  player._prepareForExternalControl = () => {
    player.ladderTraversal = null;
    player.ladderDismountHandoff = null;
  };
  player.updateWeaponVisualState = () => {};
  player._updateExternalModelMotion = (...args) => {
    player.lastExternalModelMotion = args;
  };
  return player;
}

function createLadder(overrides = {}) {
  return {
    id: 'connector.ladder.a',
    label: 'Service Ladder',
    center: { x: 0, z: -0.42 },
    planeCenter: { x: 0, z: 0 },
    planeNormal: { x: 0, z: -1 },
    facing: { x: 0, z: 1 },
    bodyClearance: 0.42,
    bottomY: 0,
    topY: 4.2,
    bottomMountPosition: { x: 0, y: 0, z: -1.45 },
    topMountPosition: { x: 0, y: 4.2, z: -1.45 },
    bottomExit: { x: 0, y: 0, z: -1.45 },
    topExit: { x: 0, y: 4.2, z: -1.45 },
    bottomExitFacing: { x: 0, z: -1 },
    topExitFacing: { x: 0, z: -1 },
    mountRadius: 1.8,
    caged: true,
    ...overrides,
  };
}

test('repository uses the supplied Climbing Ladder FBX verbatim', async () => {
  const bytes = await readFile(new URL(
    '../assets/models/animations/Climbing Ladder.fbx',
    import.meta.url,
  ));
  assert.equal(bytes.byteLength, 841_664);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    'B142AA64400DB361555E8E326A0287EC0DBA40BE8ADC129D0E45B0C20B510F62',
  );
});

test('ladder FBX contract removes imported root translation and heading', () => {
  const definition = PLAYER_FBX_ANIMATION_DEFINITIONS.find(({ key }) => key === 'climbingLadder');
  assert.deepEqual({
    lockRootY: definition?.lockRootY,
    lockRootYToRest: definition?.lockRootYToRest,
    normalizeRootRotationToRest: definition?.normalizeRootRotationToRest,
  }, {
    lockRootY: true,
    lockRootYToRest: true,
    normalizeRootRotationToRest: true,
  });

  const hips = new THREE.Bone();
  hips.name = 'Hips';
  hips.position.set(2, 3, 4);
  hips.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.25);
  hips.userData.restLocalPosition = hips.position.clone();
  const rig = Object.create(SkeletalModelRig.prototype);
  rig.root = new THREE.Group();
  rig.root.name = 'Root';
  rig.bonesByName = new Map([['hips', [hips]]]);
  rig.restLocalQuaternions = new Map([[hips, hips.quaternion.clone()]]);

  const sourceStart = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI,
  );
  const sourceEnd = sourceStart.clone().multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4),
  );
  const clip = new THREE.AnimationClip('source', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [10, 20, 30, 11, 25, 32]),
    new THREE.QuaternionKeyframeTrack(
      'Hips.quaternion',
      [0, 1],
      [...sourceStart.toArray(), ...sourceEnd.toArray()],
    ),
  ]);
  const prepared = rig._prepareAnimationClip(clip, 'climbingLadder', definition);
  const positionTrack = prepared.tracks.find(({ name }) => name.endsWith('.position'));
  const rotationTrack = prepared.tracks.find(({ name }) => name.endsWith('.quaternion'));
  assert.deepEqual([...positionTrack.values], [2, 3, 4, 2, 3, 4]);
  const preparedStart = new THREE.Quaternion().fromArray(rotationTrack.values, 0);
  assert.ok(preparedStart.angleTo(hips.quaternion) < 1e-6);
});

test('ladder mounting is endpoint-only and snaps to the exact authored root plane', () => {
  const ladder = createLadder();
  const remote = createPlayerHarness(new THREE.Vector3(0, 2.1, -0.42));
  assert.equal(remote.mountLadder(ladder), false, 'mid-shaft proximity must not mount');

  const player = createPlayerHarness();
  assert.equal(player.mountLadder(ladder, { endpoint: 'bottom' }), true);
  assert.deepEqual(player.root.position.toArray(), [0, 0, -0.42]);
  assert.equal(player.getLadderTraversalDiagnostics().signedPlaneClearance, 0.42);
  assert.ok(player.getLadderTraversalDiagnostics().facingAlignment > 0.999);

  player.root.position.x = 0.7;
  player.root.position.z = -1.1;
  player._updateLadderTraversal(1 / 60, new Set(['KeyW']));
  assert.equal(player.root.position.x, 0);
  assert.equal(player.root.position.z, -0.42);
  assert.ok(player.root.position.y > 0);
  assert.equal(player.lastExternalModelMotion[5].playbackRate, 1);
});

test('Space cannot teleport out of a caged ladder shaft', () => {
  const player = createPlayerHarness();
  assert.equal(player.mountLadder(createLadder()), true);
  player.root.position.y = 2.1;
  const before = player.root.position.clone();
  assert.equal(player.tryJump(), true);
  assert.equal(player.isClimbingLadder(), true);
  assert.deepEqual(player.root.position.toArray(), before.toArray());
  assert.equal(player.root.userData.lastLadderJumpResult, 'ignored-in-caged-shaft');
});

test('ladder dismount handoff exists only after reaching an authored landing', () => {
  const player = createPlayerHarness();
  const ladder = createLadder();
  assert.equal(player.mountLadder(ladder), true);
  assert.equal(player.consumeLadderDismountConstraintHandoff(), null);

  player.root.position.y = ladder.topY - 0.01;
  player._updateLadderTraversal(1 / 60, new Set(['KeyW']));
  assert.equal(player.isClimbingLadder(), false);
  assert.deepEqual(player.root.position.toArray(), [0, 4.2, -1.45]);
  for (let pass = 0; pass < 2; pass += 1) {
    const handoff = player.consumeLadderDismountConstraintHandoff();
    assert.equal(handoff.endpoint, 'top');
    assert.deepEqual(handoff.position.toArray(), [0, 4.2, -1.45]);
  }
  assert.equal(player.consumeLadderDismountConstraintHandoff(), null);
});

test('dungeon recovery anchor is unchanged mid-shaft and commits only the landing handoff', () => {
  const root = new THREE.Group();
  root.position.set(3, 2.1, 7);
  const player = {
    root,
    isLedgeClinging: () => false,
    isClimbingLadder: () => true,
    consumeLadderDismountConstraintHandoff: () => null,
  };
  const controller = Object.create(DungeonController.prototype);
  controller.game = { player };
  controller.lastSafePlayerPosition = new THREE.Vector3(1, 0, 1);
  controller.pendingPlayerJumpOffLanding = new THREE.Vector3(9, 0, 9);
  controller._constrainPlayerToWalkable();
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), [1, 0, 1]);
  assert.equal(controller.pendingPlayerJumpOffLanding, null);

  player.isClimbingLadder = () => false;
  player.consumeLadderDismountConstraintHandoff = () => ({
    ladderId: 'connector.ladder.a',
    endpoint: 'top',
    position: new THREE.Vector3(3, 4.2, 8.5),
  });
  controller._constrainPlayerToWalkable();
  assert.deepEqual(root.position.toArray(), [3, 4.2, 8.5]);
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), [3, 4.2, 8.5]);
});

test('an explicitly open ladder releases into a fall at the current shaft height', () => {
  const player = createPlayerHarness();
  assert.equal(player.mountLadder(createLadder({ caged: false, allowJumpRelease: true })), true);
  player.root.position.y = 2.35;
  assert.equal(player.tryJump(), true);
  assert.equal(player.isClimbingLadder(), false);
  assert.equal(player.root.position.y, 2.35);
  assert.equal(player.jumpState, 'Falling');
  assert.ok(player.velocity.y < 0);
  assert.equal(player.consumeLadderDismountConstraintHandoff(), null);
});
