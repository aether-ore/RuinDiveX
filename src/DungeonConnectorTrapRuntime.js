const DEFAULT_PATROL_SPEED_METERS_PER_SECOND = 0.7;
const DEFAULT_ALERT_SPEED_METERS_PER_SECOND = 3.2;
const DEFAULT_SPIN_RADIANS_PER_SECOND = 3.2;
const DEFAULT_DAMAGE = 12;
const DEFAULT_REACTION_TIER = 2;
const DEFAULT_PUSH_STRENGTH = 0.72;
const DEFAULT_REARM_SECONDS = 0.8;
const DEFAULT_HIT_RADIUS_METERS = 1.1;
// The supplied model's rotating head is authored around y=0.975 while the
// ceiling mount terminates at y=150.35. After the 2.2 m diameter normalization
// this is the head-center offset from the moving ceiling carrier.
const DEFAULT_CONTACT_OFFSET_METERS = Object.freeze({ x: 0, y: -6.165572557081793, z: 0 });
const DEFAULT_PLAYER_RADIUS_METERS = 0.42;
const DEFAULT_PLAYER_HEIGHT_METERS = 2.85;
const ENDPOINT_EPSILON = 0.0000001;
const MAX_EXPLICIT_SWEEP_SEGMENTS = 128;
const TAU = Math.PI * 2;

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function positiveOr(value, fallback) {
  return Math.max(ENDPOINT_EPSILON, finiteOr(value, fallback));
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function pointFrom(source, fallback = null) {
  if (!source || typeof source !== 'object') return fallback;
  const x = Number(source.x);
  const y = Number(source.y);
  const z = Number(source.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : fallback;
}

function clonePoint(point) {
  return { x: point.x, y: point.y, z: point.z };
}

function addPoints(first, second) {
  return {
    x: first.x + second.x,
    y: first.y + second.y,
    z: first.z + second.z,
  };
}

function subtract(first, second) {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z,
  };
}

function addScaled(origin, direction, distance) {
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
    z: origin.z + direction.z * distance,
  };
}

function dot(first, second) {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function lengthSquared(vector) {
  return dot(vector, vector);
}

function distanceSquared(first, second) {
  return lengthSquared(subtract(first, second));
}

function normalizeDirection(value) {
  if (Number(value) < 0) return -1;
  const label = String(value ?? '').trim().toLowerCase();
  if (['reverse', 'backward', 'towardstart', 'toward-start', 'start', 'left'].includes(label)) {
    return -1;
  }
  return 1;
}

function getDescriptorList(source) {
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.connectorTrackTraps)) return source.connectorTrackTraps;
  if (Array.isArray(source?.trackTraps)) return source.trackTraps;
  return [];
}

function getTrackEndpoints(descriptor) {
  const endpointList = Array.isArray(descriptor?.endpoints) ? descriptor.endpoints : null;
  const start = pointFrom(
    descriptor?.trackStart
      ?? descriptor?.track?.start
      ?? descriptor?.start
      ?? endpointList?.[0],
  );
  const end = pointFrom(
    descriptor?.trackEnd
      ?? descriptor?.track?.end
      ?? descriptor?.end
      ?? endpointList?.[1],
  );
  return { start, end };
}

function containsAxisAlignedVolume(volume, point) {
  if (!volume || !point) return false;
  const minimum = pointFrom(volume.min ?? volume.minimum);
  const maximum = pointFrom(volume.max ?? volume.maximum);
  if (minimum && maximum) {
    return point.x >= Math.min(minimum.x, maximum.x)
      && point.x <= Math.max(minimum.x, maximum.x)
      && point.y >= Math.min(minimum.y, maximum.y)
      && point.y <= Math.max(minimum.y, maximum.y)
      && point.z >= Math.min(minimum.z, maximum.z)
      && point.z <= Math.max(minimum.z, maximum.z);
  }

  const center = pointFrom(volume.center);
  if (!center) return false;
  const halfSize = pointFrom(volume.halfSize ?? volume.halfExtents, {
    x: Math.max(0, finiteOr(volume.halfWidth, 0)),
    y: Math.max(0, finiteOr(volume.halfHeight, 0)),
    z: Math.max(0, finiteOr(volume.halfDepth, 0)),
  });
  return Math.abs(point.x - center.x) <= Math.max(0, halfSize.x)
    && Math.abs(point.y - center.y) <= Math.max(0, halfSize.y)
    && Math.abs(point.z - center.z) <= Math.max(0, halfSize.z);
}

