import * as THREE from 'three';
import {
  ASCENSION_ENGINE_MODES,
  ASCENSION_ENGINE_SEAL_COUNT,
  ASCENSION_ENGINE_TUNING,
  ASCENSION_RELIQUARY_SCALE,
  ASCENSION_RELIQUARY_SEGMENTS,
  breakAscensionSeal,
  createAscensionAttackSequence,
  createAscensionEngineState,
  getAscensionCheckpoint,
  normalizeAscensionCheckpoint,
} from './AscensionEngineContract.js';
import {
  VERTICAL_TRANSIT_RELIQUARY_ID,
  createVerticalTransitReliquary,
} from './VerticalTransitReliquary.js';

const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempC = new THREE.Vector3();
const ASCENSION_SEAL_RING_RADIUS = 0.66;

function clamp01(value) {
  return THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
}

function flatDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function disposeObject(object) {
  if (!object) return;
  const geometries = new Set();
  const materials = new Set();
  object.traverse?.((child) => {
    if (child.geometry) geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of childMaterials) if (material) materials.add(material);
  });
  object.removeFromParent?.();
  geometries.forEach((geometry) => geometry.dispose?.());
  materials.forEach((material) => material.dispose?.());
}

function lineHit(point, start, direction, range, radius) {
  tempA.copy(point).sub(start);
  const along = tempA.dot(direction);
  if (along < 0 || along > range) return null;
  const perpendicularSq = Math.max(0, tempA.lengthSq() - along * along);
  return perpendicularSq <= radius * radius ? along : null;
}

function modeLabel(mode) {
  switch (mode) {
    case ASCENSION_ENGINE_MODES.TRAVERSAL: return 'TRAVERSAL — USE THE IMPACT ROUTE';
    case ASCENSION_ENGINE_MODES.PUNISH: return 'PUNISH — COMPRESSION SEAL EXPOSED';
    case ASCENSION_ENGINE_MODES.ESCAPE: return 'ESCAPE — WATCH THE NEXT ASCENT';
    case ASCENSION_ENGINE_MODES.SUMMIT: return 'SUMMIT TRIAL';
    case ASCENSION_ENGINE_MODES.FINAL_CHARGE: return 'FINAL SEAL — CANCEL THE ESCAPE';
    case ASCENSION_ENGINE_MODES.DEFEATED: return 'ASCENSION ENGINE HALTED';
    default: return 'ASCENSION ENGINE';
  }
}

function readPersistedCheckpoint(owner) {
  const progress = owner?.expeditionSpec?.encounterProgress;
  if (!progress || progress.encounterId !== VERTICAL_TRANSIT_RELIQUARY_ID) return 0;
  const byId = getAscensionCheckpoint(progress.securedCheckpointId);
  const byIndex = normalizeAscensionCheckpoint(progress.securedCheckpointIndex);
  return byId && byId.index === byIndex ? byIndex : 0;
}

export class AscensionEngineEncounter {
  constructor(owner) {
    this.owner = owner;
    this.game = null;
    this.stage = null;
    this.ownsStage = false;
    this.initialized = false;
    this.disposed = false;
    this.elapsed = 0;
    this.seed = owner.expeditionSpec?.seed ?? owner.genome?.seed ?? owner.id;
    this.state = createAscensionEngineState({ checkpointIndex: readPersistedCheckpoint(owner) });
    this.sealIntegrityMax = Math.max(
      4,
      owner.stats.maxHealth * ASCENSION_ENGINE_TUNING.sealIntegrityHealthScale,
    );
    this.sealIntegrity = Array.from(
      { length: ASCENSION_ENGINE_SEAL_COUNT },
      (_, index) => this.state.brokenSeals[index] ? 0 : this.sealIntegrityMax,
    );
    this.sealTargets = Array.from(
      { length: ASCENSION_ENGINE_SEAL_COUNT },
      (_, index) => this._createSealTarget(index),
    );
    this.routeStep = 0;
    this.playerRouteStep = -1;
    this.routeLead = null;
    this.awaitingSealCatchUp = false;
    this.attackCycle = 0;
    this.attackDeck = createAscensionAttackSequence({
      seed: this.seed,
      segmentIndex: this.state.segmentIndex,
      cycle: this.attackCycle,
    });
    this.attackDeckIndex = 0;
    this.attackCooldown = 0.75;
    this.activeAttack = null;
    this.bossTransit = null;
    this.telegraphs = [];
    this.shockwaves = [];
    this.ventTimers = new Map();
    this.ventLaunchCooldowns = new Map();
    this.escapeRemaining = 0;
    this.pendingCheckpointCommit = null;
    this.pendingVictoryCommit = null;
    this.finalChargeFailures = 0;
    this.summitTrialStarted = false;
    this.landingImpact = 0;
    this.boosterPower = 0;
    this.compression = 0;
    this.sweep = 0;
    this._lastResetAt = -Infinity;
  }

  _createSealTarget(index) {
    const encounter = this;
    return {
      id: `${this.owner.id}:ascensionSeal:${index}`,
      ownerEnemy: this.owner,
      partId: `ascensionSeal:${this.owner.id}:${index}`,
      root: this.owner.root,
      radius: THREE.MathUtils.clamp(this.owner.radius * 0.14, 0.14, 0.22),
      isWeakPointTarget: true,
      isBossSignatureTarget: true,
      isAscensionCompressionSeal: true,
      sealIndex: index,
      retainLockWhenInactive: false,
      get dead() { return encounter.disposed || encounter.owner.dead; },
      get active() {
        return !encounter.disposed
          && !encounter.owner.dead
          && encounter.state.activeSealIndex === index
          && encounter.sealIntegrity[index] > 0
          && !encounter.pendingCheckpointCommit
          && !encounter.pendingVictoryCommit;
      },
      getWorldPosition(out) { return encounter.getSealPosition(index, out); },
    };
  }

  initialize(game) {
    if (this.initialized || this.disposed) return this.initialized;
    this.game = game;
    this.stage = game?.bossStageRuntime?.id === VERTICAL_TRANSIT_RELIQUARY_ID
      ? game.bossStageRuntime
      : null;
    if (!this.stage) {
      const room = game?.dungeon?.rooms?.find?.((entry) => entry.id === 'bossRoom');
      if (!room) return false;
      this.stage = createVerticalTransitReliquary({
        room,
        tileSize: game.dungeon?.tileSize ?? 2.8,
        seed: `${this.seed}:debug-stage`,
      });
      this.ownsStage = true;
      this.stage.attachToDungeon(game.dungeon);
      this.stage.mount(game);
      game.bossStageRuntime = this.stage;
      for (const platform of this.stage.platforms) {
        if (!game.platformingPlatforms.includes(platform)) game.platformingPlatforms.push(platform);
      }
      game._rebuildPlatformingLedgeCandidates?.();
    }

    this.stage.mount(game);
    this.stage.setActiveSegment(this.state.segmentIndex);
    this.stage.resetSegment(this.state.segmentIndex);
    this.owner.health = Math.max(
      this.owner.stats.maxHealth * 0.25,
      this.owner.stats.maxHealth * (1 - this.state.securedCheckpoint * 0.25),
    );
    if (this.state.securedCheckpoint >= 3) {
      this.owner.bossState.phase = 2;
      this.owner.bossState.transitionRemaining = 0;
    }
    this._syncOwnerSignatureState();
    if (this.state.segmentIndex === 3) {
      this._prepareSummitLaunch();
    }
    this._placeBossForSegment(this.state.segmentIndex, { immediate: true });
    this._restorePlayerToCheckpoint({
      announce: this.state.securedCheckpoint > 0,
      restoreResources: false,
    });
    this.initialized = true;
    return true;
  }

  ownsBossPositioning() { return true; }
  ownsSignatureTarget() { return true; }
  ownsLockOnTargets() { return true; }
  ownsPhaseProgression() { return true; }
  shouldIgnoreGroundConstraint() { return true; }

  _checkpointPosition(index = this.state.securedCheckpoint) {
    return this.stage?.getCheckpoint(index)?.position?.clone?.() ?? this.owner.root.position.clone();
  }

