import * as THREE from 'three';
import {
  Pose,
  PoseClip,
  PoseKeyframe,
  PoseMixer,
  SemanticRigMapper,
  createNeutralSemanticPose,
  degrees,
} from '../SemanticRigMapper.js';

const WALK_DURATION = 1.08;
const JOG_DURATION = 0.66;
const WALK_FRAMES = 36;
const JOG_FRAMES = 24;
const LEG_STRIDE_AXIS_SIGN = -1;
const LEG_KNEE_BEND_SIGN = 1;
const ARM_SWING_AXIS_SIGN = -1;
const FOREARM_CARRY_AXIS_SIGN = -1;
const ARM_RAISE_NEUTRAL_DEGREES = 74;
const ARM_RAISE_OFFSET_SIGN = -2.15;

function walkTime(frame) {
  return WALK_DURATION * (frame / WALK_FRAMES);
}

function jogTime(frame) {
  return JOG_DURATION * (frame / JOG_FRAMES);
}

function corePose({
  hipPitch = 0,
  hipYaw = 0,
  hipRoll = 0,
  spinePitch = 0,
  spineYaw = 0,
  spineRoll = 0,
  neckPitch = 0,
  neckYaw = 0,
  neckRoll = 0,
} = {}) {
  return {
    hips: { pitch: degrees(hipPitch), yaw: degrees(hipYaw), roll: degrees(hipRoll) },
    spine: { pitch: degrees(spinePitch), yaw: degrees(spineYaw), roll: degrees(spineRoll) },
    neck: { pitch: degrees(neckPitch), yaw: degrees(neckYaw), roll: degrees(neckRoll) },
  };
}

function armPose(side, {
  forwardBack = 0,
  raise = 74,
  twist = 0,
  elbowBend = 10,
  elbowDepth = 0,
  forearmTwist = 0,
  wristPitch = 0,
  wristYaw = 0,
  wristRoll = 0,
} = {}) {
  const sideAxisSign = side === 'left' ? -1 : 1;

  return {
    armForwardBack: degrees(forwardBack * ARM_SWING_AXIS_SIGN * sideAxisSign),
    armRaise: degrees(ARM_RAISE_NEUTRAL_DEGREES + ((raise - ARM_RAISE_NEUTRAL_DEGREES) * ARM_RAISE_OFFSET_SIGN)),
    armTwist: degrees(twist),
    elbowBend: degrees(elbowBend),
    elbowDepth: degrees(elbowDepth * FOREARM_CARRY_AXIS_SIGN * sideAxisSign),
    forearmTwist: degrees(forearmTwist),
    wristPitch: degrees(wristPitch),
    wristYaw: degrees(wristYaw),
    wristRoll: degrees(wristRoll),
  };
}

function legPose({
  hipPitch = 0,
  hipYaw = 0,
  hipRoll = 0,
  kneeBend = 4,
  kneeYaw = 0,
  kneeRoll = 0,
  anklePitch = 0,
  ankleYaw = 0,
  ankleRoll = 0,
} = {}) {
  return {
    hipPitch: degrees(hipPitch * LEG_STRIDE_AXIS_SIGN),
    hipYaw: degrees(hipYaw),
    hipRoll: degrees(hipRoll),
    kneeBend: degrees(kneeBend * LEG_KNEE_BEND_SIGN),
    kneeYaw: degrees(kneeYaw),
    kneeRoll: degrees(kneeRoll),
    anklePitch: degrees(anklePitch * LEG_STRIDE_AXIS_SIGN),
    ankleYaw: degrees(ankleYaw),
    ankleRoll: degrees(ankleRoll),
  };
}

