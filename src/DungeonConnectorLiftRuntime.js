const DEFAULT_SPEED_METERS_PER_SECOND = 1.8;
const DEFAULT_DWELL_SECONDS = 1.25;
const ENDPOINT_EPSILON = 0.0001;
const RIDER_VERTICAL_TOLERANCE = 0.24;
const MAX_UPDATE_STEPS = 32;

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint ?? '').trim().toLowerCase();
  if (value === 'bottom' || value === 'lower' || value === 'down') return 'bottom';
  if (value === 'top' || value === 'upper' || value === 'up') return 'top';
  return null;
}

function getDescriptorList(source) {
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.connectorLifts)) return source.connectorLifts;
  if (Array.isArray(source?.lifts)) return source.lifts;
  return [];
}

function setDescriptorField(descriptor, key, value) {
  try {
    descriptor[key] = value;
  } catch {
    // Runtime mirrors are optional. Immutable plan records remain untouched;
    // the authoritative mutable value always lives in the runtime state.
  }
}

function containsSurfaceTop(surface, position, margin = 0.06) {
  if (!surface || !position || surface.enabled === false) return false;
  if (typeof surface.containsTop === 'function') {
    return Boolean(surface.containsTop(position, margin));
  }
  const center = surface.center;
  if (!center) return false;
  const halfWidth = Math.max(0, finiteOr(surface.halfWidth, 0));
  const halfDepth = Math.max(0, finiteOr(surface.halfDepth, 0));
  return Math.abs(position.x - center.x) <= halfWidth + margin
    && Math.abs(position.z - center.z) <= halfDepth + margin;
}

/**
 * Runtime for connector-local automatic cargo lifts.
 *
 * Dungeon generation owns the lift geometry and serializable traversal
 * contract. This class owns only mutable motion state and the registration of
 * each platform as a dynamic player-support surface.
 */
export class DungeonConnectorLiftRuntime {
  constructor(game = null, source = []) {
    this.game = game;
    this.source = source;
    this.lifts = [];
    this.liftById = new Map();
    this.controlById = new Map();
    this.mounted = false;
    this.disposed = false;
    this.elapsedSeconds = 0;
    this.totalRequests = 0;
    this.invalidRequestCount = 0;
    this.reset(source, { preserveElevation: true });
  }

  _createLiftState(descriptor, index, { preserveElevation = true } = {}) {
    if (!descriptor || typeof descriptor !== 'object') return null;
    const id = String(descriptor.id ?? `connector-lift-${index}`);
    const surface = descriptor.surface;
    const platformObject = descriptor.platformObject ?? descriptor.object ?? null;
    const rawBottom = finiteOr(descriptor.bottomElevation, finiteOr(surface?.topY, 0));
    const rawTop = finiteOr(descriptor.topElevation, rawBottom);
    const bottomElevation = Math.min(rawBottom, rawTop);
    const topElevation = Math.max(rawBottom, rawTop);
    if (!surface || topElevation - bottomElevation <= ENDPOINT_EPSILON) return null;

    const initialElevation = preserveElevation
      ? finiteOr(descriptor.currentElevation, finiteOr(surface.topY, bottomElevation))
      : finiteOr(descriptor.initialElevation, bottomElevation);
    const currentElevation = clamp(initialElevation, bottomElevation, topElevation);
    const atBottom = Math.abs(currentElevation - bottomElevation) <= ENDPOINT_EPSILON;
    const atTop = Math.abs(currentElevation - topElevation) <= ENDPOINT_EPSILON;
    const requestedEndpoint = normalizeEndpoint(descriptor.requestedEndpoint);
    const initialDirection = String(descriptor.initialDirection ?? '').toLowerCase();
    const persistedPhase = String(descriptor.phase ?? '').toLowerCase();
    const targetEndpoint = requestedEndpoint
      ?? (atTop
        ? 'bottom'
        : atBottom
          ? 'top'
          : (initialDirection === 'down' || persistedPhase.includes('descending'))
            ? 'bottom'
            : 'top');
    const phase = atBottom || atTop ? 'dwelling' : 'moving';
    const currentEndpoint = atBottom ? 'bottom' : atTop ? 'top' : null;
    const objectTopYOffset = platformObject?.position
      ? platformObject.position.y - finiteOr(surface.topY, currentElevation)
      : 0;
    const controls = Array.isArray(descriptor.controls) ? descriptor.controls : [];
    const shortcutMechanismId = descriptor.shortcutMechanismId
      ?? descriptor.lockedUntilMechanismId
      ?? null;
    const shortcutUnlocked = !shortcutMechanismId
      || descriptor.shortcutUnlocked === true
      || descriptor.activated === true;

    return {
      id,
      descriptor,
      surface,
      platformObject,
      objectTopYOffset,
      controls,
      shortcutMechanismId,
      shortcutUnlocked,
      bottomElevation,
      topElevation,
      speedMetersPerSecond: Math.max(
        ENDPOINT_EPSILON,
        finiteOr(descriptor.speedMetersPerSecond, DEFAULT_SPEED_METERS_PER_SECOND),
      ),
      dwellSeconds: Math.max(0, finiteOr(descriptor.dwellSeconds, DEFAULT_DWELL_SECONDS)),
      currentElevation,
      currentEndpoint,
      targetEndpoint,
      requestedEndpoint,
      phase,
      dwellRemaining: phase === 'dwelling'
        ? Math.max(0, finiteOr(descriptor.dwellRemaining, descriptor.dwellSeconds ?? DEFAULT_DWELL_SECONDS))
        : 0,
      registered: false,
      completedTrips: 0,
      requestCount: 0,
      carriedDistanceMeters: 0,
      travelDistanceMeters: 0,
      lastRiderCarried: false,
    };
  }

