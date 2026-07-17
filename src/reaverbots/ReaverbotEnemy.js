import * as THREE from 'three';
import { Enemy } from '../Enemy.js';
import {
  findStraightBusterCapsuleHitFraction,
  sphereIntersectsTargetCapsule,
} from '../buster/BusterProjectileKernel.js';
import {
  animateReaverbotVisual,
  createReaverbotVisual,
} from './ReaverbotVisualFactory.js';
import { createReaverbotSalvageProfile } from './ReaverbotSalvageCatalog.js';
import { SeededRandom } from './SeededRandom.js';

const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempC = new THREE.Vector3();
const tempD = new THREE.Vector3();
const tempE = new THREE.Vector3();
const tempF = new THREE.Vector3();
const tempG = new THREE.Vector3();
const tempH = new THREE.Vector3();
const tempI = new THREE.Vector3();
const tempBounds = new THREE.Box3();
const tempForward = new THREE.Vector3();
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const RUSH_WARNING_COLOR_HEX = 0xff2020;
const RUSH_WARNING_COLOR = new THREE.Color(RUSH_WARNING_COLOR_HEX);
const CHARGE_INITIATION_RANGE = 10.5;
const CHARGE_MINIMUM_INITIATION_RANGE = 1.2;
const CHARGE_TRAVEL_DISTANCE = 12.5;
const CHARGE_TRAVEL_DURATION = 0.9;
const CHARGE_TRAVEL_SPEED = CHARGE_TRAVEL_DISTANCE / CHARGE_TRAVEL_DURATION;
const CHARGE_TRACK_LOCK_PROGRESS = 0.7;
const CHARGE_MIN_RECOVERY_DURATION = 1.25;
const RED_EYE_HIT_RADIUS = 0.18;
const RED_EYE_REFOCUS_DURATION = 0.9;
const RUSH_WARNING_MIN_RATE = 2.2;
const RUSH_WARNING_MAX_RATE = 10.5;
const TRACTOR_BEAM_COLOR = 0x68fff2;
const TRACTOR_CARGO_GAP = 0.58;
const TRACTOR_CARGO_ROOT_LIFT = 1.35;
const TRACTOR_PURSUIT_SPEED_SCALE = 3.15;
const TRACTOR_BEAM_TRACK_SPEED_SCALE = 2.15;
const TRACTOR_FLIP_WINDUP_DURATION = 0.38;
const TRACTOR_ZIGZAG_SPEED_SCALE = 5.35;
const TRACTOR_ZIGZAG_MIN_INTERVAL = 0.08;
const TRACTOR_ZIGZAG_MAX_INTERVAL = 0.12;
const TRACTOR_ZIGZAG_MIN_AMPLITUDE = 1.05;
const TRACTOR_ZIGZAG_MAX_AMPLITUDE = 1.45;
const TRACTOR_ZIGZAG_TIMEOUT = 1.65;
const TRACTOR_PLAYER_CAPTURE_RADIUS = 0.95;
const TRACTOR_PLAYER_THROW_DISTANCE = 4.4;
const TRACTOR_PLAYER_IMPACT_RADIUS = 1.8;
const TRACTOR_PLAYER_AVOID_RADIUS = 5.8;
const TRACTOR_TAG_PAUSE_DURATION = 0.24;
const TRACTOR_CRASH_FALL_DURATION = 0.52;
const TRACTOR_CRASH_GROUNDED_DURATION = 1.35;
const TRACTOR_CRASH_RELAUNCH_DURATION = 0.62;
const COIL_BOUNCE_DURATION = 0.58;
const COIL_BOUNCE_MIN_HEIGHT = 2.35;
const CLAW_VAULT_DURATION = 0.54;
const CLAW_GUARD_DURATION = 0.62;
const CLAW_RECOIL_DURATION = 0.85;
const CLAW_TELEGRAPH_DURATION = 1.65;
const CLAW_HORIZONTAL_COMMIT_DURATION = 0.52;
const CLAW_VERTICAL_COMMIT_DURATION = 0.58;
const CLAW_HORIZONTAL_SWEEP_RADIUS = 4.55;
const CLAW_SLAM_RADIUS = 2.65;
const MELEE_BODY_CONTACT_INTERVAL = 0.72;
const MELEE_BODY_CONTACT_DAMAGE_SCALE = 0.32;
const MELEE_BODY_CONTACT_KNOCKBACK = 0.86;
const JAW_PLAYER_SEPARATION_BUFFER = 0.16;
const JAW_OVERLAP_RECOVERY_SPEED_SCALE = 2.2;
const DETONATOR_KNOCKBACK_DISTANCE = 4.2;
const DETONATOR_KNOCKBACK_SPEED = 8.4;
const DETONATOR_KNOCKBACK_MIN_DURATION = 0.38;
const DETONATOR_KNOCKBACK_MAX_DURATION = 0.62;
const DETONATOR_KNOCKBACK_ARC_HEIGHT = 0.48;
const DETONATOR_GROUNDED_DURATION = 0.48;
const DETONATOR_RELAUNCH_DURATION = 0.54;
const DETONATOR_PLAYER_OVERLAP_GRACE = 0.12;
const DETONATOR_GROUNDED_COLLISION_OFFSET = 0.38;
const DETONATOR_WEAPONIZATION_HEALTH_FLOOR_RATIO = 0.08;
const DETONATOR_DIRECTION_OFFSETS = Object.freeze([0, 0.3, -0.3, 0.58, -0.58]);
const DETONATOR_DISTANCE_SCALES = Object.freeze([1, 0.82, 0.64, 0.46]);
const PASSIVE_DEFENSES = new Set([
  'armoredSkull',
  'armoredBack',
  'armoredCarapace',
]);

function isResolvedPlayerContact(result) {
  return Boolean(result?.contacted && !result.dodged && !result.immune);
}

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function brainSafeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function flatDistance(a, b) {
  const x = a.x - b.x;
  const z = a.z - b.z;
  return Math.sqrt(x * x + z * z);
}

function createTelegraphRing(color, radius) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.name = 'material_generatedReaverbotTelegraph';
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.76, radius, 40), material);
  ring.name = 'generatedReaverbotAttackTelegraph';
  ring.rotation.x = -Math.PI / 2;
  return ring;
}

function showBeam(game, origin, direction, range, color) {
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.13, range),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  beam.name = 'generatedReaverbotBeam';
  beam.position.copy(origin).addScaledVector(direction, range * 0.5);
  beam.quaternion.setFromUnitVectors(WORLD_FORWARD, direction);
  game.scene.add(beam);
  game.timedEffects.push({ object: beam, life: 0.18, maxLife: 0.18, opacity: 0.88 });
}

function distanceToRay(point, origin, direction, maxDistance) {
  tempA.copy(point).sub(origin);
  const projection = THREE.MathUtils.clamp(tempA.dot(direction), 0, maxDistance);
  tempB.copy(origin).addScaledVector(direction, projection);
  return point.distanceTo(tempB);
}

export class ReaverbotEnemy extends Enemy {
  constructor(genome, level = genome?.threatTier ?? 1, { eliteAffix = null } = {}) {
    if (!genome) {
      throw new Error('ReaverbotEnemy requires a generated genome.');
    }

    super('basic', level, {
      label: genome.name,
      scale: 1,
      radius: genome.stats.radius,
      maxHealth: genome.stats.maxHealth,
      damage: genome.stats.damage,
      moveSpeed: genome.stats.moveSpeed,
      attackRange: genome.stats.attackRange,
      attackCooldown: genome.stats.attackCooldown,
      armor: genome.stats.armor,
      experience: genome.stats.experience,
      skinColor: genome.palette.primary,
      clothColor: genome.palette.secondary,
      hairColor: genome.palette.dark,
      eyeColor: genome.modules.eye.color,
    });

    this.genome = genome;
    this.isProceduralReaverbot = true;
    this.typeKey = `generated:${genome.archetypeId}`;
    this.type = {
      ...this.type,
      label: genome.name,
      procedural: true,
      archetypeId: genome.archetypeId,
      modelHeight: genome.stats.collisionHeight,
      ranged: genome.modules.weapon.tags.includes('ranged'),
      attackKind: genome.modules.weapon.attackKind,
    };
    this.stats = {
      maxHealth: genome.stats.maxHealth,
      damage: genome.stats.damage,
      moveSpeed: genome.stats.moveSpeed,
      attackRange: genome.stats.attackRange,
      attackCooldown: genome.stats.attackCooldown,
      armor: genome.stats.armor,
      experience: genome.stats.experience,
    };
    this.health = this.stats.maxHealth;
    this.radius = genome.stats.radius;
    this.collisionHeight = genome.stats.collisionHeight;
    this.combatAimOffset = this.collisionHeight * 0.54;
    this.navigationMode = genome.body.navigationMode;
    this.hoverHeight = genome.body.hoverHeight ?? 0;
    this.liftable = this.navigationMode === 'ground'
      && ['quadruped', 'lowBiped', 'hopper'].includes(genome.body.planId)
      && this.radius <= 0.72;

    this._setProceduralHumanoidVisible(false);
    this.visual = createReaverbotVisual(genome);
    this.root.add(this.visual.root);
    this.root.userData.enemy = this;
    this.root.userData.reaverbotGenome = genome;
    this.salvageProfile = createReaverbotSalvageProfile(genome);
    this.root.userData.reaverbotSalvageProfile = this.salvageProfile;
    this.healthBar.position.y = this.collisionHeight + 0.42;

    this.aiRandom = new SeededRandom(`${genome.seed}:runtime`);
    this.brain = {
      time: this.aiRandom.float(0, Math.PI * 2),
      state: 'position',
      stateTime: 0,
      cooldown: this.aiRandom.float(0.45, 1.25) * (genome.behavior.attackCooldownScale ?? 1),
      moving: false,
      speedRatio: 0,
      defenseActive: true,
      weakPointExposed: genome.modules.weakPoint.exposure === 'always'
        && genome.modules.defense?.id !== 'rotatingPlates',
      eyeFlinchConsumed: false,
      attackFired: false,
      attackHit: false,
      effectTimer: 0,
      jetTrailTimer: 0,
      tickTimer: 0,
      targetPosition: new THREE.Vector3(),
      attackDirection: new THREE.Vector3(0, 0, 1),
      commitStart: new THREE.Vector3(),
      telegraphMarker: null,
      commitDistance: 0,
      chargeDistanceTravelled: 0,
      pounceJumpHeight: genome.modules.weapon.pounceJumpHeight ?? 2.5,
      warningPhase: 0,
      warningBlinkRate: 0,
      warningIntensity: 0,
      comboStrikesFired: 0,
      jawHopTravel: [0, 0, 0],
      contactCooldown: 0,
      tractorTarget: null,
      tractorTargetKind: null,
      tractorLiftStart: new THREE.Vector3(),
      tractorBeamActive: false,
      tractorBeamIntensity: 0,
      tractorBeamLength: 3.4,
      tractorPathFailureTime: 0,
      tractorCargoTopOffset: 0,
      tractorApproachPhase: 'choose',
      tractorApproachTimer: 0,
      tractorApproachStart: new THREE.Vector3(),
      tractorApproachDestination: new THREE.Vector3(),
      tractorZigzagSign: this.aiRandom.chance(0.5) ? 1 : -1,
      tractorZigzagSwitchTimer: 0,
      tractorZigzagInterval: TRACTOR_ZIGZAG_MIN_INTERVAL,
      tractorZigzagAmplitude: TRACTOR_ZIGZAG_MIN_AMPLITUDE,
      tractorFlipDirection: this.aiRandom.chance(0.5) ? 1 : -1,
      tractorBeamPoint: new THREE.Vector3(),
      controllerTagPause: 0,
      tractorCrashPhase: null,
      tractorCrashTimer: 0,
      tractorCrashStart: new THREE.Vector3(),
      tractorCrashLanding: new THREE.Vector3(),
      coilBounceActive: false,
      coilBounceTime: 0,
      coilBounceCooldown: 0,
      coilBounceDuration: COIL_BOUNCE_DURATION,
      coilBounceHeight: COIL_BOUNCE_MIN_HEIGHT,
      coilBounceStart: new THREE.Vector3(),
      coilBounceLanding: new THREE.Vector3(),
      springBounceFailures: 0,
      clawDragSpeed: 0,
      clawVaultActive: false,
      clawVaultTime: 0,
      clawVaultDuration: CLAW_VAULT_DURATION,
      clawVaultHeight: 0,
      clawVaultCooldown: 0,
      clawVaultStart: new THREE.Vector3(),
      clawVaultLanding: new THREE.Vector3(),
      clawGuardDuration: genome.modules.weapon.guardDuration ?? CLAW_GUARD_DURATION,
      clawGuardTimeRemaining: 0,
      clawGuardResumeState: 'position',
      clawGuardResumeTime: 0,
      clawRecoilDuration: genome.modules.weapon.recoilDuration ?? CLAW_RECOIL_DURATION,
      clawAttackVariant: null,
      clawAttackAttempt: 0,
      clawInterruptedAttempt: -1,
      clawPalmHits: 0,
      clawDestroyed: false,
      clawSpinProgress: 0,
      detonatorKnockback: null,
      packAttackIdleTime: 0,
      packFlankRearBias: genome.archetypeId === 'packHunter'
        ? this.aiRandom.float(
          genome.behavior.flankRearBiasMin ?? 0.28,
          genome.behavior.flankRearBiasMax ?? 0.78,
        )
        : 0.5,
      alerted: false,
    };
    this.weakPointDamage = 0;
    this.weakPointBroken = false;
    this.defenseDisabled = false;
    this.pendingWeakPointBreakEffect = false;
    this.affix = eliteAffix;
    this.affixTimers = { burn: 0.8, surge: 1.1 };

    if (eliteAffix) {
      this._applyEliteAffix(eliteAffix);
    }

    const owner = this;
    this.weakPointTarget = {
      id: `${this.id}:weak:${genome.modules.weakPoint.id}`,
      ownerEnemy: this,
      partId: genome.modules.weakPoint.id,
      root: this.visual.weakPoint.core,
      radius: genome.modules.weakPoint.radius,
      isWeakPointTarget: true,
      // Exposure controls acquisition and damage, not ownership of an already
      // established player lock. Closing armor may cover this point without
      // making the selected mechanism cease to exist.
      get retainLockWhenInactive() {
        return !owner.weakPointBroken;
      },
      get dead() {
        return owner.dead;
      },
      get active() {
        return !owner.weakPointBroken && owner.brain.weakPointExposed;
      },
      getWorldPosition(out) {
        return owner.visual.weakPoint.core.getWorldPosition(out);
      },
    };

    this._captureMaterialStates();
  }

  update(dt, game) {
    // Damage is resolved outside the enemy update loop. Retaining the current
    // game reference lets an interrupted tractor beam resolve both machines
    // immediately instead of waiting a frame with stale ownership.
    this._runtimeGame = game;
    if (this.dead) {
      this._removeTelegraphMarker();
    }

    super.update(dt, game);

    if (!this.dead
      && !game.player.dead
      && !this.isExternalMotionActive?.()
      && !game.dungeonController?.isPlayerInSafeZone?.()) {
      this._updateEliteAffix(dt, game);
    }
  }

  getCombatTargets() {
    const targets = [this];
    if (this.genome.modules.weakPoint.lockable
      && this.brain.weakPointExposed
      && !this.weakPointBroken
      && !this.dead) {
      targets.unshift(this.weakPointTarget);
    }
    return targets;
  }

  _isClawCarrier() {
    return this.genome.modules.weapon.id === 'clawArm'
      || this.genome.modules.weapon.attackKind === 'clawMoveset';
  }

  _usesSpringLocomotion() {
    return this.genome.body.movementModel === 'springBounce'
      || this.genome.body.tags?.includes('springLoaded');
  }

  _resetSpringMovementState({ cancelPounce = false } = {}) {
    if (!this._usesSpringLocomotion() || !this.brain) return;
    const brain = this.brain;
    brain.coilBounceActive = false;
    brain.coilBounceTime = 0;
    brain.coilBounceCooldown = 0.12;
    brain.springBounceFailures = 0;
    brain.coilBounceStart.copy(this.root.position);
    brain.coilBounceLanding.copy(this.root.position);

    if (cancelPounce
      && brain.state === 'commit'
      && this._getEffectiveAttackKind() === 'pounce') {
      this._removeTelegraphMarker();
      brain.state = 'recovery';
      brain.stateTime = 0;
      brain.moving = false;
      brain.speedRatio = 0;
      brain.attackFired = true;
    }
  }

  tryClaimExternalControl(owner, kind = 'external', options = {}) {
    if (this.brain?.detonatorKnockback) return false;
    const claimed = super.tryClaimExternalControl(owner, kind, options);
    if (claimed) this._resetSpringMovementState({ cancelPounce: true });
    return claimed;
  }

  releaseExternalControl(owner, reason = 'released', options = {}) {
    const released = super.releaseExternalControl(owner, reason, options);
    if (released) this._resetSpringMovementState({ cancelPounce: true });
    return released;
  }

  startExternalBallisticMotion(owner, options = {}) {
    if (this.brain?.detonatorKnockback) return false;
    const started = super.startExternalBallisticMotion(owner, options);
    if (started) this._resetSpringMovementState({ cancelPounce: true });
    return started;
  }

  clearExternalMotion(reason = 'cleared', game = null) {
    const detonatorMotion = this.brain?.detonatorKnockback;
    if (detonatorMotion) {
      this.brain.detonatorKnockback = null;
      if (reason !== 'death') this._restoreWeaponizedDetonatorVisual(detonatorMotion);
    }
    return super.clearExternalMotion(reason, game) || Boolean(detonatorMotion);
  }

  isExternalMotionActive() {
    return super.isExternalMotionActive() || Boolean(this.brain?.detonatorKnockback);
  }

  _getEffectiveAttackKind() {
    if (this._isClawCarrier() && this.brain.clawDestroyed) return 'charge';
    return this.genome.modules.weapon.attackKind;
  }

  _getStateDuration(state = this.brain.state) {
    const weapon = this.genome.modules.weapon;
    if (state === 'eyeRefocus') return RED_EYE_REFOCUS_DURATION;
    if (this._isClawCarrier()) {
      if (state === 'telegraph') return weapon.telegraphDuration ?? CLAW_TELEGRAPH_DURATION;
      if (state === 'guard') return brainSafeNumber(this.brain.clawGuardDuration, CLAW_GUARD_DURATION);
      if (state === 'recoil') return brainSafeNumber(this.brain.clawRecoilDuration, CLAW_RECOIL_DURATION);
      if (state === 'commit' && !this.brain.clawDestroyed) {
        return this.brain.clawAttackVariant === 'verticalSlam'
          ? (weapon.slamCommitDuration ?? CLAW_VERTICAL_COMMIT_DURATION)
          : (weapon.horizontalCommitDuration ?? CLAW_HORIZONTAL_COMMIT_DURATION);
      }
    }
    if (state === 'telegraph') return this.genome.behavior.telegraphDuration;
    if (state === 'commit') {
      return this._getEffectiveAttackKind() === 'charge'
        ? CHARGE_TRAVEL_DURATION
        : this.genome.behavior.commitDuration;
    }
    if (state === 'recovery') {
      return this._getEffectiveAttackKind() === 'charge'
        ? Math.max(CHARGE_MIN_RECOVERY_DURATION, this.genome.behavior.recoveryDuration)
        : this.genome.behavior.recoveryDuration;
    }
    return 1;
  }

  resolveProjectileHit(position, projectileRadius = 0.1) {
    if (this.dead) return null;

    const weakPoint = this.genome.modules.weakPoint;
    const eyeIsWeakPoint = weakPoint.id === 'eyeLens';
    const normalEyeTargetable = !this.isBoss
      && (!eyeIsWeakPoint || this.brain.weakPointExposed);
    if (normalEyeTargetable) {
      this.visual.eye.lens.getWorldPosition(tempA);
      const eyeRadius = projectileRadius + (eyeIsWeakPoint
        ? (weakPoint.radius ?? RED_EYE_HIT_RADIUS)
        : RED_EYE_HIT_RADIUS);
      if (position.distanceToSquared(tempA) <= eyeRadius * eyeRadius) {
        return {
          hitPartId: 'eyeLens',
          weakPointHit: eyeIsWeakPoint,
          redEyeHit: true,
          hitPosition: tempA.clone(),
        };
      }
    }

    if (!this.brain.weakPointExposed) return null;
    this.visual.weakPoint.core.getWorldPosition(tempA);
    const hitRadius = projectileRadius + (weakPoint.radius ?? 0.2);
    if (position.distanceToSquared(tempA) > hitRadius * hitRadius) return null;

    return {
      hitPartId: weakPoint.id,
      weakPointHit: true,
      redEyeHit: !this.isBoss && eyeIsWeakPoint,
      hitPosition: tempA.clone(),
    };
  }

  resolveLineHit(start, direction, range, width = 0.1, options = {}) {
    if (this.dead) return null;
    const weakPoint = this.genome.modules.weakPoint;
    const eyeIsWeakPoint = weakPoint.id === 'eyeLens';
    const exposedPalmCounter = weakPoint.id === 'clawPalm'
      && this.brain.state === 'telegraph';
    let closestHit = null;

    const considerLineSphere = (worldPosition, radius, hitData, bypassBodyOcclusion = false) => {
      tempD.copy(worldPosition).sub(start);
      const along = tempD.dot(direction);
      if (along < 0 || along > range) return;
      const perpendicularDistanceSq = Math.max(0, tempD.lengthSq() - along * along);
      const hitRadius = width + radius;
      if (perpendicularDistanceSq > hitRadius * hitRadius) return;

      tempC.copy(this.root.position);
      tempC.y += this.collisionHeight * 0.5;
      const bodyCenterAlong = tempC.sub(start).dot(direction);
      if (!bypassBodyOcclusion && along > bodyCenterAlong + hitRadius * 0.35) return;

      if (!closestHit || along < closestHit.along) {
        closestHit = {
          along,
          ...hitData,
          hitPosition: worldPosition.clone(),
        };
      }
    };

    if (!this.isBoss && (!eyeIsWeakPoint || this.brain.weakPointExposed)) {
      this.visual.eye.lens.getWorldPosition(tempA);
      considerLineSphere(
        tempA,
        eyeIsWeakPoint ? (weakPoint.radius ?? RED_EYE_HIT_RADIUS) : RED_EYE_HIT_RADIUS,
        {
          hitPartId: 'eyeLens',
          weakPointHit: eyeIsWeakPoint,
          redEyeHit: true,
        },
      );
    }

    if (!this.brain.weakPointExposed) return closestHit;
    this.visual.weakPoint.core.getWorldPosition(tempA);
    tempB.copy(tempA).sub(start);
    if (options.projectExposedPalm && exposedPalmCounter) {
      tempC.copy(tempB).setY(0);
      const projectedAlong = tempC.dot(direction);
      const projectedPerpendicularSq = Math.max(
        0,
        tempC.lengthSq() - projectedAlong * projectedAlong,
      );
      const projectedHitRadius = width + (this.genome.modules.weakPoint.radius ?? 0.2);
      if (projectedAlong >= 0
        && projectedAlong <= range + projectedHitRadius
        && projectedPerpendicularSq <= projectedHitRadius * projectedHitRadius) {
        const projectedHit = {
          along: projectedAlong,
          hitPartId: weakPoint.id,
          weakPointHit: true,
          hitPosition: tempA.clone(),
        };
        return !closestHit || projectedHit.along < closestHit.along
          ? projectedHit
          : closestHit;
      }
    }
    considerLineSphere(
      tempA,
      weakPoint.radius ?? 0.2,
      {
        hitPartId: weakPoint.id,
        weakPointHit: true,
        redEyeHit: !this.isBoss && eyeIsWeakPoint,
      },
      exposedPalmCounter,
    );
    return closestHit;
  }

  resolveArcHit(origin, direction, range, halfAngle, options = {}) {
    if (!this.brain.weakPointExposed || this.dead) return null;
    this.visual.weakPoint.core.getWorldPosition(tempA);
    tempB.copy(tempA).sub(origin);
    const verticalDistance = Math.abs(tempB.y);
    tempB.y = 0;
    const distance = tempB.length();
    const hitRadius = this.genome.modules.weakPoint.radius ?? 0.2;
    const projectedPalmCounter = options.projectExposedPalm
      && this.genome.modules.weakPoint.id === 'clawPalm'
      && this.brain.state === 'telegraph';
    if (distance > range + hitRadius
      || (!projectedPalmCounter && verticalDistance > 2.8 + hitRadius)) return null;
    if (distance > 0.001) tempB.divideScalar(distance);
    else tempB.copy(direction).setY(0).normalize();
    tempC.copy(direction).setY(0);
    if (tempC.lengthSq() <= 0.0001) tempC.copy(WORLD_FORWARD);
    tempC.normalize();
    if (tempC.dot(tempB) < Math.cos(halfAngle)) return null;
    return {
      along: distance,
      hitPartId: this.genome.modules.weakPoint.id,
      weakPointHit: true,
      hitPosition: tempA.clone(),
    };
  }

