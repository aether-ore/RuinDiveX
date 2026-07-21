import * as THREE from 'three';
import {
  getCyclicHazardPhaseAt,
  integrateHazardExposureV2,
} from './DungeonHazardMathV2.js';

const MAX_RUNTIME_STEP_SECONDS = 1 / 20;
const MAX_RUNTIME_UPDATE_SECONDS = 5;
const POSITION_EPSILON = 0.0001;
const CAMERA_CONTAINMENT_BIN_SIZE = 12;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function copyPlain(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function asVector3(value, label = 'position') {
  if (value?.isVector3) return value.clone();
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new TypeError(`Dungeon V2 ${label} must contain finite x, y, and z values.`);
  }
  return new THREE.Vector3(value.x, value.y, value.z);
}

function boundsContain(bounds, position, margin = 0) {
  return position.x >= bounds.min.x - margin
    && position.x <= bounds.max.x + margin
    && position.y >= bounds.min.y - margin
    && position.y <= bounds.max.y + margin
    && position.z >= bounds.min.z - margin
    && position.z <= bounds.max.z + margin;
}

function runtimeColliderBounds(collider) {
  if (collider?.bounds?.min && collider?.bounds?.max) return collider.bounds;
  const center = collider?.position ?? collider?.center;
  const halfHeight = collider?.verticalHalfHeight
    ?? (Number.isFinite(collider?.height) ? collider.height * 0.5 : null);
  if (!center
    || !Number.isFinite(collider?.halfWidth)
    || !Number.isFinite(collider?.halfDepth)
    || !Number.isFinite(halfHeight)) return null;
  return {
    min: {
      x: center.x - collider.halfWidth,
      y: Number.isFinite(collider.baseY) ? collider.baseY : center.y - halfHeight,
      z: center.z - collider.halfDepth,
    },
    max: {
      x: center.x + collider.halfWidth,
      y: Number.isFinite(collider.topY) ? collider.topY : center.y + halfHeight,
      z: center.z + collider.halfDepth,
    },
  };
}

function spatialBinKey(x, z) {
  return `${x}:${z}`;
}

function addBoundsToSpatialBins(bins, bounds, value, binSize) {
  const minX = Math.floor(bounds.min.x / binSize);
  const maxX = Math.floor(bounds.max.x / binSize);
  const minZ = Math.floor(bounds.min.z / binSize);
  const maxZ = Math.floor(bounds.max.z / binSize);
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const key = spatialBinKey(x, z);
      const bucket = bins.get(key) ?? [];
      bucket.push(value);
      bins.set(key, bucket);
    }
  }
}

function segmentBoundsEntry(start, end, bounds) {
  let minimum = 0;
  let maximum = 1;
  for (const axis of ['x', 'y', 'z']) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) <= POSITION_EPSILON) {
      if (start[axis] < bounds.min[axis] || start[axis] > bounds.max[axis]) return null;
      continue;
    }
    let near = (bounds.min[axis] - start[axis]) / delta;
    let far = (bounds.max[axis] - start[axis]) / delta;
    if (near > far) [near, far] = [far, near];
    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);
    if (minimum > maximum) return null;
  }
  return minimum >= 0 && minimum <= 1 ? minimum : null;
}

function lerpVector(target, from, to, progress) {
  target.set(
    THREE.MathUtils.lerp(from.x, to.x, progress),
    THREE.MathUtils.lerp(from.y, to.y, progress),
    THREE.MathUtils.lerp(from.z, to.z, progress),
  );
}

function normalizeRuntimeDefinition(mechanism) {
  const runtime = mechanism.runtime ?? mechanism.runtimeProfile ?? mechanism.controller ?? mechanism.behavior ?? {};
  return {
    ...runtime,
    type: runtime.type ?? mechanism.type,
    automatic: runtime.automatic ?? mechanism.automaticTravel,
  };
}

function positionFromState(state, fallback = null, surfaceHeight = 0) {
  const value = state?.position ?? state?.platformPosition ?? state?.transform?.position;
  if (value) {
    const position = asVector3(value, `mechanism state ${state.id} position`);
    // Authored mechanism poses describe the walkable surface's base elevation,
    // just like walkableSurface.bounds.min.y. Runtime objects and colliders are
    // centered volumes, so every explicit pose needs the same half-height
    // conversion (not only lift poses that also expose `surfaceY`).
    position.y = (Number.isFinite(state?.surfaceY) ? state.surfaceY : position.y)
      + surfaceHeight * 0.5;
    return position;
  }
  if (fallback && (Number.isFinite(state?.surfaceY) || Number.isFinite(state?.elevation))) {
    const result = fallback.clone();
    result.y = (Number.isFinite(state.surfaceY) ? state.surfaceY : state.elevation) + surfaceHeight * 0.5;
    return result;
  }
  return fallback?.clone?.() ?? null;
}

function setDynamicSurfacePosition(surface, position) {
  if (!surface || !position) return;
  const halfHeight = (surface.height ?? 0) * 0.5;
  surface.center?.copy?.(position);
  if (surface.position !== surface.center) surface.position?.copy?.(position);
  surface.baseY = position.y - halfHeight;
  surface.topY = position.y + halfHeight;

  // Structural-registry raycasts and parity checks consume the explicit
  // bounds object while gameplay support consumes center/baseY/topY. Keep
  // both projections synchronized so a moving platform never leaves an
  // invisible collider at its previous landing.
  if (surface.bounds?.min && surface.bounds?.max) {
    surface.bounds.min.x = position.x - (surface.halfWidth ?? 0);
    surface.bounds.max.x = position.x + (surface.halfWidth ?? 0);
    surface.bounds.min.y = surface.baseY;
    surface.bounds.max.y = surface.topY;
    surface.bounds.min.z = position.z - (surface.halfDepth ?? 0);
    surface.bounds.max.z = position.z + (surface.halfDepth ?? 0);
  }
}

function getWaterDefinition(plan) {
  const canonical = (plan.environmentStates ?? []).find((entry) => entry.type === 'conserved-water-unit');
  if (canonical) {
    return {
      id: canonical.id,
      variableId: canonical.variableId,
      initialConfigurationId: canonical.initialStateId,
      conservedVolume: canonical.capacityUnits,
      basins: canonical.basins ?? [],
      movementProfile: canonical.movementProfile,
      transferCommit: canonical.transferCommit,
      transferSeconds: canonical.transferSeconds ?? canonical.animationSeconds,
      configurations: (canonical.stableStates ?? []).map((state) => ({
        id: state.id,
        totalUnits: state.totalUnits,
        levels: state.basinLevels,
      })),
    };
  }
  return plan.environment?.water ?? plan.environmentModel?.water ?? plan.water ?? null;
}

function getHazardDefinitions(plan) {
  const canonical = (plan.environmentStates ?? []).filter((entry) => (
    entry.type === 'magma-floor-v1' || entry.type === 'electric-floor-cycle-v1'
  ));
  return canonical.length
    ? canonical.map((hazard) => ({
      ...hazard,
      kind: hazard.type.startsWith('electric') ? 'electrical' : 'magma',
      graceSeconds: hazard.graceSeconds ?? hazard.entryGraceSeconds ?? hazard.timing?.graceSeconds ?? hazard.timing?.grace,
      activeSeconds: hazard.activeSeconds ?? hazard.timing?.activeSeconds ?? hazard.timing?.active,
      recoverySeconds: hazard.recoverySeconds ?? hazard.timing?.recoverySeconds ?? hazard.timing?.recovery,
      damagePerPulse: hazard.damagePerPulse ?? hazard.damage?.perPulse,
      damagePerSecond: hazard.damagePerSecond ?? hazard.damage?.perSecond,
      pulseInterval: hazard.pulseInterval ?? hazard.pulseSeconds ?? hazard.timing?.pulseInterval,
    }))
    : plan.environment?.hazards ?? plan.environmentModel?.hazards ?? [];
}

function hazardSurfaceRuntimeId(hazard, surfaceContract) {
  return surfaceContract.id ?? `${hazard.id}:${surfaceContract.surfaceId}`;
}

function normalizeSemanticContractToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function rotateSemanticDirection(direction, yawQuarterTurns) {
  const directions = ['NORTH', 'WEST', 'SOUTH', 'EAST'];
  const index = directions.indexOf(String(direction ?? '').toUpperCase());
  if (index < 0) return direction;
  const turns = ((Number(yawQuarterTurns) % 4) + 4) % 4;
  return directions[(index + turns) % directions.length];
}

function forEachSemanticMaterial(object, callback) {
  const visited = new Set();
  const visit = (candidate) => {
    const materials = Array.isArray(candidate?.material)
      ? candidate.material
      : candidate?.material
        ? [candidate.material]
        : [];
    for (const material of materials) {
      if (!material || visited.has(material)) continue;
      visited.add(material);
      callback(material);
    }
  };
  if (typeof object?.traverse === 'function') object.traverse(visit);
  else visit(object);
}

class RuntimeMechanismControllerV2 {
  constructor(mechanism, resources, eventSink) {
    this.definition = mechanism;
    this.id = mechanism.id;
    this.type = mechanism.type;
    this.resources = resources;
    this.eventSink = eventSink;
    this.states = new Map((mechanism.states ?? []).map((state) => [state.id, state]));
    this.transitions = mechanism.transitions ?? [];
    this.stateId = mechanism.initialStateId;
    this.elapsed = 0;
    this.mounted = false;

    if (!this.id || !this.type || !this.stateId || !this.states.has(this.stateId)) {
      throw new Error(`Dungeon V2 mechanism ${this.id ?? '<missing-id>'} has an invalid stable-state table.`);
    }
  }

  mount() {
    this.mounted = true;
    this.applyStableState(this.states.get(this.stateId), { immediate: true });
  }

  update(dt) {
    this.elapsed += dt;
  }

  _conditionPasses(condition) {
    if (!condition || condition.op === 'always') return true;
    if (condition.op === 'all') return (condition.conditions ?? []).every((entry) => this._conditionPasses(entry));
    if (condition.op === 'any') return (condition.conditions ?? []).some((entry) => this._conditionPasses(entry));
    if (condition.op === 'gateOpen') {
      return this.game?.dungeon?.doors?.find(({ id }) => id === condition.gateId)?.closed === false;
    }
    if (condition.op === 'hasKey') {
      return this.game?.dungeonController?.progressionManager?.hasKeycard?.(condition.keyId) === true;
    }
    if (condition.op === 'stateEquals') {
      const variableId = String(condition.variableId ?? '');
      if (variableId === `${this.id}.state`) return this.stateId === condition.value;
      const controllerId = variableId.endsWith('.state')
        ? variableId.slice(0, -'.state'.length)
        : condition.controllerId;
      const controller = this.game?.dungeon?.environmentRuntime?.controllerById?.get?.(controllerId);
      if (controller) return controller.stateId === condition.value;
      return this.game?.dungeon?.environmentRuntime?.variables?.get?.(variableId) === condition.value;
    }
    return false;
  }

  _transitionConditionsPass(transition) {
    return (transition?.conditions ?? []).every((condition) => this._conditionPasses(condition));
  }

  prePlayerUpdate(dt, game = this.game) {
    if (!this.mounted && game) this.mount(game);
    this.update(dt);
  }

  transition(actionId) {
    const transition = this.transitions.find((candidate) => (
      candidate.actionId === actionId
      && (candidate.fromStateId === this.stateId || candidate.fromStateId === '*')
    ));
    if (!transition || !this.states.has(transition.toStateId) || !this._transitionConditionsPass(transition)) return false;

    const previousStateId = this.stateId;
    this.stateId = transition.toStateId;
    this.elapsed = 0;
    this.applyStableState(this.states.get(this.stateId), { immediate: false });
    this.eventSink({
      type: 'mechanism-state-changed',
      mechanismId: this.id,
      actionId,
      fromStateId: previousStateId,
      toStateId: this.stateId,
    });
    return true;
  }

  applyStableState(state) {
    const object = this.resources.mechanismObjects.get(this.id);
    const surface = this.resources.dynamicSurfaceByController.get(this.id);
    const position = positionFromState(state, object?.position, surface?.height ?? 0);
    const collisionEnabled = state?.collision !== false;
    if (object) object.visible = collisionEnabled;
    if (surface) {
      surface.enabled = collisionEnabled;
      surface.active = collisionEnabled;
    }
    if (position && object) object.position.copy(position);
    if (position && surface) setDynamicSurfacePosition(surface, position);
  }

  dispose() {
    this.mounted = false;
  }

  snapshot() {
    return { id: this.id, type: this.type, stateId: this.stateId };
  }
}

class AutomaticTransitControllerV2 extends RuntimeMechanismControllerV2 {
  constructor(mechanism, resources, eventSink) {
    super(mechanism, resources, eventSink);
    const runtime = normalizeRuntimeDefinition(mechanism);
    this.speed = Math.max(0.1, Number(runtime.speed) || 2.4);
    this.dwellSeconds = Math.max(0, Number(runtime.dwellSeconds) || 1.4);
    this.automatic = runtime.automatic !== false;
    this.route = (runtime.routeStateIds ?? mechanism.states.map(({ id }) => id))
      .filter((id) => this.states.has(id));
    this.routeIndex = Math.max(0, this.route.indexOf(this.stateId));
    this.dwellRemaining = this.dwellSeconds;
    this.fromPosition = null;
    this.targetPosition = null;
    this.targetStateId = null;
    this.travelDistance = 0;
    this.travelProgress = 0;
    this.game = null;
  }

  mount(game) {
    super.mount(game);
    this.game = game;
  }

  update(dt) {
    super.update(dt);
    if (this.targetStateId) {
      this.travelProgress = Math.min(
        this.travelDistance,
        this.travelProgress + this.speed * dt,
      );
      const ratio = this.travelDistance <= POSITION_EPSILON
        ? 1
        : clamp01(this.travelProgress / this.travelDistance);
      this._setPosition(ratio);
      if (ratio >= 1) this._commitArrival();
      return;
    }

    if (!this.automatic || this.route.length < 2) return;
    this.dwellRemaining -= dt;
    if (this.dwellRemaining <= 0) {
      const nextIndex = (this.routeIndex + 1) % this.route.length;
      const targetStateId = this.route[nextIndex];
      const transition = this.transitions.find((candidate) => (
        candidate.automatic === true
        && candidate.trigger === 'automatic-dwell'
        && (candidate.fromStateId === this.stateId || candidate.fromStateId === '*')
        && candidate.toStateId === targetStateId
      ));
      if (!transition || !this._transitionConditionsPass(transition)) {
        // A closed lift hatch is a stable interlock, not a collision the
        // player must discover by being crushed or recovered. Recheck at a
        // small deterministic cadence so opening the gate resumes automatic
        // service promptly without hammering the condition every frame.
        this.dwellRemaining = 0.2;
        return;
      }
      this._beginTravel(targetStateId, 'automatic-dwell', transition);
    }
  }