  _placeBossForSegment(segmentIndex, { immediate = false } = {}) {
    const target = this._getBossPositionForSegment(segmentIndex);
    if (!target) return;
    if (immediate) this.owner.root.position.copy(target);
    else this.owner.root.position.lerp(target, 0.35);
  }

  _getBossPositionForSegment(segmentIndex) {
    const segment = ASCENSION_RELIQUARY_SEGMENTS[segmentIndex];
    if (!segment || !this.stage) return null;
    const target = this.stage.center.clone();
    target.y = segmentIndex === 3 ? segment.checkpointHeight : segment.startHeight + 1.15;
    if (segmentIndex === 0) target.z -= 2.2;
    else if (segmentIndex < 3) target.z += 1;
    return target;
  }

  _restorePlayerToCheckpoint({ announce = true, restoreResources = false } = {}) {
    const checkpoint = this.stage?.getCheckpoint(this.state.securedCheckpoint);
    const player = this.game?.player;
    if (!checkpoint || !player) return false;
    const position = checkpoint.position.clone();
    position.y += 0.03;
    const restored = player.restoreTraversalCheckpoint?.({
      position,
      facing: checkpoint.facing,
      healthFloorRatio: ASCENSION_ENGINE_TUNING.checkpointHealFloorRatio,
      restoreHealth: restoreResources,
      refillBarrier: restoreResources,
    });
    if (!restored) return false;
    this.game.dungeonController?.lastSafePlayerPosition?.copy?.(position);
    this.game.combat?._clearLockOn?.();
    this.game.cameraController?.snapTo?.(player);
    if (announce) {
      this.game.ui?.showToast?.(
        `Compression Seal ${this.state.securedCheckpoint} checkpoint restored`,
        '#ffd36f',
      );
    }
    return true;
  }

  _resetCurrentChamber(reason = 'fall') {
    if (reason !== 'checkpoint-defeat' && this.elapsed - this._lastResetAt < 0.6) return false;
    this._lastResetAt = this.elapsed;
    this.cancelCurrentAttack(this.game, reason);
    this.stage?.resetSegment(this.state.segmentIndex);
    this.routeStep = 0;
    this.playerRouteStep = -1;
    this.routeLead = null;
    this.awaitingSealCatchUp = false;
    this.attackCooldown = 0.9;
    this.state.activeSealIndex = null;
    this.state.mode = this.state.segmentIndex === 3
      ? ASCENSION_ENGINE_MODES.ESCAPE
      : ASCENSION_ENGINE_MODES.TRAVERSAL;
    if (this.state.segmentIndex === 3) this._prepareSummitLaunch();
    this._placeBossForSegment(this.state.segmentIndex, { immediate: true });
    this._restorePlayerToCheckpoint({
      announce: true,
      restoreResources: reason === 'checkpoint-defeat',
    });
    return true;
  }

  handlePlayerDefeat(game = this.game) {
    if (!game?.player?.dead || this.disposed || this.owner.dead) return false;
    this.game = game;
    return this._resetCurrentChamber('checkpoint-defeat');
  }

  prePlayerUpdate(_dt, game = this.game) {
    if (!this.initialize(game) || this.disposed) return;
  }

  update(dt, game = this.game) {
    if (!this.initialize(game) || this.disposed || this.owner.dead) return;
    this.game = game;
    const delta = Math.max(0, Number(dt) || 0);
    this.elapsed += delta;
    this.landingImpact = Math.max(0, this.landingImpact - delta * 3.5);
    this.boosterPower = Math.max(0, this.boosterPower - delta * 2.8);
    this.compression = Math.max(0, this.compression - delta * 2.4);
    this.sweep = THREE.MathUtils.lerp(this.sweep, 0, Math.min(1, delta * 4));
    this._facePlayer(delta);
    if (this.owner.debugGallery) {
      this.cancelCurrentAttack(game, 'debug-gallery');
      this.attackCooldown = Number.POSITIVE_INFINITY;
      this.owner.brain.state = 'idle';
      this.owner.brain.moving = false;
      return;
    }
    this._updateTelegraphs(delta);
    this._updateShockwaves(delta);
    this._updateVentStates(delta);
    this._updatePlayerRouteProgress();
    this._detectFall();

    if (this.pendingCheckpointCommit || this.pendingVictoryCommit || this.state.mode === ASCENSION_ENGINE_MODES.DEFEATED) {
      this.owner.brain.moving = false;
      return;
    }

    if (this.bossTransit) {
      this._updateBossTransit(delta);
      return;
    }

    if (this.activeAttack) {
      this._updateAttack(delta);
      return;
    }

    if (this.state.mode === ASCENSION_ENGINE_MODES.PUNISH) {
      this.state.punishRemaining = Math.max(0, this.state.punishRemaining - delta);
      if (this.state.punishRemaining <= 0) {
        if (this.state.segmentIndex === 3 && this.summitTrialStarted) {
          this._resumeSummitTrial();
        } else {
          this.state.activeSealIndex = null;
          this.state.mode = ASCENSION_ENGINE_MODES.ESCAPE;
          this.escapeRemaining = 1.35;
          this.boosterPower = 1;
        }
      }
      return;
    }

    if (this.state.mode === ASCENSION_ENGINE_MODES.FINAL_CHARGE) {
      this.state.finalChargeRemaining = Math.max(0, this.state.finalChargeRemaining - delta);
      this.compression = clamp01(1 - this.state.finalChargeRemaining / ASCENSION_ENGINE_TUNING.finalChargeSeconds);
      this.boosterPower = Math.max(this.boosterPower, this.compression);
      if (this.state.finalChargeRemaining <= 0) this._failFinalCharge();
      return;
    }

    if (this.state.mode === ASCENSION_ENGINE_MODES.ESCAPE) {
      if (this.state.segmentIndex === 3 && this._playerReachedSummit()) {
        this._beginSummitTrial();
        return;
      }
      this.escapeRemaining = Math.max(0, this.escapeRemaining - delta);
      if (this.escapeRemaining <= 0 && this.state.segmentIndex < 3) {
        if (this._playerReachedSealStation()) this._beginPunishWindow(undefined, { placeBoss: false });
        else this.state.mode = ASCENSION_ENGINE_MODES.TRAVERSAL;
      }
      return;
    }

    if (this.state.mode === ASCENSION_ENGINE_MODES.SUMMIT) {
      this.attackCooldown = Math.max(0, this.attackCooldown - delta);
      if (this.attackCooldown <= 0) this._startSummitAttack();
      return;
    }

    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    const route = this.stage?.getRoutePlatforms(this.state.segmentIndex) ?? [];
    if (this.awaitingSealCatchUp) {
      if (this._playerReachedSealStation()) {
        this._beginPunishWindow(undefined, { placeBoss: false });
      } else {
        this._holdRouteLead(delta);
      }
      return;
    }
    if (this.routeStep >= route.length) {
      const finalSequence = route.length - 1;
      if (finalSequence >= 0
        && this.playerRouteStep >= finalSequence
        && this.routeLead?.holding
        && this.routeLead.holdElapsed >= ASCENSION_ENGINE_TUNING.routeLeadMinimumHoldSeconds) {
        this._startSealApproach();
      } else {
        this._holdRouteLead(delta);
      }
      return;
    }

    // The Engine owns the forward step. It impacts the next mechanism first,
    // withdraws beside the following destination, and only advances again
    // after MegaMan has physically completed the mechanism it just authored.
    const previousRoute = route.find((entry) => entry.sequence === this.routeStep - 1);
    const clearingVentLanding = previousRoute?.role === 'launchVent'
      && this.routeStep < route.length;
    const caughtUp = this.routeStep === 0
      || clearingVentLanding
      || this.playerRouteStep >= this.routeStep - 1;
    const atLead = this.routeStep === 0 || (
      this.routeLead?.holding
      && this.routeLead.holdElapsed >= ASCENSION_ENGINE_TUNING.routeLeadMinimumHoldSeconds
    );
    if (!caughtUp || !atLead) {
      this._holdRouteLead(delta);
      return;
    }
    if (this.attackCooldown <= 0) this._startTraversalAttack();
  }

