import * as THREE from 'three';
import { degrees, semanticPoseDegreesToRadians } from '../SemanticRigMapper.js';

const BEAM_BLADE_TOTAL_FRAMES = 24;
const BEAM_BLADE_CHAMBER_POSE = semanticPoseDegreesToRadians({
  core: {
    hips: { pitch: 0, yaw: 0, roll: 0 },
    spine: { pitch: -4, yaw: 2, roll: -2 },
    neck: { pitch: 0, yaw: 0, roll: 0 },
  },
  leftArm: {
    armTwist: 8,
    armForwardBack: 14,
    armRaise: 55,
    forearmTwist: 11,
    elbowDepth: -72,
    elbowBend: -7,
    wristPitch: 0,
    wristYaw: 0,
    wristRoll: 0,
  },
  rightArm: {
    armTwist: -2,
    armForwardBack: 78,
    armRaise: -5,
    forearmTwist: 19,
    elbowDepth: 107,
    elbowBend: -31,
    wristPitch: 0,
    wristYaw: 0,
    wristRoll: 0,
  },
  leftLeg: {
    hipPitch: -45,
    hipYaw: -5,
    hipRoll: -7,
    kneeBend: 62,
    kneeYaw: -5,
    kneeRoll: -2,
    anklePitch: -14,
    ankleYaw: 11,
    ankleRoll: 2,
  },
  rightLeg: {
    hipPitch: 14,
    hipYaw: -42,
    hipRoll: -2,
    kneeBend: 0,
    kneeYaw: -4,
    kneeRoll: 0,
    anklePitch: 0,
    ankleYaw: 0,
    ankleRoll: 0,
  },
});

export class CombatAnimator {
  constructor(mapper) {
    this.mapper = mapper;
  }

  applyMelee(targets, attackProgress = 0) {
    if (!this.mapper) {
      return;
    }

    const progress = THREE.MathUtils.clamp(attackProgress, 0, 1);
    const swing = Math.sin(progress * Math.PI);
    const followThrough = Math.sin(progress * Math.PI * 0.5);

    this.mapper.addCorePose(targets, {
      spine: { pitch: 0, yaw: -degrees(8) * swing, roll: -degrees(3) * swing },
    });
    this.mapper.addArmPose(targets, 'right', {
      armForwardBack: -degrees(54) * swing,
      armRaise: -degrees(16) * followThrough,
      elbowBend: degrees(22) * swing,
      wristRoll: -degrees(14) * swing,
    });
    this.mapper.addArmPose(targets, 'left', {
      armForwardBack: degrees(12) * swing,
      armRaise: degrees(6) * swing,
      elbowBend: degrees(5) * swing,
    });
  }

  applyBeamBladeSlash(targets, attackProgress = 0) {
    if (!this.mapper) {
      return;
    }

    const attackFrame = THREE.MathUtils.clamp(attackProgress, 0, 1) * BEAM_BLADE_TOTAL_FRAMES;
    const release = THREE.MathUtils.smoothstep(attackFrame, 9, 12);
    const slash = THREE.MathUtils.smoothstep(attackFrame, 12, 16);
    const followThrough = THREE.MathUtils.smoothstep(attackFrame, 16, 19);
    const recovery = THREE.MathUtils.smoothstep(attackFrame, 19, 24);
    const committed = 1 - recovery;
    const strike = Math.sin(slash * Math.PI);
    const chamberWeight = (1 - release) * committed;
    const releaseWeight = release * committed;
    const slashWeight = slash * committed;
    const followWeight = followThrough * committed;

    this.mapper.blendCorePose(targets, BEAM_BLADE_CHAMBER_POSE.core, chamberWeight);
    this.mapper.blendJoint(targets, 'hips', -degrees(2) * strike, degrees(-16), -degrees(2) * strike, slashWeight);
    this.mapper.blendJoint(targets, 'spine', -degrees(4) * strike, degrees(-38), -degrees(5) * strike, slashWeight);
    this.mapper.blendJoint(targets, 'neck', 0, degrees(5), 0, Math.max(releaseWeight, slashWeight));

    this.mapper.blendArmPose(targets, 'right', BEAM_BLADE_CHAMBER_POSE.rightArm, chamberWeight);
    this.mapper.blendArmPose(targets, 'right', {
      armForwardBack: degrees(-28),
      armRaise: degrees(-8),
      armTwist: degrees(-4),
      elbowBend: degrees(10),
      elbowDepth: degrees(0),
      wristYaw: degrees(0),
      wristRoll: degrees(0),
    }, releaseWeight);
    this.mapper.blendArmPose(targets, 'right', {
      armForwardBack: degrees(-84),
      armRaise: degrees(-8) - strike * degrees(2),
      armTwist: degrees(-4),
      elbowBend: degrees(3),
      elbowDepth: degrees(0),
      wristYaw: degrees(0),
      wristRoll: degrees(0),
    }, slashWeight);
    this.mapper.blendArmPose(targets, 'right', {
      armForwardBack: degrees(-112),
      armRaise: degrees(-6),
      armTwist: degrees(-4),
      elbowBend: degrees(3),
      elbowDepth: degrees(0),
      wristYaw: degrees(2),
      wristRoll: degrees(0),
    }, followWeight);

    this.mapper.blendArmPose(targets, 'left', BEAM_BLADE_CHAMBER_POSE.leftArm, chamberWeight);
    this.mapper.blendArmPose(targets, 'left', {
      armForwardBack: degrees(-10),
      armRaise: degrees(48),
      elbowBend: degrees(18),
    }, slashWeight * 0.55);

    this.mapper.blendLegPose(targets, 'left', BEAM_BLADE_CHAMBER_POSE.leftLeg, chamberWeight);
    this.mapper.blendLegPose(targets, 'right', BEAM_BLADE_CHAMBER_POSE.rightLeg, chamberWeight);
    this.mapper.blendJoint(targets, 'leftHip', degrees(-35), 0, degrees(10), slashWeight);
    this.mapper.blendJoint(targets, 'leftKnee', degrees(52) + strike * degrees(10), 0, 0, slashWeight);
    this.mapper.blendJoint(targets, 'rightHip', degrees(-8), 0, degrees(-12), slashWeight);
    this.mapper.blendJoint(targets, 'rightKnee', degrees(20), 0, 0, slashWeight);
  }
}
