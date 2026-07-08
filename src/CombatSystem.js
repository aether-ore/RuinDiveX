import * as THREE from 'three';

const tempDirection = new THREE.Vector3();
const tempToEnemy = new THREE.Vector3();
const tempAimPoint = new THREE.Vector3();
const tempStart = new THREE.Vector3();
const tempEnd = new THREE.Vector3();
const tempClosest = new THREE.Vector3();
const tempMidpoint = new THREE.Vector3();
const tempFlat = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const PROJECTILE_AIM_LOCK_BUFFER = 0.12;
const LASER_TICK_INTERVAL = 0.1;
const DRILL_TICK_INTERVAL = 0.12;
const DRILL_PARTICLE_INTERVAL = 0.045;
const LIFT_BREAK_DURATION = 2.45;
const LIFT_ENEMY_OUTPUT_DRAIN_PER_SECOND = 0.48;
const SPRAY_TICK_INTERVAL = 0.11;
const SPRAY_PARTICLE_INTERVAL = 0.055;
const DEFAULT_BEAM_BLADE_COLOR = 0xa8ff8a;
const BUSTER_BASE_ENERGY = 6;
const BUSTER_BASE_BURST_SHOTS = 3;
const BUSTER_ENERGY_PER_EXTRA_SHOT = 3;
const BUSTER_MIN_BURST_SHOTS = 1;
const BUSTER_DEFAULT_SHOT_COOLDOWN = 0.24;
const BUSTER_DEFAULT_STATS = Object.freeze({
  attackDamage: 8,
  maxEnergy: BUSTER_BASE_ENERGY,
  attackRange: 6.9,
  attackSpeed: 0.1,
});

const ARM_PROFILES = {
  busterArm: {
    energyCost: 0,
    outputDrainPerShot: 1 / BUSTER_BASE_BURST_SHOTS,
    outputRequiredToFire: 1 / BUSTER_BASE_BURST_SHOTS,
    outputRecoveryPerSecond: 0.82,
    outputRecoveryDelay: 0.16,
    outputVentDuration: 0.34,
    outputLabel: 'Output',
    projectileSpeed: 9.5,
    projectileRadius: 0.17,
    cooldownMultiplier: 1,
    baseCooldown: BUSTER_DEFAULT_SHOT_COOLDOWN,
    animationDuration: 0.18,
    visualType: 'buster',
    color: 0x7ee7ff,
  },
  liftArm: {
    special: 'lift',
    energyCost: 0,
    outputDrainPerShot: 0,
    outputRequiredToFire: 0,
    outputRecoveryPerSecond: 0.55,
    outputRecoveryDelay: 0.16,
    outputVentDuration: 0.42,
    outputLabel: 'Lift Output',
    cooldownMultiplier: 0.2,
    animationDuration: 0.18,
    damageMultiplier: 0,
    liftRange: 1.55,
    liftHoldHeight: 2.45,
    liftObjectOffset: 0.22,
    liftEnemyOutputDrainPerSecond: LIFT_ENEMY_OUTPUT_DRAIN_PER_SECOND,
    color: 0x7ee7ff,
  },
  machineGunArm: {
    energyCost: 0.55,
    outputDrainPerShot: 0.045,
    outputRequiredToFire: 0.03,
    outputRecoveryPerSecond: 0.55,
    outputRecoveryDelay: 0.12,
    outputVentDuration: 0.38,
    outputLabel: 'Output',
    projectileSpeed: 10.8,
    projectileRadius: 0.12,
    cooldownMultiplier: 0.56,
    animationDuration: 0.16,
    damageMultiplier: 0.68,
    spread: 0.08,
    visualType: 'bullet',
    color: 0x8fffe8,
  },
  cannonArm: {
    energyCost: 2,
    outputDrainPerShot: 1,
    outputRequiredToFire: 0.78,
    outputRecoveryPerSecond: 0.36,
    outputRecoveryDelay: 0.48,
    outputVentDuration: 0.74,
    outputLabel: 'Chamber Output',
    projectileSpeed: 7.4,
    projectileRadius: 0.25,
    cooldownMultiplier: 1.65,
    animationDuration: 0.34,
    damageMultiplier: 1.45,
    explosiveRadius: 1.75,
    stagger: 0.32,
    armorBreakBonus: 0.08,
    visualType: 'shell',
    color: 0xffb347,
  },
  mineArm: {
    special: 'mine',
    energyCost: 1.35,
    outputDrainPerShot: 0.34,
    outputRequiredToFire: 0.22,
    outputRecoveryPerSecond: 0.42,
    outputRecoveryDelay: 0.28,
    outputVentDuration: 0.52,
    outputLabel: 'Arming Output',
    cooldownMultiplier: 1.75,
    animationDuration: 0.22,
    damageMultiplier: 1.28,
    explosiveRadius: 1.95,
    mineTriggerRadius: 1.25,
    mineMagnetRadius: 2.15,
    mineMagnetStrength: 1.55,
    mineArmingDelay: 0.5,
    mineLifetime: 7.5,
    maxActiveMines: 4,
    armorBreakBonus: 0.08,
    color: 0xffd36f,
  },
  missileArm: {
    special: 'missile',
    lockOn: true,
    energyCost: 1.5,
    outputDrainPerShot: 0.38,
    outputRequiredToFire: 0.22,
    salvoOutputCost: 0.78,
    outputRecoveryPerSecond: 0.38,
    outputRecoveryDelay: 0.32,
    outputVentDuration: 0.58,
    outputLabel: 'Lock Stability',
    salvoEnergyCost: 3.2,
    salvoCount: 3,
    salvoCooldownMultiplier: 1.72,
    salvoDamageMultiplier: 0.72,
    salvoSpread: 0.18,
    projectileSpeed: 6.8,
    projectileRadius: 0.22,
    cooldownMultiplier: 1.28,
    animationDuration: 0.3,
    damageMultiplier: 1.22,
    explosiveRadius: 1.35,
    homingStrength: 3.2,
    homingRange: 9.5,
    lockTime: 0.48,
    stagger: 0.22,
    visualType: 'missile',
    color: 0xffd36f,
  },
  grenadeArm: {
    special: 'grenade',
    energyCost: 1.75,
    outputDrainPerShot: 0.58,
    outputRequiredToFire: 0.36,
    outputRecoveryPerSecond: 0.34,
    outputRecoveryDelay: 0.34,
    outputVentDuration: 0.54,
    outputLabel: 'Throw Output',
    clusterEnergyCost: 2.25,
    projectileSpeed: 5.8,
    projectileRadius: 0.22,
    cooldownMultiplier: 1.45,
    clusterCooldownMultiplier: 1.72,
    animationDuration: 0.32,
    damageMultiplier: 1.18,
    explosiveRadius: 1.55,
    explodeOnExpire: true,
    arcHeight: 1.3,
    stagger: 0.26,
    clusterCount: 5,
    visualType: 'grenade',
    color: 0xff9f43,
  },
  railBusterArm: {
    special: 'rail',
    energyCost: 1.65,
    outputDrainPerShot: 0.66,
    outputRequiredToFire: 0.48,
    outputRecoveryPerSecond: 0.42,
    outputRecoveryDelay: 0.38,
    outputVentDuration: 0.5,
    outputLabel: 'Capacitor Output',
    cooldownMultiplier: 1.18,
    animationDuration: 0.24,
    damageMultiplier: 1.22,
    railWidth: 0.22,
    railRangeBonus: 2.4,
    pierceBonus: 3,
    armorPierce: 16,
    armorBreakBonus: 0.08,
    color: 0xcff9ff,
  },
  scatterBusterArm: {
    energyCost: 1.2,
    outputDrainPerShot: 0.11,
    outputRequiredToFire: 0.07,
    outputRecoveryPerSecond: 0.48,
    outputRecoveryDelay: 0.16,
    outputLabel: 'Output',
    projectileSpeed: 9.2,
    projectileRadius: 0.13,
    cooldownMultiplier: 0.96,
    animationDuration: 0.22,
    damageMultiplier: 0.64,
    spread: 0.19,
    extraProjectiles: 4,
    visualType: 'pellet',
    color: 0x92ffd5,
  },
  homingSeekerArm: {
    energyCost: 1.4,
    outputDrainPerShot: 0.2,
    outputRequiredToFire: 0.12,
    outputRecoveryPerSecond: 0.42,
    outputRecoveryDelay: 0.2,
    outputLabel: 'Tracking Output',
    projectileSpeed: 7.6,
    projectileRadius: 0.18,
    cooldownMultiplier: 1.08,
    animationDuration: 0.26,
    damageMultiplier: 0.94,
    homingStrength: 4.6,
    homingRange: 8.5,
    freeHoming: true,
    explosiveRadius: 0.75,
    visualType: 'seeker',
    color: 0xffdf7e,
  },
  laserArm: {
    special: 'laser',
    energyCost: 0,
    outputDrainPerSecond: 1.12,
    outputRequiredToFire: 0.24,
    outputRecoveryPerSecond: 0.24,
    outputRecoveryDelay: 0.9,
    outputVentDuration: 0.88,
    outputLabel: 'Beam Stability',
    cooldownMultiplier: 0.34,
    animationDuration: 0.16,
    damageMultiplier: 0.48,
    energyDrainPerSecond: 3.8,
    beamWidth: 0.34,
    heatBuildRate: 0.46,
    heatCoolRate: 0.58,
    maxHeatDamageBonus: 1.65,
    maxHeatWidthBonus: 0.95,
    overheatRadius: 2.45,
    overheatDamageMultiplier: 1.9,
    beamMovementMultiplier: 0.08,
    armorPierce: 24,
    armorBreakBonus: 0.1,
    stagger: 0.06,
    color: 0xbff5ff,
  },
  flameArm: {
    special: 'cone',
    energyCost: 1,
    outputDrainPerShot: 0.16,
    outputRequiredToFire: 0.18,
    energyDrainPerSecond: 1.9,
    outputDrainPerSecond: 1.05,
    outputRecoveryPerSecond: 0.32,
    outputRecoveryDelay: 0.28,
    outputVentDuration: 0.72,
    outputLabel: 'Pressure',
    sprayDamagePerSecondMultiplier: 1.62,
    cooldownMultiplier: 0.82,
    animationDuration: 0.22,
    damageMultiplier: 0.88,
    coneAngle: 0.58,
    coneRangeMultiplier: 0.9,
    coneKnockback: 1.3,
    fireZoneDuration: 1.15,
    element: 'fire',
    statusBuildup: 0.8,
    color: 0xff7842,
  },
  iceSprayerArm: {
    special: 'cone',
    energyCost: 1,
    outputDrainPerShot: 0.16,
    outputRequiredToFire: 0.18,
    energyDrainPerSecond: 1.85,
    outputDrainPerSecond: 1.08,
    outputRecoveryPerSecond: 0.32,
    outputRecoveryDelay: 0.28,
    outputVentDuration: 0.74,
    outputLabel: 'Pressure',
    sprayDamagePerSecondMultiplier: 1.52,
    cooldownMultiplier: 0.86,
    animationDuration: 0.22,
    damageMultiplier: 0.82,
    coneAngle: 0.5,
    coneRangeMultiplier: 1,
    coneKnockback: 0.85,
    element: 'ice',
    statusBuildup: 1.18,
    color: 0x8bddff,
  },
  shockCoilArm: {
    special: 'chain',
    energyCost: 1,
    outputDrainPerShot: 0.16,
    outputRequiredToFire: 0.1,
    outputRecoveryPerSecond: 0.44,
    outputRecoveryDelay: 0.18,
    outputLabel: 'Coil Output',
    cooldownMultiplier: 0.9,
    animationDuration: 0.24,
    damageMultiplier: 0.9,
    chainTargets: 4,
    chainRange: 4.4,
    element: 'shock',
    chainChance: 0.7,
    chainDamageMultiplier: 0.42,
    color: 0xa6f7ff,
  },
  swordArm: {
    energyCost: 1,
    outputDrainPerShot: 0.58,
    outputRequiredToFire: 0.4,
    outputRecoveryPerSecond: 0.5,
    outputRecoveryDelay: 0.34,
    outputVentDuration: 0.62,
    outputLabel: 'Servo Output',
    cooldownMultiplier: 1,
    animationDuration: 0.86,
    activeStart: 12 / 24,
    slashEnd: 16 / 24,
    visualEnd: 19 / 24,
    damageMultiplier: 1.1,
    melee: true,
    arcScale: 1.02,
    baseVisualRange: 2.25,
    visualRangeGrowth: 0.24,
    maxVisualRange: 4.4,
    color: DEFAULT_BEAM_BLADE_COLOR,
  },
  drillArm: {
    special: 'drill',
    energyCost: 0,
    outputDrainPerShot: 0.36,
    outputRequiredToFire: 0.18,
    outputRecoveryPerSecond: 0.48,
    outputRecoveryDelay: 0.42,
    outputVentDuration: 0.68,
    outputLabel: 'Torque Output',
    cooldownMultiplier: 0.25,
    animationDuration: 0.2,
    damageMultiplier: 0.12,
    melee: true,
    drillWidth: 0.5,
    drillContactRange: 1.05,
    drillTickInterval: DRILL_TICK_INTERVAL,
    drillOutputDrainPerSecond: 1.15,
    drillEnemyDamageCap: 3,
    drillUtilityDamageMultiplier: 2.3,
    drillLaunchOutputCost: 0.72,
    drillLaunchCooldown: 0.5,
    drillLaunchDamageMultiplier: 0.68,
    drillLaunchRange: 5.3,
    drillLaunchSpeed: 8.2,
    armorBreakBonus: 0.28,
    armorPierce: 10,
    stagger: 0.05,
    color: 0xffd36f,
  },
};

const DEFAULT_PROFILE = ARM_PROFILES.busterArm;

function angleBetweenFlat(a, b) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  return Math.acos(dot);
}

function getElementColor(element, fallback) {
  if (element === 'fire') return 0xff8a42;
  if (element === 'ice') return 0x8bddff;
  if (element === 'shock') return 0xa6f7ff;
  if (element === 'corrosion') return 0xa6e86f;
  return fallback;
}

function colorToCss(color) {
  return `#${new THREE.Color(color).getHexString()}`;
}

function getPlayerElement(stats, profile) {
  if (profile.element) return profile.element;
  if (stats.fireDamage > 0) return 'fire';
  if (stats.iceDamage > 0) return 'ice';
  if ((stats.corrosionDamage ?? 0) > 0) return 'corrosion';
  return null;
}

function getWeaponElement(weapon, profile) {
  if (profile.element) return profile.element;

  const stats = weapon?.getStatTotals?.() ?? {};
  if ((stats.fireDamage ?? 0) > 0) return 'fire';
  if ((stats.iceDamage ?? 0) > 0) return 'ice';
  if ((stats.corrosionDamage ?? 0) > 0) return 'corrosion';
  if ((stats.chainLightningChance ?? 0) > 0) return 'shock';

  return null;
}

function getSwordFallbackColor(weapon, profile) {
  if (!weapon || weapon.rarity === 'scrap' || weapon.rarity === 'standard') {
    return DEFAULT_BEAM_BLADE_COLOR;
  }

  return weapon.glowColor ?? profile.color ?? DEFAULT_BEAM_BLADE_COLOR;
}

function usesDefaultBeamBladeVisualColor(weapon, profile) {
  return profile.type === 'swordArm' && (!weapon || weapon.rarity === 'scrap' || weapon.rarity === 'standard');
}

function isBusterProfile(profile) {
  return profile?.type === 'busterArm';
}

function usesProjectileAimBrace(profile) {
  return profile
    && !profile.melee
    && profile.special !== 'drill'
    && profile.special !== 'lift'
    && profile.special !== 'laser';
}

function defineResourceAlias(state, alias, backingField) {
  const descriptor = Object.getOwnPropertyDescriptor(state, alias);
  if (descriptor?.get) {
    return;
  }

  Object.defineProperty(state, alias, {
    configurable: true,
    enumerable: false,
    get() {
      return this[backingField];
    },
    set(value) {
      this[backingField] = value;
    },
  });
}

export class CombatSystem {
  constructor(game) {
    this.game = game;
    this.weaponStates = new Map();
    this.swapTimer = 0;
    this.primaryWasDown = false;
    this.secondaryWasDown = false;
    this.alternateWasDown = false;
    this.activeMines = [];
    this.pendingMeleeStrikes = [];
    this.pendingProjectileShots = [];
    this.lockOn = {
      target: null,
      progress: 0,
      marker: null,
      skippedTargetId: null,
      skipTimer: 0,
      manual: false,
      movementLocked: false,
    };
    this.grenadePreview = null;
    this.grenadeArcPreview = null;
    this.laser = {
      active: false,
      beam: null,
      impact: null,
      tickTimer: 0,
      currentState: null,
    };
    this.drill = {
      active: false,
      tickTimer: 0,
      particleTimer: 0,
      currentState: null,
    };
    this.lift = {
      active: false,
      target: null,
      kind: null,
      breakTimer: 0,
      currentState: null,
    };
  }

