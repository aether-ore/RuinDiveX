import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { AnimationController } from './AnimationController.js';
import { EquipmentManager } from './EquipmentManager.js';
import { ExternalModelRig } from './ExternalModelRig.js';
import { ModularHumanoid } from './ModularHumanoid.js';
import { SkeletalModelRig } from './SkeletalModelRig.js';

const DEFAULT_BEAM_BLADE_COLOR = 0xa8ff8a;

const PLAYER_BASE_STATS = {
  maxHealth: 160,
  moveSpeed: 4.6,
  attackDamage: 12,
  maxEnergy: 8,
  energyRecharge: 1,
  attackSpeed: 1.25,
  attackRange: 6.2,
  criticalChance: 0.08,
  criticalDamage: 1.55,
  armor: 4,
  pickupRadius: 1.35,
  projectileCount: 1,
  projectilePierce: 1,
  areaDamage: 0,
  fireDamage: 0,
  iceDamage: 0,
  lifeSteal: 0,
  explodeOnKillChance: 0,
  chainLightningChance: 0,
  cooldownReduction: 0,
  armorBreakChance: 0,
  corrosionDamage: 0,
  lockOnSpeed: 0,
  dashRecovery: 0,
  swapSpeed: 0,
};

const moveVector = new THREE.Vector2();
const worldForward = new THREE.Vector3();
const worldMoveDirection = new THREE.Vector3();
const movementBasisForward = new THREE.Vector3();
const movementBasisRight = new THREE.Vector3();
const guardSourceDirection = new THREE.Vector3();
const damageSourceDirection = new THREE.Vector3();
const damageFacingRight = new THREE.Vector3();
const PLAYER_MODEL_PATH = './assets/models/';
const PLAYER_MODEL_FBX = 'Mega Man Volnutt.fbx';
const PLAYER_MODEL_TEXTURE = 'Mega Man Volnutt.png';
const PLAYER_ANIMATION_PATH = `${PLAYER_MODEL_PATH}animations/`;
const PLAYER_MODEL_MTL = 'Mega Man Volnutt.mtl';
const PLAYER_MODEL_OBJ = 'Mega Man Volnutt.obj';
const BUSTER_MODEL_MTL = 'Mega Man Volnutt Buster US.mtl';
const BUSTER_MODEL_OBJ = 'Mega Man Volnutt Buster US.obj';
const PLAYER_FBX_ANIMATION_DEFINITIONS = Object.freeze([
  { key: 'breathingIdle', file: 'Breathing Idle.fbx', label: 'Breathing Idle', loop: true },
  { key: 'climbingLadder', file: 'Climbing Ladder.fbx', label: 'Climbing Ladder', loop: true },
  { key: 'coverToStand', file: 'cover to stand.fbx', label: 'Cover To Stand', loop: false },
  { key: 'coverToStand2', file: 'cover to stand (2).fbx', label: 'Cover To Stand Alt', loop: false },
  { key: 'crouchedSneakLeft', file: 'crouched sneaking left.fbx', label: 'Crouched Sneak Left', loop: true },
  { key: 'crouchedSneakRight', file: 'crouched sneaking right.fbx', label: 'Crouched Sneak Right', loop: true },
  { key: 'fallingIdle', file: 'falling idle.fbx', label: 'Falling Idle', loop: true },
  { key: 'fallingToRoll', file: 'falling to roll.fbx', label: 'Falling To Roll', loop: false },
  { key: 'hardLanding', file: 'hard landing.fbx', label: 'Hard Landing', loop: false },
  { key: 'idle', file: 'idle.fbx', label: 'Look Around Idle', loop: true },
  { key: 'idle2', file: 'idle (2).fbx', label: 'Idle 2', loop: true },
  { key: 'idle3', file: 'idle (3).fbx', label: 'Idle 3', loop: true },
  { key: 'idle4', file: 'idle (4).fbx', label: 'Idle 4', loop: true },
  { key: 'idle5', file: 'idle (5).fbx', label: 'Idle 5', loop: true },
  { key: 'jumpingUp', file: 'jumping up.fbx', label: 'Jumping Up', loop: false },
  { key: 'leftCoverSneak', file: 'left cover sneak.fbx', label: 'Left Cover Sneak', loop: true },
  { key: 'leftTurn', file: 'left turn.fbx', label: 'Left Turn', loop: false },
  { key: 'rightCoverSneak', file: 'right cover sneak.fbx', label: 'Right Cover Sneak', loop: true },
  { key: 'rightTurn', file: 'right turn.fbx', label: 'Right Turn', loop: false },
  { key: 'runToStop', file: 'run to stop.fbx', label: 'Run To Stop', loop: false },
  { key: 'running', file: 'running.fbx', label: 'Running', loop: true },
  { key: 'slowJogBackwards', file: 'Slow Jog Backwards.fbx', label: 'Slow Jog Backwards', loop: true },
  { key: 'standToCover', file: 'stand to cover.fbx', label: 'Stand To Cover', loop: false },
  { key: 'standToCover2', file: 'stand to cover (2).fbx', label: 'Stand To Cover Alt', loop: false },
  { key: 'strutWalking', file: 'Strut Walking.fbx', label: 'Strut Walking', loop: true },
  { key: 'walking', file: 'walking.fbx', label: 'Walking', loop: true },
]);
const TARGET_MODEL_HEIGHT = 2.85;
const MIN_BRACED_SHOT_TIME = 0.28;
const MIN_PROJECTILE_AIM_LOCK_TIME = 0.44;
const PROJECTILE_STANCE_LINGER_TIME = 1.05;
const DODGE_ROLL_DISTANCE = 2.75;
const DODGE_ROLL_DURATION = 0.66;
const FORWARD_JUMP_DISTANCE = 1.65;
const JUMP_DURATION = 0.82;
const HEAVY_HIT_HEALTH_FRACTION = 0.16;
const HEAVY_HIT_MIN_DAMAGE = 18;
const KNOCKBACK_FALL_DISTANCE = 1.55;
const SHIELD_GUARD_DURATION = 0.7;
const SHIELD_GUARD_COOLDOWN = 0.82;
const SHIELD_PARRY_WINDOW = 0.18;
const BUSTER_SLOT_INDEX = 0;
const UTILITY_ARM_SLOT_INDEX = 3;

function isArmWeaponItem(item) {
  return item?.slot === 'weapon' && item?.category === 'Arm Weapon';
}

function isBusterArmItem(item) {
  return isArmWeaponItem(item) && item?.type === 'busterArm';
}

function isUtilityArmItem(item) {
  return isArmWeaponItem(item) && (item?.type === 'liftArm' || item?.tags?.includes('utility'));
}

function isBusterUpgradeItem(item) {
  return item?.category === 'Buster Part';
}

