import * as THREE from 'three';

const ARM_SWING = 0.45;
const LEG_SWING = 0.5;
const BEAM_BLADE_TOTAL_FRAMES = 24;
const BEAM_BLADE_ACTIVE_START = 12 / BEAM_BLADE_TOTAL_FRAMES;
const BEAM_BLADE_SLASH_END = 16 / BEAM_BLADE_TOTAL_FRAMES;
const DODGE_ROLL_DURATION = 0.66;
const JUMP_DURATION = 0.82;
const KNOCKBACK_FALL_DURATION = 0.86;
const DOWNED_HOLD_DURATION = 0.24;
const GET_UP_DURATION = 1.05;
const FULL_BODY_ACTION_STATES = new Set([
  'dodgeRoll',
  'neutralJump',
  'forwardJump',
  'knockbackFall',
  'downed',
  'getUp',
]);

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
    this.actionState = null;
    this.actionTimer = 0;
    this.actionDuration = 0;
    this.downedTimer = 0;
  }

  setState(state) {
    if (this.dead && state !== 'dead') {
      return;
    }

    this.state = state;
  }

  playAttack(duration = 0.34, style = 'melee') {
    if (this.isControlLocked()) {
      return false;
    }

    this.attackDuration = duration;
    this.attackTimer = duration;
    this.attackStyle = style;
    this.setState('attacking');
    return true;
  }

  playHurt(duration = 0.18) {
    if (this.dead || this.isControlLocked()) {
      return false;
    }

    this.hurtTimer = duration;
    this.setState('hurt');
    return true;
  }

  playDead() {
    this.dead = true;
    this.setState('dead');
  }

  playDodgeRoll(duration = DODGE_ROLL_DURATION) {
    if (!this.canStartFullBodyAction()) {
      return false;
    }

    this._startFullBodyAction('dodgeRoll', duration);
    return true;
  }

  playJump(kind = 'neutralJump', duration = JUMP_DURATION) {
    if (!this.canStartFullBodyAction()) {
      return false;
    }

    this._startFullBodyAction(kind === 'forwardJump' ? 'forwardJump' : 'neutralJump', duration);
    return true;
  }

  playKnockbackFall(duration = KNOCKBACK_FALL_DURATION, downedHold = DOWNED_HOLD_DURATION) {
    if (this.dead) {
      return false;
    }

    this.hurtTimer = 0;
    this.attackTimer = 0;
    this.downedTimer = Math.max(0, downedHold);
    this._startFullBodyAction('knockbackFall', duration);
    return true;
  }

  playGetUp(duration = GET_UP_DURATION) {
    if (this.dead) {
      return false;
    }

    this._startFullBodyAction('getUp', duration);
    return true;
  }

  canStartFullBodyAction() {
    return !this.dead && !this.actionState && this.hurtTimer <= 0 && this.attackTimer <= 0;
  }

  isControlLocked() {
    return FULL_BODY_ACTION_STATES.has(this.actionState);
  }

  isFullBodyActionActive() {
    return this.isControlLocked();
  }

  getActionProgress() {
    if (this.actionState === 'downed') {
      return 1;
    }

    if (!this.actionState || this.actionDuration <= 0) {
      return 0;
    }

    return 1 - THREE.MathUtils.clamp(this.actionTimer / this.actionDuration, 0, 1);
  }

  update(dt, { moving = false, running = false, moveAmount = 1 } = {}) {
    this.time += dt;

    if (this.dead) {
      this._applyDeadPose(dt);
      return;
    }

    if (this.actionState) {
      this._updateFullBodyAction(dt);
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

  _startFullBodyAction(state, duration) {
    this.actionState = state;
    this.actionDuration = Math.max(0.001, duration);
    this.actionTimer = this.actionDuration;
    this.setState(state);
  }

  _updateFullBodyAction(dt) {
    if (this.actionState === 'downed') {
      this.downedTimer -= dt;
      this.setState('downed');
      this._applyDownedPose(dt);

      if (this.downedTimer <= 0) {
        this.playGetUp();
      }

      return;
    }

    this.actionTimer -= dt;
    this.setState(this.actionState);
    this._applyFullBodyActionPose(dt, this.actionState, this.getActionProgress());

    if (this.actionTimer > 0) {
      return;
    }

    const finishedState = this.actionState;

    if (finishedState === 'knockbackFall') {
      this.actionState = 'downed';
      this.actionDuration = Math.max(0.001, this.downedTimer);
      this.actionTimer = this.downedTimer;
      this.setState('downed');
      return;
    }

    this.actionState = null;
    this.actionTimer = 0;
    this.actionDuration = 0;
    this.setState('idle');
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

  _applyFullBodyActionPose(dt, state, progress) {
    if (state === 'dodgeRoll') {
      this._applyDodgeRollPose(dt, progress);
    } else if (state === 'neutralJump' || state === 'forwardJump') {
      this._applyJumpPose(dt, progress, state === 'forwardJump');
    } else if (state === 'knockbackFall') {
      this._applyKnockbackFallPose(dt, progress);
    } else if (state === 'getUp') {
      this._applyGetUpPose(dt, progress);
    }
  }

  _applyDodgeRollPose(dt, progress) {
    const alpha = Math.min(1, dt * 24);
    const tuck = Math.sin(progress * Math.PI);
    const roll = progress * Math.PI * 2;

    lerpRotation(this.joints.get('hips'), 0.55 * tuck, 0, roll, alpha);
    lerpRotation(this.joints.get('spine'), 0.62 * tuck, 0, 0, alpha);
    lerpRotation(this.joints.get('neck'), 0.28 * tuck, 0, 0, alpha);
    lerpRotation(this.joints.get('leftShoulder'), -0.85 * tuck, 0, 0.35 * tuck, alpha);
    lerpRotation(this.joints.get('rightShoulder'), -0.85 * tuck, 0, -0.35 * tuck, alpha);
    lerpRotation(this.joints.get('leftElbow'), 0.95 * tuck, 0, 0, alpha);
    lerpRotation(this.joints.get('rightElbow'), 0.95 * tuck, 0, 0, alpha);
    lerpRotation(this.joints.get('leftHip'), 0.9 * tuck, 0, 0.18 * tuck, alpha);
    lerpRotation(this.joints.get('rightHip'), 0.9 * tuck, 0, -0.18 * tuck, alpha);
    lerpRotation(this.joints.get('leftKnee'), 1.25 * tuck, 0, 0, alpha);
    lerpRotation(this.joints.get('rightKnee'), 1.25 * tuck, 0, 0, alpha);
  }

  _applyJumpPose(dt, progress, forward = false) {
    const alpha = Math.min(1, dt * 18);
    const crouch = 1 - THREE.MathUtils.smoothstep(progress, 0.02, 0.22);
    const airborne = THREE.MathUtils.smoothstep(progress, 0.16, 0.45);
    const landing = THREE.MathUtils.smoothstep(progress, 0.74, 1);
    const balance = Math.sin(progress * Math.PI);
    const lean = forward ? 0.18 : 0.04;

    lerpRotation(this.joints.get('hips'), -0.18 * crouch + lean * airborne, 0, 0, alpha);
    lerpRotation(this.joints.get('spine'), -0.12 * crouch + lean * airborne, 0, 0, alpha);
    lerpRotation(this.joints.get('leftShoulder'), -0.3 * balance, 0, 0.18 * balance, alpha);
    lerpRotation(this.joints.get('rightShoulder'), -0.22 * balance, 0, -0.16 * balance, alpha);
    lerpRotation(this.joints.get('leftHip'), 0.36 * crouch - 0.18 * airborne, 0, 0, alpha);
    lerpRotation(this.joints.get('rightHip'), 0.36 * crouch - 0.18 * airborne, 0, 0, alpha);
    lerpRotation(this.joints.get('leftKnee'), 0.85 * crouch + 0.22 * airborne + 0.55 * landing, 0, 0, alpha);
    lerpRotation(this.joints.get('rightKnee'), 0.85 * crouch + 0.22 * airborne + 0.55 * landing, 0, 0, alpha);
    lerpRotation(this.joints.get('leftAnkle'), -0.18 * crouch, 0, 0, alpha);
    lerpRotation(this.joints.get('rightAnkle'), -0.18 * crouch, 0, 0, alpha);
  }

  _applyKnockbackFallPose(dt, progress) {
    const alpha = Math.min(1, dt * 20);
    const impact = 1 - THREE.MathUtils.smoothstep(progress, 0.08, 0.24);
    const fall = THREE.MathUtils.smoothstep(progress, 0.22, 0.78);

    lerpRotation(this.joints.get('hips'), -0.45 * impact - 1.15 * fall, 0.15 * fall, -0.75 * fall, alpha);
    lerpRotation(this.joints.get('spine'), -0.55 * impact - 0.8 * fall, -0.12 * fall, -0.45 * fall, alpha);
    lerpRotation(this.joints.get('neck'), -0.42 * impact - 0.28 * fall, 0, -0.18 * fall, alpha);
    lerpRotation(this.joints.get('leftShoulder'), -0.45, 0, 0.36 + 0.25 * fall, alpha);
    lerpRotation(this.joints.get('rightShoulder'), -0.45, 0, -0.36 - 0.25 * fall, alpha);
    lerpRotation(this.joints.get('leftHip'), 0.55 * impact + 0.45 * fall, 0, 0.18 * fall, alpha);
    lerpRotation(this.joints.get('rightHip'), 0.42 * impact + 0.35 * fall, 0, -0.18 * fall, alpha);
    lerpRotation(this.joints.get('leftKnee'), 0.48 + 0.28 * fall, 0, 0, alpha);
    lerpRotation(this.joints.get('rightKnee'), 0.48 + 0.18 * fall, 0, 0, alpha);
  }

  _applyDownedPose(dt) {
    const alpha = Math.min(1, dt * 14);

    lerpRotation(this.joints.get('hips'), -1.15, 0.15, -0.78, alpha);
    lerpRotation(this.joints.get('spine'), -0.82, -0.12, -0.48, alpha);
    lerpRotation(this.joints.get('neck'), -0.24, 0, -0.12, alpha);
    lerpRotation(this.joints.get('leftShoulder'), -0.35, 0, 0.62, alpha);
    lerpRotation(this.joints.get('rightShoulder'), -0.35, 0, -0.62, alpha);
    lerpRotation(this.joints.get('leftKnee'), 0.72, 0, 0, alpha);
    lerpRotation(this.joints.get('rightKnee'), 0.58, 0, 0, alpha);
  }

  _applyGetUpPose(dt, progress) {
    const alpha = Math.min(1, dt * 16);
    const brace = 1 - THREE.MathUtils.smoothstep(progress, 0.12, 0.45);
    const crouch = Math.sin(THREE.MathUtils.clamp((progress - 0.18) / 0.72, 0, 1) * Math.PI);
    const stand = THREE.MathUtils.smoothstep(progress, 0.58, 1);

    lerpRotation(this.joints.get('hips'), THREE.MathUtils.lerp(-0.9 * brace + 0.5 * crouch, 0, stand), 0.08 * brace, -0.42 * brace, alpha);
    lerpRotation(this.joints.get('spine'), THREE.MathUtils.lerp(-0.62 * brace + 0.35 * crouch, 0, stand), -0.05 * brace, -0.28 * brace, alpha);
    lerpRotation(this.joints.get('neck'), THREE.MathUtils.lerp(-0.2 * brace, 0, stand), 0, 0, alpha);
    lerpRotation(this.joints.get('leftShoulder'), -0.2 * brace, 0, 0.4 * brace, alpha);
    lerpRotation(this.joints.get('rightShoulder'), -0.25 * brace, 0, -0.42 * brace, alpha);
    lerpRotation(this.joints.get('leftHip'), 0.7 * crouch, 0, 0.12 * brace, alpha);
    lerpRotation(this.joints.get('rightHip'), 0.55 * crouch, 0, -0.12 * brace, alpha);
    lerpRotation(this.joints.get('leftKnee'), 0.9 * crouch, 0, 0, alpha);
    lerpRotation(this.joints.get('rightKnee'), 0.74 * crouch, 0, 0, alpha);
  }

  _applyDeadPose(dt) {
    const alpha = Math.min(1, dt * 5);
    lerpRotation(this.humanoid.root, -Math.PI / 2, 0, this.humanoid.root.rotation.z, alpha);
  }
}