  _facePlayer(dt) {
    tempA.copy(this.game?.player?.root?.position ?? this.owner.root.position).sub(this.owner.root.position).setY(0);
    if (tempA.lengthSq() <= 0.0001) return;
    const targetYaw = Math.atan2(tempA.x, tempA.z);
    this.owner.root.rotation.y += THREE.MathUtils.clamp(
      shortestAngleDelta(this.owner.root.rotation.y, targetYaw),
      -dt * 7,
      dt * 7,
    );
  }

  _detectFall() {
    const player = this.game?.player;
    const checkpoint = this.stage?.getCheckpoint(this.state.securedCheckpoint);
    if (!player?.root || !checkpoint || player.dead) return;
    const belowCheckpoint = player.root.position.y < checkpoint.position.y - ASCENSION_ENGINE_TUNING.fallResetDepth;
    const authoredSupport = this.game?.getPlatformSupport?.(player.root.position)?.surface;
    const escapedShaft = this.stage.isOutsideTraversalBounds?.(player.root.position, 0.8)
      && authoredSupport?.environmentId !== VERTICAL_TRANSIT_RELIQUARY_ID;
    const fellToShaftFloor = this.state.securedCheckpoint > 0
      && player.root.position.y < checkpoint.position.y - 1.4
      && this.stage.isTraversalVoid?.(player.root.position)
      && authoredSupport?.environmentId !== VERTICAL_TRANSIT_RELIQUARY_ID
      && !player.isJumpAirborne?.();
    if (belowCheckpoint || fellToShaftFloor || escapedShaft) {
      this._resetCurrentChamber(escapedShaft ? 'shaft-boundary' : 'shaft-fall');
    }
  }

  _playerReachedSealStation() {
    const station = this.stage?.getSealStation(this.state.segmentIndex);
    const player = this.game?.player;
    if (!station || !player?.root) return false;
    const routeCount = this.stage?.getRoutePlatforms(this.state.segmentIndex)?.length ?? 0;
    if (this.state.segmentIndex < 3 && this.routeStep < routeCount) return false;
    return Boolean(station.platform?.containsTop?.(player.root.position, 0.45))
      && Math.abs(player.root.position.y - station.platform.topY) <= 1.45;
  }

  _playerReachedSummit() {
    const summit = this.stage?.getSealStation(3);
    const player = this.game?.player;
    return Boolean(summit && player?.root
      && summit.platform?.containsTop?.(player.root.position, 0.45)
      && Math.abs(player.root.position.y - summit.platform.topY) <= 1.5);
  }

  _playerReachedRoutePlatform(sequence) {
    const route = this.stage?.getRoutePlatforms(this.state.segmentIndex) ?? [];
    const platform = route.find((entry) => entry.sequence === sequence);
    const player = this.game?.player;
    if (!platform || !player?.root || player.dead) return false;
    if (platform.boardTriggeredLift && platform.riderDelivered) return true;
    if (player.isJumpAirborne?.()) return false;
    if (platform.dynamic
      && Math.abs(platform.topY - platform.targetTopY) > 0.015) return false;
    const supportResult = this.game?.getPlatformSupport?.(player.root.position) ?? null;
    const support = supportResult?.surface ?? null;
    const onTargetTop = platform.containsTop(player.root.position, 0.08)
      && Math.abs(player.root.position.y - platform.topY) <= 0.24;
    if (!onTargetTop) return false;
    if (support === platform) return true;
    // Equal-height authored surfaces intentionally overlap at handoff points.
    // The support resolver has one deterministic winner, but standing inside
    // both top footprints is physically equivalent for the impact trigger.
    return Boolean(support?.containsTop?.(player.root.position, 0.08))
      && Math.abs((supportResult?.elevation ?? Infinity) - platform.topY) <= 0.02;
  }

  _bossClearedRoutePlatform(platform) {
    if (!platform || !this.owner?.root) return false;
    const dx = Math.max(0, Math.abs(this.owner.root.position.x - platform.center.x) - platform.halfWidth);
    const dz = Math.max(0, Math.abs(this.owner.root.position.z - platform.center.z) - platform.halfDepth);
    return Math.hypot(dx, dz) >= ASCENSION_ENGINE_TUNING.routeLeadEdgeClearance - 0.02;
  }

  _markPlayerRouteStep(platform) {
    if (!platform
      || platform.segmentIndex !== this.state.segmentIndex
      || platform.sequence !== this.playerRouteStep + 1
      || platform.sequence >= this.routeStep
      || !this._bossClearedRoutePlatform(platform)) return false;
    this.playerRouteStep = platform.sequence;
    return true;
  }

  _updatePlayerRouteProgress() {
    const nextSequence = this.playerRouteStep + 1;
    if (nextSequence >= this.routeStep) return false;
    const platform = this.stage?.getRoutePlatforms(this.state.segmentIndex)
      ?.find((entry) => entry.sequence === nextSequence);
    if (!platform || platform.role === 'launchVent') return false;
    if (!this._playerReachedRoutePlatform(nextSequence)) return false;
    return this._markPlayerRouteStep(platform);
  }

  _holdRouteLead(dt = 0) {
    this.owner.brain.state = 'idle';
    this.owner.brain.moving = false;
    if (this.routeLead?.holding) {
      this.routeLead.holdElapsed += Math.max(0, Number(dt) || 0);
      this.boosterPower = Math.max(this.boosterPower, 0.3);
    }
  }

  _getRouteLeadSupport() {
    const route = this.stage?.getRoutePlatforms(this.state.segmentIndex) ?? [];
    return route.find((entry) => entry.sequence === this.routeStep)
      ?? this.stage?.getSealStation(this.state.segmentIndex)?.platform
      ?? null;
  }

  _getRouteLeadTarget(support, out = new THREE.Vector3()) {
    if (!support?.center || !this.stage?.center) return null;
    tempA.copy(this.stage.center).sub(support.center).setY(0);
    if (tempA.lengthSq() <= 0.001) tempA.set(0, 0, 1);
    else tempA.normalize();
    const turn = support.routeId === 'elevatorCounterweightFinal'
      ? -THREE.MathUtils.degToRad(5)
      : support.routeId === 'machinerySealApproach'
        ? THREE.MathUtils.degToRad(5)
        : 0;
    if (turn !== 0) {
      const x = tempA.x * Math.cos(turn) - tempA.z * Math.sin(turn);
      const z = tempA.x * Math.sin(turn) + tempA.z * Math.cos(turn);
      tempA.set(x, 0, z).normalize();
    }
    const projectedHalfExtent = Math.abs(tempA.x) * support.halfWidth
      + Math.abs(tempA.z) * support.halfDepth;
    out.copy(support.center).addScaledVector(
      tempA,
      projectedHalfExtent + ASCENSION_ENGINE_TUNING.routeLeadEdgeClearance,
    );
    out.y = support.topY + ASCENSION_ENGINE_TUNING.routeLeadHoverHeight;
    return out;
  }

  _startRouteLeadTransit() {
    const support = this._getRouteLeadSupport();
    const target = this._getRouteLeadTarget(support, tempB)?.clone?.();
    if (!support || !target) return false;
    const lead = {
      segmentIndex: this.state.segmentIndex,
      sequence: Number.isInteger(support.sequence) ? support.sequence : null,
      supportId: support.id,
      routeId: support.routeId ?? null,
      target,
      clearanceRadius: ASCENSION_ENGINE_TUNING.routeLeadEdgeClearance,
      holding: false,
      holdElapsed: 0,
    };
    const flightDuration = this._getFlightDuration(this.owner.root.position, target, 16, 0.35, 0.9);
    const started = this._startBossTransit('routeLead', target, {
      duration: flightDuration,
      arcHeight: 2.2,
      preserveCombatEffects: true,
      lead,
    });
    if (started) this.routeLead = lead;
    return started;
  }

  getRouteLeadDiagnostics() {
    if (!this.routeLead) return null;
    return {
      segmentIndex: this.routeLead.segmentIndex,
      sequence: this.routeLead.sequence,
      supportId: this.routeLead.supportId,
      routeId: this.routeLead.routeId,
      target: this.routeLead.target.clone(),
      clearanceRadius: this.routeLead.clearanceRadius,
      holding: this.routeLead.holding,
      holdElapsed: this.routeLead.holdElapsed,
    };
  }

