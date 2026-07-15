import * as THREE from 'three';
import { ReaverbotEnemy } from './ReaverbotEnemy.js';
import { REAVERBOT_BOSS_LIMITS } from './ReaverbotBossCatalog.js';
import {
  animateAuthoredRubyOpticOracleVisual,
  disposeVisualTree,
  loadAuthoredRubyOpticOracleVisual,
} from './AuthoredRubyOpticOracle.js';

export { REAVERBOT_BOSS_LIMITS } from './ReaverbotBossCatalog.js';

const PHASE_TWO_THRESHOLD = 0.5;
const PHASE_TRANSITION_DURATION = 1.1;
const SIGNATURE_INTEGRITY_SCALE = 0.24;
const SIGNATURE_DAMAGE_MULTIPLIER = 1.5;
const SIGNATURE_BREAK_INTERRUPT = 2;
const BOSS_STAGGER_SCALE = 0.35;
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempC = new THREE.Vector3();

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

function getPatternForProfile(profileId) {
  switch (profileId) {
    case 'pursuitRegent': return 'interceptLanes';
    case 'rubyOpticOracle': return 'mirrorRoutes';
    case 'ballisticsVizier': return 'impactGrid';
    case 'revolvingFusillade': return 'pulseFan';
    case 'highAngleBastion': return 'craterSalvo';
    case 'clusterSalvoReliquary': return 'clusterLattice';
    case 'feedDrumArsenal': return 'feedCrossfire';
    case 'overloadReliquary': return 'concentricPulse';
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
    this.bossResources = createSharedBossResources(this.genome.palette.emissive);
    this.authoredVisualState = this.bossProfileId === 'rubyOpticOracle' ? 'loading' : 'notApplicable';
    if (this.bossProfileId === 'rubyOpticOracle') this._loadPreferredAuthoredVisual();
  }

  async _loadPreferredAuthoredVisual() {
    const fallbackVisual = this.visual;
    try {
      const authoredVisual = await loadAuthoredRubyOpticOracleVisual(this);
      if (this.disposed || this.dead) {
        disposeVisualTree(authoredVisual.root);
        return;
      }
      fallbackVisual.root.removeFromParent();
      this.visual = authoredVisual;
      this.root.add(authoredVisual.root);
      this.authoredVisualState = 'active';
      this.root.userData.authoredBossModel = 'rubyOpticOracle';
      this.root.userData.authoredBossFallbackActive = false;
      this._captureMaterialStates();
      disposeVisualTree(fallbackVisual.root);
    } catch (error) {
      this.authoredVisualState = 'fallback';
      this.root.userData.authoredBossFallbackActive = true;
      console.warn('Could not load authored Ruby Optic Oracle; using procedural fallback.', error);
    }
  }

  _animateVisual(dt) {
    if (this.authoredVisualState !== 'active') {
      super._animateVisual(dt);
      return;
    }
    const duration = this._getStateDuration(this.brain.state);
    animateAuthoredRubyOpticOracleVisual(this.visual, {
      time: this.brain.time,
      dt,
      moving: this.brain.moving,
      speedRatio: this.brain.speedRatio,
      state: this.brain.state,
      stateProgress: Math.max(0, Math.min(1, this.brain.stateTime / Math.max(0.01, duration))),
      defenseActive: this.brain.defenseActive,
      weakPointExposed: this.brain.weakPointExposed,
    });
    this._applyRushAttackWarning(dt);
  }

  _createSignatureTarget() {
    const owner = this;
    return {
      id: `${this.id}:signature:${this.bossProfileId}`,
      ownerEnemy: this,
      partId: `signature:${this.bossProfileId}`,
      root: this.signatureVisual.core,
      radius: Math.max(0.24, this.radius * 0.24),
      isWeakPointTarget: true,
      isBossSignatureTarget: true,
      retainLockWhenInactive: true,
      get dead() { return owner.dead; },
      get active() { return !owner.dead && !owner.signaturePartOverloaded; },
      getWorldPosition(out) { return owner.signatureVisual.core.getWorldPosition(out); },
    };
  }

  getCombatTargets() {
    const targets = super.getCombatTargets();
    if (!this.signaturePartOverloaded && !this.dead) targets.unshift(this.signatureTarget);
    const arenaTargets = this.bossState?.activeArenaNodes
      ?.filter((node) => node.active)
      .map((node) => node.target) ?? [];
    targets.unshift(...arenaTargets);
    return targets;
  }

  resolveProjectileHit(position, projectileRadius = 0.1) {
    const arenaNode = this._resolveArenaNodePointHit(position, projectileRadius);
    if (arenaNode) return arenaNode;
    const signature = this._resolveSignaturePointHit(position, projectileRadius);
    return signature ?? super.resolveProjectileHit(position, projectileRadius);
  }

  resolveLineHit(start, direction, range, width = 0.1, options = {}) {
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
    if (!this.signaturePartOverloaded && !this.dead) {
      this.signatureVisual.core.getWorldPosition(tempA);
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
    if (!this.signaturePartOverloaded && !this.dead) {
      this.signatureVisual.core.getWorldPosition(tempA);
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
    if (this.signaturePartOverloaded || this.dead) return null;
    this.signatureVisual.core.getWorldPosition(tempA);
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
    if (this.bossState?.transitionRemaining > 0 || this.bossState?.interruptRemaining > 0) {
      meta.bossInvulnerable = true;
      return 0;
    }
    if (!meta.bossScriptedDisplacement) {
      meta.knockbackDirection = null;
      meta.knockback = 0;
    }
    let adjusted = super.modifyDamageTaken(amount, meta);
    if (meta.signaturePartHit
      && (meta.projectileHit || meta.directHit || meta.directContactHit)
      && !meta.explosionSplash
      && !meta.areaDamage) {
      adjusted *= SIGNATURE_DAMAGE_MULTIPLIER;
      meta.bossSignatureMultiplier = SIGNATURE_DAMAGE_MULTIPLIER;
    }
    if (this.bossState?.phase === 1) {
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
    const directSignatureHit = meta.signaturePartHit
      && (meta.projectileHit || meta.directHit || meta.directContactHit)
      && !meta.explosionSplash
      && !meta.areaDamage;
    if (directSignatureHit && dealt > 0 && !this.signaturePartOverloaded) {
      this.signatureIntegrity = Math.max(0, this.signatureIntegrity - dealt);
      if (this.signatureIntegrity <= 0) this._overloadSignaturePart(meta);
    }
    if (!this.dead && this.bossState.phase === 1
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
      || (this.bossState?.interruptRemaining ?? 0) > 0;
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
    this.signatureVisual.core.getWorldPosition(tempA);
    game?.addParticleBurst?.(tempA, 0xffb347, 42, 0.24);
    game?.addHitEffect?.(tempA, 0xffd36f, 1.35, { absolute: true });
    game?.combat?.transferLockOnTarget?.(this.signatureTarget, this);
    game?.ui?.showToast?.('Signature housing overloaded — phase system weakened', '#ffd36f');
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
    this._updateArenaObjects(dt, game);
    if (state.transitionRemaining > 0 || state.interruptRemaining > 0 || game.player.dead) {
      this.brain.moving = false;
      this.knockback.set(0, 0, 0);
      return;
    }
    state.arenaCooldown -= dt;
    if (state.arenaCooldown <= 0) {
      this._startSignaturePattern(game);
      const phaseScale = state.phase === 2 ? 0.76 : 1;
      const weakenedScale = this.signaturePartOverloaded ? 1.34 : 1;
      state.arenaCooldown = (4.35 + this.aiRandom.float(0, 0.85)) * phaseScale * weakenedScale;
    }
  }

  _ensureArenaConstructs(game) {
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
    const state = this.bossState;
    const pattern = getPatternForProfile(this.bossProfileId);
    state.patternIndex += 1;
    const center = this.encounterArena?.center ?? this.root.position;
    tempA.copy(game.player.root.position).sub(this.root.position).setY(0);
    if (tempA.lengthSq() <= 0.001) tempA.copy(WORLD_FORWARD);
    tempA.normalize();
    const phaseTwo = state.phase === 2;
    const weakened = this.signaturePartOverloaded;

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
          game.player.takeDamage(this.stats.damage * 0.22, this, { attackKind: 'bossCraterHazard' });
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
      const dealt = player.takeDamage(damage, this, { attackKind: `boss:${this.bossProfileId}` });
      if (dealt > 0) game.addHitEffect?.(player.root.position, this.genome.palette.emissive, 0.8);
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
      signatureRatio: Math.max(0, this.signatureIntegrity / this.signatureIntegrityMax),
      signaturePartOverloaded: this.signaturePartOverloaded,
    };
  }

  getBossResourceCounts(game = this._runtimeGame) {
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
    disposeSharedBossResources(this.bossResources);
    super.dispose();
  }
}