  transition(actionId) {
    const transition = this.transitions.find((candidate) => (
      candidate.actionId === actionId
      && (candidate.fromStateId === this.stateId || candidate.fromStateId === '*')
    ));
    if (!transition || !this._transitionConditionsPass(transition)) return false;
    return this._beginTravel(transition.toStateId, actionId, transition);
  }

  applyStableState(state, options = {}) {
    super.applyStableState(state, options);
    if (options.immediate === true) {
      this.targetStateId = null;
      this.fromPosition = null;
      this.targetPosition = null;
      this.travelDistance = 0;
      this.travelProgress = 0;
      this.routeIndex = Math.max(0, this.route?.indexOf(state.id) ?? 0);
      this.dwellRemaining = this.dwellSeconds;
    }
  }

  _beginTravel(targetStateId, actionId, transition = null) {
    if (!this.states.has(targetStateId) || (transition && !this._transitionConditionsPass(transition))) return false;
    const currentObject = this.resources.mechanismObjects.get(this.id);
    const currentSurface = this.resources.dynamicSurfaceByController.get(this.id);
    const currentStatePosition = positionFromState(
      this.states.get(this.stateId),
      currentObject?.position,
      currentSurface?.height ?? 0,
    );
    this.fromPosition = currentObject?.position.clone() ?? currentStatePosition;
    this.targetPosition = positionFromState(
      this.states.get(targetStateId),
      this.fromPosition,
      currentSurface?.height ?? 0,
    );
    if (!this.fromPosition || !this.targetPosition) {
      throw new Error(`Dungeon V2 transit mechanism ${this.id} requires a position in every route state.`);
    }
    this.targetStateId = targetStateId;
    this.travelDistance = this.fromPosition.distanceTo(this.targetPosition);
    this.travelProgress = 0;
    this.eventSink({
      type: 'mechanism-transit-started',
      mechanismId: this.id,
      actionId,
      fromStateId: this.stateId,
      toStateId: targetStateId,
    });
    if (this.travelDistance <= POSITION_EPSILON) this._commitArrival();
    return true;
  }

  _setPosition(progress) {
    const object = this.resources.mechanismObjects.get(this.id);
    const surface = this.resources.dynamicSurfaceByController.get(this.id);
    const position = new THREE.Vector3();
    lerpVector(position, this.fromPosition, this.targetPosition, progress);
    const previousCenter = surface?.center?.clone?.() ?? object?.position?.clone?.() ?? position.clone();
    const previousTopY = surface?.topY;
    const playerPosition = this.game?.player?.root?.position;
    const carriesPlayer = Boolean(
      surface
      && playerPosition
      && Math.abs(playerPosition.x - previousCenter.x) <= surface.halfWidth + 0.08
      && Math.abs(playerPosition.z - previousCenter.z) <= surface.halfDepth + 0.08
      && playerPosition.y >= previousTopY - 0.16
      && playerPosition.y <= previousTopY + 0.32
    );
    if (object) object.position.copy(position);
    if (surface) setDynamicSurfacePosition(surface, position);
    if (carriesPlayer) {
      playerPosition.add(position.clone().sub(previousCenter));
    }
  }

  _commitArrival() {
    const previousStateId = this.stateId;
    this.stateId = this.targetStateId;
    this.routeIndex = Math.max(0, this.route.indexOf(this.stateId));
    this._setPosition(1);
    this.targetStateId = null;
    this.fromPosition = null;
    this.targetPosition = null;
    this.travelProgress = 0;
    this.dwellRemaining = this.dwellSeconds;
    this.eventSink({
      type: 'mechanism-transit-arrived',
      mechanismId: this.id,
      fromStateId: previousStateId,
      toStateId: this.stateId,
    });
  }
}

class CrumbleControllerV2 extends RuntimeMechanismControllerV2 {
  constructor(mechanism, resources, eventSink) {
    super(mechanism, resources, eventSink);
    const runtime = normalizeRuntimeDefinition(mechanism);
    const durationFor = (fromStateId, toStateId, fallback) => {
      const seconds = mechanism.transitions?.find((transition) => (
        transition.fromStateId === fromStateId && transition.toStateId === toStateId
      ))?.afterSeconds;
      return Math.max(0.05, Number(seconds ?? fallback) || fallback);
    };
    this.surfaceId = runtime.surfaceId;
    this.crackSeconds = durationFor('Cracking', 'Collapsed', runtime.crackSeconds ?? 0.7);
    this.fallenSeconds = durationFor('Collapsed', 'Resetting', runtime.fallenSeconds ?? 3.2);
    this.resetSeconds = durationFor('Resetting', 'Intact', runtime.resetSeconds ?? 0.65);
    this.fallOffset = Number(runtime.fallOffset) || -6;
    this.phase = 'stable';
    this.phaseElapsed = 0;
    this.game = null;
    this.restPosition = resources.mechanismObjects.get(this.id)?.position.clone() ?? null;
  }

  _setSupportFixturesActive(active) {
    for (const fixture of this.resources.mechanismFixtures.get(this.id) ?? []) {
      fixture.object.visible = active;
      for (const collider of fixture.colliders) {
        collider.active = active;
        collider.enabled = active;
      }
    }
  }

  mount(game) {
    super.mount(game);
    this.game = game;
    const object = this.resources.mechanismObjects.get(this.id);
    this.restPosition ??= object?.position.clone() ?? null;
    const overlay = this.resources.crumbleOverlays.get(this.id);
    if (overlay) overlay.visible = false;
    this._setSupportFixturesActive(true);
  }

  applyStableState(state, options = {}) {
    const surface = this.resources.dynamicSurfaceByController.get(this.id)
      ?? this.resources.platformSurfaces.get(this.surfaceId);
    const object = this.resources.mechanismObjects.get(this.id);
    const overlay = this.resources.crumbleOverlays.get(this.id);
    this.restPosition ??= object?.position.clone() ?? null;
    const collisionEnabled = state?.collision !== false;

    if (collisionEnabled) {
      if (object && this.restPosition) {
        object.position.copy(this.restPosition);
        object.rotation.z = 0;
        object.visible = true;
      }
      if (surface && this.restPosition) {
        setDynamicSurfacePosition(surface, this.restPosition);
      }
      if (surface) {
        surface.enabled = true;
        surface.active = true;
      }
      this._setSupportFixturesActive(true);
      this.phase = state?.id === 'Cracking' ? 'cracking' : 'stable';
    } else {
      if (object && this.restPosition) {
        object.position.copy(this.restPosition);
        object.position.y += this.fallOffset;
        object.rotation.z = 0;
        object.visible = false;
      }
      if (surface) {
        surface.enabled = false;
        surface.active = false;
      }
      this._setSupportFixturesActive(false);
      this.phase = state?.id === 'Resetting' ? 'resetting' : 'fallen';
    }
    if (overlay) overlay.visible = state?.id === 'Cracking';
    if (options.immediate === true) this.phaseElapsed = 0;
  }

  update(dt) {
    super.update(dt);
    const surface = this.resources.dynamicSurfaceByController.get(this.id)
      ?? this.resources.platformSurfaces.get(this.surfaceId);
    const object = this.resources.mechanismObjects.get(this.id);
    const overlay = this.resources.crumbleOverlays.get(this.id);
    if (!surface || !object || !this.game?.player?.root) return;

    const playerPosition = this.game.player.root.position;
    const playerOnSurface = surface.enabled !== false
      && Math.abs(playerPosition.x - surface.center.x) <= surface.halfWidth
      && Math.abs(playerPosition.z - surface.center.z) <= surface.halfDepth
      && playerPosition.y >= surface.topY - 0.2
      && playerPosition.y <= surface.topY + 0.35;

    if (this.phase === 'stable' && playerOnSurface) {
      this.phase = 'cracking';
      this.stateId = 'Cracking';
      this.phaseElapsed = 0;
      if (overlay) overlay.visible = true;
      this.eventSink({ type: 'crumble-cracking', mechanismId: this.id });
    } else if (this.phase === 'cracking') {
      this.phaseElapsed += dt;
      const crackProgress = clamp01(this.phaseElapsed / this.crackSeconds);
      if (overlay) {
        overlay.visible = true;
        for (const seam of overlay.children) {
          if (!seam.material) continue;
          seam.material.opacity = THREE.MathUtils.lerp(0.28, 1, crackProgress);
          seam.material.emissiveIntensity = THREE.MathUtils.lerp(0.35, 1.8, crackProgress);
        }
      }
      object.rotation.z = Math.sin(this.phaseElapsed * 42) * 0.012;
      if (this.phaseElapsed >= this.crackSeconds) {
        this.phase = 'fallen';
        this.stateId = 'Collapsed';
        this.phaseElapsed = 0;
        surface.enabled = false;
        surface.active = false;
        object.position.y = this.restPosition.y + this.fallOffset;
        object.rotation.z = 0;
        object.visible = false;
        this._setSupportFixturesActive(false);
        if (overlay) overlay.visible = false;
        this.eventSink({ type: 'crumble-collapsed', mechanismId: this.id });
      }
    } else if (this.phase === 'fallen') {
      this.phaseElapsed += dt;
      if (this.phaseElapsed >= this.fallenSeconds) {
        this.phase = 'resetting';
        this.stateId = 'Resetting';
        this.phaseElapsed = 0;
        object.visible = true;
        if (overlay) overlay.visible = false;
      }
    } else if (this.phase === 'resetting') {
      this.phaseElapsed += dt;
      const progress = clamp01(this.phaseElapsed / this.resetSeconds);
      object.position.y = THREE.MathUtils.lerp(
        this.restPosition.y + this.fallOffset,
        this.restPosition.y,
        progress,
      );
      if (progress >= 1) {
        this.phase = 'stable';
        this.stateId = 'Intact';
        this.phaseElapsed = 0;
        surface.enabled = true;
        surface.active = true;
        object.position.copy(this.restPosition);
        this._setSupportFixturesActive(true);
        if (overlay) overlay.visible = false;
        this.eventSink({ type: 'crumble-reset', mechanismId: this.id });
      }
    }
  }

  snapshot() {
    return {
      ...super.snapshot(),
      phase: this.phase,
      supportFixturesActive: (this.resources.mechanismFixtures.get(this.id) ?? [])
        .every((fixture) => fixture.object.visible !== false
          && fixture.colliders.every((collider) => collider.active !== false)),
    };
  }
}

class CorkscrewControllerV2 extends RuntimeMechanismControllerV2 {
  constructor(mechanism, resources, eventSink) {
    super(mechanism, resources, eventSink);
    const runtime = normalizeRuntimeDefinition(mechanism);
    this.angularSpeed = Number(runtime.angularSpeed) || 0.35;
    this.verticalAmplitude = Math.max(0, Number(runtime.verticalAmplitude) || 2.6);
    this.verticalCycles = Number(runtime.verticalCycles) || 1;
    this.phase = Number(runtime.phase) || 0;
    this.surfaceIds = runtime.surfaceIds ?? [];
    this.automaticRotation = runtime.automaticRotation === true;
    this.baseTransforms = [];
  }

  mount(game) {
    super.mount(game);
    this.game = game;
    this.baseTransforms = this.surfaceIds.map((surfaceId) => {
      const surface = this.resources.platformSurfaces.get(surfaceId);
      const object = this.resources.surfaceObjects.get(surfaceId);
      return surface && object
        ? { surfaceId, surface, object, center: surface.center.clone(), position: object.position.clone() }
        : null;
    }).filter(Boolean);
  }

  update(dt) {
    super.update(dt);
    if (!this.automaticRotation) return;
    this.phase = (this.phase + dt * this.angularSpeed) % (Math.PI * 2);
    for (let index = 0; index < this.baseTransforms.length; index += 1) {
      const entry = this.baseTransforms[index];
      const offset = index / Math.max(1, this.baseTransforms.length) * Math.PI * 2;
      const y = Math.sin((this.phase + offset) * this.verticalCycles) * this.verticalAmplitude;
      entry.object.position.y = entry.position.y + y;
      entry.surface.center.y = entry.center.y + y;
      entry.surface.topY = entry.center.y + y + (entry.surface.height ?? 0) * 0.5;
    }
  }
}

function createMechanismController(mechanism, resources, eventSink) {
  const runtimeType = normalizeRuntimeDefinition(mechanism).type;
  if (['cargo-lift', 'automatic-cargo', 'moving-cargo', 'moving-platform', 'lift'].includes(runtimeType)) {
    return new AutomaticTransitControllerV2(mechanism, resources, eventSink);
  }
  if (['crumble', 'crumbling-floor'].includes(runtimeType)) {
    return new CrumbleControllerV2(mechanism, resources, eventSink);
  }
  if (['corkscrew', 'corkscrew-gear'].includes(runtimeType)) {
    if (mechanism.automaticTravel === true) {
      return new AutomaticTransitControllerV2(mechanism, resources, eventSink);
    }
    return new CorkscrewControllerV2(mechanism, resources, eventSink);
  }
  return new RuntimeMechanismControllerV2(mechanism, resources, eventSink);
}

