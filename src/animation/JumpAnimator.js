import * as THREE from 'three';
import { degrees } from '../SemanticRigMapper.js';

export class JumpAnimator {
  constructor(mapper) {
    this.mapper = mapper;
  }

  apply(targets, state = 'neutralJump', progress = 0) {
    if (!this.mapper) {
      return;
    }

    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const crouch = state === 'land' ? 1 - p : 1 - THREE.MathUtils.smoothstep(p, 0.05, 0.28);
    const airborne = state === 'fall' ? 1 : THREE.MathUtils.smoothstep(p, 0.18, 0.55);
    const landing = state === 'land' ? 1 - p : THREE.MathUtils.smoothstep(p, 0.76, 1);
    const balance = Math.sin(p * Math.PI);
    const forward = state === 'forwardJump' ? 1 : 0;

    this.mapper.addCorePose(targets, {
      hips: { pitch: degrees(9) * forward - degrees(7) * crouch - degrees(3) * landing, yaw: 0, roll: 0 },
      spine: { pitch: degrees(10) * forward - degrees(5) * crouch + degrees(3) * balance, yaw: 0, roll: degrees(1.5) * balance },
      neck: { pitch: -degrees(3) * landing + degrees(2) * airborne, yaw: 0, roll: 0 },
    });
    this.mapper.addLegPose(targets, 'left', {
      hipPitch: degrees(18) * forward - degrees(8) * airborne,
      kneeBend: degrees(44) * crouch + degrees(12) * airborne + degrees(38) * landing,
      anklePitch: -degrees(10) * crouch - degrees(6) * landing,
    });
    this.mapper.addLegPose(targets, 'right', {
      hipPitch: degrees(18) * forward - degrees(8) * airborne,
      kneeBend: degrees(44) * crouch + degrees(12) * airborne + degrees(38) * landing,
      anklePitch: -degrees(10) * crouch - degrees(6) * landing,
    });
    this.mapper.addArmPose(targets, 'left', {
      armForwardBack: degrees(10) * airborne - degrees(8) * landing,
      armRaise: -degrees(14) * airborne,
      elbowBend: degrees(8) * balance,
    });
    this.mapper.addArmPose(targets, 'right', {
      armForwardBack: -degrees(7) * airborne + degrees(4) * landing,
      armRaise: -degrees(10) * airborne,
      elbowBend: degrees(6) * balance,
    });
  }
}