function positionOffsets({
  leftKneeZ = 0,
  rightKneeZ = 0,
  leftAnkleZ = 0,
  rightAnkleZ = 0,
} = {}) {
  return {
    leftKnee: { x: 0, y: 0, z: leftKneeZ * LEG_STRIDE_AXIS_SIGN },
    rightKnee: { x: 0, y: 0, z: rightKneeZ * LEG_STRIDE_AXIS_SIGN },
    leftAnkle: { x: 0, y: 0, z: leftAnkleZ * LEG_STRIDE_AXIS_SIGN },
    rightAnkle: { x: 0, y: 0, z: rightAnkleZ * LEG_STRIDE_AXIS_SIGN },
  };
}

function mergeSection(baseSection = {}, overrideSection = {}) {
  return { ...baseSection, ...overrideSection };
}

function mergeSemanticPose(base, override = {}) {
  return {
    core: {
      hips: mergeSection(base.core?.hips, override.core?.hips),
      spine: mergeSection(base.core?.spine, override.core?.spine),
      neck: mergeSection(base.core?.neck, override.core?.neck),
    },
    leftArm: mergeSection(base.leftArm, override.leftArm),
    rightArm: mergeSection(base.rightArm, override.rightArm),
    leftLeg: mergeSection(base.leftLeg, override.leftLeg),
    rightLeg: mergeSection(base.rightLeg, override.rightLeg),
  };
}

function semanticFrameToPose(mapper, neutralSemanticPose, frame) {
  const semantic = mergeSemanticPose(neutralSemanticPose, frame.semantic);
  const rotationTargets = new Map();
  mapper.setCorePose(rotationTargets, semantic.core);
  mapper.setArmPose(rotationTargets, 'left', semantic.leftArm);
  mapper.setArmPose(rotationTargets, 'right', semantic.rightArm);
  mapper.setLegPose(rotationTargets, 'left', semantic.leftLeg);
  mapper.setLegPose(rotationTargets, 'right', semantic.rightLeg);

  const rotations = {};
  for (const [name, value] of rotationTargets.entries()) {
    rotations[name] = { x: value.x, y: value.y, z: value.z };
  }

  return new Pose({
    rotations,
    positions: frame.positionOffsets ?? {},
  });
}

function createSemanticClip(mapper, neutralSemanticPose, { id, duration, keyframes }) {
  return new PoseClip({
    id,
    duration,
    loop: true,
    keyframes: keyframes.map((frame) => new PoseKeyframe(
      frame.time,
      semanticFrameToPose(mapper, neutralSemanticPose, frame),
    )),
  });
}

function cycle01(phase) {
  return THREE.MathUtils.euclideanModulo(phase, Math.PI * 2) / (Math.PI * 2);
}

function dampenRightArmSwing(pose, neutralPose, scale = 1) {
  const clampedScale = THREE.MathUtils.clamp(scale, 0, 1);

  for (const jointName of ['rightShoulder', 'rightElbow', 'rightWrist']) {
    const joint = pose.rotations.get(jointName);
    const neutral = neutralPose.rotations.get(jointName);

    if (!joint || !neutral) {
      continue;
    }

    joint.x = THREE.MathUtils.lerp(neutral.x, joint.x, clampedScale);
    joint.y = THREE.MathUtils.lerp(neutral.y, joint.y, clampedScale);
    joint.z = THREE.MathUtils.lerp(neutral.z, joint.z, clampedScale);
  }
}