export class DungeonRuntimeV2 {
  constructor({ plan, facade, resources, allowInvalidPreview = false }) {
    this.id = 'dungeon-v2-runtime';
    this.plan = plan;
    this.facade = facade;
    this.resources = resources;
    this.game = null;
    this.elapsed = 0;
    this.frameHeartbeat = 0;
    this.disposed = false;
    this.mounted = false;
    this.eventLog = [];
    this.errors = [];
    this.operatedActionIds = new Set();
    this.actionOperationCounts = new Map();
    this.visitedRegionIds = new Set();
    this.currentRegionId = null;
    this.traversedPortalIds = new Set();
    this.extracted = false;
    this.safeguardActivations = 0;
    this.lastSafeAnchor = null;
    this.actionById = new Map((plan.actions ?? []).map((action) => [action.id, action]));
    this.variables = new Map((plan.environmentStates ?? []).map((variable) => [
      variable.variableId ?? variable.id,
      variable.initialStateId ?? variable.initialValue ?? variable.value,
    ]));
    this.anchorById = new Map([
      ...(plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
      ...(plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
    ]);
    this.surfaceById = new Map((plan.walkableSurfaces ?? []).map((surface) => [surface.id, surface]));
    this.authoredFalls = (plan.falls ?? []).map((fall) => {
      try {
      const sourcePortal = (plan.portals ?? []).find((portal) => portal.id === fall.sourcePortalId);
      const sourceSurfaceId = sourcePortal?.physicalRoute?.endpointSurfaceIds?.from ?? null;
      const sourceSurface = this.surfaceById.get(sourceSurfaceId);
      const catchmentSurface = this.surfaceById.get(fall.catchmentSurfaceId);
      if (!fall.trajectoryBounds || !sourcePortal || !sourceSurface || !catchmentSurface) {
        throw new Error(`Dungeon V2 fall ${fall.id} requires a source portal/surface, trajectoryBounds, and a resolvable catchmentSurfaceId.`);
      }
      if (fall.damageFree !== true || fall.playableDestination !== true) {
        throw new Error(`Dungeon V2 fall ${fall.id} must terminate damage-free in a playable destination.`);
      }
      const landingCenter = {
        x: (catchmentSurface.bounds.min.x + catchmentSurface.bounds.max.x) * 0.5,
        y: catchmentSurface.bounds.max.y,
        z: (catchmentSurface.bounds.min.z + catchmentSurface.bounds.max.z) * 0.5,
      };
      if (!boundsContain(fall.trajectoryBounds, landingCenter, 0.05)) {
        throw new Error(`Dungeon V2 fall ${fall.id} trajectory does not reach the authored catchment surface.`);
      }
      const returnLink = (plan.traversalLinks ?? []).find((link) => (
        link.mode !== 'intentional-drop'
        && (link.fromSurfaceId === fall.catchmentSurfaceId
          || (link.bidirectional !== false && link.toSurfaceId === fall.catchmentSurfaceId))
      ));
      if (!returnLink || returnLink.damageFree !== true) {
        throw new Error(`Dungeon V2 fall ${fall.id} requires an explicit damage-free traversal return link.`);
      }
      const returnSurfaceId = returnLink.fromSurfaceId === fall.catchmentSurfaceId
        ? returnLink.toSurfaceId
        : returnLink.fromSurfaceId;
      const returnSurface = this.surfaceById.get(returnSurfaceId);
      const viaSurface = returnLink.viaSurfaceId
        ? this.surfaceById.get(returnLink.viaSurfaceId)
        : null;
      if (!returnSurface || (returnLink.viaSurfaceId && !viaSurface)) {
        throw new Error(`Dungeon V2 fall ${fall.id} has an unresolved physical return surface.`);
      }
      const catchmentCenter = new THREE.Vector3(landingCenter.x, landingCenter.y, landingCenter.z);
      let routePoints = copyPlain(
        viaSurface?.geometry?.path
        ?? viaSurface?.stairs?.path
        ?? returnLink.waypoints
        ?? returnLink.routePoints
        ?? [],
      );
      if (routePoints.length > 1) {
        const first = asVector3(routePoints[0]);
        const last = asVector3(routePoints.at(-1));
        if (last.distanceToSquared(catchmentCenter) < first.distanceToSquared(catchmentCenter)) {
          routePoints = routePoints.reverse();
        }
      }
      const returnCenter = {
        x: (returnSurface.bounds.min.x + returnSurface.bounds.max.x) * 0.5,
        y: returnSurface.bounds.max.y,
        z: (returnSurface.bounds.min.z + returnSurface.bounds.max.z) * 0.5,
      };
      const returnWaypoints = [landingCenter, ...routePoints, returnCenter]
        .filter((point, index, points) => index === 0 || Math.hypot(
          point.x - points[index - 1].x,
          point.y - points[index - 1].y,
          point.z - points[index - 1].z,
        ) > 0.05);
      return {
        fall,
        sourcePortal,
        sourceSurface,
        catchmentSurface,
        returnLink,
        returnSurface,
        returnWaypoints,
      };
      } catch (error) {
        if (!allowInvalidPreview) throw error;
        this.errors.push({
          code: 'invalid-preview-fall-contract-skipped',
          fallId: fall.id,
          message: error?.message ?? String(error),
        });
        return null;
      }
    }).filter(Boolean);
    this._unauthorizedFallErrorKeys = new Set();
    const gateByPortalId = new Map((plan.progression?.gateContracts ?? [])
      .map((gate) => [gate.portalId, gate]));
    this.navigationSnapshot = copyPlain({
      actionAnchors: (plan.actions ?? []).map((action) => {
        const anchor = this.anchorById.get(action.anchorId);
        return {
          actionId: action.id,
          type: action.type,
          anchorId: action.anchorId ?? null,
          regionId: anchor?.regionId ?? null,
          position: anchor?.position ?? null,
          forward: anchor?.forward ?? null,
          activationSide: action.interaction?.activationSide ?? null,
          radius: action.interaction?.radius ?? null,
        };
      }),
      encounters: (plan.encounters ?? []).map((encounter) => {
        const anchor = this.anchorById.get(encounter.anchorId);
        return {
          encounterId: encounter.id,
          anchorId: encounter.anchorId ?? null,
          regionId: encounter.regionId ?? anchor?.regionId ?? null,
          position: anchor?.position ?? null,
          required: encounter.required === true,
          optional: encounter.optional === true,
          entryEngagementContracts: encounter.entryEngagementContracts ?? [],
        };
      }),
      portals: (plan.portals ?? []).map((portal) => {
        const gate = gateByPortalId.get(portal.id);
        const fromSurfaceId = portal.physicalRoute?.endpointSurfaceIds?.from ?? null;
        const toSurfaceId = portal.physicalRoute?.endpointSurfaceIds?.to ?? null;
        const summarizeEndpoint = (endpoint, endpointSurfaceId) => {
          const endpointSurface = this.surfaceById.get(endpointSurfaceId);
          return {
            regionId: endpoint.regionId,
            surfaceId: endpointSurfaceId,
            center: endpoint.center,
            dimensions: endpoint.dimensions,
            groundY: endpointSurface?.bounds?.max?.y ?? null,
            // Public-input journeys may observe this immutable plan geometry
            // to prove that a capsule finished on the authored destination
            // landing. Merely observing a region-id flip at the boundary is
            // not evidence that the player cleared the frame or found floor.
            surfaceBounds: endpointSurface?.bounds ?? null,
          };
        };
        return {
          id: portal.id,
          direction: portal.direction ?? 'bidirectional',
          connectorForm: portal.connectorForm,
          traversalMode: portal.traversal?.mode ?? portal.approachType ?? null,
          from: summarizeEndpoint(portal.from, fromSurfaceId),
          to: summarizeEndpoint(portal.to, toSurfaceId),
          routePoints: portal.physicalRoute?.routePoints ?? [],
          interiorIngressDepth: portal.traversal?.interiorIngressDepth ?? null,
          barrierId: gate?.barrierBoundaryId ?? gate?.barrierId ?? portal.barrierId ?? null,
        };
      }),
      traversalLinks: (plan.traversalLinks ?? []).map((link) => {
        const fromSurface = this.surfaceById.get(link.fromSurfaceId);
        const toSurface = this.surfaceById.get(link.toSurfaceId);
        const viaSurface = this.surfaceById.get(link.viaSurfaceId);
        const summarizeSurface = (surface) => surface ? {
          id: surface.id,
          regionId: surface.regionId ?? null,
          bounds: surface.bounds ?? null,
          topY: surface.bounds?.max?.y ?? null,
          purpose: surface.purpose ?? null,
        } : null;
        return {
          id: link.id,
          regionId: link.regionId ?? null,
          fromSurfaceId: link.fromSurfaceId,
          toSurfaceId: link.toSurfaceId,
          viaSurfaceId: link.viaSurfaceId ?? null,
          fromSurface: summarizeSurface(fromSurface),
          toSurface: summarizeSurface(toSurface),
          viaSurface: summarizeSurface(viaSurface),
          mode: link.mode,
          bidirectional: link.bidirectional !== false,
          mechanismId: link.mechanismId ?? null,
          minimumWidth: link.minimumWidth ?? null,
          maximumRiser: link.maximumRiser ?? null,
          minimumTread: link.minimumTread ?? null,
          destinationHorizontalTolerance: link.destinationHorizontalTolerance ?? null,
          destinationVerticalTolerance: link.destinationVerticalTolerance ?? null,
          conditions: link.conditions ?? [],
          approachWaypoints: link.approachWaypoints ?? [],
          approachSurfaceIds: link.approachSurfaceIds ?? [],
          approachSurfaces: [...new Set(link.approachSurfaceIds ?? [])]
            .map((surfaceId) => summarizeSurface(this.surfaceById.get(surfaceId)))
            .filter(Boolean),
          doorwayEgressSurfaces: [...new Set([
            link.approachContract?.doorwayEgress?.connectorSurfaceId,
            ...(link.approachContract?.doorwayEgress?.destinationSurfaceIds ?? []),
          ].filter(Boolean))]
            .map((surfaceId) => summarizeSurface(this.surfaceById.get(surfaceId)))
            .filter(Boolean),
          approachSegments: link.approachSegments ?? [],
          approachContract: link.approachContract ?? null,
          reverseEgressWaypoints: link.reverseEgressWaypoints ?? [],
          waypoints: link.waypoints
            ?? link.routePoints
            ?? link.geometry?.waypoints
            ?? link.geometry?.path
            ?? viaSurface?.geometry?.waypoints
            ?? viaSurface?.geometry?.path
            ?? [],
        };
      }),
    });
    this.controllers = (plan.mechanisms ?? []).map((mechanism) => (
      createMechanismController(mechanism, resources, (event) => this._recordEvent(event))
    ));
    this.controllerById = new Map(this.controllers.map((controller) => [controller.id, controller]));
    this.water = this._createWaterState();
    this.hazards = this._createHazardStates();
    this.hazardExposureLedger = new Map();
    this.minimumWalkableY = Math.min(
      ...(plan.walkableSurfaces ?? []).map((surface) => surface.bounds.min.y),
    );
    this.safeguardY = this.minimumWalkableY - 8;
    this.cameraRayAudits = [];
    this.journeyCameraPositions = [];
    this._cameraRayFailureKeys = new Set();
    this._lastCameraAuditPosition = null;
    this._lastCameraAuditRegionId = null;
    this._structuralRaycaster = new THREE.Raycaster();
    this._structuralRaycastTargets = [];
    this.structuralRayAuditEnabled = false;
    this.structuralRayAuditStats = {
      enabled: false,
      targetCount: 0,
      raycastCount: 0,
      cameraPositionSampleCount: 0,
    };
    this._renderPerformanceCache = null;
    this._renderPerformanceCacheHeartbeat = -1;
    this._cameraContainmentColliders = [...(facade.structuralRegistry?.colliders?.values?.() ?? [])]
      .filter((collider) => String(collider?.structuralRole ?? '').startsWith('boundary:'));
    this._cameraContainmentBinSize = CAMERA_CONTAINMENT_BIN_SIZE;
    this._cameraContainmentBins = new Map();
    for (const collider of this._cameraContainmentColliders) {
      const bounds = runtimeColliderBounds(collider);
      if (bounds) addBoundsToSpatialBins(
        this._cameraContainmentBins,
        bounds,
        collider,
        this._cameraContainmentBinSize,
      );
    }
    this.cameraContainmentQueryStats = {
      binSize: this._cameraContainmentBinSize,
      totalColliderCount: this._cameraContainmentColliders.length,
      binCount: this._cameraContainmentBins.size,
      queryCount: 0,
      candidateTests: 0,
      bruteForceEquivalentTests: 0,
      lastCandidateCount: 0,
      maximumCandidateCount: 0,
    };
    this.cameraContainmentAdjustments = 0;
    this.lastCameraContainment = null;
    this._semanticRoomPackDiagnosticKeys = new Set();
    this._syncSemanticRoomPackBindings();
    this._diagnosticsBridge = null;
  }

  mount(game) {
    if (this.disposed) throw new Error('Cannot mount a disposed DungeonRuntimeV2.');
    if (this.mounted) return this;
    this.game = game;
    this.mounted = true;

    for (const surface of this.resources.dynamicSurfaces.values()) {
      game?.registerDynamicPlatformingSurface?.(surface);
    }
    for (const controller of this.controllers) controller.mount(game);
    this._syncSemanticRoomPackBindings();
    this.facade.group?.updateMatrixWorld?.(true);
    this.structuralRayAuditEnabled = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('v2StructuralAudit') === '1';
    this.structuralRayAuditStats.enabled = this.structuralRayAuditEnabled;
    if (this.structuralRayAuditEnabled) {
      this._structuralRaycastTargets = this.facade.structuralRegistry
        ?.getStructuralRaycastVisuals?.() ?? [];
      this.structuralRayAuditStats.targetCount = this._structuralRaycastTargets.length;
      this._recordAnchorStructuralRayAudits();
    }
    this._syncConditionalRewardVisibility();
    this._installDiagnosticsBridge();
    this._recordEvent({ type: 'runtime-mounted', planId: this.plan.planId ?? this.plan.id });
    return this;
  }

  update(dt) {
    if (!this.mounted || this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    let remaining = Math.min(dt, MAX_RUNTIME_UPDATE_SECONDS);
    if (dt > MAX_RUNTIME_UPDATE_SECONDS) {
      this.errors.push({
        code: 'runtime-delta-clamped',
        requestedSeconds: dt,
        processedSeconds: MAX_RUNTIME_UPDATE_SECONDS,
        atHeartbeat: this.frameHeartbeat,
      });
    }
    while (remaining > POSITION_EPSILON) {
      const step = Math.min(remaining, MAX_RUNTIME_STEP_SECONDS);
      this._fixedUpdate(step);
      remaining -= step;
    }
  }

  /**
   * Keeps the real third-person camera inside the plan's closed cells. Portal
   * apertures remain usable because their boundary is physically carved into
   * separate collider segments; solid faces and closed gate barriers clamp the
   * camera before it can enter exterior clear space.
   */
  _queryCameraContainmentColliders(start, end, margin = 0.5) {
    const binSize = this._cameraContainmentBinSize;
    const minX = Math.floor((Math.min(start.x, end.x) - margin) / binSize);
    const maxX = Math.floor((Math.max(start.x, end.x) + margin) / binSize);
    const minZ = Math.floor((Math.min(start.z, end.z) - margin) / binSize);
    const maxZ = Math.floor((Math.max(start.z, end.z) + margin) / binSize);
    const candidates = new Set();
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (const collider of this._cameraContainmentBins.get(spatialBinKey(x, z)) ?? []) {
          candidates.add(collider);
        }
      }
    }
    // A malformed collider with no finite bounds is intentionally retained in
    // the authoritative array but cannot enter a spatial bucket. The segment
    // test would skip it too, so no behavior is lost by the indexed query.
    const result = [...candidates];
    const stats = this.cameraContainmentQueryStats;
    stats.queryCount += 1;
    stats.candidateTests += result.length;
    stats.bruteForceEquivalentTests += this._cameraContainmentColliders.length;
    stats.lastCandidateCount = result.length;
    stats.maximumCandidateCount = Math.max(stats.maximumCandidateCount, result.length);
    return result;
  }

  constrainThirdPersonCamera(camera, player, {
    wallClearance = 0.32,
    cellTolerance = 0.05,
  } = {}) {
    const root = player?.root;
    if (!camera?.position || !root?.position) return false;

    const start = typeof player.getCameraFocusPosition === 'function'
      ? player.getCameraFocusPosition(new THREE.Vector3())
      : root.position.clone();
    start.y += 1.35;
    const desired = camera.position.clone();
    const distance = start.distanceTo(desired);
    if (distance <= POSITION_EPSILON) return false;

    let limitingT = 1;
    let limitingPlanId = null;
    for (const collider of this._queryCameraContainmentColliders(start, desired, wallClearance)) {
      if (collider?.active === false || collider?.enabled === false) continue;
      const bounds = runtimeColliderBounds(collider);
      if (!bounds || boundsContain(bounds, start, 0.015)) continue;
      const entry = segmentBoundsEntry(start, desired, bounds);
      if (entry != null && entry > POSITION_EPSILON && entry < limitingT) {
        limitingT = entry;
        limitingPlanId = collider.planId ?? collider.id ?? null;
      }
    }

    const cells = this.plan.spatialCells ?? [];
    const insideAnyCell = (point) => cells.some((cell) => boundsContain(cell.bounds, point, cellTolerance));
    if (limitingT === 1 && !insideAnyCell(desired)) {
      // A missing/malformed boundary must not let the camera escape silently.
      // Find the first exit from the connected authored cell union so runtime
      // remains safe while acceptance reports the structural defect.
      const steps = Math.max(2, Math.ceil(distance / 0.08));
      let previousT = 0;
      for (let index = 1; index <= steps; index += 1) {
        const t = index / steps;
        const sample = start.clone().lerp(desired, t);
        if (insideAnyCell(sample)) {
          previousT = t;
          continue;
        }
        let low = previousT;
        let high = t;
        for (let iteration = 0; iteration < 10; iteration += 1) {
          const middle = (low + high) * 0.5;
          if (insideAnyCell(start.clone().lerp(desired, middle))) low = middle;
          else high = middle;
        }
        limitingT = high;
        limitingPlanId = 'spatial-cell-union';
        break;
      }
    }

    if (limitingT >= 1) return false;
    const safeT = Math.max(0, limitingT - wallClearance / distance);
    camera.position.copy(start).lerp(desired, safeT);
    camera.updateMatrixWorld?.(true);
    this.cameraContainmentAdjustments += 1;
    this.lastCameraContainment = {
      planId: limitingPlanId,
      desiredPosition: { x: desired.x, y: desired.y, z: desired.z },
      constrainedPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      atHeartbeat: this.frameHeartbeat,
    };
    return true;
  }

  activateAction(actionId, context = {}) {
    const action = this.actionById.get(actionId);
    if (!action) return { ok: false, reason: 'unknown-action' };
    const waterEffect = (action.effects ?? []).find((effect) => effect.op === 'setWaterState');
    const waterTargetId = waterEffect?.stateId ?? waterEffect?.value ?? null;
    if (waterEffect) {
      if (!this.water?.configurations.has(waterTargetId)) {
        return { ok: false, reason: 'unknown-water-configuration' };
      }
      if (this.water.transfer) return { ok: false, reason: 'environment-transition-in-progress' };
      if (this.water.configurationId === waterTargetId) return { ok: false, reason: 'state-already-active' };
    }
    const interactionResult = this._validateInteraction(action, context);
    if (!interactionResult.ok) return interactionResult;
    if (!this._conditionsPass(action.conditions ?? [], context)) {
      return { ok: false, reason: 'conditions-not-met' };
    }

    const effects = action.effects ?? [];
    // Credential actions are committed only after the authoritative inventory
    // accepts every declared key. Previously collectReward and the operated
    // event could be recorded before a failed grant, leaving diagnostics ahead
    // of the physical card/inventory state. The controller may retry a rejected
    // pedestal normally because no plan effect has been applied at this point.
    for (const effect of effects) {
      if (effect.op !== 'grantKey') continue;
      const alreadyOwned = context.hasKey?.(effect.keyId) === true;
      if (alreadyOwned) continue;
      if (typeof context.grantKey !== 'function') {
        return { ok: false, reason: 'missing-key-grant-handler' };
      }
      if (context.grantKey(effect.keyId) !== true) {
        return { ok: false, reason: 'key-grant-failed' };
      }
    }

    const controller = action.controllerId ? this.controllerById.get(action.controllerId) : null;
    if (controller) {
      if (waterEffect) {
        const legalTransition = controller.transitions.find((candidate) => (
          candidate.actionId === action.id
          && (candidate.fromStateId === controller.stateId || candidate.fromStateId === '*')
          && candidate.toStateId === waterTargetId
        ));
        if (!legalTransition) return { ok: false, reason: 'illegal-mechanism-transition' };
      } else if (!controller.transition(action.id)) {
        return { ok: false, reason: 'illegal-mechanism-transition' };
      }
    }

    const effectContext = {
      ...context,
      actionId: action.id,
      actionControllerId: action.controllerId ?? null,
    };
    for (const effect of effects) {
      if (effect.op !== 'grantKey') this._applyEffect(effect, effectContext);
    }
    this.operatedActionIds.add(action.id);
    this.actionOperationCounts.set(
      action.id,
      (this.actionOperationCounts.get(action.id) ?? 0) + 1,
    );
    this._recordEvent({ type: 'action-operated', actionId: action.id });
    return { ok: true, actionId: action.id };
  }

  setWaterConfiguration(configurationId, { actionId = null, controllerId = null } = {}) {
    if (!this.water) return false;
    const configuration = this.water.configurations.get(configurationId);
    if (!configuration || this.water.transfer || configurationId === this.water.configurationId) return false;
    const fromConfiguration = this.water.configurations.get(this.water.configurationId);
    const duration = Math.max(0.05, Number(this.water.transferSeconds) || 2.4);
    this.water.transfer = {
      actionId,
      controllerId,
      fromConfigurationId: this.water.configurationId,
      toConfigurationId: configurationId,
      elapsed: 0,
      duration,
      fromLevels: { ...(fromConfiguration?.levels ?? Object.fromEntries(this.water.levels)) },
      toLevels: { ...(configuration.levels ?? {}) },
    };
    this._syncSemanticRoomPackWaterBindings();
    this._recordEvent({
      type: 'water-transfer-started',
      actionId,
      fromConfigurationId: this.water.configurationId,
      toConfigurationId: configurationId,
      duration,
    });
    return true;
  }

  /**
   * Applies a declared stable mechanism pose immediately. This is the same
   * path used when loading/restoring runtime state and by the independent
   * assembly acceptance proofs; it never invents an undeclared pose.
   */
  applyMechanismStableState(mechanismId, stateId, { emitEvent = true, source = 'state-restore' } = {}) {
    const controller = this.controllerById.get(mechanismId);
    const state = controller?.states.get(stateId);
    if (!controller || !state || state.stable === false) return false;

    const previousStateId = controller.stateId;
    if (controller.type === 'water-router' && this.water?.configurations.has(stateId)) {
      this._applyWaterConfigurationImmediate(stateId);
    }
    controller.stateId = stateId;
    controller.applyStableState(state, { immediate: true });
    this._syncSemanticRoomPackBindings();
    if (emitEvent && previousStateId !== stateId) {
      this._recordEvent({
        type: 'mechanism-state-restored',
        mechanismId,
        fromStateId: previousStateId,
        toStateId: stateId,
        source,
      });
    }
    return true;
  }

  isPositionFlooded(position) {
    if (!this.water || !position) return false;
    return this.water.basins.some((basin) => {
      const exactLevel = this.water.levels.get(basin.id) ?? 0;
      if (exactLevel <= POSITION_EPSILON) return false;
      const waterSurfaceY = basin.bounds.min.y + exactLevel;
      const walkableBottomY = Number.isFinite(basin.walkableBottomY)
        ? basin.walkableBottomY
        : basin.bounds.min.y;
      const rootTolerance = Number.isFinite(basin.playerRootTolerance)
        ? Math.max(0, basin.playerRootTolerance)
        : 0.5;
      return position.x >= basin.bounds.min.x
        && position.x <= basin.bounds.max.x
        && position.z >= basin.bounds.min.z
        && position.z <= basin.bounds.max.z
        && position.y < waterSurfaceY
        && position.y >= walkableBottomY - rootTolerance;
    });
  }

  captureTakeoffFloodedState(position) {
    return this.isPositionFlooded(position);
  }

  getTraversalProfile(position, { takeoffFlooded = null } = {}) {
    const flooded = takeoffFlooded ?? this.isPositionFlooded(position);
    const profile = this.water?.movementProfile ?? {};
    return flooded
      ? {
        flooded: true,
        movementMultiplier: profile.groundMovementMultiplier ?? profile.movementMultiplier ?? 0.76,
        jumpHeight: profile.jumpHeight ?? 4.95,
        gravityScale: profile.gravityScale ?? 0.28,
        captureFloodedStateAtTakeoff: profile.captureFloodedStateAtTakeoff !== false,
        mode: profile.mode ?? 'bottom-walking',
      }
      : {
        flooded: false,
        movementMultiplier: 1,
        jumpHeight: null,
        gravityScale: 1,
        captureFloodedStateAtTakeoff: profile.captureFloodedStateAtTakeoff !== false,
        mode: 'normal',
      };
  }

  isAuthorizedFallTrajectory(position) {
    if (!position) return false;
    return this.authoredFalls.some(({ fall }) => boundsContain(fall.trajectoryBounds, position, 0.05));
  }

  getAuthorizedFallGroundY(position) {
    if (!position) return null;
    let groundY = null;
    for (const { fall, catchmentSurface } of this.authoredFalls) {
      if (!boundsContain(fall.trajectoryBounds, position, 0.05)) continue;
      const catchmentBounds = catchmentSurface.bounds;
      if (position.x < catchmentBounds.min.x - 0.05
        || position.x > catchmentBounds.max.x + 0.05
        || position.z < catchmentBounds.min.z - 0.05
        || position.z > catchmentBounds.max.z + 0.05) {
        continue;
      }
      const candidateY = catchmentBounds.max.y;
      if (position.y < candidateY - 0.05) continue;
      groundY = groundY == null ? candidateY : Math.max(groundY, candidateY);
    }
    return groundY;
  }

  reportUnauthorizedFallCorrection(position, reason = 'unowned-exterior-fall') {
    const rounded = position
      ? `${Number(position.x).toFixed(2)}:${Number(position.y).toFixed(2)}:${Number(position.z).toFixed(2)}`
      : 'unknown';
    const key = `${reason}:${rounded}`;
    if (this._unauthorizedFallErrorKeys.has(key)) return false;
    this._unauthorizedFallErrorKeys.add(key);
    const error = {
      code: 'unauthorized-fall-correction',
      reason,
      position: position ? { x: position.x, y: position.y, z: position.z } : null,
      atHeartbeat: this.frameHeartbeat,
    };
    this.errors.push(error);
    this._recordEvent({ type: error.code, reason, position: error.position });
    return true;
  }

  markExtracted() {
    this.extracted = true;
    this._recordEvent({ type: 'dungeon-extracted' });
  }

  _getRenderPerformanceDiagnostics() {
    const gameHeartbeat = Number(this.game?.frameHeartbeat) || 0;
    if (this._renderPerformanceCache
      && gameHeartbeat - this._renderPerformanceCacheHeartbeat < 15) {
      return this._renderPerformanceCache;
    }
    const rendererInfo = this.game?.renderer?.info?.render;
    const camera = this.game?.camera;
    const root = this.facade.group;
    let frustumShadowCasterCount = 0;
    let frustumShadowTriangleCount = 0;
    if (camera && root) {
      camera.updateMatrixWorld?.(true);
      const projection = new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
      const visit = (object, ancestorsVisible = true) => {
        const visible = ancestorsVisible && object.visible !== false;
        if (!visible) return;
        if (object.isMesh && object.castShadow && object.geometry) {
          object.geometry.computeBoundingSphere?.();
          const sphere = object.geometry.boundingSphere?.clone?.().applyMatrix4(object.matrixWorld);
          if (!sphere || frustum.intersectsSphere(sphere)) {
            frustumShadowCasterCount += 1;
            const drawCount = object.geometry.index?.count
              ?? object.geometry.attributes?.position?.count
              ?? 0;
            frustumShadowTriangleCount += Math.floor(drawCount / 3);
          }
        }
        for (const child of object.children ?? []) visit(child, visible);
      };
      visit(root);
    }
    this._renderPerformanceCacheHeartbeat = gameHeartbeat;
    this._renderPerformanceCache = {
      gameFrameHeartbeat: gameHeartbeat,
      renderer: rendererInfo ? {
        calls: Number(rendererInfo.calls) || 0,
        triangles: Number(rendererInfo.triangles) || 0,
        points: Number(rendererInfo.points) || 0,
        lines: Number(rendererInfo.lines) || 0,
      } : null,
      frustumShadowCasterCount,
      frustumShadowTriangleCount,
      assembly: this.facade.assemblyPerformance ?? null,
      renderCulling: this.game?.dungeonRenderCullStats ?? null,
    };
    return this._renderPerformanceCache;
  }

  getDiagnostics(profile = 'full') {
    const normalizedProfile = typeof profile === 'string'
      ? profile
      : profile?.profile ?? 'full';
    if (!['movement', 'navigation', 'runtime', 'full'].includes(normalizedProfile)) {
      throw new Error(`Unknown Dungeon V2 diagnostics profile: ${normalizedProfile}`);
    }
    const completedEncounterIds = (this.facade.encounters ?? [])
      .filter((encounter) => encounter.cleared)
      .map((encounter) => encounter.id);
    const collectedRewardIds = (this.facade.rewards ?? [])
      .filter((reward) => reward.collected || reward.opened)
      .map((reward) => reward.id);
    const completedObjectiveIds = (this.facade.objectives ?? [])
      .filter((objective) => objective.complete === true)
      .map((objective) => objective.id);
    const player = this.game?.player;
    const playerPosition = player?.root?.position;
    const playerYaw = Number(player?.root?.rotation?.y);
    const camera = this.game?.camera;
    const cameraPosition = camera?.getWorldPosition?.(new THREE.Vector3()) ?? camera?.position;
    const cameraYaw = Number(this.game?.cameraController?.yaw ?? camera?.rotation?.y);
    const nearestInteractable = this.game?.dungeonController?.getNearestInteractable?.() ?? null;
    const promptTarget = nearestInteractable?.target;
    const ladderTraversal = player?.getLadderTraversalDiagnostics?.() ?? null;
    const fbxAnimationLoadState = player?.externalRig?.root?.userData?.fbxAnimationLoadState ?? null;
    const activeFbxAnimationClip = player?.externalRig?.root?.userData?.activeFbxAnimationClip ?? null;
    const ledgeCling = player?.getLedgeClingDiagnostics?.() ?? null;
    const environmentalTraversal = player?.getEnvironmentalTraversalDiagnostics?.() ?? null;
    const activeEnemies = (this.game?.enemies ?? []).filter((enemy) => !enemy?.dead);
    const activeArmIndex = Number.isInteger(player?.activeArmIndex)
      ? player.activeArmIndex
      : null;
    const activeArm = player?.getActiveArmWeapon?.() ?? (
      activeArmIndex !== null ? player?.armHotbar?.[activeArmIndex] : null
    );
    const armLoadout = player?.armLoadout?.snapshot?.() ?? null;
    const gearLoadout = player?.gearLoadout?.snapshot?.() ?? null;
    const isAttachedToDungeon = (object) => {
      for (let current = object; current; current = current.parent) {
        if (current === this.facade.group) return true;
      }
      return false;
    };
    const isEffectivelyVisible = (object) => {
      if (!isAttachedToDungeon(object)) return false;
      for (let current = object; current; current = current.parent) {
        if (current.visible === false) return false;
        if (current === this.facade.group) return true;
      }
      return false;
    };
    const ownedKeycardIds = [...(
      this.game?.dungeonController?.progressionManager?.collectedKeycardIds ?? []
    )];
    const keycardPickups = (this.facade.keycards ?? []).map((keycard) => ({
      rewardId: keycard.id ?? null,
      keycardId: keycard.keycardId ?? null,
      actionId: keycard.actionId ?? null,
      regionId: keycard.regionId ?? keycard.spawnRoomId ?? null,
      collected: keycard.collected === true,
      renderAttached: isAttachedToDungeon(keycard.object),
      renderVisible: isEffectivelyVisible(keycard.object),
      pedestalAttached: isAttachedToDungeon(keycard.pedestalObject),
      visualPosition: keycard.object?.position ? {
        x: keycard.object.position.x,
        y: keycard.object.position.y,
        z: keycard.object.position.z,
      } : null,
      visualRestY: Number.isFinite(keycard.visualRestY) ? keycard.visualRestY : null,
      pedestalTopY: Number.isFinite(keycard.pedestalTopY) ? keycard.pedestalTopY : null,
    }));
    const expeditionConfiguration = {
      difficulty: Number.isFinite(this.game?.ruinFloor) ? this.game.ruinFloor : null,
      sandboxActive: this.game?.busterSandboxSession?.active === true,
      testRangeActive: this.game?.busterTestRange?.active === true,
      activeArmIndex,
      activeArm: activeArm ? {
        id: activeArm.fixedArmId ?? activeArm.buildId ?? activeArm.id ?? activeArm.type ?? null,
        kind: activeArm.fixedArmId === 'megaBuster'
          ? 'megaBuster'
          : activeArm.fixedArmId
            ? 'fixedArm'
            : activeArm.buildId
              ? 'customBuster'
              : activeArm.type ?? null,
        weaponKind: activeArm.weaponKind ?? null,
      } : null,
      arms: armLoadout ? {
        ownedArmIds: [...(armLoadout.ownedArmIds ?? [])],
        slots: armLoadout.slots ?? null,
      } : null,
      gear: gearLoadout ? {
        unlockedGearIds: (gearLoadout.records ?? [])
          .filter((record) => record?.unlocked === true)
          .map((record) => record.gearId),
        unlockedSlots: [...(gearLoadout.unlockedSlots ?? [])],
        slots: gearLoadout.slots ?? null,
      } : null,
    };
    const authorizedFall = playerPosition
      ? this.authoredFalls.find(({ fall }) => boundsContain(fall.trajectoryBounds, playerPosition, 0.05))
      : null;
    const movementSnapshot = {
      buildFingerprint: this.plan.buildFingerprint ?? this.plan.revision ?? 'dungeon-v2-m1',
      frameHeartbeat: this.frameHeartbeat,
      fixtureId: this.plan.fixtureId ?? null,
      planId: this.plan.planId ?? this.plan.id,
      currentRegionId: this.currentRegionId,
      visitedRegionIds: [...this.visitedRegionIds],
      safeguardActivations: this.safeguardActivations,
      cameraContainmentAdjustments: this.cameraContainmentAdjustments,
      cameraContainmentQueryStats: this.cameraContainmentQueryStats,
      collisionSpatialQueryStats: this.game?.dungeonController?.getSpatialQueryDiagnostics?.() ?? null,
      structuralRayAuditStats: this.structuralRayAuditStats,
      lastCameraContainment: this.lastCameraContainment,
      errors: this.errors,
      playerPosition: playerPosition ? {
        x: playerPosition.x,
        y: playerPosition.y,
        z: playerPosition.z,
      } : null,
      playerFacing: Number.isFinite(playerYaw) ? {
        x: Math.sin(playerYaw),
        y: 0,
        z: Math.cos(playerYaw),
      } : null,
      playerYaw: Number.isFinite(playerYaw) ? playerYaw : null,
      jumpState: player?.jumpState ?? null,
      verticalVelocity: Number.isFinite(player?.velocity?.y) ? player.velocity.y : null,
      cameraPosition: cameraPosition ? {
        x: cameraPosition.x,
        y: cameraPosition.y,
        z: cameraPosition.z,
      } : null,
      cameraYaw: Number.isFinite(cameraYaw) ? cameraYaw : null,
      currentPrompt: nearestInteractable ? {
        kind: nearestInteractable.kind ?? null,
        label: nearestInteractable.label ?? promptTarget?.label ?? null,
        actionId: promptTarget?.v2ActionId ?? promptTarget?.actionId ?? null,
        targetId: promptTarget?.id ?? null,
      } : null,
      ladderTraversal,
      fbxAnimationLoadState,
      activeFbxAnimationClip,
      ledgeCling,
      animationState: player?.animation?.state ?? null,
      environmentalTraversal,
      performance: {
        ...this._getRenderPerformanceDiagnostics(),
        frame: this.game?.framePerformanceDiagnostics ?? null,
        platformQueries: this.game?.platformQueryDiagnostics ?? null,
        platformSurfaceCount: this.game?._getPlatformingSurfaces?.().length ?? 0,
        platformLedgeCandidateCount: this.game?.platformingLedgeCandidates?.length ?? 0,
      },
    };
    if (normalizedProfile === 'movement') return copyPlain(movementSnapshot);
    if (normalizedProfile === 'navigation') {
      return copyPlain({ ...movementSnapshot, navigation: this.navigationSnapshot });
    }

    const runtimeSnapshot = {
      ...movementSnapshot,
      traversedPortalIds: [...this.traversedPortalIds],
      completedEncounterIds,
      collectedRewardIds,
      ownedKeycardIds,
      keycardPickups,
      completedObjectiveIds,
      operatedActionIds: [...this.operatedActionIds],
      actionOperationCounts: Object.fromEntries(this.actionOperationCounts),
      nativeFixedRoomAssembly: this.facade.nativeFixedRoomAssemblyDiagnostics ?? null,
      semanticRoomPackPresentation: this.facade.semanticRoomPackPresentationDiagnostics ?? null,
      extracted: this.extracted,
      mechanisms: this.controllers.map((controller) => controller.snapshot()),
      dynamicSurfaces: [...this.resources.dynamicSurfaces].map(([surfaceId, surface]) => ({
        surfaceId,
        enabled: surface.enabled !== false,
        center: surface.center ? {
          x: surface.center.x,
          y: surface.center.y,
          z: surface.center.z,
        } : null,
        topY: Number.isFinite(surface.topY) ? surface.topY : null,
        halfWidth: Number.isFinite(surface.halfWidth) ? surface.halfWidth : null,
        halfDepth: Number.isFinite(surface.halfDepth) ? surface.halfDepth : null,
      })),
      falls: this.authoredFalls.map(({
        fall,
        sourceSurface,
        catchmentSurface,
        returnLink,
        returnSurface,
        returnWaypoints,
      }) => ({
        id: fall.id,
        sourcePortalId: fall.sourcePortalId,
        sourceSurfaceId: sourceSurface.id,
        sourceSurfaceTopY: sourceSurface.bounds.max.y,
        sourceCenter: {
          x: (sourceSurface.bounds.min.x + sourceSurface.bounds.max.x) * 0.5,
          y: sourceSurface.bounds.max.y,
          z: (sourceSurface.bounds.min.z + sourceSurface.bounds.max.z) * 0.5,
        },
        catchmentSurfaceId: fall.catchmentSurfaceId,
        trajectoryBounds: fall.trajectoryBounds,
        catchmentBounds: catchmentSurface.bounds,
        catchmentY: catchmentSurface.bounds.max.y,
        returnLinkId: returnLink.id,
        returnSurfaceId: returnSurface.id,
        returnWaypoints,
        damageFree: fall.damageFree,
        playableDestination: fall.playableDestination,
      })),
      playerFallState: playerPosition ? {
        authorized: Boolean(authorizedFall),
        fallId: authorizedFall?.fall.id ?? null,
        catchmentGroundY: this.getAuthorizedFallGroundY(playerPosition),
      } : null,
      waterConfigurationId: this.water?.configurationId ?? null,
      waterTransfer: this.water?.transfer ? {
        phase: 'transferring',
        fromConfigurationId: this.water.transfer.fromConfigurationId,
        toConfigurationId: this.water.transfer.toConfigurationId,
        progress: clamp01(this.water.transfer.elapsed / this.water.transfer.duration),
        duration: this.water.transfer.duration,
      } : this.water ? { phase: 'idle', progress: 1 } : null,
      variables: Object.fromEntries(this.variables),
      hazardPhases: [...this.hazards.values()].map((hazard) => ({
        id: hazard.id,
        phase: hazard.phase,
        active: hazard.active,
      })),
      hazardExposure: [...this.hazardExposureLedger].map(([key, exposure]) => ({
        key,
        ...exposure,
      })),
      expeditionConfiguration,
      health: Number.isFinite(player?.health) ? player.health : null,
      maxHealth: Number.isFinite(player?.stats?.maxHealth) ? player.stats.maxHealth : null,
      barrier: player?.barrier ? {
        current: Number(player.barrier.current) || 0,
        capacity: Number(player.barrier.capacity) || 0,
        broken: player.barrier.broken === true,
        recharging: player.barrier.recharging === true,
      } : null,
      lockOnTargetId: this.game?.combat?.getMovementLockTarget?.()?.id ?? null,
      activeEnemyCount: activeEnemies.length,
      activeEnemies: activeEnemies.map((enemy, index) => ({
        id: enemy.id ?? enemy.root?.uuid ?? `enemy-${index}`,
        encounterId: enemy.encounterId ?? null,
        type: enemy.typeKey ?? enemy.archetypeId ?? enemy.constructor?.name ?? 'enemy',
        attackKind: enemy.genome?.modules?.weapon?.attackKind ?? null,
        planOwnedSpawnPointIndex: Number.isInteger(enemy.planOwnedSpawn?.spawnPointIndex)
          ? enemy.planOwnedSpawn.spawnPointIndex
          : null,
        generationPolicy: enemy.planOwnedGenerationPolicy ? {
          id: enemy.planOwnedGenerationPolicy.id,
          slotIndex: enemy.planOwnedGenerationPolicy.slotIndex,
          verified: enemy.planOwnedGenerationPolicy.verified === true,
          capabilities: enemy.planOwnedGenerationPolicy.capabilities ?? null,
        } : null,
        position: enemy.root?.position ? {
          x: enemy.root.position.x,
          y: enemy.root.position.y,
          z: enemy.root.position.z,
        } : null,
        health: Number.isFinite(enemy.health) ? enemy.health : null,
      })),
    };
    if (normalizedProfile === 'runtime') return copyPlain(runtimeSnapshot);
    return copyPlain({
      ...runtimeSnapshot,
      navigation: this.navigationSnapshot,
      eventLog: this.eventLog,
      structuralRegistry: this.facade.structuralRegistry?.auditSnapshot?.() ?? null,
      structuralRayAudits: this.cameraRayAudits,
      journeyCameraPositions: this.journeyCameraPositions,
    });
  }

  dispose() {
    if (this.disposed) return;
    for (const surface of this.resources.dynamicSurfaces.values()) {
      this.game?.unregisterDynamicPlatformingSurface?.(surface);
    }
    for (const controller of this.controllers) controller.dispose();
    this.game?.player?.setEnvironmentalTraversalProfile?.({
      flooded: false,
      movementMultiplier: 1,
      jumpHeight: null,
      gravityScale: 1,
      captureFloodedStateAtTakeoff: true,
      mode: 'normal',
    });
    if (typeof window !== 'undefined'
      && window.__RUINDIVEX_V2_DIAGNOSTICS__ === this._diagnosticsBridge) {
      delete window.__RUINDIVEX_V2_DIAGNOSTICS__;
    }
    this.mounted = false;
    this.disposed = true;
    this.game = null;
  }

  _fixedUpdate(dt) {
    this.elapsed += dt;
    this.frameHeartbeat += 1;
    this._updateWaterTransfer(dt);
    const playerPosition = this.game?.player?.root?.position;
    if (playerPosition) {
      this.game.player.setEnvironmentalTraversalProfile?.(
        this.getTraversalProfile(playerPosition),
      );
    }
    for (const controller of this.controllers) controller.update(dt);
    this._updateHazards(dt);
    this._syncSemanticRoomPackBindings();
    this._updateRegionVisit();
    this._updateCameraStructuralRayAudit();
    this._updateSafeAnchor();
    this._applyRecoverySafeguard();
    this._syncExternalCompletionState();
    this._syncSystemObjectiveActions();
    this._syncConditionalRewardVisibility();
  }

  _getSemanticRoomPackDynamicBindingMap() {
    const candidates = [
      this.resources.semanticRoomPackDynamicBindings,
      this.resources.semanticRoomPackDynamicBindingsByPlacementId,
    ].map((candidate) => (
      candidate?.dynamicBindingsByPlacementId instanceof Map
        ? candidate.dynamicBindingsByPlacementId
        : candidate
    ));
    const populated = candidates.find((candidate) => candidate instanceof Map && candidate.size > 0);
    if (populated) return populated;
    for (const candidate of candidates) {
      if (candidate instanceof Map) return candidate;
    }
    return null;
  }

  _getSemanticRoomPackBindingEntries() {
    const bindingsByPlacementId = this._getSemanticRoomPackDynamicBindingMap();
    if (!bindingsByPlacementId) return [];
    return (this.plan.semanticRoomPackPlacements ?? [])
      .map((placement) => ({
        placement,
        binding: bindingsByPlacementId.get(placement.placementId ?? placement.id),
      }))
      .filter(({ binding }) => binding != null);
  }

  _semanticRoomPackMarker(placement, sourceNodeName) {
    return (placement.semanticMarkers ?? [])
      .find((marker) => marker.sourceNodeName === sourceNodeName) ?? null;
  }

  _reportSemanticRoomPackContractError(code, placement, details = {}) {
    const placementId = placement?.placementId ?? placement?.id ?? null;
    const key = `${code}:${placementId ?? '<unknown>'}:${JSON.stringify(details)}`;
    if (this._semanticRoomPackDiagnosticKeys.has(key)) return;
    this._semanticRoomPackDiagnosticKeys.add(key);
    const error = {
      code,
      placementId,
      roomId: placement?.roomId ?? null,
      ...copyPlain(details),
      atHeartbeat: this.frameHeartbeat,
    };
    this.errors.push(error);
    this._recordEvent({ type: code, ...error });
  }

  _tagSemanticRoomPackNode(node, placement, marker, binding = {}) {
    if (!node) return;
    node.userData ??= {};
    node.userData.v2SemanticRoomPackPresentation = true;
    node.userData.v2SemanticSourceNodeName = marker?.sourceNodeName ?? node.name ?? null;
    node.userData.v2SemanticMarkerId = marker?.id ?? null;
    node.userData.v2SemanticPlacementId = placement.placementId ?? placement.id;
    node.userData.v2CollisionAuthority = 'accepted-plan-semantic-room-pack-records';
    node.userData.v2CollisionDerivedFromMeshBounds = false;
    node.userData.v2SemanticPlanBinding = {
      schemaVersion: 1,
      placementId: placement.placementId ?? placement.id,
      roomId: placement.roomId,
      markerId: marker?.id ?? null,
      sourceNodeName: marker?.sourceNodeName ?? node.name ?? null,
      semantic: marker?.semantic ?? null,
      ...copyPlain(binding),
    };
  }

  _syncSemanticRoomPackBindings() {
    if (!this._getSemanticRoomPackDynamicBindingMap()) return;
    this._syncSemanticRoomPackWaterBindings();
    this._syncSemanticRoomPackHazardBindings();
    this._syncSemanticRoomPackMechanismBindings();
  }

  _semanticRoomPackOwnsWaterBasin(basinId) {
    for (const { placement } of this._getSemanticRoomPackBindingEntries()) {
      const bindings = placement.runtimePresentationBindings?.waterBasins ?? [];
      if (bindings.some((entry) => entry.basinId === basinId)) return true;
    }
    return false;
  }

  _semanticRoomPackWaterPresentationBinding(placement, sourceNodeName) {
    return (placement.runtimePresentationBindings?.waterBasins ?? [])
      .find((entry) => entry.sourceNodeName === sourceNodeName) ?? null;
  }

  _syncSemanticRoomPackWaterBindings() {
    if (!this.water) return;
    const transfer = this.water.transfer;
    const phase = transfer ? 'transfer' : 'stable';
    const transferProgress = transfer ? clamp01(transfer.elapsed / transfer.duration) : null;

    for (const { placement, binding } of this._getSemanticRoomPackBindingEntries()) {
      const contracts = (placement.environmentContracts ?? [])
        .filter(({ kind }) => kind === 'conserved-fluid-network');
      for (const contract of contracts) {
        const missingStateIds = (contract.stableStates ?? [])
          .map(({ id }) => id)
          .filter((stateId) => !this.water.configurations.has(stateId));
        if (missingStateIds.length) {
          this._reportSemanticRoomPackContractError(
            'semantic-room-pack-water-state-contract-mismatch',
            placement,
            {
              environmentContractId: contract.id,
              missingStateIds,
              globalEnvironmentId: this.water.id,
            },
          );
        }

        for (const [sourceNodeName, node] of binding.fluids ?? []) {
          const marker = this._semanticRoomPackMarker(placement, sourceNodeName);
          if (!marker || marker.semantic !== 'fluidSurface') continue;
          const presentationBinding = this._semanticRoomPackWaterPresentationBinding(
            placement,
            sourceNodeName,
          );
          if (!presentationBinding) {
            this._reportSemanticRoomPackContractError(
              'semantic-room-pack-water-presentation-binding-missing',
              placement,
              { environmentContractId: contract.id, sourceNodeName },
            );
            continue;
          }
          const stableStateId = marker.extras?.stableState ?? null;
          if (!stableStateId) {
            this._reportSemanticRoomPackContractError(
              'semantic-room-pack-fluid-stable-state-missing',
              placement,
              { environmentContractId: contract.id, sourceNodeName },
            );
            continue;
          }
          const contractState = (contract.stableStates ?? [])
            .find(({ id }) => id === stableStateId);
          const declaredWorldLevels = Object.values(contractState?.levels ?? {})
            .filter(Number.isFinite);
          if (contractState && Number.isFinite(marker.worldPosition?.y)
            && declaredWorldLevels.length
            && !declaredWorldLevels.some((level) => Math.abs(level - marker.worldPosition.y) <= POSITION_EPSILON)) {
            this._reportSemanticRoomPackContractError(
              'semantic-room-pack-fluid-level-contract-mismatch',
              placement,
              {
                environmentContractId: contract.id,
                sourceNodeName,
                stableStateId,
                markerWorldY: marker.worldPosition.y,
                declaredWorldLevels,
              },
            );
          }

          const animating = transfer && (
            stableStateId === transfer.fromConfigurationId
            || stableStateId === transfer.toConfigurationId
          );
          const basin = (this.water.basins ?? [])
            .find(({ id }) => id === presentationBinding.basinId) ?? null;
          const displayLevel = transfer && basin
            ? THREE.MathUtils.lerp(
                Number(transfer.fromLevels[basin.id]) || 0,
                Number(transfer.toLevels[basin.id]) || 0,
                transferProgress,
              )
            : Number(this.water.levels.get(presentationBinding.basinId)) || 0;
          node.visible = transfer
            ? Boolean(animating) && displayLevel > POSITION_EPSILON
            : stableStateId === this.water.configurationId;
          if (node.position && marker.localPosition) {
            let localY = marker.localPosition.y;
            let displaySurfaceWorldY = marker.worldPosition?.y ?? null;
            if (transfer && animating && basin?.bounds?.min && Number.isFinite(displayLevel)) {
              displaySurfaceWorldY = basin.bounds.min.y + displayLevel;
              const authoredSurfaceWorldY = Number.isFinite(presentationBinding.absoluteWorldY)
                ? presentationBinding.absoluteWorldY
                : marker.worldPosition?.y;
              if (Number.isFinite(authoredSurfaceWorldY)) {
                localY += displaySurfaceWorldY - authoredSurfaceWorldY;
              }
            }
            if (typeof node.position.set === 'function') {
              node.position.set(
                marker.localPosition.x,
                localY,
                marker.localPosition.z,
              );
            } else {
              Object.assign(node.position, marker.localPosition, { y: localY });
            }
            node.userData.v2WaterDisplaySurfaceWorldY = displaySurfaceWorldY;
          }
          this._tagSemanticRoomPackNode(node, placement, marker, {
            environmentContractId: contract.id,
            environmentProfile: contract.profile,
            globalEnvironmentId: this.water.id,
            stableStateId,
            basinId: presentationBinding.basinId,
            presentationMode: presentationBinding.presentationMode,
          });
          node.userData.v2WaterVisualPhase = phase;
          node.userData.v2WaterConfigurationId = transfer?.toConfigurationId
            ?? this.water.configurationId;
          node.userData.v2WaterTransferFromConfigurationId = transfer?.fromConfigurationId ?? null;
          node.userData.v2WaterTransferProgress = transferProgress;
          node.userData.v2WaterDisplayLevel = displayLevel;
          node.userData.v2ManifestLocalY = marker.localPosition?.y ?? null;
          node.userData.v2ManifestAbsoluteWorldY = marker.worldPosition?.y ?? null;
        }
      }
    }

    for (const basin of this.water.basins) {
      if (!this._semanticRoomPackOwnsWaterBasin(basin.id)) continue;
      const genericWaterObject = this.resources.waterObjects.get(basin.id);
      if (!genericWaterObject) continue;
      genericWaterObject.visible = false;
      genericWaterObject.userData ??= {};
      genericWaterObject.userData.v2SuppressedBySemanticRoomPack = true;
      genericWaterObject.userData.v2CollisionDerivedFromMeshBounds = false;
    }
  }

  _resolveSemanticRoomPackHazard(contract) {
    const expected = normalizeSemanticContractToken(contract.profile);
    return [...this.hazards.values()].find((hazard) => {
      const candidates = [hazard.type, hazard.profile, hazard.kind]
        .map(normalizeSemanticContractToken)
        .filter(Boolean);
      return candidates.some((candidate) => candidate === expected
        || expected.startsWith(candidate)
        || candidate.startsWith(expected));
    }) ?? null;
  }

  _syncSemanticRoomPackHazardBindings() {
    for (const { placement, binding } of this._getSemanticRoomPackBindingEntries()) {
      const contracts = (placement.environmentContracts ?? [])
        .filter(({ kind }) => kind === 'environmental-hazard');
      for (const contract of contracts) {
        const hazard = this._resolveSemanticRoomPackHazard(contract);
        if (!hazard) {
          this._reportSemanticRoomPackContractError(
            'semantic-room-pack-hazard-profile-contract-mismatch',
            placement,
            { profile: contract.profile, globalEnvironmentId: 'environment.undercroft-hazard' },
          );
          continue;
        }
        for (const [sourceNodeName, node] of binding.hazards ?? []) {
          const marker = this._semanticRoomPackMarker(placement, sourceNodeName);
          if (!marker || marker.semantic !== 'hazardSurface') continue;
          const markerProfile = marker.extras?.hazardProfile ?? contract.profile;
          if (normalizeSemanticContractToken(markerProfile)
            !== normalizeSemanticContractToken(contract.profile)) continue;
          node.visible = true;
          this._tagSemanticRoomPackNode(node, placement, marker, {
            environmentContractId: contract.id,
            environmentProfile: contract.profile,
            globalEnvironmentId: hazard.id,
            hazardSurfaceId: marker.id,
          });
          node.userData.v2HazardProfile = contract.profile;
          node.userData.v2HazardPhase = hazard.phase;
          node.userData.v2HazardActive = hazard.active === true;
          node.userData.v2HazardPhaseGroup = marker.extras?.phaseGroup ?? null;
          const intensity = hazard.active
            ? 1.35
            : hazard.phase === 'charging'
              ? 0.72
              : 0.22;
          forEachSemanticMaterial(node, (material) => {
            if ('emissiveIntensity' in material || material.emissive) {
              material.emissiveIntensity = intensity;
            }
          });
        }
      }
    }
  }

  _resolveSemanticRoomPackMechanismController(placement, mechanism) {
    const acceptedMechanismIds = [...new Set((placement.walkableSurfaces ?? [])
      .filter(({ sourceNodeName }) => sourceNodeName === 'MECH_GEAR_PLATFORM'
        || sourceNodeName?.startsWith('MECH_BRIDGE_'))
      .map(({ mechanismId }) => mechanismId)
      .filter(Boolean))];
    const candidates = [
      mechanism.id,
      mechanism.localId,
      ...acceptedMechanismIds,
    ];
    for (const candidate of candidates) {
      const controller = this.controllerById.get(candidate);
      if (controller) return controller;
    }
    const exactStateController = this.controllers.find((controller) => (
      ['corkscrew', 'corkscrew-gear'].includes(controller.type)
      && (mechanism.stableStates ?? []).every((state) => (
        controller.states.has(state.localId) || controller.states.has(state.id)
      ))
    ));
    if (exactStateController) return exactStateController;
    const corkscrewControllers = this.controllers
      .filter((controller) => ['corkscrew', 'corkscrew-gear'].includes(controller.type));
    return corkscrewControllers.length === 1 ? corkscrewControllers[0] : null;
  }

  _syncSemanticRoomPackMechanismBindings() {
    for (const { placement, binding } of this._getSemanticRoomPackBindingEntries()) {
      for (const mechanism of placement.mechanisms ?? []) {
        if (mechanism.localId !== 'corkscrew_exchange'
          && mechanism.controller !== 'discrete_corkscrew_platform_v1') continue;
        const controller = this._resolveSemanticRoomPackMechanismController(placement, mechanism);
        if (!controller) {
          this._reportSemanticRoomPackContractError(
            'semantic-room-pack-mechanism-controller-missing',
            placement,
            { mechanismId: mechanism.id, requiredLocalId: mechanism.localId },
          );
          continue;
        }

        const stableStates = mechanism.stableStates ?? [];
        const usesLocalIds = stableStates.every(({ localId }) => controller.states.has(localId));
        const usesWorldIds = stableStates.every(({ id }) => controller.states.has(id));
        if (!usesLocalIds && !usesWorldIds) {
          this._reportSemanticRoomPackContractError(
            'semantic-room-pack-mechanism-state-contract-mismatch',
            placement,
            {
              mechanismId: controller.id,
              requiredStateIds: stableStates.map(({ localId }) => localId),
              actualStateIds: [...controller.states.keys()],
            },
          );
          continue;
        }
        const resolveState = (stateId) => stableStates.find((state) => (
          (usesLocalIds ? state.localId : state.id) === stateId
        )) ?? null;
        const currentState = resolveState(controller.stateId);
        if (!currentState) continue;
        const targetState = controller.targetStateId ? resolveState(controller.targetStateId) : null;
        const travelProgress = targetState && Number.isFinite(controller.travelDistance)
          && controller.travelDistance > POSITION_EPSILON
          ? clamp01(controller.travelProgress / controller.travelDistance)
          : 0;
        const worldHeight = targetState
          ? THREE.MathUtils.lerp(currentState.worldHeight, targetState.worldHeight, travelProgress)
          : currentState.worldHeight;
        const yawDelta = targetState
          ? ((targetState.worldYawDegrees - currentState.worldYawDegrees + 540) % 360) - 180
          : 0;
        const worldYawDegrees = currentState.worldYawDegrees + yawDelta * travelProgress;
        const placementYawDegrees = (placement.placementTransform?.yawQuarterTurns ?? 0) * 90;
        const localYawRadians = THREE.MathUtils.degToRad(worldYawDegrees - placementYawDegrees);
        const deployedBridge = targetState ? null : currentState.deployedBridge;
        const surfaceBySourceNodeName = new Map((placement.walkableSurfaces ?? [])
          .map((surface) => [surface.sourceNodeName, surface]));

        for (const [sourceNodeName, node] of binding.mechanisms ?? []) {
          const marker = this._semanticRoomPackMarker(placement, sourceNodeName);
          if (!marker) continue;
          const isGearPlatform = sourceNodeName === 'MECH_GEAR_PLATFORM';
          const isBridge = sourceNodeName.startsWith('MECH_BRIDGE_');
          if (!isGearPlatform && !isBridge) continue;
          this._tagSemanticRoomPackNode(node, placement, marker, {
            mechanismId: controller.id,
            authoredMechanismId: mechanism.id,
            stableStateId: currentState.localId,
          });
          node.userData.v2MechanismStableStateId = currentState.localId;
          node.userData.v2MechanismTransitionTargetStateId = targetState?.localId ?? null;
          node.userData.v2MechanismTransitionProgress = targetState ? travelProgress : null;

          const surfaceRecord = surfaceBySourceNodeName.get(sourceNodeName);
          const acceptedSurface = surfaceRecord
            ? this.resources.dynamicSurfaces.get(surfaceRecord.id)
            : isGearPlatform
              ? this.resources.dynamicSurfaceByController.get(controller.id)
              : null;
          if (isGearPlatform) {
            const localPosition = marker.localPosition ?? { x: 0, y: 0, z: 0 };
            const localHeight = worldHeight - (placement.placementTransform?.translation?.y ?? 0);
            if (typeof node.position?.set === 'function') {
              node.position.set(localPosition.x, localHeight, localPosition.z);
            } else if (node.position) {
              Object.assign(node.position, { ...localPosition, y: localHeight });
            }
            if (node.rotation) node.rotation.y = localYawRadians;
            node.visible = true;
            if (acceptedSurface) {
              acceptedSurface.enabled = true;
              acceptedSurface.active = true;
              setDynamicSurfacePosition(acceptedSurface, new THREE.Vector3(
                marker.worldPosition.x,
                worldHeight,
                marker.worldPosition.z,
              ));
            }
            const genericMechanismObject = this.resources.mechanismObjects.get(controller.id);
            if (genericMechanismObject && genericMechanismObject !== node) {
              genericMechanismObject.visible = false;
              genericMechanismObject.userData ??= {};
              genericMechanismObject.userData.v2SuppressedBySemanticRoomPack = true;
              genericMechanismObject.userData.v2CollisionDerivedFromMeshBounds = false;
            }
          } else {
            const worldDirection = rotateSemanticDirection(
              marker.extras?.bridgeDirection,
              placement.placementTransform?.yawQuarterTurns ?? 0,
            );
            const deployed = worldDirection === deployedBridge;
            node.visible = deployed;
            if (acceptedSurface) {
              acceptedSurface.enabled = deployed;
              acceptedSurface.active = deployed;
            }
          }
        }
      }
    }
  }

  _createWaterState() {
    const water = getWaterDefinition(this.plan);
    if (!water) return null;
    const configurations = new Map((water.configurations ?? []).map((entry) => [entry.id, entry]));
    const configurationId = water.initialConfigurationId;
    if (configurations.size !== 3 || !configurations.has(configurationId)) {
      throw new Error('Dungeon V2 Waterworks requires exactly three configurations and a valid initialConfigurationId.');
    }
    if (water.transferCommit !== 'atomic-after-animation') {
      throw new Error('Dungeon V2 Waterworks requires transferCommit="atomic-after-animation".');
    }
    return {
      id: water.id ?? 'environment.water-unit',
      configurationId,
      configurations,
      levels: new Map(Object.entries(configurations.get(configurationId).levels ?? {})),
      conservedVolume: water.conservedVolume,
      basins: water.basins ?? [],
      variableId: water.variableId ?? null,
      movementProfile: water.movementProfile ?? null,
      transferCommit: water.transferCommit,
      transferSeconds: water.transferSeconds
        ?? (this.plan.mechanisms ?? []).find((mechanism) => mechanism.type === 'water-router')
          ?.runtimeProfile?.animationSeconds
        ?? 2.4,
      transfer: null,
    };
  }

  _applyWaterConfigurationImmediate(configurationId) {
    const configuration = this.water?.configurations.get(configurationId);
    if (!this.water || !configuration) return false;
    this.water.configurationId = configurationId;
    this.water.levels = new Map(Object.entries(configuration.levels ?? {}));
    this.water.transfer = null;
    if (this.water.variableId) this.variables.set(this.water.variableId, configurationId);
    for (const basin of this.water.basins) {
      const exactLevel = this.water.levels.get(basin.id) ?? 0;
      this._setWaterVisualLevel(basin, exactLevel, {
        phase: 'stable',
        configurationId,
      });
    }
    return true;
  }

  _setWaterVisualLevel(basin, level, {
    phase,
    configurationId = null,
    transferProgress = null,
  }) {
    const waterObject = this.resources.waterObjects.get(basin.id);
    if (!waterObject) return;
    waterObject.userData ??= {};
    const volumePresentation = waterObject.userData?.v2WaterVolumePresentation === true;
    if (volumePresentation) {
      waterObject.position.y = basin.bounds.min.y + level * 0.5;
      waterObject.scale.y = Math.max(POSITION_EPSILON, level);
    } else {
      // Retain the small pure-runtime fixture contract for non-rendering
      // Object3D doubles. Production assembled water always uses the volume
      // path above.
      waterObject.position.y = basin.bounds.min.y + level;
    }
    const authoredSemanticBasin = this._semanticRoomPackOwnsWaterBasin(basin.id);
    waterObject.visible = !authoredSemanticBasin && level > POSITION_EPSILON;
    waterObject.userData.v2SuppressedBySemanticRoomPack = authoredSemanticBasin;
    waterObject.userData.v2ExactLevel = level;
    waterObject.userData.v2ExactSurfaceY = basin.bounds.min.y + level;
    waterObject.userData.v2ExactBottomY = basin.bounds.min.y;
    waterObject.userData.v2VisibleDepth = level;
    waterObject.userData.v2WaterVisualPhase = phase;
    waterObject.userData.v2WaterConfigurationId = configurationId;
    waterObject.userData.v2WaterTransferProgress = transferProgress;
  }

  _updateWaterTransfer(dt) {
    const transfer = this.water?.transfer;
    if (!transfer) return;
    transfer.elapsed = Math.min(transfer.duration, transfer.elapsed + dt);
    if (transfer.duration - transfer.elapsed <= POSITION_EPSILON) transfer.elapsed = transfer.duration;
    const progress = clamp01(transfer.elapsed / transfer.duration);
    for (const basin of this.water.basins) {
      const fromLevel = Number(transfer.fromLevels[basin.id]) || 0;
      const toLevel = Number(transfer.toLevels[basin.id]) || 0;
      const displayLevel = THREE.MathUtils.lerp(fromLevel, toLevel, progress);
      this._setWaterVisualLevel(basin, displayLevel, {
        phase: 'transfer',
        configurationId: transfer.toConfigurationId,
        transferProgress: progress,
      });
    }
    if (progress < 1) return;

    const configuration = this.water.configurations.get(transfer.toConfigurationId);
    this.water.configurationId = transfer.toConfigurationId;
    this.water.levels = new Map(Object.entries(configuration.levels ?? {}));
    if (this.water.variableId) this.variables.set(this.water.variableId, transfer.toConfigurationId);
    const controller = this.controllerById.get(transfer.controllerId);
    if (controller?.states.has(transfer.toConfigurationId)) {
      controller.stateId = transfer.toConfigurationId;
      controller.applyStableState(controller.states.get(transfer.toConfigurationId), { immediate: true });
    }
    for (const basin of this.water.basins) {
      const exactLevel = this.water.levels.get(basin.id) ?? 0;
      this._setWaterVisualLevel(basin, exactLevel, {
        phase: 'stable',
        configurationId: transfer.toConfigurationId,
      });
    }
    this.water.transfer = null;
    this._recordEvent({
      type: 'water-configuration-committed',
      actionId: transfer.actionId,
      fromConfigurationId: transfer.fromConfigurationId,
      toConfigurationId: transfer.toConfigurationId,
    });
  }

  _createHazardStates() {
    const hazards = getHazardDefinitions(this.plan);
    return new Map(hazards.map((hazard) => [hazard.id, {
      ...hazard,
      elapsed: Number(hazard.phaseOffset) || 0,
      phase: 'grace',
      active: false,
    }]));
  }

  _updateHazards(dt) {
    for (const hazard of this.hazards.values()) {
      const intervalStart = hazard.elapsed;
      if (hazard.phases?.length) {
        hazard.elapsed += dt;
        const selected = getCyclicHazardPhaseAt(hazard, hazard.elapsed);
        hazard.phase = selected.id;
        hazard.active = selected.active;
      } else if (hazard.kind === 'magma') {
        hazard.elapsed += dt;
        hazard.active = true;
        hazard.phase = 'active';
      } else {
        hazard.elapsed += dt;
        const selected = getCyclicHazardPhaseAt(hazard, hazard.elapsed);
        hazard.phase = selected.id;
        hazard.active = selected.active;
      }
      this._integrateHazardActors(hazard, dt, intervalStart);
      const surfaceContracts = hazard.surfaces?.length
        ? hazard.surfaces
        : hazard.surfaceId
          ? [{ surfaceId: hazard.surfaceId }]
          : [];
      for (const surfaceContract of surfaceContracts) {
        const trapId = hazardSurfaceRuntimeId(hazard, surfaceContract);
        const object = this.resources.hazardObjects.get(trapId);
        if (object?.material?.emissive) {
          object.material.emissiveIntensity = hazard.active ? 1.35 : 0.22;
        }
        const trap = this.facade.traps?.find(({ id }) => id === trapId);
        if (trap) {
          trap.active = hazard.active;
          trap.v2HazardPhase = hazard.phase;
        }
      }
    }
  }

  _integrateHazardActors(hazard, dt, intervalStart) {
    const traps = (this.facade.traps ?? []).filter(({ v2HazardId }) => v2HazardId === hazard.id);
    if (!traps.length) return;
    const actors = [];
    const player = this.game?.player;
    if (player?.root?.position) {
      actors.push({
        id: 'player',
        actor: player,
        position: player.root.position,
        applyDamage: (amount, trap) => player.takeIncomingHit?.({
          amount,
          source: trap,
          guardable: false,
          reactionTier: 0,
          hazardDomain: 'environment',
          hazardTags: trap.ambientHazardTags ?? [],
          statusEffects: (trap.ambientHazardTags ?? []).some((tag) => tag.includes('magma'))
            ? ['burn']
            : [],
        }),
      });
    }
    for (const [index, enemy] of (this.game?.enemies ?? []).entries()) {
      if (enemy?.dead || !enemy?.root?.position) continue;
      actors.push({
        id: `enemy:${enemy.id ?? enemy.root.uuid ?? index}`,
        actor: enemy,
        position: enemy.root.position,
        applyDamage: (amount, trap) => this.game?.damageEnemy?.(enemy, amount, {
          source: trap,
          element: hazard.kind === 'electrical' ? 'shock' : 'fire',
          hitPosition: enemy.root.position.clone(),
        }),
      });
    }

    const liveActorKeys = new Set();
    for (const actor of actors) {
      const ledgerKey = `${hazard.id}:${actor.id}`;
      liveActorKeys.add(ledgerKey);
      const trap = traps.find((candidate) => (
        Math.abs(actor.position.x - candidate.position.x) <= candidate.halfWidth
        && Math.abs(actor.position.z - candidate.position.z) <= candidate.halfDepth
        && Math.abs(actor.position.y - candidate.position.y) <= candidate.verticalHalfHeight + 0.35
      ));
      const previous = this.hazardExposureLedger.get(ledgerKey) ?? {};
      const result = integrateHazardExposureV2(hazard, previous, {
        durationSeconds: dt,
        globalStartSeconds: intervalStart,
        inside: Boolean(trap),
      });
      const cumulativeDamage = (previous.cumulativeDamage ?? 0) + result.damage;
      const cumulativePulses = (previous.cumulativePulses ?? 0) + result.pulses;
      this.hazardExposureLedger.set(ledgerKey, {
        ...result,
        hazardId: hazard.id,
        actorId: actor.id,
        cumulativeDamage,
        cumulativePulses,
      });
      if (trap && result.damage > POSITION_EPSILON) actor.applyDamage(result.damage, trap);
      if (trap && result.pulses > 0) {
        this._recordEvent({
          type: 'hazard-exposure-pulse',
          hazardId: hazard.id,
          actorId: actor.id,
          pulses: result.pulses,
          damage: Number(result.damage.toFixed(6)),
        });
      }
    }
    for (const key of [...this.hazardExposureLedger.keys()]) {
      if (key.startsWith(`${hazard.id}:enemy:`) && !liveActorKeys.has(key)) {
        this.hazardExposureLedger.delete(key);
      }
    }
  }

  _updateRegionVisit() {
    const position = this.game?.player?.root?.position;
    if (!position) return;
    const cell = (this.plan.spatialCells ?? []).find((candidate) => (
      candidate.playable && boundsContain(candidate.bounds, position, 0.15)
    ));
    if (!cell) return;
    const previousRegionId = this.currentRegionId;
    this.currentRegionId = cell.regionId;
    this.visitedRegionIds.add(cell.regionId);
    if (previousRegionId && previousRegionId !== cell.regionId) {
      this._applyRegionTransitionEffects(previousRegionId, cell.regionId, position);
    }
  }

  _applyRegionTransitionEffects(fromRegionId, toRegionId, position) {
    const candidates = (this.plan.portals ?? []).filter((portal) => {
      const forward = portal.from?.regionId === fromRegionId && portal.to?.regionId === toRegionId;
      const reverse = portal.direction !== 'forward'
        && portal.direction !== 'forward-only'
        && portal.to?.regionId === fromRegionId
        && portal.from?.regionId === toRegionId;
      return forward || reverse;
    });
    if (!candidates.length) return;

    // A well-formed authored topology normally has one portal between a region
    // pair. If a pair has alternatives, select the route whose endpoint is
    // physically nearest to the player so metadata cannot grant traversal for
    // a different, unopened route.
    const portal = candidates.reduce((nearest, candidate) => {
      const points = [candidate.from?.center, candidate.to?.center].filter(Boolean);
      const distance = Math.min(...points.map((point) => (
        (point.x - position.x) ** 2 + (point.y - position.y) ** 2 + (point.z - position.z) ** 2
      )));
      return !nearest || distance < nearest.distance ? { candidate, distance } : nearest;
    }, null)?.candidate;
    if (!portal) return;

    for (const effect of portal.traversalEffects ?? []) {
      this._applyEffect(effect, { portalId: portal.id, traversal: true });
    }
    this.traversedPortalIds.add(portal.id);
    this._recordEvent({
      type: 'portal-traversed',
      portalId: portal.id,
      fromRegionId,
      toRegionId,
    });
  }

  _recordAnchorStructuralRayAudits() {
    if (!this._structuralRaycastTargets.length) return;
    const directions = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ];
    const anchors = new Map([
      ...(this.plan.anchors ?? []).map((anchor) => [anchor.id, anchor]),
      ...(this.plan.safeAnchors ?? []).map((anchor) => [anchor.id, anchor]),
    ]);
    for (const anchor of anchors.values()) {
      const origin = asVector3(anchor.position, `anchor ${anchor.id} structural ray origin`);
      for (const [index, direction] of directions.entries()) {
        this._recordStructuralRay({
          origin,
          direction,
          sourceType: 'plan-anchor',
          sourceId: anchor.id,
          sampleId: `axis-${index}`,
          regionId: anchor.regionId ?? null,
        });
      }
    }
  }

