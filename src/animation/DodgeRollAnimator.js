import * as THREE from 'three';
import { degrees } from '../SemanticRigMapper.js';

export class DodgeRollAnimator {
  constructor(mapper) {
    this.mapper = mapper;
  }

  apply(targets, progress = 0) {
    if (!this.mapper) {
      return;
    }

    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const tuck = Math.sin(p * Math.PI);
    const launch = THREE.MathUtils.smoothstep(p, 0, 0.22);
    const exit = THREE.MathUtils.smoothstep(p, 0.68, 1);

    this.mapper.addCorePose(targets, {
      hips: { pitch: degrees(34) * tuck - degrees(6) * exit, yaw: 0, roll: degrees(360) * p },
      spine: { pitch: degrees(38) * tuck, yaw: degrees(8) * Math.sin(p * Math.PI * 2), roll: degrees(6) * tuck },
      neck: { pitch: degrees(18) * tuck, yaw: 0, roll: -degrees(6) * tuck },
    });
    this.mapper.blendArmPose(targets, 'left', {
      armForwardBack: degrees(12) * launch,
      armRaise: degrees(26),
      elbowBend: degrees(72),
      elbowDepth: degrees(10),
    }, tuck);
    this.mapper.blendArmPose(targets, 'right', {
      armForwardBack: -degrees(10) * launch,
      armRaise: degrees(24),
      elbowBend: degrees(70),
      elbowDepth: degrees(-8),
    }, tuck);
    this.mapper.addLegPose(targets, 'left', {
      hipPitch: degrees(48) * tuck,
      kneeBend: degrees(88) * tuck,
      anklePitch: -degrees(10) * tuck,
    });
    this.mapper.addLegPose(targets, 'right', {
      hipPitch: degrees(48) * tuck,
      kneeBend: degrees(88) * tuck,
      anklePitch: -degrees(10) * tuck,
    });
  }
}