function closestSegmentDistanceSquared(firstStart, firstEnd, secondStart, secondEnd) {
  const firstDelta = subtract(firstEnd, firstStart);
  const secondDelta = subtract(secondEnd, secondStart);
  const originDelta = subtract(firstStart, secondStart);
  const firstLengthSquared = lengthSquared(firstDelta);
  const secondLengthSquared = lengthSquared(secondDelta);
  const firstSecondDot = dot(firstDelta, secondDelta);
  const firstOriginDot = dot(firstDelta, originDelta);
  const secondOriginDot = dot(secondDelta, originDelta);
  const epsilon = 0.000000001;
  let firstRatio = 0;
  let secondRatio = 0;

  if (firstLengthSquared <= epsilon && secondLengthSquared <= epsilon) {
    return distanceSquared(firstStart, secondStart);
  }
  if (firstLengthSquared <= epsilon) {
    secondRatio = clamp(secondOriginDot / secondLengthSquared, 0, 1);
  } else if (secondLengthSquared <= epsilon) {
    firstRatio = clamp(-firstOriginDot / firstLengthSquared, 0, 1);
  } else {
    const denominator = firstLengthSquared * secondLengthSquared
      - firstSecondDot * firstSecondDot;
    if (denominator > epsilon) {
      firstRatio = clamp(
        (firstSecondDot * secondOriginDot - firstOriginDot * secondLengthSquared) / denominator,
        0,
        1,
      );
    }
    secondRatio = (firstSecondDot * firstRatio + secondOriginDot) / secondLengthSquared;
    if (secondRatio < 0) {
      secondRatio = 0;
      firstRatio = clamp(-firstOriginDot / firstLengthSquared, 0, 1);
    } else if (secondRatio > 1) {
      secondRatio = 1;
      firstRatio = clamp((firstSecondDot - firstOriginDot) / firstLengthSquared, 0, 1);
    }
  }

  const firstPoint = addScaled(firstStart, firstDelta, firstRatio);
  const secondPoint = addScaled(secondStart, secondDelta, secondRatio);
  return distanceSquared(firstPoint, secondPoint);
}

/**
 * Advances a scalar position on a reflected [0, length] track. The returned
 * sweep segments retain the direction used before each physical end-stop, so
 * collision response never inherits a post-bounce direction accidentally.
 */
export function advanceReflectedTrack({
  position,
  direction,
  distance,
  length,
}) {
  const resolvedLength = positiveOr(length, 1);
  const startPosition = clamp(finiteOr(position, 0), 0, resolvedLength);
  const startDirection = normalizeDirection(direction);
  const travelDistance = Math.max(0, finiteOr(distance, 0));
  if (travelDistance <= ENDPOINT_EPSILON) {
    return {
      position: startPosition,
      direction: startDirection,
      bounceCount: 0,
      fullTrackCovered: false,
      segments: [{ start: startPosition, end: startPosition, direction: startDirection }],
    };
  }

  const estimatedSegments = Math.ceil(travelDistance / resolvedLength) + 2;
  const unfolded = startPosition + startDirection * travelDistance;
  const phase = modulo(unfolded, resolvedLength * 2);
  const finalPosition = phase <= resolvedLength ? phase : resolvedLength * 2 - phase;
  const finalDirection = Math.abs(phase - resolvedLength) <= ENDPOINT_EPSILON
    ? -1
    : phase <= ENDPOINT_EPSILON
      ? 1
      : phase < resolvedLength
        ? 1
        : -1;

  if (estimatedSegments > MAX_EXPLICIT_SWEEP_SEGMENTS) {
    return {
      position: finalPosition,
      direction: finalDirection,
      bounceCount: Math.max(1, Math.floor(travelDistance / resolvedLength)),
      fullTrackCovered: true,
      segments: [{ start: 0, end: resolvedLength, direction: startDirection }],
    };
  }

  const segments = [];
  let currentPosition = startPosition;
  let currentDirection = startDirection;
  let remaining = travelDistance;
  let bounceCount = 0;
  while (remaining > ENDPOINT_EPSILON) {
    const distanceToEndpoint = currentDirection > 0
      ? resolvedLength - currentPosition
      : currentPosition;
    if (distanceToEndpoint <= ENDPOINT_EPSILON) {
      currentDirection *= -1;
      bounceCount += 1;
      continue;
    }
    const consumed = Math.min(remaining, distanceToEndpoint);
    const nextPosition = currentPosition + currentDirection * consumed;
    segments.push({
      start: currentPosition,
      end: clamp(nextPosition, 0, resolvedLength),
      direction: currentDirection,
    });
    currentPosition = clamp(nextPosition, 0, resolvedLength);
    remaining -= consumed;
    if (consumed + ENDPOINT_EPSILON >= distanceToEndpoint) {
      currentDirection *= -1;
      bounceCount += 1;
    }
  }

  return {
    position: currentPosition,
    direction: currentDirection,
    bounceCount,
    fullTrackCovered: false,
    segments,
  };
}