  _updateCameraStructuralRayAudit() {
    const camera = this.game?.camera;
    if (!camera || !this.currentRegionId || this.frameHeartbeat < 3) return;
    const position = camera.getWorldPosition?.(new THREE.Vector3()) ?? camera.position?.clone?.();
    if (!position) return;
    const movedEnough = !this._lastCameraAuditPosition
      || position.distanceToSquared(this._lastCameraAuditPosition) >= 64;
    if (!movedEnough && this._lastCameraAuditRegionId === this.currentRegionId) return;

    camera.updateMatrixWorld?.(true);
    const cameraCell = (this.plan.spatialCells ?? []).find((cell) => boundsContain(cell.bounds, position, 0.05));
    if (!cameraCell) {
      const key = `camera-origin:${this.currentRegionId}`;
      if (!this._cameraRayFailureKeys.has(key)) {
        this._cameraRayFailureKeys.add(key);
        this.errors.push({
          code: 'camera-origin-outside-closed-cell',
          regionId: this.currentRegionId,
          position: { x: position.x, y: position.y, z: position.z },
          atHeartbeat: this.frameHeartbeat,
        });
      }
    }

    this.journeyCameraPositions.push({
      regionId: this.currentRegionId,
      cellId: cameraCell?.id ?? null,
      position: { x: position.x, y: position.y, z: position.z },
      quaternion: camera.quaternion ? {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w,
      } : null,
      atHeartbeat: this.frameHeartbeat,
    });
    if (this.journeyCameraPositions.length > 512) this.journeyCameraPositions.shift();
    this.structuralRayAuditStats.cameraPositionSampleCount += 1;
    this._lastCameraAuditPosition = position;
    this._lastCameraAuditRegionId = this.currentRegionId;

    // Exact mesh raycasts are QA evidence, not gameplay. Normal V2 play keeps
    // the real journey camera poses for later offscreen proof but does not
    // recursively raycast thousands of structural meshes nine times whenever
    // the player crosses an 8m threshold. The explicit test-only URL flag
    // `v2StructuralAudit=1` restores the exact rays.
    if (!this.structuralRayAuditEnabled) return;
    this.facade.group?.updateMatrixWorld?.(true);

    const ndcSamples = [-0.86, 0, 0.86].flatMap((y) => (
      [-0.86, 0, 0.86].map((x) => ({ x, y }))
    ));
    for (const [index, ndc] of ndcSamples.entries()) {
      this._structuralRaycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
      this._recordStructuralRay({
        origin: this._structuralRaycaster.ray.origin,
        direction: this._structuralRaycaster.ray.direction,
        sourceType: 'journey-camera',
        sourceId: `heartbeat-${this.frameHeartbeat}`,
        sampleId: `frustum-${index}`,
        regionId: this.currentRegionId,
        cameraCellId: cameraCell?.id ?? null,
        ndc,
      });
    }
  }