  _startBossTransit(kind, target, {
    duration = 0.8,
    arcHeight = 2.4,
    punishDuration = ASCENSION_ENGINE_TUNING.punishWindowSeconds,
    preserveCombatEffects = false,
    lead = null,
  } = {}) {
    if (!target || this.bossTransit || this.disposed || this.owner.dead) return false;
    if (preserveCombatEffects) this.activeAttack = null;
    else this.cancelCurrentAttack(this.game, `boss-transit-${kind}`);
    this.bossTransit = {
      kind,
      elapsed: 0,
      duration: Math.max(0.18, Number(duration) || 0.8),
      arcHeight: Math.max(0, Number(arcHeight) || 0),
      from: this.owner.root.position.clone(),
      target: target.clone(),
      punishDuration,
      lead,
    };
    this.owner.brain.state = 'flight';
    this.owner.brain.moving = true;
    this.boosterPower = 1;
    return true;
  }

  _startSealApproach(duration = ASCENSION_ENGINE_TUNING.punishWindowSeconds) {
    const station = this.stage?.getSealStation(this.state.segmentIndex);
    if (!station || this.bossTransit) return false;
    const target = station.position.clone();
    const finalRoute = this.stage?.getRoutePlatforms(this.state.segmentIndex)?.at(-1);
    tempA.copy(station.position).sub(finalRoute?.center ?? this.stage.center).setY(0);
    if (tempA.lengthSq() <= 0.001) tempA.copy(this.stage.center).sub(station.position).setY(0);
    if (tempA.lengthSq() <= 0.001) tempA.set(1, 0, 0);
    else tempA.normalize();
    const stationHalfExtent = Math.abs(tempA.x) * station.platform.halfWidth
      + Math.abs(tempA.z) * station.platform.halfDepth;
    target.addScaledVector(tempA, Math.min(5, Math.max(2.5, stationHalfExtent - 2.5)));
    target.y -= 1.3;
    const flightDuration = this._getFlightDuration(this.owner.root.position, target, 14, 0.5, 1.45);
    return this._startBossTransit('sealApproach', target, {
      duration: flightDuration,
      arcHeight: 2.8,
      punishDuration: duration,
    });
  }

  _startSegmentAscent(segmentIndex) {
    const target = this._getBossPositionForSegment(segmentIndex);
    if (!target) return false;
    const flightDuration = this._getFlightDuration(this.owner.root.position, target, 12, 0.7, 1.8);
    return this._startBossTransit('segmentAscent', target, {
      duration: flightDuration,
      arcHeight: 3.6,
    });
  }

  _updateBossTransit(dt) {
    const transit = this.bossTransit;
    if (!transit) return;
    transit.elapsed += dt;
    const progress = clamp01(transit.elapsed / transit.duration);
    this.owner.root.position.lerpVectors(transit.from, transit.target, progress);
    this.owner.root.position.y += Math.sin(progress * Math.PI) * transit.arcHeight;
    this.owner.brain.moving = progress < 1;
    this.boosterPower = Math.max(this.boosterPower, 1 - progress * 0.35);
    if (progress < 1) return;

    this.owner.root.position.copy(transit.target);
    this.bossTransit = null;
    this.owner.brain.moving = false;
    if (transit.kind === 'routeLead') {
      if (this.routeLead && transit.lead === this.routeLead) {
        this.routeLead.holding = true;
        this.routeLead.holdElapsed = 0;
      }
      this.owner.brain.state = 'idle';
      this.boosterPower = Math.max(this.boosterPower, 0.3);
      this.attackCooldown = 0;
      return;
    }
    if (transit.kind === 'sealApproach') {
      this.landingImpact = 1;
      this.game.addParticleBurst?.(transit.target, 0xff8a3d, 24, 0.16);
      this._createShockwave(transit.target, ASCENSION_ENGINE_TUNING.shockwaveRadius);
      this.awaitingSealCatchUp = true;
      this.owner.brain.state = 'idle';
      return;
    }
    this.attackCooldown = Math.max(this.attackCooldown, 0.45);
  }

  _nextDeckAttack() {
    if (this.attackDeckIndex >= this.attackDeck.length) {
      this.attackCycle += 1;
      this.attackDeck = createAscensionAttackSequence({
        seed: this.seed,
        segmentIndex: this.state.segmentIndex,
        cycle: this.attackCycle,
      });
      this.attackDeckIndex = 0;
    }
    return this.attackDeck[this.attackDeckIndex++] ?? 'targetedPounce';
  }

  _createLandingTelegraph(position, radius = 1.7, role = 'landing', duration = 1.55) {
    const material = new THREE.MeshBasicMaterial({
      color: role === 'wallRebound' ? 0xffd36f : 0xff3a2f,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    material.name = 'material_ascensionLandingTelegraph';
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius * 0.72, radius, 48), material);
    mesh.name = `ascensionEngineTelegraph_${role}`;
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.position.copy(position);
    mesh.position.y += 0.045;
    this.game.scene.add(mesh);
    const life = Math.max(0.2, Number(duration) || 1.55);
    const entry = { object: mesh, life, maxLife: life, role };
    this.telegraphs.push(entry);
    return entry;
  }

  _getFlightDuration(from, target, speed, minimum = 0.5, maximum = 1.4) {
    return THREE.MathUtils.clamp(
      from.distanceTo(target) / Math.max(1, Number(speed) || 1),
      minimum,
      maximum,
    );
  }

  _startTraversalAttack() {
    const platforms = this.stage.getRoutePlatforms(this.state.segmentIndex);
    if (!platforms.length) return;
    const platform = platforms[this.routeStep % platforms.length];
    this.routeLead = null;
    const attackType = this.state.segmentIndex === 1
      ? 'wallRebound'
      : this.state.segmentIndex === 2 && this.routeStep % 3 === 1
        ? 'boosterWash'
        : this._nextDeckAttack();
    const target = platform.center.clone().setY(platform.topY);
    const warning = attackType === 'wallRebound' ? 1.35 : 1.2;
    const finalTarget = target.clone();
    const firstTarget = attackType === 'wallRebound'
      ? new THREE.Vector3(
        this.stage.center.x + (this.routeStep % 2 === 0 ? -ASCENSION_RELIQUARY_SCALE.wallReboundRadius : ASCENSION_RELIQUARY_SCALE.wallReboundRadius),
        Math.max(platform.topY + 1.35, this.owner.root.position.y + 1.1),
        THREE.MathUtils.clamp(platform.center.z, this.stage.center.z - 24, this.stage.center.z + 24),
      )
      : target;
    const flightDuration = this._getFlightDuration(
      this.owner.root.position,
      firstTarget,
      attackType === 'wallRebound' ? 18 : 14,
      attackType === 'wallRebound' ? 0.55 : 0.6,
      attackType === 'wallRebound' ? 1.25 : 1.45,
    );
    this._createLandingTelegraph(
      finalTarget,
      platform.role === 'launchVent'
        ? 2.8
        : THREE.MathUtils.clamp(Math.min(platform.halfWidth, platform.halfDepth) * 0.65, 2.8, 3.6),
      attackType,
      warning + flightDuration * (attackType === 'wallRebound' ? 2 : 1) + 0.08,
    );
    this.activeAttack = {
      type: attackType,
      platform,
      stage: 'telegraph',
      elapsed: 0,
      warning,
      flightDuration,
      from: this.owner.root.position.clone(),
      target: firstTarget,
      finalTarget,
      reboundsRemaining: attackType === 'wallRebound' ? 1 : 0,
      damageApplied: false,
    };
    this.compression = 1;
    this.owner.brain.state = 'telegraph';
    this.owner.brain.moving = false;
  }