export function sweptTrapIntersectsPlayer({
  sweepStart,
  sweepEnd,
  playerRoot,
  trapRadius = DEFAULT_HIT_RADIUS_METERS,
  playerRadius = DEFAULT_PLAYER_RADIUS_METERS,
  playerHeight = DEFAULT_PLAYER_HEIGHT_METERS,
}) {
  const root = pointFrom(playerRoot);
  const start = pointFrom(sweepStart);
  const end = pointFrom(sweepEnd);
  if (!root || !start || !end) return false;
  const resolvedPlayerRadius = Math.max(0, finiteOr(playerRadius, DEFAULT_PLAYER_RADIUS_METERS));
  const resolvedPlayerHeight = Math.max(
    resolvedPlayerRadius * 2,
    finiteOr(playerHeight, DEFAULT_PLAYER_HEIGHT_METERS),
  );
  const capsuleStart = {
    x: root.x,
    y: root.y + resolvedPlayerRadius,
    z: root.z,
  };
  const capsuleEnd = {
    x: root.x,
    y: root.y + resolvedPlayerHeight - resolvedPlayerRadius,
    z: root.z,
  };
  const combinedRadius = Math.max(0, finiteOr(trapRadius, DEFAULT_HIT_RADIUS_METERS))
    + resolvedPlayerRadius;
  return closestSegmentDistanceSquared(start, end, capsuleStart, capsuleEnd)
    <= combinedRadius * combinedRadius;
}

function makeTrackSegmentWorld(state, segment) {
  return {
    start: addPoints(
      addScaled(state.trackStart, state.trackUnit, segment.start),
      state.contactOffsetMeters,
    ),
    end: addPoints(
      addScaled(state.trackStart, state.trackUnit, segment.end),
      state.contactOffsetMeters,
    ),
    direction: segment.direction,
  };
}

function isResolvedContact(result) {
  if (result == null) return false;
  if (typeof result === 'number') return result > 0;
  return Boolean(result.contacted && !result.dodged && !result.immune);
}

function didDodge(result) {
  return Boolean(result && typeof result === 'object' && result.dodged);
}

/**
 * Mutable runtime for plan-owned rotating ceiling-track traps. Descriptors are
 * read-only serializable records; visual objects and combat state never enter
 * the accepted dungeon plan.
 */
export class DungeonConnectorTrapRuntime {
  constructor(game = null, source = [], options = {}) {
    this.game = game;
    this.source = source;
    this.visualFactory = options.visualFactory ?? null;
    this.visualRoot = options.visualRoot ?? null;
    this.ownsVisualFactory = options.ownsVisualFactory === true;
    this.traps = [];
    this.trapById = new Map();
    this.invalidDescriptors = [];
    this.mounted = false;
    this.disposed = false;
    this.elapsedSeconds = 0;
    this.totalContactAttempts = 0;
    this.totalResolvedHits = 0;
    this.totalDodges = 0;
    this.mountGeneration = 0;
    this.visualAcceptanceRequired = false;
    this.visualAcceptancePassed = null;
    this.visualAcceptanceErrors = [];
    this.visualReadyPromise = Promise.resolve([]);
    this.reset(source);
  }