  _recordStructuralRay({
    origin,
    direction,
    sourceType,
    sourceId,
    sampleId,
    regionId = null,
    cameraCellId = null,
    ndc = null,
  }) {
    if (!this._structuralRaycastTargets.length) return;
    this.structuralRayAuditStats.raycastCount += 1;
    const maxDistance = Math.min(120, Number(this.game?.camera?.far) || 120);
    this._structuralRaycaster.set(origin, direction.clone().normalize());
    this._structuralRaycaster.near = 0.015;
    this._structuralRaycaster.far = maxDistance;
    const intersections = this._structuralRaycaster
      .intersectObjects(this._structuralRaycastTargets, true)
      .filter((intersection) => {
        let object = intersection.object;
        while (object) {
          if (object.visible === false) return false;
          object = object.parent;
        }
        const materials = Array.isArray(intersection.object.material)
          ? intersection.object.material
          : [intersection.object.material];
        return materials.some((material) => material
          && material.transparent !== true
          && (material.opacity ?? 1) >= 0.999);
      });
    const hit = intersections[0] ?? null;
    let structuralObject = hit?.object ?? null;
    while (structuralObject && !structuralObject.userData?.v2PlanId) {
      structuralObject = structuralObject.parent;
    }
    const audit = {
      sourceType,
      sourceId,
      sampleId,
      regionId,
      cameraCellId,
      ndc,
      maxDistance,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
      clearSpace: !hit,
      hitDistance: hit?.distance ?? null,
      hitPlanId: structuralObject?.userData?.v2PlanId ?? null,
      hitRole: structuralObject?.userData?.v2StructuralRole ?? null,
      atHeartbeat: this.frameHeartbeat,
    };
    this.cameraRayAudits.push(audit);
    if (this.cameraRayAudits.length > 2048) this.cameraRayAudits.shift();
    if (!hit) {
      const key = `${sourceType}:${sourceId}:${sampleId}`;
      if (!this._cameraRayFailureKeys.has(key)) {
        this._cameraRayFailureKeys.add(key);
        this.errors.push({
          code: 'structural-ray-clear-space',
          sourceType,
          sourceId,
          sampleId,
          regionId,
          maxDistance,
          atHeartbeat: this.frameHeartbeat,
        });
      }
    }
  }

