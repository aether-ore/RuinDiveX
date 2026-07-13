import * as THREE from 'three';
import { degrees } from '../SemanticRigMapper.js';

export const UPPER_BODY_AIM_BLEND_IN_SPEED = 9;
export const UPPER_BODY_AIM_BLEND_OUT_SPEED = 6;

export class UpperBodyAimLayer {
  constructor(mapper) {
    this.mapper = mapper;
  }

  apply(targets, {
    weight = 0,
    attackProgress = 0,
    projectileAiming = false,
    backpedaling = false,
    lockOnActive = false,
    strafeAmount = 0,
    armSide = 'right',
  } = {}) {
    if (!this.mapper || weight <= 0.001) {
      return;
    }

    const aimWeight = THREE.MathUtils.clamp(weight, 0, 1);
    const strafeTwist = lockOnActive ? THREE.MathUtils.clamp(strafeAmount, -1, 1) : 0;
    const shotProgress = THREE.MathUtils.clamp(attackProgress / 0.26, 0, 1);
    const recoil = projectileAiming && attackProgress < 0.34
      ? Math.sin(shotProgress * Math.PI) * 0.55
      : 0;
    const sideSign = armSide === 'left' ? -1 : 1;

    this.mapper.addCorePose(targets, {
      hips: { pitch: backpedaling ? degrees(2) : 0, yaw: -degrees(2) * strafeTwist, roll: 0 },
      spine: {
        pitch: degrees(-2.8) - recoil * degrees(3.5),
        yaw: sideSign * (degrees(7) + degrees(4) * strafeTwist),
        roll: -sideSign * (degrees(1.6) + recoil * degrees(1.2)),
      },
      neck: {
        pitch: degrees(1),
        yaw: sideSign * (degrees(4) + degrees(2) * strafeTwist),
        roll: 0,
      },
    }, aimWeight);

    this.mapper.blendArmPose(targets, armSide, {
      armForwardBack: degrees(90) - recoil * degrees(5),
      armRaise: degrees(2) + recoil * degrees(3),
      armTwist: degrees(-3),
      elbowBend: degrees(5) + recoil * degrees(8),
      elbowDepth: degrees(2),
      forearmTwist: degrees(1),
      wristPitch: -recoil * degrees(2),
      wristYaw: 0,
      wristRoll: degrees(2),
    }, aimWeight);

    if (armSide === 'right') {
      this.mapper.blendArmPose(targets, 'left', {
        armForwardBack: degrees(-78),
        armRaise: degrees(48),
        armTwist: degrees(3),
        elbowBend: degrees(-52),
        elbowDepth: degrees(-66),
        forearmTwist: degrees(5),
        wristPitch: degrees(-10),
        wristYaw: degrees(-8),
        wristRoll: degrees(-20),
      }, aimWeight * 0.92);
    }
  }
}