  reset(source = this.source, { preserveElevation = true } = {}) {
    if (this.disposed) return false;
    const wasMounted = this.mounted;
    if (wasMounted) this.unmount();
    this.source = source;
    this.lifts = getDescriptorList(source)
      .map((descriptor, index) => this._createLiftState(descriptor, index, { preserveElevation }))
      .filter(Boolean);
    this.liftById = new Map(this.lifts.map((lift) => [lift.id, lift]));
    this.controlById = new Map();
    for (const lift of this.lifts) {
      for (const control of lift.controls) {
        if (!control?.id) continue;
        this.controlById.set(String(control.id), {
          liftId: lift.id,
          endpoint: normalizeEndpoint(control.endpoint),
        });
      }
      this._applyElevation(lift, lift.currentElevation, { carryRider: false });
    }
    if (wasMounted) this.mount(this.game);
    return true;
  }

  mount(game = this.game) {
    if (this.disposed) return false;
    if (game) this.game = game;
    for (const lift of this.lifts) {
      lift.surface.dynamic = true;
      lift.surface.createsLedgeCandidates = false;
      lift.registered = Boolean(this.game?.registerDynamicPlatformingSurface?.(lift.surface));
    }
    this.mounted = true;
    return true;
  }

  unmount() {
    if (!this.mounted) return false;
    for (const lift of this.lifts) {
      if (lift.registered) this.game?.unregisterDynamicPlatformingSurface?.(lift.surface);
      lift.registered = false;
    }
    this.mounted = false;
    return true;
  }

  _isPlayerSupportedBy(lift) {
    const player = this.game?.player;
    if (!player?.root || player.dead || player.isJumpAirborne?.()) return false;
    if (!containsSurfaceTop(lift.surface, player.root.position)) return false;
    return Math.abs(player.root.position.y - lift.currentElevation) <= RIDER_VERTICAL_TOLERANCE;
  }

  _applyElevation(lift, nextElevation, { carryRider = true } = {}) {
    const previousElevation = lift.currentElevation;
    const resolvedElevation = clamp(nextElevation, lift.bottomElevation, lift.topElevation);
    const delta = resolvedElevation - previousElevation;
    const supported = carryRider && Math.abs(delta) > ENDPOINT_EPSILON
      ? this._isPlayerSupportedBy(lift)
      : false;

    lift.currentElevation = resolvedElevation;
    lift.surface.topY = resolvedElevation;
    lift.surface.baseY = resolvedElevation - finiteOr(
      lift.descriptor.platformThicknessMeters,
      0.28,
    );
    if (lift.surface.center?.isVector3) lift.surface.center.y = resolvedElevation;
    if (lift.platformObject?.position) {
      lift.platformObject.position.y = resolvedElevation + lift.objectTopYOffset;
      lift.platformObject.updateMatrixWorld?.(true);
    }
    setDescriptorField(lift.descriptor, 'currentElevation', resolvedElevation);

    lift.lastRiderCarried = supported;
    if (supported) {
      const player = this.game.player;
      player.root.position.y += delta;
      if (this.game?.dungeonController?.lastSafePlayerPosition) {
        this.game.dungeonController.lastSafePlayerPosition.y += delta;
      }
      lift.carriedDistanceMeters += Math.abs(delta);
    }
    lift.travelDistanceMeters += Math.abs(delta);
    return delta;
  }

  _syncDescriptor(lift) {
    const phaseLabel = lift.phase === 'moving'
      ? (lift.targetEndpoint === 'top' ? 'ascending' : 'descending')
      : `dwelling-${lift.currentEndpoint ?? lift.targetEndpoint}`;
    setDescriptorField(lift.descriptor, 'phase', phaseLabel);
    setDescriptorField(lift.descriptor, 'dwellRemaining', lift.dwellRemaining);
    setDescriptorField(lift.descriptor, 'requestedEndpoint', lift.requestedEndpoint);
  }

