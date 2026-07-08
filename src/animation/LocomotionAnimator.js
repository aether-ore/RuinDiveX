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
const FOREARM_CARRY_AXIS_SIGN = 1;
const ARM_RAISE_NEUTRAL_DEGREES = 74;
const ARM_RAISE_OFFSET_SIGN = -2.15;
const MIN_LOCOMOTION_ARM_SWING_DEGREES = 18;
const MIN_LOCOMOTION_ELBOW_BEND_DEGREES = 32;
const LOCOMOTION_SHOULDER_SWING_X_SCALE = 1;
const LOCOMOTION_ELBOW_DEPTH_SCALE = 0;
const LOCOMOTION_FOREARM_TWIST_SCALE = 0;
const LOCOMOTION_WRIST_PITCH_SCALE = 0;
const LOCOMOTION_WRIST_ROLL_SCALE = 0;

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

function withMinimumMagnitude(value, minimum, fallbackSign = 1) {
  const sign = Math.sign(value) || Math.sign(fallbackSign) || 1;
  return sign * Math.max(Math.abs(value), minimum);
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
  const carriedForwardBack = withMinimumMagnitude(
    forwardBack,
    MIN_LOCOMOTION_ARM_SWING_DEGREES,
    elbowDepth,
  );
  const carriedElbowBend = Math.max(Math.abs(elbowBend), MIN_LOCOMOTION_ELBOW_BEND_DEGREES);

  return {
    armForwardBack: 0,
    armRaise: degrees(ARM_RAISE_NEUTRAL_DEGREES + ((raise - ARM_RAISE_NEUTRAL_DEGREES) * ARM_RAISE_OFFSET_SIGN)),
    armTwist: degrees(carriedForwardBack * LOCOMOTION_SHOULDER_SWING_X_SCALE),
    elbowBend: degrees(carriedElbowBend),
    elbowDepth: degrees(elbowDepth * LOCOMOTION_ELBOW_DEPTH_SCALE * FOREARM_CARRY_AXIS_SIGN * sideAxisSign),
    forearmTwist: degrees(forearmTwist * LOCOMOTION_FOREARM_TWIST_SCALE),
    wristPitch: degrees(wristPitch * LOCOMOTION_WRIST_PITCH_SCALE),
    wristYaw: degrees(wristYaw),
    wristRoll: degrees(wristRoll * LOCOMOTION_WRIST_ROLL_SCALE),
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
      core: corePose({ hipPitch: -2, hipYaw: -4, hipRoll: -3, spinePitch: -4, spineYaw: 7, spineRoll: 1.8, neckPitch: 1.2, neckYaw: -1 }),
      leftLeg: legPose({ hipPitch: 34, hipYaw: -1, hipRoll: -5, kneeBend: 12, anklePitch: -8, ankleYaw: -1, ankleRoll: 2 }),
      rightLeg: legPose({ hipPitch: -29, hipYaw: 2, hipRoll: 5, kneeBend: 58, kneeYaw: 1, kneeRoll: 2, anklePitch: 16, ankleYaw: 2, ankleRoll: -2 }),
      leftArm: armPose('left', { forwardBack: -36, raise: 69.5, twist: -4, elbowBend: 9, elbowDepth: -26, forearmTwist: -5, wristPitch: 3, wristRoll: 7 }),
      rightArm: armPose('right', { forwardBack: 34, raise: 78.5, twist: 4, elbowBend: 8, elbowDepth: 23, forearmTwist: 5, wristPitch: -2, wristRoll: -6 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.02, leftAnkleZ: -0.06, rightKneeZ: 0.055, rightAnkleZ: 0.12,
    }),
  },
  {
    time: walkTime(4.5),
    semantic: {
      core: corePose({ hipPitch: -1.5, hipYaw: -2, hipRoll: -4.5, spinePitch: -3.2, spineYaw: 4, spineRoll: 2.4, neckPitch: 0.8 }),
      leftLeg: legPose({ hipPitch: 19, hipYaw: -1, hipRoll: -6, kneeBend: 16, anklePitch: -4, ankleRoll: 3 }),
      rightLeg: legPose({ hipPitch: -18, hipYaw: 1, hipRoll: 6, kneeBend: 72, kneeYaw: 1, kneeRoll: 2, anklePitch: 13, ankleRoll: -2 }),
      leftArm: armPose('left', { forwardBack: -25, raise: 71, twist: -3, elbowBend: 10, elbowDepth: -22, forearmTwist: -4, wristPitch: 2, wristRoll: 5 }),
      rightArm: armPose('right', { forwardBack: 24, raise: 77, twist: 3, elbowBend: 9, elbowDepth: 20, forearmTwist: 4, wristPitch: -1.5, wristRoll: -5 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.015, leftAnkleZ: -0.04, rightKneeZ: 0.035, rightAnkleZ: 0.075,
    }),
  },
  {
    time: walkTime(7.5),
    semantic: {
      core: corePose({ hipPitch: -2.5, hipYaw: -0.5, hipRoll: -1.5, spinePitch: -5.2, spineYaw: 1.5, spineRoll: 0.8, neckPitch: 1.8 }),
      leftLeg: legPose({ hipPitch: -28, hipYaw: 0, hipRoll: -5, kneeBend: 6, kneeYaw: -1, kneeRoll: -1, anklePitch: -4, ankleRoll: 1 }),
      rightLeg: legPose({ hipPitch: 24, hipYaw: 0, hipRoll: 5, kneeBend: 82, kneeYaw: 2, kneeRoll: 3, anklePitch: -8, ankleRoll: -2 }),
      leftArm: armPose('left', { forwardBack: -3, raise: 73, elbowBend: 8, elbowDepth: -16, forearmTwist: -2.5, wristRoll: 3 }),
      rightArm: armPose('right', { forwardBack: 3, raise: 75, elbowBend: 8, elbowDepth: 16, forearmTwist: 2.5, wristRoll: -3 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: 0.045, leftAnkleZ: 0.14, rightKneeZ: -0.06, rightAnkleZ: -0.09,
    }),
  },
  {
    time: walkTime(9),
    semantic: {
      core: corePose({ hipPitch: -3, hipYaw: 0, hipRoll: 0, spinePitch: -5, spineYaw: 0, spineRoll: 0, neckPitch: 1.5 }),
      leftLeg: legPose({ hipPitch: -13, hipYaw: 0, hipRoll: -5, kneeBend: 13, kneeYaw: -1, kneeRoll: -1, anklePitch: 1, ankleRoll: 1 }),
      rightLeg: legPose({ hipPitch: 20, hipYaw: 0, hipRoll: 5, kneeBend: 80, kneeYaw: 2, kneeRoll: 3, anklePitch: -8 }),
      leftArm: armPose('left', { forwardBack: 5, raise: 73.5, elbowBend: 8, elbowDepth: -14, forearmTwist: -2, wristRoll: 2 }),
      rightArm: armPose('right', { forwardBack: -5, raise: 74.5, elbowBend: 8, elbowDepth: 14, forearmTwist: 2, wristRoll: -2 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: 0.01, leftAnkleZ: 0.025, rightKneeZ: -0.06, rightAnkleZ: -0.085,
    }),
  },
  {
    time: walkTime(13.5),
    semantic: {
      core: corePose({ hipPitch: -2, hipYaw: 4, hipRoll: 3, spinePitch: -4, spineYaw: -7, spineRoll: -1.8, neckPitch: 1.2, neckYaw: 1 }),
      leftLeg: legPose({ hipPitch: -31, hipYaw: -2, hipRoll: -5, kneeBend: 48, kneeYaw: -2, kneeRoll: -2, anklePitch: 12, ankleYaw: -2 }),
      rightLeg: legPose({ hipPitch: 36, hipYaw: 1, hipRoll: 5, kneeBend: 18, anklePitch: -10, ankleYaw: 1, ankleRoll: -2 }),
      leftArm: armPose('left', { forwardBack: 28, raise: 77.5, twist: 3.5, elbowBend: 8, elbowDepth: 21, forearmTwist: 4, wristPitch: -2, wristRoll: -6 }),
      rightArm: armPose('right', { forwardBack: -30, raise: 70.5, twist: -3.5, elbowBend: 10, elbowDepth: -24, forearmTwist: -5, wristPitch: 3, wristRoll: 7 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: 0.055, leftAnkleZ: 0.12, rightKneeZ: -0.025, rightAnkleZ: -0.075,
    }),
  },
  {
    time: walkTime(18),
    semantic: {
      core: corePose({ hipPitch: -2, hipYaw: 4, hipRoll: 3, spinePitch: -4, spineYaw: -7, spineRoll: -1.8, neckPitch: 1.2, neckYaw: 1 }),
      leftLeg: legPose({ hipPitch: -29, hipYaw: -2, hipRoll: -5, kneeBend: 58, kneeYaw: -1, kneeRoll: -2, anklePitch: 16, ankleYaw: -2, ankleRoll: 2 }),
      rightLeg: legPose({ hipPitch: 34, hipYaw: 1, hipRoll: 5, kneeBend: 12, anklePitch: -8, ankleYaw: 1, ankleRoll: -2 }),
      leftArm: armPose('left', { forwardBack: 34, raise: 78.5, twist: 4, elbowBend: 8, elbowDepth: 23, forearmTwist: 5, wristPitch: -2, wristRoll: -6 }),
      rightArm: armPose('right', { forwardBack: -36, raise: 69.5, twist: -4, elbowBend: 9, elbowDepth: -26, forearmTwist: -5, wristPitch: 3, wristRoll: 7 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: 0.055, leftAnkleZ: 0.12, rightKneeZ: -0.02, rightAnkleZ: -0.06,
    }),
  },
  {
    time: walkTime(22.5),
    semantic: {
      core: corePose({ hipPitch: -1.5, hipYaw: 2, hipRoll: 4.5, spinePitch: -3.2, spineYaw: -4, spineRoll: -2.4, neckPitch: 0.8 }),
      leftLeg: legPose({ hipPitch: -18, hipYaw: -1, hipRoll: -6, kneeBend: 72, kneeYaw: -1, kneeRoll: -2, anklePitch: 13, ankleRoll: 2 }),
      rightLeg: legPose({ hipPitch: 19, hipYaw: 1, hipRoll: 6, kneeBend: 16, anklePitch: -4, ankleRoll: -3 }),
      leftArm: armPose('left', { forwardBack: 24, raise: 77, twist: 3, elbowBend: 9, elbowDepth: 20, forearmTwist: 4, wristPitch: -1.5, wristRoll: -5 }),
      rightArm: armPose('right', { forwardBack: -25, raise: 71, twist: -3, elbowBend: 10, elbowDepth: -22, forearmTwist: -4, wristPitch: 2, wristRoll: 5 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: 0.035, leftAnkleZ: 0.075, rightKneeZ: -0.015, rightAnkleZ: -0.04,
    }),
  },
  {
    time: walkTime(25.5),
    semantic: {
      core: corePose({ hipPitch: -2.5, hipYaw: 0.5, hipRoll: 1.5, spinePitch: -5.2, spineYaw: -1.5, spineRoll: -0.8, neckPitch: 1.8 }),
      leftLeg: legPose({ hipPitch: 24, hipYaw: 0, hipRoll: -5, kneeBend: 82, kneeYaw: -2, kneeRoll: -3, anklePitch: -8, ankleRoll: 2 }),
      rightLeg: legPose({ hipPitch: -28, hipYaw: 0, hipRoll: 5, kneeBend: 6, kneeYaw: 1, kneeRoll: 1, anklePitch: -4, ankleRoll: -1 }),
      leftArm: armPose('left', { forwardBack: 3, raise: 75, elbowBend: 8, elbowDepth: 16, forearmTwist: 2.5, wristRoll: -3 }),
      rightArm: armPose('right', { forwardBack: -3, raise: 73, elbowBend: 8, elbowDepth: -16, forearmTwist: -2.5, wristRoll: 3 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.06, leftAnkleZ: -0.09, rightKneeZ: 0.045, rightAnkleZ: 0.14,
    }),
  },
  {
    time: walkTime(27),
    semantic: {
      core: corePose({ hipPitch: -3, hipYaw: 0, hipRoll: 0, spinePitch: -5, spineYaw: 0, spineRoll: 0, neckPitch: 1.5 }),
      leftLeg: legPose({ hipPitch: 20, hipYaw: 0, hipRoll: -5, kneeBend: 80, kneeYaw: -2, kneeRoll: -3, anklePitch: -8 }),
      rightLeg: legPose({ hipPitch: -13, hipYaw: 0, hipRoll: 5, kneeBend: 13, kneeYaw: 1, kneeRoll: 1, anklePitch: 1, ankleRoll: -1 }),
      leftArm: armPose('left', { forwardBack: -5, raise: 74.5, elbowBend: 8, elbowDepth: 14, forearmTwist: 2, wristRoll: -2 }),
      rightArm: armPose('right', { forwardBack: 5, raise: 73.5, elbowBend: 8, elbowDepth: -14, forearmTwist: -2, wristRoll: 2 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.06, leftAnkleZ: -0.085, rightKneeZ: 0.01, rightAnkleZ: 0.025,
    }),
  },
  {
    time: walkTime(31.5),
    semantic: {
      core: corePose({ hipPitch: -2, hipYaw: -4, hipRoll: -3, spinePitch: -4, spineYaw: 7, spineRoll: 1.8, neckPitch: 1.2, neckYaw: -1 }),
      leftLeg: legPose({ hipPitch: 36, hipYaw: -1, hipRoll: -5, kneeBend: 18, anklePitch: -10, ankleYaw: -1, ankleRoll: 2 }),
      rightLeg: legPose({ hipPitch: -31, hipYaw: 2, hipRoll: 5, kneeBend: 48, kneeYaw: 2, kneeRoll: 2, anklePitch: 12, ankleYaw: 2, ankleRoll: -2 }),
      leftArm: armPose('left', { forwardBack: -30, raise: 70.5, twist: -3.5, elbowBend: 10, elbowDepth: -24, forearmTwist: -5, wristPitch: 3, wristRoll: 7 }),
      rightArm: armPose('right', { forwardBack: 28, raise: 77.5, twist: 3.5, elbowBend: 8, elbowDepth: 21, forearmTwist: 4, wristPitch: -2, wristRoll: -6 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.025, leftAnkleZ: -0.075, rightKneeZ: 0.055, rightAnkleZ: 0.12,
    }),
  },
];

const JOG_KEYFRAMES = [
  {
    time: jogTime(0),
    semantic: {
      core: corePose({ hipPitch: -5, hipYaw: -5, hipRoll: -4, spinePitch: -11, spineYaw: 8.5, spineRoll: 2.5, neckPitch: 3.5, neckYaw: -1.5 }),
      leftLeg: legPose({ hipPitch: 54, hipYaw: -3, hipRoll: -6, kneeBend: 12, anklePitch: -12, ankleRoll: 3 }),
      rightLeg: legPose({ hipPitch: -43, hipYaw: 3, hipRoll: 6, kneeBend: 82, kneeYaw: 2, kneeRoll: 3, anklePitch: 22, ankleYaw: 3 }),
      leftArm: armPose('left', { forwardBack: -58, raise: 65, twist: -7, elbowBend: 12, elbowDepth: -34, forearmTwist: -7, wristPitch: 4, wristRoll: 10 }),
      rightArm: armPose('right', { forwardBack: 52, raise: 81, twist: 7, elbowBend: 11, elbowDepth: 30, forearmTwist: 7, wristPitch: -3, wristRoll: -9 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.035, leftAnkleZ: -0.11, rightKneeZ: 0.09, rightAnkleZ: 0.18,
    }),
  },
  {
    time: jogTime(3),
    semantic: {
      core: corePose({ hipPitch: -4, hipYaw: -2, hipRoll: -5.8, spinePitch: -10, spineYaw: 4.5, spineRoll: 2.8, neckPitch: 3 }),
      leftLeg: legPose({ hipPitch: 28, hipYaw: -1, hipRoll: -7, kneeBend: 22, anklePitch: -5, ankleRoll: 4 }),
      rightLeg: legPose({ hipPitch: -26, hipYaw: 1, hipRoll: 7, kneeBend: 88, kneeRoll: 2, anklePitch: 18, ankleRoll: -3 }),
      leftArm: armPose('left', { forwardBack: -39, raise: 68, twist: -5.5, elbowBend: 12, elbowDepth: -29, forearmTwist: -6, wristPitch: 3, wristRoll: 8 }),
      rightArm: armPose('right', { forwardBack: 36, raise: 79, twist: 5.5, elbowBend: 10, elbowDepth: 26, forearmTwist: 6, wristPitch: -2, wristRoll: -7 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.02, leftAnkleZ: -0.065, rightKneeZ: 0.055, rightAnkleZ: 0.13,
    }),
  },
  {
    time: jogTime(5),
    semantic: {
      core: corePose({ hipPitch: -5.5, hipYaw: -0.5, hipRoll: -1.5, spinePitch: -13.5, spineYaw: 1.5, spineRoll: 0.9, neckPitch: 3.8 }),
      leftLeg: legPose({ hipPitch: -36, hipYaw: 0, hipRoll: -6, kneeBend: 5, kneeYaw: -1, kneeRoll: -1, anklePitch: -6, ankleRoll: 2 }),
      rightLeg: legPose({ hipPitch: 31, hipYaw: 0, hipRoll: 6, kneeBend: 96, kneeYaw: 3, kneeRoll: 4, anklePitch: -10, ankleRoll: -3 }),
      leftArm: armPose('left', { forwardBack: 1, raise: 72, elbowBend: 10, elbowDepth: -24, forearmTwist: -3.5, wristRoll: 3 }),
      rightArm: armPose('right', { forwardBack: -1, raise: 76, elbowBend: 10, elbowDepth: 24, forearmTwist: 3.5, wristRoll: -3 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: 0.06, leftAnkleZ: 0.18, rightKneeZ: -0.085, rightAnkleZ: -0.12,
    }),
  },
  {
    time: jogTime(6),
    semantic: {
      core: corePose({ hipPitch: -6, hipYaw: 0, hipRoll: 0, spinePitch: -13, spineYaw: 0, spineRoll: 0, neckPitch: 3.6 }),
      leftLeg: legPose({ hipPitch: -17, hipRoll: -6, kneeBend: 12, kneeRoll: -1, anklePitch: 0, ankleRoll: 1 }),
      rightLeg: legPose({ hipPitch: 29, hipRoll: 6, kneeBend: 94, kneeYaw: 3, kneeRoll: 4, anklePitch: -10 }),
      leftArm: armPose('left', { forwardBack: 6, raise: 72.8, elbowBend: 10, elbowDepth: -20, forearmTwist: -3, wristRoll: 2 }),
      rightArm: armPose('right', { forwardBack: -6, raise: 75.2, elbowBend: 10, elbowDepth: 20, forearmTwist: 3, wristRoll: -2 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: 0.015, leftAnkleZ: 0.035, rightKneeZ: -0.085, rightAnkleZ: -0.115,
    }),
  },
  {
    time: jogTime(9),
    semantic: {
      core: corePose({ hipPitch: -5, hipYaw: 5, hipRoll: 4, spinePitch: -11, spineYaw: -8.5, spineRoll: -2.5, neckPitch: 3.5, neckYaw: 1.5 }),
      leftLeg: legPose({ hipPitch: -44, hipYaw: -3, hipRoll: -6, kneeBend: 74, kneeYaw: -2, kneeRoll: -3, anklePitch: 20, ankleYaw: -3 }),
      rightLeg: legPose({ hipPitch: 52, hipYaw: 3, hipRoll: 6, kneeBend: 18, anklePitch: -13, ankleRoll: -3 }),
      leftArm: armPose('left', { forwardBack: 46, raise: 80, twist: 6.5, elbowBend: 11, elbowDepth: 29, forearmTwist: 7, wristPitch: -3, wristRoll: -9 }),
      rightArm: armPose('right', { forwardBack: -52, raise: 66, twist: -6.5, elbowBend: 12, elbowDepth: -32, forearmTwist: -7, wristPitch: 4, wristRoll: 10 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: 0.09, leftAnkleZ: 0.18, rightKneeZ: -0.035, rightAnkleZ: -0.11,
    }),
  },
  {
    time: jogTime(12),
    semantic: {
      core: corePose({ hipPitch: -5, hipYaw: 5, hipRoll: 4, spinePitch: -11, spineYaw: -8.5, spineRoll: -2.5, neckPitch: 3.5, neckYaw: 1.5 }),
      leftLeg: legPose({ hipPitch: -43, hipYaw: -3, hipRoll: -6, kneeBend: 82, kneeYaw: -2, kneeRoll: -3, anklePitch: 22, ankleYaw: -3, ankleRoll: 3 }),
      rightLeg: legPose({ hipPitch: 54, hipYaw: 3, hipRoll: 6, kneeBend: 12, anklePitch: -12, ankleRoll: -3 }),
      leftArm: armPose('left', { forwardBack: 52, raise: 81, twist: 7, elbowBend: 11, elbowDepth: 30, forearmTwist: 7, wristPitch: -3, wristRoll: -9 }),
      rightArm: armPose('right', { forwardBack: -58, raise: 65, twist: -7, elbowBend: 12, elbowDepth: -34, forearmTwist: -7, wristPitch: 4, wristRoll: 10 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: 0.09, leftAnkleZ: 0.18, rightKneeZ: -0.035, rightAnkleZ: -0.11,
    }),
  },
  {
    time: jogTime(15),
    semantic: {
      core: corePose({ hipPitch: -4, hipYaw: 2, hipRoll: 5.8, spinePitch: -10, spineYaw: -4.5, spineRoll: -2.8, neckPitch: 3 }),
      leftLeg: legPose({ hipPitch: -26, hipYaw: -1, hipRoll: -7, kneeBend: 88, kneeRoll: -2, anklePitch: 18, ankleRoll: 3 }),
      rightLeg: legPose({ hipPitch: 28, hipYaw: 1, hipRoll: 7, kneeBend: 22, anklePitch: -5, ankleRoll: -4 }),
      leftArm: armPose('left', { forwardBack: 36, raise: 79, twist: 5.5, elbowBend: 10, elbowDepth: 26, forearmTwist: 6, wristPitch: -2, wristRoll: -7 }),
      rightArm: armPose('right', { forwardBack: -39, raise: 68, twist: -5.5, elbowBend: 12, elbowDepth: -29, forearmTwist: -6, wristPitch: 3, wristRoll: 8 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: 0.055, leftAnkleZ: 0.13, rightKneeZ: -0.02, rightAnkleZ: -0.065,
    }),
  },
  {
    time: jogTime(17),
    semantic: {
      core: corePose({ hipPitch: -5.5, hipYaw: 0.5, hipRoll: 1.5, spinePitch: -13.5, spineYaw: -1.5, spineRoll: -0.9, neckPitch: 3.8 }),
      leftLeg: legPose({ hipPitch: 31, hipYaw: 0, hipRoll: -6, kneeBend: 96, kneeYaw: -3, kneeRoll: -4, anklePitch: -10, ankleRoll: 3 }),
      rightLeg: legPose({ hipPitch: -36, hipYaw: 0, hipRoll: 6, kneeBend: 5, kneeYaw: 1, kneeRoll: 1, anklePitch: -6, ankleRoll: -2 }),
      leftArm: armPose('left', { forwardBack: -1, raise: 76, elbowBend: 10, elbowDepth: 24, forearmTwist: 3.5, wristRoll: -3 }),
      rightArm: armPose('right', { forwardBack: 1, raise: 72, elbowBend: 10, elbowDepth: -24, forearmTwist: -3.5, wristRoll: 3 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.085, leftAnkleZ: -0.12, rightKneeZ: 0.06, rightAnkleZ: 0.18,
    }),
  },
  {
    time: jogTime(18),
    semantic: {
      core: corePose({ hipPitch: -6, hipYaw: 0, hipRoll: 0, spinePitch: -13, spineYaw: 0, spineRoll: 0, neckPitch: 3.6 }),
      leftLeg: legPose({ hipPitch: 29, hipRoll: -6, kneeBend: 94, kneeYaw: -3, kneeRoll: -4, anklePitch: -10 }),
      rightLeg: legPose({ hipPitch: -17, hipRoll: 6, kneeBend: 12, kneeRoll: 1, anklePitch: 0, ankleRoll: -1 }),
      leftArm: armPose('left', { forwardBack: -6, raise: 75.2, elbowBend: 10, elbowDepth: 20, forearmTwist: 3, wristRoll: -2 }),
      rightArm: armPose('right', { forwardBack: 6, raise: 72.8, elbowBend: 10, elbowDepth: -20, forearmTwist: -3, wristRoll: 2 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.085, leftAnkleZ: -0.115, rightKneeZ: 0.015, rightAnkleZ: 0.035,
    }),
  },
  {
    time: jogTime(21),
    semantic: {
      core: corePose({ hipPitch: -5, hipYaw: -5, hipRoll: -4, spinePitch: -11, spineYaw: 8.5, spineRoll: 2.5, neckPitch: 3.5, neckYaw: -1.5 }),
      leftLeg: legPose({ hipPitch: 52, hipYaw: -3, hipRoll: -6, kneeBend: 18, anklePitch: -13, ankleRoll: 3 }),
      rightLeg: legPose({ hipPitch: -44, hipYaw: 3, hipRoll: 6, kneeBend: 74, kneeYaw: 2, kneeRoll: 3, anklePitch: 20, ankleYaw: 3 }),
      leftArm: armPose('left', { forwardBack: -52, raise: 66, twist: -6.5, elbowBend: 12, elbowDepth: -32, forearmTwist: -7, wristPitch: 4, wristRoll: 10 }),
      rightArm: armPose('right', { forwardBack: 46, raise: 80, twist: 6.5, elbowBend: 11, elbowDepth: 29, forearmTwist: 7, wristPitch: -3, wristRoll: -9 }),
    },
    positionOffsets: positionOffsets({
      leftKneeZ: -0.035, leftAnkleZ: -0.11, rightKneeZ: 0.09, rightAnkleZ: 0.18,
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