const WALK_KEYFRAMES = [
  {
    time: walkTime(0),
    semantic: {
      core: corePose({ hipPitch: -1, hipYaw: -3, hipRoll: -3, spinePitch: -3, spineYaw: 6, spineRoll: 1.5, neckPitch: 1, neckYaw: -1 }),
      leftLeg: legPose({ hipPitch: 27, hipYaw: -2, hipRoll: -5, kneeBend: 9, anklePitch: -6, ankleYaw: -1, ankleRoll: 2 }),
      rightLeg: legPose({ hipPitch: -21, hipYaw: 2, hipRoll: 4, kneeBend: 34, kneeYaw: 2, kneeRoll: 2, anklePitch: 8, ankleYaw: 2 }),
      leftArm: armPose('left', { forwardBack: -36, raise: 69.5, twist: -4, elbowBend: 9, elbowDepth: -26, forearmTwist: -5, wristPitch: 3, wristRoll: 7 }),
      rightArm: armPose('right', { forwardBack: 34, raise: 78.5, twist: 4, elbowBend: 8, elbowDepth: 23, forearmTwist: 5, wristPitch: -2, wristRoll: -6 }),
    },
    positionOffsets: positionOffsets({
      rightKneeZ: -0.03, rightAnkleZ: -0.08, leftAnkleZ: 0.02,
    }),
  },
  {
    time: walkTime(6),
    semantic: {
      core: corePose({ hipPitch: -0.5, hipYaw: -1, hipRoll: -4.2, spinePitch: -2, spineYaw: 3, spineRoll: 2.2, neckPitch: 0.5 }),
      leftLeg: legPose({ hipPitch: 14, hipYaw: -1, hipRoll: -6, kneeBend: 16, anklePitch: -3, ankleRoll: 3 }),
      rightLeg: legPose({ hipPitch: -12, hipYaw: 1, hipRoll: 6, kneeBend: 25, kneeYaw: 1, kneeRoll: 2, anklePitch: 6, ankleRoll: -2 }),
      leftArm: armPose('left', { forwardBack: -22, raise: 71.5, twist: -2.5, elbowBend: 9, elbowDepth: -20, forearmTwist: -4, wristPitch: 2, wristRoll: 5 }),
      rightArm: armPose('right', { forwardBack: 21, raise: 76.5, twist: 2.5, elbowBend: 8, elbowDepth: 18, forearmTwist: 4, wristPitch: -1.5, wristRoll: -5 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.015, rightKneeZ: -0.035, rightAnkleZ: -0.07,
    }),
  },
  {
    time: walkTime(12),
    semantic: {
      core: corePose({ hipPitch: -1, hipYaw: 0, hipRoll: 0, spinePitch: -3.5, spineYaw: 0, spineRoll: 0, neckPitch: 1.2 }),
      leftLeg: legPose({ hipPitch: -3, hipYaw: 0, hipRoll: -5, kneeBend: 19, kneeYaw: -1, kneeRoll: -1, anklePitch: 4 }),
      rightLeg: legPose({ hipPitch: 6, hipYaw: 0, hipRoll: 5, kneeBend: 40, kneeYaw: 2, kneeRoll: 3, anklePitch: -5 }),
      leftArm: armPose('left', { forwardBack: 5, raise: 73.2, elbowBend: 7, elbowDepth: -12, forearmTwist: -2, wristRoll: 2 }),
      rightArm: armPose('right', { forwardBack: -5, raise: 74.8, elbowBend: 7, elbowDepth: 12, forearmTwist: 2, wristRoll: -2 }),
    },
    positionOffsets: positionOffsets({
      rightKneeZ: -0.055, rightAnkleZ: -0.1,
    }),
  },
  {
    time: walkTime(18),
    semantic: {
      core: corePose({ hipPitch: -1, hipYaw: 3, hipRoll: 3, spinePitch: -3, spineYaw: -6, spineRoll: -1.5, neckPitch: 1, neckYaw: 1 }),
      leftLeg: legPose({ hipPitch: -21, hipYaw: -2, hipRoll: -4, kneeBend: 34, kneeYaw: -2, kneeRoll: -2, anklePitch: 8, ankleYaw: -2 }),
      rightLeg: legPose({ hipPitch: 27, hipYaw: 2, hipRoll: 5, kneeBend: 9, anklePitch: -6, ankleYaw: 1, ankleRoll: -2 }),
      leftArm: armPose('left', { forwardBack: 34, raise: 78.5, twist: 4, elbowBend: 8, elbowDepth: 23, forearmTwist: 5, wristPitch: -2, wristRoll: -6 }),
      rightArm: armPose('right', { forwardBack: -36, raise: 69.5, twist: -4, elbowBend: 9, elbowDepth: -26, forearmTwist: -5, wristPitch: 3, wristRoll: 7 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.03, leftAnkleZ: -0.08, rightAnkleZ: 0.02,
    }),
  },
  {
    time: walkTime(24),
    semantic: {
      core: corePose({ hipPitch: -0.5, hipYaw: 1, hipRoll: 4.2, spinePitch: -2, spineYaw: -3, spineRoll: -2.2, neckPitch: 0.5 }),
      leftLeg: legPose({ hipPitch: -12, hipYaw: -1, hipRoll: -6, kneeBend: 25, kneeYaw: -1, kneeRoll: -2, anklePitch: 6, ankleRoll: 2 }),
      rightLeg: legPose({ hipPitch: 14, hipYaw: 1, hipRoll: 6, kneeBend: 16, anklePitch: -3, ankleRoll: -3 }),
      leftArm: armPose('left', { forwardBack: 21, raise: 76.5, twist: 2.5, elbowBend: 8, elbowDepth: 18, forearmTwist: 4, wristPitch: -1.5, wristRoll: -5 }),
      rightArm: armPose('right', { forwardBack: -22, raise: 71.5, twist: -2.5, elbowBend: 9, elbowDepth: -20, forearmTwist: -4, wristPitch: 2, wristRoll: 5 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.035, leftAnkleZ: -0.07, rightKneeZ: -0.015,
    }),
  },
  {
    time: walkTime(30),
    semantic: {
      core: corePose({ hipPitch: -1, hipYaw: 0, hipRoll: 0, spinePitch: -3.5, spineYaw: 0, spineRoll: 0, neckPitch: 1.2 }),
      leftLeg: legPose({ hipPitch: 6, hipYaw: 0, hipRoll: -5, kneeBend: 40, kneeYaw: -2, kneeRoll: -3, anklePitch: -5 }),
      rightLeg: legPose({ hipPitch: -3, hipYaw: 0, hipRoll: 5, kneeBend: 19, kneeYaw: 1, kneeRoll: 1, anklePitch: 4 }),
      leftArm: armPose('left', { forwardBack: -5, raise: 74.8, elbowBend: 7, elbowDepth: 12, forearmTwist: 2, wristRoll: -2 }),
      rightArm: armPose('right', { forwardBack: 5, raise: 73.2, elbowBend: 7, elbowDepth: -12, forearmTwist: -2, wristRoll: 2 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.055, leftAnkleZ: -0.1,
    }),
  },
];

const JOG_KEYFRAMES = [
  {
    time: jogTime(0),
    semantic: {
      core: corePose({ hipPitch: -3, hipYaw: -4, hipRoll: -4, spinePitch: -9, spineYaw: 7.5, spineRoll: 2, neckPitch: 3, neckYaw: -1.5 }),
      leftLeg: legPose({ hipPitch: 46, hipYaw: -3, hipRoll: -6, kneeBend: 10, anklePitch: -9, ankleRoll: 3 }),
      rightLeg: legPose({ hipPitch: -34, hipYaw: 3, hipRoll: 5, kneeBend: 58, kneeYaw: 2, kneeRoll: 3, anklePitch: 12, ankleYaw: 3 }),
      leftArm: armPose('left', { forwardBack: -58, raise: 65, twist: -7, elbowBend: 12, elbowDepth: -34, forearmTwist: -7, wristPitch: 4, wristRoll: 10 }),
      rightArm: armPose('right', { forwardBack: 52, raise: 81, twist: 7, elbowBend: 11, elbowDepth: 30, forearmTwist: 7, wristPitch: -3, wristRoll: -9 }),
    },
    positionOffsets: positionOffsets({
      rightKneeZ: -0.06, rightAnkleZ: -0.14, leftAnkleZ: 0.035,
    }),
  },
  {
    time: jogTime(4),
    semantic: {
      core: corePose({ hipPitch: -2, hipYaw: -2, hipRoll: -5.5, spinePitch: -8, spineYaw: 4, spineRoll: 2.4, neckPitch: 2.5 }),
      leftLeg: legPose({ hipPitch: 22, hipYaw: -1, hipRoll: -7, kneeBend: 22, anklePitch: -4, ankleRoll: 4 }),
      rightLeg: legPose({ hipPitch: -20, hipYaw: 1, hipRoll: 7, kneeBend: 42, kneeRoll: 2, anklePitch: 8, ankleRoll: -3 }),
      leftArm: armPose('left', { forwardBack: -34, raise: 68.5, twist: -5, elbowBend: 11, elbowDepth: -27, forearmTwist: -6, wristPitch: 3, wristRoll: 7 }),
      rightArm: armPose('right', { forwardBack: 32, raise: 78.5, twist: 5, elbowBend: 10, elbowDepth: 25, forearmTwist: 6, wristPitch: -2, wristRoll: -7 }),
    },
    positionOffsets: positionOffsets({
      rightKneeZ: -0.055, rightAnkleZ: -0.12,
    }),
  },
  {
    time: jogTime(8),
    semantic: {
      core: corePose({ hipPitch: -3, hipYaw: 0, hipRoll: 0, spinePitch: -10, spineYaw: 0, spineRoll: 0, neckPitch: 3 }),
      leftLeg: legPose({ hipPitch: -4, hipRoll: -6, kneeBend: 24, kneeRoll: -1, anklePitch: 5 }),
      rightLeg: legPose({ hipPitch: 16, hipRoll: 6, kneeBend: 68, kneeYaw: 3, kneeRoll: 4, anklePitch: -7 }),
      leftArm: armPose('left', { forwardBack: 6, raise: 72.8, elbowBend: 9, elbowDepth: -18, forearmTwist: -3, wristRoll: 2 }),
      rightArm: armPose('right', { forwardBack: -6, raise: 75.2, elbowBend: 9, elbowDepth: 18, forearmTwist: 3, wristRoll: -2 }),
    },
    positionOffsets: positionOffsets({
      rightKneeZ: -0.08, rightAnkleZ: -0.16,
    }),
  },
  {
    time: jogTime(12),
    semantic: {
      core: corePose({ hipPitch: -3, hipYaw: 4, hipRoll: 4, spinePitch: -9, spineYaw: -7.5, spineRoll: -2, neckPitch: 3, neckYaw: 1.5 }),
      leftLeg: legPose({ hipPitch: -34, hipYaw: -3, hipRoll: -5, kneeBend: 58, kneeYaw: -2, kneeRoll: -3, anklePitch: 12, ankleYaw: -3 }),
      rightLeg: legPose({ hipPitch: 46, hipYaw: 3, hipRoll: 6, kneeBend: 10, anklePitch: -9, ankleRoll: -3 }),
      leftArm: armPose('left', { forwardBack: 52, raise: 81, twist: 7, elbowBend: 11, elbowDepth: 30, forearmTwist: 7, wristPitch: -3, wristRoll: -9 }),
      rightArm: armPose('right', { forwardBack: -58, raise: 65, twist: -7, elbowBend: 12, elbowDepth: -34, forearmTwist: -7, wristPitch: 4, wristRoll: 10 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.06, leftAnkleZ: -0.14, rightAnkleZ: 0.035,
    }),
  },
  {
    time: jogTime(16),
    semantic: {
      core: corePose({ hipPitch: -2, hipYaw: 2, hipRoll: 5.5, spinePitch: -8, spineYaw: -4, spineRoll: -2.4, neckPitch: 2.5 }),
      leftLeg: legPose({ hipPitch: -20, hipYaw: -1, hipRoll: -7, kneeBend: 42, kneeRoll: -2, anklePitch: 8, ankleRoll: 3 }),
      rightLeg: legPose({ hipPitch: 22, hipYaw: 1, hipRoll: 7, kneeBend: 22, anklePitch: -4, ankleRoll: -4 }),
      leftArm: armPose('left', { forwardBack: 32, raise: 78.5, twist: 5, elbowBend: 10, elbowDepth: 25, forearmTwist: 6, wristPitch: -2, wristRoll: -7 }),
      rightArm: armPose('right', { forwardBack: -34, raise: 68.5, twist: -5, elbowBend: 11, elbowDepth: -27, forearmTwist: -6, wristPitch: 3, wristRoll: 7 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.055, leftAnkleZ: -0.12,
    }),
  },
  {
    time: jogTime(20),
    semantic: {
      core: corePose({ hipPitch: -3, hipYaw: 0, hipRoll: 0, spinePitch: -10, spineYaw: 0, spineRoll: 0, neckPitch: 3 }),
      leftLeg: legPose({ hipPitch: 16, hipRoll: -6, kneeBend: 68, kneeYaw: -3, kneeRoll: -4, anklePitch: -7 }),
      rightLeg: legPose({ hipPitch: -4, hipRoll: 6, kneeBend: 24, kneeRoll: 1, anklePitch: 5 }),
      leftArm: armPose('left', { forwardBack: -6, raise: 75.2, elbowBend: 9, elbowDepth: 18, forearmTwist: 3, wristRoll: -2 }),
      rightArm: armPose('right', { forwardBack: 6, raise: 72.8, elbowBend: 9, elbowDepth: -18, forearmTwist: -3, wristRoll: 2 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.08, leftAnkleZ: -0.16,
    }),
  },
];

export class LocomotionAnimator {
  constructor(mapper = new SemanticRigMapper()) {
    this.mapper = mapper;
    this.neutralSemanticPose = createNeutralSemanticPose();
    this.neutralPose = semanticFrameToPose(this.mapper, this.neutralSemanticPose, {});
    this.walkClip = createSemanticClip(this.mapper, this.neutralSemanticPose, {
      id: 'semanticWalk',
      duration: WALK_DURATION,
      keyframes: WALK_KEYFRAMES,
    });
    this.jogClip = createSemanticClip(this.mapper, this.neutralSemanticPose, {
      id: 'semanticJog',
      duration: JOG_DURATION,
      keyframes: JOG_KEYFRAMES,
    });
  }

  sample({
    phase = 0,
    moveAmount = 1,
    runBlend = 0,
    rightArmSwingScale = 1,
  } = {}) {
    const cycle = cycle01(phase);
    const walkPose = this.walkClip.sample(cycle * this.walkClip.duration);
    const jogPose = this.jogClip.sample(cycle * this.jogClip.duration);
    const locomotionPose = PoseMixer.interpolate(walkPose, jogPose, THREE.MathUtils.clamp(runBlend, 0, 1));
    const weightedPose = PoseMixer.interpolate(
      this.neutralPose,
      locomotionPose,
      THREE.MathUtils.clamp(moveAmount, 0, 1),
    );

    if (rightArmSwingScale < 0.999) {
      dampenRightArmSwing(weightedPose, this.neutralPose, rightArmSwingScale);
    }

    return weightedPose;
  }

  apply({
    rotationTargets,
    positionTargets,
    phase = 0,
    moveAmount = 1,
    runBlend = 0,
    rightArmSwingScale = 1,
    restPositionFor = () => null,
  } = {}) {
    const pose = this.sample({ phase, moveAmount, runBlend, rightArmSwingScale });

    for (const [name, value] of pose.rotations.entries()) {
      rotationTargets.set(name, value.clone());
    }

    for (const [name, offset] of pose.positions.entries()) {
      const restPosition = restPositionFor(name);

      if (!restPosition) {
        continue;
      }

      let target = positionTargets.get(name);
      if (!target) {
        target = new THREE.Vector3();
        positionTargets.set(name, target);
      }
      target.copy(restPosition).add(offset);
    }

    return pose;
  }
}
