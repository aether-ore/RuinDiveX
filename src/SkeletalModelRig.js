import * as THREE from 'three';

const DEFAULT_BEAM_BLADE_COLOR = 0xa8ff8a;
const BEAM_BLADE_TOTAL_FRAMES = 24;
const BEAM_BLADE_ACTIVE_START = 12 / BEAM_BLADE_TOTAL_FRAMES;
const BEAM_BLADE_SLASH_END = 16 / BEAM_BLADE_TOTAL_FRAMES;
const PASSIVE_IDLE_HOLD_SECONDS = 20;
const zeroEuler = new THREE.Euler();
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempVectorD = new THREE.Vector3();
const tempEuler = new THREE.Euler();
const tempQuaternionA = new THREE.Quaternion();
const tempQuaternionB = new THREE.Quaternion();
const tempQuaternionC = new THREE.Quaternion();
const localForwardZ = new THREE.Vector3(0, 0, 1);
const LEFT_BUSTER_ELBOW_JOINT = 'leftElbow';
const LEFT_BUSTER_WRIST_JOINT = 'leftWrist';
const LEFT_BUSTER_HAND_MESH_TOKEN = 'HandMesh_L';
const RIGHT_BUSTER_ELBOW_JOINT = 'rightElbow';
const RIGHT_BUSTER_WRIST_JOINT = 'rightWrist';
const RIGHT_BUSTER_HAND_MESH_TOKEN = 'HandMesh_R';
const DRILL_HAND_MESH_TOKEN = 'HandMesh_R';
const BUSTER_CHAMBER_ROLL_SIGN = -1;
const FREE_TURN_LOCOMOTION_THRESHOLD = 0.35;
// Keep the launch handoff soft without washing out the fall clip's wide arm swing.
const FORWARD_JUMP_PHASE_BLEND_SECONDS = 0.12;
const FORWARD_JUMP_FALL_TRANSITION_SPEED = 1.5;
const AIRBORNE_BUSTER_AIM_STATES = new Set([
  'neutralJump',
  'forwardJump',
  'forwardJumpFall',
  'fall',
]);
const GENERATED_POWER_KNOCKBACK_STATES = new Set([
  'knockbackLaunch',
  'aerialKnockbackFall',
  'backLanding',
  'downed',
]);
const LEFT_BUSTER_AIM_JOINTS = Object.freeze(['leftShoulder', 'leftElbow', 'leftWrist']);
const RIGHT_BUSTER_AIM_JOINTS = Object.freeze(['rightShoulder', 'rightElbow', 'rightWrist']);
const RIGHT_LEDGE_ARM_JOINTS = RIGHT_BUSTER_AIM_JOINTS;
const PISTOL_BUSTER_POSE_DEGREES = Object.freeze({
  leftElbow: Object.freeze({ pitch: -22.5, yaw: 1.5, roll: 111.5 }),
  leftWrist: Object.freeze({ pitch: 43, yaw: -7.5, roll: 4.5 }),
});
const MEGA_BUSTER_ACTION_IDLE_POSE_DEGREES = Object.freeze({
  hips: Object.freeze({ pitch: -6.2, yaw: -43, roll: -4 }),
  spine: Object.freeze({ pitch: 11.8, yaw: 9.1, roll: -2.7 }),
  neck: Object.freeze({ pitch: -4.2, yaw: -1.3, roll: 0.2 }),
  leftShoulder: Object.freeze({ pitch: 59, yaw: -22.5, roll: 102.5 }),
  leftElbow: Object.freeze({ pitch: 2.2, yaw: 2.6, roll: 1.5 }),
  leftWrist: Object.freeze({ pitch: -17.1, yaw: 14.9, roll: -1 }),
  rightShoulder: Object.freeze({ pitch: 50.6, yaw: 19.7, roll: 17.8 }),
  rightElbow: Object.freeze({ pitch: 11.2, yaw: 4, roll: -40 }),
  rightWrist: Object.freeze({ pitch: 15.5, yaw: -6.8, roll: -4.2 }),
  leftHip: Object.freeze({ pitch: 27.4, yaw: -8.8, roll: 4.1 }),
  leftKnee: Object.freeze({ pitch: -34.7, yaw: 15.7, roll: 1.1 }),
  leftAnkle: Object.freeze({ pitch: 3.8, yaw: 1.2, roll: 3 }),
  rightHip: Object.freeze({ pitch: 6.3, yaw: 14, roll: -4.9 }),
  rightKnee: Object.freeze({ pitch: -34, yaw: 7.7, roll: -0.4 }),
  rightAnkle: Object.freeze({ pitch: 19, yaw: 4.4, roll: -0.6 }),
});
const PASSIVE_IDLE_SHOULDER_JOINTS = Object.freeze(['leftShoulder', 'rightShoulder']);