export class Player {
  constructor() {
    this.humanoid = new ModularHumanoid({
      skinColor: 0xc88f68,
      hairColor: 0xe3342f,
      hairStyle: 'short',
      eyeColor: 0x7ee3ff,
      clothColor: 0x2d3f54,
      armorColor: 0xaab4bf,
      scale: 1,
    });

    this.root = this.humanoid.root;
    this.root.name = 'playerRoot';
    this.root.position.set(0, 0, 0);

    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'playerExternalModelRoot';
    this.modelRoot.visible = false;
    this.root.add(this.modelRoot);

    this.animation = new AnimationController(this.humanoid);
    this.equipment = new EquipmentManager(this, this.humanoid);

    this.baseStats = { ...PLAYER_BASE_STATS };
    this.stats = { ...PLAYER_BASE_STATS };
    this.health = this.stats.maxHealth;
    this.level = 1;
    this.experience = 0;
    this.experienceToNext = 40;
    this.radius = 0.42;
    this.dead = false;
    this.slowTimer = 0;
    this.slowMultiplier = 1;
    this.weaponColor = new THREE.Color(0xd7dde6);
    this.lastMoveDirection = new THREE.Vector3(0, 0, 1);
    this.attackFacingDirection = new THREE.Vector3(0, 0, 1);
    this.attackFacingTimer = 0;
    this._loadedModel = null;
    this.externalRig = null;
    this._modelWalkTime = 0;
    this._characterModelScale = 1;
    this._loadedModelUsesFbxClips = false;
    this._fbxAnimationLibraryLoading = false;
    this._fbxAnimationLibraryLoaded = false;
    this._busterArmLoading = false;
    this._busterArmLoaded = false;
    this._attackWeaponKind = null;
    this._bracedFireWeaponKey = null;
    this.bracedFireDirection = new THREE.Vector3(0, 0, 1);
    this.bracedFireTimer = 0;
    this.bracedBackpedalTimer = 0;
    this.movementLockTimer = 0;
    this.movementLockMultiplier = 1;
    this.dodgeDirection = new THREE.Vector3(0, 0, 1);
    this.jumpDirection = new THREE.Vector3(0, 0, 1);
    this.knockbackFallDirection = new THREE.Vector3(0, 0, -1);
    this.damageHitLocalDirection = new THREE.Vector3(0, 0, 1);
    this.isRunning = false;
    this.guardDirection = new THREE.Vector3(0, 0, 1);
    this.guardTimer = 0;
    this.guardDuration = 0;
    this.guardParryTimer = 0;
    this.guardCooldown = 0;
    this.lastGuardResult = null;
    this.armHotbar = [null, null, null, null];
    this.activeArmIndex = 0;
    this.utilityArms = [];
    this.activeUtilityArmIndex = 0;
    this.busterUpgradeSlots = [null, null, null, null];
    this.temporaryStatBonuses = new Map();

    this._loadCharacterModel();
  }

  update(dt, input, arenaRadius = 32, movementOptions = {}) {
    if (typeof arenaRadius === 'object') {
      movementOptions = arenaRadius;
      arenaRadius = movementOptions.arenaRadius ?? 32;
    }

    if (this.dead) {
      this.isRunning = false;
      this.animation.update(dt);
      return;
    }

    this._updateStatusEffects(dt);
    this._updateTemporaryStatBonuses(dt);
    this._updateBracedFireState(dt);
    this._updateShieldGuardState(dt);
    this._updateMovementLockState(dt);
    this._updateAttackFacingState(dt);

    if (this.animation.isFullBodyActionActive?.()) {
      this.animation.update(dt, {
        moving: false,
        running: false,
        moveAmount: 0,
      });
      this._updateFullBodyActionMotion(dt, arenaRadius);
      this.updateWeaponVisualState();
      this._updateExternalModelMotion(dt, false, 0, false, false, {
        lockOnActive: false,
        strafeAmount: 0,
      });
      return;
    }

    moveVector.set(0, 0);
    const lockOnTarget = movementOptions.lockOnTarget ?? null;
    const lockOnPosition = lockOnTarget?.root?.position ?? movementOptions.lockOnTargetPosition ?? null;
    const lockOnActive = Boolean(lockOnPosition && !lockOnTarget?.dead);
    const aimWorld = movementOptions.aimWorld ?? null;
    const mouseTurnActive = movementOptions.mouseTurnActive !== false;

    if (input.has('KeyW') || input.has('ArrowUp')) moveVector.y += 1;
    if (input.has('KeyS') || input.has('ArrowDown')) moveVector.y -= 1;
    if (input.has('KeyA') || input.has('ArrowLeft')) moveVector.x -= 1;
    if (input.has('KeyD') || input.has('ArrowRight')) moveVector.x += 1;

    const rawLateralInput = moveVector.x;
    const rawForwardInput = moveVector.y;
    const moving = moveVector.lengthSq() > 0;
    const running = moving && (input.has('ShiftLeft') || input.has('ShiftRight'));
    let moveAmount = 0;
    let movingBackward = false;
    let movingForward = false;
    let lateralOnly = false;
    let strafeAmount = 0;
    let mouseFacing = false;

    if (moving) {
      moveVector.normalize();
      movingBackward = rawForwardInput < -0.35;
      movingForward = rawForwardInput > 0.35;
      lateralOnly = Math.abs(rawLateralInput) > 0.35 && Math.abs(rawForwardInput) < 0.35;
      strafeAmount = THREE.MathUtils.clamp(rawLateralInput, -1, 1);
      moveAmount = running ? 1.35 : 1;

      this._resolveMovementDirection(moveVector, movementOptions);

      const guardMoveMultiplier = this.isShieldGuarding() ? 0.72 : 1;
      const runMultiplier = running ? 1.42 : 1;
      const speed = this.stats.moveSpeed * runMultiplier * this.slowMultiplier * guardMoveMultiplier * this.movementLockMultiplier;
      this.root.position.addScaledVector(worldMoveDirection, speed * dt);

      this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -arenaRadius, arenaRadius);
      this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -arenaRadius, arenaRadius);

