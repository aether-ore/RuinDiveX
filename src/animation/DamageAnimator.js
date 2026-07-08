import * as THREE from 'three';
import { degrees } from '../SemanticRigMapper.js';

export class DamageAnimator {
  constructor(mapper) {
    this.mapper = mapper;
  }

  applyStandingFlinch(targets, hurtProgress = 0, hitLocal = {}) {
    if (!this.mapper) {
      return;
    }

    const progress = THREE.MathUtils.clamp(hurtProgress, 0, 1);
    const impact = Math.sin(progress * Math.PI);
    const settle = 1 - THREE.MathUtils.smoothstep(progress, 0.35, 1);
    const side = THREE.MathUtils.clamp(hitLocal.x ?? 0, -1, 1);
    const forward = THREE.MathUtils.clamp(hitLocal.z ?? 1, -1, 1);
    const frontHit = THREE.MathUtils.clamp(forward, 0, 1);
    const backHit = THREE.MathUtils.clamp(-forward, 0, 1);
    const pitch = degrees(-8) * settle * Math.max(0.35, frontHit) + degrees(7) * settle * backHit;
    const roll = degrees(8) * impact * (Math.abs(side) > 0.08 ? -side : 1);
    const yaw = degrees(4.5) * impact * -side;

    this.mapper.addCorePose(targets, {
      spine: { pitch, yaw, roll },
      neck: { pitch: pitch * 1.05, yaw: yaw * 0.45, roll: roll * 0.62 },
    });
    this.mapper.addArmPose(targets, 'left', {
      armForwardBack: -degrees(8) * settle + degrees(4) * side * impact,
      armRaise: -degrees(8) * settle,
      elbowBend: degrees(8) * settle,
    });
    this.mapper.addArmPose(targets, 'right', {
      armForwardBack: -degrees(8) * settle + degrees(4) * side * impact,
      armRaise: -degrees(8) * settle,
      elbowBend: degrees(8) * settle,
    });
    this.mapper.addLegPose(targets, 'left', { kneeBend: degrees(7) * settle });
    this.mapper.addLegPose(targets, 'right', { kneeBend: degrees(7) * settle });
  }

  applyKnockbackFall(targets, state = 'knockbackFall', progress = 0) {
    if (!this.mapper) {
      return;
    }

    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const fall = state === 'downed' ? 1 : THREE.MathUtils.smoothstep(p, 0.18, 0.82);
    const impact = state === 'downed' ? 0 : 1 - THREE.MathUtils.smoothstep(p, 0.08, 0.3);
    const settle = state === 'downed' ? 1 : THREE.MathUtils.smoothstep(p, 0.68, 1);

    this.mapper.addCorePose(targets, {
      hips: { pitch: -degrees(38) * impact - degrees(72) * fall, yaw: degrees(12) * fall, roll: -degrees(48) * fall },
      spine: { pitch: -degrees(44) * impact - degrees(48) * fall, yaw: -degrees(10) * fall, roll: -degrees(32) * fall },
      neck: { pitch: -degrees(24) * impact - degrees(14) * fall, yaw: 0, roll: -degrees(10) * fall },
    }, Math.max(impact, fall));
    this.mapper.blendArmPose(targets, 'left', {
      armForwardBack: degrees(18) * impact,
      armRaise: degrees(36) + degrees(12) * settle,
      elbowBend: degrees(62),
      elbowDepth: degrees(12),
    }, Math.max(impact * 0.75, fall));
    this.mapper.blendArmPose(targets, 'right', {
      armForwardBack: -degrees(12) * impact,
      armRaise: degrees(38) + degrees(10) * settle,
      elbowBend: degrees(58),
      elbowDepth: -degrees(10),
    }, Math.max(impact * 0.75, fall));
    this.mapper.addLegPose(targets, 'left', {
      hipPitch: degrees(40) * impact + degrees(28) * fall,
      hipRoll: -degrees(10) * fall,
      kneeBend: degrees(42) * impact + degrees(58) * fall,
    });
    this.mapper.addLegPose(targets, 'right', {
      hipPitch: degrees(32) * impact + degrees(18) * fall,
      hipRoll: degrees(8) * fall,
      kneeBend: degrees(36) * impact + degrees(44) * fall,
    });
  }

  applyGetUp(targets, progress = 0) {
    if (!this.mapper) {
      return;
    }

    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const brace = 1 - THREE.MathUtils.smoothstep(p, 0.12, 0.45);
    const crouch = Math.sin(THREE.MathUtils.clamp((p - 0.16) / 0.68, 0, 1) * Math.PI);
    const stand = THREE.MathUtils.smoothstep(p, 0.58, 1);

    this.mapper.addCorePose(targets, {
      hips: { pitch: -degrees(54) * brace + degrees(22) * crouch, yaw: degrees(8) * brace, roll: -degrees(34) * brace },
      spine: { pitch: -degrees(42) * brace + degrees(18) * crouch, yaw: -degrees(5) * brace, roll: -degrees(22) * brace },
      neck: { pitch: -degrees(10) * brace + degrees(3) * stand, yaw: 0, roll: -degrees(4) * brace },
    }, 1 - stand * 0.25);
    this.mapper.blendArmPose(targets, 'left', {
      armForwardBack: degrees(28) * brace,
      armRaise: degrees(42) * brace + degrees(72) * stand,
      elbowBend: degrees(70) * brace + degrees(12) * stand,
      elbowDepth: degrees(10) * brace,
    }, Math.max(brace, crouch * 0.6));
    this.mapper.blendArmPose(targets, 'right', {
      armForwardBack: -degrees(24) * brace,
      armRaise: degrees(42) * brace + degrees(74) * stand,
      elbowBend: degrees(62) * brace + degrees(10) * stand,
      elbowDepth: -degrees(8) * brace,
    }, Math.max(brace, crouch * 0.6));
    this.mapper.addLegPose(targets, 'left', {
      hipPitch: degrees(54) * crouch,
      kneeBend: degrees(88) * crouch,
      anklePitch: -degrees(8) * crouch,
    });
    this.mapper.addLegPose(targets, 'right', {
      hipPitch: degrees(38) * crouch,
      kneeBend: degrees(72) * crouch,
      anklePitch: -degrees(6) * crouch,
    });
  }
}