  _startSummitAttack() {
    const type = this._nextDeckAttack();
    const player = this.game.player;
    const summit = this.stage.getSealStation(3).position;
    const target = player.root.position.clone();
    tempB.copy(target).sub(this.stage.center).setY(0);
    if (tempB.lengthSq() > ASCENSION_RELIQUARY_SCALE.summitCombatRadius ** 2) {
      tempB.normalize().multiplyScalar(ASCENSION_RELIQUARY_SCALE.summitCombatRadius);
      target.x = this.stage.center.x + tempB.x;
      target.z = this.stage.center.z + tempB.z;
    }
    target.y = summit.y - 1.3;
    if (type === 'skyfallBreaker' || type === 'emergencyPogo') {
      this.owner.root.position.y = summit.y + 8;
    }
    const warning = type === 'skyfallBreaker'
      ? 1.65
      : type === 'emergencyPogo'
        ? 0.85
        : type === 'compressionSweep'
          ? 1.45
          : 1.2;
    const finalTarget = target.clone();
    const firstTarget = type === 'doubleRebound'
      ? new THREE.Vector3(
        this.stage.center.x + (this.attackCycle % 2 === 0 ? -ASCENSION_RELIQUARY_SCALE.wallReboundRadius : ASCENSION_RELIQUARY_SCALE.wallReboundRadius),
        summit.y + 1.25,
        THREE.MathUtils.clamp(target.z, this.stage.center.z - 24, this.stage.center.z + 24),
      )
      : target;
    const flightDuration = this._getFlightDuration(
      this.owner.root.position,
      firstTarget,
      type === 'doubleRebound' ? 18 : type === 'emergencyPogo' ? 20 : 14,
      type === 'emergencyPogo' ? 0.42 : 0.6,
      type === 'doubleRebound' ? 1.25 : 1.5,
    );
    this._createLandingTelegraph(
      finalTarget,
      type === 'skyfallBreaker' ? 4.5 : type === 'emergencyPogo' ? 2.8 : 3.4,
      type,
      warning + flightDuration * (type === 'doubleRebound' ? 2 : 1) + 0.08,
    );
    this.activeAttack = {
      type,
      platform: null,
      stage: 'telegraph',
      elapsed: 0,
      warning,
      flightDuration,
      from: this.owner.root.position.clone(),
      target: firstTarget,
      finalTarget,
      reboundsRemaining: type === 'doubleRebound' ? 1 : 0,
      damageApplied: false,
      summit: true,
    };
    this.compression = type === 'skyfallBreaker' ? 0 : 1;
    this.boosterPower = type === 'skyfallBreaker' ? 1 : 0.6;
    if (type === 'compressionSweep') this.sweep = 1;
  }

  _updateAttack(dt) {
    const attack = this.activeAttack;
    attack.elapsed += dt;
    if (attack.stage === 'telegraph') {
      this.compression = Math.max(this.compression, clamp01(attack.elapsed / attack.warning));
      if (attack.type === 'boosterWash' && attack.elapsed >= attack.warning * 0.65) {
        this._applyBoosterWash(dt, attack);
      }
      if (attack.elapsed < attack.warning) return;
      attack.stage = 'flight';
      attack.elapsed = 0;
      attack.from.copy(this.owner.root.position);
      this.boosterPower = 1;
      return;
    }

    if (attack.stage === 'flight') {
      const progress = clamp01(attack.elapsed / attack.flightDuration);
      this.owner.root.position.lerpVectors(attack.from, attack.target, progress);
      this.owner.root.position.y += Math.sin(progress * Math.PI) * (attack.type === 'wallRebound' ? 3 : 6);
      this.owner.brain.moving = true;
      if (progress < 1) return;
      if (attack.reboundsRemaining > 0) {
        this.owner.root.position.copy(attack.target);
        this.game.addParticleBurst?.(attack.target, 0xffd36f, 20, 0.14);
        attack.from.copy(attack.target);
        attack.target.copy(attack.finalTarget);
        attack.reboundsRemaining -= 1;
        attack.elapsed = 0;
        attack.flightDuration = this._getFlightDuration(attack.from, attack.target, 18, 0.55, 1.35);
        this.boosterPower = 1;
        return;
      }
      this._landAttack(attack);
      return;
    }

    if (attack.stage === 'recovery') {
      if (attack.elapsed < attack.recovery) return;
      const summit = attack.summit;
      this.activeAttack = null;
      this.owner.brain.moving = false;
      if (summit) {
        this._beginPunishWindow(
          attack.type === 'skyfallBreaker' ? 4.4 : 2.7,
          { placeBoss: false },
        );
      } else {
        this.attackCooldown = 0;
        this._startRouteLeadTransit();
      }
    }
  }

  _landAttack(attack) {
    attack.stage = 'recovery';
    attack.elapsed = 0;
    attack.recovery = !attack.summit
      ? ASCENSION_ENGINE_TUNING.routeImpactRecoverySeconds
      : attack.type === 'skyfallBreaker'
      ? 1.15
      : attack.type === 'emergencyPogo'
        ? 0.48
        : 0.72;
    this.owner.root.position.copy(attack.target);
    this.owner.brain.moving = false;
    this.landingImpact = 1;
    this.game.addParticleBurst?.(attack.target, 0xff8a3d, 34, 0.22);
    const shockwaveRadius = attack.type === 'emergencyPogo'
      ? 5.5
      : attack.summit
        ? 11
        : ASCENSION_ENGINE_TUNING.shockwaveRadius;
    this._createShockwave(attack.target, shockwaveRadius);
    if (attack.type === 'compressionSweep') this._createShockwave(attack.target, 6.5);

    if (attack.platform) {
      const impacted = this.stage.commandPlatformImpact(this.state.segmentIndex, attack.platform.sequence);
      if (impacted?.role === 'launchVent') {
        this.ventTimers.set(impacted.routeId, 0.48);
      }
      this.routeStep += 1;
    }
    if (attack.type === 'compressionSweep') this.sweep = 1;
  }

  _applyBoosterWash(dt, attack) {
    const player = this.game.player;
    if (!player?.root || player.dead) return;
    tempA.copy(player.root.position).sub(this.owner.root.position).setY(0);
    const distance = tempA.length();
    if (distance > 12 || distance <= 0.001) return;
    tempA.normalize();
    player.root.position.addScaledVector(tempA, dt * 3.2);
    if (!attack.damageApplied && attack.elapsed >= attack.warning * 0.9) {
      attack.damageApplied = true;
      player.takeIncomingHit?.({
        amount: this.owner.stats.damage * 0.22,
        source: this.owner,
        attackKind: 'ascensionBoosterWash',
        guardable: true,
        reactionTier: 1,
        knockbackDirection: tempA,
        knockbackStrength: 0.35,
        impactPosition: player.root.position.clone(),
      });
    }
  }

