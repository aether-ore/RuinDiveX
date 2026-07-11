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
    const airborne = state === 'aerialKnockbackFall';
    const landing = state === 'backLanding';
    const lyingFlat = state === 'lyingFlat' || state === 'downed';
    const launch = state === 'knockbackLaunch'
      ? THREE.MathUtils.smoothstep(p, 0.08, 0.62)
      : 1;
    const settle = lyingFlat ? 1 : landing ? THREE.MathUtils.smoothstep(p, 0.04, 0.72) : 0;
    const flight = airborne ? 1 : landing ? 1 - settle : launch;
    const impact = airborne || landing || lyingFlat ? 0 : 1 - THREE.MathUtils.smoothstep(p, 0.08, 0.3);

    this.mapper.addCorePose(targets, {
      hips: { pitch: -degrees(38) * impact - THREE.MathUtils.lerp(degrees(50), degrees(85), settle) * flight, yaw: degrees(5) * flight, roll: 0 },
      spine: { pitch: -degrees(44) * impact - THREE.MathUtils.lerp(degrees(52), -degrees(3), settle), yaw: -degrees(4) * flight, roll: 0 },
      neck: { pitch: -degrees(24) * impact - THREE.MathUtils.lerp(degrees(9), -degrees(5), settle), yaw: 0, roll: 0 },
    }, Math.max(impact, flight, settle));
    this.mapper.blendArmPose(targets, 'left', {
      armForwardBack: degrees(18) * impact,
      armRaise: THREE.MathUtils.lerp(degrees(36), degrees(5), settle),
      elbowBend: THREE.MathUtils.lerp(degrees(62), degrees(5), settle),
      elbowDepth: degrees(12) * (1 - settle),
    }, Math.max(impact * 0.75, flight, settle));
    this.mapper.blendArmPose(targets, 'right', {
      armForwardBack: -degrees(12) * impact,
      armRaise: THREE.MathUtils.lerp(degrees(38), degrees(5), settle),
      elbowBend: THREE.MathUtils.lerp(degrees(58), degrees(6), settle),
      elbowDepth: -degrees(10) * (1 - settle),
    }, Math.max(impact * 0.75, flight, settle));
    this.mapper.addLegPose(targets, 'left', {
      hipPitch: degrees(40) * impact + THREE.MathUtils.lerp(degrees(28), 0, settle) * flight,
      hipRoll: -THREE.MathUtils.lerp(degrees(10), degrees(2), settle),
      kneeBend: degrees(42) * impact + THREE.MathUtils.lerp(degrees(58), degrees(3), settle) * flight,
    });
    this.mapper.addLegPose(targets, 'right', {
      hipPitch: degrees(32) * impact + THREE.MathUtils.lerp(degrees(18), 0, settle) * flight,
      hipRoll: THREE.MathUtils.lerp(degrees(8), degrees(2), settle),
      kneeBend: degrees(36) * impact + THREE.MathUtils.lerp(degrees(44), degrees(3), settle) * flight,
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
