import * as THREE from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { AnimationController } from './AnimationController.js';
import { EquipmentManager } from './EquipmentManager.js';
import { ExternalModelRig } from './ExternalModelRig.js';
import { ModularHumanoid } from './ModularHumanoid.js';

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
const guardSourceDirection = new THREE.Vector3();
const PLAYER_MODEL_PATH = './assets/models/';
const PLAYER_MODEL_MTL = 'Mega Man Volnutt.mtl';
const PLAYER_MODEL_OBJ = 'Mega Man Volnutt.obj';
const BUSTER_MODEL_MTL = 'Mega Man Volnutt Buster US.mtl';
const BUSTER_MODEL_OBJ = 'Mega Man Volnutt Buster US.obj';
const TARGET_MODEL_HEIGHT = 2.85;
const MIN_BRACED_SHOT_TIME = 0.28;
const MIN_PROJECTILE_AIM_LOCK_TIME = 0.44;
const PROJECTILE_STANCE_LINGER_TIME = 1.05;
const SHIELD_GUARD_DURATION = 0.7;
const SHIELD_GUARD_COOLDOWN = 0.82;
const SHIELD_PARRY_WINDOW = 0.18;

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
    this._busterArmLoading = false;
    this._busterArmLoaded = false;
    this._attackWeaponKind = null;
    this._bracedFireWeaponKey = null;
    this.bracedFireDirection = new THREE.Vector3(0, 0, 1);
    this.bracedFireTimer = 0;
    this.bracedBackpedalTimer = 0;
    this.movementLockTimer = 0;
    this.movementLockMultiplier = 1;
    this.guardDirection = new THREE.Vector3(0, 0, 1);
    this.guardTimer = 0;
    this.guardDuration = 0;
    this.guardParryTimer = 0;
    this.guardCooldown = 0;
    this.lastGuardResult = null;
    this.armHotbar = [null, null, null, null];
    this.activeArmIndex = 0;
    this.temporaryStatBonuses = new Map();

    this._loadCharacterModel();
  }

  update(dt, input, arenaRadius = 32) {
    if (this.dead) {
      this.animation.update(dt);
      return;
    }

    this._updateStatusEffects(dt);
    this._updateTemporaryStatBonuses(dt);
    this._updateBracedFireState(dt);
    this._updateShieldGuardState(dt);
    this._updateMovementLockState(dt);
    this._updateAttackFacingState(dt);

    moveVector.set(0, 0);

    if (input.has('KeyW') || input.has('ArrowUp')) moveVector.y -= 1;
    if (input.has('KeyS') || input.has('ArrowDown')) moveVector.y += 1;
    if (input.has('KeyA') || input.has('ArrowLeft')) moveVector.x -= 1;
    if (input.has('KeyD') || input.has('ArrowRight')) moveVector.x += 1;

    const moving = moveVector.lengthSq() > 0;
    let moveAmount = 0;

    if (moving) {
      moveVector.normalize();
      moveAmount = moveVector.length();
      const guardMoveMultiplier = this.isShieldGuarding() ? 0.72 : 1;
      const speed = this.stats.moveSpeed * this.slowMultiplier * guardMoveMultiplier * this.movementLockMultiplier;
      this.root.position.x += moveVector.x * speed * dt;
      this.root.position.z += moveVector.y * speed * dt;

      this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -arenaRadius, arenaRadius);
      this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -arenaRadius, arenaRadius);

      this.lastMoveDirection.set(moveVector.x, 0, moveVector.y).normalize();
    }

    const attackFacing = this.attackFacingTimer > 0 && this.attackFacingDirection.lengthSq() > 0.0001;
    const bracedAiming = this.bracedFireTimer > 0 && this.bracedFireDirection.lengthSq() > 0.0001;
    const backpedaling = bracedAiming && this.bracedBackpedalTimer > 0 && moving;
    const moveAnimationAmount = moving ? moveAmount * this.movementLockMultiplier : 0;
    const visiblyMoving = moveAnimationAmount > 0.05;

    if (attackFacing) {
      this.faceDirection(this.attackFacingDirection);
    } else if (bracedAiming) {
      this.faceDirection(this.bracedFireDirection);
    } else if (moving) {
      this.faceDirection(this.lastMoveDirection);
    }

    this.animation.update(dt, { moving: visiblyMoving, moveAmount: moveAnimationAmount });
    this.updateWeaponVisualState();
    this._updateExternalModelMotion(dt, visiblyMoving, moveAnimationAmount, backpedaling);
  }

  faceDirection(direction) {
    if (direction.lengthSq() <= 0.0001) {
      return;
    }

    this.root.rotation.y = Math.atan2(direction.x, direction.z);
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
    return this.equipment.get('weapon')?.weaponKind ?? 'projectile';
  }

  isUsingProjectileWeapon() {
    if (this.getActiveArmWeapon?.()?.type === 'swordArm') {
      return true;
    }

    return this.getWeaponKind() !== 'melee';
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
    for (let i = 0; i < this.armHotbar.length; i += 1) {
      this.armHotbar[i] = items[i] ?? null;
    }

    const firstFilledSlot = this.armHotbar.findIndex(Boolean);
    if (firstFilledSlot >= 0) {
      this.switchArmWeapon(firstFilledSlot, true);
    }
  }

  assignArmWeaponToSlot(slotIndex, item) {
    if (!item || item.slot !== 'weapon') {
      return null;
    }

    const index = THREE.MathUtils.clamp(Math.trunc(slotIndex), 0, this.armHotbar.length - 1);
    const previous = this.armHotbar[index] ?? null;
    this.armHotbar[index] = item;
    this.switchArmWeapon(index, true);
    return previous === item ? null : previous;
  }

  switchArmWeapon(slotIndex, force = false) {
    const index = THREE.MathUtils.clamp(Math.trunc(slotIndex), 0, this.armHotbar.length - 1);
    const item = this.armHotbar[index];

    if (!item || (!force && index === this.activeArmIndex)) {
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
      this.animation.playHurt();
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

  _useExternalCharacterModel(model) {
    model.name = 'playerMegaManVolnuttModel';

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

    try {
      const rig = new ExternalModelRig(model);

      if (rig.meshCount > 0) {
        visibleModel = rig.root;
        this.externalRig = rig;
        this._loadBusterArmModel();
      }
    } catch (error) {
      console.warn('Could not create segmented player rig. Using the static model instead.', error);
    }

    this.modelRoot.clear();
    this.modelRoot.add(visibleModel);
    this.modelRoot.visible = true;
    this._loadedModel = visibleModel;
    this._hideProceduralBodyMeshes();
    this._setEquipmentVisualsVisible(false);
    this.updateWeaponVisualState();
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

  _updateExternalModelMotion(dt, moving, moveAmount = 0, backpedaling = false) {
    if (!this._loadedModel) {
      return;
    }

    const walkDirection = backpedaling ? -0.86 : 1;
    const walkSpeed = 8.6 * Math.max(0.55, moveAmount || 0);
    if (moving) {
      this._modelWalkTime += dt * walkSpeed * walkDirection;
    }

    const stepLift = Math.abs(Math.sin(this._modelWalkTime));
    const targetY = moving ? stepLift * 0.062 : 0;
    const targetRoll = moving ? Math.sin(this._modelWalkTime) * 0.032 : 0;

    this.modelRoot.position.y = THREE.MathUtils.lerp(this.modelRoot.position.y, targetY, Math.min(1, dt * 12));
    this.modelRoot.rotation.z = THREE.MathUtils.lerp(this.modelRoot.rotation.z, targetRoll, Math.min(1, dt * 12));

    const rawAttackProgress = this.animation.attackDuration > 0
      ? 1 - THREE.MathUtils.clamp(this.animation.attackTimer / this.animation.attackDuration, 0, 1)
      : 0;
    const projectileAimLocked = this._attackWeaponKind === 'projectile' && this.bracedFireTimer > 0;
    const projectileAiming = projectileAimLocked || (this._attackWeaponKind === 'projectile' && this.animation.attackTimer > 0);
    const sustainedProjectileAim = projectileAiming && this.animation.attackTimer <= 0;
    const attackProgress = sustainedProjectileAim ? 1 : rawAttackProgress;
    const hurtProgress = this.animation.hurtTimer > 0
      ? 1 - THREE.MathUtils.clamp(this.animation.hurtTimer / 0.18, 0, 1)
      : 0;

    this.externalRig?.update(dt, {
      moving,
      moveAmount,
      state: projectileAiming ? 'attacking' : this.animation.state,
      attackProgress,
      hurtProgress,
      projectileAiming,
      backpedaling,
      attackKind: this._attackWeaponKind,
    });

    if (this.animation.attackTimer <= 0 && !projectileAimLocked) {
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