const RIG_BONE_ALIASES = {
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

const LOOPING_CLIP_KEYS = new Set([
  'breathingIdle',
  'idle',
  'idle2',
  'idle3',
  'idle4',
  'idle5',
  'sideIdle',
  'walking',
  'strutWalking',
  'running',
  'leftStrafeWalking',
  'leftStrafe',
  'rightStrafeWalking',
  'rightStrafe',
  'slowJogBackwards',
  'fallingIdle',
  'crouchedSneakLeft',
  'crouchedSneakRight',
  'leftCoverSneak',
  'rightCoverSneak',
  'climbingLadder',
  'hangingIdle',
]);
const JUMP_ACTION_CLIP_KEYS = new Set([
  'jumpFromWall',
  'neutralJump',
  'forwardJumpLaunch',
  'forwardJumpFall',
  'jump',
  'jumpingUp',
  'pistolJump',
  'pistolJump2',
]);
const LEDGE_SYNC_CLIP_KEYS = new Set([
  'jumpingToHanging',
  'bracedToFreeHang',
  'freeHangToBraced',
  'hangingIdle',
  'ledgeClimbUp',
]);
const NEUTRAL_JUMP_LAUNCH_PROGRESS = 0.6;
const NEUTRAL_JUMP_LAUNCH_CLIP_PROGRESS = 0.42;
const FORWARD_JUMP_FALL_START_PROGRESS = 0.52;
const FOOT_VERTEX_WEIGHT_THRESHOLD = 0.08;
const BACK_VERTEX_WEIGHT_THRESHOLD = 0.12;
const BACK_CONTACT_JOINT_NAMES = Object.freeze(['hips', 'spine']);

function normalizeBoneName(name = '') {
  return String(name)
    .replace(/^mixamorig/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function getNeutralJumpClipProgress(progress = 0) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);

  if (p <= NEUTRAL_JUMP_LAUNCH_PROGRESS) {
    return THREE.MathUtils.smoothstep(p, 0, NEUTRAL_JUMP_LAUNCH_PROGRESS) * NEUTRAL_JUMP_LAUNCH_CLIP_PROGRESS;
  }

  const airborneProgress = THREE.MathUtils.clamp(
    (p - NEUTRAL_JUMP_LAUNCH_PROGRESS) / (1 - NEUTRAL_JUMP_LAUNCH_PROGRESS),
    0,
    1,
  );
  return THREE.MathUtils.lerp(NEUTRAL_JUMP_LAUNCH_CLIP_PROGRESS, 1, airborneProgress);
}

function getForwardJumpLaunchClipProgress(progress = 0) {
  return THREE.MathUtils.smoothstep(
    THREE.MathUtils.clamp(progress, 0, FORWARD_JUMP_FALL_START_PROGRESS),
    0,
    FORWARD_JUMP_FALL_START_PROGRESS,
  );
}

function getAttributeComponent(attribute, index, component) {
  if (!attribute || component >= attribute.itemSize) {
    return 0;
  }

  if (component === 0) return attribute.getX(index);
  if (component === 1) return attribute.getY(index);
  if (component === 2) return attribute.getZ(index);
  return attribute.getW(index);
}

function radiansToPoseDegrees(value) {
  return Number(THREE.MathUtils.radToDeg(value).toFixed(1));
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

export class SkeletalModelRig {
  constructor(sourceModel) {
    if (!sourceModel?.isObject3D) {
      throw new Error('SkeletalModelRig requires a loaded Object3D.');
    }

    this.root = sourceModel;
    this.root.name = this.root.name || 'playerMegaManVolnuttFbxRig';
    this.root.userData.externalModelRig = this;
    this.root.userData.animationSource = 'fbxClips';

    this.joints = new Map();
    this.restPositions = new Map();
    this.bonesByName = new Map();
    this.bones = [];
    this.skinnedMeshes = [];
    this.animatedBones = new Set();
    this.restLocalQuaternions = new Map();
    this.meshCount = 0;
    this.time = 0;
    this.busterArmGroup = null;
    this.busterMuzzle = null;
    this.busterNeutralQuaternion = new THREE.Quaternion();
    this.megaBusterArmGroup = null;
    this.megaBusterMuzzle = null;
    this.megaBusterNeutralQuaternion = new THREE.Quaternion();
    this.megaBusterArmActive = false;
    this.busterArmSide = 'left';
    this.megaBusterActionIdleShoulderLocalQuaternion = new THREE.Quaternion();
    this.megaBusterActionIdleArmAnchorReady = false;
    this.megaBusterArmWorldAnchorWasApplied = false;
    this.megaBusterActionIdlePoseWasApplied = false;
    this.busterAirAimPose = new Map();
    this.rightBusterAimPose = new Map();
    this.rightLedgeArmDownPose = new Map();
    this.busterMountedElbow = null;
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
    this.modelHeight = 1;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.animationClips = new Map();
    this.animationActions = new Map();
    this.animationMetadata = new Map();
    this.footVertexSamples = [];
    this.footVertexSampleCount = 0;
    this._lastFootGroundClearance = null;
    this.backVertexSamples = [];
    this.backVertexSampleCount = 0;
    this._lastBackGroundClearance = null;
    this.activeAction = null;
    this.activeClipKey = null;
    this.availableAnimationNames = [];
    this.usesFbxAnimationClips = true;
    this.previousRigState = 'idle';
    this.stateTime = 0;

    this._buildBoneMap();
    this._registerRigJoints();
    this._captureRestState();
    this._captureMegaBusterActionIdleArmAnchor();
    this._prepareSkinnedMeshes();
    this._buildFootVertexSamples();
    this._buildBackVertexSamples();
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

  getCurrentDebugPoseDegrees(jointNames = []) {
    const names = jointNames.length > 0 ? jointNames : [...this.joints.keys()];
    const poseDegrees = {};

    for (const jointName of names) {
      const joint = this.joints.get(jointName);
      if (!joint) {
        continue;
      }

      const rest = this.restLocalQuaternions.get(joint);
      if (rest) {
        tempQuaternionA.copy(rest).invert();
        tempQuaternionB.copy(tempQuaternionA).multiply(joint.quaternion);
        tempEuler.setFromQuaternion(tempQuaternionB, joint.rotation.order);
      } else {
        tempEuler.copy(joint.rotation);
      }

      poseDegrees[jointName] = {
        pitch: radiansToPoseDegrees(tempEuler.x),
        yaw: radiansToPoseDegrees(tempEuler.y),
        roll: radiansToPoseDegrees(tempEuler.z),
      };
    }

    return poseDegrees;
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
      this._applyDebugJointRotation(jointName, target, 1);
    }

    return true;
  }

  setBusterArm(busterObject) {
    const leftElbow = this.joints.get(LEFT_BUSTER_ELBOW_JOINT);
    const rightElbow = this.joints.get(RIGHT_BUSTER_ELBOW_JOINT);

    if (!leftElbow || !rightElbow || !busterObject?.isObject3D) {
      return false;
    }

    if (this.megaBusterArmGroup?.parent) {
      this.megaBusterArmGroup.parent.remove(this.megaBusterArmGroup);
    }
    if (this.busterArmGroup?.parent) {
      this.busterArmGroup.parent.remove(this.busterArmGroup);
    }

    this._scaleBusterToForearm(busterObject, 'left');
    const leftBusterObject = busterObject.clone(true);
    const leftMount = this._createBusterMount(leftBusterObject, 'left');
    const rightMount = this._createBusterMount(busterObject, 'right');

    if (!leftMount || !rightMount) {
      return false;
    }

    leftElbow.add(leftMount.group);
    rightElbow.add(rightMount.group);
    this.megaBusterArmGroup = leftMount.group;
    this.megaBusterMuzzle = leftMount.muzzle;
    this.megaBusterNeutralQuaternion.copy(leftMount.neutralQuaternion);
    this.busterArmGroup = rightMount.group;
    this.busterMuzzle = rightMount.muzzle;
    this.busterNeutralQuaternion.copy(rightMount.neutralQuaternion);
    this.busterMountedElbow = rightElbow;
    this.beamBladeGroup = this._createBeamBladeGroup();
    this.busterMuzzle.add(this.beamBladeGroup);
    this.setMegaBusterArmActive(this.megaBusterArmActive);
    this.setBusterArmActive(this.busterArmActive);
    this.setBeamBladeActive(this.beamBladeActive, this.beamBladeColor);
    return true;
  }

  _createBusterMount(busterObject, side) {
    const elbow = this.joints.get(side === 'left' ? LEFT_BUSTER_ELBOW_JOINT : RIGHT_BUSTER_ELBOW_JOINT);
    const wrist = this.joints.get(side === 'left' ? LEFT_BUSTER_WRIST_JOINT : RIGHT_BUSTER_WRIST_JOINT);
    if (!elbow || !wrist || !busterObject?.isObject3D) {
      return null;
    }

    busterObject.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(busterObject);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const group = new THREE.Group();
    const neutralQuaternion = this._createForearmAlignedQuaternion(elbow, wrist);

    group.name = side === 'left'
      ? 'rigSkeletalMegaBusterArmGroupLeft'
      : 'rigSkeletalSubweaponArmGroupRight';
    group.quaternion.copy(neutralQuaternion);
    group.userData.neutralLocalQuaternion = neutralQuaternion.clone();
    group.userData.armSide = side;
    this._applyInverseRootScale(group);
    busterObject.position.sub(new THREE.Vector3(center.x, center.y, bounds.min.z));

    const muzzle = new THREE.Group();
    muzzle.name = side === 'left'
      ? 'rigSkeletalMegaBusterMuzzleLeft'
      : 'rigSkeletalSubweaponMuzzleRight';
    muzzle.position.set(0, 0, size.z + size.z * 0.12);

    group.add(busterObject, muzzle);
    return { group, muzzle, neutralQuaternion };
  }

  _createForearmAlignedQuaternion(elbow, wrist) {
    if (!elbow || !wrist) {
      return new THREE.Quaternion();
    }

    elbow.updateMatrixWorld(true);
    wrist.updateMatrixWorld(true);
    wrist.getWorldPosition(tempVectorA);
    elbow.worldToLocal(tempVectorA);

    if (tempVectorA.lengthSq() <= 0.000001) {
      return new THREE.Quaternion();
    }

    return new THREE.Quaternion().setFromUnitVectors(localForwardZ, tempVectorA.normalize());
  }

  anchorHandsToWorldPositions({
    leftPosition = null,
    leftQuaternion = null,
    rightPosition = null,
    rightQuaternion = null,
    weight = 1,
  } = {}) {
    const blend = THREE.MathUtils.clamp(weight, 0, 1);
    if (blend <= 0) {
      return false;
    }

    let anchored = false;
    if (leftPosition) {
      anchored = this._solveArmToWorldTarget(
        'leftShoulder',
        'leftElbow',
        'leftWrist',
        leftPosition,
        leftQuaternion,
        blend,
      ) || anchored;
    }
    if (rightPosition) {
      anchored = this._solveArmToWorldTarget(
        'rightShoulder',
        'rightElbow',
        'rightWrist',
        rightPosition,
        rightQuaternion,
        blend,
      ) || anchored;
    }
    return anchored;
  }

  _solveArmToWorldTarget(shoulderName, elbowName, wristName, position, quaternion, weight) {
    const shoulder = this.joints.get(shoulderName);
    const elbow = this.joints.get(elbowName);
    const wrist = this.joints.get(wristName);
    if (!shoulder || !elbow || !wrist) {
      return false;
    }

    this.root.updateMatrixWorld(true);
    wrist.getWorldPosition(tempVectorC).lerp(position, weight);
    wrist.getWorldQuaternion(tempQuaternionC);
    if (quaternion) {
      tempQuaternionC.slerp(quaternion, weight);
    }

    for (let iteration = 0; iteration < 5; iteration += 1) {
      this._rotateJointTowardWorldTarget(elbow, wrist, tempVectorC);
      this._rotateJointTowardWorldTarget(shoulder, wrist, tempVectorC);
    }

    if (wrist.parent) {
      wrist.parent.getWorldQuaternion(tempQuaternionA).invert();
      wrist.quaternion.copy(tempQuaternionA.multiply(tempQuaternionC));
      this.root.updateMatrixWorld(true);
    }
    return true;
  }

  _rotateJointTowardWorldTarget(joint, endJoint, target) {
    this.root.updateMatrixWorld(true);
    joint.getWorldPosition(tempVectorA);
    endJoint.getWorldPosition(tempVectorB).sub(tempVectorA);
    tempVectorD.copy(target).sub(tempVectorA);
    if (tempVectorB.lengthSq() <= 0.000001 || tempVectorD.lengthSq() <= 0.000001) {
      return;
    }

    tempQuaternionA.setFromUnitVectors(tempVectorB.normalize(), tempVectorD.normalize());
    joint.getWorldQuaternion(tempQuaternionB);
    tempQuaternionA.multiply(tempQuaternionB);
    if (joint.parent) {
      joint.parent.getWorldQuaternion(tempQuaternionB).invert();
      joint.quaternion.copy(tempQuaternionB.multiply(tempQuaternionA));
    } else {
      joint.quaternion.copy(tempQuaternionA);
    }
    this.root.updateMatrixWorld(true);
  }

  _scaleBusterToForearm(busterObject, side = 'right') {
    const elbow = this.joints.get(side === 'left' ? LEFT_BUSTER_ELBOW_JOINT : RIGHT_BUSTER_ELBOW_JOINT);
    const wrist = this.joints.get(side === 'left' ? LEFT_BUSTER_WRIST_JOINT : RIGHT_BUSTER_WRIST_JOINT);

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

    this._syncArmReplacementVisibility();

    if (!this.busterArmActive && this.beamBladeGroup) {
      this.beamBladeGroup.visible = false;
    }
  }

  setMegaBusterArmActive(active) {
    this.megaBusterArmActive = Boolean(active && this.megaBusterArmGroup);

    if (this.megaBusterArmGroup) {
      this.megaBusterArmGroup.visible = this.megaBusterArmActive;
    }

    this._syncArmReplacementVisibility();
  }

  setBusterArmSide(side = 'left') {
    this.busterArmSide = side === 'right' ? 'right' : 'left';
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

    this._syncArmReplacementVisibility();

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

  getBusterMuzzleWorldPosition(target = new THREE.Vector3(), side = this.busterArmSide) {
    const useLeftMegaBuster = side !== 'right';
    const active = useLeftMegaBuster ? this.megaBusterArmActive : this.busterArmActive;
    const muzzle = useLeftMegaBuster ? this.megaBusterMuzzle : this.busterMuzzle;

    if (!active || !muzzle) {
      return null;
    }

    return muzzle.getWorldPosition(target);
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

  setAnimationClips(animationEntries = {}) {
    const entries = animationEntries instanceof Map
      ? [...animationEntries.entries()]
      : Object.entries(animationEntries);

    this.mixer.stopAllAction();
    this.animationClips.clear();
    this.animationActions.clear();
    this.animationMetadata.clear();
    this.availableAnimationNames = [];
    this.activeAction = null;
    this.activeClipKey = null;

    for (const [rawKey, rawEntry] of entries) {
      const key = this._normalizeClipKey(rawKey);
      const entry = rawEntry?.clip ? rawEntry : { clip: rawEntry };
      const clip = entry.clip;

      if (!key || !clip?.tracks?.length) {
        continue;
      }

      const rootMotion = entry.extractRootMotion
        ? this._createRootMotionData(clip)
        : null;
      const preparedClip = this._prepareAnimationClip(clip, key, {
        preserveRootMotion: Boolean(entry.preserveRootMotion),
        lockRootY: Boolean(entry.lockRootY),
      });
      const action = this.mixer.clipAction(preparedClip, this.root);
      const looping = entry.loop ?? LOOPING_CLIP_KEYS.has(key);

      action.enabled = true;
      action.clampWhenFinished = !looping;
      action.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
      action.setEffectiveWeight(0);
      action.setEffectiveTimeScale(1);

      this.animationClips.set(key, preparedClip);
      this.animationActions.set(key, action);
      this.animationMetadata.set(key, {
        ...entry,
        key,
        loop: looping,
        duration: preparedClip.duration,
        preserveRootMotion: Boolean(entry.preserveRootMotion),
        lockRootY: Boolean(entry.lockRootY),
        extractRootMotion: Boolean(entry.extractRootMotion),
        rootMotion,
      });
      this.availableAnimationNames.push(key);
    }

    this._normalizePassiveIdleShoulderTracks();
    this._captureBusterAirAimPose();

    const initialClip = this._firstAvailable('sideIdle', 'breathingIdle', 'idle', 'idle2', 'idle3', 'walking', 'running');
    if (initialClip) {
      this._fadeToClip(initialClip, 0);
    }

    this.root.userData.fbxAnimationClips = [...this.availableAnimationNames];
    return this.availableAnimationNames.length;
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
    turnAmount = 0,
    busterArmSide = this.busterArmSide,
    useRightArmForLedge = false,
    fallAnimationClipProgress = null,
    clipKey = null,
  } = {}) {
    this.setBusterArmSide(busterArmSide);
    this.time += dt;
    const rigState = [
      state,
      attackKind ?? '',
      moving ? 'moving' : 'still',
      projectileAiming ? 'aiming' : 'freeAim',
      lockOnActive ? 'lockOn' : 'freeLock',
      `buster:${this.busterArmSide}`,
      clipKey ? `clip:${clipKey}` : 'auto',
    ].join(':');
    if (rigState !== this.previousRigState) {
      this.previousRigState = rigState;
      this.stateTime = 0;
    } else {
      this.stateTime += dt;
    }

    // The Mega Buster firing layer is applied after the mixer so its arm can
    // remain steady over locomotion. Clear last frame's manual transforms
    // before evaluating the next clip; otherwise clips that do not key bone
    // positions (notably the dodge roll) inherit the counter-translated
    // shoulder and can pull the limb away from the body.
    this._restoreTemporaryMegaBusterPose();

    if (this.debugPoseEnabled) {
      this._applyDebugPoseOverridesImmediate();
      this._updateBusterArmLocalPose(dt, state, attackKind, attackProgress);
      this._updateDrillArmVisual(dt);
      this._updateBeamBladeVisual(state === 'attacking' && attackKind === 'beamBlade', attackProgress);
      return;
    }

    const selectedClip = this._selectAnimationClipKey({
      moving,
      moveAmount,
      state,
      actionProgress,
      hurtProgress,
      damageHitLocal,
      projectileAiming,
      backpedaling,
      running,
      attackKind,
      lockOnActive,
      strafeAmount,
      turnAmount,
      busterArmSide: this.busterArmSide,
      clipKey,
    });

    const forwardJumpPhaseChange = this.activeClipKey === 'forwardJumpLaunch'
      && selectedClip === 'forwardJumpFall';
    const fadeSeconds = selectedClip && LEDGE_SYNC_CLIP_KEYS.has(selectedClip)
      ? 0
      : forwardJumpPhaseChange
        ? FORWARD_JUMP_PHASE_BLEND_SECONDS
        : this.activeAction ? 0.16 : 0;
    this._fadeToClip(selectedClip, fadeSeconds);
    this._syncActiveActionSpeed(selectedClip, {
      state,
      moving,
      moveAmount,
      running,
      backpedaling,
      lockOnActive,
      turnAmount,
      attackProgress,
      actionProgress,
      fallAnimationClipProgress,
    });
    this.mixer.update(dt);
    if (this.busterArmSide === 'right') {
      this._applyPistolBusterPoseCorrection();
    }
    this._updateBusterArmLocalPose(dt, state, attackKind, attackProgress);
    this._updateDrillArmVisual(dt);
    this._updateBeamBladeVisual(state === 'attacking' && attackKind === 'beamBlade', attackProgress);
    const busterAimActive = projectileAiming || (lockOnActive && attackKind !== 'beamBlade');
    this._applyBusterAimPose(busterAimActive, state, moving);
    this._applyGeneratedPowerKnockbackPose(state, actionProgress ?? 0, dt);
    this._applyLedgeRightArmPose(state, useRightArmForLedge);
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

      this.bones.push(object);
      const key = normalizeBoneName(object.name);
      const bones = this.bonesByName.get(key);

      if (bones) {
        bones.push(object);
      } else {
        this.bonesByName.set(key, [object]);
      }
    });
  }

  _registerRigJoints() {
    for (const [jointName, aliases] of Object.entries(RIG_BONE_ALIASES)) {
      const bone = this._pickBone(aliases);
      if (!bone) {
        continue;
      }

      bone.userData.poseJointName = jointName;
      this.joints.set(jointName, bone);
    }

    for (const bone of this.bones) {
      if (bone) {
        this.animatedBones.add(bone);
      }
    }
  }

  _captureRestState() {
    this.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.root);
    this.modelHeight = bounds.getSize(tempVectorA).y || 1;
    this.root.userData.restLocalPosition = this.root.position.clone();

    for (const bone of this.animatedBones) {
      this.restLocalQuaternions.set(bone, bone.quaternion.clone());
      bone.userData.restLocalPosition = bone.position.clone();
      bone.userData.restWorldPosition = bone.getWorldPosition(new THREE.Vector3());
    }

    for (const [name, joint] of this.joints.entries()) {
      this.restPositions.set(name, joint.userData.restWorldPosition?.clone() ?? joint.getWorldPosition(new THREE.Vector3()));
    }
  }

  _resetAnimatedBonesToRestPose() {
    for (const bone of this.animatedBones) {
      const restQuaternion = this.restLocalQuaternions.get(bone);
      const restPosition = bone.userData?.restLocalPosition;
      if (restQuaternion) {
        bone.quaternion.copy(restQuaternion);
      }
      if (restPosition) {
        bone.position.copy(restPosition);
      }
    }
  }

  _restoreTemporaryMegaBusterPose() {
    if (!this.megaBusterActionIdlePoseWasApplied && !this.megaBusterArmWorldAnchorWasApplied) {
      return false;
    }

    if (this.megaBusterActionIdlePoseWasApplied) {
      this._resetAnimatedBonesToRestPose();
    } else if (this.megaBusterArmWorldAnchorWasApplied) {
      for (const jointName of LEFT_BUSTER_AIM_JOINTS) {
        const joint = this.joints.get(jointName);
        const restQuaternion = this.restLocalQuaternions.get(joint);
        const restPosition = joint?.userData?.restLocalPosition;
        if (restQuaternion) {
          joint.quaternion.copy(restQuaternion);
        }
        if (joint && restPosition) {
          joint.position.copy(restPosition);
        }
      }
    }

    this.megaBusterArmWorldAnchorWasApplied = false;
    this.megaBusterActionIdlePoseWasApplied = false;
    this.root.userData.megaBusterArmWorldAnchorActive = false;
    this.root.userData.megaBusterActionIdleActive = false;
    this.root.updateMatrixWorld(true);
    return true;
  }

  _applyRawLocalPoseDegrees(poseDegrees = {}, jointNames = Object.keys(poseDegrees)) {
    for (const jointName of jointNames) {
      const pose = poseDegrees[jointName];
      const joint = this.joints.get(jointName);
      if (!joint || !pose) {
        continue;
      }

      tempEuler.set(
        THREE.MathUtils.degToRad(pose.pitch),
        THREE.MathUtils.degToRad(pose.yaw),
        THREE.MathUtils.degToRad(pose.roll),
        joint.rotation.order,
      );
      this._applyBoneRotation(joint, tempEuler, 1);
    }
  }

  _captureMegaBusterActionIdleArmAnchor() {
    const shoulder = this.joints.get('leftShoulder');
    if (!shoulder) {
      return false;
    }

    const savedBones = [...this.animatedBones].map((bone) => ({
      bone,
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
    }));
    this._resetAnimatedBonesToRestPose();
    this._applyRawLocalPoseDegrees(MEGA_BUSTER_ACTION_IDLE_POSE_DEGREES);
    this.root.updateMatrixWorld(true);

    this.root.getWorldQuaternion(tempQuaternionA).invert();
    shoulder.getWorldQuaternion(tempQuaternionB);
    this.megaBusterActionIdleShoulderLocalQuaternion
      .copy(tempQuaternionA)
      .multiply(tempQuaternionB)
      .normalize();

    for (const saved of savedBones) {
      saved.bone.position.copy(saved.position);
      saved.bone.quaternion.copy(saved.quaternion);
    }
    this.root.updateMatrixWorld(true);
    this.megaBusterActionIdleArmAnchorReady = true;
    this.root.userData.megaBusterActionIdleArmAnchorReady = true;
    return true;
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

  _buildFootVertexSamples() {
    const leftFootBones = this._collectFootBoneSet('leftAnkle', 'left');
    const rightFootBones = this._collectFootBoneSet('rightAnkle', 'right');

    for (const mesh of this.skinnedMeshes) {
      const geometry = mesh.geometry;
      const position = geometry?.attributes?.position;
      const skinIndex = geometry?.attributes?.skinIndex;
      const skinWeight = geometry?.attributes?.skinWeight;
      const skeletonBones = mesh.skeleton?.bones;

      const canApplySkinning = typeof mesh.applyBoneTransform === 'function'
        || typeof mesh.boneTransform === 'function';

      if (!position || !skinIndex || !skinWeight || !skeletonBones?.length || !canApplySkinning) {
        continue;
      }

      const leftIndices = new Set();
      const rightIndices = new Set();
      for (let boneIndex = 0; boneIndex < skeletonBones.length; boneIndex += 1) {
        const bone = skeletonBones[boneIndex];
        const normalized = normalizeBoneName(bone?.name);

        if (leftFootBones.has(bone) || normalized.includes('leftfoot') || normalized.includes('lefttoe')) {
          leftIndices.add(boneIndex);
        }

        if (rightFootBones.has(bone) || normalized.includes('rightfoot') || normalized.includes('righttoe')) {
          rightIndices.add(boneIndex);
        }
      }

      if (!leftIndices.size && !rightIndices.size) {
        continue;
      }

      const leftVertexIndices = [];
      const rightVertexIndices = [];
      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
        let leftWeight = 0;
        let rightWeight = 0;

        for (let component = 0; component < skinIndex.itemSize; component += 1) {
          const boneIndex = getAttributeComponent(skinIndex, vertexIndex, component);
          const weight = getAttributeComponent(skinWeight, vertexIndex, component);

          if (leftIndices.has(boneIndex)) {
            leftWeight += weight;
          }

          if (rightIndices.has(boneIndex)) {
            rightWeight += weight;
          }
        }

        if (leftWeight >= FOOT_VERTEX_WEIGHT_THRESHOLD && leftWeight >= rightWeight) {
          leftVertexIndices.push(vertexIndex);
        } else if (rightWeight >= FOOT_VERTEX_WEIGHT_THRESHOLD) {
          rightVertexIndices.push(vertexIndex);
        }
      }

      if (leftVertexIndices.length) {
        this.footVertexSamples.push({ mesh, side: 'left', indices: leftVertexIndices });
        this.footVertexSampleCount += leftVertexIndices.length;
      }

      if (rightVertexIndices.length) {
        this.footVertexSamples.push({ mesh, side: 'right', indices: rightVertexIndices });
        this.footVertexSampleCount += rightVertexIndices.length;
      }
    }

    this.root.userData.footVertexSampleCount = this.footVertexSampleCount;
  }

  _collectFootBoneSet(jointName, side) {
    const bones = new Set();
    const joint = this.joints.get(jointName);

    if (joint) {
      joint.traverse((object) => {
        if (object.isBone) {
          bones.add(object);
        }
      });
    }

    const sidePrefix = side === 'left' ? 'left' : 'right';
    for (const bone of this.bones) {
      const normalized = normalizeBoneName(bone?.name);
      if (normalized.includes(`${sidePrefix}foot`) || normalized.includes(`${sidePrefix}toe`)) {
        bones.add(bone);
      }
    }

    return bones;
  }

  _buildBackVertexSamples() {
    const backBones = new Set(
      BACK_CONTACT_JOINT_NAMES
        .map((jointName) => this.joints.get(jointName))
        .filter(Boolean),
    );

    for (const mesh of this.skinnedMeshes) {
      const geometry = mesh.geometry;
      const position = geometry?.attributes?.position;
      const skinIndex = geometry?.attributes?.skinIndex;
      const skinWeight = geometry?.attributes?.skinWeight;
      const skeletonBones = mesh.skeleton?.bones;
      const canApplySkinning = typeof mesh.applyBoneTransform === 'function'
        || typeof mesh.boneTransform === 'function';

      if (!position || !skinIndex || !skinWeight || !skeletonBones?.length || !canApplySkinning) {
        continue;
      }

      const backBoneIndices = new Set();
      for (let boneIndex = 0; boneIndex < skeletonBones.length; boneIndex += 1) {
        const bone = skeletonBones[boneIndex];
        const normalized = normalizeBoneName(bone?.name);
        if (backBones.has(bone)
          || normalized === 'hips'
          || normalized.startsWith('spine')) {
          backBoneIndices.add(boneIndex);
        }
      }

      if (!backBoneIndices.size) {
        continue;
      }

      const vertexIndices = [];
      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
        let backWeight = 0;
        for (let component = 0; component < skinIndex.itemSize; component += 1) {
          const boneIndex = getAttributeComponent(skinIndex, vertexIndex, component);
          if (backBoneIndices.has(boneIndex)) {
            backWeight += getAttributeComponent(skinWeight, vertexIndex, component);
          }
        }

        if (backWeight >= BACK_VERTEX_WEIGHT_THRESHOLD) {
          vertexIndices.push(vertexIndex);
        }
      }

      if (vertexIndices.length) {
        this.backVertexSamples.push({ mesh, indices: vertexIndices });
        this.backVertexSampleCount += vertexIndices.length;
      }
    }

    this.root.userData.backVertexSampleCount = this.backVertexSampleCount;
  }

  measureFootGroundClearance(groundY = 0) {
    let leftMinY = Infinity;
    let rightMinY = Infinity;
    let source = 'skinnedFootVertices';

    this.root.updateMatrixWorld(true);

    for (const sample of this.footVertexSamples) {
      const position = sample.mesh.geometry?.attributes?.position;
      if (!position) {
        continue;
      }

      sample.mesh.updateMatrixWorld(true);

      for (const vertexIndex of sample.indices) {
        tempVectorA.fromBufferAttribute(position, vertexIndex);
        if (typeof sample.mesh.applyBoneTransform === 'function') {
          sample.mesh.applyBoneTransform(vertexIndex, tempVectorA);
        } else {
          sample.mesh.boneTransform(vertexIndex, tempVectorA);
        }
        sample.mesh.localToWorld(tempVectorA);

        if (sample.side === 'left') {
          leftMinY = Math.min(leftMinY, tempVectorA.y);
        } else {
          rightMinY = Math.min(rightMinY, tempVectorA.y);
        }
      }
    }

    if (!Number.isFinite(leftMinY) && !Number.isFinite(rightMinY)) {
      source = 'footBones';
      const leftAnkle = this.joints.get('leftAnkle');
      const rightAnkle = this.joints.get('rightAnkle');

      if (leftAnkle) {
        leftMinY = leftAnkle.getWorldPosition(tempVectorA).y;
      }

      if (rightAnkle) {
        rightMinY = rightAnkle.getWorldPosition(tempVectorA).y;
      }
    }

    const minY = Math.min(leftMinY, rightMinY);
    if (!Number.isFinite(minY)) {
      return null;
    }

    const result = {
      source,
      groundY,
      minY,
      leftY: Number.isFinite(leftMinY) ? leftMinY : null,
      rightY: Number.isFinite(rightMinY) ? rightMinY : null,
      clearance: minY - groundY,
      leftClearance: Number.isFinite(leftMinY) ? leftMinY - groundY : null,
      rightClearance: Number.isFinite(rightMinY) ? rightMinY - groundY : null,
      sampleCount: this.footVertexSampleCount,
    };

    this._lastFootGroundClearance = result;
    this.root.userData.footGroundClearance = result.clearance;
    this.root.userData.leftFootGroundClearance = result.leftClearance;
    this.root.userData.rightFootGroundClearance = result.rightClearance;
    this.root.userData.footGroundingSource = result.source;
    return result;
  }

  measureBackGroundClearance(groundY = 0) {
    let minY = Infinity;
    let source = 'skinnedBackVertices';

    this.root.updateMatrixWorld(true);

    for (const sample of this.backVertexSamples) {
      const position = sample.mesh.geometry?.attributes?.position;
      if (!position) {
        continue;
      }

      sample.mesh.updateMatrixWorld(true);
      for (const vertexIndex of sample.indices) {
        tempVectorA.fromBufferAttribute(position, vertexIndex);
        if (typeof sample.mesh.applyBoneTransform === 'function') {
          sample.mesh.applyBoneTransform(vertexIndex, tempVectorA);
        } else {
          sample.mesh.boneTransform(vertexIndex, tempVectorA);
        }
        sample.mesh.localToWorld(tempVectorA);
        minY = Math.min(minY, tempVectorA.y);
      }
    }

    if (!Number.isFinite(minY)) {
      source = 'backJoints';
      for (const jointName of BACK_CONTACT_JOINT_NAMES) {
        const joint = this.joints.get(jointName);
        if (joint) {
          minY = Math.min(minY, joint.getWorldPosition(tempVectorA).y);
        }
      }

      if (Number.isFinite(minY)) {
        minY -= Math.max(0.16, this.modelHeight * 0.085);
      }
    }

    if (!Number.isFinite(minY)) {
      return null;
    }

    const result = {
      source,
      groundY,
      minY,
      clearance: minY - groundY,
      sampleCount: this.backVertexSampleCount,
    };

    this._lastBackGroundClearance = result;
    this.root.userData.backGroundClearance = result.clearance;
    this.root.userData.backGroundingSource = result.source;
    return result;
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

  _createRootMotionData(clip) {
    let selected = null;
    let selectedDistanceSq = -1;

    for (const sourceTrack of clip?.tracks ?? []) {
      const trackName = this._retargetAnimationTrackName(sourceTrack.name);
      const property = trackName.slice(trackName.lastIndexOf('.') + 1);
      if (property !== 'position' || !this._isRootMotionTrack(trackName) || sourceTrack.values.length < 6) {
        continue;
      }

      const last = sourceTrack.values.length - 3;
      const deltaX = sourceTrack.values[last] - sourceTrack.values[0];
      const deltaY = sourceTrack.values[last + 1] - sourceTrack.values[1];
      const deltaZ = sourceTrack.values[last + 2] - sourceTrack.values[2];
      const distanceSq = (deltaX * deltaX) + (deltaY * deltaY) + (deltaZ * deltaZ);
      if (distanceSq <= selectedDistanceSq) {
        continue;
      }

      selectedDistanceSq = distanceSq;
      selected = {
        trackName,
        times: sourceTrack.times.slice(),
        values: sourceTrack.values.slice(),
        duration: Math.max(0.001, clip.duration),
        startX: sourceTrack.values[0],
        startY: sourceTrack.values[1],
        startZ: sourceTrack.values[2],
        totalX: deltaX,
        totalY: deltaY,
        totalZ: deltaZ,
        totalDistance: Math.sqrt(distanceSq),
      };
    }

    return selected;
  }

  sampleRootMotionProgress(key, progress = 0, target = {}) {
    const data = this.animationMetadata.get(this._normalizeClipKey(key))?.rootMotion;
    if (!data?.times?.length || !data?.values?.length) {
      return null;
    }

    const time = THREE.MathUtils.clamp(progress, 0, 1) * data.duration;
    let upperIndex = data.times.length - 1;
    for (let index = 1; index < data.times.length; index += 1) {
      if (data.times[index] >= time) {
        upperIndex = index;
        break;
      }
    }
    const lowerIndex = Math.max(0, upperIndex - 1);
    const lowerTime = data.times[lowerIndex];
    const upperTime = data.times[upperIndex];
    const alpha = upperTime > lowerTime
      ? THREE.MathUtils.clamp((time - lowerTime) / (upperTime - lowerTime), 0, 1)
      : 0;
    const lowerOffset = lowerIndex * 3;
    const upperOffset = upperIndex * 3;
    const sampleX = THREE.MathUtils.lerp(data.values[lowerOffset], data.values[upperOffset], alpha);
    const sampleY = THREE.MathUtils.lerp(data.values[lowerOffset + 1], data.values[upperOffset + 1], alpha);
    const sampleZ = THREE.MathUtils.lerp(data.values[lowerOffset + 2], data.values[upperOffset + 2], alpha);
    const deltaX = sampleX - data.startX;
    const deltaY = sampleY - data.startY;
    const deltaZ = sampleZ - data.startZ;
    const totalDistanceSq = (data.totalX * data.totalX)
      + (data.totalY * data.totalY)
      + (data.totalZ * data.totalZ);
    const overall = totalDistanceSq > 0.000001
      ? ((deltaX * data.totalX) + (deltaY * data.totalY) + (deltaZ * data.totalZ)) / totalDistanceSq
      : progress;
    const horizontalDistanceSq = (data.totalX * data.totalX) + (data.totalZ * data.totalZ);
    const horizontal = horizontalDistanceSq > 0.000001
      ? ((deltaX * data.totalX) + (deltaZ * data.totalZ)) / horizontalDistanceSq
      : overall;
    const vertical = Math.abs(data.totalY) > 0.000001
      ? deltaY / data.totalY
      : overall;

    target.horizontal = THREE.MathUtils.clamp(horizontal, 0, 1);
    target.vertical = THREE.MathUtils.clamp(vertical, 0, 1);
    target.overall = THREE.MathUtils.clamp(overall, 0, 1);
    return target;
  }

  _prepareAnimationClip(clip, key, { preserveRootMotion = false, lockRootY = false } = {}) {
    const lockRootYToRest = key === 'forwardJumpLaunch'
      || key === 'forwardJumpFall'
      || key === 'forwardJumpLanding';
    const tracks = clip.tracks
      .map((track) => this._prepareAnimationTrack(track, { preserveRootMotion, lockRootY, lockRootYToRest }))
      .filter(Boolean);
    const preparedClip = new THREE.AnimationClip(key, clip.duration, tracks);
    preparedClip.name = key;
    return preparedClip;
  }

  _prepareAnimationTrack(track, { preserveRootMotion = false, lockRootY = false, lockRootYToRest = false } = {}) {
    const trackName = this._retargetAnimationTrackName(track.name);
    const property = trackName.slice(trackName.lastIndexOf('.') + 1);
    const rootPositionTrack = property === 'position' && this._isRootMotionTrack(trackName);
    const preservesRootMotion = preserveRootMotion && rootPositionTrack;

    if (!rootPositionTrack || preservesRootMotion) {
      const clonedTrack = track.clone();
      clonedTrack.name = trackName;
      return clonedTrack;
    }

    const values = track.values.slice();
    const restPosition = this._getTrackRestLocalPosition(trackName);
    const baseX = restPosition?.x ?? values[0] ?? 0;
    const baseY = lockRootYToRest ? (restPosition?.y ?? values[1] ?? 0) : (values[1] ?? 0);
    const baseZ = restPosition?.z ?? values[2] ?? 0;

    for (let index = 0; index < values.length; index += 3) {
      values[index] = baseX;
      if (lockRootY) {
        values[index + 1] = baseY;
      }
      values[index + 2] = baseZ;
    }

    return new THREE.VectorKeyframeTrack(
      trackName,
      track.times.slice(),
      values,
      track.getInterpolation(),
    );
  }

  _getTrackRestLocalPosition(trackName = '') {
    const targetName = this._getTrackTargetName(trackName);
    const normalized = normalizeBoneName(targetName);
    const candidates = this.bonesByName.get(normalized);

    if (candidates?.length) {
      const bone = candidates
        .slice()
        .sort((a, b) => this._scoreBoneCandidate(b) - this._scoreBoneCandidate(a))[0];
      return bone?.userData?.restLocalPosition ?? null;
    }

    if (normalized === normalizeBoneName(this.root.name) || normalized.includes('armature')) {
      return this.root.userData?.restLocalPosition ?? null;
    }

    const targetObject = this.root.getObjectByName?.(targetName);
    return targetObject?.userData?.restLocalPosition ?? null;
  }

  _normalizePassiveIdleShoulderTracks() {
    const alertReference = this._firstAvailable('sideIdle', 'idle', 'idle2', 'idle3', 'idle4', 'idle5');
    const neutralReference = this._firstAvailable('breathingIdle', 'warriorIdle');

    this._normalizeShoulderTracksToReference(
      alertReference,
      ['sideIdle', 'idle', 'idle2', 'idle3', 'idle4', 'idle5'],
    );
    this._normalizeShoulderTracksToReference(neutralReference, ['breathingIdle', 'warriorIdle']);

    this.root.userData.passiveIdleShoulderNormalization = {
      alertReference,
      neutralReference,
    };
  }

  _captureBusterAirAimPose() {
    this.busterAirAimPose.clear();
    this.rightBusterAimPose.clear();
    this.rightLedgeArmDownPose.clear();
    const clip = this.animationClips.get('pistolIdle') ?? this.animationClips.get('pistolJump');
    if (!clip) {
      return;
    }

    const sampleTime = Math.min(Math.max(0, clip.duration * 0.25), 0.25);
    for (let index = 0; index < RIGHT_BUSTER_AIM_JOINTS.length; index += 1) {
      const rightJointName = RIGHT_BUSTER_AIM_JOINTS[index];
      const leftJointName = LEFT_BUSTER_AIM_JOINTS[index];
      const track = this._findJointQuaternionTrack(clip, rightJointName);
      if (!track?.values || track.values.length < 4) {
        continue;
      }

      const sampled = track.createInterpolant(new Float32Array(4)).evaluate(sampleTime);
      const rightQuaternion = new THREE.Quaternion().fromArray(sampled).normalize();
      this.rightBusterAimPose.set(rightJointName, rightQuaternion);
      this.busterAirAimPose.set(leftJointName, new THREE.Quaternion(
        rightQuaternion.x,
        -rightQuaternion.y,
        -rightQuaternion.z,
        rightQuaternion.w,
      ).normalize());
    }

    const relaxedClip = this.animationClips.get('breathingIdle')
      ?? this.animationClips.get('sideIdle')
      ?? this.animationClips.get('idle');
    if (relaxedClip) {
      const relaxedSampleTime = Math.min(Math.max(0, relaxedClip.duration * 0.2), 0.2);
      for (const jointName of RIGHT_LEDGE_ARM_JOINTS) {
        const track = this._findJointQuaternionTrack(relaxedClip, jointName);
        if (!track?.values || track.values.length < 4) {
          continue;
        }
        const sampled = track.createInterpolant(new Float32Array(4)).evaluate(relaxedSampleTime);
        this.rightLedgeArmDownPose.set(
          jointName,
          new THREE.Quaternion().fromArray(sampled).normalize(),
        );
      }
    }
    this.root.userData.busterAirAimPoseJointCount = this.busterAirAimPose.size;
    this.root.userData.rightBusterAimPoseJointCount = this.rightBusterAimPose.size;
    this.root.userData.rightLedgeArmDownPoseJointCount = this.rightLedgeArmDownPose.size;
  }

  _normalizeShoulderTracksToReference(referenceKey, clipKeys = []) {
    const referenceClip = this.animationClips.get(referenceKey);

    if (!referenceClip) {
      return;
    }

    for (const jointName of PASSIVE_IDLE_SHOULDER_JOINTS) {
      const referenceTrack = this._findJointQuaternionTrack(referenceClip, jointName);

      if (!referenceTrack?.values || referenceTrack.values.length < 4) {
        continue;
      }

      const referenceQuaternion = new THREE.Quaternion().fromArray(referenceTrack.values, 0).normalize();

      for (const key of clipKeys) {
        const targetClip = this.animationClips.get(key);
        const targetTrack = targetClip ? this._findJointQuaternionTrack(targetClip, jointName) : null;

        if (!targetTrack?.values || targetTrack.values.length < 4) {
          continue;
        }

        const sourceQuaternion = new THREE.Quaternion().fromArray(targetTrack.values, 0).normalize();
        const correction = referenceQuaternion.clone().multiply(sourceQuaternion.clone().invert());
        const adjusted = new THREE.Quaternion();

        for (let index = 0; index < targetTrack.values.length; index += 4) {
          adjusted.fromArray(targetTrack.values, index).normalize();
          adjusted.premultiply(correction).normalize();
          adjusted.toArray(targetTrack.values, index);
        }
      }
    }
  }

  _findJointQuaternionTrack(clip, jointName) {
    const joint = this.joints.get(jointName);

    if (!joint) {
      return null;
    }

    const normalizedJointName = normalizeBoneName(joint.name);
    return clip.tracks.find((track) => track.name.endsWith('.quaternion')
      && normalizeBoneName(this._getTrackTargetName(track.name)) === normalizedJointName) ?? null;
  }

  _retargetAnimationTrackName(trackName = '') {
    const targetName = this._getTrackTargetName(trackName);
    const normalized = normalizeBoneName(targetName);
    const candidates = this.bonesByName.get(normalized);

    if (!candidates?.length) {
      return trackName;
    }

    const bone = candidates
      .slice()
      .sort((a, b) => this._scoreBoneCandidate(b) - this._scoreBoneCandidate(a))[0];

    if (!bone?.name || bone.name === targetName) {
      return trackName;
    }

    if (trackName.includes(`[${targetName}]`)) {
      return trackName.replace(`[${targetName}]`, `[${bone.name}]`);
    }

    return trackName.replace(targetName, bone.name);
  }

  _isRootMotionTrack(trackName = '') {
    const targetName = this._getTrackTargetName(trackName);
    const normalized = normalizeBoneName(targetName);

    return normalized === 'hips'
      || normalized === normalizeBoneName(this.root.name)
      || normalized.includes('armature');
  }

  _getTrackTargetName(trackName = '') {
    const propertyIndex = trackName.lastIndexOf('.');
    const targetPath = propertyIndex >= 0 ? trackName.slice(0, propertyIndex) : trackName;
    const bracketMatch = targetPath.match(/\[([^\]]+)\]$/);

    if (bracketMatch) {
      return bracketMatch[1];
    }

    const slashParts = targetPath.split('/');
    return slashParts[slashParts.length - 1] ?? targetPath;
  }

  _normalizeClipKey(key) {
    const text = String(key ?? '').trim();
    if (!text) {
      return null;
    }

    const compact = text.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const aliases = {
      climbingladder: 'climbingLadder',
      covertostand: 'coverToStand',
      covertostand2: 'coverToStand2',
      crouchedsneakingleft: 'crouchedSneakLeft',
      crouchedsneakingright: 'crouchedSneakRight',
      crouchedsneakleft: 'crouchedSneakLeft',
      crouchedsneakright: 'crouchedSneakRight',
      fallingidle: 'fallingIdle',
      fallingtolanding: 'fallingToLanding',
      forwardjumplaunch: 'forwardJumpLaunch',
      jumpattacklaunch: 'forwardJumpLaunch',
      forwardjumpfall: 'forwardJumpFall',
      jumpattackfall: 'forwardJumpFall',
      forwardjumplanding: 'forwardJumpLanding',
      jumpattacklanding: 'forwardJumpLanding',
      fallingtoroll: 'fallingToRoll',
      hangingidle: 'hangingIdle',
      jumpingtohanging: 'jumpingToHanging',
      jumpfromwall: 'jumpFromWall',
      bracedtofreehang: 'bracedToFreeHang',
      freehangtobraced: 'freeHangToBraced',
      ledgeclimbup: 'ledgeClimbUp',
      dodgeroll: 'dodgeRoll',
      standingdiveforward: 'dodgeRoll',
      standingdive: 'dodgeRoll',
      diveforward: 'dodgeRoll',
      roll: 'dodgeRoll',
      hardlanding: 'hardLanding',
      breathingidle: 'breathingIdle',
      breathidle: 'breathingIdle',
      defaultidle: 'breathingIdle',
      idle: 'idle',
      lookaround: 'idle',
      lookaroundidle: 'idle',
      waitingidle: 'idle',
      idle2: 'idle2',
      idle3: 'idle3',
      idle4: 'idle4',
      idle5: 'idle5',
      sideidle: 'sideIdle',
      sideidling: 'sideIdle',
      sidewaitingidle: 'sideIdle',
      warrioridle: 'warriorIdle',
      armstretch: 'warriorIdle',
      stretchidle: 'warriorIdle',
      beambladeslash: 'swordInwardSlash',
      stableinwardslash: 'swordInwardSlash',
      stableswordinwardslash: 'swordInwardSlash',
      swordarmslash: 'swordInwardSlash',
      swordinwardslash: 'swordInwardSlash',
      swordslash: 'swordInwardSlash',
      neutraljump: 'forwardJumpLaunch',
      jump: 'jump',
      jumpingup: 'jumpingUp',
      leftcoversneak: 'leftCoverSneak',
      leftstrafe: 'leftStrafe',
      leftstrafewalking: 'leftStrafeWalking',
      leftsidestep: 'leftStrafe',
      leftsidestepwalking: 'leftStrafeWalking',
      leftturn: 'leftTurn',
      leftturn90: 'leftTurn90',
      pistolaim: 'pistolIdle',
      pistolbusteridle: 'pistolIdle',
      pistolidle: 'pistolIdle',
      pistoljump: 'pistolJump',
      pistoljump2: 'pistolJump2',
      pistolkneeltostand: 'pistolKneelToStand',
      pistolkneelingidle: 'pistolKneelingIdle',
      pistolrun: 'pistolRun',
      pistolrunarc: 'pistolRunArc',
      pistolrunarc2: 'pistolRunArc2',
      pistolrunbackward: 'pistolRunBackward',
      pistolrunbackwardarc: 'pistolRunBackwardArc',
      pistolrunbackwardarc2: 'pistolRunBackwardArc2',
      pistolstandtokneel: 'pistolStandToKneel',
      pistolstrafe: 'pistolStrafe',
      pistolstrafe2: 'pistolStrafe2',
      pistolwalk: 'pistolWalk',
      pistolwalkarc: 'pistolWalkArc',
      pistolwalkarc2: 'pistolWalkArc2',
      pistolwalkbackward: 'pistolWalkBackward',
      pistolwalkbackwardarc: 'pistolWalkBackwardArc',
      pistolwalkbackwardarc2: 'pistolWalkBackwardArc2',
      rightcoversneak: 'rightCoverSneak',
      rightstrafe: 'rightStrafe',
      rightstrafewalking: 'rightStrafeWalking',
      rightsidestep: 'rightStrafe',
      rightsidestepwalking: 'rightStrafeWalking',
      rightturn: 'rightTurn',
      rightturn90: 'rightTurn90',
      runtostop: 'runToStop',
      running: 'running',
      slowjogbackwards: 'slowJogBackwards',
      standtocover: 'standToCover',
      standtocover2: 'standToCover2',
      strutwalking: 'strutWalking',
      walking: 'walking',
      walk: 'walking',
      jog: 'running',
      run: 'running',
      sprint: 'running',
      backpedal: 'slowJogBackwards',
    };

    return aliases[compact] ?? text;
  }

  _firstAvailable(...keys) {
    for (const key of keys.map((entry) => this._normalizeClipKey(entry))) {
      if (key && this.animationActions.has(key)) {
        return key;
      }
    }

    return null;
  }

  _selectAnimationClipKey({
    moving = false,
    moveAmount = 0,
    state = 'idle',
    projectileAiming = false,
    backpedaling = false,
    running = false,
    attackKind = 'melee',
    lockOnActive = false,
    strafeAmount = 0,
    turnAmount = 0,
    busterArmSide = this.busterArmSide,
    clipKey = null,
  } = {}) {
    const forcedClip = this._normalizeClipKey(clipKey);
    if (forcedClip && this.animationActions.has(forcedClip)) {
      return forcedClip;
    }

    const busterAimActive = projectileAiming || (lockOnActive && attackKind !== 'beamBlade');
    const useRightBusterClips = busterAimActive && busterArmSide === 'right';

    if (state === 'attacking' && attackKind === 'beamBlade') {
      return this._firstAvailable('swordInwardSlash', 'walking', 'strutWalking', 'breathingIdle', 'idle');
    }

    if (state === 'neutralJump') {
      return useRightBusterClips
        ? this._firstAvailable('forwardJumpLaunch', 'pistolJump', 'pistolJump2', 'jump', 'jumpingUp', 'fallingIdle', 'pistolIdle', 'breathingIdle', 'idle')
        : this._firstAvailable('forwardJumpLaunch', 'jump', 'jumpingUp', 'fallingIdle', 'breathingIdle', 'idle');
    }

    if (state === 'forwardJump') {
      return useRightBusterClips
        ? this._firstAvailable('forwardJumpLaunch', 'pistolJump', 'pistolJump2', 'neutralJump', 'jump', 'jumpingUp', 'fallingIdle', 'pistolIdle', 'breathingIdle', 'idle')
        : this._firstAvailable('forwardJumpLaunch', 'jump', 'neutralJump', 'jumpingUp', 'fallingIdle', 'breathingIdle', 'idle');
    }

    if (state === 'forwardJumpFall') {
      return useRightBusterClips
        ? this._firstAvailable('forwardJumpFall', 'fallingIdle', 'pistolJump2', 'pistolJump', 'jump', 'jumpingUp', 'pistolIdle', 'breathingIdle', 'idle')
        : this._firstAvailable('forwardJumpFall', 'fallingIdle', 'jump', 'jumpingUp', 'breathingIdle', 'idle');
    }

    if (state === 'fall') {
      return useRightBusterClips
        ? this._firstAvailable('fallingIdle', 'pistolJump2', 'pistolJump', 'jump', 'jumpingUp', 'pistolIdle', 'breathingIdle', 'idle')
        : this._firstAvailable('fallingIdle', 'jump', 'jumpingUp', 'breathingIdle', 'idle');
    }

    if (state === 'wallJump') {
      return this._firstAvailable('jumpFromWall', 'forwardJumpLaunch', 'jump', 'fallingIdle', 'breathingIdle', 'idle');
    }

    if (state === 'land') {
      return this._firstAvailable('fallingToLanding', 'hardLanding', 'breathingIdle', 'idle');
    }

    if (state === 'jumpingToHanging') {
      return this._firstAvailable('jumpingToHanging', 'hangingIdle', 'breathingIdle', 'idle');
    }

    if (state === 'settlingToFreeHang') {
      return this._firstAvailable('bracedToFreeHang', 'hangingIdle', 'breathingIdle', 'idle');
    }

    if (state === 'hangingIdle') {
      return this._firstAvailable('hangingIdle', 'breathingIdle', 'idle');
    }

    if (state === 'preparingToClimb') {
      return this._firstAvailable('freeHangToBraced', 'hangingIdle', 'breathingIdle', 'idle');
    }

    if (state === 'climbingUp') {
      return this._firstAvailable('ledgeClimbUp', 'hardLanding', 'breathingIdle', 'idle');
    }

    if (state === 'dodgeRoll') {
      return this._firstAvailable('dodgeRoll', 'fallingToRoll', 'hardLanding', 'running', 'breathingIdle', 'idle');
    }

    if (state === 'knockbackFall'
      || state === 'knockbackLaunch'
      || state === 'aerialKnockbackFall') {
      return this._firstAvailable('fallingIdle', 'fallingToRoll', 'hardLanding', 'breathingIdle', 'idle');
    }

    if (state === 'lyingFlat') {
      return this._firstAvailable('lyingFlat', 'fallingIdle', 'hardLanding', 'breathingIdle', 'idle');
    }

    if (state === 'backLanding' || state === 'downed') {
      return this._firstAvailable('fallingIdle', 'hardLanding', 'fallingToRoll', 'breathingIdle', 'idle');
    }

    if (state === 'getUp') {
      return this._firstAvailable('coverToStand', 'coverToStand2', 'hardLanding', 'breathingIdle', 'idle');
    }

    const useLeftBusterLayer = busterAimActive && busterArmSide === 'left';
    if (useLeftBusterLayer && !moving && state !== 'walking' && state !== 'running') {
      return this._firstAvailable('breathingIdle', 'sideIdle', 'idle', 'idle2');
    }

    const isAttackingWithoutAuthoredClip = state === 'attacking'
      && (attackKind === 'beamBlade' || attackKind === 'melee' || projectileAiming);
    const shouldUseLocomotion = moving || state === 'walking' || state === 'running' || isAttackingWithoutAuthoredClip;

    if (useRightBusterClips) {
      if (!moving && state !== 'walking' && state !== 'running') {
        return this._firstAvailable('pistolIdle', 'breathingIdle', 'idle', 'idle2', 'walking');
      }

      if (shouldUseLocomotion) {
        if (backpedaling) {
          if (lockOnActive && Math.abs(strafeAmount) > 0.35) {
            return strafeAmount < 0
              ? this._firstAvailable('pistolWalkBackwardArc', 'pistolRunBackwardArc', 'pistolWalkBackward', 'pistolRunBackward', 'slowJogBackwards', 'walking', 'pistolIdle', 'breathingIdle', 'idle')
              : this._firstAvailable('pistolWalkBackwardArc2', 'pistolRunBackwardArc2', 'pistolWalkBackward', 'pistolRunBackward', 'slowJogBackwards', 'walking', 'pistolIdle', 'breathingIdle', 'idle');
          }

          return running || moveAmount > 1.1
            ? this._firstAvailable('pistolRunBackward', 'pistolWalkBackward', 'slowJogBackwards', 'walking', 'pistolIdle', 'breathingIdle', 'idle')
            : this._firstAvailable('pistolWalkBackward', 'pistolRunBackward', 'slowJogBackwards', 'walking', 'pistolIdle', 'breathingIdle', 'idle');
        }

        if (lockOnActive && Math.abs(strafeAmount) > 0.35) {
          return strafeAmount < 0
            ? this._firstAvailable('pistolStrafe', 'pistolWalkArc', 'pistolRunArc', 'leftStrafeWalking', 'leftStrafe', 'pistolWalk', 'walking', 'pistolIdle', 'breathingIdle', 'idle')
            : this._firstAvailable('pistolStrafe2', 'pistolWalkArc2', 'pistolRunArc2', 'rightStrafeWalking', 'rightStrafe', 'pistolWalk', 'walking', 'pistolIdle', 'breathingIdle', 'idle');
        }

        if (running || state === 'running' || moveAmount > 1.1) {
          return this._firstAvailable('pistolRun', 'pistolWalk', 'running', 'strutWalking', 'walking', 'pistolIdle', 'breathingIdle', 'idle');
        }

        return this._firstAvailable('pistolWalk', 'pistolRun', 'walking', 'strutWalking', 'running', 'pistolIdle', 'breathingIdle', 'idle');
      }

      return this._firstAvailable('pistolIdle', 'breathingIdle', 'idle', 'idle2', 'walking');
    }

    if (shouldUseLocomotion) {
      if (backpedaling) {
        return this._firstAvailable('slowJogBackwards', 'walking', 'strutWalking', 'breathingIdle', 'idle');
      }

      if (!lockOnActive && Math.abs(turnAmount) > FREE_TURN_LOCOMOTION_THRESHOLD) {
        return turnAmount < 0
          ? this._firstAvailable('leftTurn', 'leftTurn90', 'walking', 'strutWalking', 'running', 'breathingIdle', 'idle')
          : this._firstAvailable('rightTurn', 'rightTurn90', 'walking', 'strutWalking', 'running', 'breathingIdle', 'idle');
      }

      if (lockOnActive && Math.abs(strafeAmount) > 0.35) {
        return strafeAmount < 0
          ? this._firstAvailable('leftStrafeWalking', 'leftStrafe', 'leftCoverSneak', 'crouchedSneakLeft', 'leftTurn90', 'leftTurn', 'walking', 'breathingIdle', 'idle')
          : this._firstAvailable('rightStrafeWalking', 'rightStrafe', 'rightCoverSneak', 'crouchedSneakRight', 'rightTurn90', 'rightTurn', 'walking', 'breathingIdle', 'idle');
      }

      if (running || state === 'running' || moveAmount > 1.1) {
        return this._firstAvailable('running', 'strutWalking', 'walking', 'breathingIdle', 'idle');
      }

      return this._firstAvailable('walking', 'strutWalking', 'running', 'breathingIdle', 'idle');
    }

    return this._selectPassiveIdleClipKey();
  }

  _selectPassiveIdleClipKey() {
    const sideIdleClip = this._firstAvailable('sideIdle', 'breathingIdle', 'idle', 'walking');
    const lookAroundClip = this._firstAvailable('idle', 'idle2', 'idle3', 'idle4', 'idle5', 'sideIdle', 'breathingIdle', 'walking');
    const breathingClip = this._firstAvailable('breathingIdle', 'sideIdle', 'idle', 'walking');
    const warriorClip = this._firstAvailable('warriorIdle', 'breathingIdle', 'sideIdle', 'idle', 'walking');

    if (this.stateTime < PASSIVE_IDLE_HOLD_SECONDS) {
      return sideIdleClip ?? breathingClip ?? lookAroundClip ?? warriorClip;
    }

    const afterSideIdleTime = this.stateTime - PASSIVE_IDLE_HOLD_SECONDS;

    if (lookAroundClip && lookAroundClip !== sideIdleClip) {
      const lookAroundDuration = this._clipDuration(lookAroundClip);

      if (afterSideIdleTime < lookAroundDuration) {
        return lookAroundClip;
      }

      return this._selectNeutralIdleCycleClip(
        afterSideIdleTime - lookAroundDuration,
        breathingClip,
        warriorClip,
      );
    }

    return this._selectNeutralIdleCycleClip(afterSideIdleTime, breathingClip ?? sideIdleClip, warriorClip);
  }

  _selectNeutralIdleCycleClip(neutralTime, breathingClip, warriorClip) {
    if (!breathingClip) {
      return warriorClip ?? this._firstAvailable('sideIdle', 'idle', 'walking');
    }

    if (!warriorClip || warriorClip === breathingClip) {
      return breathingClip;
    }

    if (neutralTime < PASSIVE_IDLE_HOLD_SECONDS) {
      return breathingClip;
    }

    const warriorDuration = this._clipDuration(warriorClip);
    const cycleTime = (neutralTime - PASSIVE_IDLE_HOLD_SECONDS) % (warriorDuration + PASSIVE_IDLE_HOLD_SECONDS);
    return cycleTime < warriorDuration ? warriorClip : breathingClip;
  }

  _clipDuration(key) {
    return Math.max(0.1, this.animationMetadata.get(key)?.duration ?? 0);
  }

  hasAnimationClipFinished(key) {
    return this.activeClipKey === key
      && Boolean(this.activeAction)
      && this.activeAction.time >= this._clipDuration(key) - 0.001;
  }

  _fadeToClip(key, fadeSeconds = 0.16) {
    if (!key) {
      return false;
    }

    const action = this.animationActions.get(key);
    if (!action) {
      return false;
    }

    if (this.activeAction === action) {
      return true;
    }

    const previousAction = this.activeAction;
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();

    if (previousAction) {
      if (fadeSeconds > 0) {
        previousAction.crossFadeTo(action, fadeSeconds, false);
      } else {
        previousAction.stop();
      }
    }

    this.activeAction = action;
    this.activeClipKey = key;
    this.root.userData.activeFbxAnimationClip = key;
    this.root.userData.lastFbxAnimationFadeSeconds = fadeSeconds;
    this.root.userData.lastFbxAnimationTransition = previousAction
      ? `${previousAction.getClip?.()?.name ?? 'unknown'}->${key}`
      : `none->${key}`;
    return true;
  }

  _syncActiveActionSpeed(key, {
    state = 'idle',
    moving = false,
    moveAmount = 0,
    running = false,
    backpedaling = false,
    turnAmount = 0,
    attackProgress = null,
    actionProgress = null,
    fallAnimationClipProgress = null,
  } = {}) {
    if (!this.activeAction || !key) {
      return;
    }

    const syncFallingToLanding = (key === 'fallingToLanding' || key === 'forwardJumpLanding')
      && Number.isFinite(fallAnimationClipProgress);
    const syncLedgeClip = LEDGE_SYNC_CLIP_KEYS.has(key)
      && Number.isFinite(actionProgress);
    const generatedPowerKnockback = GENERATED_POWER_KNOCKBACK_STATES.has(state);
    const heldPoseProgress = this.animationMetadata.get(key)?.holdProgress;
    const heldAuthoredPose = state === 'lyingFlat' && Number.isFinite(heldPoseProgress);
    let speed = 1;
    if (generatedPowerKnockback || heldAuthoredPose) {
      speed = 0;
    } else if (key === 'walking'
      || key === 'strutWalking'
      || key === 'leftTurn'
      || key === 'rightTurn'
      || key === 'leftTurn90'
      || key === 'rightTurn90'
      || key === 'pistolWalk'
      || key === 'pistolWalkBackward'
      || key === 'pistolWalkArc'
      || key === 'pistolWalkArc2'
      || key === 'pistolWalkBackwardArc'
      || key === 'pistolWalkBackwardArc2'
      || key === 'pistolStrafe'
      || key === 'pistolStrafe2') {
      speed = THREE.MathUtils.clamp(moveAmount || 1, 0.68, 1.22);
    } else if (key === 'running'
      || key === 'pistolRun'
      || key === 'pistolRunBackward'
      || key === 'pistolRunArc'
      || key === 'pistolRunArc2'
      || key === 'pistolRunBackwardArc'
      || key === 'pistolRunBackwardArc2') {
      speed = THREE.MathUtils.clamp((moveAmount || 1.2) / 1.2, 0.78, 1.35);
    } else if (key === 'slowJogBackwards') {
      speed = THREE.MathUtils.clamp(moveAmount || 0.9, 0.7, 1.15);
    } else if (key === 'forwardJumpFall') {
      // Reach the dedicated falling loop sooner without changing jump physics.
      // The physical landing state may still interrupt this clip at any frame.
      speed = FORWARD_JUMP_FALL_TRANSITION_SPEED;
    } else if (key === 'swordInwardSlash'
      || key === 'dodgeRoll'
      || JUMP_ACTION_CLIP_KEYS.has(key)
      || syncLedgeClip
      || syncFallingToLanding) {
      speed = 0;
    } else if (!moving && !running && !backpedaling) {
      speed = 1;
    }

    this.activeAction.setEffectiveTimeScale(speed);

    if (heldAuthoredPose) {
      const clipDuration = this.animationMetadata.get(key)?.duration ?? this.activeAction.getClip?.()?.duration ?? 0;
      this.activeAction.time = THREE.MathUtils.clamp(heldPoseProgress, 0, 1) * Math.max(0.1, clipDuration);
    } else if (generatedPowerKnockback) {
      const clipDuration = this.animationMetadata.get(key)?.duration ?? this.activeAction.getClip?.()?.duration ?? 0;
      this.activeAction.time = Math.min(0.12, Math.max(0, clipDuration * 0.18));
    } else if (key === 'swordInwardSlash' && Number.isFinite(attackProgress)) {
      const clipDuration = this.animationMetadata.get(key)?.duration ?? this.activeAction.getClip?.()?.duration ?? 0;
      this.activeAction.time = THREE.MathUtils.clamp(attackProgress, 0, 1) * Math.max(0.1, clipDuration);
    } else if ((key === 'dodgeRoll' || (JUMP_ACTION_CLIP_KEYS.has(key) && key !== 'forwardJumpFall'))
      && Number.isFinite(actionProgress)) {
      const clipDuration = this.animationMetadata.get(key)?.duration ?? this.activeAction.getClip?.()?.duration ?? 0;
      let clipProgress = THREE.MathUtils.clamp(actionProgress, 0, 1);
      if (key === 'neutralJump') {
        clipProgress = getNeutralJumpClipProgress(actionProgress);
      } else if (key === 'forwardJumpLaunch') {
        clipProgress = getForwardJumpLaunchClipProgress(actionProgress);
      }
      this.activeAction.time = clipProgress * Math.max(0.1, clipDuration);
    } else if (syncLedgeClip) {
      const clipDuration = this.animationMetadata.get(key)?.duration ?? this.activeAction.getClip?.()?.duration ?? 0;
      this.activeAction.time = THREE.MathUtils.clamp(actionProgress, 0, 1) * Math.max(0.1, clipDuration);
    } else if (syncFallingToLanding) {
      const clipDuration = this.animationMetadata.get(key)?.duration ?? this.activeAction.getClip?.()?.duration ?? 0;
      const fallProgress = THREE.MathUtils.clamp(fallAnimationClipProgress, 0, 1);
      this.activeAction.time = fallProgress * Math.max(0.1, clipDuration);
    }
  }

  _applyDebugPoseOverridesImmediate() {
    for (const [jointName, rotation] of this.debugPoseOverrides.entries()) {
      this._applyDebugJointRotation(jointName, new THREE.Euler(rotation.x, rotation.y, rotation.z), 1);
    }
  }

  _applyDebugJointRotation(jointName, target = zeroEuler, alpha = 1) {
    const joint = this.joints.get(jointName);
    if (!joint) {
      return;
    }

    this._applyBoneRotation(joint, target, alpha);
  }

  _applyBoneRotation(bone, rotation = zeroEuler, alpha = 1) {
    const rest = this.restLocalQuaternions.get(bone);

    if (!rest) {
      return;
    }

    tempQuaternionA.setFromEuler(rotation);
    const targetQuaternion = rest.clone().multiply(tempQuaternionA);
    bone.quaternion.slerp(targetQuaternion, THREE.MathUtils.clamp(alpha, 0, 1));
  }

  _applyPistolBusterPoseCorrection() {
    if (!this._isPistolClipKey(this.activeClipKey)) {
      return;
    }

    for (const [jointName, pose] of Object.entries(PISTOL_BUSTER_POSE_DEGREES)) {
      const joint = this.joints.get(jointName);
      if (!joint) {
        continue;
      }

      tempEuler.set(
        THREE.MathUtils.degToRad(pose.pitch),
        THREE.MathUtils.degToRad(pose.yaw),
        THREE.MathUtils.degToRad(pose.roll),
        joint.rotation.order,
      );
      this._applyBoneRotation(joint, tempEuler, 1);
    }
  }

  _applyBusterAimPose(active = false, state = 'idle', moving = false) {
    const airborne = AIRBORNE_BUSTER_AIM_STATES.has(state);
    const applyLeftMegaBusterPose = active && this.busterArmSide === 'left';
    const applyRightAirbornePose = active && this.busterArmSide === 'right' && airborne;
    const actionIdleActive = applyLeftMegaBusterPose
      && !moving
      && !airborne
      && (state === 'idle' || state === 'attacking');
    this.root.userData.leftMegaBusterAimActive = applyLeftMegaBusterPose;
    this.root.userData.megaBusterActionIdleActive = actionIdleActive;
    this.root.userData.megaBusterArmWorldAnchorActive = false;
    this.root.userData.airborneBusterAimActive = airborne
      && (applyLeftMegaBusterPose || applyRightAirbornePose);

    if (applyLeftMegaBusterPose) {
      this._applyLeftMegaBusterAimPose(actionIdleActive);
      return;
    }

    const pose = applyRightAirbornePose ? this.rightBusterAimPose : null;
    if (!pose?.size) {
      return;
    }

    for (const [jointName, quaternion] of pose) {
      this.joints.get(jointName)?.quaternion.copy(quaternion);
    }
  }

  _applyLeftMegaBusterAimPose(useFullActionIdlePose = false) {
    const jointNames = useFullActionIdlePose
      ? Object.keys(MEGA_BUSTER_ACTION_IDLE_POSE_DEGREES)
      : LEFT_BUSTER_AIM_JOINTS;
    if (useFullActionIdlePose) {
      this._resetAnimatedBonesToRestPose();
      this.megaBusterActionIdlePoseWasApplied = true;
    } else {
      for (const jointName of LEFT_BUSTER_AIM_JOINTS) {
        const joint = this.joints.get(jointName);
        const restPosition = joint?.userData?.restLocalPosition;
        if (joint && restPosition) {
          joint.position.copy(restPosition);
        }
      }
    }
    this._applyRawLocalPoseDegrees(MEGA_BUSTER_ACTION_IDLE_POSE_DEGREES, jointNames);

    if (!useFullActionIdlePose) {
      this._anchorMegaBusterArmToActionIdle();
    }

    for (const jointName of LEFT_BUSTER_AIM_JOINTS) {
      const joint = this.joints.get(jointName);
      const captured = this.busterAirAimPose.get(jointName);
      if (joint && captured) {
        captured.copy(joint.quaternion);
      }
    }
  }

  _anchorMegaBusterArmToActionIdle() {
    const shoulder = this.joints.get('leftShoulder');
    if (!this.megaBusterActionIdleArmAnchorReady || !shoulder?.parent) {
      return false;
    }

    // Keep the shoulder socket attached to the torso. Translating it to hold
    // the muzzle at one absolute point stretches the shoulder-parent segment
    // whenever the hips turn during locomotion. Counter-rotate the firing arm
    // instead, allowing only the torso's natural positional bob to carry it.
    const restPosition = shoulder.userData?.restLocalPosition;
    if (restPosition) {
      shoulder.position.copy(restPosition);
    }

    this.root.getWorldQuaternion(tempQuaternionA);
    tempQuaternionA.multiply(this.megaBusterActionIdleShoulderLocalQuaternion);
    shoulder.parent.getWorldQuaternion(tempQuaternionB).invert();
    shoulder.quaternion.copy(tempQuaternionB.multiply(tempQuaternionA)).normalize();
    this.root.updateMatrixWorld(true);
    this.megaBusterArmWorldAnchorWasApplied = true;
    this.root.userData.megaBusterArmWorldAnchorActive = true;
    return true;
  }

  _applyLedgeRightArmPose(state = 'idle', useRightArmForLedge = false) {
    const ledgeActive = LEDGE_SYNC_CLIP_KEYS.has(this._normalizeClipKey(state))
      || ['jumpingToHanging', 'settlingToFreeHang', 'hangingIdle', 'preparingToClimb', 'climbingUp'].includes(state);
    const keepRightArmDown = ledgeActive && !useRightArmForLedge;
    this.root.userData.rightLedgeArmDownActive = keepRightArmDown;
    if (!keepRightArmDown) {
      return;
    }

    for (const [jointName, quaternion] of this.rightLedgeArmDownPose) {
      this.joints.get(jointName)?.quaternion.copy(quaternion);
    }
  }

  _applyGeneratedPowerKnockbackPose(state, progress = 0, dt = 0) {
    if (!['knockbackLaunch', 'aerialKnockbackFall', 'backLanding', 'downed'].includes(state)) {
      return;
    }

    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const launch = state === 'knockbackLaunch' ? THREE.MathUtils.smoothstep(p, 0, 0.55) : 1;
    const flat = state === 'lyingFlat' || state === 'downed'
      ? 1
      : state === 'backLanding'
        ? THREE.MathUtils.smoothstep(p, 0.04, 0.72)
        : 0;
    const flight = state === 'knockbackLaunch'
      ? launch
      : state === 'aerialKnockbackFall'
        ? 1
        : 1 - flat;
    const bounce = state === 'backLanding' ? Math.sin(p * Math.PI) * (1 - flat * 0.65) : 0;
    const alpha = THREE.MathUtils.clamp(this.stateTime * 12 + dt * 12, 0, 1);
    const apply = (jointName, x, y = 0, z = 0) => {
      const joint = this.joints.get(jointName);
      if (!joint) return;
      tempEuler.set(x, y, z, joint.rotation.order);
      this._applyBoneRotation(joint, tempEuler, alpha);
    };

    apply('hips', THREE.MathUtils.lerp(-0.4 - 0.48 * flight, -1.48, flat), 0.08 * flight, 0);
    apply('spine', THREE.MathUtils.lerp(-0.56 - 0.34 * flight, 0.06, flat), -0.06 * flight, 0);
    apply('neck', THREE.MathUtils.lerp(-0.32 + 0.16 * flight, 0.08, flat) + 0.18 * bounce, 0, 0);
    apply('leftShoulder', THREE.MathUtils.lerp(-0.52, 0, flat), -0.08 * (1 - flat), THREE.MathUtils.lerp(0.72, 0.08, flat));
    apply('rightShoulder', THREE.MathUtils.lerp(-0.52, 0, flat), 0.08 * (1 - flat), THREE.MathUtils.lerp(-0.72, -0.08, flat));
    apply('leftElbow', THREE.MathUtils.lerp(0.24 + 0.3 * bounce, 0.05, flat));
    apply('rightElbow', THREE.MathUtils.lerp(0.24 + 0.24 * bounce, 0.06, flat));
    apply('leftHip', THREE.MathUtils.lerp(0.28 + 0.3 * flight, 0, flat), 0, THREE.MathUtils.lerp(0.12, 0.04, flat));
    apply('rightHip', THREE.MathUtils.lerp(0.2 + 0.22 * flight, 0, flat), 0, THREE.MathUtils.lerp(-0.12, -0.04, flat));
    apply('leftKnee', THREE.MathUtils.lerp(0.42 + 0.38 * flight, 0.04, flat));
    apply('rightKnee', THREE.MathUtils.lerp(0.34 + 0.3 * flight, 0.04, flat));
    apply('leftAnkle', THREE.MathUtils.lerp(-0.08 * flight, 0, flat));
    apply('rightAnkle', THREE.MathUtils.lerp(-0.06 * flight, 0, flat));
  }

  _isPistolClipKey(key) {
    return this._normalizeClipKey(key)?.startsWith('pistol') ?? false;
  }

  _syncArmReplacementVisibility() {
    for (const mesh of this.skinnedMeshes) {
      const isLeftHandMesh = mesh.name.includes(LEFT_BUSTER_HAND_MESH_TOKEN);
      const isRightHandMesh = mesh.name.includes(RIGHT_BUSTER_HAND_MESH_TOKEN);
      const isDrillMesh = mesh.name.includes(DRILL_HAND_MESH_TOKEN);

      if (isLeftHandMesh || isRightHandMesh || isDrillMesh) {
        mesh.visible = !(isLeftHandMesh && this.megaBusterArmActive)
          && !(isRightHandMesh && this.busterArmActive)
          && !(isDrillMesh && this.drillArmActive);
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
    let targetZ = 0;

    if (state === 'attacking' && attackKind === 'beamBlade') {
      targetX = 0.08 * chamberHold;
      targetZ = BUSTER_CHAMBER_ROLL_SIGN * 0.04 * chamberHold;
    }

    tempEuler.set(targetX, 0, targetZ);
    tempQuaternionB.setFromEuler(tempEuler);
    tempQuaternionA.copy(this.busterNeutralQuaternion).multiply(tempQuaternionB);
    this.busterArmGroup.quaternion.slerp(tempQuaternionA, alpha);
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