  _beginTravel(lift, endpoint) {
    const resolvedEndpoint = normalizeEndpoint(endpoint);
    if (!resolvedEndpoint) return false;
    lift.targetEndpoint = resolvedEndpoint;
    lift.currentEndpoint = null;
    lift.phase = 'moving';
    lift.dwellRemaining = 0;
    return true;
  }

  _arrive(lift, endpoint) {
    const elevation = endpoint === 'top' ? lift.topElevation : lift.bottomElevation;
    this._applyElevation(lift, elevation);
    lift.currentEndpoint = endpoint;
    lift.targetEndpoint = endpoint;
    lift.phase = 'dwelling';
    lift.dwellRemaining = lift.dwellSeconds;
    lift.requestedEndpoint = null;
    lift.completedTrips += 1;
  }

  _updateLift(lift, dt) {
    if (!lift.shortcutUnlocked && lift.shortcutMechanismId) {
      const activated = this.game?.dungeonController?._isMechanismActivated?.(
        lift.shortcutMechanismId,
      );
      if (activated) this._unlockLift(lift);
    }
    if (!lift.shortcutUnlocked) {
      lift.requestedEndpoint = null;
      lift.phase = 'dwelling';
      lift.dwellRemaining = lift.dwellSeconds;
      this._syncDescriptor(lift);
      return;
    }
    let remaining = Math.max(0, finiteOr(dt, 0));
    let steps = 0;
    while (remaining > ENDPOINT_EPSILON && steps < MAX_UPDATE_STEPS) {
      steps += 1;
      if (lift.phase === 'dwelling') {
        const requested = lift.requestedEndpoint;
        if (requested && requested !== lift.currentEndpoint) {
          lift.requestedEndpoint = null;
          this._beginTravel(lift, requested);
          continue;
        }
        const consumed = Math.min(remaining, lift.dwellRemaining);
        lift.dwellRemaining = Math.max(0, lift.dwellRemaining - consumed);
        remaining -= consumed;
        if (lift.dwellRemaining > ENDPOINT_EPSILON) break;
        lift.requestedEndpoint = null;
        this._beginTravel(lift, lift.currentEndpoint === 'top' ? 'bottom' : 'top');
        continue;
      }

      if (lift.requestedEndpoint && lift.requestedEndpoint !== lift.targetEndpoint) {
        const endpoint = lift.requestedEndpoint;
        lift.requestedEndpoint = null;
        this._beginTravel(lift, endpoint);
      }
      const targetElevation = lift.targetEndpoint === 'top'
        ? lift.topElevation
        : lift.bottomElevation;
      const distance = Math.abs(targetElevation - lift.currentElevation);
      if (distance <= ENDPOINT_EPSILON) {
        this._arrive(lift, lift.targetEndpoint);
        continue;
      }
      const travelSeconds = distance / lift.speedMetersPerSecond;
      const consumed = Math.min(remaining, travelSeconds);
      const direction = targetElevation > lift.currentElevation ? 1 : -1;
      this._applyElevation(
        lift,
        lift.currentElevation + direction * lift.speedMetersPerSecond * consumed,
      );
      remaining -= consumed;
      if (consumed + ENDPOINT_EPSILON >= travelSeconds) {
        this._arrive(lift, lift.targetEndpoint);
      }
    }
    this._syncDescriptor(lift);
  }

  prePlayerUpdate(dt, game = this.game) {
    if (this.disposed || !this.mounted) return false;
    if (game) this.game = game;
    const delta = Math.max(0, finiteOr(dt, 0));
    this.elapsedSeconds += delta;
    for (const lift of this.lifts) this._updateLift(lift, delta);
    return true;
  }

  requestLift(id, endpoint) {
    if (this.disposed) return { ok: false, reason: 'runtime-disposed' };
    let liftId = String(id ?? '');
    let resolvedEndpoint = normalizeEndpoint(endpoint);
    const control = this.controlById.get(liftId);
    if (control) {
      liftId = control.liftId;
      resolvedEndpoint ??= control.endpoint;
    }
    const lift = this.liftById.get(liftId);
    if (!lift) {
      this.invalidRequestCount += 1;
      return { ok: false, reason: 'unknown-lift', liftId };
    }
    if (!lift.shortcutUnlocked) {
      return {
        ok: false,
        reason: 'shortcut-locked',
        liftId,
        mechanismId: lift.shortcutMechanismId,
      };
    }
    if (!resolvedEndpoint) {
      this.invalidRequestCount += 1;
      return { ok: false, reason: 'invalid-endpoint', liftId };
    }

    this.totalRequests += 1;
    lift.requestCount += 1;
    if (lift.phase === 'dwelling' && lift.currentEndpoint === resolvedEndpoint) {
      lift.dwellRemaining = Math.max(lift.dwellRemaining, lift.dwellSeconds);
      lift.requestedEndpoint = null;
      this._syncDescriptor(lift);
      return { ok: true, liftId, endpoint: resolvedEndpoint, alreadyPresent: true };
    }
    lift.requestedEndpoint = resolvedEndpoint;
    if (lift.phase === 'moving') this._beginTravel(lift, resolvedEndpoint);
    this._syncDescriptor(lift);
    return { ok: true, liftId, endpoint: resolvedEndpoint, alreadyPresent: false };
  }