  update(dt) {
    const player = this.game.player;

    if (player.dead) {
      this._stopLaserBeam(false);
      this._stopDrillSpin();
      this._stopLiftArm(false);
      this._clearLockOn();
      this._clearPendingAttacks();
      return;
    }

    const state = this.getCurrentWeaponState();
    this._updateWeaponStates(dt);
    this._updateMines(dt);
    this.swapTimer = Math.max(0, this.swapTimer - dt);

    if (this.game.isPlayerInSafeArea?.()) {
      this._suspendForSafeArea(state);
      return;
    }

    const pointer = this.game.pointer;
    if (player.animation?.isControlLocked?.()) {
      this._suspendForControlLock(state, pointer);
      return;
    }

    this._updatePendingMeleeStrikes(dt);
    this._updatePendingProjectileShots(dt);

    if (!pointer) {
      this._stopDrillSpin();
      this._stopLiftArm(false);
      this._clearLockOn();
      return;
    }

    const profile = this._getStatefulProfile(this._getCurrentProfile(), state);
    const primaryPressed = pointer.primaryPressed || (pointer.primary && !this.primaryWasDown);
    const secondaryPressed = pointer.secondaryPressed || (pointer.secondary && !this.secondaryWasDown);
    const alternatePressed = pointer.alternatePressed || (pointer.alternate && !this.alternateWasDown);
    pointer.primaryPressed = false;
    pointer.secondaryPressed = false;
    pointer.alternatePressed = false;

    this._updateLockOn(dt, pointer.aimWorld, profile, secondaryPressed);
    const aimWorld = this._getEffectiveAimWorld(pointer.aimWorld);
    this._updateGrenadePreview(aimWorld, profile);

    if (pointer.secondary || this.getMovementLockTarget()) {
      this._updateManualAimPose(aimWorld, profile, state);
    }

    if (alternatePressed) {
      if (!this.trySecondaryAction(aimWorld)) {
        this.requestManualReload();
      }
    }

    if (profile.special === 'laser') {
      if (pointer.primary) {
        this._updateLaserBeam(dt, aimWorld, profile, state);
      } else {
        this._stopLaserBeam(true);
      }
    } else {
      this._stopLaserBeam(true);
    }

    if (profile.special === 'drill') {
      if (pointer.primary) {
        this._updateDrillSpin(dt, aimWorld, profile, state);
      } else {
        this._stopDrillSpin();
      }
    } else {
      this._stopDrillSpin();
    }

    if (profile.special === 'lift') {
      if (pointer.primary) {
        this._updateLiftArm(dt, aimWorld, profile, state);
      } else {
        this._stopLiftArm(false);
      }
    } else {
      this._stopLiftArm(false);
    }

    if (profile.special === 'cone') {
      if (pointer.primary) {
        this._updateConeSpray(dt, aimWorld, profile, state);
      }
    } else if (profile.special !== 'laser' && profile.special !== 'drill' && profile.special !== 'lift' && (pointer.primary || primaryPressed)) {
      this.tryPrimaryAttack(aimWorld);
    }

    this.primaryWasDown = pointer.primary;
    this.secondaryWasDown = pointer.secondary;
    this.alternateWasDown = pointer.alternate;
  }

  _suspendForSafeArea(state = null) {
    const pointer = this.game.pointer;
    if (pointer) {
      pointer.primary = false;
      pointer.primaryPressed = false;
      pointer.secondary = false;
      pointer.secondaryPressed = false;
      pointer.alternate = false;
      pointer.alternatePressed = false;
    }

    this._stopLaserBeam(true);
    this._stopDrillSpin();
    this._stopLiftArm(false);
    this._clearLockOn();
    this._hideGrenadePreview();
    this._clearPendingAttacks();

    if (state) {
      state.sprayActive = false;
      state.sprayWasActiveLastFrame = false;
    }

    this.primaryWasDown = false;
    this.secondaryWasDown = false;
    this.alternateWasDown = false;
  }

  _suspendForControlLock(state = null, pointer = null) {
    if (pointer) {
      pointer.primaryPressed = false;
      pointer.secondaryPressed = false;
      pointer.alternatePressed = false;
    }

    this._stopLaserBeam(true);
    this._stopDrillSpin();
    this._stopLiftArm(false);
    this._clearLockOn();
    this._hideGrenadePreview();
    this._clearPendingAttacks();

    if (state) {
      state.sprayActive = false;
      state.sprayWasActiveLastFrame = false;
    }

    this.primaryWasDown = Boolean(pointer?.primary);
    this.secondaryWasDown = Boolean(pointer?.secondary);
    this.alternateWasDown = Boolean(pointer?.alternate);
  }

  switchArmSlot(slotIndex) {
    this._stopLaserBeam(true);
    this._stopDrillSpin();
    this._stopLiftArm(false);
    this._clearLockOn();
    this._hideGrenadePreview();

    const changed = this.game.player.switchArmWeapon(slotIndex);

    if (!changed) {
      return false;
    }

    this._clearPendingAttacks();
    const swapSpeed = this.game.player.stats.swapSpeed ?? 0;
    this.swapTimer = Math.max(0.12, 0.34 * (1 - THREE.MathUtils.clamp(swapSpeed, 0, 0.65)));
    this.getCurrentWeaponState();
    return true;
  }

  getCurrentWeaponState() {
    const player = this.game.player;
    const weapon = player.getActiveArmWeapon?.() ?? player.equipment.get('weapon');
    return this._getWeaponStateForItem(weapon);
  }

  getMovementLockTarget() {
    const target = this.lockOn.target;

    if (!this.lockOn.movementLocked || !this._isValidLockTarget(target)) {
      return null;
    }

    return target;
  }

  _getEffectiveAimWorld(fallbackAimWorld = null) {
    const target = this.getMovementLockTarget();

    if (!target?.root) {
      return fallbackAimWorld;
    }

    return target.root.position;
  }

  _isValidLockTarget(target) {
    return Boolean(target?.root && !target.dead && target.root.parent);
  }

  _getWeaponStateForItem(weapon) {
    const key = weapon?.id ?? 'default-buster';
    const maxEnergy = this._getEstimatedMaxEnergyForWeapon(weapon);
    let state = this.weaponStates.get(key);

    if (!state) {
      state = {
        key,
        weaponType: weapon?.type ?? 'busterArm',
        energyReserve: maxEnergy,
        maxEnergyReserve: maxEnergy,
        cooldown: 0,
        reloadTimer: 0,
        reloadDuration: this._getReloadDuration(),
        weaponOutput: 1,
        maxWeaponOutput: 1,
        outputRecoveryDelay: 0,
        grenadeMode: 'impact',
        laserHeat: 0,
      };
      this.weaponStates.set(key, state);
    }

    this._ensureResourceAliases(state);
    state.weaponType = weapon?.type ?? state.weaponType ?? 'busterArm';
    state.maxEnergyReserve = maxEnergy;
    state.reloadDuration = this._getReloadDuration();
    const profile = ARM_PROFILES[state.weaponType] ?? DEFAULT_PROFILE;
    if (isBusterProfile(profile)) {
      state.energyReserve = state.maxEnergyReserve;
      state.reloadTimer = 0;
    } else {
      state.energyReserve = Math.min(state.energyReserve, state.maxEnergyReserve);
    }
    this._ensureOutputState(state, profile);
    return state;
  }

  getEnergyLabel() {
    const player = this.game.player;
    const state = this.getCurrentWeaponState();
    const profile = this._getStatefulProfile(this._getCurrentProfile(), state);

    if (player.isShieldGuarding?.()) {
      return `Guard ${player.guardTimer.toFixed(1)}s`;
    }

    if (this.swapTimer > 0) {
      return `Swap ${this.swapTimer.toFixed(1)}s`;
    }

    if (state.reloadTimer > 0) {
      return `Reload ${state.reloadTimer.toFixed(1)}s`;
    }

    if (profile.special === 'laser' && this.laser.active) {
      return `Charge ${Math.round((state.laserHeat ?? 0) * 100)}% - ${state.energy.toFixed(1)} / ${Math.round(state.maxEnergy)}`;
    }

    if (profile.special === 'mine') {
      return `Mines ${this.activeMines.length}/${this._getMineLimit(profile)} - ${Math.floor(state.energy)} / ${Math.round(state.maxEnergy)}`;
    }

    if (profile.lockOn) {
      const percent = Math.round(this.lockOn.progress * 100);
      const lockLabel = this.lockOn.target && this.lockOn.progress >= 1
        ? 'Salvo Ready'
        : this.lockOn.target
          ? `Lock ${percent}%`
          : '';
      return `${lockLabel ? `${lockLabel} - ` : ''}${Math.floor(state.energy)} / ${Math.round(state.maxEnergy)}`;
    }

    if (profile.special === 'grenade') {
      const modeLabel = this._getGrenadeMode(state) === 'cluster' ? 'Cluster' : 'Impact';
      return `${modeLabel} - ${Math.floor(state.energy)} / ${Math.round(state.maxEnergy)}`;
    }

    return `${Math.floor(state.energy)} / ${Math.round(state.maxEnergy)}`;
  }

  getWeaponHudData() {
    const player = this.game.player;
    const weapon = player.getActiveArmWeapon?.() ?? player.equipment.get('weapon');
    const state = this.getCurrentWeaponState();
    const profile = this._getStatefulProfile(this._getCurrentProfile(), state);
    const stats = this._getCombatStatsForProfile(profile, weapon);
    const cooldown = this._getAttackCooldown(profile, stats);
    let attack = Math.max(1, Math.round((stats.attackDamage + stats.fireDamage + stats.iceDamage + (stats.corrosionDamage ?? 0)) * (profile.damageMultiplier ?? 1)));
    if (profile.special === 'laser') {
      attack = Math.max(1, Math.round(attack * (1 + (state.laserHeat ?? 0) * (profile.maxHeatDamageBonus ?? 0.72))));
    }
    const range = this._getProfileRange(profile, stats);
    const status = this._getWeaponStatusLabel(profile, state);
    const visual = this._getActiveWeaponVisual(profile);
    const readiness = this._getWeaponReadiness(profile, state);
    const mode = this._getWeaponModeLabel(profile, state);

    return {
      name: weapon?.name ?? 'No Arm Weapon',
      typeLabel: weapon?.typeLabel ?? 'Buster Arm',
      color: colorToCss(visual.color),
      energyReserve: state.energyReserve,
      maxEnergyReserve: state.maxEnergyReserve,
      energy: state.energyReserve,
      maxEnergy: state.maxEnergyReserve,
      energyPercent: state.maxEnergyReserve > 0
        ? THREE.MathUtils.clamp(state.energyReserve / state.maxEnergyReserve, 0, 1)
        : 0,
      weaponOutput: state.weaponOutput,
      maxWeaponOutput: state.maxWeaponOutput,
      output: state.weaponOutput,
      maxOutput: state.maxWeaponOutput,
      outputPercent: this._getOutputPercent(state),
      outputLabel: profile.outputLabel ?? 'Output',
      reloadState: state.reloadTimer > 0,
      cooldownState: state.cooldown > 0,
      cannotFireReason: readiness.reason,
      energyWarning: readiness.noEnergy,
      outputWarning: readiness.lowOutput,
      energyRequired: readiness.energyRequired,
      outputRequired: readiness.outputRequired,
      overheatState: state.weaponOutput <= 0.001 || (profile.special === 'laser' && (state.laserHeat ?? 0) >= 0.92),
      activeWeaponType: state.weaponType,
      status,
      stats: {
        attack,
        energy: Math.round(state.maxEnergy),
        range: Number(range.toFixed(1)),
        rapid: this._getRapidDisplayValue(profile, stats, cooldown),
      },
      mode,
      modeIndicator: this._getWeaponModeIndicator(profile, state, visual, mode),
      tabs: this.getWeaponTabData(),
    };
  }

  getWeaponTabData() {
    const player = this.game.player;

    return player.armHotbar.map((weapon, index) => {
      if (!weapon) {
        return {
          slot: index + 1,
          name: 'Empty',
          shortName: 'Empty',
          abbreviation: String(index + 1),
          active: index === player.activeArmIndex,
          energyPercent: 0,
          outputPercent: 0,
          cooldownPercent: 0,
          readyState: 'EMPTY',
          readyLabel: 'Empty',
        };
      }

      const profile = this._getProfileForWeapon(weapon);
      const state = this._getWeaponStateForItem(weapon);
      const readiness = this._getWeaponReadiness(profile, state);
      const cooldownPercent = Math.max(
        state.reloadDuration > 0 ? state.reloadTimer / state.reloadDuration : 0,
        THREE.MathUtils.clamp(state.cooldown / Math.max(0.12, profile.outputVentDuration ?? 0.42), 0, 1),
      );

      return {
        slot: index + 1,
        name: weapon.name ?? weapon.typeLabel ?? 'Arm Weapon',
        shortName: weapon.typeLabel ?? weapon.name ?? 'Arm',
        abbreviation: this._getWeaponAbbreviation(weapon),
        active: index === player.activeArmIndex,
        energyPercent: state.maxEnergyReserve > 0
          ? THREE.MathUtils.clamp(state.energyReserve / state.maxEnergyReserve, 0, 1)
          : 0,
        outputPercent: this._getOutputPercent(state),
        cooldownPercent: THREE.MathUtils.clamp(cooldownPercent, 0, 1),
        readyState: readiness.reason ?? 'READY',
        readyLabel: this._getReadyStateLabel(readiness.reason),
        color: `#${new THREE.Color(profile.color ?? weapon.glowColor ?? 0x77e8ff).getHexString()}`,
        energy: state.energyReserve,
        maxEnergy: state.maxEnergyReserve,
        output: state.weaponOutput,
        maxOutput: state.maxWeaponOutput,
      };
    });
  }

  requestManualReload() {
    const state = this.getCurrentWeaponState();
    const profile = this._getStatefulProfile(this._getCurrentProfile(), state);

    if (isBusterProfile(profile)) {
      return false;
    }

    if (state.reloadTimer > 0 || state.energy >= state.maxEnergy) {
      return false;
    }

    state.reloadTimer = state.reloadDuration;
    return true;
  }

  _updateManualAimPose(aimWorld, profile, state) {
    const player = this.game.player;

    if (!aimWorld
      || player.dead
      || player.animation?.isControlLocked?.()
      || this.swapTimer > 0
      || profile.melee
      || profile.special === 'drill'
      || profile.special === 'lift') {
      return;
    }

    player.holdProjectileFiringPose(aimWorld, 0.18, {
      weaponKey: state?.key,
      continuous: true,
    });
  }

  trySecondaryAction(aimWorld) {
    const player = this.game.player;
    const state = this.getCurrentWeaponState();
    const profile = this._getCurrentProfile();

    if (player.animation?.isControlLocked?.()) {
      return false;
    }

    if (profile.special === 'drill') {
      return this._tryLaunchDrillHead(profile, state, aimWorld);
    }

    if (profile.special === 'mine' && this.activeMines.length > 0) {
      this._detonateAllMines();
      return true;
    }

    if (profile.special === 'grenade') {
      state.grenadeMode = this._getGrenadeMode(state) === 'cluster' ? 'impact' : 'cluster';
      this._showGrenadeModePulse(state.grenadeMode, aimWorld, profile);
      return true;
    }

    if (profile.lockOn && this.lockOn.target) {
      if (this.lockOn.progress >= 1) {
        return this._tryMissileSalvo(profile, state, aimWorld);
      }

      this.lockOn.skippedTargetId = this.lockOn.target.id;
      this.lockOn.skipTimer = 0.42;
      this._clearLockOn(false);
      return true;
    }

    const offhand = player.equipment.get('offhand');

    if (offhand?.type === 'shieldArm' && player.startShieldGuard(aimWorld)) {
      this.game.addHitEffect(player.root.position, 0x83f1ff, 0.7);
      this.game.addParticleBurst(player.root.position.clone().add(new THREE.Vector3(0, 1.05, 0)), 0x83f1ff, 8, 0.14);
      return true;
    }

    return false;
  }

