import * as THREE from 'three';
import { ReaverbotEnemy } from './ReaverbotEnemy.js';
import { REAVERBOT_BOSS_LIMITS } from './ReaverbotBossCatalog.js';
import {
  animateAuthoredRubyOpticOracleVisual,
  disposeVisualTree,
  loadAuthoredRubyOpticOracleVisual,
} from './AuthoredRubyOpticOracle.js';
import {
  animateAuthoredAscensionEngineVisual,
  createAuthoredAscensionEngineVisual,
} from './AuthoredAscensionEngine.js';
import { AscensionEngineEncounter } from './bosses/AscensionEngineEncounter.js';
import { RubyOpticOracleEncounter } from './bosses/RubyOpticOracleEncounter.js';
import {
  animateAuthoredCrucibleWardenVisual,
  loadAuthoredCrucibleWardenVisual,
} from './AuthoredCrucibleWarden.js';

export { REAVERBOT_BOSS_LIMITS } from './ReaverbotBossCatalog.js';

const PHASE_TWO_THRESHOLD = 0.5;
const PHASE_TRANSITION_DURATION = 1.1;
const SIGNATURE_INTEGRITY_SCALE = 0.24;
const SIGNATURE_DAMAGE_MULTIPLIER = 1.5;
const SIGNATURE_BREAK_INTERRUPT = 2;
const BOSS_STAGGER_SCALE = 0.35;
const OVERLOAD_SHIELD_HITS = 2;
const OVERLOAD_SHIELD_STUN_DURATION = 4;
const OVERLOAD_DETONATOR_CAP = 3;
const OVERLOAD_MINE_CAP = 6;
const OVERLOAD_FLIT_SPEED = 7.4;
const OVERLOAD_RAID_APPROACH_SPEED = 9.2;
const OVERLOAD_RAID_HOLD_DURATION = 2.35;
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempC = new THREE.Vector3();
const tempD = new THREE.Vector3();
const tempE = new THREE.Vector3();

function cloneBossGenome(genome) {
  return {
    ...genome,
    context: { ...genome.context, isBoss: true },
    stats: { ...genome.stats },
    proportions: { ...(genome.proportions ?? {}) },
  };
}

function disposeObject(object) {
  if (!object) return;
  object.removeFromParent?.();
}

function flatDistanceSquared(a, b) {
  const x = a.x - b.x;
  const z = a.z - b.z;
  return x * x + z * z;
}

function isResolvedPlayerContact(result) {
  return Boolean(result?.contacted && !result.dodged && !result.immune);
}

function lineContainsPoint(point, origin, direction, length, halfWidth) {
  tempA.copy(point).sub(origin).setY(0);
  const along = tempA.dot(direction);
  if (along < 0 || along > length) return false;
  tempB.copy(origin).addScaledVector(direction, along);
  return flatDistanceSquared(point, tempB) <= halfWidth * halfWidth;
}

function pointIsInSafeSector(point, center, sectors = []) {
  if (!sectors.length) return false;
  tempA.copy(point).sub(center).setY(0);
  if (tempA.lengthSq() <= 1e-8) return true;
  tempA.normalize();
  return sectors.some((sector) => (
    tempA.dot(sector.direction) >= Math.cos(sector.halfAngle)
  ));
}

function createSharedBossResources(color) {
  const telegraphMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  telegraphMaterial.name = 'material_reaverbotBossTelegraph';
  const hazardMaterial = telegraphMaterial.clone();
  hazardMaterial.opacity = 0.22;
  hazardMaterial.name = 'material_reaverbotBossHazard';
  const constructMaterial = new THREE.MeshStandardMaterial({
    color: 0x2f3032,
    emissive: color,
    emissiveIntensity: 0.32,
    roughness: 0.42,
    metalness: 0.72,
  });
  constructMaterial.name = 'material_reaverbotBossConstruct';
  return {
    laneGeometry: new THREE.BoxGeometry(1, 0.025, 1),
    diskGeometry: new THREE.CircleGeometry(1, 48),
    pylonGeometry: new THREE.CylinderGeometry(0.24, 0.36, 1.8, 8),
    arenaNodeGeometry: new THREE.IcosahedronGeometry(0.24, 1),
    telegraphMaterial,
    hazardMaterial,
    constructMaterial,
  };
}

function disposeSharedBossResources(resources) {
  resources?.laneGeometry?.dispose?.();
  resources?.diskGeometry?.dispose?.();
  resources?.pylonGeometry?.dispose?.();
  resources?.arenaNodeGeometry?.dispose?.();
  resources?.telegraphMaterial?.dispose?.();
  resources?.hazardMaterial?.dispose?.();
  resources?.constructMaterial?.dispose?.();
}

function createSignatureAssembly(enemy) {
  const group = new THREE.Group();
  group.name = 'reaverbotBossSignatureAssembly';
  group.position.set(0, enemy.collisionHeight * 0.7, enemy.radius * 0.2);

  const housingMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9b866,
    emissive: enemy.genome.palette.emissive,
    emissiveIntensity: 0.18,
    roughness: 0.34,
    metalness: 0.76,
  });
  housingMaterial.name = 'material_reaverbotBossSignatureHousing';
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xff315f,
    emissive: 0xff164f,
    emissiveIntensity: 1.4,
    roughness: 0.18,
    metalness: 0.16,
  });
  coreMaterial.name = 'material_reaverbotBossSignatureCore';

  const outer = new THREE.Mesh(
    new THREE.TorusGeometry(enemy.radius * 0.32, enemy.radius * 0.075, 8, 24),
    housingMaterial,
  );
  outer.name = 'reaverbotBossSignatureOuterHousing';
  outer.rotation.x = Math.PI / 2;
  const brace = new THREE.Mesh(
    new THREE.TorusGeometry(enemy.radius * 0.25, enemy.radius * 0.045, 7, 20),
    housingMaterial,
  );
  brace.name = 'reaverbotBossSignatureInnerBrace';
  brace.rotation.y = Math.PI / 2;
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(enemy.radius * 0.18, 1),
    coreMaterial,
  );
  core.name = 'reaverbotBossSignatureTarget';
  core.userData.bossSignaturePart = true;
  group.add(outer, brace, core);
  enemy.root.add(group);
  return { group, outer, brace, core, materials: [housingMaterial, coreMaterial] };
}

function createOverloadShieldVisual(enemy) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x67f4d7,
    emissive: 0x33ffd0,
    emissiveIntensity: 1.35,
    transparent: true,
    opacity: 0.28,
    roughness: 0.16,
    metalness: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.name = 'material_overloadReliquaryPhaseShield';
  const geometry = new THREE.SphereGeometry(1, 28, 18);
  const object = new THREE.Mesh(geometry, material);
  object.name = 'overloadReliquaryPhaseShield';
  object.position.y = enemy.collisionHeight * 0.5;
  object.scale.set(
    Math.max(1.2, enemy.radius * 1.62),
    Math.max(1.35, enemy.collisionHeight * 0.62),
    Math.max(1.2, enemy.radius * 1.62),
  );
  object.visible = false;
  object.userData.overloadReliquaryShield = true;
  enemy.root.add(object);
  return { object, geometry, material, baseScale: object.scale.clone() };
}

function getPatternForProfile(profileId) {
  switch (profileId) {
    case 'crucibleWarden': return 'crucibleLanes';
    case 'pursuitRegent': return 'interceptLanes';
    case 'rubyOpticOracle': return 'mirrorRoutes';
    case 'ballisticsVizier': return 'impactGrid';
    case 'revolvingFusillade': return 'pulseFan';
    case 'highAngleBastion': return 'craterSalvo';
    case 'clusterSalvoReliquary': return 'clusterLattice';
    case 'feedDrumArsenal': return 'feedCrossfire';
    case 'overloadReliquary': return 'reliquaryRaid';
    default: return 'pulseFan';
  }
}

export class ReaverbotBossEnemy extends ReaverbotEnemy {
  constructor(genome, level, { bossProfile, expeditionSpec } = {}) {
    const bossGenome = cloneBossGenome(genome);
    super(bossGenome, level, { eliteAffix: null });
    this.isBoss = true;
    this.isElite = false;
    this.bossProfile = bossProfile ?? { id: bossGenome.bossProfileId ?? 'revolvingFusillade' };
    this.bossProfileId = this.bossProfile.id;
    this.expeditionSpec = expeditionSpec ?? null;
    this.typeKey = `boss:${this.bossProfileId}`;
    this.liftable = false;
    this.root.userData.reaverbotBoss = this;
    this.root.userData.bossProfileId = this.bossProfileId;

    this.signatureVisual = createSignatureAssembly(this);
    this.signatureIntegrityMax = this.stats.maxHealth * SIGNATURE_INTEGRITY_SCALE;
    this.signatureIntegrity = this.signatureIntegrityMax;
    this.signaturePartOverloaded = false;
    this.signatureTarget = this._createSignatureTarget();
    this.bossState = {
      phase: 1,
      transitionRemaining: 0,
      interruptRemaining: 0,
      arenaCooldown: 2.2,
      patternIndex: 0,
      elapsed: 0,
      activeTelegraphs: [],
      activeHazards: [],
      activeArenaNodes: [],
      constructs: [],
      telegraphPool: [],
      introShown: false,
      cleaned: false,
    };
    this.bossState.reliquary = this.bossProfileId === 'overloadReliquary'
      ? {
        mode: 'flit',
        waypoint: new THREE.Vector3(),
        waypointTimer: 0,
        waypointSerial: 0,
        mineTimer: 0.65,
        minionTimer: 1.8,
        summonSerial: 0,
        raidApproachTimer: 0,
        raidHoldRemaining: 0,
        shieldActive: false,
        shieldHits: 0,
        shieldHitsMax: OVERLOAD_SHIELD_HITS,
        shieldStunRemaining: 0,
        shieldBreakCount: 0,
        summonedDetonators: new Set(),
      }
      : null;
    this.bossResources = createSharedBossResources(this.genome.palette.emissive);
    this.overloadShieldVisual = this.bossProfileId === 'overloadReliquary'
      ? createOverloadShieldVisual(this)
      : null;
    this.specialEncounter = this.bossProfileId === 'rubyOpticOracle'
      ? new RubyOpticOracleEncounter(this)
      : this.bossProfileId === 'ascensionEngine'
        ? new AscensionEngineEncounter(this)
        : null;
    if (this.specialEncounter) this.signatureVisual.group.visible = false;
    this.authoredVisualState = ['rubyOpticOracle', 'crucibleWarden'].includes(this.bossProfileId)
      ? 'loading'
      : this.bossProfileId === 'ascensionEngine'
        ? 'installing'
        : 'notApplicable';
    if (['rubyOpticOracle', 'crucibleWarden'].includes(this.bossProfileId)) this._loadPreferredAuthoredVisual();
    if (this.bossProfileId === 'ascensionEngine') this._installAuthoredAscensionVisual();
  }

