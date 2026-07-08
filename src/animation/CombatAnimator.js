import * as THREE from 'three';
import { degrees } from '../SemanticRigMapper.js';

const BEAM_BLADE_TOTAL_FRAMES = 24;

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

    this.mapper.blendJoint(
      targets,
      'hips',
      0,
      0,
      0,
      chamberWeight,
    );
    this.mapper.blendJoint(
      targets,
      'spine',
      degrees(-4),
      degrees(2),
      degrees(-2),
      chamberWeight,
    );
    this.mapper.blendJoint(targets, 'neck', 0, 0, 0, chamberWeight);
    this.mapper.blendJoint(targets, 'hips', -degrees(2) * strike, degrees(-16), -degrees(2) * strike, slashWeight);
    this.mapper.blendJoint(targets, 'spine', -degrees(4) * strike, degrees(-38), -degrees(5) * strike, slashWeight);
    this.mapper.blendJoint(targets, 'neck', 0, degrees(5), 0, Math.max(releaseWeight, slashWeight));

    this.mapper.blendArmPose(targets, 'right', {
      armForwardBack: degrees(78),
      armRaise: degrees(-5),
      armTwist: degrees(-2),
      forearmTwist: degrees(19),
      elbowDepth: degrees(107),
      elbowBend: degrees(-31),
      wristPitch: 0,
      wristYaw: 0,
      wristRoll: 0,
    }, chamberWeight);
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

    this.mapper.blendArmPose(targets, 'left', {
      armForwardBack: degrees(14),
      armRaise: degrees(55),
      armTwist: degrees(8),
      forearmTwist: degrees(11),
      elbowDepth: degrees(-72),
      elbowBend: degrees(-7),
      wristPitch: 0,
      wristYaw: 0,
      wristRoll: 0,
    }, chamberWeight);
    this.mapper.blendArmPose(targets, 'left', {
      armForwardBack: degrees(-10),
      armRaise: degrees(48),
      elbowBend: degrees(18),
    }, slashWeight * 0.55);

    this.mapper.blendJoint(targets, 'leftHip', degrees(-45), degrees(-5), degrees(-7), chamberWeight);
    this.mapper.blendJoint(targets, 'leftKnee', degrees(62), degrees(-5), degrees(-2), chamberWeight);
    this.mapper.blendJoint(targets, 'leftAnkle', degrees(-14), degrees(11), degrees(2), chamberWeight);
    this.mapper.blendJoint(targets, 'rightHip', degrees(14), degrees(-42), degrees(-2), chamberWeight);
    this.mapper.blendJoint(targets, 'rightKnee', 0, degrees(-4), 0, chamberWeight);
    this.mapper.blendJoint(targets, 'rightAnkle', 0, 0, 0, chamberWeight);
    this.mapper.blendJoint(targets, 'leftHip', degrees(-35), 0, degrees(10), slashWeight);
    this.mapper.blendJoint(targets, 'leftKnee', degrees(52) + strike * degrees(10), 0, 0, slashWeight);
    this.mapper.blendJoint(targets, 'rightHip', degrees(-8), 0, degrees(-12), slashWeight);
    this.mapper.blendJoint(targets, 'rightKnee', degrees(20), 0, 0, slashWeight);
  }
}