  _unlockLift(lift) {
    if (!lift || lift.shortcutUnlocked) return false;
    lift.shortcutUnlocked = true;
    setDescriptorField(lift.descriptor, 'shortcutUnlocked', true);
    lift.dwellRemaining = Math.max(lift.dwellRemaining, lift.dwellSeconds);
    this._syncDescriptor(lift);
    return true;
  }

  unlockLift(id) {
    const lift = this.liftById.get(String(id ?? ''));
    if (!lift) return { ok: false, reason: 'unknown-lift', liftId: String(id ?? '') };
    const changed = this._unlockLift(lift);
    return { ok: true, liftId: lift.id, changed };
  }

  restoreLiftState(id, {
    currentElevation,
    shortcutUnlocked,
  } = {}) {
    const lift = this.liftById.get(String(id ?? ''));
    if (!lift) return { ok: false, reason: 'unknown-lift', liftId: String(id ?? '') };
    let changed = false;
    if (Number.isFinite(currentElevation)) {
      this._applyElevation(lift, currentElevation, { carryRider: false });
      const atBottom = Math.abs(
        lift.currentElevation - lift.bottomElevation,
      ) <= ENDPOINT_EPSILON;
      const atTop = Math.abs(
        lift.currentElevation - lift.topElevation,
      ) <= ENDPOINT_EPSILON;
      lift.currentEndpoint = atBottom ? 'bottom' : atTop ? 'top' : null;
      if (lift.currentEndpoint) {
        lift.targetEndpoint = lift.currentEndpoint;
        lift.phase = 'dwelling';
        lift.dwellRemaining = lift.dwellSeconds;
      } else {
        lift.phase = 'moving';
        lift.dwellRemaining = 0;
      }
      changed = true;
    }
    if (typeof shortcutUnlocked === 'boolean'
      && lift.shortcutUnlocked !== shortcutUnlocked) {
      lift.shortcutUnlocked = shortcutUnlocked;
      setDescriptorField(lift.descriptor, 'shortcutUnlocked', shortcutUnlocked);
      changed = true;
    }
    this._syncDescriptor(lift);
    return {
      ok: true,
      liftId: lift.id,
      changed,
      currentElevation: lift.currentElevation,
      shortcutUnlocked: lift.shortcutUnlocked,
    };
  }

  getDiagnostics() {
    return Object.freeze({
      mounted: this.mounted,
      disposed: this.disposed,
      elapsedSeconds: this.elapsedSeconds,
      liftCount: this.lifts.length,
      totalRequests: this.totalRequests,
      invalidRequestCount: this.invalidRequestCount,
      lifts: Object.freeze(this.lifts.map((lift) => Object.freeze({
        id: lift.id,
        phase: lift.phase,
        currentEndpoint: lift.currentEndpoint,
        targetEndpoint: lift.targetEndpoint,
        requestedEndpoint: lift.requestedEndpoint,
        currentElevation: lift.currentElevation,
        bottomElevation: lift.bottomElevation,
        topElevation: lift.topElevation,
        dwellRemaining: lift.dwellRemaining,
        registered: lift.registered,
        completedTrips: lift.completedTrips,
        requestCount: lift.requestCount,
        carriedDistanceMeters: lift.carriedDistanceMeters,
        travelDistanceMeters: lift.travelDistanceMeters,
        lastRiderCarried: lift.lastRiderCarried,
        controlIds: Object.freeze(lift.controls.map((control) => control?.id).filter(Boolean)),
        shortcutMechanismId: lift.shortcutMechanismId,
        shortcutUnlocked: lift.shortcutUnlocked,
      }))),
    });
  }

  dispose() {
    if (this.disposed) return false;
    this.unmount();
    this.disposed = true;
    this.game = null;
    this.liftById.clear();
    this.controlById.clear();
    return true;
  }
}

export function createDungeonConnectorLiftRuntime(game, source) {
  return new DungeonConnectorLiftRuntime(game, source);
}

export const DUNGEON_CONNECTOR_LIFT_RUNTIME_DEFAULTS = Object.freeze({
  speedMetersPerSecond: DEFAULT_SPEED_METERS_PER_SECOND,
  dwellSeconds: DEFAULT_DWELL_SECONDS,
  riderVerticalTolerance: RIDER_VERTICAL_TOLERANCE,
});