  _tryLaunchDrillHead(profile, state, aimWorld) {
    if (this.swapTimer > 0 || state.cooldown > 0 || state.reloadTimer > 0) {
      return true;
    }

    const rawOutputCost = profile.drillLaunchOutputCost ?? 0.72;
    const outputCost = this._getOutputCost(profile, rawOutputCost);
    if (state.weaponOutput < outputCost) {
      state.cooldown = Math.max(state.cooldown, state.weaponOutput <= 0.001
        ? profile.outputVentDuration ?? 0.5
        : profile.outputStarvedCooldown ?? 0.12);
      return true;
    }

    const player = this.game.player;
    tempDirection.copy(aimWorld ?? player.root.position).sub(player.root.position);
    tempDirection.y = 0;

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.copy(player.lastMoveDirection);
    }

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.set(0, 0, 1);
    }

    tempDirection.normalize();

    const color = profile.color ?? 0xffd36f;
    const origin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
    origin.y = Math.max(origin.y, 0.95);
    const launchRange = this._getDrillLaunchRange(profile);
    const targetPoint = player.root.position.clone().addScaledVector(tempDirection, launchRange);
    const damageRoll = this._rollPlayerDamage(profile);
    const element = getPlayerElement(player.stats, profile);

    player.playProjectileShotAnimation(profile.animationDuration ?? 0.2, targetPoint, (profile.drillLaunchCooldown ?? 0.5) + PROJECTILE_AIM_LOCK_BUFFER, {
      weaponKey: state.key,
    });

    this.game.projectiles.spawn({
      owner: 'player',
      position: origin,
      direction: tempDirection.clone(),
      speed: profile.drillLaunchSpeed ?? 8.2,
      range: launchRange,
      radius: 0.24,
      damage: damageRoll.damage * (profile.drillLaunchDamageMultiplier ?? 0.68),
      color,
      source: player,
      critical: damageRoll.critical,
      element,
      pierce: 0,
      armorBreakChance: (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0),
      armorPierce: profile.armorPierce ?? 10,
      stagger: 0.12,
      statusBuildup: profile.statusBuildup ?? 1,
      visualType: 'drillHead',
    });

    this._drainWeaponOutput(state, profile, rawOutputCost);
    state.cooldown = Math.max(state.cooldown, profile.drillLaunchCooldown ?? 0.5);
    this.game.addParticleBurst(origin, color, 10, 0.13);
    this._stopDrillSpin();
    return true;
  }

  _updateLiftArm(dt, aimWorld, profile, state) {
    if (this.swapTimer > 0 || state.cooldown > 0 || state.reloadTimer > 0) {
      return;
    }

    const player = this.game.player;
    tempDirection.copy(aimWorld ?? player.root.position).sub(player.root.position);
    tempDirection.y = 0;

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.copy(player.lastMoveDirection);
    }

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.set(0, 0, 1);
    }

    tempDirection.normalize();
    player.faceDirection(tempDirection);
    player.setMovementLock?.(0.08, this.lift.kind === 'enemy' ? 0.45 : 0.62);

    if (!this.lift.active) {
      const target = this._findLiftArmTarget(tempDirection, profile);

      if (!target) {
        return;
      }

      this.lift.active = true;
      this.lift.target = target;
      this.lift.kind = target.kind;
      this.lift.breakTimer = target.kind === 'enemy' ? LIFT_BREAK_DURATION : Infinity;
      this.lift.currentState = state;
      this.game.addParticleBurst(target.root.position.clone().add(new THREE.Vector3(0, 0.75, 0)), profile.color ?? 0x7ee7ff, 8, 0.08);
    }

    const lifted = this.lift.target;
    if (!lifted || !lifted.root || lifted.root.parent === null || lifted.junk?.dead || lifted.enemy?.dead) {
      this._stopLiftArm(false);
      return;
    }

    const holdPosition = player.root.position.clone().addScaledVector(tempDirection, profile.liftObjectOffset ?? 0.22);
    holdPosition.y = profile.liftHoldHeight ?? 2.45;
    lifted.root.position.lerp(holdPosition, Math.min(1, dt * 13));
    lifted.root.rotation.y = player.root.rotation.y;

    if (lifted.enemy) {
      lifted.enemy.hitStopTimer = Math.max(lifted.enemy.hitStopTimer ?? 0, 0.1);
      lifted.enemy.hitReactTimer = Math.max(lifted.enemy.hitReactTimer ?? 0, 0.12);
      lifted.enemy.attackCooldown = Math.max(lifted.enemy.attackCooldown ?? 0, 0.25);
      lifted.enemy.knockback?.set?.(0, 0, 0);

      const drain = profile.liftEnemyOutputDrainPerSecond ?? LIFT_ENEMY_OUTPUT_DRAIN_PER_SECOND;
      state.weaponOutput = Math.max(0, state.weaponOutput - drain * dt);
      state.outputRecoveryDelay = Math.max(state.outputRecoveryDelay ?? 0, this._getOutputRecoveryDelay(profile));
      this.lift.breakTimer -= dt;

      if (state.weaponOutput <= 0.001 || this.lift.breakTimer <= 0) {
        const damage = Math.max(3, (lifted.enemy.stats?.damage ?? 8) * 0.55);
        player.takeDamage(damage, lifted.enemy);
        this.game.addParticleBurst(player.root.position.clone().add(new THREE.Vector3(0, 1.15, 0)), 0xffd36f, 12, 0.12);
        state.cooldown = Math.max(state.cooldown, profile.outputVentDuration ?? 0.42);
        this._stopLiftArm(true);
      }
    }
  }

  _findLiftArmTarget(direction, profile) {
    const player = this.game.player;
    const range = profile.liftRange ?? 1.55;
    const coneAngle = profile.liftConeAngle ?? 0.82;
    let best = null;
    let bestScore = Infinity;

    const evaluate = (root, radius = 0.35) => {
      tempToEnemy.copy(root.position).sub(player.root.position);
      tempToEnemy.y = 0;
      const distance = tempToEnemy.length();

      if (distance <= 0.001 || distance > range + radius) {
        return Infinity;
      }

      tempToEnemy.normalize();
      const angle = angleBetweenFlat(direction, tempToEnemy);
      if (angle > coneAngle) {
        return Infinity;
      }

      return distance + angle * 0.75;
    };

    for (const junk of this.game.destructibles ?? []) {
      if (junk.dead) {
        continue;
      }

      const score = evaluate(junk.root, junk.radius ?? 0.45);
      if (score < bestScore) {
        bestScore = score;
        best = { kind: 'junk', root: junk.root, junk };
      }
    }

    for (const enemy of this.game.enemies ?? []) {
      if (enemy.dead || (enemy.typeKey !== 'horokko' && enemy.type?.modelAsset !== 'horokko')) {
        continue;
      }

      const score = evaluate(enemy.root, enemy.radius ?? 0.45);
      if (score < bestScore) {
        bestScore = score;
        best = { kind: 'enemy', root: enemy.root, enemy };
      }
    }

    return best;
  }

  _stopLiftArm(escaped = false) {
    if (!this.lift.active) {
      return;
    }

    const lifted = this.lift.target;
    if (lifted?.root && lifted.root.parent !== null) {
      const player = this.game.player;
      tempDirection.copy(player.attackFacingDirection ?? player.lastMoveDirection);
      tempDirection.y = 0;

      if (tempDirection.lengthSq() <= 0.001) {
        tempDirection.copy(player.lastMoveDirection);
      }

      if (tempDirection.lengthSq() <= 0.001) {
        tempDirection.set(0, 0, 1);
      }

      tempDirection.normalize();
      const dropDistance = escaped ? 0.75 : 1.05;
      lifted.root.position.copy(player.root.position).addScaledVector(tempDirection, dropDistance);
      lifted.root.position.y = 0;

      if (lifted.enemy && !lifted.enemy.dead) {
        lifted.enemy.hitStopTimer = Math.max(lifted.enemy.hitStopTimer ?? 0, escaped ? 0.08 : 0.18);
        lifted.enemy.applyStatus?.('stagger', { duration: escaped ? 0.08 : 0.22 });
      }
    }

    this.lift.active = false;
    this.lift.target = null;
    this.lift.kind = null;
    this.lift.breakTimer = 0;
    this.lift.currentState = null;
  }

  _tryMissileSalvo(profile, state, aimWorld) {
    const target = this.lockOn.target;
    if (!target || target.dead) {
      this._clearLockOn();
      return true;
    }

    if (state.reloadTimer > 0 || state.cooldown > 0) {
      return true;
    }

    const salvoCost = profile.salvoEnergyCost ?? (profile.energyCost ?? 1) * 2.2;
    if (state.energy < salvoCost) {
      state.reloadTimer = state.reloadDuration;
      return true;
    }

    const rawOutputCost = profile.salvoOutputCost ?? (profile.outputDrainPerShot ?? 0.12) * 2.2;
    const outputCost = this._getOutputCost(profile, rawOutputCost);
    if (state.weaponOutput < outputCost) {
      state.cooldown = Math.max(state.cooldown, state.weaponOutput <= 0.001
        ? profile.outputVentDuration ?? 0.5
        : profile.outputStarvedCooldown ?? 0.1);
      return true;
    }

    const player = this.game.player;
    const rapid = Math.max(0.25, player.stats.attackSpeed);
    const cooldownReduction = THREE.MathUtils.clamp(player.stats.cooldownReduction ?? 0, 0, 0.75);
    const cooldown = Math.max(0.16, (1 / rapid) * (profile.salvoCooldownMultiplier ?? 1.7) * (1 - cooldownReduction));
    const targetPoint = target.root.position.clone();
    const origin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
    const count = Math.max(2, Math.round(profile.salvoCount ?? 3));
    const spread = profile.salvoSpread ?? 0.18;
    const projectileSpeed = (profile.projectileSpeed ?? 6.8) + (player.stats.projectileSpeed ?? 0);
    const element = getPlayerElement(player.stats, profile);
    const color = getElementColor(element, profile.color ?? 0xffd36f);
    const armorBreakChance = (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0);

    tempDirection.copy(target.root.position).sub(origin);
    tempDirection.y = 0;

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.copy(aimWorld ?? player.root.position).sub(player.root.position).setY(0);
    }

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.copy(player.lastMoveDirection);
    }

    tempDirection.normalize();
    player.playProjectileShotAnimation(profile.animationDuration ?? 0.3, targetPoint, cooldown + PROJECTILE_AIM_LOCK_BUFFER, {
      weaponKey: state.key,
    });

    for (let i = 0; i < count; i += 1) {
      const offset = (i - (count - 1) / 2) * spread;
      const shotDirection = tempDirection.clone().applyAxisAngle(WORLD_UP, offset).normalize();
      const damageRoll = this._rollPlayerDamage(profile);

      this.game.projectiles.spawn({
        owner: 'player',
        position: origin,
        direction: shotDirection,
        speed: projectileSpeed * (0.96 + i * 0.035),
        range: Math.max(player.stats.attackRange + 2.2, profile.homingRange ?? 9.5),
        radius: (profile.projectileRadius ?? 0.22) * 0.88,
        damage: damageRoll.damage * (profile.salvoDamageMultiplier ?? 0.72) * 1.08,
        color,
        source: player,
        critical: damageRoll.critical,
        element,
        pierce: 0,
        explosiveRadius: (profile.explosiveRadius ?? 1.35) * 0.82,
        explodeOnExpire: true,
        armorBreakChance,
        armorPierce: profile.armorPierce ?? 0,
        stagger: Math.max(0.12, (profile.stagger ?? 0.22) * 0.72),
        statusBuildup: profile.statusBuildup ?? 1,
        chainChance: profile.chainChance ?? 0,
        chainDamageMultiplier: profile.chainDamageMultiplier ?? 0.36,
        homingStrength: (profile.homingStrength ?? 3.2) * 1.18,
        homingRange: profile.homingRange ?? 9.5,
        target,
        visualType: profile.visualType ?? 'missile',
      });
    }

    state.energy = Math.max(0, state.energy - salvoCost);
    this._drainWeaponOutput(state, profile, rawOutputCost);
    state.cooldown = cooldown;
    if (state.energy <= 0.001) {
      state.reloadTimer = state.reloadDuration;
    }

    this._showMissileSalvoPulse(origin, target.root.position, color);
    return true;
  }

  refillAllEnergy(amount = Infinity) {
    this.getCurrentWeaponState();

    for (const state of this.weaponStates.values()) {
      this._ensureResourceAliases(state);
      state.maxEnergyReserve = Math.max(1, state.maxEnergyReserve);
      state.energyReserve = Number.isFinite(amount)
        ? Math.min(state.maxEnergyReserve, state.energyReserve + amount)
        : state.maxEnergyReserve;
      state.weaponOutput = state.maxWeaponOutput ?? 1;
      state.outputRecoveryDelay = 0;
    }
  }

  reduceReloadTimers(multiplier = 0.5) {
    const clampedMultiplier = THREE.MathUtils.clamp(multiplier, 0, 1);

    for (const state of this.weaponStates.values()) {
      state.reloadTimer *= clampedMultiplier;
      state.cooldown *= clampedMultiplier;
    }
  }

  tryPrimaryAttack(aimWorld) {
    const player = this.game.player;
    const state = this.getCurrentWeaponState();

    if (player.animation?.isControlLocked?.() || this.swapTimer > 0 || state.cooldown > 0 || state.reloadTimer > 0) {
      return false;
    }

    const profile = this._getStatefulProfile(this._getCurrentProfile(), state);
    if (!this._hasRequiredWeaponOutput(state, profile)) {
      state.cooldown = Math.max(state.cooldown, state.weaponOutput <= 0.001
        ? profile.outputVentDuration ?? 0.42
        : profile.outputStarvedCooldown ?? 0.08);
      return false;
    }

    if (state.energy < profile.energyCost) {
      state.reloadTimer = state.reloadDuration;
      return false;
    }

    tempDirection.copy(aimWorld).sub(player.root.position);
    tempDirection.y = 0;

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.copy(player.lastMoveDirection);
    }

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.set(0, 0, 1);
    }

    tempDirection.normalize();

    const stats = this._getCombatStatsForProfile(profile);
    const cooldown = this._getAttackCooldown(profile, stats);
    const attackDuration = this._getAttackAnimationDuration(profile, stats);
    const targetPoint = player.root.position.clone().addScaledVector(tempDirection, this._getProfileRange(profile, stats));
    const projectileAimOptions = { weaponKey: state.key };
    const projectileActionNeedsBrace = usesProjectileAimBrace(profile)
      && !player.isProjectileAimSustained?.(state.key);

    if (profile.special === 'mine') {
      player.playProjectileShotAnimation(attackDuration, targetPoint, cooldown + PROJECTILE_AIM_LOCK_BUFFER, projectileAimOptions);
      this._fireOrQueueProjectileAction('mine', tempDirection, profile, aimWorld, attackDuration, state, projectileActionNeedsBrace);
    } else if (profile.special === 'rail') {
      player.playProjectileShotAnimation(attackDuration, targetPoint, cooldown + PROJECTILE_AIM_LOCK_BUFFER, projectileAimOptions);
      this._fireOrQueueProjectileAction('rail', tempDirection, profile, aimWorld, attackDuration, state, projectileActionNeedsBrace);
    } else if (profile.special === 'cone') {
      player.playProjectileShotAnimation(attackDuration, targetPoint, cooldown + PROJECTILE_AIM_LOCK_BUFFER, projectileAimOptions);
      this._fireOrQueueProjectileAction('cone', tempDirection, profile, aimWorld, attackDuration, state, projectileActionNeedsBrace);
    } else if (profile.special === 'chain') {
      player.playProjectileShotAnimation(attackDuration, targetPoint, cooldown + PROJECTILE_AIM_LOCK_BUFFER, projectileAimOptions);
      this._fireOrQueueProjectileAction('chain', tempDirection, profile, aimWorld, attackDuration, state, projectileActionNeedsBrace);
    } else if (profile.special === 'drill') {
      player.playAttackAnimation(attackDuration, 'melee', targetPoint);
      this._drillAttackDirection(tempDirection, profile);
    } else if (profile.melee) {
      if (profile.type === 'swordArm') {
        player.playSwordSlashAnimation?.(attackDuration, targetPoint);
        player.setMovementLock?.(attackDuration * 0.96, 0);
        this._queueMeleeStrike(tempDirection, profile, attackDuration * (profile.activeStart ?? 0.48), {
          visual: this._getActiveWeaponVisual(profile),
        });
      } else {
        player.playAttackAnimation(attackDuration, 'melee', targetPoint);
        this._meleeAttackDirection(tempDirection, profile);
      }
    } else {
      player.playProjectileShotAnimation(attackDuration, targetPoint, cooldown + PROJECTILE_AIM_LOCK_BUFFER, projectileAimOptions);
      this._fireOrQueueProjectileAction('projectile', tempDirection, profile, aimWorld, attackDuration, state, projectileActionNeedsBrace);
    }

    state.energy = Math.max(0, state.energy - profile.energyCost);
    this._drainWeaponOutput(state, profile);
    state.cooldown = Math.max(state.cooldown, cooldown);

    if (state.energy <= 0.001) {
      state.reloadTimer = state.reloadDuration;
    }

    return true;
  }

  _updateWeaponStates(dt) {
    const activeWeapon = this.game.player.getActiveArmWeapon?.() ?? this.game.player.equipment.get('weapon');
    const activeKey = activeWeapon?.id ?? 'default-buster';
    const activeInputHeld = Boolean(this.game.pointer?.primary || this.game.pointer?.alternate);

    for (const state of this.weaponStates.values()) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      const profile = ARM_PROFILES[state.weaponType] ?? DEFAULT_PROFILE;
      this._ensureOutputState(state, profile);
      state.outputRecoveryDelay = Math.max(0, (state.outputRecoveryDelay ?? 0) - dt);
      const wasSpraying = state.sprayActive === true;
      const wasDrilling = this.drill.active && this.drill.currentState === state;
      const wasLiftingEnemy = this.lift.active && this.lift.currentState === state && this.lift.kind === 'enemy';
      const activeWeaponBeingUsed = activeInputHeld && state.key === activeKey && profile.special !== 'lift';
      state.sprayWasActiveLastFrame = wasSpraying;
      state.sprayActive = false;

      if (!this.laser.active || this.laser.currentState !== state) {
        state.laserHeat = Math.max(0, (state.laserHeat ?? 0) - dt * (profile.heatCoolRate ?? 0.58));
        if (!wasSpraying && !wasDrilling && !wasLiftingEnemy && !activeWeaponBeingUsed) {
          this._recoverWeaponOutput(state, profile, dt);
        }
      }

      if (state.reloadTimer > 0) {
        state.reloadTimer = Math.max(0, state.reloadTimer - dt);
        if (state.reloadTimer <= 0) {
          state.energy = state.maxEnergy;
        }
      }
    }
  }

  _queueMeleeStrike(direction, profile, delay, options = {}) {
    this.pendingMeleeStrikes.push({
      timer: Math.max(0, delay),
      direction: direction.clone(),
      profile: { ...profile },
      visual: options.visual ?? null,
    });
  }

  _fireOrQueueProjectileAction(action, direction, profile, aimWorld, delay, state, needsBrace) {
    if (needsBrace) {
      this._queueProjectileShot(direction, profile, aimWorld, delay, {
        action,
        weaponKey: state.key,
        requireSustainedAim: true,
      });
      return;
    }

    this._fireProjectileAction(action, direction, profile, aimWorld);
  }

  _queueProjectileShot(direction, profile, aimWorld, delay, options = {}) {
    this.pendingProjectileShots.push({
      action: options.action ?? 'projectile',
      timer: Math.max(0, delay),
      direction: direction.clone(),
      profile: { ...profile },
      aimWorld: aimWorld?.clone?.() ?? null,
      weaponKey: options.weaponKey ?? null,
      requireSustainedAim: Boolean(options.requireSustainedAim),
    });
  }

  _updatePendingMeleeStrikes(dt) {
    for (let i = this.pendingMeleeStrikes.length - 1; i >= 0; i -= 1) {
      const strike = this.pendingMeleeStrikes[i];
      strike.timer -= dt;

      if (strike.timer > 0) {
        continue;
      }

      if (!this.game.player.dead) {
        this._meleeAttackDirection(strike.direction, strike.profile, {
          visual: strike.visual,
          activeFrame: true,
        });
      }

      this.pendingMeleeStrikes.splice(i, 1);
    }
  }

  _updatePendingProjectileShots(dt) {
    for (let i = this.pendingProjectileShots.length - 1; i >= 0; i -= 1) {
      const shot = this.pendingProjectileShots[i];

      if (!this._isPendingProjectileShotStillViable(shot)) {
        this.pendingProjectileShots.splice(i, 1);
        continue;
      }

      shot.timer -= dt;

      if (shot.timer > 0) {
        continue;
      }

      if (shot.requireSustainedAim && !this.game.player.isProjectileAimSustained?.(shot.weaponKey)) {
        continue;
      }

      this._fireProjectileAction(shot.action, shot.direction, shot.profile, shot.aimWorld);
      this.pendingProjectileShots.splice(i, 1);
    }
  }

  _fireProjectileAction(action, direction, profile, aimWorld = null) {
    if (action === 'mine') {
      this._placeMine(aimWorld, profile);
      return;
    }

    if (action === 'rail') {
      this._railAttackDirection(direction, profile);
      return;
    }

    if (action === 'cone') {
      this._coneAttackDirection(direction, profile);
      return;
    }

    if (action === 'chain') {
      this._chainAttackDirection(direction, profile, aimWorld);
      return;
    }

    this._projectileAttackDirection(direction, profile, aimWorld);
  }

  _isPendingProjectileShotStillViable(shot) {
    const player = this.game.player;

    if (player.dead || player.animation?.isControlLocked?.()) {
      return false;
    }

    const state = this.getCurrentWeaponState();
    if (shot.weaponKey && state.key !== shot.weaponKey) {
      return false;
    }

    const profile = this._getStatefulProfile(this._getCurrentProfile(), state);
    return usesProjectileAimBrace(profile)
      && player.isProjectileAimHeld?.(shot.weaponKey ?? state.key);
  }

  _clearPendingAttacks() {
    this.pendingMeleeStrikes.length = 0;
    this.pendingProjectileShots.length = 0;
  }

  _getCurrentProfile() {
    const weapon = this.game.player.getActiveArmWeapon?.() ?? this.game.player.equipment.get('weapon');
    return this._getProfileForWeapon(weapon);
  }

  _getProfileForWeapon(weapon) {
    return { ...DEFAULT_PROFILE, ...(ARM_PROFILES[weapon?.type] ?? {}), type: weapon?.type ?? 'busterArm' };
  }

  _getActiveWeaponVisual(profile) {
    const player = this.game.player;
    const weapon = player.getActiveArmWeapon?.() ?? player.equipment.get('weapon');
    const element = getWeaponElement(weapon, profile);
    const fallbackColor = profile.type === 'swordArm'
      ? getSwordFallbackColor(weapon, profile)
      : profile.color ?? weapon?.glowColor ?? 0x77e8ff;

    return {
      element,
      color: usesDefaultBeamBladeVisualColor(weapon, profile)
        ? DEFAULT_BEAM_BLADE_COLOR
        : getElementColor(element, fallbackColor),
    };
  }

  _getGrenadeMode(state) {
    return state?.grenadeMode === 'cluster' ? 'cluster' : 'impact';
  }

  _getStatefulProfile(profile, state) {
    let statefulProfile = profile;

    if (profile.special === 'grenade') {
      const grenadeMode = this._getGrenadeMode(state);
      statefulProfile = grenadeMode !== 'cluster'
        ? { ...profile, grenadeMode }
        : {
          ...profile,
          grenadeMode,
          energyCost: profile.clusterEnergyCost ?? profile.energyCost,
          cooldownMultiplier: profile.clusterCooldownMultiplier ?? (profile.cooldownMultiplier ?? 1) * 1.18,
          damageMultiplier: (profile.damageMultiplier ?? 1) * 0.82,
          explosiveRadius: (profile.explosiveRadius ?? 1.55) * 0.82,
          clusterCount: profile.clusterCount ?? 5,
          clusterDamageMultiplier: profile.clusterDamageMultiplier ?? 0.42,
          clusterExplosionRadius: profile.clusterExplosionRadius ?? 0.68,
          clusterSpreadRadius: profile.clusterSpreadRadius ?? 1.45,
          clusterArcHeight: profile.clusterArcHeight ?? 0.42,
          color: profile.clusterColor ?? 0xffcf73,
        };
    }

    return this._applyOutputModifiers(statefulProfile, state);
  }

  _getBusterUpgradeStats() {
    return this.game.player.getBusterUpgradeStatBonuses?.() ?? {};
  }

  _getBusterStatTotals(weapon = null) {
    const buster = weapon?.type === 'busterArm'
      ? weapon
      : this.game.player.armHotbar?.[0] ?? this.game.player.getActiveArmWeapon?.() ?? null;
    const weaponStats = buster?.type === 'busterArm'
      ? buster.getStatTotals?.() ?? {}
      : {};
    const upgradeStats = this._getBusterUpgradeStats();
    const stats = { ...BUSTER_DEFAULT_STATS, ...weaponStats };

    for (const [stat, value] of Object.entries(upgradeStats)) {
      stats[stat] = (stats[stat] ?? 0) + value;
    }

    stats.attackDamage = Math.max(1, stats.attackDamage ?? BUSTER_DEFAULT_STATS.attackDamage);
    stats.maxEnergy = Math.max(1, stats.maxEnergy ?? BUSTER_DEFAULT_STATS.maxEnergy);
    stats.attackRange = Math.max(1, stats.attackRange ?? BUSTER_DEFAULT_STATS.attackRange);
    stats.attackSpeed = Math.max(0, stats.attackSpeed ?? BUSTER_DEFAULT_STATS.attackSpeed);
    stats.energyRecharge = Math.max(0, stats.energyRecharge ?? 0);
    stats.cooldownReduction = THREE.MathUtils.clamp(stats.cooldownReduction ?? 0, 0, 0.75);

    return stats;
  }

  _getCombatStatsForProfile(profile, weapon = null) {
    if (!isBusterProfile(profile)) {
      return this.game.player.stats;
    }

    return {
      ...this.game.player.stats,
      ...this._getBusterStatTotals(weapon ?? this.game.player.getActiveArmWeapon?.()),
    };
  }

  _getBusterBurstShotCapacity(profile = DEFAULT_PROFILE) {
    const energy = this._getBusterStatTotals().maxEnergy;
    const shots = BUSTER_BASE_BURST_SHOTS + ((energy - BUSTER_BASE_ENERGY) / BUSTER_ENERGY_PER_EXTRA_SHOT);
    return Math.max(BUSTER_MIN_BURST_SHOTS, shots);
  }

  _getBusterOutputCostPerShot(profile = DEFAULT_PROFILE) {
    return 1 / this._getBusterBurstShotCapacity(profile);
  }

  _getAttackCooldown(profile, stats = this.game.player.stats) {
    const cooldownReduction = THREE.MathUtils.clamp(stats.cooldownReduction ?? 0, 0, 0.75);

    if (isBusterProfile(profile)) {
      const rapidBonus = Math.max(0, stats.attackSpeed ?? BUSTER_DEFAULT_STATS.attackSpeed);
      const rapidMultiplier = 1 + rapidBonus;
      return Math.max(
        0.075,
        ((profile.baseCooldown ?? BUSTER_DEFAULT_SHOT_COOLDOWN) / rapidMultiplier) * (1 - cooldownReduction),
      );
    }

    const rapid = Math.max(0.25, stats.attackSpeed);
    return Math.max(0.08, (1 / rapid) * (profile.cooldownMultiplier ?? 1) * (1 - cooldownReduction));
  }

  _getAttackAnimationDuration(profile, stats = this.game.player.stats) {
    if (Number.isFinite(profile.animationDuration)) {
      return Math.max(0.1, profile.animationDuration);
    }

    if (isBusterProfile(profile)) {
      return Math.max(0.1, this._getAttackCooldown(profile, stats) * 0.82);
    }

    return Math.max(0.12, 0.38 / Math.max(0.25, stats.attackSpeed));
  }

  _getRapidDisplayValue(profile, stats, cooldown) {
    if (isBusterProfile(profile)) {
      return `${Math.round(Math.max(0, stats.attackSpeed ?? 0) * 100)}%`;
    }

    return Number((cooldown > 0 ? 1 / cooldown : 0).toFixed(1));
  }

  _ensureResourceAliases(state) {
    if (!state) {
      return state;
    }

    const energyReserve = Number.isFinite(state.energyReserve) ? state.energyReserve : state.energy;
    const maxEnergyReserve = Number.isFinite(state.maxEnergyReserve) ? state.maxEnergyReserve : state.maxEnergy;
    const weaponOutput = Number.isFinite(state.weaponOutput) ? state.weaponOutput : state.output;
    const maxWeaponOutput = Number.isFinite(state.maxWeaponOutput) ? state.maxWeaponOutput : state.maxOutput;

    state.energyReserve = Number.isFinite(energyReserve) ? energyReserve : 0;
    state.maxEnergyReserve = Math.max(1, Number.isFinite(maxEnergyReserve) ? maxEnergyReserve : 1);
    state.weaponOutput = Number.isFinite(weaponOutput) ? weaponOutput : 1;
    state.maxWeaponOutput = Math.max(0.1, Number.isFinite(maxWeaponOutput) ? maxWeaponOutput : 1);
    state.outputRecoveryDelay = Math.max(0, Number.isFinite(state.outputRecoveryDelay) ? state.outputRecoveryDelay : 0);

    defineResourceAlias(state, 'energy', 'energyReserve');
    defineResourceAlias(state, 'maxEnergy', 'maxEnergyReserve');
    defineResourceAlias(state, 'output', 'weaponOutput');
    defineResourceAlias(state, 'maxOutput', 'maxWeaponOutput');

    return state;
  }

  _getEstimatedMaxEnergyForWeapon(weapon) {
    if (weapon?.type === 'busterArm') {
      return this._getBusterStatTotals(weapon).maxEnergy;
    }

    if (!weapon) {
      return this._getCurrentMaxEnergy();
    }

    const player = this.game.player;
    const activeWeapon = player.getActiveArmWeapon?.() ?? player.equipment.get('weapon');
    const activeEnergyBonus = activeWeapon?.getStatTotals?.().maxEnergy ?? 0;
    const weaponEnergyBonus = weapon?.getStatTotals?.().maxEnergy ?? 0;
    return Math.max(1, (player.stats.maxEnergy ?? 1) - activeEnergyBonus + weaponEnergyBonus);
  }

  _ensureOutputState(state, profile = DEFAULT_PROFILE) {
    this._ensureResourceAliases(state);
    const maxOutput = Math.max(0.1, profile.maxOutput ?? 1);
    state.maxWeaponOutput = maxOutput;

    if (!Number.isFinite(state.weaponOutput)) {
      state.weaponOutput = maxOutput;
    }

    state.weaponOutput = THREE.MathUtils.clamp(state.weaponOutput, 0, state.maxWeaponOutput);
  }

  _getOutputPercent(state) {
    this._ensureResourceAliases(state);
    return state?.maxWeaponOutput > 0
      ? THREE.MathUtils.clamp(state.weaponOutput / state.maxWeaponOutput, 0, 1)
      : 1;
  }

  _getOutputRecoveryRate(profile) {
    if (isBusterProfile(profile)) {
      return profile.outputRecoveryPerSecond ?? 0.82;
    }

    const rapidModifier = this._getRapidOutputModifier();

    if (Number.isFinite(profile.outputRecoveryPerSecond)) {
      return profile.outputRecoveryPerSecond * rapidModifier;
    }

    if (profile.special === 'laser') return 0.24 * rapidModifier;
    if (profile.special === 'cone') return 0.32 * rapidModifier;
    if (profile.special === 'grenade' || profile.special === 'mine') return 0.34 * rapidModifier;
    if (profile.lockOn) return 0.38 * rapidModifier;

    return 0.5 * rapidModifier;
  }

  _getRapidOutputModifier() {
    const stats = this.game.player.stats;
    const baseRapid = Math.max(0.25, this.game.player.baseStats?.attackSpeed ?? 1.25);
    const currentRapid = Math.max(0.25, stats.attackSpeed ?? baseRapid);
    return THREE.MathUtils.clamp(Math.sqrt(currentRapid / baseRapid), 0.65, 1.75);
  }

  _getOutputCost(profile, amount = null) {
    if (isBusterProfile(profile)) {
      return amount ?? this._getBusterOutputCostPerShot(profile);
    }

    const baseCost = Math.max(0, amount ?? profile.outputDrainPerShot ?? 0.08);
    return baseCost / this._getRapidOutputModifier();
  }

  _getOutputDrainPerSecond(profile) {
    const baseDrain = Math.max(0, profile.outputDrainPerSecond ?? 0);
    return baseDrain / this._getRapidOutputModifier();
  }

  _getOutputRequiredToFire(profile) {
    if (isBusterProfile(profile)) {
      return this._getBusterOutputCostPerShot(profile);
    }

    const fallback = Math.min(0.98, Math.max(0.02, (profile.outputDrainPerShot ?? 0.08) * 0.75));
    const baseRequired = Math.max(0, profile.outputRequiredToFire ?? fallback);
    return THREE.MathUtils.clamp(baseRequired / Math.sqrt(this._getRapidOutputModifier()), 0, 1);
  }

  _getOutputRecoveryDelay(profile) {
    if (isBusterProfile(profile)) {
      return Math.max(0, profile.outputRecoveryDelay ?? 0.16);
    }

    const baseDelay = Math.max(0, profile.outputRecoveryDelay ?? 0.18);
    return baseDelay / Math.sqrt(this._getRapidOutputModifier());
  }

  _getWeaponReadiness(profile, state) {
    this._ensureOutputState(state, profile);

    const energyRequired = Math.max(0, profile.energyCost ?? 0);
    const outputRequired = this._getOutputRequiredToFire(profile);
    const noEnergy = state.energyReserve + 0.001 < energyRequired;
    const lowOutput = state.weaponOutput + 0.001 < outputRequired;
    let reason = null;

    if (state.reloadTimer > 0) {
      reason = 'RELOADING';
    } else if (state.cooldown > 0) {
      reason = 'COOLDOWN';
    } else if (noEnergy && lowOutput) {
      reason = 'BOTH_ENERGY_AND_OUTPUT';
    } else if (noEnergy) {
      reason = 'NO_ENERGY';
    } else if (lowOutput) {
      reason = 'LOW_OUTPUT';
    }

    return {
      reason,
      noEnergy,
      lowOutput,
      energyRequired,
      outputRequired,
    };
  }

  _getReadyStateLabel(reason) {
    return {
      RELOADING: 'Reloading',
      COOLDOWN: 'Cooling',
      BOTH_ENERGY_AND_OUTPUT: 'No Energy / Output',
      NO_ENERGY: 'No Energy',
      LOW_OUTPUT: 'Low Output',
      EMPTY: 'Empty',
    }[reason] ?? 'Ready';
  }

  _getWeaponAbbreviation(weapon) {
    return {
      busterArm: 'B',
      liftArm: 'L',
      swordArm: 'LB',
      drillArm: 'D',
      machineGunArm: 'MG',
      cannonArm: 'C',
      mineArm: 'MN',
      missileArm: 'MS',
      grenadeArm: 'G',
      railBusterArm: 'RB',
      scatterBusterArm: 'SB',
      homingSeekerArm: 'HS',
      laserArm: 'SL',
      flameArm: 'F',
      iceSprayerArm: 'IS',
      shockCoilArm: 'SC',
    }[weapon?.type] ?? (weapon?.typeLabel?.slice(0, 2).toUpperCase() ?? '?');
  }

  _hasRequiredWeaponOutput(state, profile) {
    this._ensureOutputState(state, profile);
    return state.weaponOutput + 0.001 >= this._getOutputRequiredToFire(profile);
  }

  _recoverWeaponOutput(state, profile, dt) {
    this._ensureOutputState(state, profile);
    if ((state.outputRecoveryDelay ?? 0) > 0) {
      return;
    }

    const recovery = this._getOutputRecoveryRate(profile);
    state.weaponOutput = Math.min(state.maxWeaponOutput, state.weaponOutput + recovery * dt);
  }

  _drainWeaponOutput(state, profile, amount = null) {
    this._ensureOutputState(state, profile);
    const drain = this._getOutputCost(profile, amount);
    state.weaponOutput = Math.max(0, state.weaponOutput - drain);
    state.outputRecoveryDelay = Math.max(state.outputRecoveryDelay ?? 0, this._getOutputRecoveryDelay(profile));

    if (state.weaponOutput <= 0.001) {
      state.cooldown = Math.max(state.cooldown, profile.outputVentDuration ?? 0.36);
    }
  }

  _applyOutputModifiers(profile, state) {
    if (!state) {
      return profile;
    }

    const outputPercent = this._getOutputPercent(state);
    const lowOutput = 1 - outputPercent;

    if (lowOutput <= 0.001) {
      return profile;
    }

    if (profile.special === 'cone') {
      return {
        ...profile,
        coneRangeMultiplier: (profile.coneRangeMultiplier ?? 1) * (0.34 + outputPercent * 0.66),
        coneAngle: (profile.coneAngle ?? 0.52) * (0.58 + outputPercent * 0.42),
        damageMultiplier: (profile.damageMultiplier ?? 1) * (0.42 + outputPercent * 0.58),
        statusBuildup: (profile.statusBuildup ?? 1) * (0.24 + outputPercent * 0.76),
        coneKnockback: (profile.coneKnockback ?? 1) * (0.4 + outputPercent * 0.6),
      };
    }

    if (profile.type === 'machineGunArm') {
      return {
        ...profile,
        spread: (profile.spread ?? 0.08) + lowOutput * 0.16,
        cooldownMultiplier: (profile.cooldownMultiplier ?? 1) * (1 + lowOutput * 0.42),
      };
    }

    if (profile.lockOn) {
      return {
        ...profile,
        lockTime: (profile.lockTime ?? 0.48) * (1 + lowOutput * 0.85),
        homingStrength: (profile.homingStrength ?? 3.2) * (0.7 + outputPercent * 0.3),
      };
    }

    if (profile.special === 'grenade' || profile.special === 'mine') {
      return {
        ...profile,
        cooldownMultiplier: (profile.cooldownMultiplier ?? 1) * (1 + lowOutput * 0.36),
        projectileSpeed: (profile.projectileSpeed ?? 5.8) * (0.78 + outputPercent * 0.22),
      };
    }

    return profile;
  }

  _getCurrentMaxEnergy() {
    return Math.max(1, this.game.player.stats.maxEnergy ?? 1);
  }

  _getReloadDuration() {
    const stats = this.game.player.stats;
    const recharge = Math.max(0, stats.energyRecharge ?? 0);
    const cooldownReduction = THREE.MathUtils.clamp(stats.cooldownReduction ?? 0, 0, 0.75);
    return Math.max(0.42, (1.35 - Math.min(recharge, 0.9) * 0.36) * (1 - cooldownReduction * 0.45));
  }

  _getProfileRange(profile, stats = this.game.player.stats) {
    const baseRange = stats.attackRange;

    if (profile.type === 'swordArm') return this._getBeamBladeArcRange(profile);
    if (profile.special === 'drill') return this._getDrillContactRange(profile);
    if (profile.special === 'laser') return baseRange + 3.5;
    if (profile.special === 'rail') return baseRange + (profile.railRangeBonus ?? 2.4);
    if (profile.special === 'missile') return Math.max(baseRange + 1.8, profile.homingRange ?? baseRange);
    if (profile.special === 'grenade') return baseRange + 0.8;
    if (profile.special === 'cone') return baseRange * (profile.coneRangeMultiplier ?? 1);
    if (profile.special === 'chain') return baseRange + 0.8;
    if (profile.special === 'lift') return profile.liftRange ?? 1.55;
    if (profile.melee) return baseRange;
    if (isBusterProfile(profile)) return baseRange;

    return baseRange + 1.8;
  }

  _getBeamBladeArcRange(profile = DEFAULT_PROFILE) {
    const player = this.game.player;
    const basePlayerRange = player.baseStats?.attackRange ?? 6.2;
    const gearRange = Math.max(0, (player.stats.attackRange ?? basePlayerRange) - basePlayerRange);
    const baseArcRange = profile.baseVisualRange ?? 2.25;
    const growth = profile.visualRangeGrowth ?? 0.24;
    const maxArcRange = profile.maxVisualRange ?? 4.4;

    return Math.min(maxArcRange, baseArcRange + gearRange * growth);
  }

  _getDrillContactRange(profile = DEFAULT_PROFILE) {
    return Math.max(0.55, profile.drillContactRange ?? 1.05);
  }

  _getDrillLaunchRange(profile = DEFAULT_PROFILE) {
    const player = this.game.player;
    const basePlayerRange = player.baseStats?.attackRange ?? 6.2;
    const gearRange = Math.max(0, (player.stats.attackRange ?? basePlayerRange) - basePlayerRange);
    const baseLaunchRange = profile.drillLaunchRange ?? 5.3;
    const rangeScale = profile.drillLaunchRangeGrowth ?? 1;

    return Math.max(baseLaunchRange, baseLaunchRange + gearRange * rangeScale);
  }

  _getWeaponModeLabel(profile, state = null) {
    if (profile.special === 'mine') return 'Trap';
    if (profile.special === 'missile') return 'Lock-On';
    if (profile.special === 'grenade') return this._getGrenadeMode(state) === 'cluster' ? 'Cluster Arc' : 'Arc';
    if (profile.special === 'laser') return 'Beam';
    if (profile.special === 'rail') return 'Pierce';
    if (profile.special === 'cone') return profile.element === 'ice' ? 'Cryo Cone' : 'Thermal Cone';
    if (profile.special === 'chain') return 'Chain';
    if (profile.special === 'lift') return 'Lift';
    if (profile.special === 'drill') return 'Drill';
    if (profile.type === 'swordArm') return 'Beam Blade';
    if (profile.melee) return 'Melee';
    if (profile.freeHoming) return 'Seeker';
    if ((profile.extraProjectiles ?? 0) > 0 || (profile.spread ?? 0) > 0) return 'Spread';
    if ((profile.explosiveRadius ?? 0) > 0) return 'Explosive';

    return 'Manual';
  }

  _getWeaponModeIndicator(profile, state = null, visual = { color: 0x77e8ff }, modeLabel = this._getWeaponModeLabel(profile, state)) {
    const mainColor = visual.color ?? profile.color ?? 0x77e8ff;

    if (profile.special === 'grenade') {
      const clusterMode = this._getGrenadeMode(state) === 'cluster';
      return {
        mode: clusterMode ? 'alternate' : 'main',
        shape: clusterMode ? 'cluster' : 'arc',
        color: colorToCss(clusterMode ? profile.clusterColor ?? 0xffcf73 : profile.color ?? mainColor),
        label: clusterMode ? 'Alternate Mode: Cluster Arc' : 'Main Mode: Impact Arc',
      };
    }

    if (profile.special === 'mine') {
      const alternateReady = this.activeMines.length > 0;
      return {
        mode: alternateReady ? 'alternate-ready' : 'main',
        shape: alternateReady ? 'detonate' : 'trap',
        color: colorToCss(alternateReady ? 0xf2c84b : mainColor),
        label: alternateReady ? 'Z Ready: Detonate Mines' : 'Main Mode: Place Mines',
      };
    }

    if (profile.lockOn) {
      const salvoReady = Boolean(this.lockOn.target && this.lockOn.progress >= 1);
      return {
        mode: salvoReady ? 'alternate-ready' : 'main',
        shape: salvoReady ? 'salvo' : 'lock',
        color: colorToCss(salvoReady ? 0xf2c84b : mainColor),
        label: salvoReady ? 'Z Ready: Missile Salvo' : 'Main Mode: Lock-On Shot',
      };
    }

    if (profile.special === 'laser') {
      return { mode: 'main', shape: 'beam', color: colorToCss(mainColor), label: `Main Mode: ${modeLabel}` };
    }

    if (profile.special === 'rail') {
      return { mode: 'main', shape: 'pierce', color: colorToCss(mainColor), label: `Main Mode: ${modeLabel}` };
    }

    if (profile.special === 'cone') {
      return { mode: 'main', shape: 'cone', color: colorToCss(mainColor), label: `Main Mode: ${modeLabel}` };
    }

    if (profile.special === 'chain') {
      return { mode: 'main', shape: 'chain', color: colorToCss(mainColor), label: `Main Mode: ${modeLabel}` };
    }

    if (profile.special === 'lift') {
      return { mode: 'main', shape: 'utility', color: colorToCss(mainColor), label: 'Main Mode: Lift / Carry' };
    }

    if (profile.special === 'drill') {
      const launchCost = this._getOutputCost(profile, profile.drillLaunchOutputCost ?? 0.72);
      const alternateReady = Boolean(state && state.weaponOutput >= launchCost && state.cooldown <= 0 && state.reloadTimer <= 0);
      return {
        mode: alternateReady ? 'alternate-ready' : 'main',
        shape: alternateReady ? 'pierce' : 'contact',
        color: colorToCss(alternateReady ? 0xf2c84b : mainColor),
        label: alternateReady ? 'Z Ready: Launch Drill Head' : 'Main Mode: Sustained Contact Drill',
      };
    }

    if (profile.type === 'swordArm') {
      return { mode: 'main', shape: 'blade', color: colorToCss(mainColor), label: `Main Mode: ${modeLabel}` };
    }

    if (profile.freeHoming) {
      return { mode: 'main', shape: 'seeker', color: colorToCss(mainColor), label: `Main Mode: ${modeLabel}` };
    }

    if ((profile.extraProjectiles ?? 0) > 0 || (profile.spread ?? 0) > 0) {
      return { mode: 'main', shape: 'spread', color: colorToCss(mainColor), label: `Main Mode: ${modeLabel}` };
    }

    if ((profile.explosiveRadius ?? 0) > 0) {
      return { mode: 'main', shape: 'explosive', color: colorToCss(mainColor), label: `Main Mode: ${modeLabel}` };
    }

    return { mode: 'main', shape: 'manual', color: colorToCss(mainColor), label: `Main Mode: ${modeLabel}` };
  }

  _getWeaponStatusLabel(profile, state) {
    const outputLabel = profile.outputLabel ?? 'Output';

    if (this.swapTimer > 0) {
      return `Swapping ${this.swapTimer.toFixed(1)}s`;
    }

    if (state.reloadTimer > 0) {
      return `Reloading ${state.reloadTimer.toFixed(1)}s`;
    }

    if (state.cooldown > 0) {
      return state.weaponOutput <= 0.001
        ? `${outputLabel} venting ${state.cooldown.toFixed(1)}s`
        : `Cooling ${state.cooldown.toFixed(1)}s`;
    }

    const outputPercent = this._getOutputPercent(state);
    if (state.weaponOutput + 0.001 < this._getOutputRequiredToFire(profile)) {
      return `${outputLabel} rebuilding`;
    }

    if (outputPercent <= 0.2) {
      return `${outputLabel} low | release to recover`;
    }

    if (profile.special === 'mine') {
      return this.activeMines.length > 0
        ? `Mines armed ${this.activeMines.length}/${this._getMineLimit(profile)} | Z detonate`
        : `Place mines within range`;
    }

    if (profile.lockOn) {
      if (!this.lockOn.target) {
        return 'Scanning for lock';
      }

      const percent = Math.round(this.lockOn.progress * 100);
      if (this.lockOn.progress >= 1) {
        const salvoCost = profile.salvoEnergyCost ?? (profile.energyCost ?? 1) * 2.2;
        return state.energy >= salvoCost
          ? `Target locked | Z missile salvo`
          : `Target locked | needs ${salvoCost.toFixed(1)} Energy for salvo`;
      }

      return `Acquiring lock ${percent}% | Z cycle target`;
    }

    if (profile.special === 'grenade') {
      return this._getGrenadeMode(state) === 'cluster'
        ? 'Cluster grenade splits on detonation | Z impact mode'
        : 'Impact grenade with landing preview | Z cluster mode';
    }

    if (profile.special === 'laser') {
      return this.laser.active
        ? `Beam charge ${Math.round((state.laserHeat ?? 0) * 100)}% | release before overflow`
        : 'Hold fire to grow beam power; empty gauges overflow';
    }

    if (profile.special === 'rail') {
      return 'Instant piercing line shot';
    }

    if (profile.special === 'cone') {
      return profile.element === 'ice'
        ? 'Hold fire: icy gas pressure falls as output drains'
        : 'Hold fire: thermal spray weakens as output drains';
    }

    if (profile.special === 'chain') {
      return 'Chains through clustered targets';
    }

    if (profile.special === 'lift') {
      if (this.lift.active && this.lift.kind === 'enemy') {
        return `Holding Horokko | break ${Math.max(0, this.lift.breakTimer).toFixed(1)}s`;
      }

      return this.lift.active
        ? 'Holding object | release to drop'
        : 'Hold fire near Junk or Horokko to lift';
    }

    if (profile.special === 'drill') {
      return this.drill.active
        ? 'Drilling contact | Z fires drill head'
        : 'Hold fire to drill junk or armor | Z launches drill head';
    }

    if (profile.type === 'swordArm') {
      return 'Wide horizontal laser blade slash';
    }

    if (isBusterProfile(profile)) {
      const cost = this._getBusterOutputCostPerShot(profile);
      const shotsReady = Math.floor((state.weaponOutput + 0.001) / cost);
      const burstCapacity = Math.floor(this._getBusterBurstShotCapacity(profile) + 0.001);
      return `Burst output ${shotsReady}/${burstCapacity} shots`;
    }

    if (profile.freeHoming) {
      return 'Seeker rounds bend toward targets';
    }

    if ((profile.explosiveRadius ?? 0) > 0) {
      return 'Explosive impact shot';
    }

    if ((profile.extraProjectiles ?? 0) > 0 || (profile.spread ?? 0) > 0) {
      return 'Spread burst fire';
    }

    return 'Manual aimed fire';
  }

  _projectileAttackDirection(direction, profile, aimWorld = null) {
    if (profile.special === 'grenade') {
      this._grenadeAttackDirection(direction, profile, aimWorld);
      return;
    }

    const player = this.game.player;
    const stats = this._getCombatStatsForProfile(profile);
    const origin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
    const count = Math.max(1, Math.round((stats.projectileCount ?? 1) + (profile.extraProjectiles ?? 0)));
    const spread = profile.spread ?? (count > 1 ? 0.16 : 0);
    const projectileSpeed = (profile.projectileSpeed ?? 9.5) + (stats.projectileSpeed ?? 0);
    const pierce = Math.max(0, Math.round((stats.projectilePierce ?? 0) + (profile.pierceBonus ?? 0)));
    const element = getPlayerElement(stats, profile);
    const color = getElementColor(element, profile.color ?? 0x7ee7ff);
    const armorBreakChance = (stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0);
    const lockedTarget = profile.lockOn && this.lockOn.progress >= 1 ? this.lockOn.target : null;
    const range = this._getProfileRange(profile, stats);

    for (let i = 0; i < count; i += 1) {
      const offset = (i - (count - 1) / 2) * spread;
      const shotDirection = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), offset);
      const damageRoll = this._rollPlayerDamage(profile, stats);
      const damage = lockedTarget && profile.special === 'missile'
        ? damageRoll.damage * 1.12
        : damageRoll.damage;

      this.game.projectiles.spawn({
        owner: 'player',
        position: origin,
        direction: shotDirection,
        speed: projectileSpeed,
        range,
        radius: profile.projectileRadius ?? 0.17,
        damage,
        color,
        source: player,
        critical: damageRoll.critical,
        element,
        pierce,
        explosiveRadius: profile.explosiveRadius ?? 0,
        explodeOnExpire: profile.explodeOnExpire ?? false,
        armorBreakChance,
        armorPierce: profile.armorPierce ?? 0,
        stagger: profile.stagger ?? 0,
        statusBuildup: profile.statusBuildup ?? 1,
        chainChance: profile.chainChance ?? 0,
        chainDamageMultiplier: profile.chainDamageMultiplier ?? 0.36,
        arcHeight: profile.arcHeight ?? 0,
        homingStrength: profile.homingStrength ?? 0,
        homingRange: profile.homingRange ?? 0,
        target: lockedTarget,
        freeHoming: profile.freeHoming ?? false,
        visualType: profile.visualType ?? 'buster',
      });
    }
  }

  _grenadeAttackDirection(direction, profile, aimWorld = null) {
    const player = this.game.player;
    const origin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
    const count = Math.max(1, Math.round(player.stats.projectileCount + (profile.extraProjectiles ?? 0)));
    const spread = count > 1 ? 0.12 : 0;
    const projectileSpeed = (profile.projectileSpeed ?? 5.8) + (player.stats.projectileSpeed ?? 0);
    const element = getPlayerElement(player.stats, profile);
    const color = getElementColor(element, profile.color ?? 0xff9f43);
    const armorBreakChance = (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0);
    const targetPoint = this._getClampedAimPoint(aimWorld, player.stats.attackRange + 0.8);

    for (let i = 0; i < count; i += 1) {
      const offset = (i - (count - 1) / 2) * spread;
      const shotDirection = direction.clone().applyAxisAngle(WORLD_UP, offset).normalize();
      tempFlat.copy(targetPoint).sub(player.root.position);
      tempFlat.y = 0;
      const travelRange = Math.max(1.2, Math.min(player.stats.attackRange + 1.8, tempFlat.length()));
      const damageRoll = this._rollPlayerDamage(profile);

      this.game.projectiles.spawn({
        owner: 'player',
        position: origin,
        direction: shotDirection,
        speed: projectileSpeed,
        range: travelRange,
        radius: profile.projectileRadius ?? 0.22,
        damage: damageRoll.damage,
        color,
        source: player,
        critical: damageRoll.critical,
        element,
        pierce: 0,
        explosiveRadius: (profile.explosiveRadius ?? 1.55) + player.stats.areaDamage * 0.65,
        explodeOnExpire: true,
        armorBreakChance,
        armorPierce: profile.armorPierce ?? 0,
        stagger: profile.stagger ?? 0.26,
        statusBuildup: profile.statusBuildup ?? 1,
        chainChance: profile.chainChance ?? 0,
        chainDamageMultiplier: profile.chainDamageMultiplier ?? 0.36,
        arcHeight: (profile.arcHeight ?? 1.3) + travelRange * 0.08,
        endY: 0.14,
        visualType: profile.visualType ?? 'grenade',
        clusterCount: profile.grenadeMode === 'cluster' ? profile.clusterCount ?? 5 : 0,
        clusterDamageMultiplier: profile.clusterDamageMultiplier ?? 0.42,
        clusterExplosionRadius: (profile.clusterExplosionRadius ?? 0.68) + player.stats.areaDamage * 0.22,
        clusterSpreadRadius: profile.clusterSpreadRadius ?? 1.45,
        clusterArcHeight: profile.clusterArcHeight ?? 0.42,
      });
    }

    this._showGrenadeLandingPulse(targetPoint, (profile.explosiveRadius ?? 1.55) + player.stats.areaDamage * 0.65, color);
  }

  _getClampedAimPoint(aimWorld, range) {
    const player = this.game.player;

    tempDirection.copy(aimWorld ?? player.root.position).sub(player.root.position);
    tempDirection.y = 0;

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.copy(player.lastMoveDirection);
    }

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.set(0, 0, 1);
    }

    const distance = Math.min(range, tempDirection.length());
    tempDirection.normalize();
    return tempAimPoint.copy(player.root.position).addScaledVector(tempDirection, distance);
  }

  _placeMine(aimWorld, profile) {
    const player = this.game.player;
    const position = this._getClampedAimPoint(aimWorld, player.stats.attackRange).clone();
    position.y = 0.055;

    const damageRoll = this._rollPlayerDamage(profile);
    const color = profile.color ?? 0xffd36f;
    const group = new THREE.Group();
    group.name = 'playerMineArmMine';
    group.position.copy(position);

    const casingMaterial = new THREE.MeshStandardMaterial({
      color: 0x45484f,
      emissive: color,
      emissiveIntensity: 0.08,
      roughness: 0.38,
      metalness: 0.55,
    });
    const lensMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const ringMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const magnetRingMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.14, 22), casingMaterial);
    casing.name = 'mineCasing';
    casing.position.y = 0.07;
    casing.castShadow = true;

    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), lensMaterial);
    lens.name = 'mineArmingLight';
    lens.position.y = 0.17;

    const ring = new THREE.Mesh(new THREE.RingGeometry(profile.mineTriggerRadius * 0.92, profile.mineTriggerRadius, 44), ringMaterial);
    ring.name = 'mineTriggerRadius';
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;

    const magnetRadius = Math.max(profile.mineTriggerRadius ?? 1.25, profile.mineMagnetRadius ?? 2.15);
    const magnetRing = new THREE.Mesh(new THREE.RingGeometry(magnetRadius * 0.97, magnetRadius, 54), magnetRingMaterial);
    magnetRing.name = 'mineMagneticFieldRadius';
    magnetRing.rotation.x = -Math.PI / 2;
    magnetRing.position.y = 0.008;

    group.add(casing, lens, magnetRing, ring);
    this.game.scene.add(group);

    const mine = {
      group,
      casing,
      lens,
      ring,
      magnetRing,
      color,
      damage: damageRoll.damage,
      critical: damageRoll.critical,
      triggerRadius: profile.mineTriggerRadius ?? 1.25,
      magnetRadius,
      magnetStrength: profile.mineMagnetStrength ?? 1.55,
      explosionRadius: (profile.explosiveRadius ?? 1.95) + player.stats.areaDamage * 0.8,
      armorBreakChance: (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0),
      stagger: profile.stagger ?? 0.2,
      armingTimer: profile.mineArmingDelay ?? 0.5,
      lifetime: profile.mineLifetime ?? 7.5,
      maxLifetime: profile.mineLifetime ?? 7.5,
      armed: false,
    };

    this.activeMines.push(mine);

    while (this.activeMines.length > this._getMineLimit(profile)) {
      this._detonateMine(this.activeMines[0]);
    }
  }

  _updateMines(dt) {
    for (let i = this.activeMines.length - 1; i >= 0; i -= 1) {
      const mine = this.activeMines[i];
      mine.lifetime -= dt;
      mine.armingTimer = Math.max(0, mine.armingTimer - dt);
      mine.armed = mine.armingTimer <= 0;

      const pulse = 0.5 + Math.sin(this.game.elapsedTime * (mine.armed ? 9 : 5)) * 0.5;
      mine.lens.scale.setScalar(1 + pulse * (mine.armed ? 0.55 : 0.25));
      mine.ring.material.opacity = mine.armed ? 0.16 + pulse * 0.12 : 0.04 + pulse * 0.04;
      mine.magnetRing.material.opacity = mine.armed ? 0.035 + pulse * 0.055 : 0;
      mine.magnetRing.rotation.z -= dt * (mine.armed ? 0.42 : 0.12);
      mine.casing.material.emissiveIntensity = mine.armed ? 0.18 + pulse * 0.2 : 0.08 + pulse * 0.08;

      if (mine.lifetime <= 0) {
        this._detonateMine(mine);
        continue;
      }

      if (!mine.armed) {
        continue;
      }

      this._applyMineMagnetism(mine, dt);

      for (const enemy of this.game.enemies) {
        if (enemy.dead) {
          continue;
        }

        tempFlat.copy(enemy.root.position).sub(mine.group.position);
        tempFlat.y = 0;
        if (tempFlat.lengthSq() <= (mine.triggerRadius + enemy.radius) ** 2) {
          this._detonateMine(mine);
          break;
        }
      }
    }
  }

  _applyMineMagnetism(mine, dt) {
    if (mine.magnetRadius <= mine.triggerRadius || mine.magnetStrength <= 0) {
      return;
    }

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      tempFlat.copy(mine.group.position).sub(enemy.root.position);
      tempFlat.y = 0;
      const distance = tempFlat.length();
      const triggerDistance = mine.triggerRadius + enemy.radius;
      const magnetDistance = mine.magnetRadius + enemy.radius;

      if (distance <= triggerDistance || distance > magnetDistance || distance <= 0.001) {
        continue;
      }

      const falloff = 1 - THREE.MathUtils.clamp((distance - triggerDistance) / Math.max(0.001, magnetDistance - triggerDistance), 0, 1);
      const pull = mine.magnetStrength * (0.35 + falloff * 0.65) * dt;
      tempFlat.divideScalar(distance);
      enemy.root.position.addScaledVector(tempFlat, pull);
      enemy.root.position.y = 0;
    }
  }

  _detonateMine(mine) {
    const index = this.activeMines.indexOf(mine);
    if (index >= 0) {
      this.activeMines.splice(index, 1);
    }

    const position = mine.group.position.clone();
    position.y = 0.08;
    mine.group.removeFromParent();
    this.game.addExplosion(position, mine.damage, mine.explosionRadius, mine.color, {
      element: getPlayerElement(this.game.player.stats, { element: null }) ?? 'fire',
      armorBreakChance: mine.armorBreakChance,
      stagger: mine.stagger,
      critical: mine.critical,
    });
    this.game.addParticleBurst(position, mine.color, 18, 0.2);
  }

  _detonateAllMines() {
    const mines = [...this.activeMines];
    for (const mine of mines) {
      this._detonateMine(mine);
    }
  }

  triggerMinesNear(position, radius = 1) {
    const mines = [...this.activeMines];
    for (const mine of mines) {
      if (mine.group.position.distanceTo(position) <= radius + mine.triggerRadius) {
        this._detonateMine(mine);
      }
    }
  }

  _getMineLimit(profile) {
    return Math.max(1, Math.round((profile.maxActiveMines ?? 4) + Math.min(2, this.game.player.stats.projectileCount - 1)));
  }

  _updateLockOn(dt, aimWorld, profile, togglePressed = false) {
    if (togglePressed) {
      this.lockOn.movementLocked = !this.lockOn.movementLocked;

      if (!this.lockOn.movementLocked && !profile.lockOn) {
        this._clearLockOn();
        return;
      }
    }

    const manualAimLock = Boolean(this.lockOn.movementLocked);

    if (!profile.lockOn && !manualAimLock) {
      this._clearLockOn();
      return;
    }

    if (this.lockOn.skipTimer > 0) {
      this.lockOn.skipTimer = Math.max(0, this.lockOn.skipTimer - dt);
      if (this.lockOn.skipTimer <= 0) {
        this.lockOn.skippedTargetId = null;
      }
    }

    if (manualAimLock && this._isValidLockTarget(this.lockOn.target)) {
      const range = Math.max(2, profile.homingRange ?? this.game.player.stats.attackRange);
      tempFlat.copy(this.lockOn.target.root.position).sub(this.game.player.root.position);
      tempFlat.y = 0;

      if (tempFlat.lengthSq() <= range * range) {
        this.lockOn.progress = 1;
        this.lockOn.manual = true;
        this._updateLockMarker();
        return;
      }
    }

    const candidate = this._findLockCandidate(aimWorld, profile);

    if (!candidate) {
      this._clearLockOn();
      return;
    }

    if (candidate !== this.lockOn.target) {
      this.lockOn.target = candidate;
      this.lockOn.progress = manualAimLock ? 1 : 0;
    }

    this.lockOn.manual = manualAimLock && !profile.lockOn;
    if (this.lockOn.manual) {
      this.lockOn.progress = 1;
    } else {
      const lockSpeed = 1 + (this.game.player.stats.lockOnSpeed ?? 0);
      const lockTime = Math.max(0.12, profile.lockTime ?? 0.48);
      this.lockOn.progress = Math.min(1, this.lockOn.progress + (dt * lockSpeed) / lockTime);
    }
    this._updateLockMarker();
  }

  _findLockCandidate(aimWorld, profile) {
    const player = this.game.player;
    const range = Math.max(2, profile.homingRange ?? player.stats.attackRange);
    const aimDirection = tempDirection.copy(aimWorld ?? player.root.position).sub(player.root.position);
    aimDirection.y = 0;

    if (aimDirection.lengthSq() <= 0.001) {
      aimDirection.copy(player.lastMoveDirection);
    }

    if (aimDirection.lengthSq() <= 0.001) {
      aimDirection.set(0, 0, 1);
    }

    aimDirection.normalize();
    let bestEnemy = null;
    let bestScore = Infinity;

    for (const enemy of this.game.enemies) {
      if (enemy.dead || enemy.id === this.lockOn.skippedTargetId) {
        continue;
      }

      tempToEnemy.copy(enemy.root.position).sub(player.root.position);
      tempToEnemy.y = 0;
      const distance = tempToEnemy.length();
      if (distance > range || distance <= 0.001) {
        continue;
      }

      const angle = angleBetweenFlat(aimDirection, tempToEnemy.normalize());
      const reticleDistance = aimWorld ? enemy.root.position.distanceTo(aimWorld) : distance;
      if (angle > 0.95 && reticleDistance > 2.4) {
        continue;
      }

      const score = angle * 2.4 + reticleDistance * 0.42 + distance * 0.035;
      if (score < bestScore) {
        bestScore = score;
        bestEnemy = enemy;
      }
    }

    return bestEnemy;
  }

  _ensureLockMarker() {
    if (this.lockOn.marker) {
      return this.lockOn.marker;
    }

    const group = new THREE.Group();
    group.name = 'missileLockOnReticle';

    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.025, 6, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd36f, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    outer.name = 'lockOnOuterRing';
    outer.rotation.x = Math.PI / 2;

    const inner = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.23, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd36f, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
    );
    inner.name = 'lockOnProgressRing';
    inner.rotation.x = -Math.PI / 2;

    group.add(outer, inner);
    group.visible = false;
    this.game.scene.add(group);
    this.lockOn.marker = group;
    return group;
  }

  _updateLockMarker() {
    if (!this.lockOn.target) {
      this._clearLockOn();
      return;
    }

    const marker = this._ensureLockMarker();
    const color = this.lockOn.progress >= 1 ? 0x7ee7ff : 0xffd36f;
    marker.visible = true;
    marker.position.copy(this.lockOn.target.root.position);
    marker.position.y += 1.95;
    marker.rotation.y += 0.08;
    marker.scale.setScalar(0.78 + this.lockOn.progress * 0.34);

    for (const child of marker.children) {
      child.material.color.set(color);
      child.material.opacity = child.name === 'lockOnProgressRing'
        ? 0.28 + this.lockOn.progress * 0.48
        : 0.52 + this.lockOn.progress * 0.32;
    }
  }

  _clearLockOn(clearSkip = true) {
    this.lockOn.target = null;
    this.lockOn.progress = 0;
    this.lockOn.manual = false;
    this.lockOn.movementLocked = false;
    if (clearSkip) {
      this.lockOn.skippedTargetId = null;
      this.lockOn.skipTimer = 0;
    }

    if (this.lockOn.marker) {
      this.lockOn.marker.visible = false;
    }
  }

  _ensureGrenadePreview() {
    if (this.grenadePreview) {
      return this.grenadePreview;
    }

    const preview = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff9f43,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    preview.name = 'grenadeLandingPreview';
    preview.rotation.x = -Math.PI / 2;
    preview.visible = false;
    this.game.scene.add(preview);
    this.grenadePreview = preview;
    return preview;
  }

  _ensureGrenadeArcPreview() {
    if (this.grenadeArcPreview) {
      return this.grenadeArcPreview;
    }

    const group = new THREE.Group();
    group.name = 'grenadeTrajectoryPreview';

    const dotGeometry = new THREE.SphereGeometry(0.045, 8, 6);
    for (let i = 0; i < 9; i += 1) {
      const dot = new THREE.Mesh(
        dotGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xffc476,
          transparent: true,
          opacity: 0.22 + i * 0.045,
          depthWrite: false,
        }),
      );
      dot.name = `grenadeTrajectoryDot_${i + 1}`;
      group.add(dot);
    }

    group.visible = false;
    this.game.scene.add(group);
    this.grenadeArcPreview = group;
    return group;
  }

  _updateGrenadePreview(aimWorld, profile) {
    if (profile.special !== 'grenade') {
      this._hideGrenadePreview();
      return;
    }

    const player = this.game.player;
    const preview = this._ensureGrenadePreview();
    const arcPreview = this._ensureGrenadeArcPreview();
    const radius = (profile.explosiveRadius ?? 1.55) + player.stats.areaDamage * 0.65;
    const element = getPlayerElement(player.stats, profile);
    const color = getElementColor(element, profile.color ?? 0xff9f43);
    const targetPoint = this._getClampedAimPoint(aimWorld, player.stats.attackRange + 0.8);

    preview.position.copy(targetPoint);
    preview.position.y = 0.035;
    preview.scale.setScalar(radius);
    preview.material.color.set(color);
    preview.visible = true;

    tempStart.copy(player.getProjectileOrigin?.() ?? player.getAttackOrigin());
    tempStart.y = Math.max(tempStart.y, 1.05);
    tempEnd.copy(targetPoint);
    tempEnd.y = 0.14;
    tempFlat.copy(tempEnd).sub(player.root.position);
    tempFlat.y = 0;

    const arcHeight = (profile.arcHeight ?? 1.3) + Math.min(player.stats.attackRange + 1.8, tempFlat.length()) * 0.08;
    const pulse = 0.5 + Math.sin(this.game.elapsedTime * 7) * 0.5;
    arcPreview.visible = true;

    for (let i = 0; i < arcPreview.children.length; i += 1) {
      const dot = arcPreview.children[i];
      const t = (i + 1) / (arcPreview.children.length + 1);
      dot.position.lerpVectors(tempStart, tempEnd, t);
      dot.position.y += Math.sin(t * Math.PI) * arcHeight;
      dot.scale.setScalar(0.8 + pulse * 0.22 + t * 0.35);
      dot.material.color.set(color);
      dot.material.opacity = 0.12 + t * 0.42;
    }
  }

  _hideGrenadePreview() {
    if (this.grenadePreview) {
      this.grenadePreview.visible = false;
    }
    if (this.grenadeArcPreview) {
      this.grenadeArcPreview.visible = false;
    }
  }

  _showGrenadeModePulse(mode, aimWorld, profile) {
    const player = this.game.player;
    const color = mode === 'cluster' ? profile.clusterColor ?? 0xffcf73 : profile.color ?? 0xff9f43;
    const targetPoint = this._getClampedAimPoint(aimWorld, player.stats.attackRange + 0.8);
    const radius = mode === 'cluster'
      ? (profile.clusterSpreadRadius ?? 1.45)
      : (profile.explosiveRadius ?? 1.55) + player.stats.areaDamage * 0.65;

    this.game.addHitEffect(player.root.position, color, 0.6);
    this.game.addParticleBurst(player.root.position.clone().add(new THREE.Vector3(0, 1.05, 0)), color, 7, 0.12);
    this._showGrenadeLandingPulse(targetPoint, radius, color);
  }

  _showMissileSalvoPulse(origin, targetPosition, color) {
    const targetPulse = targetPosition.clone();
    targetPulse.y += 0.55;

    this.game.addHitEffect(origin, color, 0.58);
    this.game.addParticleBurst(origin, color, 12, 0.13);
    this.game.addHitEffect(targetPulse, color, 0.72);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.56, 36),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.name = 'missileSalvoLockPulse';
    ring.position.copy(targetPosition);
    ring.position.y = 0.08;
    ring.rotation.x = -Math.PI / 2;
    this.game.scene.add(ring);
    this.game.timedEffects.push({ object: ring, life: 0.28, maxLife: 0.28, grow: true });
  }

  _showGrenadeLandingPulse(position, radius, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.name = 'grenadeLandingPulse';
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(position);
    ring.position.y = 0.06;
    ring.scale.setScalar(radius);
    this.game.scene.add(ring);
    this.game.timedEffects.push({ object: ring, life: 0.36, maxLife: 0.36, grow: true });
  }

  _updateLaserBeam(dt, aimWorld, profile, state) {
    const continuingBeam = this.laser.active && this.laser.currentState === state;

    if (
      state.reloadTimer > 0
      || state.cooldown > 0
      || state.energy <= 0
      || state.weaponOutput <= 0
      || (!continuingBeam && !this._hasRequiredWeaponOutput(state, profile))
    ) {
      if (state.weaponOutput <= 0.001) {
        state.cooldown = Math.max(state.cooldown, profile.outputVentDuration ?? 0.88);
      } else if (!continuingBeam) {
        state.cooldown = Math.max(state.cooldown, profile.outputStarvedCooldown ?? 0.08);
      }
      this._stopLaserBeam(false);
      return;
    }

    const player = this.game.player;
    tempDirection.copy(aimWorld).sub(player.root.position);
    tempDirection.y = 0;

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.copy(player.lastMoveDirection);
    }

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.set(0, 0, 1);
    }

    tempDirection.normalize();
    const range = player.stats.attackRange + 3.5;
    const targetPoint = player.root.position.clone().addScaledVector(tempDirection, range);
    player.playProjectileShotAnimation(profile.animationDuration ?? 0.16, targetPoint, 0.2, {
      weaponKey: state.key,
      continuous: true,
    });
    player.setMovementLock(0.09, profile.beamMovementMultiplier ?? 0.08);

    if (!player.isProjectileAimSustained?.(state.key)) {
      this._stopLaserBeam(false);
      return;
    }

    this._ensureLaserVisuals(profile);
    this.laser.active = true;
    this.laser.currentState = state;
    this.laser.tickTimer -= dt;
    state.laserHeat = THREE.MathUtils.clamp((state.laserHeat ?? 0) + dt * (profile.heatBuildRate ?? 0.42), 0, 1);
    const heat = state.laserHeat ?? 0;

    state.energy = Math.max(0, state.energy - (profile.energyDrainPerSecond ?? 3.8) * dt);
    state.weaponOutput = Math.max(0, state.weaponOutput - this._getOutputDrainPerSecond(profile) * dt);
    state.outputRecoveryDelay = Math.max(state.outputRecoveryDelay ?? 0, this._getOutputRecoveryDelay(profile));
    const energyOverflow = state.energy <= 0.001;
    const outputOverflow = state.weaponOutput <= 0.001;

    const origin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
    origin.y = Math.max(origin.y, 1.05);
    tempEnd.copy(origin).addScaledVector(tempDirection, range);
    this._updateLaserVisual(origin, tempEnd, profile, heat);

    if (this.laser.tickTimer <= 0) {
      this.laser.tickTimer = LASER_TICK_INTERVAL;
      this._damageLaserLine(origin, tempDirection, range, profile, heat);
      this.game.addParticleBurst(tempEnd, profile.color ?? 0xbff5ff, 4 + Math.round(heat * 3), 0.1 + heat * 0.04);
    }

    if (energyOverflow) {
      state.energy = 0;
      state.reloadTimer = Math.max(state.reloadTimer, state.reloadDuration * 1.22);
      this._triggerLaserOverheat(origin, profile, heat, { reason: outputOverflow ? 'both' : 'energy' });
      this._stopLaserBeam(false);
      this.game.addParticleBurst(origin, profile.color ?? 0xbff5ff, 18 + Math.round(heat * 12), 0.16 + heat * 0.08);
    } else if (outputOverflow) {
      state.weaponOutput = 0;
      state.cooldown = Math.max(state.cooldown, profile.outputVentDuration ?? 0.88);
      this._triggerLaserOverheat(origin, profile, Math.max(heat, 0.72), { reason: 'output' });
      this._stopLaserBeam(false);
      this.game.addParticleBurst(origin, profile.color ?? 0xbff5ff, 16 + Math.round(heat * 10), 0.14 + heat * 0.08);
    }
  }

  _ensureLaserVisuals(profile) {
    if (this.laser.beam && this.laser.impact) {
      return;
    }

    this.laser.beam = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: profile.color ?? 0xbff5ff,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      }),
    );
    this.laser.beam.name = 'shiningLaserBeam';
    this.laser.beam.visible = false;

    this.laser.impact = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 10),
      new THREE.MeshBasicMaterial({
        color: profile.color ?? 0xbff5ff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.laser.impact.name = 'shiningLaserImpact';
    this.laser.impact.visible = false;

    this.game.scene.add(this.laser.beam, this.laser.impact);
  }

  _updateLaserVisual(origin, end, profile, heat = 0) {
    const beam = this.laser.beam;
    const impact = this.laser.impact;
    const length = origin.distanceTo(end);
    const heatCurve = THREE.MathUtils.smoothstep(heat, 0, 1);
    const pulse = Math.sin(this.game.elapsedTime * (38 + heatCurve * 20));
    const beamWidth = (profile.beamWidth ?? 0.34)
      * (1 + heatCurve * (profile.maxHeatWidthBonus ?? 0.95))
      * (1 + Math.max(0, pulse) * (0.04 + heatCurve * 0.07));

    tempMidpoint.copy(origin).lerp(end, 0.5);
    beam.position.copy(tempMidpoint);
    beam.scale.set(beamWidth, beamWidth, length);
    beam.lookAt(end);
    beam.material.opacity = 0.48 + heatCurve * 0.28 + pulse * (0.06 + heatCurve * 0.08);
    beam.visible = true;

    impact.position.copy(end);
    impact.scale.setScalar(0.78 + heatCurve * 0.95 + Math.sin(this.game.elapsedTime * 44) * (0.14 + heatCurve * 0.14));
    impact.visible = true;
  }

  _damageLaserLine(origin, direction, range, profile, heat = 0) {
    const player = this.game.player;
    const heatCurve = THREE.MathUtils.smoothstep(heat, 0, 1);
    const beamWidth = (profile.beamWidth ?? 0.34) * (1 + heatCurve * (profile.maxHeatWidthBonus ?? 0.95));
    tempStart.copy(origin);
    tempStart.y = 0;

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      tempToEnemy.copy(enemy.root.position).sub(tempStart);
      tempToEnemy.y = 0;
      const along = tempToEnemy.dot(direction);
      if (along < 0 || along > range) {
        continue;
      }

      tempClosest.copy(tempStart).addScaledVector(direction, along);
      const hitRadius = beamWidth + enemy.radius;
      if (enemy.root.position.distanceToSquared(tempClosest) > hitRadius * hitRadius) {
        continue;
      }

      const damageRoll = this._rollPlayerDamage(profile);
      this.game.damageEnemy(enemy, damageRoll.damage * (1 + heatCurve * (profile.maxHeatDamageBonus ?? 1.65)), {
        critical: damageRoll.critical,
        source: player,
        element: getPlayerElement(player.stats, profile),
        armorBreakChance: (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0),
        armorPierce: profile.armorPierce ?? 0,
        stagger: profile.stagger ?? 0,
        statusBuildup: profile.statusBuildup ?? 1,
        knockbackDirection: direction,
        knockback: 0.75,
      });
    }
  }

  _triggerLaserOverheat(origin, profile, heat = 1, options = {}) {
    const player = this.game.player;
    const color = profile.color ?? 0xbff5ff;
    const blastPosition = origin.clone();
    blastPosition.y = 0.08;
    const damageRoll = this._rollPlayerDamage(profile);
    const heatCurve = THREE.MathUtils.smoothstep(heat, 0, 1);
    const bothOverflow = options.reason === 'both';
    const outputOverflow = bothOverflow || options.reason === 'output';
    const energyOverflow = bothOverflow || options.reason === 'energy';
    const resourceBonus = bothOverflow ? 0.28 : outputOverflow ? 0.2 : energyOverflow ? 0.12 : 0;
    const radius = (profile.overheatRadius ?? 2.45) * (0.58 + heatCurve * 0.92 + resourceBonus);
    const damage = damageRoll.damage
      * (profile.overheatDamageMultiplier ?? 1.9)
      * (0.62 + heatCurve * 1.28 + resourceBonus * 1.15);

    this.game.addExplosion(blastPosition, damage, radius, color, {
      source: player,
      element: getPlayerElement(player.stats, profile),
      critical: damageRoll.critical,
      stagger: 0.42,
      armorBreakChance: (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0),
      armorPierce: profile.armorPierce ?? 0,
      statusBuildup: profile.statusBuildup ?? 1,
      damagePlayer: false,
      triggerMines: false,
      knockback: 2.8 + heatCurve * 2.2,
    });
    this._showLaserOverflowPulse(blastPosition, radius, color, heatCurve);
    this.game.addParticleBurst(origin, color, 24 + Math.round(heatCurve * 22), 0.2 + heatCurve * 0.16);
  }

  _showLaserOverflowPulse(position, radius, color, heat = 1) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 1, 56),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.34 + heat * 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.name = 'shiningLaserOverflowPulse';
    ring.position.copy(position);
    ring.position.y = 0.075;
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(radius);
    this.game.scene.add(ring);
    this.game.timedEffects.push({ object: ring, life: 0.46, maxLife: 0.46, grow: true });
  }

  _stopLaserBeam(applyCooldown = true) {
    if (!this.laser.active) {
      if (this.laser.beam) {
        this.laser.beam.visible = false;
      }
      if (this.laser.impact) {
        this.laser.impact.visible = false;
      }
      return;
    }

    if (applyCooldown && this.laser.currentState?.reloadTimer <= 0) {
      this.laser.currentState.cooldown = Math.max(this.laser.currentState.cooldown, 0.24);
    }

    if (this.laser.impact?.visible) {
      this.game.addParticleBurst(this.laser.impact.position, 0xbff5ff, 8, 0.12);
    }

    this.laser.active = false;
    this.laser.tickTimer = 0;
    this.laser.currentState = null;

    if (this.laser.beam) {
      this.laser.beam.visible = false;
    }
    if (this.laser.impact) {
      this.laser.impact.visible = false;
    }
  }

  _updateDrillSpin(dt, aimWorld, profile, state) {
    this._ensureOutputState(state, profile);

    if (this.swapTimer > 0 || state.cooldown > 0 || state.reloadTimer > 0) {
      this._stopDrillSpin();
      return;
    }

    const continuing = this.drill.active && this.drill.currentState === state;
    if (state.weaponOutput <= 0.001 || (!continuing && !this._hasRequiredWeaponOutput(state, profile))) {
      if (state.weaponOutput <= 0.001) {
        state.weaponOutput = 0;
        state.cooldown = Math.max(state.cooldown, profile.outputVentDuration ?? 0.5);
      } else {
        state.cooldown = Math.max(state.cooldown, profile.outputStarvedCooldown ?? 0.1);
      }
      this._stopDrillSpin();
      return;
    }

    const player = this.game.player;
    tempDirection.copy(aimWorld ?? player.root.position).sub(player.root.position);
    tempDirection.y = 0;

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.copy(player.lastMoveDirection);
    }

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.set(0, 0, 1);
    }

    tempDirection.normalize();

    const range = this._getDrillContactRange(profile);
    const color = profile.color ?? 0xffd36f;
    const targetPoint = player.root.position.clone().addScaledVector(tempDirection, range);
    const origin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
    origin.y = Math.max(origin.y, 0.9);
    const outputPercent = this._getOutputPercent(state);

    this.drill.active = true;
    this.drill.currentState = state;
    player.externalRig?.setDrillSpinning?.(true);
    player.playProjectileShotAnimation(profile.animationDuration ?? 0.2, targetPoint, 0.16, {
      weaponKey: state.key,
      continuous: true,
    });
    player.setMovementLock?.(0.08, 0.42);

    const outputDrain = profile.drillOutputDrainPerSecond ?? this._getOutputDrainPerSecond(profile);
    state.weaponOutput = Math.max(0, state.weaponOutput - outputDrain * dt);
    state.outputRecoveryDelay = Math.max(state.outputRecoveryDelay ?? 0, this._getOutputRecoveryDelay(profile));

    this.drill.particleTimer = Math.max(0, this.drill.particleTimer - dt);
    if (this.drill.particleTimer <= 0) {
      this._showDrillContactEffect(origin, tempDirection, range, profile.drillWidth ?? 0.5, color, outputPercent);
      this.drill.particleTimer = DRILL_PARTICLE_INTERVAL;
    }

    this.drill.tickTimer = Math.max(0, this.drill.tickTimer - dt);
    if (this.drill.tickTimer <= 0) {
      const tickInterval = profile.drillTickInterval ?? DRILL_TICK_INTERVAL;
      this._damageDrillContact(tempDirection, profile, tickInterval);
      this.drill.tickTimer = tickInterval;
    }

    if (state.weaponOutput <= 0.001) {
      state.weaponOutput = 0;
      state.cooldown = Math.max(state.cooldown, profile.outputVentDuration ?? 0.5);
      this.game.addParticleBurst(origin, color, 16, 0.14);
      this._stopDrillSpin();
    }
  }

  _stopDrillSpin() {
    if (!this.drill.active) {
      this.game.player?.externalRig?.setDrillSpinning?.(false);
      return;
    }

    this.drill.active = false;
    this.drill.tickTimer = 0;
    this.drill.particleTimer = 0;
    this.drill.currentState = null;
    this.game.player?.externalRig?.setDrillSpinning?.(false);
  }

  _damageDrillContact(direction, profile, tickInterval) {
    const player = this.game.player;
    const range = this._getDrillContactRange(profile);
    const width = profile.drillWidth ?? 0.5;
    const color = profile.color ?? 0xffd36f;
    const candidates = this._getLineHitCandidates(player.root.position, direction, range, width);

    for (const { enemy } of candidates) {
      const damageRoll = this._rollPlayerDamage(profile);
      const enemyDamage = THREE.MathUtils.clamp(
        damageRoll.damage * 0.08 * (tickInterval / DRILL_TICK_INTERVAL),
        1,
        profile.drillEnemyDamageCap ?? 3,
      );
      this.game.damageEnemy(enemy, enemyDamage, {
        critical: false,
        source: player,
        element: getPlayerElement(player.stats, profile),
        armorBreakChance: (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0),
        armorPierce: profile.armorPierce ?? 10,
        stagger: profile.stagger ?? 0.05,
        statusBuildup: profile.statusBuildup ?? 1,
        knockbackDirection: direction,
        knockback: 0.28,
      });
    }

    const junkDamage = Math.max(1, player.stats.attackDamage * (profile.drillUtilityDamageMultiplier ?? 2.3) * tickInterval);
    this.game.damageJunkAlongLine?.(player.root.position, direction, range, width, junkDamage, {
      color,
      source: player,
      tool: 'drill',
    });
  }

  _showDrillContactEffect(origin, direction, range, width, color, pressure = 1) {
    tempEnd.copy(origin).addScaledVector(direction, Math.min(range, 0.38 + pressure * 0.22));
    this.game.addParticleBurst(tempEnd, color, 2, 0.075 + pressure * 0.018);
  }

  _railAttackDirection(direction, profile) {
    const player = this.game.player;
    const origin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
    origin.y = Math.max(origin.y, 1.05);
    const range = player.stats.attackRange + (profile.railRangeBonus ?? 2.4);
    const color = profile.color ?? 0xcff9ff;
    const maxHits = Math.max(1, Math.round(player.stats.projectilePierce + (profile.pierceBonus ?? 0) + 1));
    const candidates = this._getLineHitCandidates(player.root.position, direction, range, profile.railWidth ?? 0.22);

    tempEnd.copy(origin).addScaledVector(direction, range);
    this._addLineEffect(origin, tempEnd, color, 0.075, 0.16, 0.9);
    this.game.addParticleBurst(tempEnd, color, 8, 0.12);

    for (let i = 0; i < Math.min(maxHits, candidates.length); i += 1) {
      const enemy = candidates[i].enemy;
      const damageRoll = this._rollPlayerDamage(profile);
      this.game.damageEnemy(enemy, damageRoll.damage, {
        critical: damageRoll.critical,
        source: player,
        element: getPlayerElement(player.stats, profile),
        armorBreakChance: (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0),
        armorPierce: profile.armorPierce ?? 0,
        stagger: profile.stagger ?? 0.08,
        knockbackDirection: direction,
        knockback: 1.8,
        hitStopDuration: damageRoll.critical ? 0.09 : 0.065,
        hitStopTimeScale: damageRoll.critical ? 0.04 : 0.06,
      });
      this.game.addHitEffect(enemy.root.position, color, 0.5);
    }
  }

  _coneAttackDirection(direction, profile) {
    const player = this.game.player;
    const range = Math.max(1.6, player.stats.attackRange * (profile.coneRangeMultiplier ?? 1));
    const coneAngle = profile.coneAngle ?? 0.52;
    const color = profile.color ?? 0xff7842;
    const element = getPlayerElement(player.stats, profile);

    this._addConeEffect(player.root.position, direction, range, coneAngle, color);

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      tempToEnemy.copy(enemy.root.position).sub(player.root.position);
      tempToEnemy.y = 0;
      const distance = tempToEnemy.length();
      if (distance > range + enemy.radius || distance <= 0.001) {
        continue;
      }

      tempToEnemy.normalize();
      if (angleBetweenFlat(direction, tempToEnemy) > coneAngle) {
        continue;
      }

      const falloff = 1 - THREE.MathUtils.clamp(distance / Math.max(0.001, range), 0, 0.55);
      const damageRoll = this._rollPlayerDamage(profile);
      this.game.damageEnemy(enemy, damageRoll.damage * falloff, {
        critical: damageRoll.critical,
        source: player,
        element,
        armorBreakChance: (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0),
        stagger: profile.stagger ?? 0,
        statusBuildup: profile.statusBuildup ?? 1,
        knockbackDirection: tempToEnemy,
        knockback: profile.coneKnockback ?? 1,
      });
    }

    if (element === 'fire' && profile.fireZoneDuration > 0) {
      tempAimPoint.copy(player.root.position).addScaledVector(direction, range * 0.72);
      tempAimPoint.y = 0.04;
      this.game.addFireZone(tempAimPoint, Math.max(1, player.stats.attackDamage * 0.22), profile.fireZoneDuration, 0.78 + player.stats.areaDamage * 0.5, {
        target: 'enemies',
        source: player,
        element: 'fire',
      });
    }
  }

  _updateConeSpray(dt, aimWorld, profile, state) {
    if (this.swapTimer > 0 || state.reloadTimer > 0 || state.cooldown > 0) {
      return;
    }

    if (state.energy <= 0.001) {
      state.energy = 0;
      state.reloadTimer = state.reloadDuration;
      return;
    }

    const continuingSpray = state.sprayWasActiveLastFrame === true;
    if (state.weaponOutput <= 0.001 || (!continuingSpray && !this._hasRequiredWeaponOutput(state, profile))) {
      if (state.weaponOutput <= 0.001) {
        state.weaponOutput = 0;
        state.cooldown = Math.max(state.cooldown, profile.outputVentDuration ?? 0.72);
      } else {
        state.cooldown = Math.max(state.cooldown, profile.outputStarvedCooldown ?? 0.08);
      }
      return;
    }

    const player = this.game.player;
    state.sprayActive = true;
    tempDirection.copy(aimWorld).sub(player.root.position);
    tempDirection.y = 0;

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.copy(player.lastMoveDirection);
    }

    if (tempDirection.lengthSq() <= 0.001) {
      tempDirection.set(0, 0, 1);
    }

    tempDirection.normalize();

    const outputPercent = this._getOutputPercent(state);
    const range = Math.max(1.05, player.stats.attackRange * (profile.coneRangeMultiplier ?? 1));
    const coneAngle = profile.coneAngle ?? 0.52;
    const color = profile.color ?? 0x8bddff;
    const element = getPlayerElement(player.stats, profile);
    const targetPoint = player.root.position.clone().addScaledVector(tempDirection, range);

    player.playProjectileShotAnimation(profile.animationDuration ?? 0.2, targetPoint, 0.14, {
      weaponKey: state.key,
      continuous: true,
    });

    if (!player.isProjectileAimSustained?.(state.key)) {
      return;
    }

    const energyDrain = profile.energyDrainPerSecond ?? (profile.energyCost ?? 1) * 1.9;
    const outputDrain = this._getOutputDrainPerSecond(profile);
    state.energy = Math.max(0, state.energy - energyDrain * dt);
    state.weaponOutput = Math.max(0, state.weaponOutput - outputDrain * dt);
    state.outputRecoveryDelay = Math.max(state.outputRecoveryDelay ?? 0, this._getOutputRecoveryDelay(profile));

    state.coneParticleTimer = Math.max(0, (state.coneParticleTimer ?? 0) - dt);
    if (state.coneParticleTimer <= 0) {
      const origin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
      origin.y = Math.max(origin.y, 0.9);
      this.game.addDirectedParticleSpray(origin, tempDirection, color, {
        count: profile.element === 'ice' ? 8 : 6,
        range,
        halfAngle: coneAngle,
        baseScale: profile.element === 'ice' ? 0.21 : 0.17,
        pressure: outputPercent,
      });
      this._addConeEffect(player.root.position, tempDirection, range, coneAngle, color, 0.14 + outputPercent * 0.12);
      state.coneParticleTimer = SPRAY_PARTICLE_INTERVAL;
    }

    state.coneZoneTimer = Math.max(0, (state.coneZoneTimer ?? 0) - dt);
    if (element === 'fire' && profile.fireZoneDuration > 0 && state.coneZoneTimer <= 0) {
      tempAimPoint.copy(player.root.position).addScaledVector(tempDirection, range * 0.62);
      tempAimPoint.y = 0.04;
      this.game.addFireZone(tempAimPoint, Math.max(0.8, player.stats.attackDamage * 0.12 * outputPercent), 0.85, 0.62 + player.stats.areaDamage * 0.34, {
        target: 'enemies',
        source: player,
        element: 'fire',
      });
      state.coneZoneTimer = 0.38;
    }

    state.coneTickTimer = Math.max(0, (state.coneTickTimer ?? 0) - dt);
    if (state.coneTickTimer <= 0) {
      this._damageConeSpray(tempDirection, profile, range, coneAngle, SPRAY_TICK_INTERVAL);
      state.coneTickTimer = SPRAY_TICK_INTERVAL;
    }

    if (state.energy <= 0.001) {
      state.energy = 0;
      state.reloadTimer = state.reloadDuration;
    }

    if (state.weaponOutput <= 0.001) {
      state.weaponOutput = 0;
      state.cooldown = Math.max(state.cooldown, profile.outputVentDuration ?? 0.72);
      const ventOrigin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
      ventOrigin.y = Math.max(ventOrigin.y, 0.9);
      this.game.addParticleBurst(ventOrigin, color, 12, 0.12);
    }
  }

  _damageConeSpray(direction, profile, range, coneAngle, tickInterval) {
    const player = this.game.player;
    const element = getPlayerElement(player.stats, profile);
    const tickScale = tickInterval * (profile.sprayDamagePerSecondMultiplier ?? 1.45);

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      tempToEnemy.copy(enemy.root.position).sub(player.root.position);
      tempToEnemy.y = 0;
      const distance = tempToEnemy.length();
      if (distance > range + enemy.radius || distance <= 0.001) {
        continue;
      }

      tempToEnemy.normalize();
      if (angleBetweenFlat(direction, tempToEnemy) > coneAngle) {
        continue;
      }

      const falloff = 1 - THREE.MathUtils.clamp(distance / Math.max(0.001, range), 0, 0.65);
      const damageRoll = this._rollPlayerDamage(profile);
      const damage = damageRoll.damage * falloff * tickScale;
      this.game.damageEnemy(enemy, damage, {
        critical: damageRoll.critical,
        source: player,
        element,
        armorBreakChance: (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0),
        stagger: (profile.stagger ?? 0) * tickInterval * 2.2,
        statusBuildup: (profile.statusBuildup ?? 1) * tickInterval * 2.8,
        knockbackDirection: tempToEnemy,
        knockback: (profile.coneKnockback ?? 1) * tickInterval * 1.4,
      });
    }
  }

  _chainAttackDirection(direction, profile, aimWorld = null) {
    const player = this.game.player;
    const range = player.stats.attackRange + 0.8;
    const primary = this._findChainPrimary(direction, aimWorld, range);
    const origin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
    origin.y = Math.max(origin.y, 1.05);
    const color = profile.color ?? 0xa6f7ff;

    if (!primary) {
      tempEnd.copy(origin).addScaledVector(direction, Math.min(range, 3.2));
      this._addLineEffect(origin, tempEnd, color, 0.04, 0.12, 0.55);
      this.game.addParticleBurst(tempEnd, color, 6, 0.1);
      return;
    }

    const hitEnemies = [primary];
    const maxTargets = Math.max(1, Math.round(profile.chainTargets ?? 4));

    while (hitEnemies.length < maxTargets) {
      const previous = hitEnemies[hitEnemies.length - 1];
      let nearest = null;
      let nearestDistanceSq = (profile.chainRange ?? 4.4) ** 2;

      for (const enemy of this.game.enemies) {
        if (enemy.dead || hitEnemies.includes(enemy)) {
          continue;
        }

        const distanceSq = enemy.root.position.distanceToSquared(previous.root.position);
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearest = enemy;
        }
      }

      if (!nearest) {
        break;
      }

      hitEnemies.push(nearest);
    }

    let previousPoint = origin.clone();
    for (let i = 0; i < hitEnemies.length; i += 1) {
      const enemy = hitEnemies[i];
      const targetPoint = enemy.root.position.clone().add(new THREE.Vector3(0, 1.25, 0));
      const damageRoll = this._rollPlayerDamage(profile);
      const chainFalloff = Math.max(0.42, 1 - i * 0.18);

      this._addLineEffect(previousPoint, targetPoint, color, Math.max(0.025, 0.055 - i * 0.007), 0.15, 0.82);
      this.game.damageEnemy(enemy, damageRoll.damage * chainFalloff, {
        critical: damageRoll.critical,
        source: player,
        element: 'shock',
        armorBreakChance: (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0),
        stagger: profile.stagger ?? 0.12,
        statusBuildup: profile.statusBuildup ?? 1,
        chainChance: 0,
        knockbackDirection: direction,
        knockback: 0.8,
      });

      previousPoint = targetPoint;
    }
  }

  _drillAttackDirection(direction, profile) {
    const player = this.game.player;
    const visualOrigin = player.getProjectileOrigin?.() ?? player.getAttackOrigin();
    visualOrigin.y = Math.max(visualOrigin.y, 0.9);
    const range = this._getDrillContactRange(profile);
    const width = profile.drillWidth ?? 0.42;
    const color = profile.color ?? 0xffd36f;

    player.setMovementLock(0.1, 0.38);
    this._showDrillContactEffect(visualOrigin, direction, range, width, color, this._getOutputPercent(this.getCurrentWeaponState()));
    this._damageDrillContact(direction, profile, profile.drillTickInterval ?? DRILL_TICK_INTERVAL);
  }

  _findChainPrimary(direction, aimWorld, range) {
    let bestEnemy = null;
    let bestScore = Infinity;
    const playerPosition = this.game.player.root.position;

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      tempToEnemy.copy(enemy.root.position).sub(playerPosition);
      tempToEnemy.y = 0;
      const distance = tempToEnemy.length();
      if (distance > range || distance <= 0.001) {
        continue;
      }

      const angle = angleBetweenFlat(direction, tempToEnemy.normalize());
      const reticleDistance = aimWorld ? enemy.root.position.distanceTo(aimWorld) : distance;
      if (angle > 0.9 && reticleDistance > 2.2) {
        continue;
      }

      const score = angle * 2.2 + reticleDistance * 0.36 + distance * 0.025;
      if (score < bestScore) {
        bestScore = score;
        bestEnemy = enemy;
      }
    }

    return bestEnemy;
  }

  _getLineHitCandidates(start, direction, range, width) {
    const candidates = [];
    tempStart.copy(start);
    tempStart.y = 0;

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      tempToEnemy.copy(enemy.root.position).sub(tempStart);
      tempToEnemy.y = 0;
      const along = tempToEnemy.dot(direction);
      if (along < 0 || along > range) {
        continue;
      }

      tempClosest.copy(tempStart).addScaledVector(direction, along);
      const hitRadius = width + enemy.radius;
      if (enemy.root.position.distanceToSquared(tempClosest) > hitRadius * hitRadius) {
        continue;
      }

      candidates.push({ enemy, along });
    }

    candidates.sort((a, b) => a.along - b.along);
    return candidates;
  }

  _addLineEffect(start, end, color, width = 0.06, life = 0.16, opacity = 0.75) {
    const length = start.distanceTo(end);
    if (length <= 0.001) {
      return;
    }

    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    beam.name = 'instantWeaponLineEffect';
    tempMidpoint.copy(start).lerp(end, 0.5);
    beam.position.copy(tempMidpoint);
    beam.scale.set(width, width, length);
    beam.lookAt(end);
    this.game.scene.add(beam);
    this.game.timedEffects.push({ object: beam, life, maxLife: life });
  }

  _addConeEffect(position, direction, range, halfAngle, color, opacity = 0.42) {
    const cone = new THREE.Mesh(
      new THREE.RingGeometry(0.22, range, 42, 1, -halfAngle, halfAngle),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    cone.name = 'elementalConeEffect';
    cone.position.copy(position);
    cone.position.y = 0.09;
    cone.rotation.x = -Math.PI / 2;
    cone.rotation.z = Math.atan2(-direction.z, direction.x);
    this.game.scene.add(cone);
    this.game.timedEffects.push({ object: cone, life: 0.18, maxLife: 0.18, grow: true });
  }

  _meleeAttackDirection(direction, profile, options = {}) {
    const player = this.game.player;
    const visual = options.visual ?? this._getActiveWeaponVisual(profile);
    const beamBlade = profile.type === 'swordArm';
    const range = beamBlade
      ? this._getBeamBladeArcRange(profile)
      : Math.max(1.2, player.stats.attackRange);
    const arcBase = beamBlade ? 0.38 : 0.34;
    const arcAngle = Math.PI * (arcBase + player.stats.areaDamage * (beamBlade ? 0.2 : 0.28)) * (profile.arcScale ?? 1);

    this.game.addSlashEffect(player.root.position, direction, range, visual.color, {
      beamBlade,
      arcAngle,
      height: beamBlade ? 0.92 : 0.18,
      visualRange: range,
      duration: beamBlade ? profile.animationDuration * ((profile.visualEnd ?? profile.slashEnd ?? 0.96) - (profile.activeStart ?? 0.56)) : undefined,
      delay: 0,
    });

    for (const enemy of this.game.enemies) {
      if (enemy.dead) {
        continue;
      }

      tempToEnemy.copy(enemy.root.position).sub(player.root.position);
      tempToEnemy.y = 0;
      const distance = tempToEnemy.length();

      if (distance > range + enemy.radius || distance <= 0.001) {
        continue;
      }

      tempToEnemy.normalize();

      if (angleBetweenFlat(direction, tempToEnemy) <= arcAngle) {
        const damageRoll = this._rollPlayerDamage(profile);
        const armorBreakChance = (player.stats.armorBreakChance ?? 0) + (profile.armorBreakBonus ?? 0);
        this.game.damageEnemy(enemy, damageRoll.damage, {
          critical: damageRoll.critical,
          source: player,
          element: profile.type === 'swordArm' ? visual.element : getPlayerElement(player.stats, profile),
          armorBreakChance,
          stagger: profile.stagger ?? 0,
          statusBuildup: profile.statusBuildup ?? 1,
          knockbackDirection: tempToEnemy,
          knockback: profile.type === 'drillArm' ? 1.2 : 3.2,
          hitStopDuration: beamBlade ? (damageRoll.critical ? 0.13 : 0.105) : (damageRoll.critical ? 0.085 : 0.055),
          hitStopTimeScale: beamBlade ? 0.04 : 0.07,
        });
      }
    }
  }

  _rollPlayerDamage(profile = DEFAULT_PROFILE, stats = this.game.player.stats) {
    const elemental = (stats.fireDamage ?? 0) + (stats.iceDamage ?? 0) + (stats.corrosionDamage ?? 0);
    let damage = (stats.attackDamage ?? 1) + elemental;
    const critical = Math.random() < (stats.criticalChance ?? 0);

    damage *= 0.9 + Math.random() * 0.22;
    damage *= 1 + (stats.areaDamage ?? 0);
    damage *= profile.damageMultiplier ?? 1;

    if (critical) {
      damage *= stats.criticalDamage ?? 1.55;
    }

    return { damage, critical };
  }
}