  _createTrapState(descriptor, index) {
    if (!descriptor || typeof descriptor !== 'object') {
      this.invalidDescriptors.push({ index, reason: 'descriptor-not-object' });
      return null;
    }
    const id = String(descriptor.id ?? `connector-track-trap-${index}`);
    const { start, end } = getTrackEndpoints(descriptor);
    if (!start || !end) {
      this.invalidDescriptors.push({ id, index, reason: 'missing-track-endpoints' });
      return null;
    }
    const delta = subtract(end, start);
    const trackLength = Math.sqrt(lengthSquared(delta));
    if (trackLength <= ENDPOINT_EPSILON) {
      this.invalidDescriptors.push({ id, index, reason: 'zero-length-track' });
      return null;
    }
    const trackUnit = {
      x: delta.x / trackLength,
      y: delta.y / trackLength,
      z: delta.z / trackLength,
    };
    const initialRatio = clamp(finiteOr(descriptor.initialTrackRatio, 0), 0, 1);
    const currentTrackDistance = clamp(
      finiteOr(descriptor.currentTrackDistance, initialRatio * trackLength),
      0,
      trackLength,
    );
    const currentDirection = normalizeDirection(descriptor.initialDirection);
    const warningVolume = descriptor.warningVolume
      ?? descriptor.activationVolume
      ?? descriptor.trackArea
      ?? null;

    return {
      id,
      descriptor,
      trackStart: start,
      trackEnd: end,
      trackUnit,
      trackLength,
      currentTrackDistance,
      currentDirection,
      currentPosition: addScaled(start, trackUnit, currentTrackDistance),
      contactOffsetMeters: pointFrom(
        descriptor.contactOffsetMeters ?? descriptor.contactOffset,
        DEFAULT_CONTACT_OFFSET_METERS,
      ),
      warningVolume,
      patrolSpeedMetersPerSecond: positiveOr(
        descriptor.patrolSpeedMetersPerSecond,
        DEFAULT_PATROL_SPEED_METERS_PER_SECOND,
      ),
      alertSpeedMetersPerSecond: positiveOr(
        descriptor.alertSpeedMetersPerSecond,
        DEFAULT_ALERT_SPEED_METERS_PER_SECOND,
      ),
      spinRadiansPerSecond: finiteOr(
        descriptor.spinRadiansPerSecond,
        DEFAULT_SPIN_RADIANS_PER_SECOND,
      ),
      spinRadians: modulo(finiteOr(descriptor.initialSpinRadians, 0), TAU),
      hitRadiusMeters: positiveOr(descriptor.hitRadiusMeters, DEFAULT_HIT_RADIUS_METERS),
      damage: Math.max(0, finiteOr(descriptor.damage, DEFAULT_DAMAGE)),
      reactionTier: clamp(
        Math.trunc(finiteOr(descriptor.reactionTier, DEFAULT_REACTION_TIER)),
        0,
        3,
      ),
      pushStrength: Math.max(0, finiteOr(descriptor.pushStrength, DEFAULT_PUSH_STRENGTH)),
      rearmSeconds: Math.max(0, finiteOr(descriptor.rearmSeconds, DEFAULT_REARM_SECONDS)),
      cooldownRemaining: 0,
      alerted: false,
      speedMetersPerSecond: 0,
      bounceCount: 0,
      distanceTravelledMeters: 0,
      contactAttempts: 0,
      resolvedHits: 0,
      dodges: 0,
      visualObject: null,
      visualAttached: false,
      visualReady: false,
      visualError: null,
    };
  }

  reset(source = this.source) {
    if (this.disposed) return false;
    const remount = this.mounted;
    if (remount) this.unmount();
    this.source = source;
    this.invalidDescriptors = [];
    this.visualAcceptanceRequired = false;
    this.visualAcceptancePassed = null;
    this.visualAcceptanceErrors = [];
    this.traps = getDescriptorList(source)
      .map((descriptor, index) => this._createTrapState(descriptor, index))
      .filter(Boolean);
    this.trapById = new Map(this.traps.map((trap) => [trap.id, trap]));
    if (remount) this.mount(this.game, {
      visualFactory: this.visualFactory,
      visualRoot: this.visualRoot,
    });
    this._publishFacadeDiagnostics();
    return true;
  }

