const DEFAULT_RECHARGE_DELAY = 0.65;
const DEFAULT_RECHARGE_DURATION = 1.8;
const DEFAULT_PROJECTILE_CAPACITY = 24;
const EPSILON = 0.000001;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function readStats(plan = {}) {
  const source = plan.stats ?? plan.result ?? plan;
  const maxEnergy = Math.max(1, finite(source.maxEnergy ?? source.maximumEnergy, 1));
  const energyCost = Math.max(0, finite(source.energyCost ?? plan.energyCost, 0));
  const cycleTime = Math.max(0, finite(source.cycleTime ?? plan.cycleTime, 0));
  const peakProjectileReservation = Math.max(
    1,
    Math.trunc(finite(plan.peakProjectileReservation ?? source.peakProjectileReservation, 1)),
  );
  return { maxEnergy, energyCost, cycleTime, peakProjectileReservation };
}

function planKey(plan = {}) {
  return String(plan.weaponKey ?? plan.buildId ?? plan.id ?? 'megaBuster');
}

export class BusterRuntime {
  constructor({
    projectileCapacity = DEFAULT_PROJECTILE_CAPACITY,
    rechargeDelay = DEFAULT_RECHARGE_DELAY,
    rechargeDuration = DEFAULT_RECHARGE_DURATION,
    executeShot = null,
    cancelExecution = null,
  } = {}) {
    this.projectileCapacity = Math.max(1, Math.trunc(finite(projectileCapacity, DEFAULT_PROJECTILE_CAPACITY)));
    this.rechargeDelay = Math.max(0, finite(rechargeDelay, DEFAULT_RECHARGE_DELAY));
    this.rechargeDuration = Math.max(0.01, finite(rechargeDuration, DEFAULT_RECHARGE_DURATION));
    this.executeShot = typeof executeShot === 'function' ? executeShot : null;
    this.cancelExecution = typeof cancelExecution === 'function' ? cancelExecution : null;
    this.plans = new Map();
    this.states = new Map();
    this.reservations = new Map();
    this.activeKey = null;
    this.executionCounter = 0;
    this.reservationCounter = 0;
  }

  equip(plan) {
    if (!plan) {
      this.activeKey = null;
      return null;
    }

    const state = this.register(plan);
    this.activeKey = planKey(plan);
    return state;
  }

  register(plan) {
    if (!plan) return null;

    const key = planKey(plan);
    // Executions retain the immutable plan captured by fire(). Re-registering a
    // newer source revision only changes future shots; it must not cancel shots
    // that are already in flight.
    this.plans.set(key, plan);
    const stats = readStats(plan);
    let state = this.states.get(key);
    if (!state) {
      state = {
        key,
        energy: stats.maxEnergy,
        maxEnergy: stats.maxEnergy,
        cycleRemaining: 0,
        rechargeDelayRemaining: 0,
        lastContext: null,
        recoveryLocked: false,
        firing: false,
      };
      this.states.set(key, state);
    } else {
      state.maxEnergy = stats.maxEnergy;
      state.energy = Math.min(state.energy, state.maxEnergy);
      if (state.energy + EPSILON >= state.maxEnergy) {
        state.energy = state.maxEnergy;
        state.recoveryLocked = false;
      }
    }

    return state;
  }

  canFire(key = this.activeKey) {
    return this.getBlockReason(key) === null;
  }

  requestFire(key = this.activeKey) {
    const plan = this.plans.get(key);
    const state = this.states.get(key);
    if (!plan || !state) return { ok: false, reason: 'NO_PLAN' };
    if (state.firing) return { ok: false, reason: 'FIRING' };
    if (state.cycleRemaining > EPSILON) return { ok: false, reason: 'CYCLE' };
    if (state.recoveryLocked) return { ok: false, reason: 'RECOVERY' };

    const stats = readStats(plan);
    // Capacity is checked before Energy so an atomically rejected batch never
    // changes the battery state, even when both resources are unavailable.
    if (this.getReservedProjectileCount() + stats.peakProjectileReservation > this.projectileCapacity) {
      return { ok: false, reason: 'PROJECTILE_CAP' };
    }
    if (state.energy + EPSILON < stats.energyCost) {
      state.recoveryLocked = true;
      return { ok: false, reason: 'ENERGY', recoveryLocked: true };
    }

    return { ok: true };
  }

