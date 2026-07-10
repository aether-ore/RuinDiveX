import * as THREE from 'three';
import { Enemy } from '../Enemy.js';
import {
  animateReaverbotVisual,
  createReaverbotVisual,
} from './ReaverbotVisualFactory.js';
import { SeededRandom } from './SeededRandom.js';

const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempC = new THREE.Vector3();
const tempForward = new THREE.Vector3();
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const PASSIVE_DEFENSES = new Set([
  'armoredSkull',
  'sidePlates',
  'armoredBack',
  'armoredCarapace',
]);

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
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
    this.healthBar.position.y = this.collisionHeight + 0.42;

    this.aiRandom = new SeededRandom(`${genome.seed}:runtime`);
    this.brain = {
      time: this.aiRandom.float(0, Math.PI * 2),
      state: 'position',
      stateTime: 0,
      cooldown: this.aiRandom.float(0.45, 1.25),
      moving: false,
      speedRatio: 0,
      defenseActive: true,
      weakPointExposed: genome.modules.weakPoint.exposure === 'always',
      attackFired: false,
      attackHit: false,
      effectTimer: 0,
      tickTimer: 0,
      targetPosition: new THREE.Vector3(),
      attackDirection: new THREE.Vector3(0, 0, 1),
      commitStart: new THREE.Vector3(),
      telegraphMarker: null,
      packSupported: true,
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
      get dead() {
        return owner.dead;
      },
      get active() {
        return owner.brain.weakPointExposed;
      },
      getWorldPosition(out) {
        return owner.visual.weakPoint.core.getWorldPosition(out);
      },
    };

    this._captureMaterialStates();
  }

  update(dt, game) {
    if (this.dead) {
      this._removeTelegraphMarker();
    }

    super.update(dt, game);

    if (!this.dead
      && !game.player.dead
      && !game.dungeonController?.isPlayerInSafeZone?.()) {
      this._updateEliteAffix(dt, game);
    }
  }

  getCombatTargets() {
    const targets = [this];
    if (this.genome.modules.weakPoint.lockable && this.brain.weakPointExposed && !this.dead) {
      targets.unshift(this.weakPointTarget);
    }
    return targets;
  }

  resolveProjectileHit(position, projectileRadius = 0.1) {
    if (!this.brain.weakPointExposed || this.dead) {
      return null;
    }

    this.visual.weakPoint.core.getWorldPosition(tempA);
    const hitRadius = projectileRadius + (this.genome.modules.weakPoint.radius ?? 0.2);
    if (position.distanceToSquared(tempA) > hitRadius * hitRadius) {
      return null;
    }

    return {
      hitPartId: this.genome.modules.weakPoint.id,
      weakPointHit: true,
      hitPosition: tempA.clone(),
    };
  }

  resolveLineHit(start, direction, range, width = 0.1) {
    if (!this.brain.weakPointExposed || this.dead) return null;
    this.visual.weakPoint.core.getWorldPosition(tempA);
    tempB.copy(tempA).sub(start);
    const along = tempB.dot(direction);
    if (along < 0 || along > range) return null;
    const perpendicularDistanceSq = Math.max(0, tempB.lengthSq() - along * along);
    const hitRadius = width + (this.genome.modules.weakPoint.radius ?? 0.2);
    if (perpendicularDistanceSq > hitRadius * hitRadius) return null;

    tempC.copy(this.root.position);
    tempC.y += this.collisionHeight * 0.5;
    const bodyCenterAlong = tempC.sub(start).dot(direction);
    if (along > bodyCenterAlong + hitRadius * 0.35) return null;

    return {
      along,
      hitPartId: this.genome.modules.weakPoint.id,
      weakPointHit: true,
      hitPosition: tempA.clone(),
    };
  }

  takeDamage(amount, meta = {}) {
    const dealt = super.takeDamage(amount, meta);

    if (dealt > 0) {
      this.brain.alerted = true;
    }

    if (meta.weakPointHit && dealt > 0 && !this.weakPointBroken) {
      this.weakPointDamage += dealt;
      if (this.weakPointDamage >= this.stats.maxHealth * 0.32) {
        this._breakWeakPoint(meta);
      }
    }

    return dealt;
  }

  modifyDamageTaken(amount, meta = {}) {
    let adjusted = super.modifyDamageTaken(amount, meta);
    const weakPoint = this.genome.modules.weakPoint;

    if (meta.hitPartId === weakPoint.id && this.brain.weakPointExposed) {
      meta.weakPointHit = true;
      meta.hitPosition = meta.hitPosition ?? this.visual.weakPoint.core.getWorldPosition(new THREE.Vector3());
      adjusted *= weakPoint.multiplier;
      return this._applyEliteDamageModifiers(adjusted, meta);
    }

    const directHit = meta.projectileHit || meta.directHit;
    if (meta.unblockable || !directHit || this.defenseDisabled || !this.brain.defenseActive) {
      return this._applyEliteDamageModifiers(adjusted, meta);
    }

    const defense = this.genome.modules.defense;
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
        multiplier = sideHit ? defense.directMultiplier : defense.flankMultiplier;
        break;
      case 'phaseShell':
      case 'energyMembrane':
      case 'rotatingPlates':
      case 'armorShutters':
      case 'reactivePlate':
        multiplier = frontHit ? defense.directMultiplier : defense.flankMultiplier;
        break;
      default:
        break;
    }

    if (multiplier < 1) {
      meta.shieldBlocked = true;
      meta.defensePartId = defense.id;
      meta.hitPosition = this.visual.defense.group.getWorldPosition(new THREE.Vector3());
      if (multiplier <= 0.001) {
        meta.damageNullified = true;
        adjusted = 0;
      } else {
        adjusted *= multiplier;
      }
    }

    return this._applyEliteDamageModifiers(adjusted, meta);
  }

  onHitPlayer(player, dealt = 0) {
    if (this.genome.modules.weapon.id === 'arcEmitter' && dealt > 0) {
      player.applySlow?.(0.76, 0.48);
    }
    if (this.affix?.id === 'frostCore' && dealt > 0) {
      player.applySlow?.(0.55, 1.5);
    }
    if (this.affix?.id === 'corrosive' && dealt > 0) {
      player.takeDamage(Math.max(1, dealt * 0.22), this);
    }
    return player;
  }

  onDeath(game, meta = {}) {
    this._removeTelegraphMarker();
    if (this.affix?.id === 'explosiveCore' && !meta.selfDestruct) {
      game.addExplosion(this.root.position, this.stats.damage * 2.2, 2.25, this.affix.color, { source: this });
    }
    if (this.affix?.id === 'burningCore') {
      game.addFireZone(this.root.position, this.stats.damage * 0.5, 2.4, 1.25, { source: this });
    }
    if (this.affix?.id === 'refractorRich') {
      game.addParticleBurst(this.root.position, this.affix.color, 24, 0.22);
    }
  }

  dispose() {
    this._removeTelegraphMarker();
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

    if (game.dungeonController?.isPlayerInSafeZone?.() || game.player.dead) {
      brain.moving = false;
      this._updateExposureAndDefense();
      this._animateVisual(dt);
      return { handled: true, moving: false };
    }

    if (this._isControlLocked() || this.hitStopTimer > 0) {
      brain.moving = false;
      this._updateExposureAndDefense();
      this._animateVisual(dt);
      return { handled: true, moving: false };
    }

    tempA.copy(game.player.root.position).sub(this.root.position).setY(0);
    const distance = tempA.length();
    if (distance > 0.001) tempA.divideScalar(distance);
    else tempA.copy(WORLD_FORWARD);

    if (brain.state !== 'commit' || !['charge', 'pounce'].includes(this.genome.modules.weapon.attackKind)) {
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
    this._updateTelegraphMarker(game);
    this._animateVisual(dt);
    return { handled: true, moving: brain.moving, moveAmount: brain.speedRatio };
  }

  _updatePositionState(dt, game, toPlayer, distance) {
    const brain = this.brain;
    const archetype = this.genome.archetypeId;
    brain.cooldown = Math.max(0, brain.cooldown - dt * this._getStatusAttackRateMultiplier());
    brain.packSupported = this._hasPackSupport(game);

    const aggroRange = this.genome.behavior.aggroRange ?? 14;
    if (!brain.alerted && distance > aggroRange) {
      brain.moving = false;
      brain.speedRatio = 0;
      return;
    }
    brain.alerted = true;

    let mode = 'hold';
    const preferred = this.genome.behavior.preferredRange;
    if (archetype === 'pursuer') {
      mode = distance > Math.max(1.15, preferred) ? 'approach' : 'hold';
    } else if (archetype === 'shieldSentinel') {
      mode = 'hold';
    } else if (archetype === 'pouncer') {
      mode = distance < 3 ? 'retreat' : distance > 6.1 ? 'approach' : 'orbit';
    } else if (archetype === 'artillery') {
      mode = distance < 3.7 ? 'retreat' : distance > preferred + 1.1 ? 'approachSlow' : 'orbitSlow';
    } else if (archetype === 'zoneController') {
      mode = distance < 3.2 ? 'retreat' : distance > preferred + 0.9 ? 'approachSlow' : 'orbit';
    } else if (archetype === 'aerialBomber') {
      mode = 'approachSlow';
    } else if (archetype === 'packHunter') {
      mode = brain.packSupported
        ? (distance > 2.2 ? 'flank' : 'hold')
        : (distance < 5 ? 'retreat' : 'orbitSlow');
    } else {
      mode = distance < 1.7 ? 'retreat' : distance > preferred + 0.6 ? 'approach' : 'orbit';
    }

    brain.moving = this._moveByMode(mode, dt, game, toPlayer, distance);
    brain.speedRatio = brain.moving ? (mode.includes('Slow') ? 0.55 : 1) : 0;

    if (brain.cooldown <= 0 && brain.packSupported && this._isAttackDistance(distance)) {
      this._beginTelegraph(game, toPlayer);
    }
  }

  _updateTelegraphState(dt, game, toPlayer) {
    const brain = this.brain;
    brain.stateTime += dt;
    brain.moving = false;
    this._turnToward(toPlayer, dt, this.genome.behavior.turnRate * 0.72);

    brain.effectTimer -= dt;
    if (brain.effectTimer <= 0) {
      brain.effectTimer = 0.11;
      const kind = this.genome.modules.weapon.attackKind;
      if (['charge', 'melee', 'flamethrower', 'beam'].includes(kind)) {
        const halfAngle = kind === 'beam' ? 0.07 : kind === 'flamethrower' ? 0.78 : 0.32;
        const range = kind === 'beam'
          ? this.stats.attackRange
          : kind === 'charge'
            ? flatDistance(this.root.position, brain.targetPosition)
            : Math.min(this.stats.attackRange, 4.8);
        game.addGroundConeTelegraph(this.root.position, brain.attackDirection, range, halfAngle, this.genome.palette.emissive, {
          duration: 0.16,
          opacity: kind === 'beam' ? 0.28 : 0.22,
          name: `generatedReaverbot${kind}Telegraph`,
        });
      }
      this.visual.weapon.muzzle.getWorldPosition(tempB);
      game.addParticleBurst(tempB, this.genome.palette.emissive, 2, 0.055);
    }

    if (brain.stateTime >= this.genome.behavior.telegraphDuration) {
      brain.state = 'commit';
      brain.stateTime = 0;
      brain.attackFired = false;
      brain.attackHit = false;
      brain.tickTimer = 0;
      brain.commitStart.copy(this.root.position);
    }
  }

  _updateCommitState(dt, game) {
    const brain = this.brain;
    const kind = this.genome.modules.weapon.attackKind;
    brain.stateTime += dt;
    const duration = Math.max(0.08, this.genome.behavior.commitDuration);
    const progress = clamp01(brain.stateTime / duration);
    brain.moving = ['charge', 'pounce'].includes(kind);
    brain.speedRatio = brain.moving ? 1.4 : 0;

    if (kind === 'charge' || kind === 'pounce') {
      const eased = kind === 'pounce'
        ? THREE.MathUtils.smoothstep(progress, 0.05, 0.9)
        : THREE.MathUtils.smoothstep(progress, 0, 0.72);
      const nextX = THREE.MathUtils.lerp(brain.commitStart.x, brain.targetPosition.x, eased);
      const nextZ = THREE.MathUtils.lerp(brain.commitStart.z, brain.targetPosition.z, eased);
      if (!this._moveCommitAlongWalkablePath(game, nextX, nextZ)) {
        this._removeTelegraphMarker();
        brain.state = 'recovery';
        brain.stateTime = 0;
        brain.moving = false;
        brain.speedRatio = 0;
        return;
      }
      this._tryContactHit(game, kind === 'pounce' ? 0.75 : 0.5);
    } else if (kind === 'flamethrower') {
      this._updateFlamethrower(dt, game);
    } else if (!brain.attackFired && progress >= (kind === 'selfDestruct' ? 0.72 : 0.24)) {
      brain.attackFired = true;
      this._fireAttack(game);
    }

    if (brain.stateTime >= duration && !this.dead) {
      if ((kind === 'pounce' || kind === 'shockwave') && !brain.attackFired) {
        brain.attackFired = true;
        game.addExplosion(this.root.position, this.stats.damage, 1.85, this.genome.palette.emissive, {
          source: this,
          damageEnemies: false,
          damagePlayer: kind === 'shockwave' || !brain.attackHit,
          playerDamageScale: 1,
          triggerMines: false,
        });
      }
      this._removeTelegraphMarker();
      brain.state = 'recovery';
      brain.stateTime = 0;
      brain.moving = false;
    }
  }

  _updateRecoveryState(dt) {
    const brain = this.brain;
    brain.stateTime += dt;
    brain.moving = false;
    brain.speedRatio = 0;
    if (brain.stateTime >= this.genome.behavior.recoveryDuration) {
      brain.state = 'position';
      brain.stateTime = 0;
      brain.cooldown = this.stats.attackCooldown * this.aiRandom.float(0.84, 1.16);
      brain.attackFired = false;
      brain.attackHit = false;
    }
  }

  _beginTelegraph(game, toPlayer) {
    const brain = this.brain;
    const kind = this.genome.modules.weapon.attackKind;
    brain.state = 'telegraph';
    brain.stateTime = 0;
    brain.effectTimer = 0;
    brain.attackDirection.copy(toPlayer).normalize();
    brain.targetPosition.copy(game.player.root.position);

    if (kind === 'pounce') {
      brain.targetPosition.addScaledVector(game.player.lastMoveDirection ?? WORLD_FORWARD, 0.9);
    } else if (kind === 'charge') {
      const distance = Math.min(5.8, Math.max(2.2, flatDistance(this.root.position, game.player.root.position) + 0.8));
      brain.targetPosition.copy(this.root.position).addScaledVector(brain.attackDirection, distance);
    } else if (kind === 'selfDestruct' || kind === 'shockwave') {
      brain.targetPosition.copy(this.root.position);
    }

    const surfaceY = game.dungeonController?.getSurfaceElevationAt?.(brain.targetPosition) ?? brain.targetPosition.y;
    brain.targetPosition.y = surfaceY;
    if (kind === 'charge' || kind === 'pounce') {
      this._clampCommitTargetToWalkablePath(game, brain.targetPosition);
    }

    const markerRadius = kind === 'selfDestruct'
      ? (this.genome.modules.weapon.explosiveRadius ?? 3)
      : kind === 'mortar'
        ? (this.genome.modules.weapon.explosiveRadius ?? 1.2)
        : kind === 'mine'
          ? 1.15
          : kind === 'pounce' || kind === 'shockwave'
            ? 1.25
            : 0;
    if (markerRadius > 0) {
      this._createTelegraphMarker(game, markerRadius);
    }
  }

  _fireAttack(game) {
    const kind = this.genome.modules.weapon.attackKind;
    switch (kind) {
      case 'melee':
        this._tryContactHit(game, 0.55);
        break;
      case 'shockwave':
        game.addExplosion(this.root.position, this.stats.damage, 1.9, this.genome.palette.emissive, {
          source: this,
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
    game.addGroundConeTelegraph(tempA, brain.attackDirection, this.stats.attackRange, 0.78, 0xff7b32, {
      duration: 0.12,
      opacity: 0.3,
      name: 'generatedReaverbotFlamethrowerCone',
    });
    game.addDirectedParticleSpray(tempA, brain.attackDirection, 0xff6a2e, {
      count: 10,
      range: this.stats.attackRange,
      halfAngle: 0.78,
      baseScale: 0.25,
      pressure: 1,
    });

    if (brain.tickTimer > 0) return;
    brain.tickTimer = 0.16;
    tempB.copy(game.player.root.position).sub(tempA).setY(0);
    const distance = tempB.length();
    if (distance <= 0.001 || distance > this.stats.attackRange + game.player.radius) return;
    if (Math.abs((game.player.root.position.y + 1) - tempA.y) > 1.35) return;
    tempB.divideScalar(distance);
    if (tempB.dot(brain.attackDirection) < Math.cos(0.78)) return;
    const dealt = game.player.takeDamage(this.stats.damage, this);
    this.onHitPlayer(game.player, dealt);
    game.addHitEffect(game.player.root.position, 0xff6a2e, 0.42);
  }

  _fireBeam(game) {
    this.visual.weapon.muzzle.getWorldPosition(tempA);
    tempB.copy(this.brain.attackDirection).normalize();
    showBeam(game, tempA, tempB, this.stats.attackRange, this.genome.palette.emissive);
    tempC.copy(game.player.root.position);
    tempC.y += 1;
    if (distanceToRay(tempC, tempA, tempB, this.stats.attackRange) <= game.player.radius + 0.48) {
      const dealt = game.player.takeDamage(this.stats.damage, this);
      this.onHitPlayer(game.player, dealt);
      game.addHitEffect(game.player.root.position, this.genome.palette.emissive, 0.72);
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
    const dealt = game.player.takeDamage(this.stats.damage, this);
    this.onHitPlayer(game.player, dealt);
    game.addHitEffect(game.player.root.position, this.genome.palette.emissive, 0.58);
    if (dealt > 0) game.requestHitStop?.(0.08, { timeScale: 0.05 });
  }

  _moveByMode(mode, dt, game, toPlayer, distance) {
    if (mode === 'hold') return false;
    let speedScale = mode.includes('Slow') ? 0.55 : 1;
    if (mode === 'approach' || mode === 'approachSlow') {
      const navigation = game.dungeonController?.getNavigationDirection?.(this.root.position, game.player.root.position);
      tempB.copy(navigation ?? toPlayer).setY(0);
    } else if (mode === 'retreat') {
      tempB.copy(toPlayer).multiplyScalar(-1);
      speedScale = 0.7;
    } else {
      const side = this.genome.behavior.orbitDirection;
      tempB.set(toPlayer.z * side, 0, -toPlayer.x * side);
      const radialCorrection = mode === 'flank'
        ? THREE.MathUtils.clamp((distance - 2.4) * 0.24, -0.4, 0.5)
        : THREE.MathUtils.clamp((distance - this.genome.behavior.preferredRange) * 0.18, -0.36, 0.36);
      tempB.addScaledVector(toPlayer, radialCorrection);
      speedScale = mode.includes('Slow') ? 0.42 : 0.72;
    }

    if (tempB.lengthSq() <= 0.001) return false;
    tempB.normalize();
    this.root.position.addScaledVector(tempB, this.stats.moveSpeed * this._getStatusMoveMultiplier() * speedScale * dt);
    return true;
  }

  _turnToward(direction, dt, rate) {
    if (direction.lengthSq() <= 0.0001) return;
    const targetYaw = Math.atan2(direction.x, direction.z);
    const delta = angleDelta(this.root.rotation.y, targetYaw);
    this.root.rotation.y += THREE.MathUtils.clamp(delta, -rate * dt, rate * dt);
  }

  _isAttackDistance(distance) {
    const kind = this.genome.modules.weapon.attackKind;
    if (this.genome.archetypeId === 'shieldSentinel') {
      return distance <= Math.min(this.stats.attackRange, this.genome.behavior.preferredRange + 0.45);
    }
    if (kind === 'charge') return distance >= 1.2 && distance <= Math.max(5.8, this.stats.attackRange);
    if (kind === 'pounce') return distance >= 2 && distance <= this.stats.attackRange;
    if (kind === 'selfDestruct') return distance <= this.stats.attackRange + 0.4;
    if (['melee', 'shockwave'].includes(kind)) return distance <= this.stats.attackRange + 0.5;
    return distance <= this.stats.attackRange;
  }

  _hasPackSupport(game) {
    const minimum = this.genome.behavior.minimumPackSize ?? 1;
    if (minimum <= 1) return true;
    let count = 0;
    for (const enemy of game.enemies) {
      if (enemy.dead) continue;
      const sameEncounter = this.encounterId
        ? enemy.encounterId === this.encounterId
        : flatDistance(enemy.root.position, this.root.position) <= 8;
      if (sameEncounter && flatDistance(enemy.root.position, this.root.position) <= 8) count += 1;
    }
    return count >= minimum;
  }

  _clampCommitTargetToWalkablePath(game, target) {
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

  _moveCommitAlongWalkablePath(game, nextX, nextZ) {
    const controller = game.dungeonController;
    if (!controller?.isPositionWalkable) {
      this.root.position.x = nextX;
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
    brain.weakPointExposed = this.weakPointBroken
      || exposure === 'always'
      || (exposure === 'telegraph' && brain.state === 'telegraph')
      || (exposure === 'attack' && (brain.state === 'telegraph' || brain.state === 'commit'))
      || (exposure === 'recovery' && brain.state === 'recovery');

    const defenseId = this.genome.modules.defense.id;
    if (this.defenseDisabled) {
      brain.defenseActive = false;
    } else if (PASSIVE_DEFENSES.has(defenseId)) {
      brain.defenseActive = true;
    } else if (defenseId === 'phaseShell') {
      brain.defenseActive = brain.state === 'position' && Math.sin(brain.time * 2.7) > -0.15;
    } else if (defenseId === 'reactivePlate') {
      brain.defenseActive = brain.state === 'position' && Math.sin(brain.time * 1.6) > -0.3;
    } else {
      brain.defenseActive = brain.state === 'position' || (brain.state === 'telegraph' && defenseId === 'energyMembrane');
    }
  }

  _animateVisual(dt) {
    const brain = this.brain;
    const duration = brain.state === 'telegraph'
      ? this.genome.behavior.telegraphDuration
      : brain.state === 'commit'
        ? this.genome.behavior.commitDuration
        : brain.state === 'recovery'
          ? this.genome.behavior.recoveryDuration
          : 1;
    animateReaverbotVisual(this.visual, {
      time: brain.time,
      dt,
      moving: brain.moving,
      speedRatio: brain.speedRatio,
      state: brain.state,
      stateProgress: clamp01(brain.stateTime / Math.max(0.01, duration)),
      attackKind: this.genome.modules.weapon.attackKind,
      defenseActive: brain.defenseActive,
      weakPointExposed: brain.weakPointExposed,
    });
  }

  _createTelegraphMarker(game, radius) {
    this._removeTelegraphMarker();
    const marker = createTelegraphRing(this.genome.palette.emissive, radius);
    this.brain.telegraphMarker = marker;
    game.scene.add(marker);
    this._updateTelegraphMarker(game);
  }

  _updateTelegraphMarker(game) {
    const marker = this.brain.telegraphMarker;
    if (!marker) return;
    const kind = this.genome.modules.weapon.attackKind;
    const position = kind === 'selfDestruct' || kind === 'shockwave'
      ? this.root.position
      : this.brain.targetPosition;
    marker.position.copy(position);
    marker.position.y = (game.dungeonController?.getSurfaceElevationAt?.(position) ?? position.y) + 0.055;
    const pulse = 1 + Math.sin(this.brain.time * 14) * 0.07;
    marker.scale.setScalar(pulse);
    marker.material.opacity = 0.28 + clamp01(this.brain.stateTime / Math.max(0.01, this.genome.behavior.telegraphDuration)) * 0.42;
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
          const dealt = game.player.takeDamage(this.stats.damage * 0.22, this);
          this.onHitPlayer(game.player, dealt);
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
