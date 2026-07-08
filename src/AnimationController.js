import * as THREE from 'three';

const ARM_SWING = 0.45;
const LEG_SWING = 0.5;
const BEAM_BLADE_TOTAL_FRAMES = 24;
const BEAM_BLADE_ACTIVE_START = 12 / BEAM_BLADE_TOTAL_FRAMES;
const BEAM_BLADE_SLASH_END = 16 / BEAM_BLADE_TOTAL_FRAMES;

function lerpRotation(object, targetX, targetY, targetZ, alpha) {
  if (!object) {
    return;
  }

  object.rotation.x = THREE.MathUtils.lerp(object.rotation.x, targetX, alpha);
  object.rotation.y = THREE.MathUtils.lerp(object.rotation.y, targetY, alpha);
  object.rotation.z = THREE.MathUtils.lerp(object.rotation.z, targetZ, alpha);
}

export class AnimationController {
  constructor(humanoid) {
    this.humanoid = humanoid;
    this.joints = humanoid.joints;
    this.state = 'idle';
    this.time = 0;
    this.attackTimer = 0;
    this.attackDuration = 0.34;
    this.attackStyle = 'melee';
    this.hurtTimer = 0;
    this.dead = false;
  }

  setState(state) {
    if (this.dead && state !== 'dead') {
      return;
    }

    this.state = state;
  }

  playAttack(duration = 0.34, style = 'melee') {
    this.attackDuration = duration;
    this.attackTimer = duration;
    this.attackStyle = style;
    this.setState('attacking');
  }

  playHurt(duration = 0.18) {
    if (this.dead) {
      return;
    }

    this.hurtTimer = duration;
    this.setState('hurt');
  }

  playDead() {
    this.dead = true;
    this.setState('dead');
  }

  update(dt, { moving = false, running = false, moveAmount = 1 } = {}) {
    this.time += dt;

    if (this.dead) {
      this._applyDeadPose(dt);
      return;
    }

    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      this._applyHurtPose(dt);
      return;
    }

    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      this._applyAttackPose(dt);

      if (this.attackTimer <= 0) {
        this.setState(moving ? (running ? 'running' : 'walking') : 'idle');
      }