  _installAuthoredAscensionVisual() {
    const fallbackVisual = this.visual;
    try {
      const authoredVisual = createAuthoredAscensionEngineVisual(this);
      fallbackVisual.root.removeFromParent();
      this.visual = authoredVisual;
      this.root.add(authoredVisual.root);
      this.authoredVisualState = 'active';
      this.root.userData.authoredBossModel = 'ascensionEngine';
      this.root.userData.authoredBossFallbackActive = false;
      this._captureMaterialStates();
      disposeVisualTree(fallbackVisual.root);
    } catch (error) {
      this.authoredVisualState = 'fallback';
      this.root.userData.authoredBossFallbackActive = true;
      console.warn('Could not build authored Ascension Engine; using procedural fallback.', error);
    }
  }

  async _loadPreferredAuthoredVisual() {
    const fallbackVisual = this.visual;
    try {
      const authoredVisual = this.bossProfileId === 'crucibleWarden'
        ? await loadAuthoredCrucibleWardenVisual(this)
        : await loadAuthoredRubyOpticOracleVisual(this);
      if (this.disposed || this.dead) {
        disposeVisualTree(authoredVisual.root);
        return;
      }
      fallbackVisual.root.removeFromParent();
      this.visual = authoredVisual;
      this.root.add(authoredVisual.root);
      this.authoredVisualState = 'active';
      this.root.userData.authoredBossModel = this.bossProfileId;
      this.root.userData.authoredBossFallbackActive = false;
      this._captureMaterialStates();
      disposeVisualTree(fallbackVisual.root);
    } catch (error) {
      this.authoredVisualState = 'fallback';
      this.root.userData.authoredBossFallbackActive = true;
      console.warn(`Could not load authored ${this.bossProfileId}; using procedural fallback.`, error);
    }
  }

  _animateVisual(dt) {
    const specialVisualState = this.specialEncounter?.getVisualState?.() ?? null;
    if (this.bossProfileId === 'ascensionEngine' && this.authoredVisualState === 'active') {
      animateAuthoredAscensionEngineVisual(this.visual, {
        time: this.brain.time,
        dt,
        ...(specialVisualState ?? {}),
      });
      this._applyRushAttackWarning(dt);
      return;
    }
    if (this.bossProfileId === 'crucibleWarden' && this.authoredVisualState === 'active') {
      animateAuthoredCrucibleWardenVisual(this.visual, {
        time: this.brain.time,
        dt,
        state: this.brain.state,
        defenseActive: this.brain.defenseActive,
        weakPointExposed: this.brain.weakPointExposed || this.signaturePartOverloaded,
      });
      this._applyRushAttackWarning(dt);
      return;
    }
    if (this.authoredVisualState !== 'active') {
      super._animateVisual(dt);
      if (specialVisualState?.visualOffsetY != null && this.visual?.root) {
        this.visual.root.position.y = specialVisualState.visualOffsetY;
      }
      return;
    }
    const duration = this._getStateDuration(this.brain.state);
    animateAuthoredRubyOpticOracleVisual(this.visual, {
      time: this.brain.time,
      dt,
      moving: this.brain.moving,
      speedRatio: this.brain.speedRatio,
      state: specialVisualState?.charging ? 'telegraph' : this.brain.state,
      stateProgress: Math.max(0, Math.min(1, this.brain.stateTime / Math.max(0.01, duration))),
      defenseActive: specialVisualState
        ? specialVisualState.shuttersClosed
        : this.brain.defenseActive,
      weakPointExposed: specialVisualState?.weakPointExposed ?? this.brain.weakPointExposed,
      ascensionActive: specialVisualState?.ascensionActive ?? false,
      ascensionProgress: specialVisualState?.ascensionProgress ?? 0,
      pupilIntensity: specialVisualState?.pupilIntensity ?? 0,
    });
    if (specialVisualState?.visualOffsetY != null && this.visual?.root) {
      this.visual.root.position.y = specialVisualState.visualOffsetY;
    }
    this._applyRushAttackWarning(dt);
  }

  _createSignatureTarget() {
    const owner = this;
    const usesRubyEye = this.bossProfileId === 'rubyOpticOracle';
    return {
      id: `${this.id}:signature:${this.bossProfileId}`,
      ownerEnemy: this,
      partId: `signature:${this.bossProfileId}`,
      root: usesRubyEye ? this.root : this.signatureVisual.core,
      radius: usesRubyEye ? Math.max(0.46, this.radius * 0.4) : Math.max(0.24, this.radius * 0.24),
      isWeakPointTarget: true,
      isBossSignatureTarget: true,
      retainLockWhenInactive: true,
      get dead() { return owner.dead; },
      get active() {
        return !owner.dead
          && !owner.signaturePartOverloaded
          && !owner._usesDetonatorShieldMechanic()
          && !owner.specialEncounter?.ownsSignatureTarget?.()
          && !owner.specialEncounter?.isChannelCoreActive?.();
      },
      getWorldPosition(out) { return owner._getSignatureWorldPosition(out); },
    };
  }

  _getSignatureWorldPosition(out = new THREE.Vector3()) {
    if (this.specialEncounter) return this.specialEncounter.getEyePosition(out);
    return this.signatureVisual.core.getWorldPosition(out);
  }

  _usesDetonatorShieldMechanic() {
    return this.bossProfileId === 'overloadReliquary';
  }

  getCombatTargets() {
    const ownsSpecialTargets = this.specialEncounter?.ownsSignatureTarget?.() === true;
    const targets = ownsSpecialTargets
      ? super.getCombatTargets().filter((target) => target !== this.weakPointTarget)
      : super.getCombatTargets();
    if (!this._usesDetonatorShieldMechanic()
      && !this.signaturePartOverloaded
      && !this.specialEncounter?.ownsSignatureTarget?.()
      && !this.dead) {
      targets.unshift(this.signatureTarget);
    }
    if (this.specialEncounter) targets.unshift(...this.specialEncounter.getCombatTargets());
    const arenaTargets = this.bossState?.activeArenaNodes
      ?.filter((node) => node.active)
      .map((node) => node.target) ?? [];
    targets.unshift(...arenaTargets);
    return targets;
  }

  getLockOnTargets() {
    if (this.specialEncounter?.ownsLockOnTargets?.() === true) {
      return this.specialEncounter.getCombatTargets();
    }
    return this.getCombatTargets();
  }

  resolveProjectileHit(position, projectileRadius = 0.1) {
    const specialHit = this.specialEncounter?.resolveProjectileHit(position, projectileRadius);
    if (specialHit) return specialHit;
    const arenaNode = this._resolveArenaNodePointHit(position, projectileRadius);
    if (arenaNode) return arenaNode;
    if (this.specialEncounter?.ownsSignatureTarget?.()) return null;
    const signature = this._resolveSignaturePointHit(position, projectileRadius);
    return signature ?? super.resolveProjectileHit(position, projectileRadius);
  }

  resolveLineHit(start, direction, range, width = 0.1, options = {}) {
    const specialHit = this.specialEncounter?.resolveLineHit(start, direction, range, width, options);
    if (specialHit) return specialHit;
    for (const node of this.bossState?.activeArenaNodes ?? []) {
      if (!node.active) continue;
      node.object.getWorldPosition(tempA);
      tempB.copy(tempA).sub(start);
      const along = tempB.dot(direction);
      const radius = width + node.target.radius;
      if (along >= 0 && along <= range
        && Math.max(0, tempB.lengthSq() - along * along) <= radius * radius) {
        return {
          along,
          hitPartId: node.partId,
          bossArenaNodeHit: true,
          hitPosition: tempA.clone(),
        };
      }
    }
    if (this.specialEncounter?.ownsSignatureTarget?.()) return null;
    if (!this._usesDetonatorShieldMechanic()
      && !this.signaturePartOverloaded
      && !this.dead) {
      this._getSignatureWorldPosition(tempA);
      tempB.copy(tempA).sub(start);
      const along = tempB.dot(direction);
      const radius = width + this.signatureTarget.radius;
      if (along >= 0 && along <= range
        && Math.max(0, tempB.lengthSq() - along * along) <= radius * radius) {
        return {
          along,
          hitPartId: this.signatureTarget.partId,
          signaturePartHit: true,
          hitPosition: tempA.clone(),
        };
      }
    }
    return super.resolveLineHit(start, direction, range, width, options);
  }

  resolveArcHit(origin, direction, range, halfAngle, options = {}) {
    const specialHit = this.specialEncounter?.resolveArcHit(origin, direction, range, halfAngle, options);
    if (specialHit) return specialHit;
    for (const node of this.bossState?.activeArenaNodes ?? []) {
      if (!node.active) continue;
      node.object.getWorldPosition(tempA);
      tempB.copy(tempA).sub(origin);
      const vertical = Math.abs(tempB.y);
      tempB.y = 0;
      const distance = tempB.length();
      if (distance > range + node.target.radius || vertical > 2.8 + node.target.radius) continue;
      if (distance > 0.001) tempB.divideScalar(distance);
      tempC.copy(direction).setY(0).normalize();
      if (tempC.dot(tempB) >= Math.cos(halfAngle)) {
        return {
          along: distance,
          hitPartId: node.partId,
          bossArenaNodeHit: true,
          hitPosition: tempA.clone(),
        };
      }
    }
    if (this.specialEncounter?.ownsSignatureTarget?.()) return null;
    if (!this._usesDetonatorShieldMechanic()
      && !this.signaturePartOverloaded
      && !this.dead) {
      this._getSignatureWorldPosition(tempA);
      tempB.copy(tempA).sub(origin);
      const vertical = Math.abs(tempB.y);
      tempB.y = 0;
      const distance = tempB.length();
      if (distance <= range + this.signatureTarget.radius
        && vertical <= 2.8 + this.signatureTarget.radius) {
        if (distance > 0.001) tempB.divideScalar(distance);
        tempC.copy(direction).setY(0).normalize();
        if (tempC.dot(tempB) >= Math.cos(halfAngle)) {
          return {
            along: distance,
            hitPartId: this.signatureTarget.partId,
            signaturePartHit: true,
            hitPosition: tempA.clone(),
          };
        }
      }
    }
    return super.resolveArcHit(origin, direction, range, halfAngle, options);
  }

  _resolveSignaturePointHit(position, projectileRadius) {
    if (this._usesDetonatorShieldMechanic() || this.signaturePartOverloaded || this.dead) return null;
    this._getSignatureWorldPosition(tempA);
    const radius = projectileRadius + this.signatureTarget.radius;
    if (position.distanceToSquared(tempA) > radius * radius) return null;
    return {
      hitPartId: this.signatureTarget.partId,
      signaturePartHit: true,
      hitPosition: tempA.clone(),
    };
  }

  _resolveArenaNodePointHit(position, projectileRadius) {
    if (this.dead) return null;
    for (const node of this.bossState?.activeArenaNodes ?? []) {
      if (!node.active) continue;
      node.object.getWorldPosition(tempA);
      const radius = projectileRadius + node.target.radius;
      if (position.distanceToSquared(tempA) <= radius * radius) {
        return {
          hitPartId: node.partId,
          bossArenaNodeHit: true,
          hitPosition: tempA.clone(),
        };
      }
    }
    return null;
  }