  takeDamage(amount, meta = {}) {
    const stateWhenHit = this.brain.state;
    const redirectsDetonator = this._isWeaponizableSelfDetonator()
      && amount > 0
      && !meta.statusTick
      && this._isPlayerOwnedHit(meta);
    const weaponizationHealthFloor = redirectsDetonator
      ? Math.min(this.health, Math.max(1, this.stats.maxHealth * DETONATOR_WEAPONIZATION_HEALTH_FLOOR_RATIO))
      : 0;
    const resolvedAmount = redirectsDetonator
      ? Math.min(amount, Math.max(0, this.health - weaponizationHealthFloor))
      : amount;
    const dealt = super.takeDamage(resolvedAmount, meta);
    const triggersEyeRefocus = dealt > 0
      && !this.dead
      && !this.isBoss
      && !this.brain.eyeFlinchConsumed
      && meta.redEyeHit === true
      && !meta.statusTick
      && this._isPlayerOwnedHit(meta)
      && Boolean(
        meta.projectileHit
        || (meta.directHit && (meta.attackKind === 'beam' || meta.attackKind === 'rail')),
      );

    if (dealt > 0) {
      this.brain.alerted = true;
      if (!triggersEyeRefocus) this._handleControllerTagged(meta);
    }

    const clawPalmCounter = this._isClawCarrier()
      && this.genome.modules.weakPoint.id === 'clawPalm'
      && meta.hitPartId === 'clawPalm'
      && meta.weakPointHit
      && dealt > 0
      && stateWhenHit === 'telegraph'
      && this.brain.clawInterruptedAttempt !== this.brain.clawAttackAttempt
      && this._isPlayerOwnedHit(meta);
    if (clawPalmCounter) {
      this._registerClawPalmCounter(meta);
    } else if (meta.weakPointHit && dealt > 0 && !this.weakPointBroken
      && this.genome.modules.weakPoint.id !== 'clawPalm') {
      this.weakPointDamage += dealt;
      if (this.weakPointDamage >= this.stats.maxHealth * 0.32) {
        this._breakWeakPoint(meta);
      }
    }

    if (triggersEyeRefocus) {
      this._beginRedEyeRefocus(meta, this._runtimeGame);
    }

    if (dealt > 0
      && !this.dead
      && !triggersEyeRefocus
      && this._isClawCarrier()
      && !this.brain.clawDestroyed
      && (stateWhenHit === 'position' || stateWhenHit === 'recovery')
      && this._isDirectPlayerHit(meta)) {
      this._beginClawGuard(stateWhenHit);
    }

    if (redirectsDetonator && !this.dead && !triggersEyeRefocus) {
      this._beginWeaponizedDetonatorKnockback(meta, this._runtimeGame);
    }

    return dealt;
  }

  _beginRedEyeRefocus(meta = {}, game = this._runtimeGame) {
    if (this.isBoss || this.dead || this.brain.eyeFlinchConsumed) return false;
    const brain = this.brain;
    brain.eyeFlinchConsumed = true;

    if (brain.detonatorKnockback) {
      this._restoreWeaponizedDetonatorVisual(brain.detonatorKnockback);
      brain.detonatorKnockback = null;
    }
    this._removeTelegraphMarker();
    this._releaseTractorTarget('red-eye-refocus', game);
    this._resetSpringMovementState({ cancelPounce: false });
    game?.cancelEnemyAttackRequest?.(this);
    game?.completeEnemyAttack?.(this);
    game?.endFlamethrowerEffect?.(this);
    this.clearNavigationRecoveryTarget?.();
    this.contactRetreatMotion = null;
    this.knockback.set(0, 0, 0);

    brain.state = 'eyeRefocus';
    brain.stateTime = 0;
    brain.moving = false;
    brain.speedRatio = 0;
    brain.attackFired = true;
    brain.attackHit = false;
    brain.clawGuardTimeRemaining = 0;
    brain.clawSpinProgress = 0;
    brain.tractorBeamActive = false;
    brain.tractorBeamIntensity = 0;
    brain.cooldown = Math.max(brain.cooldown, RED_EYE_REFOCUS_DURATION);
    brain.contactCooldown = Math.max(
      brain.contactCooldown,
      RED_EYE_REFOCUS_DURATION + this._getStateDuration('recovery'),
    );

    const impactPosition = new THREE.Vector3();
    if (meta.hitPosition) impactPosition.copy(meta.hitPosition);
    else this.visual.eye.lens.getWorldPosition(impactPosition);
    game?.addParticleBurst?.(impactPosition, RUSH_WARNING_COLOR_HEX, 18, 0.12);
    game?.addHitEffect?.(impactPosition, 0xffffff, 0.85, { absolute: true });
    return true;
  }

  _updateEyeRefocusState(dt) {
    const brain = this.brain;
    brain.stateTime += dt;
    brain.moving = false;
    brain.speedRatio = 0;
    this.knockback.set(0, 0, 0);
    if (brain.stateTime < RED_EYE_REFOCUS_DURATION) return;

    brain.state = 'recovery';
    brain.stateTime = 0;
    brain.attackFired = true;
    brain.attackHit = false;
    brain.cooldown = Math.max(brain.cooldown, this.stats.attackCooldown * 0.55);
    brain.contactCooldown = Math.max(
      brain.contactCooldown,
      this._getStateDuration('recovery'),
    );
  }

  _isWeaponizableSelfDetonator() {
    const weapon = this.genome?.modules?.weapon;
    return !this.isBoss
      && this.navigationMode === 'air'
      && Boolean(
        weapon?.attackKind === 'selfDestruct'
        || weapon?.tags?.includes('selfDestruct'),
      );
  }

  _isPlayerOwnedHit(meta = {}) {
    if (meta.playerOwnedAttack === true) return true;
    const player = this._runtimeGame?.player;
    if (!player) return false;
    const source = meta.source ?? null;
    return source === player || source?.owner === player || source?.source === player;
  }

  _isDirectPlayerHit(meta = {}) {
    return this._isPlayerOwnedHit(meta)
      && !meta.statusTick
      && !meta.clawBreakSelfDamage
      && Boolean(meta.projectileHit || meta.directHit || meta.directContactHit);
  }

  _resolveDetonatorKnockbackDirection(meta = {}, game = this._runtimeGame) {
    const playerPosition = game?.player?.root?.position;
    const direction = new THREE.Vector3();
    if (meta.knockbackDirection?.lengthSq?.() > 0.0001) {
      direction.copy(meta.knockbackDirection).setY(0);
    } else if (meta.hitPosition && playerPosition) {
      direction.copy(meta.hitPosition).sub(playerPosition).setY(0);
    } else if (playerPosition) {
      direction.copy(this.root.position).sub(playerPosition).setY(0);
    }
    if (direction.lengthSq() <= 0.0001) {
      direction.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    }
    direction.normalize();

    // Projectile metadata normally already points from MegaMan toward the hit,
    // but reflected or authored attacks can supply the opposite convention.
    // The detonator contract is always explicitly away from the player.
    if (playerPosition) {
      tempA.copy(this.root.position).sub(playerPosition).setY(0);
      if (tempA.lengthSq() > 0.0001 && direction.dot(tempA.normalize()) < 0) {
        direction.multiplyScalar(-1);
      }
    }
    return direction;
  }

  _resolveWeaponizedDetonatorLanding(game, launchDirection, startCollisionOffset) {
    const controller = game?.dungeonController;
    if (!controller) return null;
    const start = this.root.position;
    const candidate = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const arenaCandidate = new THREE.Vector3();

    for (const angleOffset of DETONATOR_DIRECTION_OFFSETS) {
      const cosine = Math.cos(angleOffset);
      const sine = Math.sin(angleOffset);
      direction.set(
        launchDirection.x * cosine - launchDirection.z * sine,
        0,
        launchDirection.x * sine + launchDirection.z * cosine,
      ).normalize();
      for (const distanceScale of DETONATOR_DISTANCE_SCALES) {
        candidate.copy(start).addScaledVector(
          direction,
          DETONATOR_KNOCKBACK_DISTANCE * distanceScale,
        );
        const guardedCandidate = controller.getEnemyArenaTarget?.(
          this,
          candidate,
          arenaCandidate,
        );
        if (guardedCandidate) {
          candidate.x = guardedCandidate.x;
          candidate.z = guardedCandidate.z;
        }
        candidate.y = controller.getSurfaceElevationAt?.(candidate) ?? start.y;
        tempA.copy(candidate).sub(start).setY(0);
        const travel = tempA.length();
        if (travel < 0.72 || tempA.dot(launchDirection) < travel * 0.42) continue;
        if (controller.isPositionWalkable && !controller.isPositionWalkable(candidate)) continue;

        tempB.copy(candidate);
        tempB.y += DETONATOR_GROUNDED_COLLISION_OFFSET;
        if (controller.isAerialPositionClear
          && !controller.isAerialPositionClear(tempB, {
            radius: Math.max(0.2, this.radius * 0.72),
            verticalRadius: Math.max(0.3, this.radius * 0.82),
          })) {
          continue;
        }
        if (!this._isWeaponizedDetonatorFallPathClear(
          game,
          start,
          candidate,
          startCollisionOffset,
        )) {
          continue;
        }
        return candidate.clone();
      }
    }

    // If every backwards tile is obstructed, an in-place drop is preferable
    // to tunnelling through scenery. It is accepted only when the tile and the
    // complete falling path are both valid.
    candidate.copy(start);
    candidate.y = controller.getSurfaceElevationAt?.(candidate) ?? start.y;
    if ((!controller.isPositionWalkable || controller.isPositionWalkable(candidate))
      && this._isWeaponizedDetonatorFallPathClear(
        game,
        start,
        candidate,
        startCollisionOffset,
      )) {
      return candidate.clone();
    }
    return null;
  }