  getBlockReason(key = this.activeKey) {
    const plan = this.plans.get(key);
    const state = this.states.get(key);
    if (!plan || !state) return 'NO_PLAN';
    if (state.firing) return 'FIRING';
    const stats = readStats(plan);
    if (state.cycleRemaining > EPSILON) return 'CYCLE';
    if (state.recoveryLocked) return 'RECOVERY';
    if (this.getReservedProjectileCount() + stats.peakProjectileReservation > this.projectileCapacity) {
      return 'PROJECTILE_CAP';
    }
    if (state.energy + EPSILON < stats.energyCost) return 'ENERGY';
    return null;
  }

  fire(context = {}, key = this.activeKey) {
    const request = this.requestFire(key);
    if (!request.ok) return request;

    const plan = this.plans.get(key);
    const state = this.states.get(key);
    const stats = readStats(plan);
    const reservationToken = this._reserve(key, stats.peakProjectileReservation);
    if (!reservationToken) return { ok: false, reason: 'PROJECTILE_CAP' };

    const executionId = `${key}:execution:${++this.executionCounter}`;
    const execution = Object.freeze({
      executionId,
      reservationToken,
      weaponKey: key,
      buildId: plan.buildId ?? (key === 'megaBuster' ? null : key),
      buildRevision: plan.revision ?? plan.buildRevision ?? 0,
      plan,
      context,
    });

    const rollback = {
      energy: state.energy,
      cycleRemaining: state.cycleRemaining,
      rechargeDelayRemaining: state.rechargeDelayRemaining,
      lastContext: state.lastContext,
      recoveryLocked: state.recoveryLocked,
    };
    state.firing = true;
    state.energy = Math.max(0, state.energy - stats.energyCost);
    state.cycleRemaining = stats.cycleTime;
    state.rechargeDelayRemaining = this.rechargeDelay;
    state.lastContext = context;
    state.recoveryLocked = false;
    let accepted = true;
    try {
      if (this.executeShot) accepted = this.executeShot(execution) !== false;
    } catch (error) {
      Object.assign(state, rollback);
      this.releaseReservation(reservationToken);
      throw error;
    } finally {
      state.firing = false;
    }

    if (!accepted) {
      Object.assign(state, rollback);
      this.releaseReservation(reservationToken);
      return { ok: false, reason: 'SPAWN_REJECTED' };
    }
    return { ok: true, execution };
  }

  update(dt, options = {}) {
    const elapsed = Math.max(0, finite(dt));
    const hasActiveKey = Object.prototype.hasOwnProperty.call(options, 'activeWeaponKey');
    if (hasActiveKey) {
      const requestedKey = options.activeWeaponKey;
      this.activeKey = requestedKey != null && this.plans.has(String(requestedKey))
        ? String(requestedKey)
        : null;
    }
    const fireHeld = Boolean(options.fireHeld);

    for (const [key, state] of this.states) {
      const plan = this.plans.get(key);
      if (!plan) continue;
      state.cycleRemaining = Math.max(0, state.cycleRemaining - elapsed);
      const delayBeforeUpdate = state.rechargeDelayRemaining;
      state.rechargeDelayRemaining = Math.max(0, delayBeforeUpdate - elapsed);
      const rechargeElapsed = delayBeforeUpdate > 0
        ? Math.max(0, elapsed - delayBeforeUpdate)
        : elapsed;

      const isActive = key === this.activeKey;
      const heldPause = isActive && fireHeld && !state.recoveryLocked;
      if (rechargeElapsed > 0 && state.energy < state.maxEnergy && !heldPause) {
        const rechargeScale = isActive ? 1 : 0.5;
        state.energy = Math.min(
          state.maxEnergy,
          state.energy + (state.maxEnergy / this.rechargeDuration) * rechargeElapsed * rechargeScale,
        );
      }
      if (state.recoveryLocked && state.energy + EPSILON >= state.maxEnergy) {
        state.energy = state.maxEnergy;
        state.recoveryLocked = false;
      }
    }

    // Combat owns firing contexts and the extended-muzzle release. update()
    // advances resources only and never reuses a stale context autonomously.
    return null;
  }

  cancelBuild(buildId, reason = 'cancelled') {
    const key = String(buildId);
    const tokens = [...this.reservations.values()].filter((entry) => entry.weaponKey === key);
    for (const entry of tokens) {
      try {
        this.cancelExecution?.({ ...entry, reason });
      } finally {
        this.releaseReservation(entry.token);
      }
    }
    return tokens.length;
  }