  _publishFacadeDiagnostics() {
    if (!this.source || Array.isArray(this.source) || typeof this.source !== 'object') return;
    // Keep the compatibility facade useful to diagnostics consumers without
    // leaking this mutable runtime (or its Game reference) into the facade.
    // Each publication is a deeply detached/frozen value from getDiagnostics.
    this.source.connectorTrackTrapRuntimeDiagnostics = this.getDiagnostics();
  }

  mount(game = this.game, options = {}) {
    if (this.disposed) return false;
    if (game) this.game = game;
    if (options.visualFactory) this.visualFactory = options.visualFactory;
    if (options.visualRoot) this.visualRoot = options.visualRoot;
    if (this.mounted) return true;
    this.mounted = true;
    const generation = ++this.mountGeneration;
    const factory = this.visualFactory;
    if (!factory?.createInstance) {
      this.visualAcceptanceRequired = false;
      this.visualAcceptancePassed = null;
      this.visualAcceptanceErrors = [];
      this.visualReadyPromise = Promise.resolve([]);
      this._publishFacadeDiagnostics();
      return true;
    }

    this.visualAcceptanceRequired = true;
    this.visualAcceptancePassed = null;
    this.visualAcceptanceErrors = [];
    this.visualReadyPromise = Promise.all(this.traps.map(async (trap) => {
      try {
        const visual = await factory.createInstance(trap.descriptor);
        if (!visual) throw new Error('visual-factory-returned-no-object');
        if (this.disposed || !this.mounted || generation !== this.mountGeneration) {
          factory.releaseInstance?.(visual);
          return null;
        }
        trap.visualObject = visual;
        trap.visualReady = true;
        this.visualRoot?.add?.(visual);
        trap.visualAttached = Boolean(visual.parent === this.visualRoot || !this.visualRoot);
        if (!trap.visualAttached) {
          throw new Error('visual-not-attached-to-active-dungeon-root');
        }
        this._syncVisual(trap);
        return visual;
      } catch (error) {
        trap.visualError = String(error?.message ?? error);
        this._releaseVisual(trap);
        return null;
      }
    })).then((visuals) => {
      // Disposal/unmount intentionally cancels late attachments. That is a
      // lifecycle outcome, not an asset-acceptance failure for a dead world.
      if (this.disposed || !this.mounted || generation !== this.mountGeneration) {
        this.visualAcceptancePassed = null;
        this.visualAcceptanceErrors = [];
        return visuals;
      }
      this.visualAcceptanceErrors = this.traps
        .filter((trap) => !this._isVisualActive(trap) || trap.visualError)
        .map((trap) => Object.freeze({
          id: trap.id,
          reason: trap.visualError
            ?? (trap.visualReady ? 'visual-not-attached-to-active-dungeon-root' : 'visual-not-ready'),
        }));
      this.visualAcceptancePassed = this.visualAcceptanceErrors.length === 0;
      this._publishFacadeDiagnostics();
      return visuals;
    });
    this._publishFacadeDiagnostics();
    return true;
  }

  whenVisualsReady({ requireVisualAcceptance = true } = {}) {
    return this.visualReadyPromise.then((visuals) => {
      if (requireVisualAcceptance
        && this.visualAcceptanceRequired
        && this.visualAcceptancePassed === false) {
        const detail = this.visualAcceptanceErrors
          .map(({ id, reason }) => `${id}:${reason}`)
          .join(',');
        throw new Error(`connector-track-trap-visual-acceptance-failed:${detail}`);
      }
      return visuals;
    });
  }

  _releaseVisual(trap) {
    if (!trap.visualObject) return;
    trap.visualObject.parent?.remove?.(trap.visualObject);
    this.visualFactory?.releaseInstance?.(trap.visualObject);
    trap.visualObject = null;
    trap.visualAttached = false;
    trap.visualReady = false;
  }

  unmount() {
    if (!this.mounted) return false;
    this.mounted = false;
    this.mountGeneration += 1;
    for (const trap of this.traps) this._releaseVisual(trap);
    this._publishFacadeDiagnostics();
    return true;
  }

  _getPlayerPosition() {
    return pointFrom(this.game?.player?.root?.position);
  }