      return;
    }

    this.setState(moving ? (running ? 'running' : 'walking') : 'idle');

    if (moving) {
      this._applyWalkPose(dt, moveAmount, running);
    } else {
      this._applyIdlePose(dt);
    }
  }

  _applyIdlePose(dt) {
    const breathe = Math.sin(this.time * 2.4) * 0.04;
    const alpha = Math.min(1, dt * 10);

    lerpRotation(this.joints.get('leftShoulder'), breathe, 0, 0.1, alpha);
    lerpRotation(this.joints.get('rightShoulder'), -breathe, 0, -0.1, alpha);
    lerpRotation(this.joints.get('leftElbow'), 0.08, 0, 0, alpha);
    lerpRotation(this.joints.get('rightElbow'), 0.08, 0, 0, alpha);
    lerpRotation(this.joints.get('leftHip'), 0, 0, 0, alpha);
    lerpRotation(this.joints.get('rightHip'), 0, 0, 0, alpha);
    lerpRotation(this.joints.get('leftKnee'), 0.04, 0, 0, alpha);
    lerpRotation(this.joints.get('rightKnee'), 0.04, 0, 0, alpha);
    lerpRotation(this.joints.get('neck'), 0, 0, breathe * 0.4, alpha);
  }

  _applyWalkPose(dt, moveAmount, running = false) {
    const runBlend = running ? 1 : 0;
    const speed = (8.8 + runBlend * 1.8) * Math.max(0.55, moveAmount);
    const stride = Math.sin(this.time * speed);
    const counterStride = Math.sin(this.time * speed + Math.PI);
    const alpha = Math.min(1, dt * 16);
    const armSwing = ARM_SWING * (1 + runBlend * 0.18);
    const legSwing = LEG_SWING * (1 + runBlend * 0.24);
    const kneeLift = 0.45 + runBlend * 0.26;
    const forwardLean = runBlend * 0.1;

    lerpRotation(this.joints.get('spine'), -forwardLean, 0, 0.03 * Math.sin(this.time * speed), alpha);
    lerpRotation(this.joints.get('hips'), -forwardLean * 0.35, 0, 0.025 * Math.sin(this.time * speed), alpha);
    lerpRotation(this.joints.get('leftShoulder'), counterStride * armSwing, 0, 0.08, alpha);
    lerpRotation(this.joints.get('rightShoulder'), stride * armSwing, 0, -0.08, alpha);
    lerpRotation(this.joints.get('leftElbow'), 0.18 + Math.max(0, stride) * (0.25 + runBlend * 0.12), 0, 0, alpha);
    lerpRotation(this.joints.get('rightElbow'), 0.18 + Math.max(0, counterStride) * (0.25 + runBlend * 0.12), 0, 0, alpha);

    lerpRotation(this.joints.get('leftHip'), stride * legSwing - forwardLean * 0.3, 0, 0, alpha);
    lerpRotation(this.joints.get('rightHip'), counterStride * legSwing - forwardLean * 0.3, 0, 0, alpha);
    lerpRotation(this.joints.get('leftKnee'), Math.max(0, -stride) * kneeLift, 0, 0, alpha);
    lerpRotation(this.joints.get('rightKnee'), Math.max(0, -counterStride) * kneeLift, 0, 0, alpha);
    lerpRotation(this.joints.get('neck'), 0.03 * Math.sin(this.time * speed * 0.5), 0, 0, alpha);
  }

  _applyAttackPose(dt) {
    const alpha = Math.min(1, dt * 22);
    const progress = 1 - this.attackTimer / this.attackDuration;

    if (this.attackStyle === 'beamBlade') {
      this._applyBeamBladeAttackPose(progress, alpha);
      return;
    }

    const swing = Math.sin(progress * Math.PI);
    const followThrough = Math.sin(progress * Math.PI * 0.5);

    lerpRotation(this.joints.get('rightShoulder'), -0.95 * swing, 0.2, -0.7 * followThrough, alpha);
    lerpRotation(this.joints.get('rightElbow'), 0.35 + swing * 0.45, 0, 0, alpha);
    lerpRotation(this.joints.get('rightWrist'), -0.2 * swing, 0, -0.5 * swing, alpha);
    lerpRotation(this.joints.get('leftShoulder'), 0.2 * swing, 0, 0.22, alpha);
    lerpRotation(this.joints.get('leftElbow'), 0.16, 0, 0, alpha);
    lerpRotation(this.joints.get('leftHip'), 0.12 * swing, 0, 0, alpha);
    lerpRotation(this.joints.get('rightHip'), -0.12 * swing, 0, 0, alpha);
  }

  _applyBeamBladeAttackPose(progress, alpha) {
    const attackFrame = progress * BEAM_BLADE_TOTAL_FRAMES;
    const beginWindup = THREE.MathUtils.smoothstep(attackFrame, 0, 3);
    const chamber = THREE.MathUtils.smoothstep(attackFrame, 3, 6);
    const release = THREE.MathUtils.smoothstep(attackFrame, 10, 12);
    const slash = THREE.MathUtils.smoothstep(attackFrame, 12, 16);
    const followThrough = THREE.MathUtils.smoothstep(attackFrame, 16, 19);
    const recovery = THREE.MathUtils.smoothstep(attackFrame, 19, 24);
    const committed = 1 - recovery;
    const strike = Math.sin(slash * Math.PI);
    const stance = Math.max(beginWindup, chamber, release, slash) * committed;
    const leadStep = THREE.MathUtils.smoothstep(attackFrame, 10, 19) * committed;
    let shoulderPitch = THREE.MathUtils.lerp(-0.04, -0.08, beginWindup);
    let shoulderYaw = THREE.MathUtils.lerp(-0.04, 0.76, beginWindup);
    let shoulderRoll = THREE.MathUtils.lerp(-0.1, 0.54, beginWindup);
    let elbowBend = THREE.MathUtils.lerp(0.08, 1.12, beginWindup);
    let elbowYaw = THREE.MathUtils.lerp(0, 0.18, beginWindup);
    let elbowRoll = THREE.MathUtils.lerp(0, -0.32, beginWindup);
    let wristSweep = THREE.MathUtils.lerp(0.04, -0.38, beginWindup);

    shoulderPitch = THREE.MathUtils.lerp(shoulderPitch, 0.14, chamber);
    shoulderYaw = THREE.MathUtils.lerp(shoulderYaw, 1.42, chamber);
    shoulderRoll = THREE.MathUtils.lerp(shoulderRoll, 0.34, chamber);
    elbowBend = THREE.MathUtils.lerp(elbowBend, 1.76, chamber);
    elbowYaw = THREE.MathUtils.lerp(elbowYaw, 0.84, chamber);
    elbowRoll = THREE.MathUtils.lerp(elbowRoll, -0.95, chamber);
    wristSweep = THREE.MathUtils.lerp(wristSweep, -0.68, chamber);

    shoulderPitch = THREE.MathUtils.lerp(shoulderPitch, -0.08, release);
    shoulderYaw = THREE.MathUtils.lerp(shoulderYaw, 0.76, release);
    shoulderRoll = THREE.MathUtils.lerp(shoulderRoll, 0.18, release);
    elbowBend = THREE.MathUtils.lerp(elbowBend, 1.28, release);
    elbowYaw = THREE.MathUtils.lerp(elbowYaw, 0.34, release);
    elbowRoll = THREE.MathUtils.lerp(elbowRoll, -0.42, release);
    wristSweep = THREE.MathUtils.lerp(wristSweep, -0.24, release);

    shoulderPitch = THREE.MathUtils.lerp(shoulderPitch, -0.12 - strike * 0.04, slash);
    shoulderYaw = THREE.MathUtils.lerp(shoulderYaw, -1.46, slash);
    shoulderRoll = THREE.MathUtils.lerp(shoulderRoll, 0.14, slash);
    elbowBend = THREE.MathUtils.lerp(elbowBend, 0.18, slash);
    elbowYaw = THREE.MathUtils.lerp(elbowYaw, 0.22, slash);
    elbowRoll = THREE.MathUtils.lerp(elbowRoll, -0.04, slash);
    wristSweep = THREE.MathUtils.lerp(wristSweep, 0.6, slash);

    shoulderYaw = THREE.MathUtils.lerp(shoulderYaw, -1.66, followThrough);
    shoulderRoll = THREE.MathUtils.lerp(shoulderRoll, 0.2, followThrough);
    elbowBend = THREE.MathUtils.lerp(elbowBend, 0.12, followThrough);
    wristSweep = THREE.MathUtils.lerp(wristSweep, 0.7, followThrough);

    shoulderPitch = THREE.MathUtils.lerp(shoulderPitch, -0.03, recovery);
    shoulderYaw = THREE.MathUtils.lerp(shoulderYaw, -0.03, recovery);
    shoulderRoll = THREE.MathUtils.lerp(shoulderRoll, -0.1, recovery);
    elbowBend = THREE.MathUtils.lerp(elbowBend, 0.08, recovery);
    elbowYaw = THREE.MathUtils.lerp(elbowYaw, 0, recovery);
    elbowRoll = THREE.MathUtils.lerp(elbowRoll, 0, recovery);
    wristSweep = THREE.MathUtils.lerp(wristSweep, 0, recovery);

    const chambered = chamber * (1 - THREE.MathUtils.smoothstep(attackFrame, 10, 16));
    const bodyTurn = THREE.MathUtils.smoothstep(attackFrame, 10, 16);
    const hipTwist = THREE.MathUtils.lerp(0.24 * chambered, -0.28, bodyTurn) * committed;
    const torsoTwist = THREE.MathUtils.lerp(0.5 * chambered, -0.58, bodyTurn) * committed;

    lerpRotation(this.joints.get('hips'), -0.02 * strike, hipTwist, -0.02 * strike, alpha);
    lerpRotation(this.joints.get('spine'), -0.04 * strike, torsoTwist, -0.05 * strike, alpha);
    lerpRotation(this.joints.get('rightShoulder'), shoulderPitch, shoulderYaw, shoulderRoll, alpha);
    lerpRotation(this.joints.get('rightElbow'), elbowBend, elbowYaw, elbowRoll, alpha);
    lerpRotation(this.joints.get('rightWrist'), -0.08 * chamber * committed, wristSweep, -0.18 - strike * 0.1, alpha);
    lerpRotation(this.joints.get('leftShoulder'), 0.02 + 0.08 * strike, 0.1 * chamber - 0.16 * slash, 0.2 + 0.18 * stance, alpha);
    lerpRotation(this.joints.get('leftElbow'), 0.16 + 0.12 * stance, 0, 0, alpha);
    lerpRotation(this.joints.get('leftHip'), (0.3 + 0.18 * leadStep + 0.06 * strike) * stance, 0, 0.26 * stance, alpha);
    lerpRotation(this.joints.get('rightHip'), (-0.2 - 0.12 * leadStep - 0.05 * strike) * stance, 0, -0.24 * stance, alpha);
    lerpRotation(this.joints.get('leftKnee'), (0.46 + 0.18 * leadStep + 0.12 * strike) * stance, 0, 0, alpha);
    lerpRotation(this.joints.get('rightKnee'), (0.38 + 0.08 * leadStep + 0.08 * strike) * stance, 0, 0, alpha);
    lerpRotation(this.joints.get('leftAnkle'), -0.14 * stance, 0, 0.06 * stance, alpha);
    lerpRotation(this.joints.get('rightAnkle'), 0.1 * stance, 0, -0.05 * stance, alpha);
  }

  _applyHurtPose(dt) {
    const alpha = Math.min(1, dt * 18);
    const recoil = Math.sin(Math.max(0, this.hurtTimer) * 28) * 0.18;

    lerpRotation(this.joints.get('neck'), -0.18, 0, recoil, alpha);
    lerpRotation(this.joints.get('leftShoulder'), -0.3, 0, 0.2, alpha);
    lerpRotation(this.joints.get('rightShoulder'), -0.3, 0, -0.2, alpha);
    lerpRotation(this.joints.get('leftHip'), 0.18, 0, 0, alpha);
    lerpRotation(this.joints.get('rightHip'), 0.18, 0, 0, alpha);
  }

  _applyDeadPose(dt) {
    const alpha = Math.min(1, dt * 5);
    lerpRotation(this.humanoid.root, -Math.PI / 2, 0, this.humanoid.root.rotation.z, alpha);
  }
}