  unregister(buildId, { cancelExecutions = false, removeState = true, reason = 'invalidated' } = {}) {
    const key = String(buildId);
    const existed = this.plans.delete(key);
    if (cancelExecutions) this.cancelBuild(key, reason);
    if (removeState) this.states.delete(key);
    if (this.activeKey === key) this.activeKey = null;
    return existed;
  }

  resetWeapon(key = this.activeKey, { remove = false } = {}) {
    if (!key) return false;
    this.cancelBuild(key, 'reset');
    const plan = this.plans.get(key);
    if (remove) {
      this.plans.delete(key);
      this.states.delete(key);
      if (this.activeKey === key) this.activeKey = null;
      return Boolean(plan);
    }
    if (!plan) return false;
    const stats = readStats(plan);
    this.states.set(key, {
      key,
      energy: stats.maxEnergy,
      maxEnergy: stats.maxEnergy,
      cycleRemaining: 0,
      rechargeDelayRemaining: 0,
      lastContext: null,
      recoveryLocked: false,
      firing: false,
    });
    return true;
  }

  createResourceSnapshot() {
    return {
      activeKey: this.activeKey,
      states: [...this.states.entries()].map(([key, state]) => ({
        key,
        energy: state.energy,
        maxEnergy: state.maxEnergy,
        cycleRemaining: state.cycleRemaining,
        rechargeDelayRemaining: state.rechargeDelayRemaining,
        lastContext: state.lastContext,
        recoveryLocked: Boolean(state.recoveryLocked),
      })),
    };
  }

  restoreResourceSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.states)) return false;
    for (const saved of snapshot.states) {
      if (!saved?.key || !this.plans.has(saved.key)) continue;
      const stats = readStats(this.plans.get(saved.key));
      this.states.set(saved.key, {
        key: saved.key,
        energy: Math.max(0, Math.min(stats.maxEnergy, finite(saved.energy, stats.maxEnergy))),
        maxEnergy: stats.maxEnergy,
        cycleRemaining: Math.max(0, finite(saved.cycleRemaining)),
        rechargeDelayRemaining: Math.max(0, finite(saved.rechargeDelayRemaining)),
        lastContext: saved.lastContext ?? null,
        recoveryLocked: Boolean(saved.recoveryLocked),
        firing: false,
      });
    }
    this.activeKey = snapshot.activeKey && this.plans.has(snapshot.activeKey)
      ? snapshot.activeKey
      : null;
    return true;
  }

  releaseReservation(token) {
    const entry = this.reservations.get(token);
    if (!entry) return false;
    this.reservations.delete(token);
    return true;
  }

  getReservedProjectileCount() {
    let total = 0;
    for (const entry of this.reservations.values()) total += entry.count;
    return total;
  }

  getHudState(key = this.activeKey) {
    const state = this.states.get(key);
    const plan = this.plans.get(key);
    if (!state || !plan) return null;
    const stats = readStats(plan);
    return {
      weaponKey: key,
      energy: state.energy,
      maxEnergy: state.maxEnergy,
      energyPercent: state.maxEnergy > 0 ? state.energy / state.maxEnergy : 0,
      energyCost: stats.energyCost,
      cycleRemaining: state.cycleRemaining,
      rechargeDelayRemaining: state.rechargeDelayRemaining,
      recoveryLocked: Boolean(state.recoveryLocked),
      ready: this.canFire(key),
      blockReason: this.getBlockReason(key),
      reservedProjectiles: this.getReservedProjectileCount(),
      projectileCapacity: this.projectileCapacity,
    };
  }

  _reserve(weaponKey, count) {
    if (this.getReservedProjectileCount() + count > this.projectileCapacity) return null;
    const token = `${weaponKey}:reservation:${++this.reservationCounter}`;
    this.reservations.set(token, { token, weaponKey, count });
    return token;
  }
}

export const BUSTER_RUNTIME_DEFAULTS = Object.freeze({
  rechargeDelay: DEFAULT_RECHARGE_DELAY,
  rechargeDuration: DEFAULT_RECHARGE_DURATION,
  projectileCapacity: DEFAULT_PROJECTILE_CAPACITY,
});