  _isAlerted(trap, playerPosition) {
    if (!playerPosition || !trap.warningVolume) return false;
    return containsAxisAlignedVolume(trap.warningVolume, playerPosition);
  }

  _syncVisual(trap) {
    const visual = trap.visualObject;
    if (!visual) return;
    if (visual.position?.set) {
      visual.position.set(
        trap.currentPosition.x,
        trap.currentPosition.y,
        trap.currentPosition.z,
      );
    } else if (visual.position) {
      Object.assign(visual.position, trap.currentPosition);
    }
    const rotor = visual.userData?.rotatingTrapRotor ?? visual;
    if (rotor.rotation) rotor.rotation.y = trap.spinRadians;
    visual.updateMatrixWorld?.(true);
    trap.visualAttached = Boolean(visual.parent === this.visualRoot || !this.visualRoot);
  }

  _isVisualActive(trap) {
    if (!trap?.visualReady || !trap.visualAttached || !trap.visualObject || trap.visualError) {
      return false;
    }
    return !this.visualRoot || trap.visualObject.parent === this.visualRoot;
  }

  _applyContact(trap, worldSegment, playerPosition) {
    if (trap.cooldownRemaining > ENDPOINT_EPSILON) return false;
    // Never leave an invisible damaging hazard behind while its supplied OBJ
    // is loading or after an asset failure. Analytic patrol state continues so
    // diagnostics remain reproducible, but contact is accepted only once the
    // corresponding visible rotor has been mounted.
    if (this.visualAcceptanceRequired && !this._isVisualActive(trap)) return false;
    const player = this.game?.player;
    if (!player || player.dead || !playerPosition) return false;
    const intersects = sweptTrapIntersectsPlayer({
      sweepStart: worldSegment.start,
      sweepEnd: worldSegment.end,
      playerRoot: playerPosition,
      trapRadius: trap.hitRadiusMeters,
      playerRadius: player.radius,
      playerHeight: player.collisionHeight ?? player.height,
    });
    if (!intersects) return false;

    const pushDirection = {
      x: trap.trackUnit.x * worldSegment.direction,
      y: 0,
      z: trap.trackUnit.z * worldSegment.direction,
    };
    const horizontalLength = Math.hypot(pushDirection.x, pushDirection.z);
    if (horizontalLength > ENDPOINT_EPSILON) {
      pushDirection.x /= horizontalLength;
      pushDirection.z /= horizontalLength;
    }
    const source = {
      id: trap.id,
      kind: 'rotatingCeilingTrackTrap',
      position: addPoints(trap.currentPosition, trap.contactOffsetMeters),
    };
    const damageContext = {
      amount: trap.damage,
      source,
      attackKind: 'rotatingCeilingTrackTrap',
      direction: pushDirection,
      knockbackDirection: pushDirection,
      guardable: false,
      unblockable: true,
      reactionTier: trap.reactionTier,
      knockbackStrength: trap.pushStrength,
      hazardTags: ['mechanical', 'rotating-track-trap'],
      hazardDomain: 'dungeon-environment',
    };
    const result = typeof player.takeIncomingHit === 'function'
      ? player.takeIncomingHit(damageContext)
      : player.takeDamage?.(trap.damage, source, damageContext);

    trap.cooldownRemaining = trap.rearmSeconds;
    trap.contactAttempts += 1;
    this.totalContactAttempts += 1;
    if (didDodge(result)) {
      trap.dodges += 1;
      this.totalDodges += 1;
    }
    if (isResolvedContact(result)) {
      trap.resolvedHits += 1;
      this.totalResolvedHits += 1;
    }
    return true;
  }

  _updateTrap(trap, dt, playerPosition) {
    trap.cooldownRemaining = Math.max(0, trap.cooldownRemaining - dt);
    trap.alerted = this._isAlerted(trap, playerPosition);
    trap.speedMetersPerSecond = trap.alerted
      ? trap.alertSpeedMetersPerSecond
      : trap.patrolSpeedMetersPerSecond;
    const travelDistance = trap.speedMetersPerSecond * dt;
    const motion = advanceReflectedTrack({
      position: trap.currentTrackDistance,
      direction: trap.currentDirection,
      distance: travelDistance,
      length: trap.trackLength,
    });
    trap.currentTrackDistance = motion.position;
    trap.currentDirection = motion.direction;
    trap.currentPosition = addScaled(trap.trackStart, trap.trackUnit, motion.position);
    trap.spinRadians = modulo(trap.spinRadians + trap.spinRadiansPerSecond * dt, TAU);
    trap.bounceCount += motion.bounceCount;
    trap.distanceTravelledMeters += travelDistance;

    for (const segment of motion.segments) {
      if (this._applyContact(trap, makeTrackSegmentWorld(trap, segment), playerPosition)) break;
    }
    this._syncVisual(trap);
  }

