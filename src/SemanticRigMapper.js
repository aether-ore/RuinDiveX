import * as THREE from 'three';
const SIDE_PREFIXES = ['left', 'right'];

export function degrees(value = 0) {
  return THREE.MathUtils.degToRad(Number(value) || 0);
}

export function semanticPoseDegreesToRadians(value = {}) {
  if (typeof value === 'number') {
    return degrees(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => semanticPoseDegreesToRadians(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const converted = {};
  for (const [key, entry] of Object.entries(value)) {
    converted[key] = semanticPoseDegreesToRadians(entry);
  }
  return converted;
}

export function semanticDegreesToRadians(value = {}) {
  return semanticPoseDegreesToRadians(value);
}

function ensureEuler(map, name) {
  let target = map.get(name);

  if (!target) {
    target = new THREE.Euler();
    map.set(name, target);
  }

  return target;
}

function eulerFrom(value = {}) {
  return new THREE.Euler(value.x ?? 0, value.y ?? 0, value.z ?? 0);
}

function clonePoseValue(value) {
  if (value?.isEuler) {
    return new THREE.Euler(value.x, value.y, value.z);
  }

  if (value?.isVector3) {
    return value.clone();
  }

  if (value && typeof value === 'object') {
    return { ...value };
  }

  return value;
}

export class Pose {
  constructor({ rotations = {}, positions = {} } = {}) {
    this.rotations = new Map();
    this.positions = new Map();

    for (const [name, value] of Object.entries(rotations)) {
      this.rotations.set(name, value?.isEuler ? value.clone() : eulerFrom(value));
    }

    for (const [name, value] of Object.entries(positions)) {
      this.positions.set(name, value?.isVector3 ? value.clone() : new THREE.Vector3(value.x ?? 0, value.y ?? 0, value.z ?? 0));
    }
  }

  clone() {
    const pose = new Pose();
    for (const [name, value] of this.rotations.entries()) {
      pose.rotations.set(name, clonePoseValue(value));
    }
    for (const [name, value] of this.positions.entries()) {
      pose.positions.set(name, clonePoseValue(value));
    }
    return pose;
  }
}

export class PoseKeyframe {
  constructor(time = 0, pose = new Pose()) {
    this.time = Math.max(0, Number(time) || 0);
    this.pose = pose instanceof Pose ? pose : new Pose(pose);
  }
}

export class PoseClip {
  constructor({ id = '', duration = 1, loop = true, keyframes = [] } = {}) {
    this.id = id;
    this.duration = Math.max(0.001, Number(duration) || 1);
    this.loop = loop;
    this.keyframes = keyframes
      .map((keyframe) => keyframe instanceof PoseKeyframe ? keyframe : new PoseKeyframe(keyframe.time, keyframe.pose))
      .sort((a, b) => a.time - b.time);
  }

  sample(time = 0) {
    if (this.keyframes.length <= 0) {
      return new Pose();
    }

    const localTime = this.loop
      ? THREE.MathUtils.euclideanModulo(time, this.duration)
      : THREE.MathUtils.clamp(time, 0, this.duration);

    let previous = this.keyframes[0];
    let next = this.keyframes[this.keyframes.length - 1];

    for (let i = 0; i < this.keyframes.length; i += 1) {
      const current = this.keyframes[i];
      const following = this.keyframes[(i + 1) % this.keyframes.length];
      const followingTime = i === this.keyframes.length - 1 ? this.duration : following.time;

      if (localTime >= current.time && localTime <= followingTime) {
        previous = current;
        next = following;
        break;
      }
    }

    const segmentEnd = next.time <= previous.time ? this.duration : next.time;
    const span = Math.max(0.001, segmentEnd - previous.time);
    const t = THREE.MathUtils.smoothstep((localTime - previous.time) / span, 0, 1);
    return PoseMixer.interpolate(previous.pose, next.pose, t);
  }
}

export class PoseMixer {
  static interpolate(a, b, weight = 0) {
    const pose = new Pose();
    const names = new Set([...a.rotations.keys(), ...b.rotations.keys()]);

    for (const name of names) {
      const left = a.rotations.get(name) ?? new THREE.Euler();
      const right = b.rotations.get(name) ?? left;
      pose.rotations.set(name, new THREE.Euler(
        THREE.MathUtils.lerp(left.x, right.x, weight),
        THREE.MathUtils.lerp(left.y, right.y, weight),
        THREE.MathUtils.lerp(left.z, right.z, weight),
      ));
    }

    const positionNames = new Set([...a.positions.keys(), ...b.positions.keys()]);
    for (const name of positionNames) {
      const left = a.positions.get(name) ?? new THREE.Vector3();
      const right = b.positions.get(name) ?? left;
      pose.positions.set(name, left.clone().lerp(right, weight));
    }

    return pose;
  }

  static applyToMaps(pose, rotationTargets, positionTargets, weight = 1, additive = false) {
    for (const [name, value] of pose.rotations.entries()) {
      const target = ensureEuler(rotationTargets, name);
      if (additive) {
        target.x += value.x * weight;
        target.y += value.y * weight;
        target.z += value.z * weight;
      } else {
        target.x = THREE.MathUtils.lerp(target.x, value.x, weight);
        target.y = THREE.MathUtils.lerp(target.y, value.y, weight);
        target.z = THREE.MathUtils.lerp(target.z, value.z, weight);
      }
    }

    for (const [name, value] of pose.positions.entries()) {
      let target = positionTargets.get(name);
      if (!target) {
        target = new THREE.Vector3();
        positionTargets.set(name, target);
      }

      if (additive) {
        target.addScaledVector(value, weight);
      } else {
        target.lerp(value, weight);
      }
    }
  }
}

export class SemanticRigMapper {
  constructor(joints = new Map()) {
    this.joints = joints;
  }

  sideSign(side) {
    return side === 'left' ? -1 : 1;
  }

  setJoint(targets, name, x = 0, y = 0, z = 0) {
    const target = ensureEuler(targets, name);
    target.set(x, y, z);
    return target;
  }

  addJoint(targets, name, x = 0, y = 0, z = 0, weight = 1) {
    const target = ensureEuler(targets, name);
    target.x += x * weight;
    target.y += y * weight;
    target.z += z * weight;
    return target;
  }

  blendJoint(targets, name, x = 0, y = 0, z = 0, weight = 1) {
    const target = ensureEuler(targets, name);
    target.x = THREE.MathUtils.lerp(target.x, x, weight);
    target.y = THREE.MathUtils.lerp(target.y, y, weight);
    target.z = THREE.MathUtils.lerp(target.z, z, weight);
    return target;
  }

  armPoseToEuler(side, pose = {}) {
    const sign = this.sideSign(side);
    return {
      shoulder: {
        x: pose.armTwist ?? pose.shoulderTwist ?? 0,
        y: pose.armForwardBack ?? pose.shoulderYaw ?? 0,
        z: sign * (pose.armRaise ?? pose.shoulderRaise ?? 0),
      },
      elbow: {
        x: pose.forearmTwist ?? pose.elbowTwist ?? 0,
        y: pose.elbowDepth ?? 0,
        z: sign * (pose.elbowBend ?? 0),
      },
      wrist: {
        x: pose.wristPitch ?? pose.wristAim ?? 0,
        y: pose.wristYaw ?? 0,
        z: pose.wristRoll ?? 0,
      },
    };
  }

  setArmPose(targets, side, pose = {}) {
    const euler = this.armPoseToEuler(side, pose);
    this.setJoint(targets, `${side}Shoulder`, euler.shoulder.x, euler.shoulder.y, euler.shoulder.z);
    this.setJoint(targets, `${side}Elbow`, euler.elbow.x, euler.elbow.y, euler.elbow.z);
    this.setJoint(targets, `${side}Wrist`, euler.wrist.x, euler.wrist.y, euler.wrist.z);
  }

  addArmPose(targets, side, pose = {}, weight = 1) {
    const euler = this.armPoseToEuler(side, pose);
    this.addJoint(targets, `${side}Shoulder`, euler.shoulder.x, euler.shoulder.y, euler.shoulder.z, weight);
    this.addJoint(targets, `${side}Elbow`, euler.elbow.x, euler.elbow.y, euler.elbow.z, weight);
    this.addJoint(targets, `${side}Wrist`, euler.wrist.x, euler.wrist.y, euler.wrist.z, weight);
  }

  blendArmPose(targets, side, pose = {}, weight = 1) {
    const euler = this.armPoseToEuler(side, pose);
    this.blendJoint(targets, `${side}Shoulder`, euler.shoulder.x, euler.shoulder.y, euler.shoulder.z, weight);
    this.blendJoint(targets, `${side}Elbow`, euler.elbow.x, euler.elbow.y, euler.elbow.z, weight);
    this.blendJoint(targets, `${side}Wrist`, euler.wrist.x, euler.wrist.y, euler.wrist.z, weight);
  }

  blendCorePose(targets, pose = {}, weight = 1) {
    if (pose.hips) {
      this.blendJoint(targets, 'hips', pose.hips.pitch ?? 0, pose.hips.yaw ?? 0, pose.hips.roll ?? 0, weight);
    }

    if (pose.spine) {
      this.blendJoint(targets, 'spine', pose.spine.pitch ?? 0, pose.spine.yaw ?? 0, pose.spine.roll ?? 0, weight);
    }

    if (pose.neck) {
      this.blendJoint(targets, 'neck', pose.neck.pitch ?? 0, pose.neck.yaw ?? 0, pose.neck.roll ?? 0, weight);
    }
  }

  setLegPose(targets, side, pose = {}) {
    this.setJoint(
      targets,
      `${side}Hip`,
      pose.hipPitch ?? 0,
      pose.hipYaw ?? 0,
      pose.hipRoll ?? 0,
    );
    this.setJoint(
      targets,
      `${side}Knee`,
      pose.kneeBend ?? 0,
      pose.kneeYaw ?? 0,
      pose.kneeRoll ?? 0,
    );
    this.setJoint(
      targets,
      `${side}Ankle`,
      pose.anklePitch ?? 0,
      pose.ankleYaw ?? 0,
      pose.ankleRoll ?? 0,
    );
  }

  addLegPose(targets, side, pose = {}, weight = 1) {
    this.addJoint(targets, `${side}Hip`, pose.hipPitch ?? 0, pose.hipYaw ?? 0, pose.hipRoll ?? 0, weight);
    this.addJoint(targets, `${side}Knee`, pose.kneeBend ?? 0, pose.kneeYaw ?? 0, pose.kneeRoll ?? 0, weight);
    this.addJoint(targets, `${side}Ankle`, pose.anklePitch ?? 0, pose.ankleYaw ?? 0, pose.ankleRoll ?? 0, weight);
  }

  blendLegPose(targets, side, pose = {}, weight = 1) {
    this.blendJoint(targets, `${side}Hip`, pose.hipPitch ?? 0, pose.hipYaw ?? 0, pose.hipRoll ?? 0, weight);
    this.blendJoint(targets, `${side}Knee`, pose.kneeBend ?? 0, pose.kneeYaw ?? 0, pose.kneeRoll ?? 0, weight);
    this.blendJoint(targets, `${side}Ankle`, pose.anklePitch ?? 0, pose.ankleYaw ?? 0, pose.ankleRoll ?? 0, weight);
  }

  setCorePose(targets, pose = {}) {
    if (pose.hips) {
      this.setJoint(targets, 'hips', pose.hips.pitch ?? 0, pose.hips.yaw ?? 0, pose.hips.roll ?? 0);
    }

    if (pose.spine) {
      this.setJoint(targets, 'spine', pose.spine.pitch ?? 0, pose.spine.yaw ?? 0, pose.spine.roll ?? 0);
    }

    if (pose.neck) {
      this.setJoint(targets, 'neck', pose.neck.pitch ?? 0, pose.neck.yaw ?? 0, pose.neck.roll ?? 0);
    }
  }

  addCorePose(targets, pose = {}, weight = 1) {
    if (pose.hips) {
      this.addJoint(targets, 'hips', pose.hips.pitch ?? 0, pose.hips.yaw ?? 0, pose.hips.roll ?? 0, weight);
    }

    if (pose.spine) {
      this.addJoint(targets, 'spine', pose.spine.pitch ?? 0, pose.spine.yaw ?? 0, pose.spine.roll ?? 0, weight);
    }

    if (pose.neck) {
      this.addJoint(targets, 'neck', pose.neck.pitch ?? 0, pose.neck.yaw ?? 0, pose.neck.roll ?? 0, weight);
    }
  }
}

export class DebugPoseExporter {
  static rawJointToSemanticArm(side, jointPose = {}, elbowPose = {}, wristPose = {}) {
    const sign = side === 'left' ? -1 : 1;
    return {
      armTwist: jointPose.pitch ?? jointPose.x ?? 0,
      armForwardBack: jointPose.yaw ?? jointPose.y ?? 0,
      armRaise: sign * (jointPose.roll ?? jointPose.z ?? 0),
      forearmTwist: elbowPose.pitch ?? elbowPose.x ?? 0,
      elbowDepth: elbowPose.yaw ?? elbowPose.y ?? 0,
      elbowBend: sign * (elbowPose.roll ?? elbowPose.z ?? 0),
      wristPitch: wristPose.pitch ?? wristPose.x ?? 0,
      wristYaw: wristPose.yaw ?? wristPose.y ?? 0,
      wristRoll: wristPose.roll ?? wristPose.z ?? 0,
    };
  }

  static rawPoseToSemanticDegrees(rawPoseDegrees = {}) {
    const semantic = {
      core: {
        hips: rawPoseDegrees.hips ?? {},
        spine: rawPoseDegrees.spine ?? {},
        neck: rawPoseDegrees.neck ?? {},
      },
      leftArm: this.rawJointToSemanticArm(
        'left',
        rawPoseDegrees.leftShoulder,
        rawPoseDegrees.leftElbow,
        rawPoseDegrees.leftWrist,
      ),
      rightArm: this.rawJointToSemanticArm(
        'right',
        rawPoseDegrees.rightShoulder,
        rawPoseDegrees.rightElbow,
        rawPoseDegrees.rightWrist,
      ),
      leftLeg: {
        hipPitch: rawPoseDegrees.leftHip?.pitch ?? 0,
        hipYaw: rawPoseDegrees.leftHip?.yaw ?? 0,
        hipRoll: rawPoseDegrees.leftHip?.roll ?? 0,
        kneeBend: rawPoseDegrees.leftKnee?.pitch ?? 0,
        kneeYaw: rawPoseDegrees.leftKnee?.yaw ?? 0,
        kneeRoll: rawPoseDegrees.leftKnee?.roll ?? 0,
        anklePitch: rawPoseDegrees.leftAnkle?.pitch ?? 0,
        ankleYaw: rawPoseDegrees.leftAnkle?.yaw ?? 0,
        ankleRoll: rawPoseDegrees.leftAnkle?.roll ?? 0,
      },
      rightLeg: {
        hipPitch: rawPoseDegrees.rightHip?.pitch ?? 0,
        hipYaw: rawPoseDegrees.rightHip?.yaw ?? 0,
        hipRoll: rawPoseDegrees.rightHip?.roll ?? 0,
        kneeBend: rawPoseDegrees.rightKnee?.pitch ?? 0,
        kneeYaw: rawPoseDegrees.rightKnee?.yaw ?? 0,
        kneeRoll: rawPoseDegrees.rightKnee?.roll ?? 0,
        anklePitch: rawPoseDegrees.rightAnkle?.pitch ?? 0,
        ankleYaw: rawPoseDegrees.rightAnkle?.yaw ?? 0,
        ankleRoll: rawPoseDegrees.rightAnkle?.roll ?? 0,
      },
    };

    return semantic;
  }
}

export const LOWER_BODY_MASK = [
  'hips',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
];

export const UPPER_BODY_MASK = [
  'spine',
  'neck',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
];

export function createNeutralSemanticPose() {
  const arms = {};

  for (const side of SIDE_PREFIXES) {
    arms[`${side}Arm`] = {
      armForwardBack: 0,
      armRaise: degrees(74),
      armTwist: 0,
      elbowBend: degrees(8),
      elbowDepth: 0,
      forearmTwist: 0,
      wristPitch: 0,
      wristYaw: 0,
      wristRoll: 0,
    };
  }

  return {
    core: {
      hips: { pitch: 0, yaw: 0, roll: 0 },
      spine: { pitch: 0, yaw: 0, roll: 0 },
      neck: { pitch: 0, yaw: 0, roll: 0 },
    },
    ...arms,
    leftLeg: { hipPitch: 0, hipYaw: 0, hipRoll: degrees(-5), kneeBend: degrees(4), anklePitch: 0, ankleYaw: 0, ankleRoll: 0 },
    rightLeg: { hipPitch: 0, hipYaw: 0, hipRoll: degrees(5), kneeBend: degrees(4), anklePitch: 0, ankleYaw: 0, ankleRoll: 0 },
  };
}
