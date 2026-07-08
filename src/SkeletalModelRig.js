import * as THREE from 'three';
import {
  SemanticRigMapper,
  createNeutralSemanticPose,
  degrees,
} from './SemanticRigMapper.js';
import { CombatAnimator } from './animation/CombatAnimator.js';
import { DamageAnimator } from './animation/DamageAnimator.js';
import { DodgeRollAnimator } from './animation/DodgeRollAnimator.js';
import { JumpAnimator } from './animation/JumpAnimator.js';
import { LocomotionAnimator } from './animation/LocomotionAnimator.js';
import {
  UPPER_BODY_AIM_BLEND_IN_SPEED,
  UPPER_BODY_AIM_BLEND_OUT_SPEED,
  UpperBodyAimLayer,
} from './animation/UpperBodyAimLayer.js';

const DEFAULT_BEAM_BLADE_COLOR = 0xa8ff8a;
const BEAM_BLADE_TOTAL_FRAMES = 24;
const BEAM_BLADE_ACTIVE_START = 12 / BEAM_BLADE_TOTAL_FRAMES;
const BEAM_BLADE_SLASH_END = 16 / BEAM_BLADE_TOTAL_FRAMES;
const WALK_LOOP_SECONDS = 1.08;
const JOG_LOOP_SECONDS = 0.66;
const AIM_RIGHT_ARM_SWING_SCALE = 0.46;
const SHOULDER_CLAVICLE_BLEND = 0.16;
const SHOULDER_FORWARD_AXIS_SCALE = 1;
const ELBOW_TWIST_SCALE = 0.12;
const zeroEuler = new THREE.Euler();
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempQuaternionA = new THREE.Quaternion();
const tempQuaternionB = new THREE.Quaternion();
const tempQuaternionC = new THREE.Quaternion();
const tempQuaternionD = new THREE.Quaternion();
const modelAxisX = new THREE.Vector3(1, 0, 0);
const modelAxisY = new THREE.Vector3(0, 1, 0);
const modelAxisZ = new THREE.Vector3(0, 0, 1);

const SEMANTIC_BONE_ALIASES = {
  hips: ['hips'],
  spine: ['spine1', 'spine', 'spine2'],
  neck: ['neck'],
  leftShoulder: ['leftarm'],
  leftElbow: ['leftforearm'],
  leftWrist: ['lefthand'],
  rightShoulder: ['rightarm'],
  rightElbow: ['rightforearm'],
  rightWrist: ['righthand'],
  leftHip: ['leftupleg'],
  leftKnee: ['leftleg'],
  leftAnkle: ['leftfoot'],
  rightHip: ['rightupleg'],
  rightKnee: ['rightleg'],
  rightAnkle: ['rightfoot'],
};