      if (lockOnActive) {
        this._resolveLockOnFacingDirection(lockOnPosition);
      } else if (mouseTurnActive && this._resolveMouseFacingDirection(aimWorld)) {
        mouseFacing = true;
      } else if (movingBackward) {
        this._resolveBackwardFacingDirection(movementOptions);
      } else if (movingForward) {
        this._resolveForwardFacingDirection(movementOptions);
      }
    } else if (lockOnActive) {
      this._resolveLockOnFacingDirection(lockOnPosition);
    }

    const attackFacing = this.attackFacingTimer > 0 && this.attackFacingDirection.lengthSq() > 0.0001;
    const bracedAiming = this.bracedFireTimer > 0 && this.bracedFireDirection.lengthSq() > 0.0001;
    const backpedaling = movingBackward || (lockOnActive && moveVector.y < -0.35) || (bracedAiming && this.bracedBackpedalTimer > 0 && moving);
    const moveAnimationAmount = moving ? moveAmount * this.movementLockMultiplier : 0;
    const visiblyMoving = moveAnimationAmount > 0.05;
    const visiblyRunning = visiblyMoving
      && running
      && !backpedaling
      && !this.isShieldGuarding()
      && this.movementLockMultiplier > 0.85;
    this.isRunning = visiblyRunning;

    if (attackFacing) {
      this.faceDirection(this.attackFacingDirection);
    } else if (bracedAiming) {
      this.faceDirection(this.bracedFireDirection);
    } else if (lockOnActive) {
      this.faceDirection(this.lastMoveDirection);
    } else if (lateralOnly && !mouseFacing) {
      this.faceDirection(worldMoveDirection);
    } else if (moving) {
      this.faceDirection(this.lastMoveDirection);
    }

    this.animation.update(dt, {
      moving: visiblyMoving,
      running: visiblyRunning,
      moveAmount: moveAnimationAmount,
    });
    this.updateWeaponVisualState();
    this._updateExternalModelMotion(dt, visiblyMoving, moveAnimationAmount, backpedaling, visiblyRunning, {
      lockOnActive,
      strafeAmount,
    });
  }

  _resolveLockOnFacingDirection(targetPosition) {
    worldForward.copy(targetPosition).sub(this.root.position);
    worldForward.y = 0;

    if (worldForward.lengthSq() <= 0.0001) {
      return;
    }

    this.lastMoveDirection.copy(worldForward.normalize());
  }

  _resolveBackwardFacingDirection(movementOptions = {}) {
    this._resolveForwardFacingDirection(movementOptions);
  }

  _resolveForwardFacingDirection(movementOptions = {}) {
    const forward = movementOptions.movementForward ?? movementOptions.forward;

    if (forward && forward.lengthSq() > 0.0001) {
      worldForward.copy(forward);
      worldForward.y = 0;

      if (worldForward.lengthSq() > 0.0001) {
        this.lastMoveDirection.copy(worldForward.normalize());
        return;
      }
    }

    worldForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    this.lastMoveDirection.copy(worldForward.normalize());
  }

  _resolveMouseFacingDirection(aimWorld) {
    if (!aimWorld) {
      return false;
    }

    worldForward.copy(aimWorld).sub(this.root.position);
    worldForward.y = 0;

    if (worldForward.lengthSq() <= 0.12) {
      return false;
    }

    this.lastMoveDirection.copy(worldForward.normalize());
    return true;
  }

  _resolveMovementDirection(inputVector, movementOptions = {}) {
    worldMoveDirection.set(0, 0, 0);

    const forward = movementOptions.movementForward ?? movementOptions.forward;
    const right = movementOptions.movementRight ?? movementOptions.right;

    if (forward && right) {
      movementBasisForward.copy(forward);
      movementBasisForward.y = 0;

      if (movementBasisForward.lengthSq() <= 0.0001) {
        movementBasisForward.set(0, 0, 1);
      } else {
        movementBasisForward.normalize();
      }

      movementBasisRight.copy(right);
      movementBasisRight.y = 0;

      if (movementBasisRight.lengthSq() <= 0.0001) {
        movementBasisRight.set(1, 0, 0);
      } else {
        movementBasisRight.normalize();
      }

      worldMoveDirection
        .addScaledVector(movementBasisRight, inputVector.x)
        .addScaledVector(movementBasisForward, inputVector.y);
    } else {
      worldMoveDirection.set(inputVector.x, 0, -inputVector.y);
    }

    if (worldMoveDirection.lengthSq() <= 0.0001) {
      worldMoveDirection.set(0, 0, 1);
    } else {
      worldMoveDirection.normalize();
    }
  }

  faceDirection(direction) {
    if (direction.lengthSq() <= 0.0001) {
      return;
    }

    this.root.rotation.y = Math.atan2(direction.x, direction.z);
  }

  syncMoveDirectionToBodyFacing() {
    worldForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));

    if (worldForward.lengthSq() > 0.0001) {
      this.lastMoveDirection.copy(worldForward.normalize());
    }
  }

  tryDodgeRoll(input = new Set(), movementOptions = {}) {
    if (!this.animation.playDodgeRoll?.(DODGE_ROLL_DURATION)) {
      return false;
    }

    this._resolveActionDirection(input, movementOptions, this.dodgeDirection);
    this.faceDirection(this.dodgeDirection);
    this.attackFacingTimer = 0;
    this.movementLockTimer = Math.max(this.movementLockTimer, DODGE_ROLL_DURATION);
    this.movementLockMultiplier = 0;
    return true;
  }

  tryJump(input = new Set(), movementOptions = {}) {
    this._resolveActionDirection(input, movementOptions, this.jumpDirection);
    const moving = this._hasMovementInput(input);
    const jumpKind = moving ? 'forwardJump' : 'neutralJump';

    if (!this.animation.playJump?.(jumpKind, JUMP_DURATION)) {
      return false;
    }

    if (moving) {
      this.faceDirection(this.jumpDirection);
    }

    this.movementLockTimer = Math.max(this.movementLockTimer, JUMP_DURATION * 0.55);
    this.movementLockMultiplier = Math.min(this.movementLockMultiplier, moving ? 0.35 : 0.18);
    return true;
  }

  previewExternalAnimation(dt, {
    moving = false,
    running = false,
    moveAmount = moving ? (running ? 1.35 : 1) : 0,
    projectileAiming = false,
    lockOnActive = false,
    strafeAmount = 0,
    backpedaling = false,
    attackKind = null,
    attackProgress = null,
    forceSwordArm = false,
    clipKey = null,
  } = {}) {
    if (this.dead) {
      return;
    }

    this.animation.update(dt, {
      moving,
      running,
      moveAmount,
    });
    this.updateWeaponVisualState();
    const previewAttackKind = projectileAiming ? 'projectile' : attackKind ?? this._attackWeaponKind;
    const previewAttackProgress = Number.isFinite(attackProgress)
      ? attackProgress
      : projectileAiming
      ? 1
      : null;

    if (forceSwordArm && previewAttackKind === 'beamBlade') {
      this.externalRig?.setDrillArmActive?.(false);
      this.externalRig?.setBusterArmActive?.(true);
      this.externalRig?.setBeamBladeActive?.(true, this.getActiveWeaponGlowColor(this.weaponColor.getHex()));
    }

    this._updateExternalModelMotion(dt, moving, moveAmount, backpedaling, running, {
      lockOnActive,
      strafeAmount,
      projectileAiming,
      attackKind: previewAttackKind,
      attackProgress: previewAttackProgress,
      clipKey,
      animationState: previewAttackKind === 'beamBlade' ? 'attacking' : undefined,
      skipAttackKindReset: true,
    });
  }

  _hasMovementInput(input = new Set()) {
    return input.has('KeyW')
      || input.has('ArrowUp')
      || input.has('KeyS')
      || input.has('ArrowDown')
      || input.has('KeyA')
      || input.has('ArrowLeft')
      || input.has('KeyD')
      || input.has('ArrowRight');
  }

  _resolveActionDirection(input = new Set(), movementOptions = {}, target = worldMoveDirection) {
    const x = (input.has('KeyD') || input.has('ArrowRight') ? 1 : 0)
      + (input.has('KeyA') || input.has('ArrowLeft') ? -1 : 0);
    const y = (input.has('KeyW') || input.has('ArrowUp') ? 1 : 0)
      + (input.has('KeyS') || input.has('ArrowDown') ? -1 : 0);

    if (Math.abs(x) > 0.001 || Math.abs(y) > 0.001) {
      moveVector.set(x, y).normalize();
      this._resolveMovementDirection(moveVector, movementOptions);
      target.copy(worldMoveDirection);
    } else {
      target.copy(this.lastMoveDirection);
    }

    target.y = 0;

    if (target.lengthSq() <= 0.0001) {
      target.set(0, 0, 1);
    } else {
      target.normalize();
    }

    return target;
  }

  _updateFullBodyActionMotion(dt, arenaRadius = 32) {
    const state = this.animation.state;
    const progress = this.animation.getActionProgress?.() ?? 0;

    if (state === 'dodgeRoll') {
      this._applyActionDisplacement(this.dodgeDirection, DODGE_ROLL_DISTANCE, DODGE_ROLL_DURATION, progress, dt);
    } else if (state === 'forwardJump') {
      this._applyActionDisplacement(this.jumpDirection, FORWARD_JUMP_DISTANCE, JUMP_DURATION, progress, dt);
    } else if (state === 'knockbackFall') {
      const knockbackProgress = THREE.MathUtils.clamp(progress / 0.62, 0, 1);
      this._applyActionDisplacement(
        this.knockbackFallDirection,
        KNOCKBACK_FALL_DISTANCE,
        0.62,
        knockbackProgress,
        dt,
      );
    }

    this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -arenaRadius, arenaRadius);
    this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -arenaRadius, arenaRadius);
  }

  _applyActionDisplacement(direction, distance, duration, progress, dt) {
    if (!direction || direction.lengthSq() <= 0.0001 || duration <= 0) {
      return;
    }

    const localProgress = THREE.MathUtils.clamp(progress, 0, 1);
    const speedScale = Math.sin(localProgress * Math.PI) * (Math.PI / 2);
    this.root.position.addScaledVector(direction, (distance / duration) * speedScale * dt);
  }

  faceTarget(targetPosition) {
    worldForward.copy(targetPosition).sub(this.root.position);
    worldForward.y = 0;

    if (worldForward.lengthSq() > 0.0001) {
      worldForward.normalize();
      this.faceDirection(worldForward);
    }
  }

  getAttackOrigin() {
    const hand = this.humanoid.getAttachmentPoint('rightHand');
    const origin = new THREE.Vector3();

    if (hand) {
      hand.getWorldPosition(origin);
      origin.y = Math.max(origin.y, 1);
      return origin;
    }

    return this.root.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  }

  getProjectileOrigin() {
    if (this.getActiveArmWeapon?.()?.type === 'drillArm') {
      const drillTipPosition = this.externalRig?.getDrillTipWorldPosition?.(new THREE.Vector3());

      if (drillTipPosition) {
        drillTipPosition.y = Math.max(drillTipPosition.y, 0.9);
        return drillTipPosition;
      }
    }

    const muzzlePosition = this.externalRig?.getBusterMuzzleWorldPosition(new THREE.Vector3());

    if (muzzlePosition) {
      muzzlePosition.y = Math.max(muzzlePosition.y, 1);
      return muzzlePosition;
    }

    return this.getAttackOrigin();
  }

  getWeaponKind() {
    return this.getActiveArmWeapon?.()?.weaponKind ?? this.equipment.get('weapon')?.weaponKind ?? 'projectile';
  }

  isUsingProjectileWeapon() {
    const activeType = this.getActiveArmWeapon?.()?.type;

    if (activeType === 'swordArm') {
      return true;
    }

    if (activeType === 'liftArm' || activeType === 'drillArm') {
      return false;
    }

    return this.getWeaponKind() === 'projectile';
  }

  getActiveWeaponElement() {
    const weaponStats = this.getActiveArmWeapon?.()?.getStatTotals?.() ?? {};

    if ((weaponStats.fireDamage ?? 0) > 0) return 'fire';
    if ((weaponStats.iceDamage ?? 0) > 0) return 'ice';
    if ((weaponStats.corrosionDamage ?? 0) > 0) return 'corrosion';
    if ((weaponStats.chainLightningChance ?? 0) > 0) return 'shock';

    return null;
  }

  getActiveWeaponGlowColor(fallback = 0x77e8ff) {
    const weapon = this.getActiveArmWeapon?.();

    if (weapon?.type === 'swordArm' && (!weapon.rarity || weapon.rarity === 'scrap' || weapon.rarity === 'standard')) {
      return DEFAULT_BEAM_BLADE_COLOR;
    }

    const element = this.getActiveWeaponElement();

    if (element === 'fire') return 0xff8a42;
    if (element === 'ice') return 0x8bddff;
    if (element === 'corrosion') return 0xa6e86f;
    if (element === 'shock') return 0xa6f7ff;

    return weapon?.glowColor ?? fallback;
  }

  setArmHotbar(items = []) {
    const buster = items.find((item) => isBusterArmItem(item)) ?? this.armHotbar[BUSTER_SLOT_INDEX] ?? null;
    const combatArms = items.filter((item) => isArmWeaponItem(item) && !isBusterArmItem(item) && !isUtilityArmItem(item));
    const utilityArms = items.filter((item) => isUtilityArmItem(item));

    this.armHotbar[BUSTER_SLOT_INDEX] = buster;
    this.armHotbar[1] = combatArms[0] ?? null;
    this.armHotbar[2] = combatArms[1] ?? null;

    if (utilityArms.length > 0 || this.utilityArms.length === 0) {
      this.setUtilityArms(utilityArms, true);
    } else {
      this._syncUtilityArmHotbarSlot();
    }

    if (!this.armHotbar[this.activeArmIndex]) {
      this.activeArmIndex = BUSTER_SLOT_INDEX;
    }

    if (this.armHotbar[this.activeArmIndex]) {
      this.switchArmWeapon(this.activeArmIndex, true);
    }
  }

  assignArmWeaponToSlot(slotIndex, item) {
    if (!isArmWeaponItem(item)) {
      return null;
    }

    const index = THREE.MathUtils.clamp(Math.trunc(slotIndex), 0, this.armHotbar.length - 1);

    if (index === BUSTER_SLOT_INDEX) {
      if (!isBusterArmItem(item)) {
        return item;
      }

      const previous = this.armHotbar[BUSTER_SLOT_INDEX] ?? null;
      this.armHotbar[BUSTER_SLOT_INDEX] = item;
      this.switchArmWeapon(BUSTER_SLOT_INDEX, true);
      return previous === item ? null : previous;
    }

    if (index === UTILITY_ARM_SLOT_INDEX) {
      if (!isUtilityArmItem(item)) {
        return item;
      }

      this.addUtilityArm(item, true);
      return null;
    }

    if (isBusterArmItem(item) || isUtilityArmItem(item)) {
      return item;
    }

    const previous = this.armHotbar[index] ?? null;
    this.armHotbar[index] = item;
    this.switchArmWeapon(index, true);
    return previous === item ? null : previous;
  }

  switchArmWeapon(slotIndex, force = false) {
    const index = THREE.MathUtils.clamp(Math.trunc(slotIndex), 0, this.armHotbar.length - 1);
    let item = this.armHotbar[index];
    let cycledUtility = false;

    if (index === UTILITY_ARM_SLOT_INDEX) {
      if (this.utilityArms.length <= 0) {
        return false;
      }

      if (!force && this.activeArmIndex === UTILITY_ARM_SLOT_INDEX && this.utilityArms.length > 1) {
        this.activeUtilityArmIndex = (this.activeUtilityArmIndex + 1) % this.utilityArms.length;
        cycledUtility = true;
      }

      this._syncUtilityArmHotbarSlot();
      item = this.getActiveUtilityArm();
    }

    if (!item || (!force && index === this.activeArmIndex && !cycledUtility)) {
      return false;
    }

    this.activeArmIndex = index;
    this.equipment.equip(item, 'weapon');
    this._releaseProjectileAim();
    return true;
  }

  getActiveArmWeapon() {
    return this.armHotbar[this.activeArmIndex] ?? this.equipment.get('weapon');
  }

  setUtilityArms(items = [], keepCurrent = false) {
    const existingActive = keepCurrent ? this.getActiveUtilityArm() : null;
    const unique = [];
    const seen = new Set();

    for (const item of items) {
      if (!isUtilityArmItem(item) || seen.has(item.id)) {
        continue;
      }

      seen.add(item.id);
      unique.push(item);
    }

    this.utilityArms = unique;

    const activeIndex = existingActive
      ? this.utilityArms.findIndex((item) => item.id === existingActive.id)
      : -1;
    this.activeUtilityArmIndex = activeIndex >= 0 ? activeIndex : 0;
    this._syncUtilityArmHotbarSlot();

    if (this.activeArmIndex === UTILITY_ARM_SLOT_INDEX) {
      if (this.getActiveUtilityArm()) {
        this.switchArmWeapon(UTILITY_ARM_SLOT_INDEX, true);
      } else {
        this.switchArmWeapon(BUSTER_SLOT_INDEX, true);
      }
    }
  }

  addUtilityArm(item, select = false) {
    if (!isUtilityArmItem(item)) {
      return false;
    }

    const existingIndex = this.utilityArms.findIndex((utility) => utility.id === item.id);
    if (existingIndex >= 0) {
      if (select) {
        this.activeUtilityArmIndex = existingIndex;
        this.switchArmWeapon(UTILITY_ARM_SLOT_INDEX, true);
      }
      return false;
    }

    this.utilityArms.push(item);
    if (select || this.utilityArms.length === 1) {
      this.activeUtilityArmIndex = this.utilityArms.length - 1;
      this.switchArmWeapon(UTILITY_ARM_SLOT_INDEX, true);
    } else {
      this._syncUtilityArmHotbarSlot();
    }

    return true;
  }

  getActiveUtilityArm() {
    return this.utilityArms[this.activeUtilityArmIndex] ?? this.utilityArms[0] ?? null;
  }

  _syncUtilityArmHotbarSlot() {
    this.activeUtilityArmIndex = THREE.MathUtils.clamp(
      Math.trunc(this.activeUtilityArmIndex),
      0,
      Math.max(0, this.utilityArms.length - 1),
    );
    this.armHotbar[UTILITY_ARM_SLOT_INDEX] = this.getActiveUtilityArm();
  }

  assignBusterUpgradeToSlot(slotIndex, item) {
    const index = THREE.MathUtils.clamp(Math.trunc(slotIndex), 0, this.busterUpgradeSlots.length - 1);

    if (item === null) {
      const previous = this.busterUpgradeSlots[index] ?? null;
      this.busterUpgradeSlots[index] = null;
      this.recalculateStats();
      this.updateWeaponVisualState?.();
      return previous;
    }

    if (!isBusterUpgradeItem(item)) {
      return item ?? null;
    }

    const previous = this.busterUpgradeSlots[index] ?? null;
    this.busterUpgradeSlots[index] = item;
    this.recalculateStats();
    this.updateWeaponVisualState?.();
    return previous === item ? null : previous;
  }

  getBusterUpgradeStatBonuses() {
    const bonuses = {};

    for (const item of this.busterUpgradeSlots) {
      if (!item) {
        continue;
      }

      for (const [stat, value] of Object.entries(item.getStatTotals())) {
        bonuses[stat] = (bonuses[stat] ?? 0) + value;
      }
    }

    return bonuses;
  }

  playAttackAnimation(duration, weaponKind = this.getWeaponKind(), targetPosition = null) {
    if (weaponKind !== 'melee') {
      this.playProjectileShotAnimation(duration, targetPosition);
      return;
    }

    this._attackWeaponKind = weaponKind;

    if (targetPosition) {
      this.faceTarget(targetPosition);
    }

    this.animation.playAttack(duration);
  }

  playSwordSlashAnimation(duration, targetPosition = null) {
    this._attackWeaponKind = 'beamBlade';
    this.lockAttackFacing(targetPosition, duration);

    this.animation.playAttack(duration, 'beamBlade');
  }

  lockAttackFacing(targetPosition = null, duration = 0.3) {
    if (targetPosition) {
      worldForward.copy(targetPosition).sub(this.root.position);
      worldForward.y = 0;
    } else {
      worldForward.copy(this.lastMoveDirection);
    }

    if (worldForward.lengthSq() <= 0.0001) {
      worldForward.copy(this.lastMoveDirection);
    }

    if (worldForward.lengthSq() <= 0.0001) {
      return;
    }

    worldForward.normalize();
    this.attackFacingDirection.copy(worldForward);
    this.attackFacingTimer = Math.max(this.attackFacingTimer, duration);
    this.faceDirection(this.attackFacingDirection);
  }

  playProjectileShotAnimation(duration, targetPosition = null, aimLockDuration = MIN_PROJECTILE_AIM_LOCK_TIME, options = {}) {
    const weaponKey = options.weaponKey ?? this._getActiveArmWeaponKey();
    const sameWeapon = this._bracedFireWeaponKey === weaponKey;
    const alreadyLocked = sameWeapon && this.bracedFireTimer > 0;
    const linger = options.continuous ? 0 : PROJECTILE_STANCE_LINGER_TIME;
    const lockDuration = Math.max(duration, aimLockDuration, MIN_PROJECTILE_AIM_LOCK_TIME) + linger;

    this.holdProjectileFiringPose(targetPosition, lockDuration, { weaponKey });

    if (!alreadyLocked) {
      this.animation.playAttack(duration);
    }
  }

  holdProjectileFiringPose(targetPosition = null, duration = MIN_PROJECTILE_AIM_LOCK_TIME, options = {}) {
    const weaponKey = options.weaponKey ?? this._getActiveArmWeaponKey();
    const holdDuration = Math.max(duration, MIN_BRACED_SHOT_TIME);

    this._attackWeaponKind = 'projectile';
    this._bracedFireWeaponKey = weaponKey;

    if (targetPosition) {
      this.beginProjectileAim(targetPosition, holdDuration);
    } else {
      this.bracedFireTimer = Math.max(this.bracedFireTimer, holdDuration);
    }
  }

  _releaseProjectileAim() {
    if (this._attackWeaponKind !== 'projectile') {
      return;
    }

    this._attackWeaponKind = null;
    this._bracedFireWeaponKey = null;
    this.bracedFireTimer = 0;
    this.bracedBackpedalTimer = 0;
  }

  _getActiveArmWeaponKey() {
    const weapon = this.getActiveArmWeapon?.() ?? this.equipment.get('weapon');
    return weapon?.id ?? weapon?.type ?? 'default-buster';
  }

  setMovementLock(duration = 0.12, multiplier = 0) {
    this.movementLockTimer = Math.max(this.movementLockTimer, duration);
    this.movementLockMultiplier = Math.min(this.movementLockMultiplier, THREE.MathUtils.clamp(multiplier, 0, 1));
  }

  canUseShieldGuard() {
    return this.equipment.get('offhand')?.type === 'shieldArm' && this.guardCooldown <= 0 && !this.dead;
  }

  startShieldGuard(targetPosition = null) {
    const shield = this.equipment.get('offhand');

    if (shield?.type !== 'shieldArm' || this.guardCooldown > 0 || this.dead) {
      return false;
    }

    guardSourceDirection.copy(targetPosition ?? this.root.position).sub(this.root.position);
    guardSourceDirection.y = 0;

    if (guardSourceDirection.lengthSq() <= 0.0001) {
      guardSourceDirection.copy(this.lastMoveDirection);
    }

    if (guardSourceDirection.lengthSq() <= 0.0001) {
      guardSourceDirection.set(0, 0, 1);
    }

    guardSourceDirection.normalize();
    this.guardDirection.copy(guardSourceDirection);
    this.bracedFireDirection.copy(guardSourceDirection);
    this.bracedFireTimer = Math.max(this.bracedFireTimer, MIN_BRACED_SHOT_TIME);
    this.guardDuration = SHIELD_GUARD_DURATION;
    this.guardTimer = SHIELD_GUARD_DURATION;
    this.guardParryTimer = SHIELD_PARRY_WINDOW;
    this.guardCooldown = SHIELD_GUARD_COOLDOWN;
    this.lastGuardResult = null;
    this.faceDirection(this.guardDirection);
    return true;
  }

  isShieldGuarding() {
    return this.guardTimer > 0 && this.equipment.get('offhand')?.type === 'shieldArm';
  }

  isShieldParrying() {
    return this.isShieldGuarding() && this.guardParryTimer > 0;
  }

  beginProjectileAim(targetPosition, duration = MIN_BRACED_SHOT_TIME) {
    worldForward.copy(targetPosition).sub(this.root.position);
    worldForward.y = 0;

    if (worldForward.lengthSq() <= 0.0001) {
      worldForward.copy(this.lastMoveDirection);
    }

    if (worldForward.lengthSq() <= 0.0001) {
      return;
    }

    worldForward.normalize();
    this.bracedFireDirection.copy(worldForward);
    this.bracedFireTimer = Math.max(this.bracedFireTimer, duration);

    const targetBehindMovement = this.lastMoveDirection.dot(this.bracedFireDirection) < -0.35;
    this.bracedBackpedalTimer = targetBehindMovement
      ? Math.max(this.bracedBackpedalTimer, Math.min(duration, 0.34))
      : 0;

    this.faceDirection(this.bracedFireDirection);
  }

  recalculateStats() {
    const previousMaxHealth = this.stats.maxHealth;
    const healthPercent = previousMaxHealth > 0 ? this.health / previousMaxHealth : 1;
    const bonuses = this.equipment.getStatBonuses();

    this.stats = { ...this.baseStats };

    for (const [stat, value] of Object.entries(bonuses)) {
      this.stats[stat] = (this.stats[stat] ?? 0) + value;
    }

    if (this.activeArmIndex === BUSTER_SLOT_INDEX) {
      for (const [stat, value] of Object.entries(this.getBusterUpgradeStatBonuses())) {
        this.stats[stat] = (this.stats[stat] ?? 0) + value;
      }
    }

    for (const buff of this.temporaryStatBonuses.values()) {
      for (const [stat, value] of Object.entries(buff.bonuses)) {
        this.stats[stat] = (this.stats[stat] ?? 0) + value;
      }
    }

    this.stats.attackSpeed = Math.max(0.25, this.stats.attackSpeed);
    this.stats.criticalChance = THREE.MathUtils.clamp(this.stats.criticalChance, 0, 0.85);
    this.stats.criticalDamage = Math.max(1, this.stats.criticalDamage);
    this.stats.projectileCount = Math.max(1, Math.round(this.stats.projectileCount));
    this.stats.projectilePierce = Math.max(0, Math.round(this.stats.projectilePierce));
    this.stats.maxHealth = Math.max(1, this.stats.maxHealth);
    this.stats.maxEnergy = Math.max(1, this.stats.maxEnergy);
    this.stats.energyRecharge = Math.max(0, this.stats.energyRecharge);
    this.stats.cooldownReduction = THREE.MathUtils.clamp(this.stats.cooldownReduction ?? 0, 0, 0.75);
    this.stats.armorBreakChance = THREE.MathUtils.clamp(this.stats.armorBreakChance ?? 0, 0, 0.85);
    this.stats.staggerResistance = THREE.MathUtils.clamp(this.stats.staggerResistance ?? 0, 0, 0.85);

    this.health = THREE.MathUtils.clamp(this.stats.maxHealth * healthPercent, 1, this.stats.maxHealth);
  }

  takeDamage(amount, source = null) {
    if (this.dead) {
      return 0;
    }

    const guardResult = this._getShieldGuardResult(source);
    const guardedAmount = amount * (1 - guardResult.reduction);
    const mitigated = guardedAmount * (100 / (100 + this.stats.armor));

    if (guardResult.blocked) {
      this.lastGuardResult = guardResult;
    }

    this.health = Math.max(0, this.health - mitigated);

    if (!guardResult.parried && mitigated > amount * 0.18) {
      const heavyHitThreshold = Math.max(HEAVY_HIT_MIN_DAMAGE, this.stats.maxHealth * HEAVY_HIT_HEALTH_FRACTION);

      this._captureDamageHitDirection(source);

      if (!guardResult.blocked && mitigated >= heavyHitThreshold) {
        this._playKnockbackFall(source);
      } else {
        this.animation.playHurt();
      }
    }

    if (source?.affix?.id === 'frostCore' && mitigated > 0.5) {
      this.applySlow(0.55, 1.5);
    }

    if (this.health <= 0) {
      this.dead = true;
      this.animation.playDead();
    }

    return mitigated;
  }

  _playKnockbackFall(source = null) {
    if (source?.root?.position || source?.position) {
      this.knockbackFallDirection.copy(this.root.position).sub(source.root?.position ?? source.position);
      this.knockbackFallDirection.y = 0;
    } else {
      this.knockbackFallDirection.copy(this.lastMoveDirection).multiplyScalar(-1);
    }

    if (this.knockbackFallDirection.lengthSq() <= 0.0001) {
      this.knockbackFallDirection.set(0, 0, -1);
    } else {
      this.knockbackFallDirection.normalize();
    }

    this._releaseProjectileAim();
    this.attackFacingTimer = 0;
    this.movementLockTimer = Math.max(this.movementLockTimer, 2.0);
    this.movementLockMultiplier = 0;

    if (!this.animation.playKnockbackFall?.()) {
      this.animation.playHurt();
    }
  }

  _captureDamageHitDirection(source = null) {
    if (source?.root?.position || source?.position) {
      damageSourceDirection.copy(source.root?.position ?? source.position).sub(this.root.position);
      damageSourceDirection.y = 0;
    } else {
      damageSourceDirection.copy(this.lastMoveDirection);
    }

    if (damageSourceDirection.lengthSq() <= 0.0001) {
      damageSourceDirection.copy(this.lastMoveDirection);
    }

    if (damageSourceDirection.lengthSq() <= 0.0001) {
      damageSourceDirection.set(0, 0, 1);
    } else {
      damageSourceDirection.normalize();
    }

    worldForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    if (worldForward.lengthSq() <= 0.0001) {
      worldForward.set(0, 0, 1);
    } else {
      worldForward.normalize();
    }

    damageFacingRight.set(worldForward.z, 0, -worldForward.x);
    this.damageHitLocalDirection.set(
      THREE.MathUtils.clamp(damageSourceDirection.dot(damageFacingRight), -1, 1),
      0,
      THREE.MathUtils.clamp(damageSourceDirection.dot(worldForward), -1, 1),
    );
  }

  heal(amount) {
    if (this.dead) {
      return;
    }

    this.health = Math.min(this.stats.maxHealth, this.health + amount);
  }

  addTemporaryStatBonus(id, label, bonuses, duration, color = '#77e8ff') {
    if (!id || !bonuses || duration <= 0) {
      return null;
    }

    const buff = {
      id,
      label,
      bonuses: { ...bonuses },
      duration,
      remaining: duration,
      color,
    };

    this.temporaryStatBonuses.set(id, buff);
    this.recalculateStats();
    return buff;
  }

  getTemporaryBuffs() {
    return [...this.temporaryStatBonuses.values()].map((buff) => ({ ...buff }));
  }

  applySlow(multiplier, duration) {
    this.slowMultiplier = Math.min(this.slowMultiplier, multiplier);
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  addExperience(amount) {
    this.experience += amount;

    while (this.experience >= this.experienceToNext) {
      this.experience -= this.experienceToNext;
      this.level += 1;
      this.experienceToNext = Math.round(this.experienceToNext * 1.35 + 15);
      this.baseStats.maxHealth += 10;
      this.baseStats.attackDamage += 1.5;
      this.baseStats.pickupRadius += 0.04;
      this.recalculateStats();
      this.health = this.stats.maxHealth;
    }
  }

  setSkinColor(color) {
    this.humanoid.setSkinColor(color);
  }

  setHairColor(color) {
    this.humanoid.setHairColor(color);
  }

  setArmorColor(color) {
    this.humanoid.setArmorColor(color);
  }

  setWeaponColor(color) {
    this.weaponColor.set(color);
    const weaponVisuals = this.equipment.visuals.get('weapon') ?? [];

    for (const visual of weaponVisuals) {
      visual.traverse((object) => {
        if (object.material?.color) {
          object.material.color.copy(this.weaponColor);
        }
      });
    }
  }

  setClothingColor(color) {
    this.humanoid.setClothColor(color);
  }

  usesExternalCharacterModel() {
    return Boolean(this._loadedModel && this.modelRoot.visible);
  }

  updateWeaponVisualState() {
    const activeArm = this.getActiveArmWeapon?.();
    const beamBladeActive = activeArm?.type === 'swordArm';
    const drillActive = activeArm?.type === 'drillArm';

    this.externalRig?.setDrillArmActive?.(drillActive, this.getActiveWeaponGlowColor(0xffd36f));
    this.externalRig?.setBusterArmActive(!drillActive && this.isUsingProjectileWeapon());
    this.externalRig?.setBeamBladeActive?.(beamBladeActive, this.getActiveWeaponGlowColor(this.weaponColor.getHex()));
  }

  _updateStatusEffects(dt) {
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;

      if (this.slowTimer <= 0) {
        this.slowMultiplier = 1;
      }
    }
  }

  _updateTemporaryStatBonuses(dt) {
    let expired = false;

    for (const [id, buff] of this.temporaryStatBonuses.entries()) {
      buff.remaining -= dt;

      if (buff.remaining <= 0) {
        this.temporaryStatBonuses.delete(id);
        expired = true;
      }
    }

    if (expired) {
      this.recalculateStats();
    }
  }

  _updateBracedFireState(dt) {
    this.bracedFireTimer = Math.max(0, this.bracedFireTimer - dt);
    this.bracedBackpedalTimer = Math.max(0, this.bracedBackpedalTimer - dt);
  }

  _updateShieldGuardState(dt) {
    this.guardTimer = Math.max(0, this.guardTimer - dt);
    this.guardParryTimer = Math.min(this.guardTimer, Math.max(0, this.guardParryTimer - dt));
    this.guardCooldown = Math.max(0, this.guardCooldown - dt);
  }

  _updateMovementLockState(dt) {
    if (this.movementLockTimer <= 0) {
      this.movementLockMultiplier = 1;
      return;
    }

    this.movementLockTimer = Math.max(0, this.movementLockTimer - dt);
    if (this.movementLockTimer <= 0) {
      this.movementLockMultiplier = 1;
    }
  }

  _updateAttackFacingState(dt) {
    this.attackFacingTimer = Math.max(0, this.attackFacingTimer - dt);
  }

  _getShieldGuardResult(source) {
    if (!this.isShieldGuarding() || !this._isGuardFacingSource(source)) {
      return { blocked: false, parried: false, reduction: 0 };
    }

    const shieldStats = this.equipment.get('offhand')?.getStatTotals?.() ?? {};
    const shieldArmor = shieldStats.armor ?? 0;
    const guardBonus = THREE.MathUtils.clamp(shieldArmor * 0.012, 0, 0.18);
    const parryBonus = THREE.MathUtils.clamp(this.stats.staggerResistance * 0.18, 0, 0.1);
    const parried = this.isShieldParrying() && Boolean(source?.root);
    const reduction = parried
      ? THREE.MathUtils.clamp(0.86 + guardBonus + parryBonus, 0.86, 0.96)
      : THREE.MathUtils.clamp(0.56 + guardBonus, 0.56, 0.78);

    if (parried) {
      this._parrySource(source);
      this.guardParryTimer = 0;
      this.guardTimer = Math.min(this.guardTimer, 0.24);
    }

    return { blocked: true, parried, reduction };
  }

  _isGuardFacingSource(source) {
    if (!source?.root?.position && !source?.position) {
      return true;
    }

    guardSourceDirection.copy(source.root?.position ?? source.position).sub(this.root.position);
    guardSourceDirection.y = 0;

    if (guardSourceDirection.lengthSq() <= 0.0001) {
      return true;
    }

    guardSourceDirection.normalize();
    return this.guardDirection.dot(guardSourceDirection) > 0.05;
  }

  _parrySource(source) {
    source.applyStatus?.('stagger', { duration: source.isElite ? 0.34 : 0.58 });

    if (source.knockback?.addScaledVector && source.root?.position) {
      guardSourceDirection.copy(source.root.position).sub(this.root.position);
      guardSourceDirection.y = 0;

      if (guardSourceDirection.lengthSq() > 0.0001) {
        source.knockback.addScaledVector(guardSourceDirection.normalize(), source.isElite ? 3.2 : 5.2);
      }
    }
  }

  _loadCharacterModel() {
    const fbxLoader = new FBXLoader();
    fbxLoader.setPath(PLAYER_MODEL_PATH);
    fbxLoader.setResourcePath(PLAYER_MODEL_PATH);

    fbxLoader.load(
      PLAYER_MODEL_FBX,
      (model) => this._useExternalCharacterModel(model, { source: 'fbx' }),
      undefined,
      (error) => {
        console.warn('Could not load rigged FBX player model. Falling back to OBJ model.', error);
        this._loadLegacyObjCharacterModel();
      },
    );
  }

  _loadLegacyObjCharacterModel() {
    const materialLoader = new MTLLoader();
    materialLoader.setPath(PLAYER_MODEL_PATH);
    materialLoader.setResourcePath(PLAYER_MODEL_PATH);

    materialLoader.load(
      PLAYER_MODEL_MTL,
      (materials) => {
        materials.preload();

        const objectLoader = new OBJLoader();
        objectLoader.setPath(PLAYER_MODEL_PATH);
        objectLoader.setMaterials(materials);
        objectLoader.load(
          PLAYER_MODEL_OBJ,
          (model) => this._useExternalCharacterModel(model),
          undefined,
          (error) => this._handleModelLoadError(error),
        );
      },
      undefined,
      (error) => this._handleModelLoadError(error),
    );
  }

  _loadFbxAnimationLibrary(targetRig = this.externalRig) {
    if (!targetRig?.setAnimationClips || this._fbxAnimationLibraryLoading) {
      return;
    }

    this._fbxAnimationLibraryLoading = true;
    this._fbxAnimationLibraryLoaded = false;

    const loader = new FBXLoader();
    loader.setPath(PLAYER_ANIMATION_PATH);
    loader.setResourcePath(PLAYER_MODEL_PATH);

    const loadClip = (definition) => new Promise((resolve) => {
      loader.load(
        definition.file,
        (animationModel) => {
          const clip = animationModel.animations?.[0] ?? null;

          if (!clip) {
            console.warn(`FBX animation file did not include an animation clip: ${definition.file}`);
            resolve(null);
            return;
          }

          clip.name = definition.key;
          resolve([definition.key, { ...definition, clip }]);
        },
        undefined,
        (error) => {
          console.warn(`Could not load FBX animation clip: ${definition.file}`, error);
          resolve(null);
        },
      );
    });

    Promise.all(PLAYER_FBX_ANIMATION_DEFINITIONS.map(loadClip))
      .then((loadedEntries) => {
        if (this.externalRig !== targetRig) {
          return;
        }

        const clips = new Map();
        for (const entry of loadedEntries) {
          if (entry) {
            clips.set(entry[0], entry[1]);
          }
        }

        const loadedCount = targetRig.setAnimationClips(clips);
        targetRig.root.userData.fbxAnimationLoadState = {
          loaded: loadedCount,
          expected: PLAYER_FBX_ANIMATION_DEFINITIONS.length,
          clips: [...clips.keys()],
        };
        this._fbxAnimationLibraryLoaded = loadedCount > 0;
      })
      .finally(() => {
        this._fbxAnimationLibraryLoading = false;
      });
  }

  _useExternalCharacterModel(model, { source = 'obj' } = {}) {
    model.name = 'playerMegaManVolnuttModel';
    const isSkinnedModel = source === 'fbx' || this._modelHasSkinnedMesh(model);

    if (isSkinnedModel) {
      this._applyVolnuttTextureToSkinnedModel(model);
    }

    model.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      object.name ||= 'playerModelMesh';
      object.castShadow = true;
      object.receiveShadow = true;

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) {
          continue;
        }

        material.side = THREE.FrontSide;
        material.needsUpdate = true;
      }
    });

    this._fitModelToPlayer(model);

    let visibleModel = model;
    this.externalRig = null;
    this._loadedModelUsesFbxClips = false;

    try {
      const rig = isSkinnedModel
        ? new SkeletalModelRig(model)
        : new ExternalModelRig(model);

      if (rig.meshCount > 0) {
        visibleModel = rig.root;
        this.externalRig = rig;
        this._loadedModelUsesFbxClips = Boolean(rig.usesFbxAnimationClips);
        this.animation.setPoseOutputEnabled?.(!this._loadedModelUsesFbxClips);
        this._loadBusterArmModel();

        if (this._loadedModelUsesFbxClips) {
          this._loadFbxAnimationLibrary(rig);
        }
      }
    } catch (error) {
      console.warn('Could not create animated player rig. Using the static model instead.', error);
    }

    if (!this._loadedModelUsesFbxClips) {
      this.animation.setPoseOutputEnabled?.(true);
    }

    this.modelRoot.clear();
    this.modelRoot.add(visibleModel);
    this.modelRoot.visible = true;
    this._loadedModel = visibleModel;
    this._hideProceduralBodyMeshes();
    this._setEquipmentVisualsVisible(false);
    this.updateWeaponVisualState();
  }

  _modelHasSkinnedMesh(model) {
    let hasSkinnedMesh = false;

    model.traverse((object) => {
      if (object.isSkinnedMesh) {
        hasSkinnedMesh = true;
      }
    });

    return hasSkinnedMesh;
  }

  _applyVolnuttTextureToSkinnedModel(model) {
    const texture = new THREE.TextureLoader().load(`${PLAYER_MODEL_PATH}${PLAYER_MODEL_TEXTURE}`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.name = 'texture_MegaManVolnutt_FBXDiffuse';

    model.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      const material = new THREE.MeshStandardMaterial({
        name: 'material_MegaManVolnutt_FBXTextured',
        map: texture,
        color: 0xffffff,
        roughness: 0.42,
        metalness: 0.08,
      });
      material.side = THREE.FrontSide;
      object.material = material;
    });
  }

  _fitModelToPlayer(model) {
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? TARGET_MODEL_HEIGHT / size.y : 1;

    this._characterModelScale = scale;
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);

    const scaledBounds = new THREE.Box3().setFromObject(model);
    const center = scaledBounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -scaledBounds.min.y, -center.z);
  }

  _hideProceduralBodyMeshes() {
    const hiddenMaterials = new Set([
      this.humanoid.materials.skin,
      this.humanoid.materials.hair,
      this.humanoid.materials.eyes,
      this.humanoid.materials.cloth,
    ]);

    this.humanoid.root.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => hiddenMaterials.has(material))) {
        object.visible = false;
      }
    });
  }

  _handleModelLoadError(error) {
    console.warn('Could not load player character model. Falling back to procedural humanoid.', error);
    this.modelRoot.visible = false;
    this.externalRig = null;
    this._setEquipmentVisualsVisible(true);
  }

  _loadBusterArmModel() {
    if (!this.externalRig || this._busterArmLoading || this._busterArmLoaded) {
      return;
    }

    this._busterArmLoading = true;
    const materialLoader = new MTLLoader();
    materialLoader.setPath(PLAYER_MODEL_PATH);
    materialLoader.setResourcePath(PLAYER_MODEL_PATH);

    materialLoader.load(
      BUSTER_MODEL_MTL,
      (materials) => {
        materials.preload();

        const objectLoader = new OBJLoader();
        objectLoader.setPath(PLAYER_MODEL_PATH);
        objectLoader.setMaterials(materials);
        objectLoader.load(
          BUSTER_MODEL_OBJ,
          (model) => {
            this._busterArmLoading = false;
            this._busterArmLoaded = true;
            this._prepareBusterArmModel(model);
            this.externalRig?.setBusterArm(model);
            this.updateWeaponVisualState();
          },
          undefined,
          (error) => this._handleBusterLoadError(error),
        );
      },
      undefined,
      (error) => this._handleBusterLoadError(error),
    );
  }

  _prepareBusterArmModel(model) {
    model.name = 'playerMegaBusterArm';
    model.scale.setScalar(this._characterModelScale);

    model.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      object.name ||= 'playerBusterMesh';
      object.castShadow = true;
      object.receiveShadow = true;

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) {
          continue;
        }

        material.side = THREE.FrontSide;
        material.needsUpdate = true;
      }
    });

    model.updateMatrixWorld(true);
  }

  _handleBusterLoadError(error) {
    this._busterArmLoading = false;
    console.warn('Could not load player buster arm model.', error);
  }

  _updateExternalModelMotion(dt, moving, moveAmount = 0, backpedaling = false, running = false, motionOptions = {}) {
    if (!this._loadedModel) {
      return;
    }

    const walkDirection = backpedaling ? -0.86 : 1;
    const walkSpeed = 8.6 * Math.max(0.55, moveAmount || 0);
    if (moving) {
      this._modelWalkTime += dt * walkSpeed * walkDirection;
    }

    const clipDrivenRig = Boolean(this.externalRig?.usesFbxAnimationClips);
    const actionProgress = Number.isFinite(motionOptions.actionProgress)
      ? THREE.MathUtils.clamp(motionOptions.actionProgress, 0, 1)
      : this.animation.getActionProgress?.() ?? 0;
    const animationState = motionOptions.animationState ?? this.animation.state;

    if (clipDrivenRig) {
      const alpha = Math.min(1, dt * 14);
      this.modelRoot.position.y = THREE.MathUtils.lerp(this.modelRoot.position.y, 0, alpha);
      this.modelRoot.rotation.x = THREE.MathUtils.lerp(this.modelRoot.rotation.x, 0, alpha);
      this.modelRoot.rotation.z = THREE.MathUtils.lerp(this.modelRoot.rotation.z, 0, alpha);
    } else {
      const stepLift = Math.abs(Math.sin(this._modelWalkTime));
      let targetY = moving ? stepLift * 0.062 : 0;
      let targetRoll = moving ? Math.sin(this._modelWalkTime) * 0.032 : 0;
      let targetPitch = 0;

      if (animationState === 'neutralJump' || animationState === 'forwardJump') {
        const jumpLift = Math.sin(actionProgress * Math.PI) * (animationState === 'forwardJump' ? 0.58 : 0.72);
        const landingCompression = THREE.MathUtils.smoothstep(actionProgress, 0.78, 1) * 0.045;
        targetY = Math.max(targetY, jumpLift) - landingCompression;
        targetPitch = animationState === 'forwardJump' ? -Math.sin(actionProgress * Math.PI) * 0.08 : 0;
      } else if (animationState === 'dodgeRoll') {
        targetY = Math.max(0.02, targetY * 0.45);
        targetPitch = Math.sin(actionProgress * Math.PI) * 0.18;
        targetRoll += Math.sin(actionProgress * Math.PI * 2) * 0.08;
      } else if (animationState === 'knockbackFall' || animationState === 'downed') {
        targetY = Math.max(0, targetY * 0.25);
        targetPitch = -THREE.MathUtils.smoothstep(actionProgress, 0.15, 0.85) * 0.16;
        targetRoll += -THREE.MathUtils.smoothstep(actionProgress, 0.2, 0.8) * 0.08;
      } else if (animationState === 'getUp') {
        const crouch = Math.sin(actionProgress * Math.PI);
        targetY = Math.max(0, targetY * 0.35 - crouch * 0.025);
        targetPitch = -0.1 * (1 - THREE.MathUtils.smoothstep(actionProgress, 0.25, 1));
      }

      this.modelRoot.position.y = THREE.MathUtils.lerp(this.modelRoot.position.y, targetY, Math.min(1, dt * 12));
      this.modelRoot.rotation.x = THREE.MathUtils.lerp(this.modelRoot.rotation.x, targetPitch, Math.min(1, dt * 12));
      this.modelRoot.rotation.z = THREE.MathUtils.lerp(this.modelRoot.rotation.z, targetRoll, Math.min(1, dt * 12));
    }

    const rawAttackProgress = Number.isFinite(motionOptions.attackProgress)
      ? THREE.MathUtils.clamp(motionOptions.attackProgress, 0, 1)
      : this.animation.attackDuration > 0
      ? 1 - THREE.MathUtils.clamp(this.animation.attackTimer / this.animation.attackDuration, 0, 1)
      : 0;
    const attackKind = motionOptions.attackKind ?? this._attackWeaponKind;
    const projectileAimLocked = motionOptions.projectileAiming ?? (attackKind === 'projectile' && this.bracedFireTimer > 0);
    const projectileAiming = motionOptions.projectileAiming ?? (projectileAimLocked || (attackKind === 'projectile' && this.animation.attackTimer > 0));
    const sustainedProjectileAim = projectileAiming && this.animation.attackTimer <= 0;
    const attackProgress = sustainedProjectileAim ? 1 : rawAttackProgress;
    const hurtProgress = this.animation.hurtTimer > 0
      ? 1 - THREE.MathUtils.clamp(this.animation.hurtTimer / 0.18, 0, 1)
      : 0;

    this.externalRig?.update(dt, {
      moving,
      moveAmount,
      state: projectileAiming ? 'attacking' : animationState,
      attackProgress,
      actionProgress,
      actionDuration: this.animation.actionDuration ?? 0,
      hurtProgress,
      damageHitLocal: this.damageHitLocalDirection,
      projectileAiming,
      backpedaling,
      running,
      attackKind,
      lockOnActive: Boolean(motionOptions.lockOnActive),
      strafeAmount: motionOptions.strafeAmount ?? 0,
      clipKey: motionOptions.clipKey ?? null,
    });

    if (!motionOptions.skipAttackKindReset && this.animation.attackTimer <= 0 && !projectileAimLocked) {
      this._attackWeaponKind = null;
    }
  }

  _setEquipmentVisualsVisible(visible) {
    for (const visuals of this.equipment.visuals.values()) {
      for (const visual of visuals) {
        visual.visible = visible;
      }
    }
  }
}