  modifyDamageTaken(amount, meta = {}) {
    const specialAdjusted = this.specialEncounter?.adjustDamageTaken?.(amount, meta);
    if (specialAdjusted != null) {
      amount = Math.max(0, Number(specialAdjusted) || 0);
      if (amount <= 0) return 0;
    }
    if (!meta.ascensionSegmentDamage
      && (this.bossState?.transitionRemaining > 0 || this.bossState?.interruptRemaining > 0)) {
      meta.bossInvulnerable = true;
      return 0;
    }
    if (this.specialEncounter?.isAscensionActive?.()
      && meta.hitPartId !== this.specialEncounter.channelCorePartId) {
      meta.bossInvulnerable = true;
      meta.rubyAscensionFloorAttackBlocked = true;
      return 0;
    }
    if (this.specialEncounter?.isShutterProtected?.()) {
      meta.bossInvulnerable = true;
      meta.rubyShuttersBlocked = true;
      return 0;
    }
    if ((this.bossState?.reliquary?.shieldStunRemaining ?? 0) > 0) {
      // The shield-break knockdown is deliberately a damage window, unlike
      // the generic signature interrupt (which remains invulnerable).
      this.brain.defenseActive = false;
      meta.overloadShieldStunVulnerable = true;
    }
    if (!meta.bossScriptedDisplacement) {
      meta.knockbackDirection = null;
      meta.knockback = 0;
    }
    const directDamageHit = Boolean(
      (meta.projectileHit || meta.directHit || meta.directContactHit)
      && !meta.explosionSplash
      && !meta.areaDamage,
    );
    const rubyWeakPointId = this.genome?.modules?.weakPoint?.id;
    const rubyStaggerWeakPointHit = Boolean(
      this.specialEncounter?.isSuccessStaggerActive?.()
      && rubyWeakPointId
      && meta.hitPartId === rubyWeakPointId,
    );
    const rubyStaggerTargetHit = Boolean(
      this.specialEncounter?.isSuccessStaggerActive?.()
      && directDamageHit
      && (meta.signaturePartHit || meta.weakPointHit || rubyStaggerWeakPointHit),
    );
    const originalHitPartId = meta.hitPartId;
    let adjusted;
    if (this.specialEncounter) {
      // The authored Ruby shutters own this defense window. The generic
      // Reaverbot brain may still be in `position`, but that must not create an
      // invisible armor block while the authored eye is visibly open.
      const previousDefenseActive = this.brain.defenseActive;
      this.brain.defenseActive = false;
      // The authored success window is a total 1.65x vulnerability for both
      // exposed targets. Resolve a rear-core hit through the body baseline so
      // the generated weak-point multiplier cannot stack above that contract.
      if (rubyStaggerWeakPointHit) meta.hitPartId = null;
      try {
        adjusted = super.modifyDamageTaken(amount, meta);
      } finally {
        meta.hitPartId = originalHitPartId;
        this.brain.defenseActive = previousDefenseActive;
      }
    } else {
      adjusted = super.modifyDamageTaken(amount, meta);
    }
    if (rubyStaggerWeakPointHit) {
      meta.weakPointHit = true;
      meta.hitPosition = meta.hitPosition
        ?? this.visual?.weakPoint?.core?.getWorldPosition?.(new THREE.Vector3());
    }
    if (meta.signaturePartHit
      && directDamageHit
      && !rubyStaggerTargetHit) {
      adjusted *= SIGNATURE_DAMAGE_MULTIPLIER;
      meta.bossSignatureMultiplier = SIGNATURE_DAMAGE_MULTIPLIER;
    }
    if (rubyStaggerTargetHit) {
      adjusted *= 1.65;
      meta.rubyOracleStaggerMultiplier = 1.65;
    }
    if (this.bossState?.phase === 1 && !this.specialEncounter?.ownsPhaseProgression?.()) {
      const armor = Math.max(
        0,
        this.stats.armor - this._getArmorReduction() - (meta.armorPierce ?? 0),
      );
      const mitigation = 100 / (100 + armor);
      const remainingToThreshold = Math.max(0, this.health - this.stats.maxHealth * PHASE_TWO_THRESHOLD);
      if (mitigation > 0) adjusted = Math.min(adjusted, remainingToThreshold / mitigation);
    }
    return adjusted;
  }

  takeDamage(amount, meta = {}) {
    const reliquary = this.bossState?.reliquary;
    if (this._usesDetonatorShieldMechanic()
      && this.bossState.phase === 2
      && reliquary?.shieldActive) {
      meta.shieldBlocked = true;
      meta.damageNullified = true;
      meta.overloadReliquaryShield = true;
      meta.knockbackDirection = null;
      meta.knockback = 0;
      if (!meta.hitPosition && this.overloadShieldVisual?.object) {
        meta.hitPosition = this.overloadShieldVisual.object.getWorldPosition(new THREE.Vector3());
      }
      return 0;
    }
    if (this.specialEncounter?.handlePartImpact?.(amount, meta, this._runtimeGame)) {
      meta.damageNullified = true;
      return 0;
    }
    if (this.specialEncounter?.handleLensImpact?.(amount, meta, this._runtimeGame)) {
      meta.bossArenaNodeHit = true;
      meta.damageNullified = true;
      return 0;
    }
    const arenaNode = this.bossState?.activeArenaNodes
      ?.find((node) => node.active && node.partId === meta.hitPartId);
    if (arenaNode) {
      const directHit = (meta.projectileHit || meta.directHit || meta.directContactHit)
        && !meta.explosionSplash
        && !meta.areaDamage;
      meta.bossArenaNodeHit = true;
      meta.damageNullified = true;
      if (directHit && amount > 0) {
        arenaNode.integrity = Math.max(0, arenaNode.integrity - amount);
        if (arenaNode.integrity <= 0) {
          this._removeArenaNode(arenaNode, this._runtimeGame, {
            cancelTelegraphs: true,
            reason: 'shot',
          });
        }
      }
      return 0;
    }
    const dealt = super.takeDamage(amount, meta);
    this.specialEncounter?.recordChannelDamage?.(dealt, meta, this._runtimeGame);
    const rubyChannelCoreHit = Boolean(
      this.specialEncounter
      && meta.hitPartId === this.specialEncounter.channelCorePartId,
    );
    const directSignatureHit = meta.signaturePartHit
      && !rubyChannelCoreHit
      && (meta.projectileHit || meta.directHit || meta.directContactHit)
      && !meta.explosionSplash
      && !meta.areaDamage;
    if (!this._usesDetonatorShieldMechanic()
      && directSignatureHit
      && dealt > 0
      && !this.signaturePartOverloaded) {
      this.signatureIntegrity = Math.max(0, this.signatureIntegrity - dealt);
      if (this.signatureIntegrity <= 0) this._overloadSignaturePart(meta);
    }
    if (!this.dead && !this.specialEncounter?.ownsPhaseProgression?.()
      && this.bossState.phase === 1
      && this.health <= this.stats.maxHealth * PHASE_TWO_THRESHOLD + 1e-6) {
      this._beginPhaseTwo();
    }
    return dealt;
  }

  applyStatus(type, options = {}) {
    if (type === 'stagger') {
      return super.applyStatus(type, {
        ...options,
        duration: Math.max(0, Number(options.duration) || 0) * BOSS_STAGGER_SCALE,
      });
    }
    return super.applyStatus(type, options);
  }

  _isControlLocked() {
    return super._isControlLocked()
      || (this.bossState?.transitionRemaining ?? 0) > 0
      || (this.bossState?.interruptRemaining ?? 0) > 0
      || (this.bossState?.reliquary?.shieldStunRemaining ?? 0) > 0
      || this.specialEncounter?.ownsBossPositioning?.() === true
      || this.specialEncounter?.isMovementLocked?.() === true
      || Boolean(this.specialEncounter?.attack);
  }

  _canBeginAttack(game) {
    if (this.specialEncounter) return false;
    return super._canBeginAttack(game);
  }

  shouldIgnoreGroundConstraint() {
    return super.shouldIgnoreGroundConstraint()
      || this.specialEncounter?.isAscensionActive?.() === true
      || this.specialEncounter?.shouldIgnoreGroundConstraint?.() === true;
  }

  tryClaimExternalControl() { return false; }
  startExternalBallisticMotion() { return false; }

  _beginPhaseTwo() {
    if (this.bossState.phase !== 1) return;
    this._cancelBossArenaAttacks(this._runtimeGame, 'phase-transition');
    this.bossState.phase = 2;
    this.bossState.transitionRemaining = PHASE_TRANSITION_DURATION;
    this.bossState.arenaCooldown = PHASE_TRANSITION_DURATION + 0.65;
    this.brain.state = 'recovery';
    this.brain.stateTime = 0;
    this.brain.moving = false;
    this.knockback.set(0, 0, 0);
    this._runtimeGame?.cancelEnemyAttackRequest?.(this);
    this._runtimeGame?.addParticleBurst?.(this.root.position, this.genome.palette.emissive, 38, 0.24);
    this._runtimeGame?.ui?.showBossPhaseTransition?.(this);
    this.specialEncounter?.beginPhaseTwo(this._runtimeGame);
    if (this._usesDetonatorShieldMechanic()) {
      this._activateOverloadShield(this._runtimeGame, { initial: true });
    }
  }

  _activateOverloadShield(game = this._runtimeGame, { initial = false } = {}) {
    const reliquary = this.bossState?.reliquary;
    if (!reliquary || this.dead) return false;
    reliquary.shieldActive = true;
    reliquary.shieldHits = reliquary.shieldHitsMax;
    reliquary.shieldStunRemaining = 0;
    reliquary.mode = 'flit';
    reliquary.waypointTimer = 0;
    reliquary.minionTimer = Math.min(reliquary.minionTimer, initial ? 1.15 : 0.8);
    this.brain.state = 'position';
    this.brain.stateTime = 0;
    this.brain.defenseActive = true;
    if (this.overloadShieldVisual?.object) this.overloadShieldVisual.object.visible = true;
    game?.addParticleBurst?.(this.root.position, 0x68ffd7, initial ? 34 : 24, 0.18);
    if (!initial) game?.ui?.showToast?.('Overload shield reformed — redirect the detonators', '#68ffd7');
    return true;
  }

  _breakOverloadShield(game = this._runtimeGame, impactPosition = this.root.position) {
    const reliquary = this.bossState?.reliquary;
    if (!reliquary?.shieldActive) return false;
    this._cancelBossArenaAttacks(game, 'overload-shield-break');
    reliquary.shieldActive = false;
    reliquary.shieldHits = 0;
    reliquary.shieldStunRemaining = OVERLOAD_SHIELD_STUN_DURATION;
    reliquary.shieldBreakCount += 1;
    reliquary.mode = 'shieldStun';
    this.signaturePartOverloaded = true;
    this.brain.state = 'recovery';
    this.brain.stateTime = 0;
    this.brain.moving = false;
    this.brain.speedRatio = 0;
    this.brain.defenseActive = false;
    this.knockback.set(0, 0, 0);
    if (this.overloadShieldVisual?.object) this.overloadShieldVisual.object.visible = false;
    game?.cancelEnemyAttackRequest?.(this);
    game?.addParticleBurst?.(impactPosition, 0x68ffd7, 46, 0.25);
    game?.addHitEffect?.(impactPosition, 0xffffff, 1.45, { absolute: true });
    game?.combat?.transferLockOnTarget?.(this.signatureTarget, this);
    game?.ui?.showToast?.('Overload shield ruptured — attack while it is stunned!', '#ffd36f');
    return true;
  }