  _createShockwave(center, maximumRadius) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xff7438,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    material.name = 'material_ascensionShockwave';
    const object = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.08, 56), material);
    object.name = 'ascensionEngineExpandingShockwave';
    object.rotation.x = -Math.PI * 0.5;
    object.position.copy(center);
    object.position.y += 0.08;
    this.game.scene.add(object);
    this.shockwaves.push({
      object,
      center: center.clone(),
      elapsed: 0,
      duration: THREE.MathUtils.clamp(maximumRadius / 7, 0.82, 1.75),
      maximumRadius,
      hit: false,
    });
  }

  _updateShockwaves(dt) {
    for (let index = this.shockwaves.length - 1; index >= 0; index -= 1) {
      const wave = this.shockwaves[index];
      wave.elapsed += dt;
      const progress = clamp01(wave.elapsed / wave.duration);
      const radius = THREE.MathUtils.lerp(0.8, wave.maximumRadius, progress);
      wave.object.scale.set(radius, radius, radius);
      wave.object.material.opacity = (1 - progress) * 0.72;
      const player = this.game?.player;
      if (!wave.hit && player?.root && !player.dead) {
        const playerRadius = flatDistance(player.root.position, wave.center);
        const inBand = Math.abs(playerRadius - radius) <= 0.28 + radius * 0.08;
        const jumped = player.root.position.y > wave.center.y + 0.72 || (player.velocity?.y ?? 0) > 1;
        if (inBand && !jumped) {
          wave.hit = true;
          tempA.copy(player.root.position).sub(wave.center).setY(0);
          if (tempA.lengthSq() <= 0.001) tempA.set(0, 0, 1);
          else tempA.normalize();
          player.takeIncomingHit?.({
            amount: this.owner.stats.damage * ASCENSION_ENGINE_TUNING.shockwaveDamageScale,
            source: this.owner,
            attackKind: 'ascensionLandingShockwave',
            guardable: true,
            reactionTier: 3,
            knockbackDirection: tempA,
            knockbackStrength: 0.72,
            impactPosition: player.root.position.clone(),
          });
        }
      }
      if (progress < 1) continue;
      disposeObject(wave.object);
      this.shockwaves.splice(index, 1);
    }
  }

  _updateTelegraphs(dt) {
    for (let index = this.telegraphs.length - 1; index >= 0; index -= 1) {
      const entry = this.telegraphs[index];
      entry.life -= dt;
      const progress = Math.max(0, entry.life / entry.maxLife);
      entry.object.material.opacity = 0.16 + progress * 0.46;
      entry.object.rotation.z += dt * 1.7;
      if (entry.life > 0) continue;
      disposeObject(entry.object);
      this.telegraphs.splice(index, 1);
    }
  }

  _updateVentStates(dt) {
    for (const [routeId, remaining] of [...this.ventTimers]) {
      const next = remaining - dt;
      if (next > 0) {
        this.ventTimers.set(routeId, next);
        continue;
      }
      this.ventTimers.delete(routeId);
      this.stage.setVentState(routeId, 'ready');
    }
    for (const [routeId, remaining] of [...this.ventLaunchCooldowns]) {
      const next = remaining - dt;
      if (next > 0) this.ventLaunchCooldowns.set(routeId, next);
      else {
        this.ventLaunchCooldowns.delete(routeId);
        this.stage.setVentState(routeId, 'ready');
      }
    }

    const route = this.stage.getRoutePlatforms(this.state.segmentIndex);
    for (const platform of route) {
      if (platform.ventState !== 'ready' || this.ventLaunchCooldowns.has(platform.routeId)) continue;
      if (!this._bossClearedRoutePlatform(platform)) continue;
      const launchLanding = route.find((entry) => entry.sequence === platform.sequence + 1);
      if (launchLanding
        && (this.routeStep <= launchLanding.sequence
          || !this._bossClearedRoutePlatform(launchLanding)
          || !this.routeLead?.holding)) continue;
      const player = this.game.player;
      if (!player?.root || player.dead || player.isJumpAirborne?.()) continue;
      if (!platform.containsTop(player.root.position, 0.12)
        || Math.abs(player.root.position.y - platform.topY) > 0.24) continue;
      const activationRadius = Math.max(0, Number(platform.launchActivationRadius) || 0);
      if (activationRadius <= 0
        || flatDistance(player.root.position, platform.center) > activationRadius) continue;
      const nextPlatform = route.find((entry) => entry.sequence === platform.sequence + 1);
      const target = nextPlatform?.center?.clone?.()
        ?? this.stage.getSealStation(this.state.segmentIndex)?.position?.clone?.()
        ?? platform.center.clone();
      tempA.copy(target).sub(player.root.position).setY(0);
      if (tempA.lengthSq() <= 0.001) tempA.set(0, 0, -1);
      else tempA.normalize();
      if (player.launchFromTraversalMechanism?.({
        verticalVelocity: this.state.segmentIndex === 3
          ? ASCENSION_ENGINE_TUNING.summitLaunchVelocity
          : ASCENSION_ENGINE_TUNING.launchVelocity,
        horizontalDirection: tempA,
        horizontalSpeed: ASCENSION_ENGINE_TUNING.launchHorizontalSpeed,
        sourceId: platform.routeId,
      })) {
        this._markPlayerRouteStep(platform);
        platform.ventState = 'launching';
        this.stage.setVentState(platform.routeId, 'launching');
        this.ventLaunchCooldowns.set(platform.routeId, 1.1);
        this.game.addParticleBurst?.(platform.center, 0xffffff, 28, 0.18);
      }
    }
  }

  _beginPunishWindow(
    duration = ASCENSION_ENGINE_TUNING.punishWindowSeconds,
    { placeBoss = true } = {},
  ) {
    const index = this.state.segmentIndex;
    this.awaitingSealCatchUp = false;
    this.routeLead = null;
    this.state.mode = ASCENSION_ENGINE_MODES.PUNISH;
    this.state.activeSealIndex = index;
    this.state.punishRemaining = duration;
    const station = this.stage.getSealStation(index);
    if (station && placeBoss) {
      this.owner.root.position.copy(station.position);
      this.owner.root.position.y -= 1.3;
    }
    this.owner.brain.state = 'recovery';
    this.owner.brain.moving = false;
    this._syncOwnerSignatureState();
    this.game.ui?.showToast?.(`Compression Seal ${index + 1} exposed`, '#ffd36f');
  }

  _beginSummitTrial() {
    if (this.summitTrialStarted || this.state.segmentIndex !== 3) return false;
    this.summitTrialStarted = true;
    this.awaitingSealCatchUp = false;
    this.routeLead = null;
    this.state.mode = ASCENSION_ENGINE_MODES.SUMMIT;
    this.state.activeSealIndex = null;
    this.attackCooldown = 0.75;
    const summit = this.stage.getSealStation(3);
    this.owner.root.position.copy(summit.position);
    this.owner.root.position.y -= 1.3;
    // Phase II already begins, and presents its transition, when Seal Three is
    // committed. Summit arrival starts the arena loop; it is not another phase
    // transition and must never replay the full-screen phase banner.
    return true;
  }

  _resumeSummitTrial() {
    this.state.mode = ASCENSION_ENGINE_MODES.SUMMIT;
    this.state.activeSealIndex = null;
    this.state.punishRemaining = 0;
    this.attackCooldown = Math.max(this.attackCooldown, 0.75);
    this.owner.brain.state = 'idle';
    this.owner.brain.moving = false;
    this._syncOwnerSignatureState();
  }

  _prepareSummitLaunch() {
    this.summitTrialStarted = false;
    const vent = this.stage.commandPlatformImpact(3, 0);
    if (vent) {
      this.stage.setVentState(vent.routeId, 'ready');
      vent.ventState = 'ready';
    }
    this.state.mode = ASCENSION_ENGINE_MODES.ESCAPE;
    this.escapeRemaining = ASCENSION_ENGINE_TUNING.escapeObservationSeconds;
  }

  _startFinalCharge() {
    this.cancelCurrentAttack(this.game, 'final-charge');
    this.state.mode = ASCENSION_ENGINE_MODES.FINAL_CHARGE;
    this.state.activeSealIndex = 3;
    this.state.finalChargeRemaining = ASCENSION_ENGINE_TUNING.finalChargeSeconds;
    this.compression = 0;
    this.boosterPower = 0.4;
    this.game.ui?.showToast?.('Final seal exposed — cancel the escape launch!', '#ff8f66');
  }

  _failFinalCharge() {
    this.finalChargeFailures += 1;
    this.state.finalChargeFailures = this.finalChargeFailures;
    const player = this.game.player;
    tempA.copy(player.root.position).sub(this.owner.root.position).setY(0);
    if (tempA.lengthSq() <= 0.001) tempA.set(0, 0, 1);
    else tempA.normalize();
    player.takeIncomingHit?.({
      amount: player.stats.maxHealth * ASCENSION_ENGINE_TUNING.failedMeteorHealthScale,
      source: this.owner,
      attackKind: 'ascensionSkyfallEscapeMeteor',
      guardable: false,
      reactionTier: 3,
      minimumReactionTier: 2,
      knockbackDirection: tempA,
      knockbackStrength: 0.9,
      impactPosition: this.owner.root.position.clone(),
    });
    this._createShockwave(this.owner.root.position, 12);
    this.state.mode = ASCENSION_ENGINE_MODES.PUNISH;
    this.state.activeSealIndex = 3;
    this.state.punishRemaining = 4.2;
    this.state.finalChargeRemaining = 0;
    this.compression = 0;
    this.game.ui?.showToast?.('Meteor survived — the final seal remains exposed', '#ffd36f');
  }

  getSealPosition(index, out = new THREE.Vector3()) {
    const authored = this.owner.visual?.authoredSeals?.[index]?.group;
    if (authored?.getWorldPosition) {
      authored.getWorldPosition(out);
      authored.getWorldScale(tempC);
      tempB.copy(this.game?.player?.root?.position ?? this.owner.root.position).sub(out).setY(0);
      if (tempB.lengthSq() <= 0.0001) {
        tempB.set(Math.sin(this.owner.root.rotation.y), 0, Math.cos(this.owner.root.rotation.y));
      } else {
        tempB.normalize();
      }
      // Authored seals are horizontal torus collars. Aim and lock-on belong on
      // the nearest visible circumference, not the empty center of the ring.
      return out.addScaledVector(
        tempB,
        ASCENSION_SEAL_RING_RADIUS * Math.max(Math.abs(tempC.x), Math.abs(tempC.z)),
      );
    }
    out.copy(this.owner.root.position);
    out.y += 1.2 + index * 0.52;
    tempB.copy(this.game?.player?.root?.position ?? out).sub(out).setY(0);
    if (tempB.lengthSq() > 0.0001) out.addScaledVector(tempB.normalize(), this.owner.radius * 0.55);
    return out;
  }

  getEyePosition(out = new THREE.Vector3()) {
    const eye = this.owner.visual?.eye?.lens ?? this.owner.visual?.eye?.group;
    if (eye?.getWorldPosition) return eye.getWorldPosition(out);
    out.copy(this.owner.root.position);
    out.y += this.owner.collisionHeight * 0.72;
    return out;
  }

  getCombatTargets() {
    return this.sealTargets.filter((target) => target.active);
  }

  resolveProjectileHit(position, projectileRadius = 0.1) {
    let best = null;
    for (const target of this.getCombatTargets()) {
      target.getWorldPosition(tempA);
      const radius = target.radius + projectileRadius;
      const distanceSq = position.distanceToSquared(tempA);
      if (distanceSq <= radius * radius && (!best || distanceSq < best.distanceSq)) {
        best = { target, distanceSq, position: tempA.clone() };
      }
    }
    return best ? this._hitInfo(best.target, 0, best.position) : null;
  }

  resolveLineHit(start, direction, range, width = 0.1) {
    let best = null;
    for (const target of this.getCombatTargets()) {
      target.getWorldPosition(tempA);
      const along = lineHit(tempA, start, direction, range, width + target.radius);
      if (along == null || (best && along >= best.along)) continue;
      best = { target, along, position: tempA.clone() };
    }
    return best ? this._hitInfo(best.target, best.along, best.position) : null;
  }

  resolveArcHit(origin, direction, range, halfAngle) {
    let best = null;
    tempC.copy(direction).setY(0);
    if (tempC.lengthSq() <= 0.001) tempC.set(0, 0, 1);
    tempC.normalize();
    for (const target of this.getCombatTargets()) {
      target.getWorldPosition(tempA);
      tempB.copy(tempA).sub(origin);
      const vertical = Math.abs(tempB.y);
      tempB.y = 0;
      const distance = tempB.length();
      if (distance > range + target.radius || vertical > 3 + target.radius) continue;
      if (distance > 0.001) tempB.divideScalar(distance);
      if (tempC.dot(tempB) < Math.cos(halfAngle)) continue;
      if (!best || distance < best.along) best = { target, along: distance, position: tempA.clone() };
    }
    return best ? this._hitInfo(best.target, best.along, best.position) : null;
  }

  _hitInfo(target, along, position) {
    return {
      along,
      hitPartId: target.partId,
      hitPosition: position,
      // The Compression Seal is a visible collar around the leg. Its detailed
      // hit volume must win over the boss's intentionally coarse body capsule
      // while exposed, otherwise every correctly aimed projectile is consumed
      // by the invulnerable traversal body before reaching the collar.
      exposedWeakPointHit: true,
      signaturePartHit: true,
      weakPointHit: true,
      ascensionSealHit: true,
      ascensionSealIndex: target.sealIndex,
    };
  }

  handlesPartId(partId) {
    return this.sealTargets.some((target) => target.partId === partId);
  }

  handlePartImpact(amount, meta = {}, game = this.game) {
    if (meta.ascensionSegmentDamage) return false;
    const target = this.sealTargets.find((entry) => entry.partId === meta.hitPartId);
    if (!target) return false;
    meta.ascensionSealHit = true;
    meta.ascensionSealIndex = target.sealIndex;
    meta.damageNullified = true;
    const direct = (meta.projectileHit || meta.directHit || meta.directContactHit)
      && !meta.explosionSplash
      && !meta.areaDamage;
    if (!direct || !target.active || amount <= 0) return true;

    const index = target.sealIndex;
    const incoming = Math.max(0, Number(amount) || 0);
    if (index === 3 && this.state.mode !== ASCENSION_ENGINE_MODES.FINAL_CHARGE) {
      const floor = this.sealIntegrityMax * ASCENSION_ENGINE_TUNING.finalChargeThresholdRatio;
      this.sealIntegrity[index] = Math.max(floor, this.sealIntegrity[index] - incoming);
      if (this.sealIntegrity[index] <= floor + 1e-6) this._startFinalCharge();
    } else {
      this.sealIntegrity[index] = Math.max(0, this.sealIntegrity[index] - incoming);
    }
    this._syncOwnerSignatureState();
    const hitPosition = this.getSealPosition(index, tempA);
    game?.addHitEffect?.(hitPosition, 0xffd36f, 1.05, { absolute: true });
    game?.addParticleBurst?.(hitPosition, 0xff8a3d, 10, 0.09);
    if (this.sealIntegrity[index] > 0) return true;

    if (index === 3) this._commitFinalVictory();
    else this._commitCheckpointSeal(index);
    return true;
  }

  adjustDamageTaken(amount, meta = {}) {
    if (meta.ascensionSegmentDamage) return amount;
    meta.bossInvulnerable = true;
    meta.ascensionTraversalDamageBlocked = true;
    return 0;
  }

  _commitCheckpointSeal(index) {
    if (this.pendingCheckpointCommit) return;
    const previewState = { ...this.state, activeSealIndex: index };
    const transition = breakAscensionSeal(previewState, index);
    if (!transition.ok || transition.completed) return;
    this.pendingCheckpointCommit = { index, transition };
    this.state.activeSealIndex = null;
    this.state.mode = ASCENSION_ENGINE_MODES.ESCAPE;
    this.boosterPower = 1;
    const checkpoint = getAscensionCheckpoint(transition.checkpointIndex);
    Promise.resolve(typeof this.game.commitAscensionCheckpoint === 'function'
      ? this.game.commitAscensionCheckpoint(this.owner, {
        securedCheckpointIndex: checkpoint.index,
        securedCheckpointId: checkpoint.id,
        brokenSealIndex: index,
      })
      : { ok: false, reason: 'storage-bridge-missing' }).then((result) => {
      if (this.disposed || this.owner.dead) return;
      if (!result?.ok) {
        this.pendingCheckpointCommit = null;
        this.sealIntegrity[index] = Math.max(1, this.sealIntegrityMax * 0.08);
        this.state.mode = ASCENSION_ENGINE_MODES.PUNISH;
        this.state.activeSealIndex = index;
        this.state.punishRemaining = 4;
        this._syncOwnerSignatureState();
        this.game.ui?.showToast?.('Checkpoint save failed — seal remains retryable', '#ff9f73');
        return;
      }
      this.state = transition.state;
      this.sealIntegrity[index] = 0;
      this.pendingCheckpointCommit = null;
      this.stage.setActiveSegment(this.state.segmentIndex);
      this.stage.resetSegment(this.state.segmentIndex);
      this.routeStep = 0;
      this.playerRouteStep = -1;
      this.routeLead = null;
      this.awaitingSealCatchUp = false;
      this.attackCycle = 0;
      this.attackDeckIndex = 0;
      this.attackDeck = createAscensionAttackSequence({
        seed: this.seed,
        segmentIndex: this.state.segmentIndex,
        cycle: 0,
      });
      this.game.damageEnemy(this.owner, this.owner.stats.maxHealth * 0.25, {
        source: this.game.player,
        directHit: true,
        armorPierce: 9999,
        ascensionSegmentDamage: true,
        ascensionSealIndex: index,
        suppressGenericOffense: true,
      });
      if (index === 2 && this.owner.bossState.phase === 1) this.owner._beginPhaseTwo?.();
      this._syncOwnerSignatureState();
      this.escapeRemaining = ASCENSION_ENGINE_TUNING.escapeObservationSeconds;
      if (this.state.segmentIndex === 3) this._prepareSummitLaunch();
      this._startSegmentAscent(this.state.segmentIndex);
      this.game.ui?.showToast?.(`Compression Seal ${index + 1} secured — checkpoint saved`, '#ffd36f');
    }).catch(() => {
      if (this.disposed) return;
      this.pendingCheckpointCommit = null;
      this.sealIntegrity[index] = Math.max(1, this.sealIntegrityMax * 0.08);
      this.state.mode = ASCENSION_ENGINE_MODES.PUNISH;
      this.state.activeSealIndex = index;
      this.state.punishRemaining = 4;
      this._syncOwnerSignatureState();
    });
  }

  _commitFinalVictory() {
    if (this.pendingVictoryCommit) return;
    const transition = breakAscensionSeal({ ...this.state, activeSealIndex: 3 }, 3);
    if (!transition.ok || !transition.completed) return;
    this.pendingVictoryCommit = { transition };
    this.state.activeSealIndex = null;
    this.owner.brain.moving = false;
    Promise.resolve(typeof this.game.commitAscensionVictory === 'function'
      ? this.game.commitAscensionVictory(this.owner)
      : { ok: false, reason: 'storage-bridge-missing' }).then((result) => {
      if (this.disposed || this.owner.dead) return;
      if (!result?.ok) {
        this.pendingVictoryCommit = null;
        this.sealIntegrity[3] = Math.max(1, this.sealIntegrityMax * 0.08);
        this.state.mode = ASCENSION_ENGINE_MODES.FINAL_CHARGE;
        this.state.activeSealIndex = 3;
        this.state.finalChargeRemaining = 3;
        this._syncOwnerSignatureState();
        this.game.ui?.showToast?.('Victory recovery could not be saved — final seal remains active', '#ff9f73');
        return;
      }
      this.pendingVictoryCommit = null;
      this.state = transition.state;
      this.sealIntegrity[3] = 0;
      this.owner.bossVictoryCommitted = !result.debug;
      this.owner.pendingBossVictoryResult = result.debug ? null : result;
      this.stage.setCompleted(true);
      this._syncOwnerSignatureState();
      this.game.damageEnemy(this.owner, this.owner.health + this.owner.stats.maxHealth, {
        source: this.game.player,
        directHit: true,
        armorPierce: 9999,
        ascensionSegmentDamage: true,
        ascensionFinalSeal: true,
        bossVictoryAlreadyRecorded: !result.debug,
        suppressGenericOffense: true,
      });
    }).catch(() => {
      if (this.disposed) return;
      this.pendingVictoryCommit = null;
      this.sealIntegrity[3] = Math.max(1, this.sealIntegrityMax * 0.08);
      this.state.mode = ASCENSION_ENGINE_MODES.FINAL_CHARGE;
      this.state.activeSealIndex = 3;
      this.state.finalChargeRemaining = 3;
      this._syncOwnerSignatureState();
    });
  }

  _syncOwnerSignatureState() {
    const index = Math.max(0, Math.min(3, this.state.activeSealIndex ?? this.state.segmentIndex));
    this.owner.signatureIntegrityMax = this.sealIntegrityMax;
    this.owner.signatureIntegrity = this.sealIntegrity[index] ?? 0;
    this.owner.signaturePartOverloaded = false;
  }

  beginPhaseTwo() {
    this.game?.addParticleBurst?.(this.owner.root.position, 0xff7a32, 46, 0.26);
  }

  getVisualState() {
    return {
      compression: this.compression,
      airborne: this.activeAttack?.stage === 'flight' || Boolean(this.bossTransit),
      boosterPower: this.boosterPower,
      landingImpact: this.landingImpact,
      sweep: this.sweep,
      activeSealIndex: this.state.activeSealIndex,
      brokenSeals: this.state.brokenSeals,
      finalCharge: this.state.mode === ASCENSION_ENGINE_MODES.FINAL_CHARGE
        ? clamp01(1 - this.state.finalChargeRemaining / ASCENSION_ENGINE_TUNING.finalChargeSeconds)
        : 0,
    };
  }

  getHudState() {
    const index = Math.max(0, Math.min(3, this.state.activeSealIndex ?? this.state.segmentIndex));
    return {
      segmentCount: 4,
      segmentsCleared: this.state.brokenSeals.filter(Boolean).length,
      segmentIndex: this.state.segmentIndex,
      securedCheckpoint: this.state.securedCheckpoint,
      encounterMode: this.state.mode,
      encounterModeLabel: modeLabel(this.state.mode),
      signatureRatio: Math.max(0, this.sealIntegrity[index] / this.sealIntegrityMax),
      signatureStatus: this.pendingCheckpointCommit
        ? 'SECURING CHECKPOINT…'
        : this.pendingVictoryCommit
          ? 'COMMITTING PERFECTED GREAVE RECOVERY…'
          : this.state.mode === ASCENSION_ENGINE_MODES.FINAL_CHARGE
            ? `FINAL SEAL · ${this.state.finalChargeRemaining.toFixed(1)}s`
            : this.state.activeSealIndex == null
              ? `SEAL ${this.state.segmentIndex + 1} ARMORED`
              : `COMPRESSION SEAL ${this.state.activeSealIndex + 1}/4`,
      finalChargeFailures: this.finalChargeFailures,
    };
  }

  getObjectiveText() {
    if (this.pendingCheckpointCommit) return 'Hold position — securing Compression Seal checkpoint';
    if (this.pendingVictoryCommit) return 'Hold position — securing Perfected Compression Greave recovery';
    if (this.state.mode === ASCENSION_ENGINE_MODES.FINAL_CHARGE) return 'Break Compression Seal Four before launch';
    if (this.state.mode === ASCENSION_ENGINE_MODES.PUNISH) return `Break Compression Seal ${this.state.segmentIndex + 1}`;
    if (this.state.mode === ASCENSION_ENGINE_MODES.SUMMIT) return 'Survive the summit trial and punish each landing';
    if (this.state.mode === ASCENSION_ENGINE_MODES.ESCAPE && this.state.segmentIndex === 3) return 'Ride the summit launch vent';
    if (this.awaitingSealCatchUp) return `Catch the Ascension Engine at Compression Seal ${this.state.segmentIndex + 1}`;
    if (this.stage?.masteryRouteActive) {
      return `Master ${ASCENSION_RELIQUARY_SEGMENTS[this.state.segmentIndex]?.title ?? 'the Reliquary'} via the Jump Springs ledges`;
    }
    const routeCount = this.stage?.getRoutePlatforms?.(this.state.segmentIndex)?.length ?? 0;
    const traversalProgress = Math.min(this.playerRouteStep + 1, routeCount);
    return traversalProgress >= routeCount
      ? `Reach Compression Seal ${this.state.segmentIndex + 1}`
      : `Chase the Ascension Engine · Route ${traversalProgress + 1}/${routeCount}`;
  }

  isMovementLocked() {
    return true;
  }

  getResourceCounts() {
    return {
      projectiles: 0,
      telegraphs: this.telegraphs.length + this.shockwaves.length,
      constructs: 0,
    };
  }

  cancelCurrentAttack(game = this.game, reason = 'cancelled') {
    this.activeAttack = null;
    this.bossTransit = null;
    this.routeLead = null;
    this.awaitingSealCatchUp = false;
    for (const entry of this.telegraphs) disposeObject(entry.object);
    for (const wave of this.shockwaves) disposeObject(wave.object);
    this.telegraphs.length = 0;
    this.shockwaves.length = 0;
    this.ventTimers.clear();
    this.ventLaunchCooldowns.clear();
    game?.projectiles?.cancelWhere?.((projectile) => projectile.source === this.owner, `ascension-${reason}`);
  }

  dispose(game = this.game, reason = 'dispose') {
    if (this.disposed) return;
    this.cancelCurrentAttack(game, reason);
    this.disposed = true;
    if (reason === 'death') this.stage?.setCompleted(true);
    if (game?.combat?.lockOn?.target?.isAscensionCompressionSeal) {
      game.combat._clearLockOn?.();
    }
    if (this.ownsStage && this.stage) {
      const ownedStage = this.stage;
      ownedStage.dispose();
      if (game?.bossStageRuntime === ownedStage) game.bossStageRuntime = null;
      if (game?.dungeon?.specialEnvironment === ownedStage) {
        game.dungeon.specialEnvironment = null;
        game.dungeon.specialEnvironmentId = null;
      }
      this.stage = null;
      this.ownsStage = false;
    }
    this.game = null;
  }
}

export default AscensionEngineEncounter;