  _isWeaponizedDetonatorFallPathClear(
    game,
    startRootPosition,
    landingRootPosition,
    startCollisionOffset = this.combatAimOffset,
  ) {
    const controller = game?.dungeonController;
    if (!controller?.isAerialPositionClear) return true;
    const travel = startRootPosition.distanceTo(landingRootPosition);
    const steps = Math.max(10, Math.ceil(travel / 0.22));
    const collisionOptions = {
      radius: Math.max(0.2, this.radius * 0.72),
      verticalRadius: Math.max(0.3, this.radius * 0.82),
    };
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      tempC.lerpVectors(startRootPosition, landingRootPosition, progress);
      tempC.y += Math.sin(progress * Math.PI) * DETONATOR_KNOCKBACK_ARC_HEIGHT;
      tempC.y += THREE.MathUtils.lerp(
        startCollisionOffset,
        DETONATOR_GROUNDED_COLLISION_OFFSET,
        progress,
      );
      if (!controller.isAerialPositionClear(tempC, collisionOptions)) return false;
    }
    return true;
  }

  _beginWeaponizedDetonatorKnockback(meta = {}, game = this._runtimeGame) {
    if (!game || this.dead || !this._isWeaponizableSelfDetonator()) return false;
    const existingMotion = this.brain.detonatorKnockback;
    const startCollisionOffset = existingMotion?.collisionOffset
      ?? Math.max(DETONATOR_GROUNDED_COLLISION_OFFSET, this.combatAimOffset);
    const launchDirection = this._resolveDetonatorKnockbackDirection(meta, game);
    const landingPosition = this._resolveWeaponizedDetonatorLanding(
      game,
      launchDirection,
      startCollisionOffset,
    );
    if (!landingPosition) return false;

    // Tractor ownership, contact leaps, and authored attack commits cannot
    // coexist with player weaponization. Release them at the actual hit point.
    super.clearExternalMotion('weaponized-detonator-hit', game);
    this._removeTelegraphMarker();
    this._releaseTractorTarget('weaponized-detonator-hit', game);
    game.cancelEnemyAttackRequest?.(this);
    game.completeEnemyAttack?.(this);
    game.endFlamethrowerEffect?.(this);
    this.clearNavigationRecoveryTarget?.();
    this.knockback.set(0, 0, 0);

    const travel = flatDistance(this.root.position, landingPosition);
    const duration = THREE.MathUtils.clamp(
      travel / DETONATOR_KNOCKBACK_SPEED,
      DETONATOR_KNOCKBACK_MIN_DURATION,
      DETONATOR_KNOCKBACK_MAX_DURATION,
    );
    const baseVisualHover = existingMotion?.baseVisualHover
      ?? this.visual.root.userData.baseHoverHeight
      ?? this.visual.root.position.y;
    const baseVisualRotation = existingMotion?.baseVisualRotation?.clone?.()
      ?? this.visual.root.rotation.clone();
    const groundSurfaceAtStart = game.dungeonController?.getSurfaceElevationAt?.(
      this.root.position,
    ) ?? this.root.position.y;
    const relaunchRootLift = THREE.MathUtils.clamp(
      this.root.position.y - groundSurfaceAtStart,
      0.32,
      0.55,
    );
    const relaunchPosition = landingPosition.clone();
    relaunchPosition.y += relaunchRootLift;
    const groundedVisualHeight = Math.min(0.14, Math.max(0.06, this.radius * 0.2));
    const groundedRoll = this.visual.root.rotation.z + Math.PI;
    const motion = {
      redirectedByPlayer: true,
      phase: 'falling',
      phaseTime: 0,
      duration,
      groundedDuration: DETONATOR_GROUNDED_DURATION,
      relaunchDuration: DETONATOR_RELAUNCH_DURATION,
      startPosition: this.root.position.clone(),
      landingPosition,
      relaunchPosition,
      launchDirection: launchDirection.clone(),
      collisionOffset: startCollisionOffset,
      fallStartCollisionOffset: startCollisionOffset,
      baseVisualHover,
      baseVisualRotation,
      fallVisualStartY: this.visual.root.position.y,
      fallVisualStartRoll: this.visual.root.rotation.z,
      groundedVisualHeight,
      groundedRoll,
      playerCollisionArmed: true,
      playerOverlapGraceRemaining: 0,
      detonated: false,
      redirectCount: (existingMotion?.redirectCount ?? 0) + 1,
    };
    tempA.copy(this.root.position);
    tempA.y += startCollisionOffset;
    const startsOverlappingPlayer = !game.player.dead
      && sphereIntersectsTargetCapsule({
        center: tempA,
        radius: Math.max(0.2, this.radius * 0.72),
        target: game.player,
      });
    if (startsOverlappingPlayer) {
      motion.playerCollisionArmed = false;
      motion.playerOverlapGraceRemaining = DETONATOR_PLAYER_OVERLAP_GRACE;
    }

    this.brain.detonatorKnockback = motion;
    this.brain.state = 'recovery';
    this.brain.stateTime = 0;
    this.brain.moving = false;
    this.brain.speedRatio = 0;
    this.brain.attackFired = true;
    this.brain.attackHit = false;
    this.brain.cooldown = Math.max(this.brain.cooldown, this.stats.attackCooldown);
    this.brain.contactCooldown = Math.max(
      this.brain.contactCooldown,
      duration + DETONATOR_GROUNDED_DURATION + DETONATOR_RELAUNCH_DURATION,
    );
    game.addParticleBurst?.(meta.hitPosition ?? this.root.position, this.genome.palette.emissive, 12, 0.1);
    return true;
  }

  _beginClawGuard(resumeState = this.brain.state) {
    const brain = this.brain;
    this._removeTelegraphMarker();
    brain.clawGuardResumeState = resumeState === 'recovery' ? 'recovery' : 'position';
    brain.clawGuardResumeTime = resumeState === 'recovery' ? brain.stateTime : 0;
    brain.state = 'guard';
    brain.stateTime = 0;
    brain.clawGuardTimeRemaining = brain.clawGuardDuration;
    brain.moving = false;
    brain.speedRatio = 0;
    brain.attackFired = false;
    brain.clawSpinProgress = 0;
    brain.weakPointExposed = false;
    this.knockback.set(0, 0, 0);
  }

  _registerClawPalmCounter(meta) {
    const brain = this.brain;
    brain.clawInterruptedAttempt = brain.clawAttackAttempt;
    brain.clawPalmHits += 1;
    brain.weakPointExposed = false;
    meta.clawPalmCounter = true;
    meta.clawPalmHitCount = brain.clawPalmHits;
    if (brain.clawPalmHits >= (this.genome.modules.weapon.palmBreakHitCount ?? 3)) {
      this._destroyClaw(meta);
      return;
    }

    this._removeTelegraphMarker();
    brain.state = 'recoil';
    brain.stateTime = 0;
    brain.cooldown = 0;
    brain.moving = false;
    brain.speedRatio = 0;
    brain.attackFired = false;
    brain.clawSpinProgress = 0;
    this.knockback.set(0, 0, 0);
    const game = this._runtimeGame;
    game?.completeEnemyAttack?.(this);
    this.visual.weakPoint.core.getWorldPosition(tempA);
    game?.addParticleBurst?.(tempA, RUSH_WARNING_COLOR_HEX, 18, 0.13);
    game?.addHitEffect?.(tempA, RUSH_WARNING_COLOR_HEX, 0.9, { absolute: true });
  }

  _destroyClaw(meta) {
    const brain = this.brain;
    brain.clawDestroyed = true;
    brain.weakPointExposed = false;
    brain.clawAttackVariant = null;
    brain.clawSpinProgress = 0;
    brain.state = 'position';
    brain.stateTime = 0;
    brain.cooldown = 0;
    brain.moving = false;
    brain.speedRatio = 0;
    this.weakPointBroken = true;
    this.brokenWeaponModuleId = 'clawArm';
    meta.weakPointBroken = true;
    meta.brokenWeaponModuleId = 'clawArm';
    this._removeTelegraphMarker();
    this.knockback.set(0, 0, 0);

    const game = this._runtimeGame;
    game?.completeEnemyAttack?.(this);
    this.visual.weakPoint.core.getWorldPosition(tempA);
    game?.addParticleBurst?.(tempA, RUSH_WARNING_COLOR_HEX, 32, 0.2);
    game?.addHitEffect?.(tempA, RUSH_WARNING_COLOR_HEX, 1.25, { absolute: true });
    game?.ui?.showToast?.('Claw destroyed — charge system exposed', '#ff705c');

    if (!this.dead) {
      super.takeDamage(
        this.stats.maxHealth * (this.genome.modules.weapon.clawBreakDamageMaxHealthScale ?? 0.35),
        {
          source: game?.player ?? null,
          playerOwnedAttack: true,
          directHit: true,
          attackKind: 'clawBreakDetonation',
          armorPierce: Number.POSITIVE_INFINITY,
          unblockable: true,
          clawBreakSelfDamage: true,
        },
      );
    }
  }

  _handleControllerTagged(meta) {
    if (this.genome.archetypeId !== 'tractorController'
      || meta.statusTick
      || meta.tractorCrashSelfDamage) {
      return;
    }

    const game = this._runtimeGame;
    const damageSource = meta.source ?? null;
    const taggedByPlayer = damageSource === game?.player
      || damageSource?.owner === game?.player
      || damageSource?.source === game?.player
      || meta.playerOwnedAttack === true;
    if (!taggedByPlayer) return;

    const brain = this.brain;
    if (!brain.tractorCrashPhase) {
      brain.controllerTagPause = Math.max(
        brain.controllerTagPause,
        TRACTOR_TAG_PAUSE_DURATION,
      );
    }

    const target = brain.tractorTarget;
    const interruptibleAbduction = (brain.state === 'telegraph' || brain.state === 'commit')
      && target?.hasExternalControl?.(this);
    if (!interruptibleAbduction) return;

    brain.controllerTagPause = 0;
    if (brain.tractorTargetKind === 'player') {
      // Tagging a solo Controller is the player's escape valve. MegaMan is
      // dropped through the same collision-checked release path, while the
      // destabilized Controller falls and must relaunch before it can try
      // another beam. Enemy-cargo collision damage never routes through the
      // Player object.
      this._releaseTractorTarget('controller-tagged-during-player-abduction', game);
      if (!this.dead) this._beginTractorCrash(game);
      return;
    }
    const cargoDamage = Math.max(
      18,
      (target.stats?.maxHealth ?? target.health ?? 30) * 0.42,
      this.stats.damage * 3.2,
    );
    if (game?.damageEnemy) {
      game.damageEnemy(target, cargoDamage, {
        source: this,
        attackKind: 'tractorAbductionCrash',
        directHit: true,
        unblockable: true,
        armorPierce: 999,
        powerfulKnockback: true,
      });
    } else if (!target.dead) {
      target.takeDamage?.(cargoDamage, {
        source: this,
        attackKind: 'tractorAbductionCrash',
        directHit: true,
        unblockable: true,
        armorPierce: 999,
      });
    }

    // Release after applying the collision damage so a lethal cargo hit is
    // resolved at its actual suspended position. Survivors then fall from the
    // magnet through the existing collision-checked release path.
    this._releaseTractorTarget('controller-tagged-during-abduction', game);

    if (this.dead) return;
    const controllerCrashDamage = Math.max(16, this.stats.maxHealth * 0.38);
    if (game?.damageEnemy) {
      game.damageEnemy(this, controllerCrashDamage, {
        source: game.player,
        attackKind: 'tractorAbductionCrash',
        directHit: true,
        unblockable: true,
        armorPierce: 999,
        tractorCrashSelfDamage: true,
      });
    } else {
      super.takeDamage(controllerCrashDamage, {
        directHit: true,
        unblockable: true,
        armorPierce: 999,
      });
    }

    if (!this.dead) {
      this._beginTractorCrash(game);
    }
  }

  _beginTractorCrash(game) {
    const brain = this.brain;
    this._removeTelegraphMarker();
    this._resetTractorApproach();
    brain.tractorCrashPhase = 'falling';
    brain.tractorCrashTimer = 0;
    brain.tractorCrashStart.copy(this.root.position);
    brain.tractorCrashLanding.copy(this.root.position);
    brain.tractorCrashLanding.y = game?.dungeonController?.getSurfaceElevationAt?.(
      brain.tractorCrashLanding,
    ) ?? game?.player?.root?.position?.y ?? 0;
    brain.state = 'crash';
    brain.stateTime = 0;
    brain.moving = false;
    brain.speedRatio = 0;
    brain.tractorBeamActive = false;
    brain.tractorBeamIntensity = 0;
    this.knockback.set(0, 0, 0);
    game?.addParticleBurst?.(this.root.position, TRACTOR_BEAM_COLOR, 18, 0.16);
    game?.addHitEffect?.(this.root.position, TRACTOR_BEAM_COLOR, 0.9, { absolute: true });
  }

  shouldIgnoreGroundConstraint() {
    return super.shouldIgnoreGroundConstraint()
      || Boolean(this.brain?.detonatorKnockback)
      || Boolean(this.brain?.tractorCrashPhase)
      || Boolean(this.brain?.coilBounceActive)
      || Boolean(this.brain?.clawVaultActive)
      || (this._usesSpringLocomotion()
        && this.brain?.state === 'commit'
        && this.genome.modules.weapon.attackKind === 'pounce');
  }

  modifyDamageTaken(amount, meta = {}) {
    if (meta.clawBreakSelfDamage) return amount;
    let adjusted = super.modifyDamageTaken(amount, meta);
    const weakPoint = this.genome.modules.weakPoint;
    const weakPointHit = meta.hitPartId === weakPoint.id && this.brain.weakPointExposed;
    const directHit = meta.projectileHit || meta.directHit;
    const defense = this.genome.modules.defense;
    const passiveArmorOpening = weakPointHit
      && (defense?.id === 'armoredBack' || defense?.id === 'armoredCarapace');

    if (this._shouldBlockWithClaw(meta)) {
      meta.shieldBlocked = true;
      meta.damageNullified = true;
      meta.defensePartId = 'clawArmGuard';
      const blocker = this.visual.weapon.clawPalmBackAnchor
        ?? this.visual.weapon.clawPalmAnchor
        ?? this.visual.weapon.group
        ?? this.visual.weakPoint.core;
      meta.hitPosition = blocker.getWorldPosition(new THREE.Vector3());
      this.brain.clawGuardTimeRemaining = this.brain.clawGuardDuration;
      this.brain.moving = false;
      this.brain.speedRatio = 0;
      this.knockback.set(0, 0, 0);
      meta.knockbackDirection = null;
      meta.knockback = 0;
      return 0;
    }

    const defenseMultiplier = !meta.unblockable
      && directHit
      && defense
      && !this.defenseDisabled
      && this.brain.defenseActive
      && !passiveArmorOpening
      ? this._getDefenseDamageMultiplier(meta, defense)
      : 1;

    if (defenseMultiplier < 1) {
      meta.shieldBlocked = true;
      meta.defensePartId = defense.id;
      meta.weakPointDefended = weakPointHit;
      const blocker = this.visual.defense.primaryPlate ?? this.visual.defense.group;
      meta.hitPosition = blocker.getWorldPosition(new THREE.Vector3());
      if (defenseMultiplier <= 0.001) {
        meta.damageNullified = true;
        adjusted = 0;
      } else {
        adjusted *= defenseMultiplier;
      }
      return this._applyEliteDamageModifiers(adjusted, meta);
    }

    if (weakPointHit) {
      meta.weakPointHit = true;
      meta.hitPosition = meta.hitPosition ?? this.visual.weakPoint.core.getWorldPosition(new THREE.Vector3());
      adjusted *= weakPoint.multiplier;
      return this._applyEliteDamageModifiers(adjusted, meta);
    }

    return this._applyEliteDamageModifiers(adjusted, meta);
  }

  _shouldBlockWithClaw(meta = {}) {
    if (!this._isClawCarrier()
      || this.brain.clawDestroyed
      || this.brain.state !== 'guard'
      || meta.unblockable
      || !this._isPlayerOwnedHit(meta)) {
      return false;
    }
    const rangedDirectHit = meta.projectileHit
      || (meta.directHit && (meta.attackKind === 'beam' || meta.attackKind === 'rail'));
    if (!rangedDirectHit) return false;

    tempForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)).normalize();
    tempA.copy(meta.knockbackDirection ?? WORLD_FORWARD).setY(0);
    if (tempA.lengthSq() <= 0.0001) return true;
    tempA.normalize();
    return tempForward.dot(tempA) < -0.22;
  }

  _getDefenseDamageMultiplier(meta, defense) {
    tempForward.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)).normalize();
    tempA.copy(meta.knockbackDirection ?? WORLD_FORWARD).setY(0);
    if (tempA.lengthSq() <= 0.0001) tempA.copy(WORLD_FORWARD);
    tempA.normalize();
    const facingDot = tempForward.dot(tempA);
    const frontHit = facingDot < -0.22;
    const rearHit = facingDot > 0.32;
    const sideHit = Math.abs(facingDot) <= 0.42;
    let multiplier = 1;

    switch (defense.id) {
      case 'directionalShield':
      case 'guardArms':
      case 'armoredSkull':
        multiplier = frontHit ? defense.directMultiplier : defense.flankMultiplier;
        break;
      case 'armoredBack':
      case 'armoredCarapace':
        multiplier = rearHit ? defense.directMultiplier : defense.flankMultiplier;
        break;
      case 'sidePlates':
        multiplier = frontHit || sideHit ? defense.directMultiplier : defense.flankMultiplier;
        break;
      case 'phaseShell':
      case 'energyMembrane':
        multiplier = defense.directMultiplier;
        break;
      case 'rotatingPlates': {
        this.visual.defense.guardNormal?.getWorldDirection(tempB);
        tempB.y = 0;
        if (tempB.lengthSq() <= 0.0001) tempB.copy(tempForward);
        tempB.normalize();
        multiplier = tempB.dot(tempA) < -0.32
          ? defense.directMultiplier
          : defense.flankMultiplier;
        break;
      }
      case 'armorShutters':
      case 'reactivePlate':
        multiplier = frontHit ? defense.directMultiplier : defense.flankMultiplier;
        break;
      default:
        break;
    }

    return multiplier;
  }

  onHitPlayer(player, dealt = 0) {
    if (this.genome.modules.weapon.id === 'arcEmitter' && dealt > 0) {
      player.applySlow?.(0.76, 0.48);
    }
    if (this.affix?.id === 'frostCore' && dealt > 0) {
      player.applySlow?.(0.55, 1.5);
    }
    if (this.affix?.id === 'corrosive' && dealt > 0) {
      player.takeIncomingHit({
        amount: Math.max(1, dealt * 0.22),
        source: this,
        guardable: false,
        reactionTier: 0,
      });
    }
    return player;
  }

  _enterPostContactRecovery(game) {
    super._enterPostContactRecovery(game);
    const brain = this.brain;
    if (!brain) return;
    this._removeTelegraphMarker();
    this._resetSpringMovementState({ cancelPounce: false });
    brain.state = 'recovery';
    brain.stateTime = 0;
    brain.moving = false;
    brain.speedRatio = 0;
    brain.attackFired = true;
    brain.attackHit = true;
    brain.packAttackIdleTime = 0;
    brain.contactCooldown = Math.max(
      brain.contactCooldown,
      this._getStateDuration('recovery'),
    );
  }

  _updateContactRetreatVisual(dt) {
    const brain = this.brain;
    if (!brain) return;
    brain.time += dt;
    brain.moving = true;
    brain.speedRatio = 1;
    this._updateExposureAndDefense();
    this._animateVisual(dt);
  }

  onDeath(game, meta = {}) {
    game?.cancelEnemyAttackRequest?.(this);
    game?.endFlamethrowerEffect?.(this);
    this._removeTelegraphMarker();
    this._releaseTractorTarget('controller-death', game);
    if (this.affix?.id === 'explosiveCore' && !meta.selfDestruct) {
      game.addExplosion(this.root.position, this.stats.damage * 2.2, 2.25, this.affix.color, {
        source: this,
        suppressRewards: Boolean(meta.suppressRewards),
      });
    }
    if (this.affix?.id === 'burningCore') {
      game.addFireZone(this.root.position, this.stats.damage * 0.5, 2.4, 1.25, { source: this });
    }
    if (this.affix?.id === 'refractorRich') {
      game.addParticleBurst(this.root.position, this.affix.color, 24, 0.22);
    }
  }

  dispose() {
    this._runtimeGame?.cancelEnemyAttackRequest?.(this);
    this._runtimeGame?.endFlamethrowerEffect?.(this);
    this._removeTelegraphMarker();
    this._releaseTractorTarget('controller-dispose');
    this.clearExternalMotion?.('dispose');
    const geometries = new Set();
    const materials = new Set(Object.values(this.visual?.materials ?? {}));
    this.root?.traverse?.((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) {
        if (material) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) material.dispose?.();
  }

  _restoreWeaponizedDetonatorVisual(motion = null) {
    if (!this.visual?.root) return;
    const baseRotation = motion?.baseVisualRotation;
    if (baseRotation) this.visual.root.rotation.copy(baseRotation);
    else {
      this.visual.root.rotation.x = 0;
      this.visual.root.rotation.z = 0;
    }
    this.visual.root.position.y = motion?.baseVisualHover
      ?? this.visual.root.userData.baseHoverHeight
      ?? this.hoverHeight;
  }

  _applyWeaponizedDetonatorPhaseTransform(motion) {
    if (motion.phase === 'falling') {
      const progress = clamp01(motion.phaseTime / Math.max(0.01, motion.duration));
      this.root.position.lerpVectors(motion.startPosition, motion.landingPosition, progress);
      this.root.position.y += Math.sin(progress * Math.PI) * DETONATOR_KNOCKBACK_ARC_HEIGHT;
      motion.collisionOffset = THREE.MathUtils.lerp(
        motion.fallStartCollisionOffset,
        DETONATOR_GROUNDED_COLLISION_OFFSET,
        progress,
      );
      return;
    }
    if (motion.phase === 'grounded') {
      this.root.position.copy(motion.landingPosition);
      motion.collisionOffset = DETONATOR_GROUNDED_COLLISION_OFFSET;
      return;
    }
    const progress = clamp01(
      motion.phaseTime / Math.max(0.01, motion.relaunchDuration),
    );
    const eased = THREE.MathUtils.smootherstep(progress, 0, 1);
    this.root.position.lerpVectors(motion.landingPosition, motion.relaunchPosition, eased);
    motion.collisionOffset = THREE.MathUtils.lerp(
      DETONATOR_GROUNDED_COLLISION_OFFSET,
      Math.max(DETONATOR_GROUNDED_COLLISION_OFFSET, this.combatAimOffset),
      eased,
    );
  }

  _applyWeaponizedDetonatorVisual(motion) {
    const visualRoot = this.visual?.root;
    if (!visualRoot) return;
    visualRoot.rotation.x = motion.baseVisualRotation.x;
    visualRoot.rotation.y = motion.baseVisualRotation.y;
    if (motion.phase === 'falling') {
      const progress = THREE.MathUtils.smootherstep(
        clamp01(motion.phaseTime / Math.max(0.01, motion.duration)),
        0,
        1,
      );
      visualRoot.position.y = THREE.MathUtils.lerp(
        motion.fallVisualStartY,
        motion.groundedVisualHeight,
        progress,
      );
      visualRoot.rotation.z = THREE.MathUtils.lerp(
        motion.fallVisualStartRoll,
        motion.groundedRoll,
        progress,
      );
      return;
    }
    if (motion.phase === 'grounded') {
      visualRoot.position.y = motion.groundedVisualHeight;
      visualRoot.rotation.z = motion.groundedRoll;
      return;
    }
    const progress = THREE.MathUtils.smootherstep(
      clamp01(motion.phaseTime / Math.max(0.01, motion.relaunchDuration)),
      0,
      1,
    );
    visualRoot.position.y = THREE.MathUtils.lerp(
      motion.groundedVisualHeight,
      motion.baseVisualHover,
      progress,
    );
    visualRoot.rotation.z = THREE.MathUtils.lerp(
      motion.groundedRoll,
      motion.groundedRoll + Math.PI,
      progress,
    );
  }

  _findWeaponizedDetonatorImpact(
    game,
    startCenter,
    endCenter,
    { ignorePlayer = false } = {},
  ) {
    const collisionRadius = Math.max(0.2, this.radius * 0.72);
    let earliest = null;
    const consider = (target) => {
      if (!target?.root || target.dead || target === this) return;
      if (ignorePlayer && target === game.player) return;
      const fraction = findStraightBusterCapsuleHitFraction(
        startCenter,
        endCenter,
        target,
        collisionRadius,
      );
      if (fraction == null) return;
      const stableTargetId = String(target.id ?? (target === game.player ? 'player' : ''));
      if (!earliest
        || fraction < earliest.fraction - 0.000001
        || (Math.abs(fraction - earliest.fraction) <= 0.000001
          && stableTargetId < earliest.stableTargetId)) {
        earliest = { target, fraction, stableTargetId };
      }
    };
    for (const enemy of game.enemies ?? []) consider(enemy);
    consider(game.player);
    return earliest;
  }

  _detonateWeaponizedDetonator(game, impactTarget, impactPosition) {
    const motion = this.brain?.detonatorKnockback;
    if (!motion || motion.detonated || this.dead) return false;
    motion.detonated = true;
    motion.impactTargetId = impactTarget?.id ?? null;

    const radius = this.genome.modules.weapon.explosiveRadius ?? 3;
    const damage = this.stats.damage * 1.55;
    const impact = {
      position: impactPosition.clone(),
      direction: motion.launchDirection.clone(),
      damage,
      radius,
    };
    // Boss shields receive the physical impact first. An absorbed response
    // consumes that direct collision, while the surrounding blast remains
    // active for the player and every other enemy in range.
    const impactResult = impactTarget?.onWeaponizedDetonatorImpact?.(
      this,
      game,
      impact,
    ) ?? null;
    const excludedEnemyIds = [this.id];
    if ((impactResult?.absorbed || impactResult?.excludeFromExplosion)
      && impactTarget?.id != null) {
      excludedEnemyIds.push(impactTarget.id);
    }

    game.addExplosion(impactPosition, damage, radius, this.genome.palette.emissive, {
      source: this,
      attackKind: 'weaponizedDetonator',
      weaponizedDetonator: true,
      damageEnemies: true,
      damagePlayer: true,
      playerDamageScale: 1,
      targetGeometry: 'verticalCapsule',
      excludedEnemyIds,
      suppressRewards: true,
      triggerMines: false,
      powerfulKnockback: true,
      knockbackStrength: 1.18,
    });
    game.damageEnemy(this, this.health + this.stats.maxHealth, {
      source: this,
      attackKind: 'weaponizedDetonator',
      weaponizedDetonator: true,
      selfDestruct: true,
      suppressRewards: true,
      unblockable: true,
      statusTick: true,
    });
    if (!this.dead) this.brain.detonatorKnockback = null;
    this._removeTelegraphMarker();
    return true;
  }

  _updateWeaponizedDetonatorKnockback(dt, game) {
    const motion = this.brain.detonatorKnockback;
    if (!motion || this.dead) return false;
    let remaining = Math.max(0, dt);
    let completedRelaunch = false;

    // Substep the authored arc so a low frame rate cannot tunnel the launched
    // capsule through a player, minion, or boss shield.
    for (let iteration = 0; iteration < 256 && remaining > 0.000001; iteration += 1) {
      const phaseDuration = motion.phase === 'falling'
        ? motion.duration
        : motion.phase === 'grounded'
          ? motion.groundedDuration
          : motion.relaunchDuration;
      const phaseRemaining = Math.max(0, phaseDuration - motion.phaseTime);
      if (phaseRemaining <= 0.000001) {
        if (motion.phase === 'falling') {
          motion.phase = 'grounded';
          motion.phaseTime = 0;
          this.root.position.copy(motion.landingPosition);
          motion.collisionOffset = DETONATOR_GROUNDED_COLLISION_OFFSET;
          continue;
        }
        if (motion.phase === 'grounded') {
          motion.phase = 'relaunching';
          motion.phaseTime = 0;
          continue;
        }
        completedRelaunch = true;
        break;
      }

      const step = Math.min(remaining, phaseRemaining, 1 / 60);
      const previousRoot = this.root.position.clone();
      const previousCenter = previousRoot.clone();
      previousCenter.y += motion.collisionOffset;
      const ignorePlayerForSegment = !motion.playerCollisionArmed;

      motion.phaseTime += step;
      this._applyWeaponizedDetonatorPhaseTransform(motion);
      const currentCenter = this.root.position.clone();
      currentCenter.y += motion.collisionOffset;

      if (!motion.playerCollisionArmed) {
        motion.playerOverlapGraceRemaining = Math.max(
          0,
          motion.playerOverlapGraceRemaining - step,
        );
        const stillOverlappingPlayer = !game.player.dead
          && sphereIntersectsTargetCapsule({
            center: currentCenter,
            radius: Math.max(0.2, this.radius * 0.72),
            target: game.player,
          });
        if (motion.playerOverlapGraceRemaining <= 0 && !stillOverlappingPlayer) {
          motion.playerCollisionArmed = true;
        }
      }

      const impact = this._findWeaponizedDetonatorImpact(
        game,
        previousCenter,
        currentCenter,
        { ignorePlayer: ignorePlayerForSegment },
      );
      if (impact) {
        this.root.position.lerpVectors(previousRoot, this.root.position, impact.fraction);
        tempA.lerpVectors(previousCenter, currentCenter, impact.fraction);
        this._detonateWeaponizedDetonator(game, impact.target, tempA);
        return true;
      }

      remaining -= step;
      if (motion.phaseTime >= phaseDuration - 0.000001) {
        if (motion.phase === 'falling') {
          motion.phase = 'grounded';
          motion.phaseTime = 0;
          this.root.position.copy(motion.landingPosition);
          motion.collisionOffset = DETONATOR_GROUNDED_COLLISION_OFFSET;
        } else if (motion.phase === 'grounded') {
          motion.phase = 'relaunching';
          motion.phaseTime = 0;
        } else {
          completedRelaunch = true;
          break;
        }
      }
    }

    this.brain.moving = false;
    this.brain.speedRatio = 0;
    this._updateExposureAndDefense();
    this._animateVisual(dt);
    this._applyWeaponizedDetonatorVisual(motion);

    if (completedRelaunch) {
      this.root.position.copy(motion.relaunchPosition);
      this._restoreWeaponizedDetonatorVisual(motion);
      this.brain.detonatorKnockback = null;
      this.brain.state = 'position';
      this.brain.stateTime = 0;
      this.brain.moving = false;
      this.brain.speedRatio = 0;
      this.brain.attackFired = false;
      this.brain.attackHit = false;
      this.brain.cooldown = Math.max(this.brain.cooldown, this.stats.attackCooldown * 0.72);
    }
    return true;
  }

  _updateCustomBehavior(dt, game) {
    const brain = this.brain;
    brain.time += dt;

    if (this.pendingWeakPointBreakEffect) {
      this.pendingWeakPointBreakEffect = false;
      this.visual.weakPoint.core.getWorldPosition(tempA);
      game.addParticleBurst(tempA, this.genome.palette.emissive, 22, 0.14);
      game.addHitEffect(tempA, this.genome.palette.emissive, 0.85, { absolute: true });
      game.ui?.showToast?.(`${this.genome.modules.weakPoint.label} ruptured — defense disabled`, '#ffd36f');
    }

    if (brain.detonatorKnockback) {
      this._updateWeaponizedDetonatorKnockback(dt, game);
      return { handled: true, moving: false, moveAmount: 0 };
    }

    if (game.dungeonController?.isPlayerInSafeZone?.() || game.player.dead) {
      game.cancelEnemyAttackRequest?.(this);
      this._releaseTractorTarget('safe-zone', game);
      brain.tractorBeamActive = false;
      brain.moving = false;
      this._updateExposureAndDefense();
      this._animateVisual(dt);
      return { handled: true, moving: false };
    }

    if (this.genome.archetypeId === 'packHunter') {
      brain.packAttackIdleTime += dt;
    }

    if (brain.state === 'eyeRefocus') {
      this._updateEyeRefocusState(dt);
      this._updateExposureAndDefense();
      this._animateVisual(dt);
      return { handled: true, moving: false, moveAmount: 0 };
    }

    this._updatePersistentWeaponContact(dt, game);
    if (this.contactRetreatMotion) {
      this._updateExposureAndDefense();
      this._animateVisual(dt);
      return { handled: true, moving: false, moveAmount: 0 };
    }

    const effectiveAttackKind = this._getEffectiveAttackKind();
    if (effectiveAttackKind === 'jawCombo') {
      // A crusher jaw extends several metres in front of a comparatively
      // compact quadruped body. Keep the body outside the player's footprint
      // so the visible mouth cannot overshoot MegaMan from an invalid overlap.
      this._resolveJawPlayerOverlap(dt, game);
    }

    if (this._isControlLocked()) {
      if (brain.state === 'telegraph' || brain.state === 'commit') {
        if (this.genome.archetypeId === 'tractorController') {
          this._abortTractorCycle('control-interrupt', game);
        } else {
          this._removeTelegraphMarker();
          brain.state = 'recovery';
          brain.stateTime = 0;
          brain.attackFired = true;
          brain.attackHit = false;
          brain.contactCooldown = Math.max(brain.contactCooldown, this._getStateDuration('recovery'));
          game.completeEnemyAttack?.(this);
        }
      }
      brain.moving = false;
      brain.speedRatio = 0;
      this._updateExposureAndDefense();
      this._animateVisual(dt);
      return { handled: true, moving: false };
    }

    if (this.hitStopTimer > 0) {
      brain.moving = false;
      this._updateExposureAndDefense();
      this._animateVisual(dt);
      return { handled: true, moving: false };
    }

    if (this.genome.archetypeId === 'tractorController') {
      return this._updateTractorController(dt, game);
    }

    if (brain.state === 'guard') {
      this._updateClawGuardState(dt);
      this._updateExposureAndDefense();
      this._animateVisual(dt);
      return { handled: true, moving: false, moveAmount: 0 };
    }
    if (brain.state === 'recoil') {
      this._updateClawRecoilState(dt);
      this._updateExposureAndDefense();
      this._animateVisual(dt);
      return { handled: true, moving: false, moveAmount: 0 };
    }

    tempA.copy(game.player.root.position).sub(this.root.position).setY(0);
    const distance = tempA.length();
    if (distance > 0.001) tempA.divideScalar(distance);
    else tempA.copy(WORLD_FORWARD);

    if (brain.state !== 'commit'
      || !['charge', 'pounce', 'clawMoveset'].includes(effectiveAttackKind)) {
      this._turnToward(tempA, dt, this.genome.behavior.turnRate);
    }

    if (brain.state === 'position') {
      this._updatePositionState(dt, game, tempA, distance);
    } else if (brain.state === 'telegraph') {
      this._updateTelegraphState(dt, game, tempA);
    } else if (brain.state === 'commit') {
      this._updateCommitState(dt, game);
    } else if (brain.state === 'recovery') {
      this._updateRecoveryState(dt, game);
    }

    this._updateExposureAndDefense();
    this._animateVisual(dt);
    this._updateTelegraphMarker(game);
    return { handled: true, moving: brain.moving, moveAmount: brain.speedRatio };
  }

  _updatePositionState(dt, game, toPlayer, distance) {
    const brain = this.brain;
    const archetype = this.genome.archetypeId;
    const attackKind = this._getEffectiveAttackKind();
    const usesPackFlanking = archetype === 'packHunter' && attackKind !== 'jawCombo';
    const clawFallback = this._isClawCarrier() && brain.clawDestroyed;
    brain.cooldown = Math.max(0, brain.cooldown - dt * this._getStatusAttackRateMultiplier());

    const aggroRange = this.genome.behavior.aggroRange ?? 14;
    if (!brain.alerted && distance > aggroRange) {
      brain.moving = false;
      brain.speedRatio = 0;
      return;
    }
    brain.alerted = true;

    let mode = 'hold';
    const preferred = this.genome.behavior.preferredRange;
    if (clawFallback) {
      mode = distance < 1.35 ? 'retreat' : 'approach';
    } else if (attackKind === 'clawMoveset') {
      mode = distance > Math.max(2.2, preferred) ? 'approach' : 'orbit';
    } else if (attackKind === 'jawCombo') {
      // Jaw carriers behave like vicious mechanical dogs regardless of their
      // broader spawn role: close fast, then strafe and hop in a tight circle.
      mode = distance > Math.max(2.65, preferred + 0.35) ? 'approach' : 'jawOrbit';
    } else if (usesPackFlanking) {
      mode = 'flank';
    } else if (archetype === 'pursuer') {
      mode = distance > Math.max(1.15, preferred) ? 'approach' : 'hold';
    } else if (archetype === 'shieldSentinel') {
      mode = 'hold';
    } else if (archetype === 'pouncer') {
      const pounceApproachRange = attackKind === 'pounce'
        ? Math.max(6.1, this.stats.attackRange - 0.35)
        : 6.1;
      mode = distance < 3 ? 'retreat' : distance > pounceApproachRange ? 'approach' : 'orbit';
    } else if (archetype === 'artillery') {
      mode = distance < 3.7 ? 'retreat' : distance > preferred + 1.1 ? 'approachSlow' : 'orbitSlow';
    } else if (archetype === 'zoneController') {
      mode = distance < 3.2 ? 'retreat' : distance > preferred + 0.9 ? 'approachSlow' : 'orbit';
    } else if (archetype === 'rotorHunter') {
      mode = distance > 1.6 ? 'approach' : 'orbit';
    } else if (archetype === 'aerialBomber') {
      mode = 'approachSlow';
    } else {
      mode = distance < 1.7 ? 'retreat' : distance > preferred + 0.6 ? 'approach' : 'orbit';
    }

    const attackDistance = this.navigationMode === 'air'
      ? this.root.position.distanceTo(game.player.root.position)
      : distance;
    const attackInRange = this._isAttackDistance(attackDistance);
    if (attackKind === 'charge'
      && !this.genome.modules.weapon.continuousContactDamage
      && attackDistance < CHARGE_MINIMUM_INITIATION_RANGE) {
      // A committed ram needs a small launch lane. If navigation or player
      // movement collapses that lane, back out just far enough to regain the
      // valid charge envelope instead of idling in body contact.
      mode = 'retreat';
    }
    // Once an attacker reaches a valid firing/commit envelope, hold that
    // envelope while its cooldown or attack-director lease resolves. Closing
    // farther or retreating away would only delay the authored telegraph and
    // can substitute incidental body contact for the real attack.
    if (attackInRange && ['approach', 'approachSlow', 'retreat'].includes(mode)) {
      mode = 'hold';
    }
    const forcedPackAttack = usesPackFlanking
      && brain.packAttackIdleTime >= (this.genome.behavior.forcedAttackSeconds ?? 15);
    const flankAttackReady = !usesPackFlanking
      || forcedPackAttack
      || this._isPlayerFlankExposed(game);
    const readyToAttack = (brain.cooldown <= 0 || forcedPackAttack)
      && flankAttackReady
      && attackInRange
      && this._canBeginAttack(game);
    // Any attacker with a valid lease commits immediately from attack range.
    // This also prevents a spring hop, claw vault, or final approach step from
    // displacing the telegraph after the attack is already legal.
    if (readyToAttack && !brain.coilBounceActive && !brain.clawVaultActive) {
      brain.moving = false;
      brain.speedRatio = 0;
      this._beginTelegraph(game, toPlayer);
      return;
    }

    if (this._isClawCarrier() && !clawFallback && mode === 'approach') {
      brain.moving = this._updateClawDragAndVault(
        dt,
        game,
        0,
        this._getAttackApproachRange(),
      );
    } else {
      brain.moving = usesPackFlanking
        ? this._movePackHunterTowardFlank(dt, game)
        : this._moveByMode(mode, dt, game, toPlayer, distance);
    }
    brain.speedRatio = brain.moving ? (mode.includes('Slow') ? 0.55 : 1) : 0;

  }

  _updateTelegraphState(dt, game, toPlayer) {
    const brain = this.brain;
    const weapon = this.genome.modules.weapon;
    const kind = this._getEffectiveAttackKind();
    brain.stateTime += dt;
    brain.moving = false;
    const telegraphDuration = this._getStateDuration('telegraph');
    const telegraphProgress = clamp01(brain.stateTime / Math.max(0.01, telegraphDuration));

    // Charges track during the early warning, then lock so the final rapid blinks
    // communicate a committed line the player can evade.
    if (kind === 'charge' && telegraphProgress < CHARGE_TRACK_LOCK_PROGRESS) {
      // _isAerialRootPathClear uses tempD/tempE internally, so preserve the
      // last valid commitment in independent vectors before probing a new one.
      tempG.copy(brain.attackDirection);
      tempH.copy(brain.targetPosition);
      brain.attackDirection.lerp(toPlayer, Math.min(1, dt * 4.2)).normalize();
      brain.targetPosition.copy(this.root.position).addScaledVector(
        brain.attackDirection,
        CHARGE_TRAVEL_DISTANCE,
      );
      if (this.navigationMode === 'ground') {
        brain.targetPosition.y = game.dungeonController?.getSurfaceElevationAt?.(brain.targetPosition)
          ?? brain.targetPosition.y;
        this._clampCommitTargetToWalkablePath(game, brain.targetPosition);
      } else {
        brain.targetPosition.y = game.player.root.position.y + 0.9;
        // If the player ducks behind a wall during tracking, retain the last
        // clear committed line rather than telegraphing a charge through it.
        if (!this._isAerialRootPathClear(game, brain.targetPosition)) {
          brain.attackDirection.copy(tempG);
          brain.targetPosition.copy(tempH);
        }
      }
    } else if (kind === 'jawCombo' || kind === 'clawMoveset') {
      brain.attackDirection.lerp(toPlayer, Math.min(1, dt * 7.5)).normalize();
    }
    this._turnToward(
      kind === 'charge' ? brain.attackDirection : toPlayer,
      dt,
      this.genome.behavior.turnRate * 0.72,
    );

    brain.effectTimer -= dt;
    if (brain.effectTimer <= 0) {
      const rushAttack = kind === 'charge' || kind === 'pounce' || kind === 'clawMoveset';
      brain.effectTimer = rushAttack ? THREE.MathUtils.lerp(0.18, 0.045, telegraphProgress) : 0.11;
      if (['charge', 'pounce', 'melee', 'clawMoveset', 'flamethrower', 'beam'].includes(kind)) {
        const halfAngle = kind === 'beam'
          ? 0.07
          : kind === 'flamethrower'
            ? 0.78
            : kind === 'pounce'
              ? 0.24
              : kind === 'jawCombo'
                ? 0.58
                : kind === 'clawMoveset'
                  ? Math.PI
              : 0.32;
        const range = kind === 'beam'
          ? this.stats.attackRange
          : kind === 'charge' || kind === 'pounce'
            ? flatDistance(this.root.position, brain.targetPosition)
            : Math.min(this.stats.attackRange, 4.8);
        const telegraphDirection = brain.attackDirection;
        game.addGroundConeTelegraph(this.root.position, telegraphDirection, range, halfAngle, (rushAttack || kind === 'jawCombo') ? RUSH_WARNING_COLOR_HEX : this.genome.palette.emissive, {
          duration: 0.16,
          opacity: kind === 'beam' ? 0.28 : 0.22,
          name: `generatedReaverbot${kind}Telegraph`,
        });
      }
      this.visual.weapon.muzzle.getWorldPosition(tempB);
      game.addParticleBurst(tempB, (rushAttack || kind === 'jawCombo') ? RUSH_WARNING_COLOR_HEX : this.genome.palette.emissive, 2, 0.055);
    }

    if (brain.stateTime >= telegraphDuration) {
      brain.state = 'commit';
      brain.stateTime = 0;
      if (this.genome.archetypeId === 'packHunter') {
        brain.packAttackIdleTime = 0;
        brain.packFlankRearBias = this.aiRandom.float(
          this.genome.behavior.flankRearBiasMin ?? 0.28,
          this.genome.behavior.flankRearBiasMax ?? 0.78,
        );
      }
      brain.attackFired = false;
      brain.attackHit = false;
      brain.comboStrikesFired = 0;
      brain.jawHopTravel.fill(0);
      brain.tickTimer = 0;
      brain.commitStart.copy(this.root.position);
      if (kind === 'charge') {
        brain.commitDistance = this.navigationMode === 'air'
          ? brain.commitStart.distanceTo(brain.targetPosition)
          : flatDistance(brain.commitStart, brain.targetPosition);
        brain.chargeDistanceTravelled = 0;
      }
      if (kind === 'clawMoveset') {
        brain.attackDirection.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)).normalize();
      }
    }
  }

  _updateCommitState(dt, game) {
    const brain = this.brain;
    const kind = this._getEffectiveAttackKind();
    const stateTimeBeforeUpdate = brain.stateTime;
    brain.stateTime += dt;
    const duration = Math.max(0.08, this._getStateDuration('commit'));
    const progress = clamp01(brain.stateTime / duration);
    brain.moving = ['charge', 'pounce', 'jawCombo'].includes(kind);
    brain.speedRatio = brain.moving ? 1.4 : 0;

    const finishMovingCommit = () => {
      this._removeTelegraphMarker();
      brain.state = 'recovery';
      brain.stateTime = 0;
      brain.moving = false;
      brain.speedRatio = 0;
      brain.contactCooldown = Math.max(brain.contactCooldown, this._getStateDuration('recovery'));
      game.completeEnemyAttack?.(this);
    };

    if (kind === 'charge') {
      // The dungeon's footprint constraint can roll a center-valid step back
      // after this update. Measure retained displacement and keep time as an
      // independent hard stop so a pinned charger cannot hold the attack lease.
      const actualTravelDistance = this.navigationMode === 'air'
        ? brain.commitStart.distanceTo(this.root.position)
        : flatDistance(brain.commitStart, this.root.position);
      brain.chargeDistanceTravelled = Math.max(
        brain.chargeDistanceTravelled,
        actualTravelDistance,
      );

      tempA.copy(brain.targetPosition).sub(this.root.position);
      if (this.navigationMode !== 'air') tempA.setY(0);
      const remainingDistance = tempA.length();
      const remainingChargeDistance = Math.max(
        0,
        CHARGE_TRAVEL_DISTANCE - brain.chargeDistanceTravelled,
      );
      const chargeTimeThisFrame = Math.min(
        Math.max(0, dt),
        Math.max(0, duration - stateTimeBeforeUpdate),
      );
      if (remainingDistance <= 0.0001
        || remainingChargeDistance <= 0.0001
        || chargeTimeThisFrame <= 0) {
        finishMovingCommit();
        return;
      }

      const stepDistance = Math.min(
        remainingDistance,
        remainingChargeDistance,
        CHARGE_TRAVEL_SPEED * chargeTimeThisFrame,
      );
      if (stepDistance > 0) {
        tempA.divideScalar(remainingDistance);
        const nextX = this.root.position.x + tempA.x * stepDistance;
        const nextY = this.root.position.y + tempA.y * stepDistance;
        const nextZ = this.root.position.z + tempA.z * stepDistance;
        if (!this._moveCommitAlongWalkablePath(game, nextX, nextZ, nextY)) {
          finishMovingCommit();
          return;
        }
        const travelledAfterMove = this.navigationMode === 'air'
          ? brain.commitStart.distanceTo(this.root.position)
          : flatDistance(brain.commitStart, this.root.position);
        brain.chargeDistanceTravelled = Math.max(
          brain.chargeDistanceTravelled,
          travelledAfterMove,
        );
      }

      if (!this.genome.modules.weapon.continuousContactDamage) {
        this._tryContactHit(game, 0.5);
        if (this.contactRetreatMotion) return;
      }
      this._emitChargeJetTrail(dt, game);
      if (stepDistance >= remainingDistance - 0.0001
        || brain.chargeDistanceTravelled >= CHARGE_TRAVEL_DISTANCE - 0.0001
        || brain.stateTime >= duration) {
        finishMovingCommit();
      }
      return;
    }

    if (kind === 'pounce') {
      const eased = THREE.MathUtils.smoothstep(progress, 0.05, 0.9);
      const nextX = THREE.MathUtils.lerp(brain.commitStart.x, brain.targetPosition.x, eased);
      const nextY = THREE.MathUtils.lerp(brain.commitStart.y, brain.targetPosition.y, eased);
      const nextZ = THREE.MathUtils.lerp(brain.commitStart.z, brain.targetPosition.z, eased);
      const springPounce = this._usesSpringLocomotion();
      const moved = springPounce
        ? true
        : this._moveCommitAlongWalkablePath(game, nextX, nextZ, nextY);
      if (!moved) {
        finishMovingCommit();
        return;
      }
      if (springPounce) {
        const baseY = THREE.MathUtils.lerp(brain.commitStart.y, brain.targetPosition.y, eased);
        this.root.position.set(
          nextX,
          baseY + Math.sin(progress * Math.PI) * Math.max(
            brain.pounceJumpHeight,
            Math.abs(brain.targetPosition.y - brain.commitStart.y) + 1.3,
          ),
          nextZ,
        );
      }
      if (!this.genome.modules.weapon.continuousContactDamage) {
        const landedThisFrame = progress >= 1;
        this._tryContactHit(game, 0.75);
        if (this.contactRetreatMotion) {
          // A direct hit on the landing frame still completes the pounce's
          // authored ground impact. Contact recovery has already marked the
          // attack as fired, so emit the visual/AOE shell without damaging the
          // player a second time before beginning the backward leap.
          if (landedThisFrame) {
            const landingDamage = this.stats.damage
              * (this.genome.modules.weapon.landingDamageScale ?? 1);
            const landingRadius = this.genome.modules.weapon.landingRadius ?? 1.85;
            game.addExplosion(this.root.position, landingDamage, landingRadius, this.genome.palette.emissive, {
              source: this,
              damageEnemies: false,
              damagePlayer: false,
              playerDamageScale: 1,
              triggerMines: false,
            });
          }
          return;
        }
      }
      if (this.genome.modules.weapon.id === 'launchLeg') {
        this._emitLaunchLegJetTrail(dt, game);
      }
    } else if (kind === 'clawMoveset') {
      this._updateClawMoveset(game, progress);
    } else if (kind === 'jawCombo') {
      this._updateJawCombo(dt, game, progress);
    } else if (kind === 'flamethrower') {
      this._updateFlamethrower(dt, game);
    } else if (!brain.attackFired && progress >= (kind === 'selfDestruct' ? 0.72 : 0.24)) {
      brain.attackFired = true;
      this._fireAttack(game);
    }

    if (brain.stateTime >= duration && !this.dead) {
      if ((kind === 'pounce' || kind === 'shockwave') && !brain.attackFired) {
        brain.attackFired = true;
        const landingDamage = this.stats.damage
          * (this.genome.modules.weapon.landingDamageScale ?? 1);
        const landingRadius = this.genome.modules.weapon.landingRadius ?? 1.85;
        game.addExplosion(this.root.position, landingDamage, landingRadius, this.genome.palette.emissive, {
          source: this,
          damageEnemies: false,
          damagePlayer: kind === 'shockwave' || !brain.attackHit,
          playerDamageScale: 1,
          triggerMines: false,
        });
      }
      if (kind === 'flamethrower') game.endFlamethrowerEffect?.(this);
      this._removeTelegraphMarker();
      brain.state = 'recovery';
      brain.stateTime = 0;
      brain.moving = false;
      brain.contactCooldown = Math.max(brain.contactCooldown, this._getStateDuration('recovery'));
      game.completeEnemyAttack?.(this);
    }
  }

  _updateRecoveryState(dt, game = null) {
    const brain = this.brain;
    const kind = this._getEffectiveAttackKind();
    brain.stateTime += dt;
    const recoveryDuration = this._getStateDuration('recovery');
    const recoveryProgress = clamp01(brain.stateTime / Math.max(0.01, recoveryDuration));
    brain.moving = Boolean(brain.clawVaultActive && game) && this._advanceClawVault(dt);
    if (!brain.moving && game && recoveryProgress < 0.78) {
      tempA.copy(game.player.root.position).sub(this.root.position).setY(0);
      const distance = tempA.length();
      if (distance > 0.001) tempA.divideScalar(distance);
      else tempA.copy(WORLD_FORWARD);
      const retreatSpeedScale = kind === 'charge' ? 1.45 : 1;
      brain.moving = this._moveByMode('retreat', dt * retreatSpeedScale, game, tempA, distance);
    }
    brain.speedRatio = brain.moving ? (kind === 'charge' ? 1.15 : 0.8) : 0;
    if (brain.stateTime >= recoveryDuration) {
      brain.state = 'position';
      brain.stateTime = 0;
      brain.cooldown = this.stats.attackCooldown * this.aiRandom.float(
        kind === 'charge' ? 1.08 : 0.84,
        kind === 'charge' ? 1.34 : 1.16,
      );
      brain.attackFired = false;
      brain.attackHit = false;
      brain.comboStrikesFired = 0;
      brain.jawHopTravel.fill(0);
      brain.clawDragSpeed = 0;
    }
  }

  _beginTelegraph(game, toPlayer) {
    const brain = this.brain;
    const kind = this._getEffectiveAttackKind();
    brain.state = 'telegraph';
    brain.stateTime = 0;
    brain.effectTimer = 0;
    brain.jetTrailTimer = 0;
    brain.warningPhase = 0;
    brain.warningBlinkRate = RUSH_WARNING_MIN_RATE;
    brain.warningIntensity = 0;
    brain.comboStrikesFired = 0;
    brain.clawDragSpeed = 0;
    brain.clawVaultCooldown = 0;
    brain.clawSpinProgress = 0;
    brain.attackDirection.copy(toPlayer).normalize();
    brain.targetPosition.copy(game.player.root.position);

    if (kind === 'clawMoveset') {
      brain.clawAttackVariant = this.aiRandom.chance(0.5) ? 'horizontalSwipe' : 'verticalSlam';
      brain.clawAttackAttempt += 1;
      brain.clawInterruptedAttempt = -1;
      brain.weakPointExposed = true;
    } else if (kind === 'pounce') {
      brain.targetPosition.addScaledVector(game.player.lastMoveDirection ?? WORLD_FORWARD, 0.9);
    } else if (kind === 'charge') {
      brain.commitDistance = CHARGE_TRAVEL_DISTANCE;
      brain.chargeDistanceTravelled = 0;
      brain.targetPosition.copy(this.root.position).addScaledVector(brain.attackDirection, brain.commitDistance);
    } else if (kind === 'selfDestruct' || kind === 'shockwave') {
      brain.targetPosition.copy(this.root.position);
    }

    if (this.navigationMode === 'ground') {
      const surfaceY = game.dungeonController?.getSurfaceElevationAt?.(brain.targetPosition) ?? brain.targetPosition.y;
      brain.targetPosition.y = surfaceY;
      if (kind === 'pounce' && this._usesSpringLocomotion()) {
        this._resolveSpringPounceLanding(game, brain.targetPosition);
      } else if (kind === 'charge' || kind === 'pounce') {
        this._clampCommitTargetToWalkablePath(game, brain.targetPosition);
      }
    } else if (kind === 'charge' || kind === 'pounce') {
      brain.targetPosition.y = game.player.root.position.y + 0.9;
    }

    if (kind === 'pounce') {
      tempA.copy(brain.targetPosition).sub(this.root.position).setY(0);
      if (tempA.lengthSq() > 0.0001) brain.attackDirection.copy(tempA.normalize());
    }

    if (kind === 'charge') {
      brain.commitDistance = this.navigationMode === 'air'
        ? this.root.position.distanceTo(brain.targetPosition)
        : flatDistance(this.root.position, brain.targetPosition);
    }

    const markerRadius = kind === 'selfDestruct'
      ? (this.genome.modules.weapon.explosiveRadius ?? 3)
      : kind === 'mortar'
        ? (this.genome.modules.weapon.explosiveRadius ?? 1.2)
        : kind === 'mine'
          ? 1.15
        : kind === 'pounce' || kind === 'shockwave'
            ? (this.genome.modules.weapon.landingRadius ?? 1.85)
            : kind === 'jawCombo'
              ? (this.genome.modules.weapon.shockwaveRadius ?? 1.85)
              : kind === 'clawMoveset' && brain.clawAttackVariant === 'verticalSlam'
                ? (this.genome.modules.weapon.slamRadius ?? CLAW_SLAM_RADIUS)
            : 0;
    if (markerRadius > 0) {
      this._createTelegraphMarker(
        game,
        markerRadius,
        (kind === 'pounce' || kind === 'jawCombo' || kind === 'clawMoveset')
          ? RUSH_WARNING_COLOR_HEX
          : this.genome.palette.emissive,
      );
    }
  }

  _updateClawGuardState(dt) {
    const brain = this.brain;
    brain.stateTime += dt;
    brain.clawGuardTimeRemaining = Math.max(0, brain.clawGuardTimeRemaining - dt);
    brain.moving = false;
    brain.speedRatio = 0;
    brain.weakPointExposed = false;
    this.knockback.set(0, 0, 0);
    if (brain.clawGuardTimeRemaining <= 0) {
      brain.state = brain.clawGuardResumeState;
      brain.stateTime = brain.clawGuardResumeTime;
      brain.cooldown = Math.max(0, brain.cooldown);
      brain.clawGuardResumeState = 'position';
      brain.clawGuardResumeTime = 0;
    }
  }

  _updateClawRecoilState(dt) {
    const brain = this.brain;
    brain.stateTime += dt;
    brain.moving = false;
    brain.speedRatio = 0;
    brain.weakPointExposed = false;
    brain.clawSpinProgress = 0;
    this.knockback.set(0, 0, 0);
    if (brain.stateTime >= this._getStateDuration('recoil')) {
      brain.state = 'position';
      brain.stateTime = 0;
      brain.cooldown = 0;
      brain.clawAttackVariant = null;
    }
  }

  _updateClawMoveset(game, progress) {
    const brain = this.brain;
    brain.moving = false;
    brain.speedRatio = 0;
    brain.weakPointExposed = false;
    if (brain.clawAttackVariant === 'verticalSlam') {
      brain.clawSpinProgress = 0;
      if (!brain.attackFired && progress >= 0.52) {
        brain.attackFired = true;
        this._performClawGroundSlam(game);
      }
      return;
    }

    brain.clawSpinProgress = progress;
    if (!brain.attackFired && progress >= 0.38) {
      brain.attackFired = true;
      this._performClawHorizontalSwipe(game);
    }
  }

  _performClawHorizontalSwipe(game) {
    const weapon = this.genome.modules.weapon;
    const player = game.player;
    const radius = weapon.horizontalSweepRadius ?? CLAW_HORIZONTAL_SWEEP_RADIUS;
    tempA.copy(player.root.position).sub(this.root.position).setY(0);
    const distance = tempA.length();
    if (distance <= 0.001) tempA.copy(this.brain.attackDirection);
    else tempA.divideScalar(distance);

    const inHeight = Math.abs((player.root.position.y + 0.9)
      - (this.root.position.y + this.collisionHeight * 0.52)) <= 2.2;
    let directHitLanded = false;
    if (!player.dead
      && inHeight
      && distance <= radius + (player.radius ?? 0.42)
      && this._hasClawAttackLineOfSight(game, this.root.position, player.root.position)) {
      const hitResult = player.takeIncomingHit({
        amount: this.stats.damage * (weapon.horizontalSweepDamageScale ?? 1),
        source: this,
        attackKind: 'clawHorizontalSwipe',
        guardable: true,
        reactionTier: 2,
        knockbackDirection: tempA,
        knockbackStrength: 1.12,
      });
      directHitLanded = isResolvedPlayerContact(hitResult);
      if (hitResult.healthDamage > 0) {
        this.onHitPlayer(player, hitResult.healthDamage);
      }
      if (directHitLanded) {
        game.addHitEffect?.(player.root.position, RUSH_WARNING_COLOR_HEX, 0.9);
        game.requestHitStop?.(0.11, { timeScale: 0.045 });
      }
    }

    tempB.copy(this.root.position);
    tempB.y = game.dungeonController?.getSurfaceElevationAt?.(tempB) ?? tempB.y;
    game.addClawSwipeTrailHazard?.(tempB, {
      source: this,
      radius,
      height: Math.max(0.75, this.collisionHeight * 0.48),
      duration: weapon.trailDuration ?? 0.65,
      damage: this.stats.damage * (weapon.trailDamageScale ?? 0.42),
      color: RUSH_WARNING_COLOR_HEX,
      suppressInitialOverlap: directHitLanded,
    });
    game.addParticleBurst?.(this.root.position, RUSH_WARNING_COLOR_HEX, 20, 0.17);
  }

  _performClawGroundSlam(game) {
    const weapon = this.genome.modules.weapon;
    // Commit damage may be reached by one coarse simulation step. Pose the
    // articulated arm at that exact commit progress before sampling its palm,
    // so the shockwave and visible ground contact cannot diverge by a frame.
    this._animateVisual(Math.max(0.08, Math.min(0.2, this.brain.stateTime)));
    this.root.updateMatrixWorld(true);
    this.visual.weakPoint.core.getWorldPosition(tempA);
    tempA.y = (game.dungeonController?.getSurfaceElevationAt?.(tempA) ?? this.root.position.y) + 0.06;
    tempB.copy(game.player.root.position).sub(tempA).setY(0);
    if (tempB.lengthSq() <= 0.0001) tempB.copy(this.brain.attackDirection);
    tempB.normalize();
    game.addExplosion(
      tempA,
      this.stats.damage * (weapon.slamDamageScale ?? 1.15),
      weapon.slamRadius ?? CLAW_SLAM_RADIUS,
      RUSH_WARNING_COLOR_HEX,
      {
        source: this,
        attackKind: 'clawGroundSlam',
        powerfulKnockback: true,
        knockbackDirection: tempB,
        knockbackStrength: 1.18,
        damageEnemies: false,
        damagePlayer: true,
        playerDamageScale: 1,
        triggerMines: false,
      },
    );
    game.addParticleBurst?.(tempA, RUSH_WARNING_COLOR_HEX, 26, 0.2);
    game.requestHitStop?.(0.095, { timeScale: 0.055 });
  }

  _hasClawAttackLineOfSight(game, fromPosition = this.root.position, toPosition = game.player.root.position) {
    const controller = game.dungeonController;
    if (!controller?.isAerialPathClear) return true;
    tempF.copy(fromPosition);
    tempF.y = Math.max(tempF.y, this.root.position.y + this.collisionHeight * 0.5);
    tempG.copy(toPosition);
    tempG.y = Math.max(tempG.y, game.player.root.position.y + 0.88);
    return controller.isAerialPathClear(tempF, tempG, {
      radius: 0.08,
      verticalRadius: 0.12,
      lookAhead: Math.max(1, tempF.distanceTo(tempG)),
    });
  }

  _updateClawDragAndVault(dt, game, progress, minimumSeparation = 0) {
    const brain = this.brain;
    const weapon = this.genome.modules.weapon;
    brain.clawVaultCooldown = Math.max(0, brain.clawVaultCooldown - dt);

    if (brain.clawVaultActive) {
      return this._advanceClawVault(dt, game);
    }
    if (progress >= 0.92) {
      brain.clawDragSpeed *= Math.max(0, 1 - dt * 8);
      return false;
    }

    tempA.copy(game.player.root.position).sub(this.root.position).setY(0);
    const playerDistance = tempA.length();
    const desiredSeparation = Math.max(
      1.25,
      (weapon.baseReach ?? 2.95) * 0.46,
      Math.max(0, Number(minimumSeparation) || 0),
    );
    if (playerDistance <= desiredSeparation || playerDistance <= 0.001) {
      brain.clawDragSpeed *= Math.max(0, 1 - dt * 7);
      return false;
    }
    tempA.divideScalar(playerDistance);

    // The shoulder tracks the player's current lane while the chassis is
    // pulled forward by the weight of the extended construction arm.
    this._turnToward(tempA, dt, this.genome.behavior.turnRate * 1.12);
    brain.attackDirection.lerp(tempA, Math.min(1, dt * 4.8)).normalize();
    const targetSpeed = this.stats.moveSpeed * (weapon.dragSpeedScale ?? 1.35);
    const acceleration = targetSpeed * (weapon.dragAccelerationScale ?? 1.5) * 3.4;
    brain.clawDragSpeed = Math.min(targetSpeed, brain.clawDragSpeed + acceleration * dt);
    const step = Math.min(
      brain.clawDragSpeed * dt,
      Math.max(0, playerDistance - desiredSeparation),
    );
    if (step <= 0.0001) return false;

    const controller = game.dungeonController;
    tempB.copy(this.root.position).addScaledVector(tempA, step);
    tempB.y = controller?.getSurfaceElevationAt?.(tempB) ?? this.root.position.y;
    const elevationDelta = tempB.y - this.root.position.y;
    const directClear = controller?.isEnemyPositionClear
      ? controller.isEnemyPositionClear(this, tempB, { maximumElevationDelta: 0.62 })
      : !controller?.isPositionWalkable || controller.isPositionWalkable(tempB);
    if (directClear && Math.abs(elevationDelta) <= 0.62) {
      this.root.position.copy(tempB);
      return true;
    }

    // A failed direct footprint probe is the cue to plant the enormous claw
    // and vault the chassis. New vaults start early enough that the full arc
    // completes before the third swipe and its recovery opening.
    if (progress <= 0.5
      && brain.clawVaultCooldown <= 0
      && this._beginClawVault(game, tempA, playerDistance, desiredSeparation)) {
      return this._advanceClawVault(dt, game);
    }

    brain.clawVaultCooldown = Math.max(brain.clawVaultCooldown, 0.12);
    brain.clawDragSpeed *= 0.45;
    return false;
  }

  _beginClawVault(game, direction, playerDistance, minimumSeparation = 0) {
    const controller = game.dungeonController;
    if (!controller?.isEnemyPositionClear) return false;

    const weapon = this.genome.modules.weapon;
    const maximumForward = Math.min(
      weapon.vaultForwardDistance ?? 3.1,
      Math.max(0, playerDistance - Math.max(0.9, minimumSeparation)),
    );
    if (maximumForward < 1.35) return false;
    const maximumElevation = weapon.obstacleVaultHeight ?? 1.85;
    const baseVaultHeight = weapon.vaultHeight ?? 2.15;

    for (const distanceScale of [1, 0.82, 0.66, 0.5]) {
      const travel = maximumForward * distanceScale;
      if (travel < 1.35) continue;
      tempC.copy(this.root.position).addScaledVector(direction, travel);
      // When MegaMan occupies a low platform, probe at his elevation so the
      // surface resolver can select its top instead of the floor beneath it.
      tempC.y = Math.max(this.root.position.y, game.player.root.position.y);
      tempC.y = controller.getSurfaceElevationAt?.(tempC) ?? tempC.y;
      const elevationDelta = tempC.y - this.root.position.y;
      if (elevationDelta > maximumElevation || elevationDelta < -maximumElevation * 1.4) {
        continue;
      }

      const arenaCandidate = controller.getEnemyArenaTarget?.(this, tempC, tempD);
      if (arenaCandidate) {
        tempC.x = arenaCandidate.x;
        tempC.z = arenaCandidate.z;
        tempC.y = controller.getSurfaceElevationAt?.(tempC) ?? tempC.y;
      }
      if (!controller.isEnemyPositionClear(this, tempC, {
        maximumElevationDelta: maximumElevation + 0.2,
      })) {
        continue;
      }

      const vaultHeight = Math.max(baseVaultHeight, Math.max(0, elevationDelta) + 1.05);
      if (!this._isClawVaultArcClear(game, this.root.position, tempC, vaultHeight)) {
        continue;
      }

      const brain = this.brain;
      brain.clawVaultActive = true;
      brain.clawVaultTime = 0;
      brain.clawVaultDuration = THREE.MathUtils.clamp(
        CLAW_VAULT_DURATION + Math.max(0, elevationDelta) * 0.045,
        CLAW_VAULT_DURATION,
        0.66,
      );
      brain.clawVaultHeight = vaultHeight;
      brain.clawVaultStart.copy(this.root.position);
      brain.clawVaultLanding.copy(tempC);
      brain.clawDragSpeed = 0;
      game.addParticleBurst?.(this.root.position, this.genome.palette.trim, 9, 0.09);
      return true;
    }
    return false;
  }

  _advanceClawVault(dt, game = null) {
    const brain = this.brain;
    if (!brain.clawVaultActive) return false;
    brain.clawVaultTime = Math.min(
      brain.clawVaultDuration,
      brain.clawVaultTime + Math.max(0, dt),
    );
    const progress = clamp01(brain.clawVaultTime / Math.max(0.01, brain.clawVaultDuration));
    const horizontalProgress = THREE.MathUtils.smoothstep(progress, 0.02, 0.98);
    this.root.position.lerpVectors(brain.clawVaultStart, brain.clawVaultLanding, horizontalProgress);
    this.root.position.y += Math.sin(progress * Math.PI) * brain.clawVaultHeight;
    this.root.rotation.x = -Math.sin(progress * Math.PI) * 0.18;

    if (progress >= 1) {
      brain.clawVaultActive = false;
      brain.clawVaultTime = 0;
      brain.clawVaultCooldown = 0.18;
      this.root.position.copy(brain.clawVaultLanding);
      this.root.rotation.x = 0;
      game?.addParticleBurst?.(this.root.position, this.genome.palette.trim, 12, 0.1);
    }
    return true;
  }

  _isClawVaultArcClear(game, startRootPosition, landingRootPosition, vaultHeight) {
    const controller = game.dungeonController;
    if (!controller?.isAerialPositionClear) return true;
    const travelDistance = flatDistance(startRootPosition, landingRootPosition);
    const steps = Math.max(12, Math.ceil(travelDistance / 0.2));
    const centerOffset = Math.max(0.5, this.collisionHeight * 0.48);
    const options = {
      radius: Math.max(0.28, Math.min(0.76, this.radius * 0.88)),
      verticalRadius: Math.max(0.38, this.collisionHeight * 0.34),
    };
    // Endpoints use the grounded footprint query. Sampling only the open arc
    // avoids treating the floor or destination platform as an aerial blocker.
    for (let step = 1; step < steps; step += 1) {
      const progress = step / steps;
      tempE.copy(startRootPosition).lerp(landingRootPosition, progress);
      tempE.y += Math.sin(progress * Math.PI) * vaultHeight + centerOffset;
      if (!controller.isAerialPositionClear(tempE, options)) return false;
    }
    return true;
  }

  _getJawMinimumRootSeparation(game) {
    const weapon = this.genome.modules.weapon;
    const player = game.player;
    this.root.updateMatrixWorld(true);
    this.visual.weapon.muzzle.getWorldPosition(tempG);

    // Generated quadrupeds vary in torso length, so derive the clearance from
    // the actual assembled mouth instead of relying on one catalog constant.
    const mouthReach = flatDistance(this.root.position, tempG);
    const shockwaveRadius = Math.max(0.35, weapon.shockwaveRadius ?? 1.9);
    // Base clearance on a same-floor target. MegaMan jumping over the mouth
    // should evade it, not make the quadruped retreat farther from his shadow.
    const verticalGap = Math.abs(tempG.y - this.root.position.y);
    const horizontalShockwaveReach = Math.sqrt(Math.max(
      0,
      shockwaveRadius * shockwaveRadius - verticalGap * verticalGap,
    ));
    const bodyClearance = this.radius + (player.radius ?? 0.42) + JAW_PLAYER_SEPARATION_BUFFER;
    const mouthClearance = mouthReach - horizontalShockwaveReach + JAW_PLAYER_SEPARATION_BUFFER;
    return Math.max(
      weapon.minimumHopSeparation ?? 0.82,
      bodyClearance,
      mouthClearance,
    );
  }

  _resolveJawPlayerOverlap(dt, game) {
    const player = game.player;
    const minimumSeparation = this._getJawMinimumRootSeparation(game);
    tempA.copy(this.root.position).sub(player.root.position).setY(0);
    const distance = tempA.length();
    if (distance >= minimumSeparation - 0.001) return false;

    if (distance <= 0.001) {
      tempA.copy(this.brain.attackDirection).setY(0).multiplyScalar(-1);
      if (tempA.lengthSq() <= 0.0001) {
        tempA.set(-Math.sin(this.root.rotation.y), 0, -Math.cos(this.root.rotation.y));
      }
    }
    tempA.normalize();

    const recoverySpeed = Math.max(
      5.5,
      this.stats.moveSpeed * JAW_OVERLAP_RECOVERY_SPEED_SCALE,
    );
    const recoveryStep = Math.min(
      minimumSeparation - distance,
      recoverySpeed * Math.max(0, dt),
    );
    if (recoveryStep <= 0.0001) return false;

    const nextX = this.root.position.x + tempA.x * recoveryStep;
    const nextZ = this.root.position.z + tempA.z * recoveryStep;
    return this._moveJawAlongClearPath(game, nextX, nextZ, this.root.position.y);
  }

  _moveJawAlongClearPath(game, nextX, nextZ, nextY = this.root.position.y) {
    const controller = game.dungeonController;
    if (!controller?.isEnemyPositionClear) {
      return this._moveCommitAlongWalkablePath(game, nextX, nextZ, nextY);
    }

    tempF.copy(this.root.position);
    tempG.set(nextX, nextY, nextZ);
    const distance = flatDistance(tempF, tempG);
    if (distance <= 0.0001) return false;

    // A crusher jaw has a much wider visual/body envelope than its center
    // point. Sample the full enemy footprint densely enough that thin walls
    // cannot be skipped by overlap recovery or a bite hop.
    const steps = Math.max(1, Math.ceil(distance / 0.06));
    for (let step = 1; step <= steps; step += 1) {
      tempH.copy(tempF).lerp(tempG, step / steps);
      tempH.y = controller.getSurfaceElevationAt?.(tempH) ?? tempH.y;
      if (!controller.isEnemyPositionClear(this, tempH, {
        maximumElevationDelta: 0.72,
      })) {
        return false;
      }
    }

    this.root.position.copy(tempG);
    this.root.position.y = controller.getSurfaceElevationAt?.(this.root.position)
      ?? nextY;
    return true;
  }

  _updateJawCombo(dt, game, progress) {
    const brain = this.brain;
    const weapon = this.genome.modules.weapon;
    const strikeCount = weapon.comboCount ?? 3;
    const strikeProgress = weapon.strikeProgress ?? 0.62;
    const cycle = Math.min(strikeCount - 1, Math.floor(progress * strikeCount));
    const localProgress = progress >= 1 ? 1 : (progress * strikeCount) - cycle;
    const minimumRootSeparation = this._getJawMinimumRootSeparation(game);

    // Each snap is also a short forward dog-like hop. Tracking remains live so
    // the three bites pressure movement instead of attacking an obsolete point.
    tempA.copy(game.player.root.position).sub(this.root.position).setY(0);
    const distance = tempA.length();
    if (distance > 0.001) tempA.divideScalar(distance);
    else tempA.copy(brain.attackDirection);
    const currentYaw = Math.atan2(brain.attackDirection.x, brain.attackDirection.z);
    const targetYaw = Math.atan2(tempA.x, tempA.z);
    const steeringStep = Math.max(0, this.genome.behavior.turnRate * 1.65 * dt);
    const steeredYaw = currentYaw + THREE.MathUtils.clamp(
      angleDelta(currentYaw, targetYaw),
      -steeringStep,
      steeringStep,
    );
    brain.attackDirection.set(Math.sin(steeredYaw), 0, Math.cos(steeredYaw));
    this._turnToward(brain.attackDirection, dt, this.genome.behavior.turnRate * 1.3);
    if (localProgress >= 0.34 && localProgress <= 0.76) {
      const hopWindowDuration = Math.max(
        0.08,
        (this.genome.behavior.commitDuration / strikeCount) * (0.76 - 0.34),
      );
      const hopSpeed = (weapon.hopDistance ?? 1.25) / hopWindowDuration;
      this.root.updateMatrixWorld(true);
      this.visual.weapon.muzzle.getWorldPosition(tempB);
      tempC.copy(tempB).sub(game.player.root.position);
      const mouthAlongAttack = tempC.dot(brain.attackDirection);
      const mouthLateralSq = Math.max(
        0,
        tempC.lengthSq() - mouthAlongAttack * mouthAlongAttack,
      );
      const safeShockwaveRadius = Math.max(0.35, (weapon.shockwaveRadius ?? 1.9) - 0.12);
      const safeMouthAdvance = Math.max(
        0,
        Math.sqrt(Math.max(0, safeShockwaveRadius * safeShockwaveRadius - mouthLateralSq))
          - mouthAlongAttack,
      );
      const remainingCycleTravel = Math.max(
        0,
        (weapon.hopDistance ?? 1.25) - (brain.jawHopTravel[cycle] ?? 0),
      );
      const hopStep = Math.min(
        hopSpeed * dt,
        remainingCycleTravel,
        safeMouthAdvance,
        Math.max(0, distance - minimumRootSeparation),
      );
      const nextX = this.root.position.x + brain.attackDirection.x * hopStep;
      const nextZ = this.root.position.z + brain.attackDirection.z * hopStep;
      const moved = this._moveJawAlongClearPath(game, nextX, nextZ, this.root.position.y);
      if (moved) brain.jawHopTravel[cycle] += hopStep;
      brain.moving = true;
      brain.speedRatio = 1.45;
    }

    while (brain.comboStrikesFired < strikeCount) {
      const threshold = (brain.comboStrikesFired + strikeProgress) / strikeCount;
      if (progress + 0.0001 < threshold) break;
      this._performJawBite(game, brain.comboStrikesFired);
      brain.comboStrikesFired += 1;
    }
    brain.attackFired = brain.comboStrikesFired >= strikeCount;
  }

  _performJawBite(game, strikeIndex) {
    const weapon = this.genome.modules.weapon;
    this.root.updateMatrixWorld(true);
    this.visual.weapon.muzzle.getWorldPosition(tempA);
    tempB.copy(game.player.root.position).sub(this.root.position).setY(0);
    if (tempB.lengthSq() <= 0.0001) tempB.copy(this.brain.attackDirection);
    tempB.normalize();
    const finalBite = strikeIndex === (weapon.comboCount ?? 3) - 1;
    game.addParticleBurst(tempA, RUSH_WARNING_COLOR_HEX, finalBite ? 18 : 12, 0.16);
    this._getJawShockwaveOrigin(game, tempC);
    game.addExplosion(
      tempC,
      this.stats.damage * (weapon.shockwaveDamageScale ?? weapon.strikeDamageScale ?? 0.82),
      weapon.shockwaveRadius ?? 1.85,
      RUSH_WARNING_COLOR_HEX,
      {
        source: this,
        attackKind: 'jawBiteShockwave',
        powerfulKnockback: finalBite,
        reactionTier: 3,
        knockbackDirection: tempB,
        knockbackStrength: finalBite ? 1.05 : 0.72,
        damageEnemies: false,
        damagePlayer: true,
        playerDamageScale: 1,
        targetGeometry: 'verticalCapsule',
        triggerMines: false,
      },
    );
  }

  _getJawShockwaveOrigin(game, target) {
    // The visible bear-trap jaw spans the whole segment from its hinge to its
    // muzzle. Use the nearest point on that segment as the snap origin. This
    // preserves the muzzle-centred wave at normal range while making a player
    // caught inside the hinged blades part of the bite volume instead of an
    // accidental safe spot behind the muzzle.
    this.visual.weapon.group.getWorldPosition(tempG);
    this.visual.weapon.muzzle.getWorldPosition(tempH);
    tempI.copy(tempH).sub(tempG);
    const segmentLengthSq = tempI.lengthSq();
    if (segmentLengthSq <= 0.0001) return target.copy(tempH);

    const playerPosition = game.player.root.position;
    const projection = ((playerPosition.x - tempG.x) * tempI.x
      + (playerPosition.y - tempG.y) * tempI.y
      + (playerPosition.z - tempG.z) * tempI.z) / segmentLengthSq;
    return target.copy(tempG).addScaledVector(tempI, clamp01(projection));
  }

  _updatePersistentWeaponContact(dt, game) {
    const weapon = this.genome.modules.weapon;
    if (this.brain.state === 'recovery' || this.brain.state === 'eyeRefocus') return;
    const continuousWeaponContact = Boolean(weapon.continuousContactDamage);
    // Authored commit attacks own their strike frames. Body contact remains
    // live while positioning or telegraphing, but recovery always provides
    // a damage-free breathing window and cannot stack a
    // second damage event on the same frame as a bite, swipe, ram, or pounce.
    const meleeBodyContact = weapon.tags?.includes('melee')
      && !continuousWeaponContact
      && !(this._isClawCarrier() && (this.brain.clawDestroyed
        || this.brain.state === 'guard'
        || this.brain.state === 'recoil'))
      && this.brain.state !== 'commit';
    if ((!continuousWeaponContact && !meleeBodyContact)
      || this.dead
      || game.player.dead
      || this.isExternalMotionActive()) return;
    this.brain.contactCooldown = Math.max(0, this.brain.contactCooldown - dt);
    if (this.brain.contactCooldown > 0) return;

    if (meleeBodyContact) {
      this._tryMeleeBodyContact(game);
      return;
    }

    // Rotating weapons retain their authored always-live blade volume. They do
    // not also run the generic melee body check, avoiding duplicate contact
    // hits from a single overlap.
    this.root.updateMatrixWorld(true);
    this.visual.weapon.group.getWorldPosition(tempA);
    tempB.copy(game.player.root.position);
    tempB.y += 0.82;
    const verticalReach = Math.max(0.9, this.collisionHeight * 0.55);
    if (Math.abs(tempB.y - tempA.y) > verticalReach) return;
    tempC.copy(tempB).sub(tempA).setY(0);
    const radius = weapon.contactRadius ?? 1.65;
    if (tempC.length() > radius + game.player.radius) return;

    if (tempC.lengthSq() <= 0.0001) tempC.copy(this.brain.attackDirection);
    tempC.normalize();
    const hitResult = game.player.takeIncomingHit({
      amount: this.stats.damage * (weapon.contactDamageScale ?? 0.72),
      source: this,
      attackKind: 'rotorContact',
      guardable: true,
      reactionTier: 0,
      knockbackDirection: tempC,
      knockbackStrength: 0.78,
    });
    const resolvedContact = isResolvedPlayerContact(hitResult);
    if (hitResult.healthDamage > 0) {
      this.onHitPlayer(game.player, hitResult.healthDamage);
    }
    if (resolvedContact) {
      this.brain.contactCooldown = weapon.contactHitInterval ?? 0.6;
      this.beginContactRetreat(game, game.player);
      game.addHitEffect(game.player.root.position, RUSH_WARNING_COLOR_HEX, 0.68);
      game.requestHitStop?.(0.07, { timeScale: 0.08 });
    }
  }

  _tryMeleeBodyContact(game) {
    const player = game.player;
    const verticalGap = Math.abs(player.root.position.y - this.root.position.y);
    const weapon = this.genome.modules.weapon;
    const jawMouthContact = weapon.attackKind === 'jawCombo'
      && this._isPlayerInsideJawMouth(player);
    if (!jawMouthContact
      && verticalGap > Math.max(1.15, this.collisionHeight * 0.62)) return false;

    tempA.copy(player.root.position).sub(this.root.position).setY(0);
    const contactRadius = this.radius + (player.radius ?? 0.42) + 0.12;
    if (!jawMouthContact && tempA.lengthSq() > contactRadius * contactRadius) return false;

    if (tempA.lengthSq() <= 0.0001) {
      tempA.copy(this.brain.attackDirection).setY(0);
      if (tempA.lengthSq() <= 0.0001) {
        tempA.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
      }
    }
    tempA.normalize();
    const hitResult = player.takeIncomingHit({
      amount: this.stats.damage * (jawMouthContact
        ? weapon.mouthContactDamageScale ?? MELEE_BODY_CONTACT_DAMAGE_SCALE
        : weapon.bodyContactDamageScale ?? MELEE_BODY_CONTACT_DAMAGE_SCALE),
      source: this,
      attackKind: jawMouthContact ? 'jawMouthContact' : 'meleeBodyContact',
      guardable: false,
      reactionTier: jawMouthContact ? 3 : 2,
      knockbackDirection: tempA,
      knockbackStrength: jawMouthContact
        ? weapon.mouthContactKnockback ?? MELEE_BODY_CONTACT_KNOCKBACK
        : weapon.bodyContactKnockback ?? MELEE_BODY_CONTACT_KNOCKBACK,
    });
    const resolvedContact = isResolvedPlayerContact(hitResult);
    if (hitResult.healthDamage > 0) {
      this.onHitPlayer(player, hitResult.healthDamage);
    }
    if (resolvedContact) {
      this.brain.contactCooldown = jawMouthContact
        ? weapon.mouthContactHitInterval ?? MELEE_BODY_CONTACT_INTERVAL
        : weapon.bodyContactHitInterval ?? MELEE_BODY_CONTACT_INTERVAL;
      if (!jawMouthContact) this.beginContactRetreat(game, player);
      game.addHitEffect(player.root.position, this.genome.palette.emissive, 0.62);
      game.requestHitStop?.(0.065, { timeScale: 0.08 });
    }
    return resolvedContact;
  }

  _isPlayerInsideJawMouth(player) {
    const weapon = this.genome.modules.weapon;
    if (weapon.attackKind !== 'jawCombo'
      || !this.visual?.weapon?.group
      || !this.visual?.weapon?.muzzle) return false;

    this.root.updateMatrixWorld(true);
    this.visual.weapon.group.getWorldPosition(tempG);
    this.visual.weapon.muzzle.getWorldPosition(tempH);
    return findStraightBusterCapsuleHitFraction(
      tempG,
      tempH,
      player,
      weapon.mouthContactRadius ?? 0.7,
    ) !== null;
  }

  _updateTractorController(dt, game) {
    const brain = this.brain;
    const weapon = this.genome.modules.weapon;
    brain.cooldown = Math.max(0, brain.cooldown - dt * this._getStatusAttackRateMultiplier());
    brain.moving = false;
    brain.speedRatio = 0;
    brain.tractorBeamActive = false;
    brain.tractorBeamIntensity = 0;

    if (brain.tractorCrashPhase) {
      return this._updateTractorCrash(dt, game);
    }

    if (brain.controllerTagPause > 0) {
      brain.controllerTagPause = Math.max(0, brain.controllerTagPause - dt);
      this._updateExposureAndDefense();
      this._animateVisual(dt);
      return { handled: true, moving: false, moveAmount: 0 };
    }

    if (brain.state === 'position') {
      if (!this._isTractorObjectiveValid(game, false)
        || !this._canReachTractorTarget(game, brain.tractorTarget)) {
        const objective = this._selectTractorObjective(game);
        this._setTractorObjective(objective?.target ?? null, objective?.kind ?? null);
      }
      const target = brain.tractorTarget;
      if (target) {
        tempB.copy(target.root.position).sub(this.root.position).setY(0);
        if (tempB.lengthSq() > 0.0001) {
          tempB.normalize();
          this._turnToward(tempB, dt, this.genome.behavior.turnRate * 2.6);
        }
        const approach = this._updateTractorApproach(dt, game, target);
        brain.moving = approach.moving;
        brain.speedRatio = approach.speedRatio;
        const intentionalManeuver = brain.tractorApproachPhase === 'flip'
          || brain.tractorApproachPhase === 'zigzag';
        brain.tractorPathFailureTime = brain.moving || approach.aligned || intentionalManeuver
          ? 0
          : brain.tractorPathFailureTime + dt;
        if (brain.tractorPathFailureTime >= 1.1) {
          this._setTractorObjective(null, null);
        }
        if (brain.cooldown <= 0
          && approach.aligned
          && (game.requestEnemyAttack?.(this) ?? true)) {
          if (brain.tractorTargetKind === 'player') {
            this._beginTractorTelegraph(game, target, false);
          } else if (target.tryClaimExternalControl?.(this, 'tractorBeam', {
            freeze: true,
            ignoreGroundConstraint: true,
          })) {
            this._beginTractorTelegraph(game, target, true);
          }
        }
      } else {
        brain.moving = this._moveTractorAwayFromPlayer(dt, game, 1.75);
        brain.speedRatio = brain.moving ? 1.25 : 0;
      }
    } else if (brain.state === 'telegraph') {
      const target = brain.tractorTarget;
      const targetingPlayer = brain.tractorTargetKind === 'player';
      if (!this._isTractorObjectiveValid(game, !targetingPlayer)) {
        this._abortTractorCycle('target-lost', game);
      } else {
        brain.stateTime += dt;
        brain.moving = targetingPlayer
          ? this._moveTractorAboveBeamPoint(dt, game)
          : this._moveTractorAboveTarget(
            dt,
            game,
            target,
            TRACTOR_BEAM_TRACK_SPEED_SCALE,
          );
        brain.speedRatio = brain.moving ? 1.45 : 0;
        const progress = clamp01(brain.stateTime / Math.max(0.01, this.genome.behavior.telegraphDuration));
        if (targetingPlayer) {
          this._setTractorBeamAtPosition(
            brain.tractorBeamPoint,
            (target.collisionHeight ?? 1.75) * 0.46,
            0.25 + progress * 0.75,
          );
        } else {
          this._setTractorBeamForTarget(target, 0.25 + progress * 0.75);
        }
        brain.effectTimer -= dt;
        if (brain.effectTimer <= 0) {
          brain.effectTimer = THREE.MathUtils.lerp(0.16, 0.055, progress);
          this.visual.weapon.muzzle.getWorldPosition(tempA);
          game.addParticleBurst(tempA, TRACTOR_BEAM_COLOR, 4, 0.09);
        }
        if (brain.stateTime >= this.genome.behavior.telegraphDuration) {
          if (!targetingPlayer) {
            this._enterTractorCommit(target);
          } else {
            const captureRadius = this.genome.modules.weapon.playerCaptureRadius
              ?? TRACTOR_PLAYER_CAPTURE_RADIUS;
            const stayedInBeam = flatDistance(target.root.position, brain.tractorBeamPoint)
              <= captureRadius + (target.radius ?? 0.42);
            const claimed = stayedInBeam
              && this._isTractorObjectiveValid(game, false)
              && target.tryClaimExternalControl?.(this, 'tractorBeam', {
                freeze: true,
                ignoreGroundConstraint: true,
              });
            if (claimed) {
              brain.tractorCargoTopOffset = this._measureTractorCargoTopOffset(target);
              this._enterTractorCommit(target);
            } else {
              this._abortTractorCycle(
                stayedInBeam ? 'player-control-unavailable' : 'player-escaped-beam',
                game,
              );
            }
          }
        }
      }
    } else if (brain.state === 'commit') {
      const target = brain.tractorTarget;
      const targetingPlayer = brain.tractorTargetKind === 'player';
      if (!this._isTractorObjectiveValid(game, true)) {
        this._abortTractorCycle('target-lost', game);
      } else {
        brain.stateTime += dt;
        const liftDuration = weapon.liftDuration ?? 1;
        const carryDuration = weapon.carryDuration ?? 1.25;
        const throwDuration = weapon.throwDuration ?? 0.45;
        const liftProgress = clamp01(brain.stateTime / Math.max(0.01, liftDuration));
        if (brain.stateTime > liftDuration && !targetingPlayer) {
          this._moveTractorTowardThrowPosition(dt, game, target);
        } else if (targetingPlayer) {
          this._moveTractorAboveBeamPoint(dt, game, 1.25);
        }
        // Captives rotate only around the beam axis while carried. Player and
        // generated machine silhouettes therefore keep a stable collision
        // envelope until the authored throw begins.
        target.root.rotation.x = 0;
        target.root.rotation.z = 0;
        target.root.rotation.y += dt * (targetingPlayer ? 3.8 : 5.6);
        brain.tractorCargoTopOffset = this._measureTractorCargoTopOffset(target);
        const carryAnchor = this._getTractorCarryAnchor(target, tempA);
        if (brain.stateTime <= liftDuration) {
          tempI.lerpVectors(
            brain.tractorLiftStart,
            carryAnchor,
            THREE.MathUtils.smoothstep(liftProgress, 0, 1),
          );
        } else {
          tempI.copy(target.root.position).lerp(carryAnchor, Math.min(1, dt * 12));
        }
        if (!this._isTractorCargoRootPathClear(game, target, target.root.position, tempI)) {
          this._abortTractorCycle('cargo-path-blocked', game);
          this._updateExposureAndDefense();
          this._animateVisual(dt);
          return { handled: true, moving: false, moveAmount: 0 };
        }
        target.root.position.copy(tempI);
        this._setTractorBeamForTarget(target, 1);

        if (!brain.attackFired && brain.stateTime >= liftDuration + carryDuration) {
          const throwArcHeight = targetingPlayer ? 2.45 : 2.1;
          const landing = targetingPlayer
            ? this._findTractorPlayerThrowLanding(game, target, throwArcHeight)
            : this._findTractorThrowLanding(game, target, throwArcHeight);
          if (!landing) {
            this._abortTractorCycle('throw-path-blocked', game);
            this._updateExposureAndDefense();
            this._animateVisual(dt);
            return { handled: true, moving: false, moveAmount: 0 };
          }
          const captive = target;
          const impactDamage = targetingPlayer
            ? Math.max(12, this.stats.damage * (
              weapon.playerImpactDamageScale ?? 1.6
            ))
            : this.stats.damage * 0.9;
          const launched = captive.startExternalBallisticMotion?.(this, {
            targetPosition: landing,
            duration: Math.max(0.72, throwDuration + 0.38),
            arcHeight: throwArcHeight,
            // Keep the captured unit rotating around its upright axis during
            // flight. This preserves the sci-fi toss while giving collision
            // validation a stable vertical envelope for modular silhouettes.
            spinRate: targetingPlayer
              ? { x: 6.2, y: 1.8, z: 0 }
              : { x: 0, y: 9.5, z: 0 },
            onLand: (landedTarget, activeGame, reason) => {
              if (reason !== 'landed' && reason !== 'blocked') return;
              const runtimeGame = activeGame ?? game;
              runtimeGame?.addExplosion?.(
                landedTarget.root.position,
                impactDamage,
                targetingPlayer
                  ? (weapon.playerImpactRadius ?? TRACTOR_PLAYER_IMPACT_RADIUS)
                  : 1.5,
                TRACTOR_BEAM_COLOR,
                {
                  source: this,
                  attackKind: targetingPlayer
                    ? 'tractorThrownPlayerImpact'
                    : 'tractorThrownEnemy',
                  powerfulKnockback: true,
                  damageEnemies: false,
                  damagePlayer: true,
                  playerDamageScale: 1,
                  unblockable: targetingPlayer,
                  triggerMines: false,
                },
              );
            },
          });
          if (launched) {
            brain.attackFired = true;
            this._setTractorObjective(null, null);
            brain.tractorBeamActive = false;
            this._removeTelegraphMarker();
            brain.state = 'recovery';
            brain.stateTime = 0;
            game.completeEnemyAttack?.(this);
          } else {
            this._abortTractorCycle('throw-failed', game);
          }
        }
      }
    } else if (brain.state === 'recovery') {
      brain.stateTime += dt;
      brain.moving = this._moveTractorAwayFromPlayer(dt, game, 1.55);
      brain.speedRatio = brain.moving ? 1.15 : 0;
      if (brain.stateTime >= this.genome.behavior.recoveryDuration) {
        brain.state = 'position';
        brain.stateTime = 0;
        brain.cooldown = this.stats.attackCooldown * this.aiRandom.float(0.88, 1.14);
        this._resetTractorApproach();
      }
    }

    this._updateExposureAndDefense();
    this._animateVisual(dt);
    this._updateTelegraphMarker(game);
    return { handled: true, moving: brain.moving, moveAmount: brain.speedRatio };
  }

  _selectTractorObjective(game) {
    const machine = this._findTractorTarget(game);
    if (machine) {
      return { target: machine, kind: 'enemy' };
    }
    if (this._canTargetPlayerWhenAlone(game)) {
      return { target: game.player, kind: 'player' };
    }
    return null;
  }

  _setTractorObjective(target, kind) {
    const brain = this.brain;
    const resolvedKind = target ? (kind ?? (target === this._runtimeGame?.player ? 'player' : 'enemy')) : null;
    if (brain.tractorTarget === target && brain.tractorTargetKind === resolvedKind) return;
    brain.tractorTarget = target;
    brain.tractorTargetKind = resolvedKind;
    brain.tractorPathFailureTime = 0;
    brain.tractorCargoTopOffset = 0;
    this._resetTractorApproach();
  }

  _isTractorObjectiveValid(game, requireClaim = false) {
    const brain = this.brain;
    const target = brain.tractorTarget;
    if (!target) return false;
    if (!brain.tractorTargetKind) {
      brain.tractorTargetKind = target === game.player ? 'player' : 'enemy';
    }
    if (brain.tractorTargetKind === 'player') {
      if (target !== game.player
        || target.dead
        || !this._canTargetPlayerWhenAlone(game, { ignoreExistingClaim: true })) {
        return false;
      }
      return !requireClaim || Boolean(target.hasExternalControl?.(this));
    }
    return brain.tractorTargetKind === 'enemy'
      && this._isValidTractorTarget(target, requireClaim);
  }

  _canTargetPlayerWhenAlone(game, { ignoreExistingClaim = false } = {}) {
    const player = game?.player;
    if (!player?.root || player.dead || game.dungeonController?.isPlayerInSafeZone?.()) {
      return false;
    }
    if (!ignoreExistingClaim
      && player.hasExternalControl?.()
      && !player.hasExternalControl?.(this)) {
      return false;
    }
    return !this._hasLivingTractorArenaAlly(game)
      && this._isPlayerInsideTractorArena(game);
  }

  _hasLivingTractorArenaAlly(game) {
    return (game?.enemies ?? []).some((enemy) => (
      enemy
      && enemy !== this
      && !enemy.dead
      && enemy.root
      && this._isPositionWithinTractorArena(enemy.root.position, game)
    ));
  }

  _isPlayerInsideTractorArena(game) {
    const playerPosition = game?.player?.root?.position;
    return Boolean(playerPosition && this._isPositionWithinTractorArena(playerPosition, game));
  }

  _getTractorArenaBounds(game = this._runtimeGame) {
    const arena = this.encounterArena;
    const center = arena?.zoneCenter ?? arena?.center;
    if (center && Number.isFinite(arena?.halfWidth) && Number.isFinite(arena?.halfDepth)) {
      return {
        center,
        halfWidth: arena.halfWidth,
        halfDepth: arena.halfDepth,
      };
    }

    const encounterId = this.encounterId ?? arena?.encounterId ?? null;
    const encounter = encounterId
      ? game?.dungeonController?.encounters?.find?.((candidate) => candidate.id === encounterId)
      : null;
    if (encounter?.zone?.position) {
      return {
        center: encounter.zone.position,
        halfWidth: encounter.zone.halfWidth,
        halfDepth: encounter.zone.halfDepth,
      };
    }
    return null;
  }

  _isPositionWithinTractorArena(position, game = this._runtimeGame) {
    if (!position) return false;
    const bounds = this._getTractorArenaBounds(game);
    if (bounds) {
      return Math.abs(position.x - bounds.center.x) <= bounds.halfWidth + 0.4
        && Math.abs(position.z - bounds.center.z) <= bounds.halfDepth + 0.4;
    }
    return flatDistance(position, this.root.position)
      <= (this.genome.behavior.aggroRange ?? 18);
  }

  _resetTractorApproach() {
    const brain = this.brain;
    brain.tractorApproachPhase = 'choose';
    brain.tractorApproachTimer = 0;
    brain.tractorZigzagSwitchTimer = 0;
    if (this.visual?.root) this.visual.root.rotation.z = 0;
  }

  _prepareTractorApproach(game, target) {
    const brain = this.brain;
    brain.tractorApproachStart.copy(this.root.position);
    this._getTractorApproachDestination(game, target, brain.tractorApproachDestination);
    brain.tractorApproachTimer = 0;
    brain.tractorZigzagSign = this.aiRandom.chance(0.5) ? 1 : -1;
    brain.tractorFlipDirection = this.aiRandom.chance(0.5) ? 1 : -1;
    brain.tractorZigzagInterval = this.aiRandom.float(
      TRACTOR_ZIGZAG_MIN_INTERVAL,
      TRACTOR_ZIGZAG_MAX_INTERVAL,
    );
    brain.tractorZigzagSwitchTimer = brain.tractorZigzagInterval;
    brain.tractorZigzagAmplitude = this.aiRandom.float(
      TRACTOR_ZIGZAG_MIN_AMPLITUDE,
      TRACTOR_ZIGZAG_MAX_AMPLITUDE,
    );
    const aligned = flatDistance(this.root.position, brain.tractorApproachDestination) <= 1.15
      && Math.abs(this.root.position.y - brain.tractorApproachDestination.y) <= 0.9;
    brain.tractorApproachPhase = aligned ? 'align' : 'flip';
  }

  _getTractorApproachDestination(game, target, out) {
    out.copy(target.root.position);
    out.y = this._getTractorControllerHeight(target);
    if (this.brain.tractorTargetKind !== 'player') {
      tempA.copy(this.root.position).sub(game.player.root.position).setY(0);
      const playerDistance = tempA.length();
      if (playerDistance < TRACTOR_PLAYER_AVOID_RADIUS) {
        if (playerDistance <= 0.001) tempA.set(this.genome.behavior.orbitDirection, 0, 0.35);
        tempA.normalize();
        out.addScaledVector(
          tempA,
          clamp01((TRACTOR_PLAYER_AVOID_RADIUS - playerDistance) / TRACTOR_PLAYER_AVOID_RADIUS) * 0.82,
        );
      }
    }
    return out;
  }

  _updateTractorApproach(dt, game, target) {
    const brain = this.brain;
    if (brain.tractorApproachPhase === 'choose') {
      this._prepareTractorApproach(game, target);
    }

    if (brain.tractorApproachPhase === 'flip') {
      brain.tractorApproachTimer += dt;
      const duration = this.genome.modules.weapon.flipWindupDuration
        ?? TRACTOR_FLIP_WINDUP_DURATION;
      const progress = clamp01(brain.tractorApproachTimer / Math.max(0.01, duration));
      this.visual.root.rotation.z = brain.tractorFlipDirection
        * Math.PI * 2
        * THREE.MathUtils.smootherstep(progress, 0, 1);
      if (progress >= 1) {
        this.visual.root.rotation.z = 0;
        brain.tractorApproachPhase = 'zigzag';
        brain.tractorApproachTimer = 0;
        brain.tractorZigzagSwitchTimer = brain.tractorZigzagInterval;
      }
      return { moving: false, aligned: false, speedRatio: 0 };
    }

    if (brain.tractorApproachPhase === 'zigzag') {
      brain.tractorApproachTimer += dt;
      brain.tractorZigzagSwitchTimer -= dt;
      if (brain.tractorZigzagSwitchTimer <= 0) {
        brain.tractorZigzagSign *= -1;
        brain.tractorZigzagInterval = this.aiRandom.float(
          TRACTOR_ZIGZAG_MIN_INTERVAL,
          TRACTOR_ZIGZAG_MAX_INTERVAL,
        );
        brain.tractorZigzagSwitchTimer += brain.tractorZigzagInterval;
      }

      const remaining = flatDistance(this.root.position, brain.tractorApproachDestination);
      tempB.copy(brain.tractorApproachDestination).sub(this.root.position).setY(0);
      if (tempB.lengthSq() <= 0.0001) tempB.set(0, 0, 1);
      else tempB.normalize();
      tempC.copy(brain.tractorApproachDestination);
      if (remaining > 1.35) {
        tempC.x += -tempB.z * brain.tractorZigzagSign * brain.tractorZigzagAmplitude;
        tempC.z += tempB.x * brain.tractorZigzagSign * brain.tractorZigzagAmplitude;
      }
      const moving = this._moveAirTowardPosition(
        dt,
        game,
        tempC,
        this.genome.modules.weapon.zigzagSpeedScale ?? TRACTOR_ZIGZAG_SPEED_SCALE,
      );
      tempD.copy(tempC).sub(this.root.position).setY(0);
      if (tempD.lengthSq() > 0.0001) {
        tempD.normalize();
        this._turnToward(tempD, dt, this.genome.behavior.turnRate * 4.2);
      }
      if (remaining <= 1.2 || brain.tractorApproachTimer >= TRACTOR_ZIGZAG_TIMEOUT) {
        brain.tractorApproachPhase = 'align';
        brain.tractorApproachTimer = 0;
      }
      return { moving, aligned: false, speedRatio: moving ? 2.7 : 0 };
    }

    if (brain.tractorTargetKind === 'player') {
      const playerDrift = flatDistance(target.root.position, brain.tractorApproachDestination);
      if (playerDrift > 2.2) {
        this._resetTractorApproach();
        return { moving: false, aligned: false, speedRatio: 0 };
      }
      tempC.copy(brain.tractorApproachDestination);
      const moving = this._moveAirTowardPosition(dt, game, tempC, TRACTOR_PURSUIT_SPEED_SCALE);
      const aligned = flatDistance(this.root.position, tempC) <= 1.15
        && Math.abs(this.root.position.y - tempC.y) <= 0.9;
      return { moving, aligned, speedRatio: moving ? 1.8 : 0 };
    }

    const moving = this._moveTractorAboveTarget(
      dt,
      game,
      target,
      TRACTOR_PURSUIT_SPEED_SCALE,
    );
    tempA.copy(target.root.position).sub(this.root.position).setY(0);
    const aligned = tempA.length() <= 1.15
      && Math.abs(this.root.position.y - this._getTractorControllerHeight(target)) <= 0.9;
    return { moving, aligned, speedRatio: moving ? 1.8 : 0 };
  }

  _beginTractorTelegraph(game, target, alreadyClaimed) {
    const brain = this.brain;
    brain.tractorCargoTopOffset = this._measureTractorCargoTopOffset(target);
    brain.state = 'telegraph';
    brain.stateTime = 0;
    brain.effectTimer = 0;
    brain.tractorLiftStart.copy(target.root.position);
    this._resetTractorApproach();
    if (brain.tractorTargetKind === 'player') {
      brain.tractorBeamPoint.copy(target.root.position);
      brain.targetPosition.copy(brain.tractorBeamPoint);
      this._createTelegraphMarker(
        game,
        this.genome.modules.weapon.playerCaptureRadius ?? TRACTOR_PLAYER_CAPTURE_RADIUS,
        TRACTOR_BEAM_COLOR,
      );
    } else if (!alreadyClaimed) {
      this._abortTractorCycle('claim-required', game);
    }
  }

  _enterTractorCommit(target) {
    this.brain.state = 'commit';
    this.brain.stateTime = 0;
    this.brain.attackFired = false;
    this.brain.tractorLiftStart.copy(target.root.position);
    this._removeTelegraphMarker();
  }

  _moveTractorAboveBeamPoint(dt, game, speedScale = TRACTOR_BEAM_TRACK_SPEED_SCALE) {
    tempC.copy(this.brain.tractorBeamPoint);
    tempC.y = this.brain.tractorApproachDestination.y
      || this._getTractorControllerHeight(game.player);
    return this._moveAirTowardPosition(dt, game, tempC, speedScale);
  }

  _updateTractorCrash(dt, game) {
    const brain = this.brain;
    brain.tractorCrashTimer += dt;
    brain.moving = false;
    brain.speedRatio = 0;
    brain.tractorBeamActive = false;
    brain.tractorBeamIntensity = 0;
    this.knockback.set(0, 0, 0);

    if (brain.tractorCrashPhase === 'falling') {
      const progress = clamp01(brain.tractorCrashTimer / TRACTOR_CRASH_FALL_DURATION);
      const eased = THREE.MathUtils.smoothstep(progress, 0, 1);
      this.root.position.lerpVectors(brain.tractorCrashStart, brain.tractorCrashLanding, eased);
      this.root.rotation.x = Math.sin(progress * Math.PI) * 0.24;
      this.root.rotation.z = eased * Math.PI * 0.5;
      if (progress >= 1) {
        brain.tractorCrashPhase = 'grounded';
        brain.tractorCrashTimer = 0;
        this.root.position.copy(brain.tractorCrashLanding);
        this.root.rotation.set(0, this.root.rotation.y, Math.PI * 0.5);
        game?.addParticleBurst?.(this.root.position, this.genome.palette.dark, 12, 0.12);
        game?.addHitEffect?.(this.root.position, TRACTOR_BEAM_COLOR, 0.65, { absolute: true });
      }
    } else if (brain.tractorCrashPhase === 'grounded') {
      this.root.position.copy(brain.tractorCrashLanding);
      this.root.rotation.x = 0;
      this.root.rotation.z = Math.PI * 0.5;
      if (brain.tractorCrashTimer >= TRACTOR_CRASH_GROUNDED_DURATION) {
        brain.tractorCrashPhase = 'relaunching';
        brain.tractorCrashTimer = 0;
        brain.tractorCrashStart.copy(this.root.position);
        brain.tractorCrashLanding.copy(this.root.position);
        brain.tractorCrashLanding.y += Math.max(1.85, this.hoverHeight + 0.9);
      }
    } else if (brain.tractorCrashPhase === 'relaunching') {
      const progress = clamp01(brain.tractorCrashTimer / TRACTOR_CRASH_RELAUNCH_DURATION);
      const eased = THREE.MathUtils.smootherstep(progress, 0, 1);
      this.root.position.lerpVectors(brain.tractorCrashStart, brain.tractorCrashLanding, eased);
      this.root.rotation.x = 0;
      this.root.rotation.z = THREE.MathUtils.lerp(Math.PI * 0.5, 0, eased);
      if (progress >= 1) {
        brain.tractorCrashPhase = null;
        brain.tractorCrashTimer = 0;
        brain.state = 'position';
        brain.stateTime = 0;
        brain.cooldown = Math.max(brain.cooldown, 0.35);
        this.root.position.copy(brain.tractorCrashLanding);
        this.root.rotation.x = 0;
        this.root.rotation.z = 0;
        this._resetTractorApproach();
      }
    }

    this._updateExposureAndDefense();
    this._animateVisual(dt);
    return { handled: true, moving: false, moveAmount: 0 };
  }

  _findTractorTarget(game) {
    const acquireRange = Math.max(
      14,
      (this.genome.modules.weapon.acquireRange ?? this.stats.attackRange ?? 8.5) * 1.45,
    );
    let best = null;
    let bestScore = Infinity;
    for (const enemy of game.enemies ?? []) {
      if (!this._isValidTractorTarget(enemy, false)) continue;
      if (!this._isPositionWithinTractorArena(enemy.root.position, game)) continue;
      const distance = flatDistance(enemy.root.position, this.root.position);
      if (distance > acquireRange) continue;
      if (!this._canReachTractorTarget(game, enemy)) continue;
      const sameEncounter = this.encounterId && enemy.encounterId === this.encounterId;
      const score = distance + (sameEncounter ? 0 : 4.5) + (enemy.navigationMode === 'air' ? 1.2 : 0);
      if (score < bestScore) {
        best = enemy;
        bestScore = score;
      }
    }
    return best;
  }

  _isValidTractorTarget(target, requireClaim = false) {
    if (!target || target === this || target.dead || !target.root) return false;
    if (target === this._runtimeGame?.player) return false;
    if (target.genome?.archetypeId === 'tractorController') return false;
    if (target.isBoss || target.type?.boss || target.typeKey === 'boss') return false;
    if (requireClaim) return Boolean(target.hasExternalControl?.(this));
    if (target.isExternalMotionActive?.()) return Boolean(target.hasExternalControl?.(this));
    return !target.hasExternalControl?.() || Boolean(target.hasExternalControl?.(this));
  }

  _canReachTractorTarget(game, target) {
    if (!target?.root) return false;
    const controller = game.dungeonController;
    if (!controller?.getAerialNavigationDirection) return true;
    tempD.copy(this.root.position);
    tempD.y += this.combatAimOffset;
    tempE.copy(target.root.position);
    tempE.y = this._getTractorControllerHeight(target) + this.combatAimOffset;
    const routeDirection = controller.getAerialNavigationDirection(
      tempD,
      tempE,
      this._getAerialCollisionOptions(),
    );
    if (!routeDirection) return false;

    // A reachable controller center is insufficient if the generated cargo
    // silhouette cannot rise into the magnet. Preflight the actual lift path
    // so an oversized claw or jaw is not repeatedly selected under a fixture.
    const prospectiveControllerRoot = target.root.position.clone();
    prospectiveControllerRoot.y = this._getTractorControllerHeight(target);
    const controllerDelta = prospectiveControllerRoot.clone().sub(this.root.position);
    const prospectiveCargoRoot = this._getTractorCarryAnchor(target, new THREE.Vector3())
      .add(controllerDelta);
    return this._isTractorCargoRootPathClear(
      game,
      target,
      target.root.position,
      prospectiveCargoRoot,
    );
  }

  _measureTractorCargoTopOffset(target) {
    if (this.brain.tractorTargetKind === 'player'
      && target === this._runtimeGame?.player) {
      return 1.68;
    }
    target.root.updateMatrixWorld(true);
    const visualRoot = target.visual?.root ?? target.root;
    tempBounds.setFromObject(visualRoot);
    if (tempBounds.isEmpty()) return (target.collisionHeight ?? 1.4) * 0.62;
    return Math.max(
      (target.collisionHeight ?? 1.4) * 0.45,
      tempBounds.max.y - target.root.position.y,
    );
  }

  _measureTractorCargoCollisionProfile(target) {
    if (this.brain.tractorTargetKind === 'player'
      && target === this._runtimeGame?.player) {
      return {
        radius: Math.max(0.42, target.radius ?? 0.42),
        centerOffsetY: 0.88,
        verticalRadius: 0.84,
      };
    }
    target.root.updateMatrixWorld(true);
    const visualRoot = target.visual?.root ?? target.root;
    tempBounds.setFromObject(visualRoot);
    if (tempBounds.isEmpty()) {
      const height = target.collisionHeight ?? 1.4;
      return {
        radius: Math.max(0.22, target.radius ?? 0.45),
        centerOffsetY: height * 0.45,
        verticalRadius: Math.max(0.38, height * 0.43),
      };
    }

    const rootPosition = target.root.position;
    const xExtent = Math.max(
      Math.abs(tempBounds.min.x - rootPosition.x),
      Math.abs(tempBounds.max.x - rootPosition.x),
    );
    const zExtent = Math.max(
      Math.abs(tempBounds.min.z - rootPosition.z),
      Math.abs(tempBounds.max.z - rootPosition.z),
    );
    const floorClearance = 0.035;
    return {
      // The corner radius is conservative under the captive's continuing
      // Y-axis rotation, including enormous off-center claws and jaws.
      radius: Math.max(0.22, target.radius ?? 0.45, Math.hypot(xExtent, zExtent)),
      centerOffsetY: ((tempBounds.min.y + tempBounds.max.y) * 0.5)
        - rootPosition.y
        + floorClearance,
      verticalRadius: Math.max(0.2, (tempBounds.max.y - tempBounds.min.y) * 0.5),
    };
  }

  _isTractorCargoRootPathClear(game, target, fromRootPosition, toRootPosition) {
    const controller = game.dungeonController;
    if (!controller?.isAerialPathClear) return true;
    const profile = this._measureTractorCargoCollisionProfile(target);
    tempG.copy(fromRootPosition);
    tempG.y += profile.centerOffsetY;
    tempH.copy(toRootPosition);
    tempH.y += profile.centerOffsetY;
    return controller.isAerialPathClear(tempG, tempH, {
      radius: profile.radius,
      verticalRadius: profile.verticalRadius,
    });
  }

  _getTractorMuzzleOffsetY() {
    this.root.updateMatrixWorld(true);
    this.visual.weapon.muzzle.getWorldPosition(tempF);
    return tempF.y - this.root.position.y;
  }

  _getTractorMagnetBottomOffsetY() {
    const magnet = this.root.getObjectByName('generatedTractorHorseshoeMagnet');
    if (!magnet) return this._getTractorMuzzleOffsetY();
    this.root.updateMatrixWorld(true);
    tempBounds.setFromObject(magnet);
    return tempBounds.isEmpty()
      ? this._getTractorMuzzleOffsetY()
      : tempBounds.min.y - this.root.position.y;
  }

  _getTractorControllerHeight(target) {
    const topOffset = this.brain.tractorTarget === target && this.brain.tractorCargoTopOffset > 0
      ? this.brain.tractorCargoTopOffset
      : this._measureTractorCargoTopOffset(target);
    return target.root.position.y
      + TRACTOR_CARGO_ROOT_LIFT
      + topOffset
      + TRACTOR_CARGO_GAP
      - this._getTractorMagnetBottomOffsetY();
  }

  _moveTractorAboveTarget(dt, game, target, speedScale = 1) {
    tempC.copy(target.root.position);
    tempC.y = this._getTractorControllerHeight(target);

    // The controller still has to enter beam alignment, but biases that
    // approach to the side opposite MegaMan. The offset remains inside the
    // tractor's acquisition tolerance so avoidance cannot deadlock a rescue.
    tempA.copy(this.root.position).sub(game.player.root.position).setY(0);
    const playerDistance = tempA.length();
    if (playerDistance < TRACTOR_PLAYER_AVOID_RADIUS) {
      if (playerDistance <= 0.001) {
        tempA.copy(target.root.position).sub(game.player.root.position).setY(0);
        if (tempA.lengthSq() <= 0.001) {
          tempA.set(this.genome.behavior.orbitDirection, 0, 0.35);
        }
      }
      tempA.normalize();
      const avoidance = clamp01(
        (TRACTOR_PLAYER_AVOID_RADIUS - playerDistance) / TRACTOR_PLAYER_AVOID_RADIUS,
      ) * 0.82;
      tempC.addScaledVector(tempA, avoidance);
    }
    return this._moveAirTowardPosition(dt, game, tempC, speedScale);
  }

  _moveTractorTowardThrowPosition(dt, game, target) {
    tempA.copy(this.root.position).sub(game.player.root.position).setY(0);
    if (tempA.lengthSq() <= 0.001) tempA.set(0, 0, -1);
    tempA.normalize();
    tempC.copy(game.player.root.position).addScaledVector(tempA, 3.8);
    tempC.y = game.player.root.position.y + 1.75;
    return this._moveAirTowardPosition(dt, game, tempC, 2.2, target);
  }

  _moveTractorAwayFromPlayer(dt, game, speedScale = 1) {
    tempA.copy(this.root.position).sub(game.player.root.position).setY(0);
    const distance = tempA.length();
    if (distance >= TRACTOR_PLAYER_AVOID_RADIUS + 1.2) return false;
    if (distance <= 0.001) {
      tempA.set(this.genome.behavior.orbitDirection, 0, 0.4);
    }
    tempA.normalize();
    tempB.set(tempA.z * this.genome.behavior.orbitDirection, 0, -tempA.x * this.genome.behavior.orbitDirection);
    tempA.addScaledVector(tempB, 0.24).normalize();
    tempC.copy(this.root.position).addScaledVector(tempA, 5.2);
    tempC.y = Math.max(this.root.position.y, game.player.root.position.y + 2.15);
    return this._moveAirTowardPosition(dt, game, tempC, speedScale);
  }

  _getTractorCarryAnchor(target, out) {
    this.root.updateMatrixWorld(true);
    this.visual.weapon.muzzle.getWorldPosition(out);
    const topOffset = this.brain.tractorTarget === target && this.brain.tractorCargoTopOffset > 0
      ? this.brain.tractorCargoTopOffset
      : this._measureTractorCargoTopOffset(target);
    // Place the captive's actual visual top below the lowest generated pole
    // piece. Using the magnet bounds, rather than the abstract muzzle, keeps
    // the gap stable across flyer scales and oversized modular silhouettes.
    const magnet = this.root.getObjectByName('generatedTractorHorseshoeMagnet');
    if (magnet) {
      tempBounds.setFromObject(magnet);
      if (!tempBounds.isEmpty()) {
        out.y = tempBounds.min.y - topOffset - TRACTOR_CARGO_GAP;
        return out;
      }
    }
    out.y -= topOffset + TRACTOR_CARGO_GAP;
    return out;
  }

  _setTractorBeamForTarget(target, intensity) {
    this._setTractorBeamAtPosition(
      target.root.position,
      (target.collisionHeight ?? 1.4) * 0.45,
      intensity,
    );
  }

  _setTractorBeamAtPosition(position, verticalOffset, intensity) {
    this.root.updateMatrixWorld(true);
    this.visual.weapon.muzzle.getWorldPosition(tempA);
    tempB.copy(position);
    tempB.y += verticalOffset;
    if (this.visual.weapon.tractorDirection) {
      this.visual.weapon.group.worldToLocal(tempC.copy(tempB));
      this.visual.weapon.tractorDirection
        .copy(tempC)
        .sub(this.visual.weapon.muzzle.position)
        .normalize();
    }
    this.brain.tractorBeamActive = true;
    this.brain.tractorBeamIntensity = intensity;
    this.brain.tractorBeamLength = THREE.MathUtils.clamp(tempA.distanceTo(tempB), 1.1, 6.2);
  }

  _findTractorPlayerThrowLanding(game, target, arcHeight = 2.45) {
    const controller = game.dungeonController;
    tempD.copy(this.brain.tractorBeamPoint);
    tempD.y = controller?.getSurfaceElevationAt?.(tempD) ?? game.player.root.position.y;
    tempB.copy(this.brain.tractorBeamPoint).sub(this.brain.tractorApproachStart).setY(0);
    if (tempB.lengthSq() <= 0.001) {
      tempB.copy(game.player.lastMoveDirection ?? WORLD_FORWARD).setY(0);
    }
    if (tempB.lengthSq() <= 0.001) tempB.copy(WORLD_FORWARD);
    tempB.normalize();

    const preferredDistance = this.genome.modules.weapon.playerThrowDistance
      ?? TRACTOR_PLAYER_THROW_DISTANCE;
    const radii = [preferredDistance, preferredDistance * 0.82, preferredDistance * 0.64, 2.2];
    const angles = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI];
    for (const radius of radii) {
      for (const angle of angles) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        tempC.set(
          tempD.x + (tempB.x * cos - tempB.z * sin) * radius,
          tempD.y,
          tempD.z + (tempB.x * sin + tempB.z * cos) * radius,
        );
        tempC.y = controller?.getSurfaceElevationAt?.(tempC) ?? tempC.y;
        if (controller?.isPositionWalkable && !controller.isPositionWalkable(tempC)) continue;
        if (!this._isPositionInsideTractorArena(tempC)) continue;
        if (this._isTractorThrowArcClear(game, target, tempC, arcHeight)) {
          return tempC.clone();
        }
      }
    }
    return null;
  }

  _isPositionInsideTractorArena(position) {
    const bounds = this._getTractorArenaBounds();
    if (!bounds) {
      return true;
    }
    const margin = Math.max(0.6, this._runtimeGame?.player?.radius ?? 0.42);
    return Math.abs(position.x - bounds.center.x) <= Math.max(0.5, bounds.halfWidth - margin)
      && Math.abs(position.z - bounds.center.z) <= Math.max(0.5, bounds.halfDepth - margin);
  }

  _findTractorThrowLanding(game, target, arcHeight = 2.1) {
    const controller = game.dungeonController;
    tempD.copy(game.player.root.position);
    tempB.copy(game.player.lastMoveDirection ?? WORLD_FORWARD).setY(0);
    if (tempB.lengthSq() <= 0.001) tempB.copy(WORLD_FORWARD);
    tempB.normalize();
    tempD.addScaledVector(tempB, 0.75);
    const angles = [0, Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI / 4, -Math.PI / 4];
    const radii = [0, 0.7, 1.25, 1.8];
    for (const radius of radii) {
      for (const angle of angles) {
        tempC.set(
          tempD.x + Math.sin(angle) * radius,
          tempD.y,
          tempD.z + Math.cos(angle) * radius,
        );
        tempC.y = controller?.getSurfaceElevationAt?.(tempC) ?? tempC.y;
        const walkable = !controller?.isPositionWalkable || controller.isPositionWalkable(tempC);
        if (walkable && this._isTractorThrowArcClear(game, target, tempC, arcHeight)) {
          return tempC.clone();
        }
      }
    }
    return null;
  }

  _isTractorThrowArcClear(game, target, landingRootPosition, arcHeight) {
    const controller = game.dungeonController;
    if (!controller?.isAerialPositionClear || !target?.root) return true;
    const profile = this._measureTractorCargoCollisionProfile(target);
    const options = {
      radius: profile.radius,
      verticalRadius: profile.verticalRadius,
    };
    const distance = target.root.position.distanceTo(landingRootPosition);
    const steps = Math.max(12, Math.ceil(distance / 0.28));
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      tempE.copy(target.root.position).lerp(landingRootPosition, progress);
      tempE.y += Math.sin(progress * Math.PI) * arcHeight;
      tempE.y += profile.centerOffsetY;
      if (!controller.isAerialPositionClear(tempE, options)) return false;
    }
    return true;
  }

  _abortTractorCycle(reason, game = null) {
    (game ?? this._runtimeGame)?.completeEnemyAttack?.(this);
    this._removeTelegraphMarker();
    this._releaseTractorTarget(reason, game);
    this._resetTractorApproach();
    this.brain.state = 'recovery';
    this.brain.stateTime = 0;
    this.brain.moving = false;
  }

  _findTractorReleaseLanding(game, target) {
    const controller = game.dungeonController;
    if (!controller || !target?.root) return null;
    const origin = target.root.position;
    const cargoProfile = this._measureTractorCargoCollisionProfile(target);
    const angles = [
      0,
      Math.PI / 4,
      Math.PI / 2,
      Math.PI * 3 / 4,
      Math.PI,
      -Math.PI * 3 / 4,
      -Math.PI / 2,
      -Math.PI / 4,
    ];
    // Articulated hounds and massive claw/jaw carriers can be much wider than
    // their navigation root while rotating beneath the magnet. Search beyond
    // that full silhouette when a direct drop is obstructed, otherwise a
    // Controller can simply release control and strand large cargo in midair.
    const radii = [...new Set([
      0,
      0.75,
      1.35,
      2.1,
      3,
      Number((cargoProfile.radius + 0.6).toFixed(3)),
      Number((cargoProfile.radius + 1.5).toFixed(3)),
      Number((cargoProfile.radius + 2.6).toFixed(3)),
    ])].filter((radius) => radius <= 7.5).sort((left, right) => left - right);
    for (const radius of radii) {
      for (const angle of angles) {
        tempD.set(
          origin.x + Math.sin(angle) * radius,
          origin.y,
          origin.z + Math.cos(angle) * radius,
        );
        tempD.y = controller.getSurfaceElevationAt?.(tempD) ?? tempD.y;
        if (controller.isPositionWalkable && !controller.isPositionWalkable(tempD)) continue;
        const arcHeight = radius <= 0.01 ? 0 : Math.min(1.35, 0.38 + radius * 0.34);
        if (this._isTractorThrowArcClear(game, target, tempD, arcHeight)) {
          return { position: tempD.clone(), arcHeight };
        }
      }
    }
    return null;
  }

  _releaseTractorTarget(reason = 'released', game = null) {
    const target = this.brain?.tractorTarget;
    const targetWasPlayer = this.brain?.tractorTargetKind === 'player';
    if (target?.hasExternalControl?.(this)) {
      let dropping = false;
      if (game && (targetWasPlayer || target.navigationMode === 'ground')) {
        target.root.rotation.x = 0;
        target.root.rotation.z = 0;
        const release = this._findTractorReleaseLanding(game, target);
        if (release) {
          dropping = Boolean(target.startExternalBallisticMotion?.(this, {
            targetPosition: release.position,
            duration: THREE.MathUtils.clamp(
              0.36 + target.root.position.distanceTo(release.position) * 0.07,
              0.42,
              0.82,
            ),
            arcHeight: release.arcHeight,
            spinRate: { x: 0, y: 3.5, z: 0 },
          }));
        }
      }
      if (!dropping) target.releaseExternalControl?.(this, reason);
      if (!dropping) {
        target.root.rotation.x = 0;
        target.root.rotation.z = 0;
      }
    }
    if (this.brain) {
      this.brain.tractorTarget = null;
      this.brain.tractorTargetKind = null;
      this.brain.tractorBeamActive = false;
      this.brain.tractorBeamIntensity = 0;
      this.brain.tractorCargoTopOffset = 0;
      this._resetTractorApproach();
    }
  }

  _fireAttack(game) {
    const kind = this._getEffectiveAttackKind();
    switch (kind) {
      case 'melee':
        this._tryContactHit(game, 0.55);
        break;
      case 'shockwave':
        game.addExplosion(this.root.position, this.stats.damage, 1.9, this.genome.palette.emissive, {
          source: this,
          attackKind: 'shockwave',
          powerfulKnockback: true,
          damageEnemies: false,
          damagePlayer: true,
          playerDamageScale: 1,
          triggerMines: false,
        });
        break;
      case 'projectile':
        this._fireDirectProjectile(game);
        break;
      case 'mortar':
      case 'mine':
        this._fireMortar(game, kind === 'mine');
        break;
      case 'electricOrb':
        this._fireElectricOrb(game);
        break;
      case 'beam':
        this._fireBeam(game);
        break;
      case 'selfDestruct':
        this._selfDestruct(game);
        break;
      default:
        this._tryContactHit(game, 0.5);
        break;
    }
  }

  _fireDirectProjectile(game) {
    this.visual.weapon.muzzle.getWorldPosition(tempA);
    tempB.copy(game.player.root.position).setY(game.player.root.position.y + 1.05).sub(tempA).normalize();
    game.projectiles.spawn({
      owner: 'enemy',
      position: tempA,
      direction: tempB.clone(),
      speed: this.genome.modules.weapon.projectileSpeed ?? 7,
      range: this.stats.attackRange + 1.2,
      radius: 0.19,
      damage: this.stats.damage,
      color: this.genome.palette.emissive,
      source: this,
      visualType: 'shell',
    });
    game.addParticleBurst(tempA, this.genome.palette.emissive, 9, 0.1);
  }

  _fireMortar(game, mine = false) {
    this.visual.weapon.muzzle.getWorldPosition(tempA);
    tempB.copy(this.brain.targetPosition).sub(tempA).setY(0);
    const distance = Math.max(1.1, tempB.length());
    tempB.normalize();
    const weapon = this.genome.modules.weapon;
    game.projectiles.spawn({
      owner: 'enemy',
      position: tempA,
      direction: tempB.clone(),
      speed: weapon.projectileSpeed ?? (mine ? 4.1 : 5.1),
      range: distance + 0.35,
      radius: mine ? 0.2 : 0.24,
      damage: this.stats.damage,
      color: this.genome.palette.emissive,
      source: this,
      explosiveRadius: weapon.explosiveRadius ?? (mine ? 1.15 : 1.25),
      explodeOnExpire: true,
      arcHeight: (mine ? 0.7 : 1.35) + distance * 0.1,
      endY: this.brain.targetPosition.y + 0.1,
      visualType: 'grenade',
      clusterCount: weapon.clusterCount ?? 0,
      clusterDamageMultiplier: 0.38,
      clusterExplosionRadius: 0.62,
      clusterSpreadRadius: 1.2,
      clusterArcHeight: 0.36,
      landAsMine: mine,
      mineLifetime: 5.5,
      mineArmDelay: 0.5,
      mineTriggerRadius: 1.1,
    });
    game.addParticleBurst(tempA, this.genome.palette.emissive, 11, 0.12);
    this._removeTelegraphMarker();
  }

  _fireElectricOrb(game) {
    this.visual.weapon.muzzle.getWorldPosition(tempA);
    tempB.copy(game.player.root.position).setY(game.player.root.position.y + 0.9).sub(tempA).normalize();
    const lifetime = 4.2;
    const speed = this.genome.modules.weapon.projectileSpeed ?? 1.25;
    game.projectiles.spawn({
      owner: 'enemy',
      position: tempA,
      direction: tempB.clone(),
      speed,
      range: speed * lifetime,
      lifetime,
      radius: 0.28,
      collisionRadius: 0.9,
      damage: this.stats.damage,
      color: this.genome.palette.emissive,
      source: this,
      visualType: 'electricOrb',
      persistentOnPlayerHit: true,
      hitInterval: 0.36,
      maxPlayerHits: 7,
    });
    game.addParticleBurst(tempA, this.genome.palette.emissive, 14, 0.11);
  }

  _updateFlamethrower(dt, game) {
    const brain = this.brain;
    brain.tickTimer -= dt;
    this.visual.weapon.muzzle.getWorldPosition(tempA);
    game.updateFlamethrowerEffect?.(this, dt, tempA, brain.attackDirection, {
      range: this.stats.attackRange,
      halfAngle: 0.78,
      color: 0xff7b32,
      secondaryColor: 0xffd36f,
      opacity: 0.3,
      particleOpacity: 0.7,
      particleCount: 36,
      baseScale: 0.25,
      groundY: this.root.position.y,
      name: 'generatedReaverbotFlamethrowerCone',
    });

    if (brain.tickTimer > 0) return;
    brain.tickTimer = 0.16;
    tempB.copy(game.player.root.position).sub(tempA).setY(0);
    const distance = tempB.length();
    if (distance <= 0.001 || distance > this.stats.attackRange + game.player.radius) return;
    if (Math.abs((game.player.root.position.y + 1) - tempA.y) > 1.35) return;
    tempB.divideScalar(distance);
    if (tempB.dot(brain.attackDirection) < Math.cos(0.78)) return;
    const hitResult = game.player.takeIncomingHit({
      amount: this.stats.damage,
      source: this,
      guardable: true,
      reactionTier: 0,
    });
    if (hitResult.healthDamage > 0) {
      this.onHitPlayer(game.player, hitResult.healthDamage);
    }
    if (isResolvedPlayerContact(hitResult)) {
      game.addHitEffect(game.player.root.position, 0xff6a2e, 0.42);
    }
  }

  _fireBeam(game) {
    this.visual.weapon.muzzle.getWorldPosition(tempA);
    tempB.copy(this.brain.attackDirection).normalize();
    showBeam(game, tempA, tempB, this.stats.attackRange, this.genome.palette.emissive);
    tempC.copy(game.player.root.position);
    tempC.y += 1;
    if (distanceToRay(tempC, tempA, tempB, this.stats.attackRange) <= game.player.radius + 0.48) {
      const hitResult = game.player.takeIncomingHit({
        amount: this.stats.damage,
        source: this,
        guardable: true,
        reactionTier: 1,
      });
      if (hitResult.healthDamage > 0) {
        this.onHitPlayer(game.player, hitResult.healthDamage);
      }
      if (isResolvedPlayerContact(hitResult)) {
        game.addHitEffect(game.player.root.position, this.genome.palette.emissive, 0.72);
      }
    }
  }

  _selfDestruct(game) {
    const radius = this.genome.modules.weapon.explosiveRadius ?? 3;
    game.addExplosion(this.root.position, this.stats.damage, radius, this.genome.palette.emissive, {
      source: this,
      damageEnemies: false,
      damagePlayer: true,
      playerDamageScale: 1,
      triggerMines: false,
    });
    game.damageEnemy(this, this.health + this.stats.maxHealth, {
      source: this,
      selfDestruct: true,
      unblockable: true,
      statusTick: true,
    });
    this._removeTelegraphMarker();
  }

  _tryContactHit(game, padding = 0.5) {
    if (this.brain.attackHit) return;
    if (Math.abs(this.root.position.y - game.player.root.position.y) > 1.4) return;
    if (flatDistance(this.root.position, game.player.root.position) > this.radius + game.player.radius + padding) return;
    this.brain.attackHit = true;
    const attackKind = this._getEffectiveAttackKind();
    tempC.copy(game.player.root.position).sub(this.root.position).setY(0);
    if (tempC.lengthSq() <= 0.0001) tempC.copy(this.brain.attackDirection);
    tempC.normalize();
    const powerfulKnockback = attackKind === 'charge' || attackKind === 'pounce';
    const hitResult = game.player.takeIncomingHit({
      amount: this.stats.damage,
      source: this,
      attackKind,
      guardable: true,
      reactionTier: powerfulKnockback ? 3 : 1,
      knockbackDirection: tempC,
      knockbackStrength: attackKind === 'charge' ? 1.2 : attackKind === 'pounce' ? 1.08 : 1,
    });
    const resolvedContact = isResolvedPlayerContact(hitResult);
    if (hitResult.healthDamage > 0) {
      this.onHitPlayer(game.player, hitResult.healthDamage);
    }
    if (resolvedContact) {
      this.beginContactRetreat(game, game.player);
      game.addHitEffect(game.player.root.position, this.genome.palette.emissive, 0.58);
      game.requestHitStop?.(0.08, { timeScale: 0.05 });
    }
  }

  _moveByMode(mode, dt, game, toPlayer, distance) {
    if (this._usesSpringLocomotion() && this.brain.coilBounceActive) {
      return this._updateCoilBounce(dt, game);
    }
    if (mode === 'hold') return false;
    let speedScale = mode.includes('Slow') ? 0.55 : 1;

    if (this.navigationMode === 'air') {
      tempA.copy(game.player.root.position).sub(this.root.position).setY(0);
      const horizontalDistance = tempA.length();
      if (horizontalDistance > 0.001) tempA.divideScalar(horizontalDistance);
      else tempA.copy(WORLD_FORWARD);
      const cruiseHeight = this.genome.archetypeId === 'aerialBomber' ? 0.45 : 0.95;
      tempC.copy(game.player.root.position);
      tempC.y += cruiseHeight;

      if (mode === 'retreat') {
        tempC.copy(this.root.position).addScaledVector(tempA, -3.2);
        tempC.y = game.player.root.position.y + cruiseHeight;
        speedScale = 0.7;
      } else if (mode === 'approach' || mode === 'approachSlow') {
        // Aim for the outside edge of the authored attack envelope instead of
        // the player's center. This prevents a long frame from turning an
        // approach into incidental body contact before the next AI update.
        const stopDistance = this._getAttackApproachRange();
        tempC.addScaledVector(tempA, -stopDistance);
      } else if (!['approach', 'approachSlow'].includes(mode)) {
        const side = this.genome.behavior.orbitDirection;
        tempB.set(tempA.z * side, 0, -tempA.x * side);
        const preferred = this.genome.behavior.preferredRange ?? 4.5;
        tempB.addScaledVector(tempA, THREE.MathUtils.clamp((horizontalDistance - preferred) * 0.24, -0.5, 0.6));
        if (tempB.lengthSq() <= 0.001) tempB.copy(tempA);
        tempB.normalize();
        tempC.copy(this.root.position).addScaledVector(tempB, 3.2);
        tempC.y = game.player.root.position.y + cruiseHeight;
        speedScale = mode.includes('Slow') ? 0.45 : 0.76;
      }
      return this._moveAirTowardPosition(dt, game, tempC, speedScale);
    }

    if (mode === 'approach' || mode === 'approachSlow') {
      const navigation = game.dungeonController?.getEnemyNavigationDirection?.(
        this,
        game.player.root.position,
      ) ?? game.dungeonController?.getNavigationDirection?.(
        this.root.position,
        game.player.root.position,
      );
      tempB.copy(navigation ?? toPlayer).setY(0);
    } else if (mode === 'retreat') {
      tempB.copy(toPlayer).multiplyScalar(-1);
      speedScale = 0.7;
    } else {
      const side = this.genome.behavior.orbitDirection;
      tempB.set(toPlayer.z * side, 0, -toPlayer.x * side);
      const radialCorrection = mode === 'flank'
        ? THREE.MathUtils.clamp((distance - 2.4) * 0.24, -0.4, 0.5)
        : mode === 'jawOrbit'
          ? THREE.MathUtils.clamp((distance - 2.1) * 0.34, -0.55, 0.64)
          : THREE.MathUtils.clamp((distance - this.genome.behavior.preferredRange) * 0.18, -0.36, 0.36);
      tempB.addScaledVector(toPlayer, radialCorrection);
      speedScale = mode === 'jawOrbit' ? 1.05 : mode.includes('Slow') ? 0.42 : 0.72;
    }

    if (tempB.lengthSq() <= 0.001) return false;
    tempB.normalize();

    if (!['approach', 'approachSlow'].includes(mode)
      && game.dungeonController?.getEnemyNavigationDirection) {
      tempC.copy(this.root.position).addScaledVector(tempB, 3.2);
      const guardedDirection = game.dungeonController.getEnemyNavigationDirection(this, tempC);
      if (guardedDirection?.lengthSq() > 0.0001) {
        tempB.copy(guardedDirection).setY(0).normalize();
      }
    }

    if (this._usesSpringLocomotion()) {
      const maximumTravel = mode === 'approach' || mode === 'approachSlow'
        ? Math.max(0, distance - this._getAttackApproachRange())
        : Infinity;
      return this._updateCoilBounce(dt, game, tempB, speedScale, maximumTravel);
    }

    let step = this.stats.moveSpeed * this._getStatusMoveMultiplier() * speedScale * dt;
    if (mode === 'approach' || mode === 'approachSlow') {
      step = Math.min(step, Math.max(0, distance - this._getAttackApproachRange()));
    }
    if (step <= 0.0001) return false;
    this.root.position.addScaledVector(tempB, step);
    return true;
  }

  _updateCoilBounce(
    dt,
    game,
    desiredDirection = null,
    speedScale = 1,
    maximumTravel = Infinity,
  ) {
    const brain = this.brain;
    const weapon = this.genome.modules.weapon;
    if (brain.coilBounceActive) {
      brain.coilBounceTime = Math.min(
        brain.coilBounceDuration,
        brain.coilBounceTime + Math.max(0, dt),
      );
      const progress = clamp01(brain.coilBounceTime / Math.max(0.01, brain.coilBounceDuration));
      this.root.position.lerpVectors(brain.coilBounceStart, brain.coilBounceLanding, progress);
      this.root.position.y += Math.sin(progress * Math.PI) * brain.coilBounceHeight;
      if (progress >= 1) {
        brain.coilBounceActive = false;
        brain.coilBounceTime = 0;
        brain.coilBounceCooldown = this.aiRandom.float(0.12, 0.22);
        brain.springBounceFailures = 0;
        this.root.position.copy(brain.coilBounceLanding);
      }
      return true;
    }

    brain.coilBounceCooldown = Math.max(0, brain.coilBounceCooldown - dt);
    if (brain.coilBounceCooldown > 0 || !desiredDirection || desiredDirection.lengthSq() <= 0.0001) {
      return false;
    }

    tempA.copy(desiredDirection).setY(0).normalize();
    const jumpDistanceScale = weapon.locomotionJumpDistanceScale ?? 1;
    const jumpDistance = Math.min(maximumTravel, THREE.MathUtils.clamp(
      this.stats.moveSpeed
        * this._getStatusMoveMultiplier()
        * speedScale
        * 0.78
        * jumpDistanceScale,
      1.65 * Math.min(1.12, jumpDistanceScale),
      4.15 * jumpDistanceScale,
    ));
    if (jumpDistance <= 0.0001) return false;
    const controller = game.dungeonController;
    let foundLanding = false;
    const baseDirectionX = tempA.x;
    const baseDirectionZ = tempA.z;
    landingSearch:
    for (const directionOffset of [0, 0.42, -0.42, 0.82, -0.82, Math.PI]) {
      const cos = Math.cos(directionOffset);
      const sin = Math.sin(directionOffset);
      tempD.set(
        baseDirectionX * cos - baseDirectionZ * sin,
        0,
        baseDirectionX * sin + baseDirectionZ * cos,
      ).normalize();
      for (const distanceScale of [1, 0.78, 0.56, 0.36]) {
        tempB.copy(this.root.position).addScaledVector(tempD, jumpDistance * distanceScale);
        const arenaTarget = controller?.getEnemyArenaTarget?.(this, tempB, tempE);
        if (arenaTarget) {
          tempB.x = arenaTarget.x;
          tempB.z = arenaTarget.z;
        }
        // Supplying the player's elevation as a probe allows the surface query
        // to recognize a platform above the spring chassis' current floor.
        tempB.y = Math.max(this.root.position.y, game.player.root.position.y);
        tempB.y = controller?.getSurfaceElevationAt?.(tempB) ?? tempB.y;
        const elevationDelta = tempB.y - this.root.position.y;
        if (elevationDelta > 4.4 || elevationDelta < -3.2) continue;
        const clearLanding = controller?.isEnemyPositionClear
          ? controller.isEnemyPositionClear(this, tempB, { maximumElevationDelta: 4.6 })
          : !controller?.isPositionWalkable || controller.isPositionWalkable(tempB);
        if (!clearLanding) continue;

        const preferredHeight = Math.max(
          COIL_BOUNCE_MIN_HEIGHT,
          weapon.navigationJumpHeight ?? 0,
          Math.max(0, elevationDelta) + 1.25,
          Math.abs(elevationDelta) * 0.45 + 1.7,
        );
        const heightCandidates = Math.abs(elevationDelta) <= 0.5
          ? [preferredHeight, 1.25]
          : [preferredHeight];
        for (const jumpHeight of heightCandidates) {
          if (!this._isCoilBounceArcClear(game, this.root.position, tempB, jumpHeight)) continue;
          brain.coilBounceLanding.copy(tempB);
          brain.coilBounceHeight = jumpHeight;
          foundLanding = true;
          break landingSearch;
        }
      }
    }

    if (!foundLanding) {
      brain.springBounceFailures += 1;
      brain.coilBounceCooldown = 0.12;
      if (brain.springBounceFailures >= 3 && controller?.findNearestEnemyClearPosition) {
        tempD.copy(this.root.position).addScaledVector(tempA, jumpDistance * 0.75);
        const recovery = controller.findNearestEnemyClearPosition(this, tempD, {
          preferredPosition: this.encounterArena?.center ?? this.root.position,
          maximumRadius: 3.6,
          maximumElevationDelta: 1.2,
        });
        if (recovery) this.setNavigationRecoveryTarget?.(recovery, 1.4);
      }
      return false;
    }

    brain.springBounceFailures = 0;
    brain.coilBounceActive = true;
    brain.coilBounceTime = 0;
    const navigationJumpDuration = weapon.navigationJumpDuration ?? COIL_BOUNCE_DURATION;
    brain.coilBounceDuration = THREE.MathUtils.clamp(
      navigationJumpDuration + Math.max(0, brain.coilBounceLanding.y - this.root.position.y) * 0.055,
      COIL_BOUNCE_DURATION,
      Math.max(0.82, navigationJumpDuration + 0.1),
    );
    brain.coilBounceStart.copy(this.root.position);
    return true;
  }

  _isCoilBounceArcClear(game, startRootPosition, landingRootPosition, jumpHeight) {
    const controller = game.dungeonController;
    if (!controller?.isAerialPositionClear) return true;
    const horizontalDistance = flatDistance(startRootPosition, landingRootPosition);
    const steps = Math.max(10, Math.ceil(horizontalDistance / 0.24));
    const centerOffset = Math.max(0.42, this.collisionHeight * 0.43);
    const options = {
      radius: Math.max(0.2, this.radius * 0.72),
      verticalRadius: Math.max(0.3, this.collisionHeight * 0.32),
    };
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      tempC.copy(startRootPosition).lerp(landingRootPosition, progress);
      tempC.y += Math.sin(progress * Math.PI) * jumpHeight + centerOffset;
      if (!controller.isAerialPositionClear(tempC, options)) return false;
    }
    return true;
  }

  _moveAirTowardPosition(dt, game, targetRootPosition, speedScale = 1, carriedTarget = null) {
    tempA.copy(this.root.position);
    tempA.y += this.combatAimOffset;
    tempB.copy(targetRootPosition);
    tempB.y += this.combatAimOffset;
    const distance = tempA.distanceTo(tempB);
    if (distance <= 0.015) return false;

    const controller = game.dungeonController;
    let direction = null;
    if (controller?.getAerialNavigationDirection) {
      direction = controller.getAerialNavigationDirection(
        tempA,
        tempB,
        this._getAerialCollisionOptions(),
      );
      // A null result means every tested over/around route is blocked. Do not
      // fall through a wall just because direct pursuit would be shorter.
      if (!direction) return false;
    } else {
      direction = tempC.copy(tempB).sub(tempA).normalize();
    }

    const step = Math.min(
      distance,
      this.stats.moveSpeed * this._getStatusMoveMultiplier() * speedScale * dt,
    );
    tempD.copy(this.root.position).addScaledVector(direction, step);

    if (carriedTarget && controller?.isAerialPathClear) {
      const cargoProfile = this._measureTractorCargoCollisionProfile(carriedTarget);
      tempE.copy(carriedTarget.root.position);
      tempE.y += cargoProfile.centerOffsetY;
      this._getTractorCarryAnchor(carriedTarget, tempF);
      tempF.sub(this.root.position).add(tempD);
      tempF.y += cargoProfile.centerOffsetY;
      const cargoOptions = {
        radius: cargoProfile.radius,
        verticalRadius: cargoProfile.verticalRadius,
      };
      if (!controller.isAerialPathClear(tempE, tempF, cargoOptions)) return false;
    }

    this.root.position.copy(tempD);
    return step > 0.0001;
  }

  _turnToward(direction, dt, rate) {
    if (direction.lengthSq() <= 0.0001) return;
    const targetYaw = Math.atan2(direction.x, direction.z);
    const delta = angleDelta(this.root.rotation.y, targetYaw);
    this.root.rotation.y += THREE.MathUtils.clamp(delta, -rate * dt, rate * dt);
  }

  _isAttackDistance(distance) {
    const kind = this._getEffectiveAttackKind();
    if (this.genome.archetypeId === 'shieldSentinel'
      && !(this._isClawCarrier() && this.brain.clawDestroyed)) {
      return distance <= Math.min(this.stats.attackRange, this.genome.behavior.preferredRange + 0.45);
    }
    if (kind === 'charge') {
      return distance >= CHARGE_MINIMUM_INITIATION_RANGE
        && distance <= Math.max(CHARGE_INITIATION_RANGE, this.stats.attackRange);
    }
    if (kind === 'pounce') return distance <= this.stats.attackRange;
    if (kind === 'selfDestruct') return distance <= this.stats.attackRange + 0.4;
    if (['melee', 'clawMoveset', 'jawCombo', 'shockwave'].includes(kind)) return distance <= this.stats.attackRange + 0.5;
    return distance <= this.stats.attackRange;
  }

  _getAttackApproachRange() {
    const kind = this._getEffectiveAttackKind();
    if (this.genome.archetypeId === 'shieldSentinel'
      && !(this._isClawCarrier() && this.brain.clawDestroyed)) {
      return Math.min(this.stats.attackRange, this.genome.behavior.preferredRange + 0.45);
    }
    if (kind === 'charge') return Math.max(CHARGE_INITIATION_RANGE, this.stats.attackRange);
    if (kind === 'pounce') return this.stats.attackRange;
    if (kind === 'selfDestruct') return this.stats.attackRange + 0.4;
    if (['melee', 'clawMoveset', 'jawCombo', 'shockwave'].includes(kind)) {
      return this.stats.attackRange + 0.5;
    }
    return this.stats.attackRange;
  }

  _getAerialCollisionOptions() {
    return {
      radius: Math.max(0.24, this.radius),
      verticalRadius: Math.max(0.42, this.collisionHeight * 0.43),
      lookAhead: Math.max(2.8, this.stats.moveSpeed * 1.15),
    };
  }

  _isAerialRootPathClear(game, targetRootPosition) {
    const controller = game.dungeonController;
    if (!controller?.isAerialPathClear) return true;
    tempD.copy(this.root.position);
    tempD.y += this.combatAimOffset;
    tempE.copy(targetRootPosition);
    tempE.y += this.combatAimOffset;
    return controller.isAerialPathClear(tempD, tempE, this._getAerialCollisionOptions());
  }

  _canBeginAttack(game) {
    if (this.navigationMode !== 'air') return game.requestEnemyAttack?.(this) ?? true;
    const kind = this._getEffectiveAttackKind();
    if (!['charge', 'pounce'].includes(kind)) return game.requestEnemyAttack?.(this) ?? true;
    tempF.copy(game.player.root.position);
    if (kind === 'charge') {
      tempG.copy(game.player.root.position).sub(this.root.position).setY(0);
      if (tempG.lengthSq() <= 0.0001) tempG.copy(WORLD_FORWARD);
      else tempG.normalize();
      tempF.copy(this.root.position).addScaledVector(tempG, CHARGE_TRAVEL_DISTANCE);
    } else {
      tempF.addScaledVector(game.player.lastMoveDirection ?? WORLD_FORWARD, 0.9);
    }
    tempF.y = game.player.root.position.y + 0.9;
    return this._isAerialRootPathClear(game, tempF)
      && (game.requestEnemyAttack?.(this) ?? true);
  }

  isAttackLeaseActive() {
    return !this.dead
      && (this.brain?.state === 'telegraph' || this.brain?.state === 'commit');
  }

  _emitChargeJetTrail(dt, game) {
    const nozzles = this.visual?.chargeModule?.nozzles ?? [];
    if (nozzles.length === 0) return;
    this.brain.jetTrailTimer -= dt;
    if (this.brain.jetTrailTimer > 0) return;
    this.brain.jetTrailTimer = 0.045;
    for (const nozzle of nozzles) {
      nozzle.getWorldPosition(tempA);
      game.addParticleBurst?.(tempA, this.aiRandom.chance(0.38) ? 0xffe08a : 0xff5b18, 2, 0.075);
    }
  }

  _emitLaunchLegJetTrail(dt, game) {
    const nozzles = this.visual?.weapon?.launchLegBoosterNozzles ?? [];
    if (nozzles.length === 0) return;
    this.brain.jetTrailTimer -= dt;
    if (this.brain.jetTrailTimer > 0) return;
    this.brain.jetTrailTimer = 0.035;
    for (const nozzle of nozzles) {
      nozzle.getWorldPosition(tempA);
      game.addParticleBurst?.(
        tempA,
        this.aiRandom.chance(0.34) ? 0xffef9a : 0xff5b18,
        3,
        0.09,
      );
    }
  }

  _getPackPlayerFacing(game, target = new THREE.Vector3()) {
    const player = game?.player;
    const yaw = player?.root?.rotation?.y;
    if (Number.isFinite(yaw)) {
      target.set(Math.sin(yaw), 0, Math.cos(yaw));
    } else {
      target.copy(player?.lastMoveDirection ?? WORLD_FORWARD).setY(0);
    }
    if (target.lengthSq() <= 0.0001) target.copy(WORLD_FORWARD);
    return target.normalize();
  }

  _getPackFlankTarget(game, target = new THREE.Vector3()) {
    const behavior = this.genome.behavior;
    this._getPackPlayerFacing(game, tempF);
    const rearBias = THREE.MathUtils.clamp(this.brain.packFlankRearBias ?? 0.5, 0.05, 0.95);
    const sideBias = Math.sqrt(Math.max(0, 1 - rearBias * rearBias));
    tempG.set(tempF.z, 0, -tempF.x)
      .multiplyScalar((behavior.orbitDirection ?? 1) * sideBias)
      .addScaledVector(tempF, -rearBias)
      .normalize();
    target.copy(game.player.root.position)
      .addScaledVector(tempG, behavior.flankApproachDistance ?? 1.9);
    target.y = this.root.position.y;
    return target;
  }

  _isPlayerFlankExposed(game) {
    this._getPackPlayerFacing(game, tempF);
    tempG.copy(this.root.position).sub(game.player.root.position).setY(0);
    if (tempG.lengthSq() <= 0.0001) return false;
    const facingDot = tempF.dot(tempG.normalize());
    return facingDot <= (this.genome.behavior.flankAttackDot ?? 0.2);
  }

  _movePackHunterTowardFlank(dt, game) {
    this._getPackFlankTarget(game, tempC);
    tempD.copy(tempC).sub(this.root.position).setY(0);
    const distance = tempD.length();
    if (distance <= 0.16) return false;

    const controller = game.dungeonController;
    const navigation = controller?.getEnemyNavigationDirection?.(this, tempC);
    if (controller?.getEnemyNavigationDirection && !navigation) return false;
    tempD.copy(navigation ?? tempD).setY(0);
    if (tempD.lengthSq() <= 0.0001) return false;
    tempD.normalize();

    const speed = this.stats.moveSpeed
      * this._getStatusMoveMultiplier()
      * (this.genome.behavior.flankPursuitSpeedScale ?? 1.28);
    this.root.position.addScaledVector(tempD, Math.min(distance, speed * dt));
    return true;
  }

  // Compatibility aliases for runtime tools that inspected the old rear-only
  // behavior. They now expose the broader side-or-rear flank contract.
  _getPackRearTarget(game, target = new THREE.Vector3()) {
    return this._getPackFlankTarget(game, target);
  }

  _isPlayerBackExposed(game) {
    return this._isPlayerFlankExposed(game);
  }

  _movePackHunterTowardRear(dt, game) {
    return this._movePackHunterTowardFlank(dt, game);
  }

  _resolveSpringPounceLanding(game, target) {
    const controller = game.dungeonController;
    const brain = this.brain;
    const surfaceProbeY = Math.max(
      this.root.position.y,
      target.y,
      game.player.root.position.y,
    );
    tempF.copy(this.root.position);
    tempG.copy(target).sub(tempF).setY(0);
    let desiredTravel = tempG.length();
    if (desiredTravel <= 0.001) {
      tempG.copy(brain.attackDirection).setY(0);
      if (tempG.lengthSq() <= 0.0001) {
        tempG.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
      }
      desiredTravel = 2.4;
    }
    tempG.normalize();
    desiredTravel = THREE.MathUtils.clamp(desiredTravel, 2.4, Math.max(2.4, this.stats.attackRange - 0.35));

    const clearLanding = (candidate) => {
      // Surface queries use the supplied height to choose between stacked
      // walkable levels. Probe from the intended target elevation so a pouncer
      // can recognize the platform MegaMan is standing on instead of selecting
      // the floor directly beneath it.
      candidate.y = Math.max(candidate.y, surfaceProbeY);
      candidate.y = controller?.getSurfaceElevationAt?.(candidate) ?? candidate.y;
      const elevationDelta = candidate.y - this.root.position.y;
      if (elevationDelta > 4.4 || elevationDelta < -3.2) return false;
      const footprintClear = controller?.isEnemyPositionClear
        ? controller.isEnemyPositionClear(this, candidate, { maximumElevationDelta: 4.6 })
        : !controller?.isPositionWalkable || controller.isPositionWalkable(candidate);
      if (!footprintClear) return false;
      const jumpHeight = Math.max(
        this.genome.modules.weapon.pounceJumpHeight ?? 2.5,
        Math.max(0, elevationDelta) + 1.3,
      );
      if (!this._isCoilBounceArcClear(game, this.root.position, candidate, jumpHeight)) return false;
      brain.pounceJumpHeight = jumpHeight;
      target.copy(candidate);
      return true;
    };

    for (const directionOffset of [0, 0.3, -0.3, 0.58, -0.58]) {
      const cos = Math.cos(directionOffset);
      const sin = Math.sin(directionOffset);
      tempH.set(
        tempG.x * cos - tempG.z * sin,
        0,
        tempG.x * sin + tempG.z * cos,
      ).normalize();
      for (const distanceScale of [1, 0.82, 0.64, 0.46]) {
        tempI.copy(tempF).addScaledVector(tempH, desiredTravel * distanceScale);
        const arenaTarget = controller?.getEnemyArenaTarget?.(this, tempI, tempD);
        if (arenaTarget) {
          tempI.x = arenaTarget.x;
          tempI.z = arenaTarget.z;
        }
        if (clearLanding(tempI)) return true;
      }
    }

    const nearest = controller?.findNearestEnemyClearPosition?.(this, target, {
      preferredPosition: game.player.root.position,
      maximumRadius: 3.6,
      maximumElevationDelta: 4.6,
    });
    if (nearest && clearLanding(nearest)) return true;

    // A point-blank or completely boxed-in pouncer still performs a vertical
    // landing attack instead of silently cancelling after its full warning.
    target.copy(this.root.position);
    target.y = controller?.getSurfaceElevationAt?.(target) ?? target.y;
    brain.pounceJumpHeight = this.genome.modules.weapon.pounceJumpHeight ?? 2.5;
    return false;
  }

  _clampCommitTargetToWalkablePath(game, target) {
    if (this.navigationMode === 'air') return target;
    const controller = game.dungeonController;
    if (!controller?.isPositionWalkable) return target;

    tempA.copy(this.root.position);
    tempB.copy(target).sub(tempA);
    const distance = Math.hypot(tempB.x, tempB.z);
    if (distance <= 0.001) return target;

    const steps = Math.max(2, Math.ceil(distance / 0.32));
    tempC.copy(tempA);
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      const sample = new THREE.Vector3().copy(tempA).lerp(target, progress);
      sample.y = controller.getSurfaceElevationAt?.(sample) ?? sample.y;
      if (!controller.isPositionWalkable(sample)) break;
      tempC.copy(sample);
    }
    target.copy(tempC);
    return target;
  }

  _moveCommitAlongWalkablePath(game, nextX, nextZ, nextY = this.root.position.y) {
    const controller = game.dungeonController;
    if (this.navigationMode === 'air') {
      tempA.copy(this.root.position);
      tempA.y += this.combatAimOffset;
      tempB.set(nextX, nextY + this.combatAimOffset, nextZ);
      if (controller?.isAerialPathClear
        && !controller.isAerialPathClear(tempA, tempB, this._getAerialCollisionOptions())) {
        return false;
      }
      this.root.position.set(nextX, nextY, nextZ);
      return true;
    }
    if (!controller?.isPositionWalkable) {
      this.root.position.x = nextX;
      this.root.position.y = nextY;
      this.root.position.z = nextZ;
      return true;
    }

    tempA.copy(this.root.position);
    tempB.set(nextX, this.root.position.y, nextZ);
    const distance = flatDistance(tempA, tempB);
    const steps = Math.max(1, Math.ceil(distance / 0.24));
    for (let step = 1; step <= steps; step += 1) {
      tempC.copy(tempA).lerp(tempB, step / steps);
      if (!controller.isPositionWalkable(tempC)) {
        return false;
      }
    }

    this.root.position.x = nextX;
    this.root.position.z = nextZ;
    return true;
  }

  _updateExposureAndDefense() {
    const brain = this.brain;
    const exposure = this.genome.modules.weakPoint.exposure;
    const defenseId = this.genome.modules.defense?.id ?? null;
    if (this._isClawCarrier()) {
      brain.weakPointExposed = !brain.clawDestroyed && brain.state === 'telegraph';
      brain.defenseActive = !brain.clawDestroyed && brain.state === 'guard';
      return;
    }
    const linkedRotorCore = defenseId === 'rotatingPlates'
      && this.genome.modules.weakPoint.id === 'counterweightCore';
    const usesTimedQuadrupedEyelids = defenseId === 'armorShutters'
      && this.visual.defense.group.userData.quadrupedEyelids === true;
    const eyelidOpeningProgress = usesTimedQuadrupedEyelids && brain.state === 'telegraph'
      ? clamp01(brain.stateTime / Math.max(0.01, this._getStateDuration('telegraph')))
      : 1;
    const eyelidsCleared = eyelidOpeningProgress >= 0.24;
    brain.weakPointExposed = this.weakPointBroken
      || (linkedRotorCore
        ? Math.cos(this.visual.defense.group.rotation.y) < -0.05
        : exposure === 'always'
          || (exposure === 'telegraph' && brain.state === 'telegraph')
          || (exposure === 'attack'
            && (brain.state === 'commit'
              || (brain.state === 'telegraph' && (!usesTimedQuadrupedEyelids || eyelidsCleared))))
          || (exposure === 'recovery' && brain.state === 'recovery'));

    if (this.defenseDisabled) {
      brain.defenseActive = false;
    } else if (defenseId === 'rotatingPlates') {
      brain.defenseActive = true;
    } else if (PASSIVE_DEFENSES.has(defenseId)) {
      brain.defenseActive = true;
    } else if (defenseId === 'phaseShell') {
      brain.defenseActive = brain.state === 'position' && Math.sin(brain.time * 2.7) > -0.15;
    } else if (defenseId === 'reactivePlate') {
      brain.defenseActive = brain.state === 'position' && Math.sin(brain.time * 1.6) > -0.3;
    } else if (usesTimedQuadrupedEyelids) {
      brain.defenseActive = brain.state === 'position'
        || (brain.state === 'telegraph' && !eyelidsCleared);
    } else {
      brain.defenseActive = brain.state === 'position';
    }
  }

  _animateVisual(dt) {
    const brain = this.brain;
    const duration = this._getStateDuration(brain.state);
    animateReaverbotVisual(this.visual, {
      time: brain.time,
      dt,
      moving: brain.moving,
      speedRatio: brain.speedRatio,
      state: brain.state,
      stateProgress: clamp01(brain.stateTime / Math.max(0.01, duration)),
      attackKind: this._getEffectiveAttackKind(),
      defenseActive: brain.defenseActive,
      defenseDisabled: this.defenseDisabled,
      weakPointExposed: brain.weakPointExposed,
      weakPointLocation: this.genome.modules.weakPoint.location,
      clawAttackVariant: brain.clawAttackVariant,
      clawGuardProgress: brain.state === 'guard'
        ? clamp01(brain.stateTime / 0.16)
        : 0,
      clawRecoilProgress: brain.state === 'recoil'
        ? clamp01(brain.stateTime / Math.max(0.01, brain.clawRecoilDuration))
        : 0,
      clawDestroyedProgress: brain.clawDestroyed ? 1 : 0,
      clawSpinProgress: brain.clawSpinProgress,
      tractorBeamActive: brain.tractorBeamActive,
      tractorBeamIntensity: brain.tractorBeamIntensity,
      tractorBeamLength: brain.tractorBeamLength,
      springBounceActive: brain.coilBounceActive,
      springBounceProgress: brain.coilBounceActive
        ? clamp01(brain.coilBounceTime / Math.max(0.01, brain.coilBounceDuration))
        : 0,
      chargeDirection: this._getEffectiveAttackKind() === 'charge'
        ? brain.attackDirection
        : tempA.copy(brain.targetPosition).sub(brain.commitStart).normalize(),
    });
    this._applyRushAttackWarning(dt);
  }

  _applyRushAttackWarning(dt) {
    const brain = this.brain;
    const kind = this._getEffectiveAttackKind();
    const rushTelegraph = brain.state === 'telegraph'
      && (kind === 'charge' || kind === 'pounce' || kind === 'clawMoveset');
    const chargeCommit = brain.state === 'commit' && kind === 'charge';

    brain.warningBlinkRate = 0;
    brain.warningIntensity = 0;
    if (!rushTelegraph && !chargeCommit) return;

    if (rushTelegraph) {
      const progress = clamp01(brain.stateTime / Math.max(0.01, this._getStateDuration('telegraph')));
      const urgency = THREE.MathUtils.smoothstep(progress, 0, 1);
      brain.warningBlinkRate = THREE.MathUtils.lerp(RUSH_WARNING_MIN_RATE, RUSH_WARNING_MAX_RATE, urgency);
      brain.warningPhase += dt * brain.warningBlinkRate * Math.PI * 2;
      const blink = THREE.MathUtils.smoothstep(Math.sin(brain.warningPhase) * 0.5 + 0.5, 0.34, 0.88);
      brain.warningIntensity = THREE.MathUtils.lerp(0.24, 1.05, urgency) * blink;
    } else {
      // A restrained solid highlight keeps a charging enemy readable at speed.
      brain.warningIntensity = 0.2;
    }

    if (this.flashTimer > 0 || brain.warningIntensity <= 0.001) return;
    for (const state of this._materialStates) {
      state.material.emissive.copy(RUSH_WARNING_COLOR);
      state.material.emissiveIntensity = Math.max(state.material.emissiveIntensity ?? 0, brain.warningIntensity);
    }
  }

  _createTelegraphMarker(game, radius, color = this.genome.palette.emissive) {
    this._removeTelegraphMarker();
    const marker = createTelegraphRing(color, radius);
    this.brain.telegraphMarker = marker;
    game.scene.add(marker);
    this._updateTelegraphMarker(game);
  }

  _updateTelegraphMarker(game) {
    const marker = this.brain.telegraphMarker;
    if (!marker) return;
    const kind = this._getEffectiveAttackKind();
    let position = kind === 'selfDestruct' || kind === 'shockwave'
      ? this.root.position
      : this.brain.targetPosition;
    if (kind === 'jawCombo') {
      this.root.updateMatrixWorld(true);
      this.visual.weapon.muzzle.getWorldPosition(tempA);
      position = tempA;
    } else if (kind === 'clawMoveset' && this.brain.clawAttackVariant === 'verticalSlam') {
      this.root.updateMatrixWorld(true);
      this.visual.weakPoint.core.getWorldPosition(tempA);
      position = tempA;
    }
    marker.position.copy(position);
    marker.position.y = (game.dungeonController?.getSurfaceElevationAt?.(position) ?? position.y) + 0.055;
    const rushAttack = kind === 'charge' || kind === 'pounce' || kind === 'clawMoveset';
    const jawCycleProgress = kind === 'jawCombo' && this.brain.state === 'commit'
      ? ((this.brain.stateTime / Math.max(0.01, this.genome.behavior.commitDuration)) * 3) % 1
      : 0;
    const pulse = rushAttack
      ? 1 + this.brain.warningIntensity * 0.12
      : kind === 'jawCombo'
        ? 0.96 + (1 - jawCycleProgress) * 0.08
      : 1 + Math.sin(this.brain.time * 14) * 0.07;
    marker.scale.setScalar(pulse);
    marker.material.opacity = kind === 'jawCombo' && this.brain.state === 'commit'
      ? 0.18 + (1 - jawCycleProgress) * 0.52
      : 0.28 + clamp01(this.brain.stateTime / Math.max(0.01, this.genome.behavior.telegraphDuration)) * 0.42;
  }

  _removeTelegraphMarker() {
    const marker = this.brain?.telegraphMarker;
    if (!marker) return;
    marker.removeFromParent();
    marker.geometry?.dispose?.();
    marker.material?.dispose?.();
    this.brain.telegraphMarker = null;
  }

  _breakWeakPoint(meta) {
    this.weakPointBroken = true;
    this.defenseDisabled = true;
    this.pendingWeakPointBreakEffect = true;
    meta.weakPointBroken = true;
    this.stats.armor *= 0.55;
    const id = this.genome.modules.weakPoint.id;
    if (id === 'legJoint') this.stats.moveSpeed *= 0.68;
    if (id === 'ammoDrum') this.stats.attackCooldown *= 1.28;
    if (id === 'emitterCore' || id === 'coolingVents') this.stats.damage *= 0.82;
  }

  _applyEliteAffix(affix) {
    this.isElite = true;
    this.id = `elite-${affix.id}-${this.id}`;
    this.root.name = this.id;
    this.root.userData.enemy = this;
    this.stats.maxHealth *= 2.15;
    this.stats.damage *= 1.4;
    this.stats.experience = Math.round(this.stats.experience * 3.1);
    this.health = this.stats.maxHealth;
    this.radius *= 1.12;
    this.visual.root.scale.multiplyScalar(1.12);
    this.healthBar.position.y *= 1.12;

    if (affix.id === 'swift') {
      this.stats.moveSpeed *= 1.32;
      this.stats.attackCooldown *= 0.84;
    } else if (affix.id === 'armored') {
      this.stats.armor += 32;
    } else if (affix.id === 'overcharged') {
      this.stats.attackCooldown *= 0.88;
    } else if (affix.id === 'refractorRich') {
      this.stats.maxHealth *= 1.16;
      this.health = this.stats.maxHealth;
    }

    const material = new THREE.MeshStandardMaterial({
      color: affix.color,
      emissive: affix.color,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
    });
    material.name = 'material_generatedReaverbotEliteAura';
    const aura = new THREE.Mesh(new THREE.RingGeometry(this.radius * 0.9, this.radius * 1.08, 32), material);
    aura.name = 'generatedReaverbotEliteAura';
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.05;
    this.root.add(aura);
    this.eliteAura = aura;
  }

  _updateEliteAffix(dt, game) {
    if (!this.affix) return;
    if (this.affix.id === 'burningCore') {
      this.affixTimers.burn -= dt;
      if (this.affixTimers.burn <= 0) {
        game.addFireZone(this.root.position, this.stats.damage * 0.4, 2.1, 1.05, { source: this });
        this.affixTimers.burn = 1.45;
      }
    }
    if (this.affix.id === 'overcharged') {
      this.affixTimers.surge -= dt;
      if (this.affixTimers.surge <= 0) {
        if (flatDistance(this.root.position, game.player.root.position) <= 2.1) {
          const hitResult = game.player.takeIncomingHit({
            amount: this.stats.damage * 0.22,
            source: this,
            guardable: true,
            reactionTier: 1,
          });
          if (hitResult.healthDamage > 0) {
            this.onHitPlayer(game.player, hitResult.healthDamage);
          }
        }
        this.affixTimers.surge = 1.2;
      }
    }
    if (this.eliteAura) {
      this.eliteAura.rotation.z += dt * 1.8;
      this.eliteAura.scale.setScalar(1 + Math.sin(this.brain.time * 4) * 0.05);
    }
  }

  _applyEliteDamageModifiers(amount, meta) {
    if (!this.affix) return amount;
    if (this.affix.id === 'armored') return amount * (this.hasStatus('armorBreak') ? 0.95 : 0.72);
    if (this.affix.id === 'burningCore' && meta.element === 'fire') return amount * 0.72;
    if (this.affix.id === 'frostCore') {
      if (meta.element === 'ice') return amount * 0.7;
      if (meta.element === 'fire') return amount * 1.12;
    }
    if (this.affix.id === 'overcharged' && meta.element === 'shock') return amount * 0.66;
    return amount;
  }
}

export default ReaverbotEnemy;