  onWeaponizedDetonatorImpact(detonator, game = this._runtimeGame, impact = {}) {
    const reliquary = this.bossState?.reliquary;
    const weapon = detonator?.genome?.modules?.weapon;
    const launchedByPlayer = detonator?.brain?.detonatorKnockback?.redirectedByPlayer === true;
    const ordinaryDetonator = weapon?.attackKind === 'selfDestruct'
      && weapon?.tags?.includes?.('selfDestruct')
      && !detonator?.isBoss;
    if (!reliquary?.shieldActive
      || this.bossState.phase !== 2
      || !launchedByPlayer
      || !ordinaryDetonator) {
      return { absorbed: false, excludeFromExplosion: false };
    }

    if (this.bossState.transitionRemaining > 0) {
      return {
        absorbed: true,
        excludeFromExplosion: true,
        shieldHit: false,
        transitionProtected: true,
        shieldHitsRemaining: reliquary.shieldHits,
      };
    }

    reliquary.shieldHits = Math.max(0, reliquary.shieldHits - 1);
    const position = impact.position?.clone?.() ?? this.root.position.clone();
    game?.addParticleBurst?.(position, 0x68ffd7, 26, 0.18);
    game?.addHitEffect?.(position, 0x68ffd7, 1.05, { absolute: true });
    if (reliquary.shieldHits <= 0) {
      this._breakOverloadShield(game, position);
    } else {
      game?.ui?.showToast?.(
        `Overload shield destabilized — ${reliquary.shieldHits} redirected detonator remaining`,
        '#9fffe8',
      );
    }
    return {
      absorbed: true,
      excludeFromExplosion: true,
      shieldHit: true,
      shieldBroken: !reliquary.shieldActive,
      shieldHitsRemaining: reliquary.shieldHits,
    };
  }

  _updatePositionState(dt, game, toPlayer, distance) {
    if (!this._usesDetonatorShieldMechanic()) {
      return super._updatePositionState(dt, game, toPlayer, distance);
    }

    const brain = this.brain;
    const reliquary = this.bossState.reliquary;
    brain.alerted = true;
    brain.cooldown = Math.max(0, brain.cooldown - dt * this._getStatusAttackRateMultiplier());
    brain.attackFired = true;
    brain.attackHit = false;

    if (reliquary.mode === 'raidApproach') {
      reliquary.raidApproachTimer += dt;
      const centerTarget = this._getOverloadArenaCenterTarget(game, tempD);
      const moved = this._moveOverloadToward(centerTarget, dt, game, OVERLOAD_RAID_APPROACH_SPEED);
      const centerDistance = Math.sqrt(flatDistanceSquared(this.root.position, centerTarget));
      brain.moving = moved;
      brain.speedRatio = moved ? 2.25 : 0;
      this.root.rotation.y += dt * 11.5;
      if (centerDistance <= 0.32
        || (reliquary.raidApproachTimer >= 1.8 && centerDistance <= 1.15)
        || reliquary.raidApproachTimer >= 2.35) {
        this._queueOverloadRaidPattern(game);
      }
      return;
    }

    if (reliquary.mode === 'raidCast') {
      reliquary.raidHoldRemaining = Math.max(0, reliquary.raidHoldRemaining - dt);
      brain.moving = false;
      brain.speedRatio = 0;
      this.root.rotation.y += dt * 12.5;
      const raidTelegraphsActive = this.bossState.activeTelegraphs.some((entry) => (
        String(entry.patternRole ?? '').startsWith('overloadRaid')
      ));
      if (reliquary.raidHoldRemaining <= 0 && !raidTelegraphsActive) {
        reliquary.mode = 'flit';
        reliquary.waypointTimer = 0;
      }
      return;
    }

    reliquary.mode = 'flit';
    reliquary.waypointTimer -= dt;
    const waypointDistance = this.root.position.distanceTo(reliquary.waypoint);
    if (reliquary.waypointTimer <= 0 || waypointDistance <= 0.45) {
      this._selectOverloadFlitWaypoint(game);
    }
    const moved = this._moveOverloadToward(
      reliquary.waypoint,
      dt,
      game,
      OVERLOAD_FLIT_SPEED * (this.bossState.phase === 2 ? 1.12 : 1),
    );
    const spinDirection = reliquary.waypointSerial % 2 === 0 ? 1 : -1;
    this.root.rotation.y += spinDirection * dt * (6.8 + Math.sin(this.bossState.elapsed * 5.7) * 1.9);
    brain.moving = moved;
    brain.speedRatio = moved ? 1.85 : 0;
    if (!moved) reliquary.waypointTimer = 0;
  }

  _getOverloadArenaCenterTarget(game, target = new THREE.Vector3()) {
    const center = this.encounterArena?.zoneCenter
      ?? this.encounterArena?.center
      ?? this.root.position;
    target.copy(center);
    const floorY = game?.dungeonController?.getSurfaceElevationAt?.(target) ?? target.y;
    target.y = floorY + Math.max(1.3, this.hoverHeight ?? 1.15);
    return target;
  }

  _selectOverloadFlitWaypoint(game) {
    const reliquary = this.bossState.reliquary;
    const arena = this.encounterArena;
    const center = arena?.zoneCenter ?? arena?.center ?? this.root.position;
    const halfWidth = Math.max(2.4, arena?.softHalfWidth ?? arena?.halfWidth ?? 6);
    const halfDepth = Math.max(2.4, arena?.softHalfDepth ?? arena?.halfDepth ?? 6);
    const controller = game?.dungeonController;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      tempD.set(
        center.x + this.aiRandom.float(-halfWidth * 0.76, halfWidth * 0.76),
        center.y,
        center.z + this.aiRandom.float(-halfDepth * 0.76, halfDepth * 0.76),
      );
      const arenaTarget = controller?.getEnemyArenaTarget?.(this, tempD, tempE);
      if (arenaTarget) tempD.copy(arenaTarget);
      const floorY = controller?.getSurfaceElevationAt?.(tempD) ?? center.y;
      tempD.y = floorY + Math.max(1.3, this.hoverHeight ?? 1.15);
      if (!controller?.isEnemyPositionClear || controller.isEnemyPositionClear(this, tempD)) {
        reliquary.waypoint.copy(tempD);
        reliquary.waypointTimer = this.aiRandom.float(0.58, 1.05);
        reliquary.waypointSerial += 1;
        return true;
      }
    }