function normalizeBoneName(name = '') {
  return String(name)
    .replace(/^mixamorig/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function uniqueObjects(objects = []) {
  return [...new Set(objects.filter(Boolean))];
}

function makeSolidMaterial(name, color, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.44,
    metalness: options.metalness ?? 0.08,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  material.name = name;
  return material;
}

function setTarget(map, name, x = 0, y = 0, z = 0) {
  let target = map.get(name);

  if (!target) {
    target = new THREE.Euler();
    map.set(name, target);
  }

  target.set(x, y, z);
  return target;
}

function semanticPoseToTargets(mapper, targets, pose) {
  mapper.setCorePose(targets, pose.core);
  mapper.setArmPose(targets, 'left', pose.leftArm);
  mapper.setArmPose(targets, 'right', pose.rightArm);
  mapper.setLegPose(targets, 'left', pose.leftLeg);
  mapper.setLegPose(targets, 'right', pose.rightLeg);
}

function scaleEuler(source = zeroEuler, scale = 1) {
  return new THREE.Euler(source.x * scale, source.y * scale, source.z * scale);
}

export class SkeletalModelRig {
  constructor(sourceModel) {
    if (!sourceModel?.isObject3D) {
      throw new Error('SkeletalModelRig requires a loaded Object3D.');
    }

    this.root = sourceModel;
    this.root.name = this.root.name || 'playerMegaManVolnuttFbxRig';
    this.root.userData.externalModelRig = this;

    this.joints = new Map();
    this.restPositions = new Map();
    this.partMeshes = new Map();
    this.bonesByName = new Map();
    this.skinnedMeshes = [];
    this.animatedBones = new Set();
    this.restLocalQuaternions = new Map();
    this.restLocalPositions = new Map();
    this.restLocalScales = new Map();
    this.parentSpaceAxes = new Map();
    this.spineBones = [];
    this.clavicleBones = { left: null, right: null };
    this.meshCount = 0;
    this.time = 0;
    this.walkPhase = 0;
    this.busterArmGroup = null;
    this.busterMuzzle = null;
    this.busterArmActive = false;
    this.drillArmGroup = null;
    this.drillBitSpin = null;
    this.drillTip = null;
    this.drillArmActive = false;
    this.drillSpinning = false;
    this.drillColor = new THREE.Color(0xffd36f);
    this.beamBladeGroup = null;
    this.beamBladeActive = false;
    this.beamBladeColor = new THREE.Color(DEFAULT_BEAM_BLADE_COLOR);
    this.debugPoseEnabled = false;
    this.debugPoseOverrides = new Map();
    this.semanticMapper = new SemanticRigMapper(this.joints);
    this.neutralSemanticPose = createNeutralSemanticPose();
    this.modelHeight = 1;
    this.locomotionAnimator = new LocomotionAnimator(this.semanticMapper);
    this.upperBodyAimLayer = new UpperBodyAimLayer(this.semanticMapper);
    this.combatAnimator = new CombatAnimator(this.semanticMapper);
    this.damageAnimator = new DamageAnimator(this.semanticMapper);
    this.dodgeRollAnimator = new DodgeRollAnimator(this.semanticMapper);
    this.jumpAnimator = new JumpAnimator(this.semanticMapper);
    this.aimLayerWeight = 0;
    this.previousRigState = 'idle';
    this.stateTime = 0;

    this._buildBoneMap();
    this._registerSemanticJoints();
    this._captureRestState();
    this._prepareSkinnedMeshes();
    this._createAndAttachDrillArm();

    if (this.meshCount <= 0 || !this.joints.get('hips')) {
      throw new Error('The FBX did not expose the expected skinned Volnutt skeleton.');
    }
  }

  setDebugPoseEnabled(enabled) {
    this.debugPoseEnabled = Boolean(enabled);

    if (this.debugPoseEnabled) {
      this._applyDebugPoseOverridesImmediate();
    }
  }

  setDebugPoseOverrides(overrides = {}) {
    this.debugPoseOverrides.clear();

    for (const [jointName, rotation] of Object.entries(overrides)) {
      this.debugPoseOverrides.set(jointName, new THREE.Vector3(
        rotation.x ?? 0,
        rotation.y ?? 0,
        rotation.z ?? 0,
      ));
    }

    if (this.debugPoseEnabled) {
      this._applyDebugPoseOverridesImmediate();
    }
  }

  updateDebugPoseOverride(jointName, axis, value) {
    const joint = this.joints.get(jointName);

    if (!joint || !['x', 'y', 'z'].includes(axis)) {
      return false;
    }

    const rotation = this.debugPoseOverrides.get(jointName) ?? new THREE.Vector3();
    rotation[axis] = value;
    this.debugPoseOverrides.set(jointName, rotation);

    if (this.debugPoseEnabled) {
      const target = new THREE.Euler(rotation.x, rotation.y, rotation.z);
      this._applySemanticJointRotation(jointName, target, 1, new Set());
    }

    return true;
  }

  setBusterArm(busterObject) {
    const elbow = this.joints.get('rightElbow');

    if (!elbow || !busterObject?.isObject3D) {
      return false;
    }

    if (this.busterArmGroup?.parent) {
      this.busterArmGroup.parent.remove(this.busterArmGroup);
    }

    this._scaleBusterToForearm(busterObject);
    busterObject.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(busterObject);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const group = new THREE.Group();

    group.name = 'rigSkeletalBusterArmGroup';
    group.rotation.y = -Math.PI / 2;
    this._applyInverseRootScale(group);
    busterObject.position.sub(new THREE.Vector3(center.x, center.y, bounds.min.z));

    this.busterMuzzle = new THREE.Group();
    this.busterMuzzle.name = 'rigSkeletalBusterMuzzle';
    this.busterMuzzle.position.set(0, 0, size.z + size.z * 0.12);
    this.beamBladeGroup = this._createBeamBladeGroup();
    this.busterMuzzle.add(this.beamBladeGroup);

    group.add(busterObject, this.busterMuzzle);
    elbow.add(group);
    this.busterArmGroup = group;
    this.setBusterArmActive(this.busterArmActive);
    this.setBeamBladeActive(this.beamBladeActive, this.beamBladeColor);
    return true;
  }

  _scaleBusterToForearm(busterObject) {
    const elbow = this.joints.get('rightElbow');
    const wrist = this.joints.get('rightWrist');

    if (!elbow || !wrist) {
      return;
    }

    elbow.getWorldPosition(tempVectorA);
    wrist.getWorldPosition(tempVectorB);
    const desiredLength = tempVectorA.distanceTo(tempVectorB) * 1.18;

    if (desiredLength <= 0.001) {
      return;
    }

    busterObject.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(busterObject);
    const size = bounds.getSize(new THREE.Vector3());
    const currentLength = Math.max(0.001, size.x, size.y, size.z);
    const scale = THREE.MathUtils.clamp(desiredLength / currentLength, 0.04, 4);

    busterObject.scale.multiplyScalar(scale);
    busterObject.updateMatrixWorld(true);
  }

  setBusterArmActive(active) {
    this.busterArmActive = Boolean(active && this.busterArmGroup);

    if (this.busterArmGroup) {
      this.busterArmGroup.visible = this.busterArmActive;
    }

    this._syncRightArmReplacementVisibility();

    if (!this.busterArmActive && this.beamBladeGroup) {
      this.beamBladeGroup.visible = false;
    }
  }

  setDrillArmActive(active, color = null) {
    this.drillArmActive = Boolean(active && this.drillArmGroup);

    if (color !== null && color !== undefined) {
      this.drillColor.set(color);
      this._tintDrillArm();
    }

    if (this.drillArmGroup) {
      this.drillArmGroup.visible = this.drillArmActive;
    }

    if (this.drillArmActive && this.busterArmGroup) {
      this.busterArmGroup.visible = false;
    }

    this._syncRightArmReplacementVisibility();

    if (!this.drillArmActive) {
      this.setDrillSpinning(false);
    }
  }

  setDrillSpinning(active) {
    this.drillSpinning = Boolean(active && this.drillArmActive);
  }

  setBeamBladeActive(active, color = null) {
    this.beamBladeActive = Boolean(active);

    if (color !== null && color !== undefined) {
      this.beamBladeColor.set(color);
      this._tintBeamBlade();
    }

    if (!this.beamBladeActive && this.beamBladeGroup) {
      this.beamBladeGroup.visible = false;
    }
  }

  getBusterMuzzleWorldPosition(target = new THREE.Vector3()) {
    if (!this.busterArmActive || !this.busterMuzzle) {
      return null;
    }

    return this.busterMuzzle.getWorldPosition(target);
  }

  getDrillTipWorldPosition(target = new THREE.Vector3()) {
    if (!this.drillArmActive || !this.drillTip) {
      return null;
    }

    return this.drillTip.getWorldPosition(target);
  }

  resolveDebugJointForObject(object) {
    for (let current = object; current; current = current.parent) {
      const jointName = current.userData?.poseJointName;
      if (jointName && this.joints.has(jointName)) {
        return jointName;
      }
    }

    return null;
  }

  update(dt, {
    moving = false,
    moveAmount = 0,
    state = 'idle',
    attackProgress = 0,
    actionProgress = null,
    hurtProgress = 0,
    damageHitLocal = null,
    projectileAiming = false,
    backpedaling = false,
    running = false,
    attackKind = 'melee',
    lockOnActive = false,
    strafeAmount = 0,
  } = {}) {
    this.time += dt;
    const rigState = `${state}:${attackKind ?? ''}`;
    if (rigState !== this.previousRigState) {
      this.previousRigState = rigState;
      this.stateTime = 0;
    } else {
      this.stateTime += dt;
    }

    if (moving) {
      const walkDirection = backpedaling ? -0.86 : 1;
      const loopDuration = THREE.MathUtils.lerp(WALK_LOOP_SECONDS, JOG_LOOP_SECONDS, running ? 1 : 0);
      const gaitSpeed = (Math.PI * 2) / loopDuration;
      this.walkPhase += dt * gaitSpeed * Math.max(0.55, moveAmount) * walkDirection;
    }

    const targets = new Map();
    const alpha = Math.min(1, dt * (moving ? 20 : 12));

    this._applyLocomotionSemanticPose(targets, {
      moving,
      moveAmount,
      running,
      projectileAiming,
      lockOnActive,
      strafeAmount,
    });

    const targetAimWeight = projectileAiming || lockOnActive ? 1 : 0;
    const aimBlendSpeed = targetAimWeight > this.aimLayerWeight
      ? UPPER_BODY_AIM_BLEND_IN_SPEED
      : UPPER_BODY_AIM_BLEND_OUT_SPEED;
    this.aimLayerWeight = THREE.MathUtils.lerp(this.aimLayerWeight, targetAimWeight, Math.min(1, dt * aimBlendSpeed));
    this.upperBodyAimLayer.apply(targets, {
      weight: this.aimLayerWeight,
      attackProgress,
      projectileAiming,
      backpedaling,
      lockOnActive,
      strafeAmount,
    });

    if (state === 'attacking' && projectileAiming) {
      this.semanticMapper.addLegPose(targets, 'left', { kneeBend: degrees(7), ankleRoll: degrees(2) }, this.aimLayerWeight);
      this.semanticMapper.addLegPose(targets, 'right', { kneeBend: degrees(7), ankleRoll: -degrees(2) }, this.aimLayerWeight);
    } else if (state === 'attacking' && attackKind === 'beamBlade') {
      this.combatAnimator.applyBeamBladeSlash(targets, attackProgress);
    } else if (state === 'attacking') {
      this.combatAnimator.applyMelee(targets, attackProgress);
    } else {
      const fullBodyActionProgress = Number.isFinite(actionProgress)
        ? THREE.MathUtils.clamp(actionProgress, 0, 1)
        : THREE.MathUtils.clamp(this.stateTime / 0.75, 0, 1);
      this._applyFullBodyActionPose(targets, state, fullBodyActionProgress);
    }

    if (state === 'hurt') {
      this.damageAnimator.applyStandingFlinch(targets, hurtProgress, damageHitLocal);
    }

    this._applyDebugPoseOverrides(targets);
    this._applyTargetRotations(targets, alpha);
    this._resetAnimatedBonePositions(alpha);
    this._updateBusterArmLocalPose(dt, state, attackKind, attackProgress);
    this._updateDrillArmVisual(dt);
    this._updateBeamBladeVisual(state === 'attacking' && attackKind === 'beamBlade', attackProgress);
  }

  _buildBoneMap() {
    this.root.updateMatrixWorld(true);

    this.root.traverse((object) => {
      if (object.isSkinnedMesh) {
        this.skinnedMeshes.push(object);
        this.meshCount += 1;
      }

      if (!object.isBone) {
        return;
      }

      const key = normalizeBoneName(object.name);
      const bones = this.bonesByName.get(key);

      if (bones) {
        bones.push(object);
      } else {
        this.bonesByName.set(key, [object]);
      }
    });
  }

  _registerSemanticJoints() {
    for (const [jointName, aliases] of Object.entries(SEMANTIC_BONE_ALIASES)) {
      const bone = this._pickBone(aliases);
      if (!bone) {
        continue;
      }

      bone.userData.semanticJointName = jointName;
      this.joints.set(jointName, bone);
    }

    this.spineBones = uniqueObjects([
      this._pickBone(['spine']),
      this._pickBone(['spine1']),
      this._pickBone(['spine2']),
      this.joints.get('spine'),
    ]);
    this.clavicleBones.left = this._pickBone(['leftshoulder']);
    this.clavicleBones.right = this._pickBone(['rightshoulder']);

    for (const bone of [
      ...this.joints.values(),
      ...this.spineBones,
      this.clavicleBones.left,
      this.clavicleBones.right,
    ]) {
      if (bone) {
        this.animatedBones.add(bone);
      }
    }
  }

  _captureRestState() {
    this.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.root);
    this.modelHeight = bounds.getSize(tempVectorA).y || 1;

    for (const bone of this.animatedBones) {
      this.restLocalQuaternions.set(bone, bone.quaternion.clone());
      this.restLocalPositions.set(bone, bone.position.clone());
      this.restLocalScales.set(bone, bone.scale.clone());
      bone.userData.restLocalPosition = bone.position.clone();
      bone.userData.restWorldPosition = bone.getWorldPosition(new THREE.Vector3());
      this.parentSpaceAxes.set(bone, this._getParentSpaceAxes(bone));
    }

    for (const [name, joint] of this.joints.entries()) {
      this.restPositions.set(name, joint.userData.restWorldPosition?.clone() ?? joint.getWorldPosition(new THREE.Vector3()));
    }
  }

  _prepareSkinnedMeshes() {
    for (const mesh of this.skinnedMeshes) {
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (mesh.name.includes('HandMesh_L')) {
        mesh.userData.poseJointName = 'leftWrist';
      } else if (mesh.name.includes('HandMesh_R')) {
        mesh.userData.poseJointName = 'rightWrist';
      } else if (mesh.name.includes('BodyMesh_c')) {
        mesh.userData.poseJointName = 'neck';
      } else {
        mesh.userData.poseJointName = 'spine';
      }
    }
  }

  _pickBone(aliases = []) {
    for (const alias of aliases) {
      const candidates = this.bonesByName.get(normalizeBoneName(alias));
      if (!candidates?.length) {
        continue;
      }

      return candidates
        .slice()
        .sort((a, b) => this._scoreBoneCandidate(b) - this._scoreBoneCandidate(a))[0];
    }

    return null;
  }

  _scoreBoneCandidate(bone) {
    let descendantBoneCount = 0;
    bone.traverse((object) => {
      if (object !== bone && object.isBone) {
        descendantBoneCount += 1;
      }
    });

    const directBoneChildren = bone.children.filter((child) => child.isBone).length;
    return descendantBoneCount * 4 + directBoneChildren * 8;
  }

  _getParentSpaceAxes(bone) {
    const parent = bone.parent;
    const rootQuaternion = this.root.getWorldQuaternion(tempQuaternionA);
    const parentQuaternion = parent?.getWorldQuaternion(tempQuaternionB) ?? tempQuaternionB.identity();
    const parentInverse = parentQuaternion.clone().invert();

    const toParentAxis = (axis) => axis
      .clone()
      .applyQuaternion(rootQuaternion)
      .applyQuaternion(parentInverse)
      .normalize();

    return {
      x: toParentAxis(modelAxisX),
      y: toParentAxis(modelAxisY),
      z: toParentAxis(modelAxisZ),
    };
  }

  _applyLocomotionSemanticPose(targets, {
    moving = false,
    moveAmount = 0,
    running = false,
    projectileAiming = false,
    lockOnActive = false,
    strafeAmount = 0,
  } = {}) {
    if (!moving) {
      this._applyIdleSemanticPose(targets);
      return;
    }

    const speedBlend = THREE.MathUtils.clamp(moveAmount, 0, 1.35);
    const runBlend = running ? THREE.MathUtils.clamp((speedBlend - 1) / 0.35, 0, 1) : 0;
    const rightArmSwingScale = projectileAiming || lockOnActive ? AIM_RIGHT_ARM_SWING_SCALE : 1;

    this.locomotionAnimator.apply({
      rotationTargets: targets,
      positionTargets: new Map(),
      phase: this.walkPhase,
      moveAmount: Math.min(speedBlend, 1),
      runBlend,
      rightArmSwingScale,
      restPositionFor: () => null,
    });

    const lockOnStrafe = lockOnActive ? THREE.MathUtils.clamp(strafeAmount, -1, 1) : 0;
    if (Math.abs(lockOnStrafe) > 0.05) {
      const twist = lockOnStrafe * (moving ? 1 : 0.55);
      this.semanticMapper.addCorePose(targets, {
        hips: { pitch: 0, yaw: -degrees(13) * twist, roll: degrees(2.5) * twist },
        spine: { pitch: 0, yaw: degrees(8) * twist, roll: -degrees(1.8) * twist },
      });
      this.semanticMapper.addLegPose(targets, 'left', { hipYaw: -degrees(4) * twist, hipRoll: degrees(2) * twist }, 1);
      this.semanticMapper.addLegPose(targets, 'right', { hipYaw: -degrees(4) * twist, hipRoll: degrees(2) * twist }, 1);
    }
  }

  _applyIdleSemanticPose(targets) {
    semanticPoseToTargets(this.semanticMapper, targets, this.neutralSemanticPose);

    const breathing = Math.sin(this.time * 2.4);
    this.semanticMapper.addCorePose(targets, {
      spine: { pitch: breathing * degrees(0.5), yaw: 0, roll: breathing * degrees(0.4) },
      neck: { pitch: breathing * degrees(0.35), yaw: 0, roll: -breathing * degrees(0.25) },
    });
    this.semanticMapper.addArmPose(targets, 'left', {
      armForwardBack: breathing * degrees(0.8),
      armRaise: breathing * degrees(0.5),
      elbowBend: degrees(2),
    });
    this.semanticMapper.addArmPose(targets, 'right', {
      armForwardBack: -breathing * degrees(0.6),
      armRaise: -breathing * degrees(0.35),
      elbowBend: degrees(2),
    });
  }

  _applyFullBodyActionPose(targets, state, progress) {
    if (state === 'dodgeRoll') {
      this.dodgeRollAnimator.apply(targets, progress);
    } else if (state === 'neutralJump' || state === 'forwardJump' || state === 'fall' || state === 'land') {
      this.jumpAnimator.apply(targets, state, progress);
    } else if (state === 'knockbackFall' || state === 'downed') {
      this.damageAnimator.applyKnockbackFall(targets, state, progress);
    } else if (state === 'getUp') {
      this.damageAnimator.applyGetUp(targets, progress);
    }
  }

  _applyDebugPoseOverrides(targets) {
    if (!this.debugPoseEnabled) {
      return;
    }

    for (const [jointName, rotation] of this.debugPoseOverrides.entries()) {
      setTarget(targets, jointName, rotation.x, rotation.y, rotation.z);
    }
  }

  _applyDebugPoseOverridesImmediate() {
    const applied = new Set();
    for (const [jointName, rotation] of this.debugPoseOverrides.entries()) {
      this._applySemanticJointRotation(jointName, new THREE.Euler(rotation.x, rotation.y, rotation.z), 1, applied);
    }
  }

  _applyTargetRotations(targets, alpha) {
    const applied = new Set();

    for (const [jointName, joint] of this.joints.entries()) {
      if (!joint || jointName === 'spine') {
        continue;
      }

      this._applySemanticJointRotation(jointName, targets.get(jointName) ?? zeroEuler, alpha, applied);
    }

    this._applySpineRotation(targets.get('spine') ?? zeroEuler, alpha, applied);

    for (const bone of this.animatedBones) {
      if (!applied.has(bone)) {
        this._applyBoneRotation(bone, zeroEuler, alpha);
      }
    }
  }

  _applySemanticJointRotation(jointName, target, alpha, applied) {
    if (jointName === 'spine') {
      this._applySpineRotation(target, alpha, applied);
      return;
    }

    if (jointName === 'leftShoulder' || jointName === 'rightShoulder') {
      const side = jointName.startsWith('left') ? 'left' : 'right';
      this._applyShoulderRotation(side, target, alpha, applied);
      return;
    }

    const joint = this.joints.get(jointName);
    if (!joint) {
      return;
    }

    this._applyBoneRotation(joint, this._mapJointRotation(jointName, target), alpha);
    applied.add(joint);
  }

  _applySpineRotation(target, alpha, applied) {
    const bones = this.spineBones.length > 0 ? this.spineBones : [this.joints.get('spine')];
    const weights = bones.length >= 3 ? [0.32, 0.42, 0.26] : bones.length === 2 ? [0.55, 0.45] : [1];

    bones.forEach((bone, index) => {
      if (!bone) {
        return;
      }

      this._applyBoneRotation(bone, scaleEuler(target, weights[index] ?? 1), alpha);
      applied.add(bone);
    });
  }

  _applyShoulderRotation(side, target, alpha, applied) {
    const joint = this.joints.get(`${side}Shoulder`);
    const clavicle = this.clavicleBones[side];
    const mapped = this._mapJointRotation(`${side}Shoulder`, target);

    if (clavicle && clavicle !== joint) {
      this._applyBoneRotation(clavicle, scaleEuler(mapped, SHOULDER_CLAVICLE_BLEND), alpha);
      applied.add(clavicle);
    }

    if (joint) {
      this._applyBoneRotation(joint, mapped, alpha);
      applied.add(joint);
    }
  }

  _mapJointRotation(jointName, target = zeroEuler) {
    if (jointName.endsWith('Shoulder')) {
      return new THREE.Euler(
        (target.x + target.y) * SHOULDER_FORWARD_AXIS_SCALE,
        0,
        target.z,
      );
    }

    if (jointName.endsWith('Elbow')) {
      return new THREE.Euler(
        target.x * ELBOW_TWIST_SCALE,
        target.y,
        target.z,
      );
    }

    return target;
  }

  _applyBoneRotation(bone, rotation = zeroEuler, alpha = 1) {
    const rest = this.restLocalQuaternions.get(bone);
    const axes = this.parentSpaceAxes.get(bone);

    if (!rest || !axes) {
      return;
    }

    const delta = tempQuaternionA.identity();

    if (Math.abs(rotation.x) > 0.000001) {
      delta.multiply(tempQuaternionB.setFromAxisAngle(axes.x, rotation.x));
    }
    if (Math.abs(rotation.y) > 0.000001) {
      delta.multiply(tempQuaternionC.setFromAxisAngle(axes.y, rotation.y));
    }
    if (Math.abs(rotation.z) > 0.000001) {
      delta.multiply(tempQuaternionD.setFromAxisAngle(axes.z, rotation.z));
    }

    const targetQuaternion = rest.clone().premultiply(delta);
    bone.quaternion.slerp(targetQuaternion, THREE.MathUtils.clamp(alpha, 0, 1));
  }

  _resetAnimatedBonePositions(alpha = 1) {
    for (const bone of this.animatedBones) {
      const restPosition = this.restLocalPositions.get(bone);
      const restScale = this.restLocalScales.get(bone);

      if (restPosition) {
        bone.position.lerp(restPosition, alpha);
      }

      if (restScale) {
        bone.scale.lerp(restScale, alpha);
      }
    }
  }

  _syncRightArmReplacementVisibility() {
    const replacementActive = this.busterArmActive || this.drillArmActive;

    for (const mesh of this.skinnedMeshes) {
      if (mesh.name.includes('HandMesh_R')) {
        mesh.visible = !replacementActive;
      }
    }
  }

  _createAndAttachDrillArm() {
    const elbow = this.joints.get('rightElbow');

    if (!elbow) {
      return false;
    }

    const group = new THREE.Group();
    group.name = 'rigSkeletalDrillArmGroup';
    group.rotation.y = -Math.PI / 2;
    group.visible = false;
    this._applyInverseRootScale(group);

    const shellMaterial = makeSolidMaterial('material_rigDrillShell', 0x315a9c, {
      roughness: 0.42,
      metalness: 0.26,
      emissive: 0x081428,
      emissiveIntensity: 0.12,
    });

    const bandMaterial = makeSolidMaterial('material_rigDrillBands', 0x9fb6c8, {
      roughness: 0.34,
      metalness: 0.38,
      emissive: 0x151b22,
      emissiveIntensity: 0.08,
    });

    const bitMaterial = makeSolidMaterial('material_rigDrillBit', this.drillColor.getHex(), {
      roughness: 0.28,
      metalness: 0.2,
      emissive: this.drillColor.getHex(),
      emissiveIntensity: 0.32,
    });

    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.46, 20), shellMaterial);
    motor.name = 'rigDrillMotorHousing';
    motor.rotation.x = Math.PI / 2;
    motor.position.z = 0.2;
    motor.castShadow = true;

    const rearBand = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 20), bandMaterial);
    rearBand.name = 'rigDrillRearBand';
    rearBand.rotation.x = Math.PI / 2;
    rearBand.position.z = -0.02;
    rearBand.castShadow = true;

    const frontBand = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 20), bandMaterial);
    frontBand.name = 'rigDrillFrontBand';
    frontBand.rotation.x = Math.PI / 2;
    frontBand.position.z = 0.43;
    frontBand.castShadow = true;

    const spin = new THREE.Group();
    spin.name = 'rigDrillBitSpin';
    spin.position.z = 0.52;

    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.72, 24), bitMaterial);
    cone.name = 'rigDrillBitCone';
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 0.34;
    cone.castShadow = true;

    const ridgeMaterial = bitMaterial.clone();
    ridgeMaterial.name = 'material_rigDrillBitRidges';

    for (let i = 0; i < 3; i += 1) {
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.115 - i * 0.018, 0.012, 6, 18), ridgeMaterial);
      ridge.name = `rigDrillBitRidge_${i + 1}`;
      ridge.position.z = 0.06 + i * 0.16;
      ridge.rotation.z = i * 0.8;
      spin.add(ridge);
    }

    this.drillTip = new THREE.Group();
    this.drillTip.name = 'rigDrillTip';
    this.drillTip.position.z = 0.76;

    spin.add(cone, this.drillTip);
    group.add(rearBand, motor, frontBand, spin);
    elbow.add(group);

    this.drillArmGroup = group;
    this.drillBitSpin = spin;
    this._tintDrillArm();
    return true;
  }

  _createBeamBladeGroup() {
    const group = new THREE.Group();
    group.name = 'rigLaserBeamBlade';
    group.visible = false;

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: this.beamBladeColor,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    glowMaterial.name = 'material_rigLaserBeamBladeGlow';

    const coreMaterial = new THREE.MeshBasicMaterial({
      color: this.beamBladeColor,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    coreMaterial.name = 'material_rigLaserBeamBladeCore';

    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 1.35), glowMaterial);
    glow.name = 'rigLaserBeamBladeGlow';
    glow.position.z = 0.72;

    const core = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 1.28), coreMaterial);
    core.name = 'rigLaserBeamBladeCore';
    core.position.z = 0.7;

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 8), glowMaterial);
    tip.name = 'rigLaserBeamBladeTip';
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 1.45;

    group.add(glow, core, tip);
    return group;
  }

  _tintBeamBlade() {
    if (!this.beamBladeGroup) {
      return;
    }

    this.beamBladeGroup.traverse((object) => {
      if (object.material?.color) {
        object.material.color.copy(this.beamBladeColor);
      }
    });
  }

  _tintDrillArm() {
    if (!this.drillArmGroup) {
      return;
    }

    this.drillArmGroup.traverse((object) => {
      if (!object.material?.color) {
        return;
      }

      if (object.name.includes('DrillBit')) {
        object.material.color.copy(this.drillColor);
        if (object.material.emissive) {
          object.material.emissive.copy(this.drillColor);
          object.material.emissiveIntensity = 0.32;
        }
      }
    });
  }

  _updateDrillArmVisual(dt) {
    if (!this.drillArmGroup || !this.drillBitSpin) {
      return;
    }

    if (!this.drillArmActive) {
      this.drillArmGroup.visible = false;
      return;
    }

    this.drillArmGroup.visible = true;
    const spinSpeed = this.drillSpinning ? 38 : 2.8;
    this.drillBitSpin.rotation.z += dt * spinSpeed;
    const pulse = this.drillSpinning ? 1 + Math.sin(this.time * 48) * 0.035 : 1;
    this.drillBitSpin.scale.setScalar(pulse);
  }

  _updateBeamBladeVisual(visible, attackProgress) {
    if (!this.beamBladeGroup) {
      return;
    }

    const active = this.busterArmActive && this.beamBladeActive && visible;
    this.beamBladeGroup.visible = active;

    if (!active) {
      return;
    }

    const attackFrame = attackProgress * BEAM_BLADE_TOTAL_FRAMES;
    const charge = THREE.MathUtils.smoothstep(attackFrame, 6, 8) * (1 - THREE.MathUtils.smoothstep(attackFrame, 10, 12));
    const sweep = THREE.MathUtils.smoothstep(attackProgress, BEAM_BLADE_ACTIVE_START, BEAM_BLADE_SLASH_END);
    const strike = Math.sin(sweep * Math.PI);
    this.beamBladeGroup.scale.set(1 + charge * 0.08 + strike * 0.18, 1 + charge * 0.08 + strike * 0.18, 0.78 + charge * 0.12 + strike * 0.28);
    this.beamBladeGroup.rotation.z = Math.sin(this.time * 22) * 0.018 * charge + Math.sin(this.time * 30) * 0.025 * strike;
  }

  _updateBusterArmLocalPose(dt, state, attackKind, attackProgress) {
    if (!this.busterArmGroup) {
      return;
    }

    const attackFrame = attackProgress * BEAM_BLADE_TOTAL_FRAMES;
    const beginWindup = THREE.MathUtils.smoothstep(attackFrame, 0, 3);
    const chamber = THREE.MathUtils.smoothstep(attackFrame, 3, 6);
    const release = THREE.MathUtils.smoothstep(attackFrame, 10, 12);
    const slash = THREE.MathUtils.smoothstep(attackFrame, 12, 16);
    const recovery = THREE.MathUtils.smoothstep(attackFrame, 19, 24);
    const chamberHold = Math.max(beginWindup * 0.55, chamber) * (1 - release) * (1 - slash) * (1 - recovery);
    const alpha = Math.min(1, dt * 22);

    let targetX = 0;
    const targetY = -Math.PI / 2;
    let targetZ = 0;

    if (state === 'attacking' && attackKind === 'beamBlade') {
      targetX = 0.08 * chamberHold;
      targetZ = -0.04 * chamberHold;
    }

    this.busterArmGroup.rotation.x = THREE.MathUtils.lerp(this.busterArmGroup.rotation.x, targetX, alpha);
    this.busterArmGroup.rotation.y = THREE.MathUtils.lerp(this.busterArmGroup.rotation.y, targetY, alpha);
    this.busterArmGroup.rotation.z = THREE.MathUtils.lerp(this.busterArmGroup.rotation.z, targetZ, alpha);
  }

  _applyInverseRootScale(group) {
    this.root.getWorldScale(tempVectorB);
    group.scale.set(
      1 / Math.max(0.0001, tempVectorB.x),
      1 / Math.max(0.0001, tempVectorB.y),
      1 / Math.max(0.0001, tempVectorB.z),
    );
  }
}

export default SkeletalModelRig;