  prePlayerUpdate(dt, game = this.game) {
    if (this.disposed || !this.mounted) return false;
    if (game) this.game = game;
    const delta = Math.max(0, finiteOr(dt, 0));
    this.elapsedSeconds += delta;
    const playerPosition = this._getPlayerPosition();
    for (const trap of this.traps) this._updateTrap(trap, delta, playerPosition);
    this._publishFacadeDiagnostics();
    return true;
  }

  getDiagnostics() {
    return Object.freeze({
      mounted: this.mounted,
      disposed: this.disposed,
      elapsedSeconds: this.elapsedSeconds,
      trapCount: this.traps.length,
      invalidDescriptorCount: this.invalidDescriptors.length,
      invalidDescriptors: Object.freeze(this.invalidDescriptors.map((entry) => Object.freeze({ ...entry }))),
      visualAcceptanceRequired: this.visualAcceptanceRequired,
      visualAcceptancePassed: this.visualAcceptancePassed,
      visualAcceptanceErrors: Object.freeze(
        this.visualAcceptanceErrors.map((entry) => Object.freeze({ ...entry })),
      ),
      totalContactAttempts: this.totalContactAttempts,
      totalResolvedHits: this.totalResolvedHits,
      totalDodges: this.totalDodges,
      traps: Object.freeze(this.traps.map((trap) => Object.freeze({
        id: trap.id,
        trackLength: trap.trackLength,
        currentTrackDistance: trap.currentTrackDistance,
        currentDirection: trap.currentDirection,
        currentPosition: Object.freeze(clonePoint(trap.currentPosition)),
        contactPosition: Object.freeze(addPoints(trap.currentPosition, trap.contactOffsetMeters)),
        alerted: trap.alerted,
        speedMetersPerSecond: trap.speedMetersPerSecond,
        spinRadians: trap.spinRadians,
        cooldownRemaining: trap.cooldownRemaining,
        bounceCount: trap.bounceCount,
        distanceTravelledMeters: trap.distanceTravelledMeters,
        contactAttempts: trap.contactAttempts,
        resolvedHits: trap.resolvedHits,
        dodges: trap.dodges,
        visualReady: trap.visualReady,
        visualAttached: trap.visualAttached,
        visualError: trap.visualError,
        damageEnabled: !this.visualAcceptanceRequired || this._isVisualActive(trap),
      }))),
    });
  }

  dispose() {
    if (this.disposed) return false;
    this.unmount();
    this.disposed = true;
    if (this.ownsVisualFactory) this.visualFactory?.dispose?.();
    this._publishFacadeDiagnostics();
    this.game = null;
    this.visualRoot = null;
    this.trapById.clear();
    return true;
  }
}

export function createDungeonConnectorTrapRuntime(game, source, options = {}) {
  return new DungeonConnectorTrapRuntime(game, source, options);
}

export const DUNGEON_CONNECTOR_TRAP_RUNTIME_DEFAULTS = Object.freeze({
  patrolSpeedMetersPerSecond: DEFAULT_PATROL_SPEED_METERS_PER_SECOND,
  alertSpeedMetersPerSecond: DEFAULT_ALERT_SPEED_METERS_PER_SECOND,
  spinRadiansPerSecond: DEFAULT_SPIN_RADIANS_PER_SECOND,
  damage: DEFAULT_DAMAGE,
  reactionTier: DEFAULT_REACTION_TIER,
  pushStrength: DEFAULT_PUSH_STRENGTH,
  rearmSeconds: DEFAULT_REARM_SECONDS,
  hitRadiusMeters: DEFAULT_HIT_RADIUS_METERS,
  contactOffsetMeters: DEFAULT_CONTACT_OFFSET_METERS,
});