    this._getOverloadArenaCenterTarget(game, reliquary.waypoint);
    reliquary.waypointTimer = 0.45;
    reliquary.waypointSerial += 1;
    return false;
  }

  _moveOverloadToward(target, dt, game, speed) {
    tempA.copy(target).sub(this.root.position);
    const distance = tempA.length();
    if (distance <= 0.015) return false;
    tempA.divideScalar(distance);
    const step = Math.min(distance, Math.max(0, speed * dt));
    tempB.copy(this.root.position).addScaledVector(tempA, step);
    const controller = game?.dungeonController;
    if (controller?.isEnemyPositionClear && !controller.isEnemyPositionClear(this, tempB)) {
      return false;
    }
    this.root.position.copy(tempB);
    return step > 0.0001;
  }

  _beginOverloadRaid(game) {
    const reliquary = this.bossState.reliquary;
    reliquary.mode = 'raidApproach';
    reliquary.raidApproachTimer = 0;
    reliquary.raidHoldRemaining = 0;
    this.brain.state = 'position';
    this.brain.stateTime = 0;
    this._removeTelegraphMarker?.();
    const centerTarget = this._getOverloadArenaCenterTarget(game, tempD);
    if (Math.sqrt(flatDistanceSquared(this.root.position, centerTarget)) <= 0.32) {
      this._queueOverloadRaidPattern(game);
    }
  }

  _queueOverloadRaidPattern(game) {
    const reliquary = this.bossState.reliquary;
    const center = this.encounterArena?.zoneCenter
      ?? this.encounterArena?.center
      ?? this.root.position;
    const halfWidth = Math.max(2.5, this.encounterArena?.softHalfWidth ?? 5.2);
    const halfDepth = Math.max(2.5, this.encounterArena?.softHalfDepth ?? 5.2);
    const spacingX = halfWidth * 0.55;
    const spacingZ = halfDepth * 0.55;
    const blastRadius = Math.max(1.45, Math.min(spacingX, spacingZ) * 0.62);
    const offsets = [-1, 0, 1];
    let queued = 0;
    for (let xIndex = 0; xIndex < offsets.length; xIndex += 1) {
      for (let zIndex = 0; zIndex < offsets.length; zIndex += 1) {
        const target = new THREE.Vector3(
          center.x + offsets[xIndex] * spacingX,
          center.y,
          center.z + offsets[zIndex] * spacingZ,
        );
        const firstWave = (xIndex + zIndex) % 2 === 0;
        if (this._queueCircle(
          game,
          target,
          blastRadius,
          firstWave ? 1.05 : 1.82,
          firstWave ? 1.02 : 1.12,
          { patternRole: firstWave ? 'overloadRaidWaveA' : 'overloadRaidWaveB' },
        )) {
          queued += 1;
        }
      }
    }
    reliquary.mode = 'raidCast';
    reliquary.raidHoldRemaining = OVERLOAD_RAID_HOLD_DURATION;
    reliquary.raidApproachTimer = 0;
    this.brain.moving = false;
    this.brain.speedRatio = 0;
    game?.addParticleBurst?.(this.root.position, this.genome.palette.emissive, 32, 0.2);
    return queued;
  }

  _queueOverloadFieldBombardment(game) {
    const center = this.encounterArena?.zoneCenter
      ?? this.encounterArena?.center
      ?? this.root.position;
    const halfWidth = Math.max(2.5, this.encounterArena?.softHalfWidth ?? 5.2);
    const halfDepth = Math.max(2.5, this.encounterArena?.softHalfDepth ?? 5.2);
    const playerTarget = game.player.root.position.clone();
    const targets = [playerTarget];
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2 + this.bossState.patternIndex * 0.37;
      targets.push(new THREE.Vector3(
        center.x + Math.cos(angle) * halfWidth * 0.68,
        center.y,
        center.z + Math.sin(angle) * halfDepth * 0.68,
      ));
    }
    targets.forEach((target, index) => {
      this._queueCircle(game, target, index === 0 ? 1.65 : 1.45, 0.82 + index * 0.09, 0.78, {
        patternRole: 'overloadFieldBlast',
      });
    });
  }

  _overloadSignaturePart(meta) {
    this._cancelBossArenaAttacks(this._runtimeGame, 'signature-overload');
    this.signaturePartOverloaded = true;
    this.signatureIntegrity = 0;
    this.bossState.interruptRemaining = SIGNATURE_BREAK_INTERRUPT;
    this.bossState.arenaCooldown = Math.max(this.bossState.arenaCooldown, SIGNATURE_BREAK_INTERRUPT + 0.35);
    this.signatureVisual.outer.visible = false;
    this.signatureVisual.brace.rotation.z += 0.62;
    this.signatureVisual.brace.material.color.setHex(0x49392f);
    this.signatureVisual.core.material.emissiveIntensity = 0.26;
    meta.signaturePartOverloaded = true;
    this.brain.state = 'recovery';
    this.brain.stateTime = 0;
    this.brain.moving = false;
    this.knockback.set(0, 0, 0);
    const game = this._runtimeGame;
    game?.cancelEnemyAttackRequest?.(this);
    this._getSignatureWorldPosition(tempA);
    game?.addParticleBurst?.(tempA, 0xffb347, 42, 0.24);
    game?.addHitEffect?.(tempA, 0xffd36f, 1.35, { absolute: true });
    game?.combat?.transferLockOnTarget?.(this.signatureTarget, this);
    game?.ui?.showToast?.('Signature housing overloaded — phase system weakened', '#ffd36f');
  }

  prePlayerUpdate(dt, game) {
    if (this.dead || this.bossState?.cleaned) return;
    this.specialEncounter?.prePlayerUpdate(dt, game);
  }

  update(dt, game) {
    super.update(dt, game);
    if (this.dead) {
      this._cleanupBossArena(game, 'death');
      return;
    }
    const state = this.bossState;
    state.elapsed += dt;
    if (game.player.dead) {
      if (this.specialEncounter?.handlePlayerDefeat?.(game)) return;
      this.brain.moving = false;
      this.knockback.set(0, 0, 0);
      this._cleanupBossArena(game, 'defeat');
      return;
    }
    if (!state.introShown) {
      state.introShown = true;
      this._ensureArenaConstructs(game);
      game.ui?.showBossIntro?.(this);
    }
    state.transitionRemaining = Math.max(0, state.transitionRemaining - dt);
    state.interruptRemaining = Math.max(0, state.interruptRemaining - dt);
    const reliquary = state.reliquary;
    const shieldStunBefore = reliquary?.shieldStunRemaining ?? 0;
    if (reliquary) {
      reliquary.shieldStunRemaining = Math.max(0, reliquary.shieldStunRemaining - dt);
      if (shieldStunBefore > 0
        && reliquary.shieldStunRemaining <= 0
        && state.phase === 2
        && !this.dead) {
        this._activateOverloadShield(game);
      }
      this._updateOverloadShieldVisual(dt);
    }
    if (this.specialEncounter) {
      const specialPauseRemaining = Math.max(
        state.transitionRemaining,
        state.interruptRemaining,
      );
      if (specialPauseRemaining > 0) {
        // Keep paths and ceremony visuals updating without allowing the
        // encounter scheduler to start a new attack inside a boss-level lock.
        this.specialEncounter.attackCooldown = Math.max(
          this.specialEncounter.attackCooldown,
          specialPauseRemaining + dt,
        );
      }
      this.specialEncounter.update(dt, game);
      if (game.player.dead) {
        if (this.specialEncounter.handlePlayerDefeat?.(game)) return;
        this.brain.moving = false;
        this.knockback.set(0, 0, 0);
        this._cleanupBossArena(game, 'defeat');
        return;
      }
      if (state.transitionRemaining > 0
        || state.interruptRemaining > 0
        || this.specialEncounter.isMovementLocked()
        || this.specialEncounter.attack
        || game.player.dead) {
        this.brain.moving = false;
        this.knockback.set(0, 0, 0);
      }
      return;
    }
    this._updateArenaObjects(dt, game);
    if (state.transitionRemaining > 0
      || state.interruptRemaining > 0
      || (reliquary?.shieldStunRemaining ?? 0) > 0
      || game.player.dead) {
      this.brain.moving = false;
      this.knockback.set(0, 0, 0);
      return;
    }
    if (reliquary) this._updateOverloadReliquaryAmbient(dt, game);
    state.arenaCooldown -= dt;
    if (state.arenaCooldown <= 0) {
      this._startSignaturePattern(game);
      const phaseScale = state.phase === 2 ? 0.76 : 1;
      const weakenedScale = this.signaturePartOverloaded && !reliquary ? 1.34 : 1;
      state.arenaCooldown = (4.35 + this.aiRandom.float(0, 0.85)) * phaseScale * weakenedScale;
    }
  }

  _updateOverloadShieldVisual(dt) {
    const reliquary = this.bossState?.reliquary;
    const shield = this.overloadShieldVisual;
    if (!reliquary || !shield) return;
    shield.object.visible = reliquary.shieldActive && !this.dead;
    if (shield.object.visible) {
      const pulse = 1 + Math.sin(this.bossState.elapsed * 8.5) * 0.045;
      shield.object.scale.copy(shield.baseScale).multiplyScalar(pulse);
      shield.object.rotation.y += dt * 1.8;
      shield.object.rotation.z -= dt * 0.85;
      shield.material.opacity = 0.22 + 0.09 * Math.sin(this.bossState.elapsed * 7.2) ** 2;
      shield.material.emissiveIntensity = 1.1 + reliquary.shieldHits * 0.28;
      this.brain.defenseActive = true;
    } else if (reliquary.shieldStunRemaining > 0) {
      this.brain.defenseActive = false;
    }
  }

  _updateOverloadReliquaryAmbient(dt, game) {
    const reliquary = this.bossState.reliquary;
    this._pruneOverloadDetonators();
    reliquary.mineTimer -= dt;
    reliquary.minionTimer -= dt;

    if (reliquary.mineTimer <= 0 && reliquary.mode === 'flit') {
      this._dropOverloadMine(game);
      reliquary.mineTimer = this.aiRandom.float(
        this.bossState.phase === 2 ? 0.72 : 0.9,
        this.bossState.phase === 2 ? 1.05 : 1.28,
      );
    }

    if (reliquary.minionTimer <= 0) {
      this._spawnOverloadDetonators(game, this.bossState.phase === 2 ? 2 : 1);
      reliquary.minionTimer = this.aiRandom.float(
        this.bossState.phase === 2 ? 4.6 : 7.1,
        this.bossState.phase === 2 ? 5.8 : 8.7,
      );
    }
  }

  _dropOverloadMine(game) {
    const activeProjectiles = game?.projectiles?.active ?? [];
    const bossProjectiles = activeProjectiles.filter((projectile) => projectile.source === this);
    const activeMines = bossProjectiles.filter((projectile) => projectile.landAsMine || projectile.landedMine);
    if (bossProjectiles.length >= REAVERBOT_BOSS_LIMITS.projectiles
      || activeMines.length >= OVERLOAD_MINE_CAP) {
      return false;
    }

    const angle = this.aiRandom.float(-Math.PI, Math.PI);
    const distance = this.aiRandom.float(0.8, 2.1);
    tempA.copy(this.root.position);
    tempA.x += Math.cos(angle) * distance;
    tempA.z += Math.sin(angle) * distance;
    const floorY = game.dungeonController?.getSurfaceElevationAt?.(tempA) ?? tempA.y;
    tempA.y = floorY + 0.08;
    tempB.copy(tempA).sub(this.root.position).setY(0);
    const horizontalDistance = Math.max(0.35, tempB.length());
    if (tempB.lengthSq() <= 0.0001) tempB.set(Math.cos(angle), 0, Math.sin(angle));
    else tempB.normalize();
    tempC.copy(this.root.position);
    tempC.y += this.collisionHeight * 0.18;
    const projectile = game.projectiles?.spawn?.({
      owner: 'enemy',
      position: tempC,
      direction: tempB.clone(),
      speed: 4.2,
      range: horizontalDistance,
      radius: 0.22,
      damage: this.stats.damage * 0.72,
      color: this.genome.palette.emissive,
      source: this,
      explosiveRadius: 2.15,
      explodeOnExpire: true,
      arcHeight: 0.38 + Math.max(0, this.root.position.y - floorY) * 0.16,
      endY: floorY + 0.08,
      visualType: 'grenade',
      landAsMine: true,
      mineLifetime: 7.2,
      mineArmDelay: 0.42,
      mineTriggerRadius: 1.35,
    });
    if (projectile) game.addParticleBurst?.(tempC, this.genome.palette.emissive, 7, 0.08);
    return Boolean(projectile);
  }

  _getLiveOverloadDetonators() {
    const reliquary = this.bossState?.reliquary;
    if (!reliquary) return [];
    return [...reliquary.summonedDetonators].filter((enemy) => enemy && !enemy.dead && enemy.root);
  }

  _pruneOverloadDetonators() {
    const reliquary = this.bossState?.reliquary;
    if (!reliquary) return;
    for (const enemy of [...reliquary.summonedDetonators]) {
      if (!enemy || enemy.dead || !enemy.root?.parent) reliquary.summonedDetonators.delete(enemy);
    }
  }

  _spawnOverloadDetonators(game, requestedCount = 1) {
    const reliquary = this.bossState?.reliquary;
    if (!reliquary || !game?.spawner) return 0;
    this._pruneOverloadDetonators();
    let spawned = 0;
    const available = Math.max(0, OVERLOAD_DETONATOR_CAP - this._getLiveOverloadDetonators().length);
    const count = Math.min(available, Math.max(0, Math.floor(requestedCount)));
    const center = this.encounterArena?.zoneCenter ?? this.encounterArena?.center ?? this.root.position;
    for (let index = 0; index < count; index += 1) {
      const serial = reliquary.summonSerial++;
      const angle = (serial * 2.399963229728653) + this.aiRandom.float(-0.22, 0.22);
      const spawnPosition = new THREE.Vector3(
        center.x + Math.cos(angle) * this.aiRandom.float(3.2, 5.1),
        center.y,
        center.z + Math.sin(angle) * this.aiRandom.float(3.2, 5.1),
      );
      const floorY = game.dungeonController?.getSurfaceElevationAt?.(spawnPosition) ?? center.y;
      spawnPosition.y = floorY + 1.55;
      const minion = game.spawner.spawnEnemy('flying reaverbot', false, spawnPosition, {
        seed: `${this.expeditionSpec?.seed ?? this.id}:overload-minion:${serial}`,
        archetypeId: 'aerialBomber',
        encounterSize: 2,
        allowRandomElite: false,
        healthMultiplier: this.bossState.phase === 2 ? 1.65 : 1.4,
      });
      if (!minion) continue;
      minion.summonerBoss = this;
      minion.isReliquaryDetonator = true;
      minion.encounterId = this.encounterId;
      if (this.encounterArena) {
        minion.encounterArena = {
          ...this.encounterArena,
          center: this.encounterArena.center.clone(),
          zoneCenter: this.encounterArena.zoneCenter.clone(),
        };
      }
      const clearPosition = game.dungeonController?.findNearestEnemyClearPosition?.(
        minion,
        spawnPosition,
        { preferredPosition: spawnPosition, maximumRadius: 3.2 },
      );
      if (clearPosition) minion.root.position.copy(clearPosition);
      minion.brain.alerted = true;
      minion.brain.cooldown = Math.max(minion.brain.cooldown, 0.85);
      reliquary.summonedDetonators.add(minion);
      game.addParticleBurst?.(minion.root.position, this.genome.palette.emissive, 18, 0.14);
      spawned += 1;
    }
    return spawned;
  }

  _cleanupOverloadDetonators(game = this._runtimeGame) {
    const reliquary = this.bossState?.reliquary;
    if (!reliquary) return;
    for (const enemy of [...reliquary.summonedDetonators]) {
      if (!enemy) continue;
      game?.cancelEnemyAttackRequest?.(enemy);
      enemy.summonerBoss = null;
      if (game?.removeEnemy) {
        game.removeEnemy(enemy);
      } else {
        enemy.dispose?.();
        enemy.root?.removeFromParent?.();
        const index = game?.enemies?.indexOf?.(enemy) ?? -1;
        if (index >= 0) game.enemies.splice(index, 1);
      }
    }
    reliquary.summonedDetonators.clear();
  }

  _ensureArenaConstructs(game) {
    if (this.specialEncounter) {
      this.specialEncounter.initialize(game);
      return;
    }
    if (this._usesDetonatorShieldMechanic()) return;
    if (this.bossState.constructs.length) return;
    const center = this.encounterArena?.center ?? this.root.position;
    const count = this.bossProfileId === 'rubyOpticOracle' ? 4 : 3;
    for (let index = 0; index < count && index < REAVERBOT_BOSS_LIMITS.persistentConstructs; index += 1) {
      const angle = (index / count) * Math.PI * 2 + Math.PI * 0.25;
      const pylon = new THREE.Mesh(
        this.bossResources.pylonGeometry,
        this.bossResources.constructMaterial.clone(),
      );
      pylon.name = `reaverbotBossArenaConstruct_${this.bossProfileId}_${index}`;
      pylon.position.set(
        center.x + Math.cos(angle) * 5.2,
        center.y + 0.9,
        center.z + Math.sin(angle) * 5.2,
      );
      pylon.userData.bossProfileId = this.bossProfileId;
      pylon.userData.bossConstruct = true;
      pylon.userData.bossUniqueMaterial = true;
      pylon.userData.bossChargeReferences = 0;
      game.scene.add(pylon);
      this.bossState.constructs.push(pylon);
    }
  }

  _setPylonCharged(pylon, charged) {
    if (!pylon?.userData?.bossConstruct || !pylon.material) return;
    const current = Math.max(0, Number(pylon.userData.bossChargeReferences) || 0);
    pylon.userData.bossChargeReferences = charged ? current + 1 : Math.max(0, current - 1);
    if (pylon.userData.bossChargeReferences > 0) {
      pylon.material.emissive?.setHex?.(0x68ffd7);
      pylon.material.emissiveIntensity = 1.5;
      return;
    }
    pylon.material.emissive?.setHex?.(this.genome.palette.emissive);
    pylon.material.emissiveIntensity = 0.32;
  }

  _registerTelegraphPylons(entry, pylons = []) {
    entry.chargedPylons = [...new Set(pylons.filter(Boolean))];
    for (const pylon of entry.chargedPylons) this._setPylonCharged(pylon, true);
  }

  _addSafeSectorVisuals(entry, game) {
    entry.decorations = [];
    for (const sector of entry.safeSectors ?? []) {
      const angle = Math.atan2(sector.direction.z, sector.direction.x);
      const geometry = new THREE.CircleGeometry(
        1,
        32,
        -(angle + sector.halfAngle),
        sector.halfAngle * 2,
      );
      const material = new THREE.MeshBasicMaterial({
        color: 0x68ffd7,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      material.name = 'material_reaverbotBossSafeSector';
      const object = new THREE.Mesh(geometry, material);
      object.name = 'reaverbotBossSafeSectorTelegraph';
      object.userData.bossTelegraphDecoration = true;
      object.userData.bossSafeSector = true;
      object.position.copy(entry.center);
      object.position.y += 0.012;
      object.rotation.x = -Math.PI / 2;
      object.scale.setScalar(entry.radius);
      game.scene.add(object);
      entry.decorations.push(object);
    }
  }

  _clearTelegraphDecorations(entry) {
    if (entry.decorationsCleared) return;
    entry.decorationsCleared = true;
    for (const pylon of entry.chargedPylons ?? []) this._setPylonCharged(pylon, false);
    entry.chargedPylons = [];
    for (const object of entry.decorations ?? []) {
      object.removeFromParent();
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    }
    entry.decorations = [];
  }

  _spawnArenaNode(game, position, role, key) {
    const state = this.bossState;
    const constructCount = state.constructs.length
      + state.activeHazards.length
      + state.activeArenaNodes.length;
    if (constructCount >= REAVERBOT_BOSS_LIMITS.persistentConstructs) return null;
    const object = new THREE.Mesh(
      this.bossResources.arenaNodeGeometry,
      this.bossResources.constructMaterial,
    );
    const partId = `bossArenaNode:${this.bossProfileId}:${state.patternIndex}:${key}`;
    object.name = `reaverbotBossArenaNode_${role}`;
    object.position.copy(position);
    object.position.y = (game.dungeonController?.getSurfaceElevationAt?.(object.position) ?? position.y) + 0.34;
    object.scale.setScalar(role === 'embeddedShell' ? 1.18 : 0.9);
    object.userData.bossArenaNode = true;
    object.userData.bossArenaNodeRole = role;
    object.userData.bossProfileId = this.bossProfileId;
    game.scene.add(object);
    const integrityMax = Math.max(2, Math.min(8, this.stats.maxHealth * 0.01));
    const node = {
      partId,
      role,
      object,
      active: true,
      integrity: integrityMax,
      integrityMax,
      target: null,
    };
    node.target = {
      id: `${this.id}:${partId}`,
      ownerEnemy: this,
      partId,
      root: object,
      radius: role === 'embeddedShell' ? 0.34 : 0.28,
      isBossArenaNodeTarget: true,
      retainLockWhenInactive: true,
      get dead() { return !node.active || node.ownerEnemy?.dead; },
      get active() { return node.active && !node.ownerEnemy?.dead; },
      getWorldPosition(out) { return object.getWorldPosition(out); },
    };
    node.ownerEnemy = this;
    state.activeArenaNodes.push(node);
    return node;
  }

  _removeArenaNode(node, game, { cancelTelegraphs = false, reason = 'consumed' } = {}) {
    if (!node?.active) return false;
    node.active = false;
    node.object.removeFromParent();
    const index = this.bossState.activeArenaNodes.indexOf(node);
    if (index >= 0) this.bossState.activeArenaNodes.splice(index, 1);
    if (cancelTelegraphs) {
      for (let telegraphIndex = this.bossState.activeTelegraphs.length - 1; telegraphIndex >= 0; telegraphIndex -= 1) {
        const entry = this.bossState.activeTelegraphs[telegraphIndex];
        if (entry.arenaNode !== node) continue;
        this.bossState.activeTelegraphs.splice(telegraphIndex, 1);
        this._releaseTelegraph(entry);
      }
    }
    if (game?.combat?.lockOn?.target === node.target) {
      game.combat.transferLockOnTarget?.(node.target, this);
    }
    if (reason === 'shot') {
      node.object.getWorldPosition(tempA);
      game?.addParticleBurst?.(tempA, this.genome.palette.emissive, 18, 0.12);
      game?.addHitEffect?.(tempA, this.genome.palette.emissive, 0.72, { absolute: true });
    }
    return true;
  }

  _acquireTelegraph(kind, innerRatio = 0) {
    const state = this.bossState;
    const ratioKey = kind === 'ring' ? innerRatio.toFixed(4) : '0';
    const pooledIndex = state.telegraphPool.findIndex((entry) => (
      entry.userData.telegraphKind === kind
      && entry.userData.telegraphInnerRatioKey === ratioKey
    ));
    if (pooledIndex >= 0) return state.telegraphPool.splice(pooledIndex, 1)[0];
    const dynamicGeometry = kind === 'ring'
      ? new THREE.RingGeometry(innerRatio, 1, 48)
      : null;
    const mesh = new THREE.Mesh(
      kind === 'lane'
        ? this.bossResources.laneGeometry
        : dynamicGeometry ?? this.bossResources.diskGeometry,
      this.bossResources.telegraphMaterial.clone(),
    );
    mesh.name = `reaverbotBoss${kind === 'lane' ? 'Lane' : 'Circle'}Telegraph`;
    mesh.userData.telegraphKind = kind;
    mesh.userData.telegraphInnerRatioKey = ratioKey;
    mesh.userData.dynamicBossTelegraphGeometry = Boolean(dynamicGeometry);
    mesh.rotation.x = kind === 'lane' ? 0 : -Math.PI / 2;
    return mesh;
  }

  _releaseTelegraph(entry) {
    this._clearTelegraphDecorations(entry);
    const mesh = entry.object;
    mesh.removeFromParent();
    mesh.visible = false;
    if (this.bossState.telegraphPool.length < REAVERBOT_BOSS_LIMITS.telegraphs) {
      this.bossState.telegraphPool.push(mesh);
    }
  }

  _queueLane(game, origin, direction, length, width, warning, damageScale = 1, options = {}) {
    const inheritedTelegraphs = this.brain?.telegraphMarker ? 1 : 0;
    if (this.bossState.activeTelegraphs.length + inheritedTelegraphs
      >= REAVERBOT_BOSS_LIMITS.telegraphs) return false;
    const object = this._acquireTelegraph('lane');
    const flatDirection = direction.clone().setY(0).normalize();
    object.material.color.setHex(options.color ?? this.genome.palette.emissive);
    object.visible = true;
    object.position.copy(origin).addScaledVector(flatDirection, length * 0.5);
    object.position.y = (game.dungeonController?.getSurfaceElevationAt?.(object.position) ?? origin.y) + 0.035;
    object.rotation.set(0, Math.atan2(flatDirection.x, flatDirection.z), 0);
    object.scale.set(width * 2, 1, length);
    game.scene.add(object);
    const entry = {
      kind: 'lane', object, origin: origin.clone(), direction: flatDirection,
      length, width, warning: Math.max(0.55, warning), elapsed: 0, fired: false,
      damageScale, projectile: Boolean(options.projectile), echo: Boolean(options.echo),
      visualOnly: Boolean(options.visualOnly), patternRole: options.patternRole ?? null,
      followOrigin: options.followOrigin ?? null,
      decorationsCleared: false,
    };
    this._registerTelegraphPylons(entry, options.chargedPylons);
    this.bossState.activeTelegraphs.push(entry);
    return true;
  }

  _queueCircle(game, center, radius, warning, damageScale = 1, options = {}) {
    const inheritedTelegraphs = this.brain?.telegraphMarker ? 1 : 0;
    if (this.bossState.activeTelegraphs.length + inheritedTelegraphs
      >= REAVERBOT_BOSS_LIMITS.telegraphs) return false;
    const kind = options.ring ? 'ring' : 'circle';
    const innerRadius = Math.max(0, Math.min(radius, Number(options.innerRadius) || 0));
    const object = this._acquireTelegraph(kind, radius > 0 ? innerRadius / radius : 0);
    object.visible = true;
    object.position.copy(center);
    object.position.y = (game.dungeonController?.getSurfaceElevationAt?.(object.position) ?? center.y) + 0.04;
    object.rotation.set(-Math.PI / 2, 0, 0);
    object.scale.setScalar(radius);
    game.scene.add(object);
    const safeSectors = (options.safeSectors ?? []).map((sector) => ({
      direction: sector.direction.clone().setY(0).normalize(),
      halfAngle: Math.max(0.08, Math.min(Math.PI * 0.45, Number(sector.halfAngle) || 0.32)),
      pylon: sector.pylon ?? null,
    }));
    const entry = {
      kind, object, center: object.position.clone(), radius,
      innerRadius,
      warning: Math.max(0.75, warning), elapsed: 0, fired: false, damageScale,
      hazard: Boolean(options.hazard), projectile: Boolean(options.projectile),
      arenaNode: options.arenaNode ?? null,
      safeSectors,
      patternRole: options.patternRole ?? null,
      decorationsCleared: false,
    };
    this._registerTelegraphPylons(entry, safeSectors.map((sector) => sector.pylon));
    if (safeSectors.length) this._addSafeSectorVisuals(entry, game);
    this.bossState.activeTelegraphs.push(entry);
    return true;
  }

  _startSignaturePattern(game) {
    if (this.specialEncounter) {
      this.specialEncounter.debugStartAttack?.('directBeam', game);
      return;
    }
    const state = this.bossState;
    const pattern = getPatternForProfile(this.bossProfileId);
    state.patternIndex += 1;
    const center = this.encounterArena?.center ?? this.root.position;
    tempA.copy(game.player.root.position).sub(this.root.position).setY(0);
    if (tempA.lengthSq() <= 0.001) tempA.copy(WORLD_FORWARD);
    tempA.normalize();
    const phaseTwo = state.phase === 2;
    const weakened = this.signaturePartOverloaded;

    if (this._usesDetonatorShieldMechanic()) {
      if (state.patternIndex % 2 === 1) this._beginOverloadRaid(game);
      else this._queueOverloadFieldBombardment(game);
      return;
    }

    if (pattern === 'interceptLanes') {
      this._queueLane(game, this.root.position, tempA, 12, 0.48, 0.75, 0.82, { projectile: true });
      if (phaseTwo && !weakened) {
        tempB.copy(tempA).applyAxisAngle(THREE.Object3D.DEFAULT_UP, 0.42);
        this._queueLane(game, this.root.position, tempB, 12, 0.42, 0.92, 0.68, { echo: true });
      }
      return;
    }
    if (pattern === 'mirrorRoutes') {
      for (let index = 0; index < (phaseTwo && !weakened ? 2 : 1); index += 1) {
        const pylon = state.constructs[(state.patternIndex + index) % state.constructs.length];
        tempB.copy(pylon.position).sub(this.root.position).setY(0).normalize();
        this._queueLane(game, this.root.position, tempB, this.root.position.distanceTo(pylon.position), 0.24, 0.85, 0.62);
        tempC.copy(game.player.root.position).sub(pylon.position).setY(0).normalize();
        this._queueLane(game, pylon.position, tempC, 11, 0.3, 0.85, 0.92);
      }
      return;
    }
    if (pattern === 'impactGrid') {
      const velocity = game.player.velocity ?? tempC.set(0, 0, 0);
      for (let index = 0; index < (phaseTwo && !weakened ? 4 : 3); index += 1) {
        const predicted = game.player.root.position.clone().addScaledVector(velocity, 0.22 + index * 0.12);
        predicted.x += (index - 1.5) * 1.15;
        this._queueCircle(game, predicted, 1.05, 0.82 + index * 0.1, 0.72);
      }
      return;
    }
    if (pattern === 'crucibleLanes') {
      const laneCount = phaseTwo && !weakened ? 2 : 1;
      for (let index = 0; index < laneCount; index += 1) {
        const angle = ((state.patternIndex + index * 2) % 3) * (Math.PI * 2 / 3);
        tempB.set(Math.sin(angle), 0, Math.cos(angle));
        this._queueLane(game, center, tempB, 13.5, 1.05, 0.9 + index * 0.16, 0.92, {
          hazard: true,
          patternRole: 'heatedSlagLane',
        });
      }
      const safeAngle = ((state.patternIndex + 1) % 6) * (Math.PI / 3);
      const sectorTarget = center.clone();
      sectorTarget.x += Math.sin(safeAngle) * 7.2;
      sectorTarget.z += Math.cos(safeAngle) * 7.2;
      this._queueCircle(game, sectorTarget, phaseTwo ? 2.1 : 2.8, phaseTwo ? 0.78 : 1.05, 0.7, {
        projectile: true,
        patternRole: phaseTwo ? 'alternatingOuterFurnaceSector' : 'stableOuterRingSector',
      });
      tempC.copy(tempA).applyAxisAngle(
        THREE.Object3D.DEFAULT_UP,
        ((state.patternIndex % 5) - 2) * 0.22,
      );
      this._queueLane(game, this.root.position, tempC, 12.5, 0.48, phaseTwo ? 0.62 : 0.82, 0.58, {
        projectile: true,
        followOrigin: this.root,
        patternRole: 'controlledFlameSweep',
      });
      return;
    }
    if (pattern === 'pulseFan') {
      const rotationStep = ((state.patternIndex % 7) - 3) * 0.11;
      for (let index = 0; index < state.constructs.length; index += 1) {
        const pylon = state.constructs[index];
        tempB.copy(center).sub(pylon.position).setY(0).normalize();
        tempB.applyAxisAngle(THREE.Object3D.DEFAULT_UP, rotationStep);
        this._queueLane(game, pylon.position, tempB, 11.4, 0.2, 0.55 + index * 0.04, 0.48, {
          projectile: true,
          patternRole: 'rotatingPylonCrossfire',
          chargedPylons: [pylon],
        });
        if (phaseTwo && !weakened) {
          tempC.copy(tempB).applyAxisAngle(THREE.Object3D.DEFAULT_UP, rotationStep >= 0 ? 0.32 : -0.32);
          this._queueLane(game, pylon.position, tempC, 11.4, 0.18, 0.82 + index * 0.04, 0.4, {
            projectile: true,
            echo: true,
            patternRole: 'sustainedPylonSweep',
            chargedPylons: [pylon],
          });
        }
      }
      const fanCount = phaseTwo && !weakened ? 3 : 2;
      for (let index = 0; index < fanCount; index += 1) {
        const spread = (index - (fanCount - 1) * 0.5) * 0.34;
        tempB.copy(tempA).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spread + rotationStep * 0.5);
        this._queueLane(game, this.root.position, tempB, 12, 0.2, 0.55 + index * 0.13, 0.48, {
          projectile: true,
          followOrigin: this.root,
          patternRole: phaseTwo && !weakened ? 'mobileSustainedSweep' : 'pulseFanSafeWedge',
        });
      }
      return;
    }
    if (pattern === 'craterSalvo') {
      const count = phaseTwo && !weakened ? 2 : 1;
      for (let index = 0; index < count; index += 1) {
        const target = game.player.root.position.clone();
        target.addScaledVector(tempA, index === 0 ? -1.15 : 1.6);
        const arenaNode = this._spawnArenaNode(game, target, 'embeddedShell', `shell-${index}`);
        this._queueCircle(game, target, 1.38, 0.9 + index * 0.18, 1, {
          hazard: true,
          projectile: true,
          arenaNode,
        });
      }
      return;
    }
    if (pattern === 'clusterLattice') {
      const rotations = phaseTwo && !weakened ? [0, Math.PI / 5] : [0];
      for (let index = 0; index < 5; index += 1) {
        const nodeAngle = (index / 5) * Math.PI * 2;
        const nodePosition = center.clone();
        nodePosition.x += Math.cos(nodeAngle) * 2.45;
        nodePosition.z += Math.sin(nodeAngle) * 2.45;
        const arenaNode = this._spawnArenaNode(game, nodePosition, 'clusterChild', `child-${index}`);
        for (const rotation of rotations) {
          const angle = rotation + (index / 5) * Math.PI * 2;
          const target = game.player.root.position.clone();
          target.x += Math.cos(angle) * 1.65;
          target.z += Math.sin(angle) * 1.65;
          this._queueCircle(game, target, 0.72, 0.82, 0.48, { arenaNode });
        }
      }
      return;
    }
    if (pattern === 'feedCrossfire') {
      const links = phaseTwo && !weakened ? 2 : 1;
      const ammunitionMode = state.patternIndex % 2 === 0 ? 'focused' : 'fan';
      for (let index = 0; index < links; index += 1) {
        const pylon = state.constructs[(state.patternIndex + index) % state.constructs.length];
        tempB.copy(pylon.position).sub(this.root.position).setY(0).normalize();
        this._queueLane(
          game,
          this.root.position,
          tempB,
          this.root.position.distanceTo(pylon.position),
          0.11,
          0.75,
          0,
          {
            visualOnly: true,
            color: 0x68ffd7,
            patternRole: `feedLink:${ammunitionMode}`,
            chargedPylons: [pylon],
          },
        );
        tempC.copy(game.player.root.position).sub(pylon.position).setY(0);
        if (tempC.lengthSq() <= 0.001) tempC.copy(WORLD_FORWARD);
        tempC.normalize();
        const outputCount = ammunitionMode === 'fan' ? 3 : 1;
        for (let outputIndex = 0; outputIndex < outputCount; outputIndex += 1) {
          const spread = ammunitionMode === 'fan' ? (outputIndex - 1) * 0.24 : 0;
          tempB.copy(tempC).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spread);
          this._queueLane(game, pylon.position, tempB, 11, ammunitionMode === 'fan' ? 0.2 : 0.38, 0.75, ammunitionMode === 'fan' ? 0.43 : 0.78, {
            projectile: true,
            patternRole: `ammunitionOutput:${ammunitionMode}`,
          });
        }
      }
      return;
    }
    const pulseCount = phaseTwo && !weakened ? 2 : 1;
    for (let index = 0; index < pulseCount; index += 1) {
      const pylon = state.constructs[(state.patternIndex + index) % state.constructs.length];
      tempB.copy(pylon.position).sub(center).setY(0).normalize();
      const sphericalPulse = index === 0;
      this._queueCircle(game, center, sphericalPulse ? 3.15 : 5.25, 0.82 + index * 0.18, sphericalPulse ? 0.82 : 0.92, {
        ring: !sphericalPulse,
        innerRadius: sphericalPulse ? 0 : 3.65,
        patternRole: sphericalPulse ? 'sphericalPulse' : 'floorRingPulse',
        safeSectors: [{ direction: tempB, halfAngle: 0.34, pylon }],
      });
    }
  }

  _updateArenaObjects(dt, game) {
    if (this.specialEncounter) {
      this.specialEncounter.update(dt, game);
      return;
    }
    const state = this.bossState;
    for (let index = state.activeTelegraphs.length - 1; index >= 0; index -= 1) {
      const entry = state.activeTelegraphs[index];
      entry.elapsed += dt;
      if (entry.kind === 'lane' && entry.followOrigin?.position) {
        entry.origin.copy(entry.followOrigin.position);
        entry.object.position.copy(entry.origin).addScaledVector(entry.direction, entry.length * 0.5);
        entry.object.position.y = (game.dungeonController?.getSurfaceElevationAt?.(entry.object.position)
          ?? entry.origin.y) + 0.035;
      }
      entry.object.material.opacity = 0.22 + Math.min(0.46, (entry.elapsed / entry.warning) * 0.46);
      for (const decoration of entry.decorations ?? []) {
        decoration.material.opacity = 0.3 + Math.min(0.28, (entry.elapsed / entry.warning) * 0.28);
      }
      if (!entry.fired && entry.elapsed >= entry.warning) {
        entry.fired = true;
        this._fireTelegraph(entry, game);
      }
      if (entry.elapsed >= entry.warning + 0.2) {
        state.activeTelegraphs.splice(index, 1);
        this._releaseTelegraph(entry);
      }
    }
    for (let index = state.activeHazards.length - 1; index >= 0; index -= 1) {
      const hazard = state.activeHazards[index];
      hazard.life -= dt;
      hazard.tick -= dt;
      hazard.object.rotation.z += dt * 0.45;
      hazard.object.material.opacity = 0.12 + 0.09 * Math.sin(state.elapsed * 6);
      if (hazard.tick <= 0) {
        hazard.tick = 0.48;
        if (flatDistanceSquared(game.player.root.position, hazard.center) <= hazard.radius * hazard.radius) {
          game.player.takeIncomingHit({
            amount: this.stats.damage * 0.22,
            source: this,
            impactPosition: hazard.center,
            attackKind: 'bossCraterHazard',
            guardable: false,
            reactionTier: 0,
          });
        }
      }
      if (hazard.life <= 0) {
        hazard.object.removeFromParent();
        state.activeHazards.splice(index, 1);
      }
    }
  }

  _fireTelegraph(entry, game) {
    const player = game.player;
    const damage = this.stats.damage * entry.damageScale;
    let hits = false;
    if (entry.kind === 'lane') {
      if (entry.visualOnly) {
        hits = false;
      } else if (entry.projectile) {
        this._spawnBossProjectile(game, entry.origin, entry.direction, entry.length, damage);
      } else {
        hits = lineContainsPoint(
          player.root.position,
          entry.origin,
          entry.direction,
          entry.length,
          entry.width + player.radius,
        );
      }
    } else {
      const distanceSq = flatDistanceSquared(player.root.position, entry.center);
      hits = entry.kind === 'ring'
        ? distanceSq <= (entry.radius + player.radius) ** 2
          && distanceSq >= Math.max(0, entry.innerRadius - player.radius) ** 2
        : distanceSq <= (entry.radius + player.radius) ** 2;
      if (hits && pointIsInSafeSector(player.root.position, entry.center, entry.safeSectors)) {
        hits = false;
      }
      game.addExplosion?.(
        entry.center,
        damage,
        entry.radius,
        this.genome.palette.emissive,
        {
        source: this,
        damageEnemies: false,
        damagePlayer: false,
        triggerMines: false,
        },
      );
      if (entry.hazard) this._spawnCraterHazard(game, entry.center, entry.radius);
    }
    if (hits) {
      const hitResult = player.takeIncomingHit({
        amount: damage,
        source: this,
        impactPosition: entry.kind === 'lane' ? entry.origin : entry.center,
        attackKind: `boss:${this.bossProfileId}`,
        guardable: true,
        reactionTier: 1,
      });
      if (isResolvedPlayerContact(hitResult)) {
        game.addHitEffect?.(player.root.position, this.genome.palette.emissive, 0.8);
      }
    }
    if (entry.arenaNode?.active) {
      this._removeArenaNode(entry.arenaNode, game, { cancelTelegraphs: false, reason: 'fired' });
    }
  }

  _spawnBossProjectile(game, origin, direction, range, damage) {
    const activeCount = game.projectiles?.active?.filter?.((projectile) => projectile.source === this).length ?? 0;
    if (activeCount >= REAVERBOT_BOSS_LIMITS.projectiles) return false;
    const position = origin.clone();
    position.y += this.collisionHeight * 0.54;
    const projectile = game.projectiles?.spawn?.({
      owner: 'enemy', position, direction: direction.clone(), speed: 9.2,
      range, radius: 0.19, damage, color: this.genome.palette.emissive,
      source: this, visualType: 'shell',
    });
    if (!projectile) return false;
    game.addParticleBurst?.(position, this.genome.palette.emissive, 8, 0.08);
    return true;
  }

  _spawnCraterHazard(game, center, radius) {
    if (this.bossState.constructs.length
      + this.bossState.activeHazards.length
      + this.bossState.activeArenaNodes.length
      >= REAVERBOT_BOSS_LIMITS.persistentConstructs) return;
    const object = new THREE.Mesh(this.bossResources.diskGeometry, this.bossResources.hazardMaterial);
    object.name = 'reaverbotBossCraterHazard';
    object.rotation.x = -Math.PI / 2;
    object.position.copy(center);
    object.position.y += 0.025;
    object.scale.setScalar(radius);
    game.scene.add(object);
    this.bossState.activeHazards.push({
      object,
      center: center.clone(),
      radius,
      life: Math.min(5.2, REAVERBOT_BOSS_LIMITS.maximumHazardSeconds),
      tick: 0.32,
    });
  }

  getBossHudState() {
    const reliquary = this.bossState.reliquary;
    const specialHud = this.specialEncounter?.getHudState?.() ?? null;
    return {
      profileId: this.bossProfileId,
      title: this.bossProfile?.title ?? this.genome.name,
      displayName: this.genome.name,
      phase: this.bossState.phase,
      transitionRemaining: this.bossState.transitionRemaining,
      health: this.health,
      maxHealth: this.stats.maxHealth,
      healthRatio: Math.max(0, this.health / this.stats.maxHealth),
      signatureIntegrity: this.signatureIntegrity,
      signatureIntegrityMax: this.signatureIntegrityMax,
      signatureRatio: reliquary
        ? this.bossState.phase === 2
          ? Math.max(0, reliquary.shieldHits / Math.max(1, reliquary.shieldHitsMax))
          : 0
        : Math.max(0, this.signatureIntegrity / this.signatureIntegrityMax),
      signaturePartOverloaded: this.signaturePartOverloaded,
      shieldActive: reliquary?.shieldActive ?? false,
      shieldHits: reliquary?.shieldHits ?? 0,
      shieldHitsMax: reliquary?.shieldHitsMax ?? 0,
      shieldStunRemaining: reliquary?.shieldStunRemaining ?? 0,
      signatureStatus: specialHud?.signatureStatus ?? (reliquary
        ? this.bossState.phase === 1
          ? 'SHIELD DORMANT'
          : reliquary.shieldActive
          ? `SHIELD ${reliquary.shieldHits}/${reliquary.shieldHitsMax}`
          : reliquary.shieldStunRemaining > 0
            ? 'SHIELD BROKEN — STUNNED'
            : 'SHIELD REFORMING'
        : null),
      ...(specialHud ?? {}),
    };
  }

  getBossResourceCounts(game = this._runtimeGame) {
    if (this.specialEncounter) {
      const counts = this.specialEncounter.getResourceCounts();
      return this.bossState.cleaned ? { projectiles: 0, telegraphs: 0, constructs: 0 } : counts;
    }
    return {
      projectiles: game?.projectiles?.active?.filter?.((projectile) => projectile.source === this).length ?? 0,
      telegraphs: this.bossState.activeTelegraphs.length + (this.brain?.telegraphMarker ? 1 : 0),
      constructs: this.bossState.constructs.length
        + this.bossState.activeHazards.length
        + this.bossState.activeArenaNodes.length,
    };
  }

  onDeath(game, meta = {}) {
    super.onDeath(game, meta);
    this._cleanupBossArena(game, 'death');
  }

  _cancelBossArenaAttacks(game = this._runtimeGame, reason = 'interrupted') {
    if (!this.bossState || this.bossState.cleaned) return;
    this.specialEncounter?.cancelCurrentAttack(game, reason);
    for (const entry of [...this.bossState.activeTelegraphs]) this._releaseTelegraph(entry);
    for (const hazard of this.bossState.activeHazards) disposeObject(hazard.object);
    for (const node of [...this.bossState.activeArenaNodes]) {
      this._removeArenaNode(node, game, { cancelTelegraphs: false, reason });
    }
    this.bossState.activeTelegraphs.length = 0;
    this.bossState.activeHazards.length = 0;
    this.bossState.activeArenaNodes.length = 0;
    this._removeTelegraphMarker?.();
    game?.projectiles?.cancelWhere?.((projectile) => projectile.source === this, `boss-${reason}`);
  }

  _cleanupBossArena(game = this._runtimeGame, reason = 'dispose') {
    if (this.bossState.cleaned) return;
    this.bossState.cleaned = true;
    this.specialEncounter?.dispose(game, reason);
    this._cleanupOverloadDetonators(game);
    if (this.overloadShieldVisual?.object) this.overloadShieldVisual.object.visible = false;
    for (const entry of this.bossState.activeTelegraphs) this._clearTelegraphDecorations(entry);
    const telegraphObjects = new Set([
      ...this.bossState.activeTelegraphs.map((entry) => entry.object),
      ...this.bossState.telegraphPool,
    ]);
    for (const object of telegraphObjects) {
      disposeObject(object);
      object.material?.dispose?.();
      if (object.userData.dynamicBossTelegraphGeometry) object.geometry?.dispose?.();
    }
    for (const hazard of this.bossState.activeHazards) disposeObject(hazard.object);
    for (const node of this.bossState.activeArenaNodes) disposeObject(node.object);
    for (const construct of this.bossState.constructs) {
      disposeObject(construct);
      if (construct.userData.bossUniqueMaterial) construct.material?.dispose?.();
    }
    this.bossState.activeTelegraphs.length = 0;
    this.bossState.activeHazards.length = 0;
    this.bossState.activeArenaNodes.length = 0;
    this.bossState.constructs.length = 0;
    this.bossState.telegraphPool.length = 0;
    game?.projectiles?.cancelWhere?.((projectile) => projectile.source === this, `boss-${reason}`);
  }

  dispose() {
    this._cleanupBossArena(this._runtimeGame, 'dispose');
    for (const material of this.signatureVisual?.materials ?? []) material.dispose?.();
    this.signatureVisual?.outer?.geometry?.dispose?.();
    this.signatureVisual?.brace?.geometry?.dispose?.();
    this.signatureVisual?.core?.geometry?.dispose?.();
    if (this.overloadShieldVisual) {
      this.overloadShieldVisual.object.removeFromParent();
      this.overloadShieldVisual.geometry.dispose?.();
      this.overloadShieldVisual.material.dispose?.();
      this.overloadShieldVisual = null;
    }
    disposeSharedBossResources(this.bossResources);
    if (this.authoredVisualState === 'active' && this.visual?.root) {
      disposeVisualTree(this.visual.root);
      this.visual.materials = {};
      this.authoredVisualState = 'disposed';
    }
    super.dispose();
  }
}
