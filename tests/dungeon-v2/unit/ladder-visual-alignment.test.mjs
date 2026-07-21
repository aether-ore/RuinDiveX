import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Player, PLAYER_FBX_ANIMATION_DEFINITIONS } from '../../../src/Player.js';
import { SkeletalModelRig } from '../../../src/SkeletalModelRig.js';

const LADDER_BODY_CLEARANCE = 0.4;
const LADDER_WIDTH = 1.6;
const SAMPLE_COUNT = 32;
const TORSO_BONES = new Set(['hips', 'spine', 'spine1', 'spine2', 'neck', 'head']);
const MAX_WRIST_PLANE_DISTANCE = 0.3;
const MIN_TORSO_PLANE_CLEARANCE = 0.075;
const MAX_HAND_SURFACE_PLANE_GAP = 0.01;

function normalizeBoneName(name = '') {
  return String(name)
    .replace(/^mixamorig/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function getAttributeComponent(attribute, index, component) {
  if (component === 0) return attribute.getX(index);
  if (component === 1) return attribute.getY(index);
  if (component === 2) return attribute.getZ(index);
  return attribute.getW(index);
}

async function parseFbx(path, resourcePath) {
  const bytes = await readFile(new URL(path, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const previousWarn = console.warn;
  try {
    // The source assets contain benign skin-weight normalization warnings.
    console.warn = () => {};
    return new FBXLoader().parse(buffer, resourcePath);
  } finally {
    console.warn = previousWarn;
  }
}

function createTraversalPlayer(model) {
  const player = Object.create(Player.prototype);
  player.dead = false;
  player.root = new THREE.Group();
  player.modelRoot = new THREE.Group();
  player.root.add(player.modelRoot);
  player.modelRoot.add(model);
  player.lastMoveDirection = new THREE.Vector3(0, 0, 1);
  player.velocity = new THREE.Vector3();
  player.takeoffHorizontalVelocity = new THREE.Vector3();
  player.animation = {
    state: 'idle',
    externalControlLocked: false,
    setState(state) { this.state = state; },
  };
  player._prepareForExternalControl = () => {};
  player.isPowerKnockbackActive = () => false;
  player.isExternalMotionActive = () => false;
  return player;
}

function collectTorsoVertexSamples(rig) {
  const samples = [];
  for (const mesh of rig.skinnedMeshes) {
    if (!/BodyMesh/i.test(mesh.name)) continue;
    const position = mesh.geometry?.attributes?.position;
    const skinIndex = mesh.geometry?.attributes?.skinIndex;
    const skinWeight = mesh.geometry?.attributes?.skinWeight;
    const bones = mesh.skeleton?.bones;
    if (!position || !skinIndex || !skinWeight || !bones?.length) continue;

    const torsoBoneIndices = new Set();
    for (let boneIndex = 0; boneIndex < bones.length; boneIndex += 1) {
      if (TORSO_BONES.has(normalizeBoneName(bones[boneIndex]?.name))) {
        torsoBoneIndices.add(boneIndex);
      }
    }

    const indices = [];
    for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
      let torsoWeight = 0;
      for (let component = 0; component < skinIndex.itemSize; component += 1) {
        if (torsoBoneIndices.has(getAttributeComponent(skinIndex, vertexIndex, component))) {
          torsoWeight += getAttributeComponent(skinWeight, vertexIndex, component);
        }
      }
      if (torsoWeight >= 0.5) indices.push(vertexIndex);
    }
    samples.push({ mesh, position, indices });
  }
  return samples;
}

function collectHandVertexSamples(rig) {
  const samples = [];
  for (const mesh of rig.skinnedMeshes) {
    const side = /HandMesh_L/i.test(mesh.name)
      ? 'left'
      : /HandMesh_R/i.test(mesh.name)
        ? 'right'
        : null;
    const position = mesh.geometry?.attributes?.position;
    if (!side || !position) continue;
    samples.push({
      mesh,
      side,
      position,
      indices: Array.from({ length: position.count }, (_, index) => index),
    });
  }
  return samples;
}

function sampleTorsoMinimumClearance(samples, planePoint, planeNormal) {
  let minimum = Infinity;
  const point = new THREE.Vector3();
  for (const sample of samples) {
    sample.mesh.updateMatrixWorld(true);
    for (const vertexIndex of sample.indices) {
      point.fromBufferAttribute(sample.position, vertexIndex);
      if (typeof sample.mesh.applyBoneTransform === 'function') {
        sample.mesh.applyBoneTransform(vertexIndex, point);
      } else {
        sample.mesh.boneTransform(vertexIndex, point);
      }
      sample.mesh.localToWorld(point);
      minimum = Math.min(minimum, point.sub(planePoint).dot(planeNormal));
    }
  }
  return minimum;
}

function sampleSurfaceRange(sample, planePoint, planeNormal) {
  let minimum = Infinity;
  let maximum = -Infinity;
  const point = new THREE.Vector3();
  sample.mesh.updateMatrixWorld(true);
  for (const vertexIndex of sample.indices) {
    point.fromBufferAttribute(sample.position, vertexIndex);
    if (typeof sample.mesh.applyBoneTransform === 'function') {
      sample.mesh.applyBoneTransform(vertexIndex, point);
    } else {
      sample.mesh.boneTransform(vertexIndex, point);
    }
    sample.mesh.localToWorld(point);
    const clearance = point.sub(planePoint).dot(planeNormal);
    minimum = Math.min(minimum, clearance);
    maximum = Math.max(maximum, clearance);
  }
  return { minimum, maximum };
}

function createLadder(facing) {
  const center = new THREE.Vector3(7.25, 2, -5.5);
  const planeNormal = facing.clone().multiplyScalar(-1);
  const planeCenter = center.clone().addScaledVector(facing, LADDER_BODY_CLEARANCE);
  return {
    id: `ladder-${facing.x}-${facing.z}`,
    center,
    planeCenter,
    planeNormal,
    bodyClearance: LADDER_BODY_CLEARANCE,
    bottomY: 2,
    topY: 8,
    facing,
    bottomExit: center.clone(),
    topExit: center.clone().setY(8),
  };
}

test('real Volnutt ladder cycle stays aligned to the visual rung plane at all four facings', async (t) => {
  const [baseModel, animationModel] = await Promise.all([
    parseFbx('../../../assets/models/Mega Man Volnutt.fbx', './assets/models/'),
    parseFbx('../../../assets/models/animations/Climbing Ladder.fbx', './assets/models/animations/'),
  ]);

  const fitOwner = { _characterModelScale: 1 };
  Player.prototype._fitModelToPlayer.call(fitOwner, baseModel);
  const fittedHeight = new THREE.Box3().setFromObject(baseModel)
    .getSize(new THREE.Vector3()).y;
  assert.ok(Math.abs(fittedHeight - 2.85) < 1e-9,
    'audit must use the same 2.85m fitted Volnutt model as runtime');
  const rig = new SkeletalModelRig(baseModel);
  const definition = PLAYER_FBX_ANIMATION_DEFINITIONS.find(({ key }) => key === 'climbingLadder');
  assert.equal(rig.setAnimationClips(new Map([
    ['climbingLadder', { ...definition, clip: animationModel.animations[0] }],
  ])), 1);

  const player = createTraversalPlayer(baseModel);
  const torsoSamples = collectTorsoVertexSamples(rig);
  const handSamples = collectHandVertexSamples(rig);
  const torsoVertexCount = torsoSamples.reduce((total, sample) => total + sample.indices.length, 0);
  assert.ok(torsoVertexCount > 1_000, 'audit requires the actual skinned torso, not joint-only stand-ins');

  rig.update(0, {
    state: 'climbingLadder',
    clipKey: 'climbingLadder',
    moving: true,
    moveAmount: 1,
  });
  const action = rig.animationActions.get('climbingLadder');
  const duration = rig.animationClips.get('climbingLadder').duration;
  const facings = [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
  ];
  const measurements = [];

  for (const facing of facings) {
    const ladder = createLadder(facing);
    assert.equal(player.mountLadder(ladder), true);
    const planePoint = new THREE.Vector3(ladder.planeCenter.x, 0, ladder.planeCenter.z);
    const planeNormal = ladder.planeNormal.clone();
    const tangent = new THREE.Vector3(-facing.z, 0, facing.x);
    const facingMeasurement = {
      facing: [facing.x, facing.z],
      minimumTorsoClearance: Infinity,
      minimumHipClearance: Infinity,
      minimumSpineClearance: Infinity,
      minimumWristPlaneDistance: Infinity,
      maximumWristPlaneDistance: 0,
      minimumSignedWristClearance: Infinity,
      maximumSignedWristClearance: -Infinity,
      maximumWristTangent: 0,
      minimumHandSurfaceClearance: Infinity,
      maximumHandSurfaceClearance: -Infinity,
      maximumNearestHandSurfaceDistance: 0,
    };

    const mountDiagnostics = player.getLadderTraversalDiagnostics();
    assert.ok(Math.abs(mountDiagnostics.signedPlaneClearance - LADDER_BODY_CLEARANCE) < 1e-9,
      'Player.mountLadder must place the physical root on the authored 0.4m path');
    assert.ok(mountDiagnostics.facingAlignment > 0.999999,
      'Player.mountLadder must face the visual rung plane');

    for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
      action.time = duration * sampleIndex / SAMPLE_COUNT;
      rig.mixer.update(0);
      player.root.updateMatrixWorld(true);

      facingMeasurement.minimumTorsoClearance = Math.min(
        facingMeasurement.minimumTorsoClearance,
        sampleTorsoMinimumClearance(torsoSamples, planePoint, planeNormal),
      );
      for (const jointName of ['hips', 'spine']) {
        const point = rig.joints.get(jointName).getWorldPosition(new THREE.Vector3());
        const clearance = point.sub(planePoint).dot(planeNormal);
        const metric = jointName === 'hips' ? 'minimumHipClearance' : 'minimumSpineClearance';
        facingMeasurement[metric] = Math.min(facingMeasurement[metric], clearance);
      }
      for (const jointName of ['leftWrist', 'rightWrist']) {
        const point = rig.joints.get(jointName).getWorldPosition(new THREE.Vector3());
        const delta = point.sub(planePoint);
        const signedClearance = delta.dot(planeNormal);
        const planeDistance = Math.abs(signedClearance);
        const tangentDistance = Math.abs(delta.dot(tangent));
        facingMeasurement.minimumWristPlaneDistance = Math.min(
          facingMeasurement.minimumWristPlaneDistance,
          planeDistance,
        );
        facingMeasurement.maximumWristPlaneDistance = Math.max(
          facingMeasurement.maximumWristPlaneDistance,
          planeDistance,
        );
        facingMeasurement.minimumSignedWristClearance = Math.min(
          facingMeasurement.minimumSignedWristClearance,
          signedClearance,
        );
        facingMeasurement.maximumSignedWristClearance = Math.max(
          facingMeasurement.maximumSignedWristClearance,
          signedClearance,
        );
        facingMeasurement.maximumWristTangent = Math.max(
          facingMeasurement.maximumWristTangent,
          tangentDistance,
        );
      }
      for (const handSample of handSamples) {
        const range = sampleSurfaceRange(handSample, planePoint, planeNormal);
        const nearestDistance = range.minimum <= 0 && range.maximum >= 0
          ? 0
          : Math.min(Math.abs(range.minimum), Math.abs(range.maximum));
        facingMeasurement.minimumHandSurfaceClearance = Math.min(
          facingMeasurement.minimumHandSurfaceClearance,
          range.minimum,
        );
        facingMeasurement.maximumHandSurfaceClearance = Math.max(
          facingMeasurement.maximumHandSurfaceClearance,
          range.maximum,
        );
        facingMeasurement.maximumNearestHandSurfaceDistance = Math.max(
          facingMeasurement.maximumNearestHandSurfaceDistance,
          nearestDistance,
        );
      }
    }
    measurements.push(facingMeasurement);
  }

  t.diagnostic(JSON.stringify({
    modelScale: fitOwner._characterModelScale,
    fittedHeight,
    torsoVertexCount,
    sampleCount: SAMPLE_COUNT,
    duration,
    measurements,
  }, null, 2));

  for (const measurement of measurements) {
    const facingLabel = `${measurement.facing[0]},${measurement.facing[1]}`;
    assert.ok(measurement.minimumTorsoClearance >= MIN_TORSO_PLANE_CLEARANCE,
      `facing ${facingLabel}: animated torso must not intersect the rung plane`);
    assert.ok(measurement.minimumHipClearance > LADDER_BODY_CLEARANCE,
      `facing ${facingLabel}: animated hips must remain outside the root clearance line`);
    assert.ok(measurement.minimumSpineClearance > LADDER_BODY_CLEARANCE,
      `facing ${facingLabel}: animated spine must remain outside the root clearance line`);
    assert.ok(measurement.minimumSignedWristClearance >= -MAX_WRIST_PLANE_DISTANCE,
      `facing ${facingLabel}: wrist joints must remain near the visual ladder plane`);
    assert.ok(measurement.maximumWristPlaneDistance <= MAX_WRIST_PLANE_DISTANCE,
      `facing ${facingLabel}: both wrist joints must remain within 0.3m of the rungs`);
    assert.ok(measurement.maximumWristTangent <= LADDER_WIDTH * 0.5,
      `facing ${facingLabel}: wrist joints must remain inside the 1.6m ladder width`);
    assert.ok(measurement.maximumNearestHandSurfaceDistance <= MAX_HAND_SURFACE_PLANE_GAP,
      `facing ${facingLabel}: each animated hand must continue to span the rung plane`);
  }

  const reference = measurements[0];
  for (const measurement of measurements.slice(1)) {
    for (const metric of [
      'minimumTorsoClearance',
      'minimumHipClearance',
      'minimumSpineClearance',
      'minimumWristPlaneDistance',
      'maximumWristPlaneDistance',
      'minimumSignedWristClearance',
      'maximumSignedWristClearance',
      'maximumWristTangent',
      'minimumHandSurfaceClearance',
      'maximumHandSurfaceClearance',
      'maximumNearestHandSurfaceDistance',
    ]) {
      assert.ok(Math.abs(measurement[metric] - reference[metric]) < 1e-6,
        `${metric} must be rotation-invariant at every cardinal ladder facing`);
    }
  }
});