  _updateSafeAnchor() {
    const position = this.game?.player?.root?.position;
    if (!position) return;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const anchor of this.plan.safeAnchors ?? []) {
      const anchorPosition = asVector3(anchor.position);
      const distance = position.distanceToSquared(anchorPosition);
      const captureRadius = Number(anchor.captureRadius) || 3.2;
      if (distance <= captureRadius * captureRadius && distance < nearestDistance) {
        nearest = anchor;
        nearestDistance = distance;
      }
    }
    if (nearest) this.lastSafeAnchor = nearest;
  }

  _applyRecoverySafeguard() {
    const player = this.game?.player;
    const position = player?.root?.position;
    if (!position || position.y >= this.safeguardY) return;

    const anchor = this.lastSafeAnchor
      ?? (this.plan.safeAnchors ?? []).find((candidate) => candidate.purpose === 'player-start')
      ?? (this.plan.safeAnchors ?? [])[0];
    if (!anchor) {
      this.errors.push({
        code: 'physics-recovery-safeguard-missing-anchor',
        atHeartbeat: this.frameHeartbeat,
      });
      return;
    }

    const destination = asVector3(anchor.position);
    const facing = anchor.forward ? asVector3(anchor.forward, `safe anchor ${anchor.id} facing`) : null;
    const restored = player.restorePhysicsRecoveryAnchor?.({
      position: destination,
      facing,
    }) === true;
    if (!restored) {
      position.copy(destination);
      if (player.velocity?.set) player.velocity.set(0, 0, 0);
      player.clearUnsafeTraversalMotion?.();
      player.clearExternalMotion?.('physics-recovery-safeguard', this.game);
    }
    this.safeguardActivations += 1;
    const error = {
      code: 'physics-recovery-safeguard-activated',
      anchorId: anchor.id,
      atHeartbeat: this.frameHeartbeat,
    };
    this.errors.push(error);
    if (this.facade.recoverySafeguard) {
      this.facade.recoverySafeguard.activationCount = this.safeguardActivations;
    }
    this._recordEvent({ type: error.code, anchorId: anchor.id });
  }

  _conditionsPass(conditions, context) {
    return conditions.every((condition) => {
      if (!condition || condition.op === 'always') return true;
      if (condition.op === 'hasKey') {
        return context.hasKey?.(condition.keyId)
          ?? this.game?.dungeonController?.progressionManager?.hasKeycard?.(condition.keyId)
          ?? false;
      }
      if (condition.op === 'stateEquals') {
        const variableId = condition.variableId ?? '';
        const controllerId = condition.controllerId
          ?? (variableId.endsWith('.state') ? variableId.slice(0, -'.state'.length) : variableId);
        const controller = this.controllerById.get(controllerId);
        return controller
          ? controller.stateId === condition.value
          : this.variables.get(condition.variableId) === condition.value;
      }
      if (condition.op === 'gateOpen') {
        const gate = this.facade.doors?.find(({ id }) => id === condition.gateId);
        return gate?.closed === false;
      }
      if (condition.op === 'encounterComplete') {
        return this.facade.encounters?.find(({ id }) => id === condition.encounterId)?.cleared === true;
      }
      if (condition.op === 'objectiveComplete') {
        return this.facade.objectives?.find(({ id }) => id === condition.objectiveId)?.complete === true;
      }
      if (condition.op === 'rewardCollected') {
        const reward = this.facade.rewards?.find(({ id }) => id === condition.rewardId);
        return reward?.collected === true || reward?.opened === true;
      }
      if (condition.op === 'all') return this._conditionsPass(condition.conditions ?? [], context);
      if (condition.op === 'any') {
        return (condition.conditions ?? []).some((entry) => this._conditionsPass([entry], context));
      }
      return false;
    });
  }

  _validateInteraction(action, context) {
    const interaction = action.interaction ?? {};
    if (interaction.activationSide === 'system') return { ok: true };
    const anchor = this.anchorById.get(action.anchorId);
    if (!anchor) return { ok: false, reason: 'missing-action-anchor' };
    const player = context.player ?? context.game?.player ?? this.game?.player;
    const playerPosition = context.playerPosition ?? player?.root?.position;
    if (!playerPosition) return { ok: false, reason: 'missing-player-position' };
    const anchorPosition = asVector3(anchor.position, `action ${action.id} anchor`);
    const radius = Math.max(0, Number(interaction.radius) || 0);
    if (playerPosition.distanceToSquared(anchorPosition) > radius * radius) {
      return { ok: false, reason: 'outside-interaction-radius' };
    }

    const activationSide = interaction.activationSide;
    if (activationSide && activationSide !== 'either' && activationSide !== 'any') {
      const forwardSource = typeof activationSide === 'object'
        ? activationSide
        : anchor.forward;
      if (!forwardSource) return { ok: false, reason: 'missing-activation-facing' };
      const forward = asVector3(forwardSource, `action ${action.id} activation facing`).setY(0);
      const approach = playerPosition.clone().sub(anchorPosition).setY(0);
      if (forward.lengthSq() <= POSITION_EPSILON || approach.lengthSq() <= POSITION_EPSILON) {
        return { ok: false, reason: 'ambiguous-activation-side' };
      }
      forward.normalize();
      approach.normalize();
      const dot = forward.dot(approach);
      if ((activationSide === 'back' && dot > -0.1)
        || (activationSide !== 'back' && dot < 0.1)) {
        return { ok: false, reason: 'wrong-activation-side' };
      }
    }

    if (interaction.requiresLineOfSight) {
      const eye = playerPosition.clone();
      eye.y += Number(player?.collisionHeight) * 0.35 || 0.9;
      const target = anchorPosition.clone();
      target.y += 0.8;
      let clear;
      if (typeof context.hasLineOfSight === 'function') {
        clear = context.hasLineOfSight(eye, target, action);
      } else if (typeof context.controller?.isAerialPathClear === 'function') {
        clear = context.controller.isAerialPathClear(eye, target, {
          radius: 0.04,
          verticalRadius: 0.04,
          ignoreAirspace: true,
        });
      }
      if (clear !== true) return { ok: false, reason: 'line-of-sight-blocked' };
    }
    return { ok: true };
  }

  _applyEffect(effect, context) {
    if (!effect) return;
    if (effect.op === 'setState') {
      const controller = this.controllerById.get(effect.controllerId ?? effect.variableId);
      if (controller?.states.has(effect.value)) {
        this.applyMechanismStableState(controller.id, effect.value, {
          source: context.actionId ?? 'set-state-effect',
        });
      } else if (effect.variableId === 'waterConfiguration') {
        this.setWaterConfiguration(effect.value, { actionId: context.actionId });
      } else {
        this.variables.set(effect.variableId, effect.value);
      }
    } else if (effect.op === 'setWaterState') {
      this.setWaterConfiguration(effect.stateId ?? effect.value, {
        actionId: context.actionId,
        controllerId: context.actionControllerId,
      });
    } else if (effect.op === 'setMechanismState') {
      const controller = this.controllerById.get(effect.mechanismId ?? effect.controllerId);
      const stateId = effect.stateId ?? effect.value;
      if (this.water?.transfer
        && controller?.id === this.water.transfer.controllerId
        && stateId === this.water.transfer.toConfigurationId) {
        return;
      }
      if (controller instanceof AutomaticTransitControllerV2
        && controller.id === context.actionControllerId
        && controller.targetStateId === stateId) {
        return;
      }
      if (controller?.states.has(stateId)) {
        this.applyMechanismStableState(controller.id, stateId, {
          source: context.actionId ?? 'set-mechanism-state-effect',
        });
      }
    } else if (effect.op === 'openGate') {
      const gate = this.facade.doors?.find(({ id }) => id === effect.gateId);
      if (gate) {
        if (typeof gate.setOpen === 'function') gate.setOpen(true);
        else {
          gate.closed = false;
          gate.locked = false;
          gate.opened = true;
        }
      }
    } else if (effect.op === 'grantKey') {
      context.grantKey?.(effect.keyId);
    } else if (effect.op === 'completeEncounter') {
      const encounter = this.facade.encounters?.find(({ id }) => id === effect.encounterId);
      if (encounter) encounter.cleared = true;
    } else if (effect.op === 'objectiveComplete' || effect.op === 'completeObjective') {
      const objective = this.facade.objectives?.find(({ id }) => id === effect.objectiveId);
      if (objective) objective.complete = true;
    } else if (effect.op === 'collectReward') {
      const reward = this.facade.rewards?.find(({ id }) => id === effect.rewardId);
      if (reward) reward.collected = true;
    } else if (effect.op === 'collectRefractor') {
      if (this.facade.shrine) this.facade.shrine.collected = true;
    } else if (effect.op === 'discoverRegion') {
      this.visitedRegionIds.add(effect.regionId);
    } else if (effect.op === 'extract') {
      this.markExtracted();
    }
  }

  _syncExternalCompletionState() {
    if (this.game?.ruinCompleted && this.facade.shrine?.collected) this.extracted ||= false;
  }

  _syncSystemObjectiveActions() {
    for (const action of this.actionById.values()) {
      if (action.type !== 'objective-complete'
        || action.interaction?.activationSide !== 'system'
        || this.operatedActionIds.has(action.id)
        || !this._conditionsPass(action.conditions ?? [], {})) {
        continue;
      }
      for (const effect of action.effects ?? []) {
        this._applyEffect(effect, { actionId: action.id, system: true });
      }
      this.operatedActionIds.add(action.id);
      this._recordEvent({ type: 'system-action-activated', actionId: action.id });
    }
  }

  _syncConditionalRewardVisibility() {
    for (const reward of this.facade.rewards ?? []) {
      const object = reward.object;
      if (object?.userData?.v2CollisionPolicy !== 'nonblocking-pickup') continue;
      const action = this.actionById.get(reward.actionId);
      const available = !action || this._conditionsPass(action.conditions ?? [], {});
      reward.available = available;
      // Credential pedestals are permanent exploration landmarks. Ordinary
      // cards have no hidden state prerequisites and must never wink out before
      // the player physically reaches and collects them.
      const persistentKeycard = (reward.type ?? reward.kind) === 'keycard'
        && reward.keycardId !== 'Shrine_Key';
      object.visible = (persistentKeycard || available)
        && reward.collected !== true
        && reward.opened !== true;
    }
  }

  _recordEvent(event) {
    this.eventLog.push({
      sequence: this.eventLog.length + 1,
      heartbeat: this.frameHeartbeat,
      elapsed: Number(this.elapsed.toFixed(4)),
      ...copyPlain(event),
    });
    if (this.eventLog.length > 2048) this.eventLog.splice(0, this.eventLog.length - 2048);
  }

  _installDiagnosticsBridge() {
    if (typeof window === 'undefined') return;
    const runtime = this;
    this._diagnosticsBridge = Object.freeze({
      snapshot(options = undefined) {
        return runtime.getDiagnostics(options?.profile ?? options ?? 'full');
      },
      heartbeat() {
        return Number(runtime.game?.frameHeartbeat) || runtime.frameHeartbeat;
      },
    });
    Object.defineProperty(window, '__RUINDIVEX_V2_DIAGNOSTICS__', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: this._diagnosticsBridge,
    });
  }
}
