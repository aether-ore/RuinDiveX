export const DUNGEON_QUALITY_MODES = Object.freeze({
  AUTO: 'Auto',
  HIGH: 'High',
  BALANCED: 'Balanced',
  PERFORMANCE: 'Performance',
});

export const DUNGEON_QUALITY_TIERS = Object.freeze({
  HIGH: DUNGEON_QUALITY_MODES.HIGH,
  BALANCED: DUNGEON_QUALITY_MODES.BALANCED,
  PERFORMANCE: DUNGEON_QUALITY_MODES.PERFORMANCE,
});

export const DUNGEON_QUALITY_PRESETS = Object.freeze({
  [DUNGEON_QUALITY_TIERS.HIGH]: Object.freeze({
    dprCap: 2,
    shadowMapSize: 2048,
    activeLocalLightCap: 8,
    noncriticalDetailDistance: 68,
  }),
  [DUNGEON_QUALITY_TIERS.BALANCED]: Object.freeze({
    dprCap: 1.25,
    shadowMapSize: 1024,
    activeLocalLightCap: 6,
    noncriticalDetailDistance: 52,
  }),
  [DUNGEON_QUALITY_TIERS.PERFORMANCE]: Object.freeze({
    dprCap: 1,
    shadowMapSize: 512,
    activeLocalLightCap: 4,
    noncriticalDetailDistance: 40,
  }),
});

export const AUTO_DUNGEON_QUALITY_POLICY = Object.freeze({
  windowDurationMs: 2_000,
  downshiftP95ThresholdMs: 33.3,
  downshiftConsecutiveWindows: 3,
  upgradeP95ThresholdMs: 25,
  upgradeSustainedDurationMs: 15_000,
  tierChangeCooldownMs: 10_000,
});

const QUALITY_MODES = Object.freeze(Object.values(DUNGEON_QUALITY_MODES));
const QUALITY_TIERS = Object.freeze(Object.values(DUNGEON_QUALITY_TIERS));
const QUALITY_TIER_ORDER = Object.freeze([
  DUNGEON_QUALITY_TIERS.PERFORMANCE,
  DUNGEON_QUALITY_TIERS.BALANCED,
  DUNGEON_QUALITY_TIERS.HIGH,
]);

function canonicalValue(value, allowedValues, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`);
  const normalized = value.trim().toLowerCase();
  const match = allowedValues.find((candidate) => candidate.toLowerCase() === normalized);
  if (!match) throw new RangeError(`${label} must be one of: ${allowedValues.join(', ')}.`);
  return match;
}

function finiteNonnegative(value, label) {
  const resolved = Number(value);
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${label} must be a finite nonnegative number.`);
  }
  return resolved;
}

function nextTier(tier, direction) {
  const nextIndex = QUALITY_TIER_ORDER.indexOf(tier) + direction;
  return nextIndex >= 0 && nextIndex < QUALITY_TIER_ORDER.length
    ? QUALITY_TIER_ORDER[nextIndex]
    : null;
}

export function normalizeDungeonQualityMode(mode) {
  return canonicalValue(mode, QUALITY_MODES, 'Dungeon quality mode');
}

export function normalizeDungeonQualityTier(tier) {
  return canonicalValue(tier, QUALITY_TIERS, 'Dungeon quality tier');
}

export function dungeonQualitySettingsForTier(tier) {
  return DUNGEON_QUALITY_PRESETS[normalizeDungeonQualityTier(tier)];
}

/** Uses the deterministic nearest-rank percentile definition. */
export function dungeonFrameTimeP95(frameDurationSamples = []) {
  if (!Array.isArray(frameDurationSamples)) {
    throw new TypeError('Frame duration samples must be an array.');
  }
  if (frameDurationSamples.length === 0) return null;
  const ordered = frameDurationSamples
    .map((sample, index) => finiteNonnegative(sample, `Frame duration sample ${index}`))
    .sort((first, second) => first - second);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)];
}

/**
 * Timer-free adaptive quality state machine. The caller supplies timestamps,
 * so the same sample/tick sequence always produces the same tier transitions.
 */
export class AdaptiveDungeonQualityController {
  constructor({
    mode = DUNGEON_QUALITY_MODES.AUTO,
    initialTier = DUNGEON_QUALITY_TIERS.BALANCED,
    startTimeMs = 0,
  } = {}) {
    this._mode = normalizeDungeonQualityMode(mode);
    this._autoInitialTier = normalizeDungeonQualityTier(initialTier);
    this._tier = this._mode === DUNGEON_QUALITY_MODES.AUTO
      ? this._autoInitialTier
      : normalizeDungeonQualityTier(this._mode);
    this._lastTimestampMs = finiteNonnegative(startTimeMs, 'Start time');
    this._samples = [];
    this._lastWindowP95Ms = null;
    this._consecutiveSlowWindows = 0;
    this._sustainedFastDurationMs = 0;
    this._lastTierChangeAtMs = null;
    this._nextEvaluationAtMs = this._lastTimestampMs
      + AUTO_DUNGEON_QUALITY_POLICY.windowDurationMs;
  }

  get mode() { return this._mode; }

  get tier() { return this._tier; }

  get settings() { return DUNGEON_QUALITY_PRESETS[this._tier]; }

  sample(frameDurationMs, timestampMs) {
    const duration = finiteNonnegative(frameDurationMs, 'Frame duration');
    const timestamp = this._observeTimestamp(timestampMs);
    this._samples.push({
      frameDurationMs: duration,
      timestampMs: timestamp,
    });
    return this._advance(timestamp);
  }

  tick(timestampMs) {
    return this._advance(this._observeTimestamp(timestampMs));
  }

  setMode(mode, timestampMs, initialTier = this._autoInitialTier) {
    const resolvedMode = normalizeDungeonQualityMode(mode);
    const resolvedInitialTier = normalizeDungeonQualityTier(initialTier);
    const timestamp = this._observeTimestamp(timestampMs);
    const resolvedTier = resolvedMode === DUNGEON_QUALITY_MODES.AUTO
      ? resolvedInitialTier
      : normalizeDungeonQualityTier(resolvedMode);
    const changed = resolvedMode !== this._mode || (
      resolvedMode === DUNGEON_QUALITY_MODES.AUTO
      && resolvedInitialTier !== this._autoInitialTier
    );
    if (!changed) {
      this._autoInitialTier = resolvedInitialTier;
      return Object.freeze({ changed: false, ...this._snapshot(timestamp) });
    }
    this._mode = resolvedMode;
    this._autoInitialTier = resolvedInitialTier;
    this._tier = resolvedTier;
    this._resetWindowState(timestamp);
    return Object.freeze({ changed, ...this._snapshot(timestamp) });
  }

  getSnapshot() {
    return this._snapshot(this._lastTimestampMs);
  }

  _observeTimestamp(timestampMs) {
    const timestamp = finiteNonnegative(timestampMs, 'Timestamp');
    if (timestamp < this._lastTimestampMs) {
      throw new RangeError('Timestamps must be monotonic.');
    }
    this._lastTimestampMs = timestamp;
    return timestamp;
  }

  _resetWindowState(timestampMs) {
    this._samples = [];
    this._lastWindowP95Ms = null;
    this._consecutiveSlowWindows = 0;
    this._sustainedFastDurationMs = 0;
    this._lastTierChangeAtMs = null;
    this._nextEvaluationAtMs = timestampMs
      + AUTO_DUNGEON_QUALITY_POLICY.windowDurationMs;
  }

  _cooldownRemainingMs(timestampMs) {
    if (this._lastTierChangeAtMs == null) return 0;
    return Math.max(0, AUTO_DUNGEON_QUALITY_POLICY.tierChangeCooldownMs
      - (timestampMs - this._lastTierChangeAtMs));
  }

  _advance(timestampMs) {
    const evaluations = [];
    while (timestampMs >= this._nextEvaluationAtMs) {
      evaluations.push(this._evaluateWindow(this._nextEvaluationAtMs));
      this._nextEvaluationAtMs += AUTO_DUNGEON_QUALITY_POLICY.windowDurationMs;
    }
    if (evaluations.length > 0) {
      const completedThroughMs = this._nextEvaluationAtMs
        - AUTO_DUNGEON_QUALITY_POLICY.windowDurationMs;
      this._samples = this._samples.filter((sample) => sample.timestampMs > completedThroughMs);
    }
    const changes = evaluations.map((evaluation) => evaluation.change).filter(Boolean);
    return Object.freeze({
      evaluated: evaluations.length > 0,
      evaluations: Object.freeze(evaluations),
      changes: Object.freeze(changes),
      change: changes.at(-1) ?? null,
      ...this._snapshot(timestampMs),
    });
  }

  _evaluateWindow(windowEndMs) {
    const windowStartMs = windowEndMs - AUTO_DUNGEON_QUALITY_POLICY.windowDurationMs;
    const frameDurations = this._samples
      .filter((sample) => sample.timestampMs > windowStartMs && sample.timestampMs <= windowEndMs)
      .map((sample) => sample.frameDurationMs);
    const p95Ms = dungeonFrameTimeP95(frameDurations);
    const tierBefore = this._tier;
    const cooldownActive = this._cooldownRemainingMs(windowEndMs) > 0;
    let change = null;
    this._lastWindowP95Ms = p95Ms;

    if (this._mode !== DUNGEON_QUALITY_MODES.AUTO || p95Ms == null || cooldownActive) {
      this._consecutiveSlowWindows = 0;
      this._sustainedFastDurationMs = 0;
    } else if (p95Ms > AUTO_DUNGEON_QUALITY_POLICY.downshiftP95ThresholdMs) {
      this._consecutiveSlowWindows += 1;
      this._sustainedFastDurationMs = 0;
      if (this._consecutiveSlowWindows >= AUTO_DUNGEON_QUALITY_POLICY.downshiftConsecutiveWindows) {
        const lowerTier = nextTier(this._tier, -1);
        if (lowerTier) {
          this._tier = lowerTier;
          this._lastTierChangeAtMs = windowEndMs;
          change = Object.freeze({
            from: tierBefore,
            to: lowerTier,
            reason: 'sustained-slow-p95',
            atMs: windowEndMs,
          });
          this._consecutiveSlowWindows = 0;
        } else {
          this._consecutiveSlowWindows = AUTO_DUNGEON_QUALITY_POLICY.downshiftConsecutiveWindows;
        }
      }
    } else if (p95Ms < AUTO_DUNGEON_QUALITY_POLICY.upgradeP95ThresholdMs) {
      this._consecutiveSlowWindows = 0;
      this._sustainedFastDurationMs += AUTO_DUNGEON_QUALITY_POLICY.windowDurationMs;
      if (this._sustainedFastDurationMs >= AUTO_DUNGEON_QUALITY_POLICY.upgradeSustainedDurationMs) {
        const higherTier = nextTier(this._tier, 1);
        if (higherTier) {
          this._tier = higherTier;
          this._lastTierChangeAtMs = windowEndMs;
          change = Object.freeze({
            from: tierBefore,
            to: higherTier,
            reason: 'sustained-fast-p95',
            atMs: windowEndMs,
          });
          this._sustainedFastDurationMs = 0;
        } else {
          this._sustainedFastDurationMs = AUTO_DUNGEON_QUALITY_POLICY.upgradeSustainedDurationMs;
        }
      }
    } else {
      this._consecutiveSlowWindows = 0;
      this._sustainedFastDurationMs = 0;
    }

    return Object.freeze({
      windowStartMs,
      windowEndMs,
      sampleCount: frameDurations.length,
      p95Ms,
      cooldownActive,
      tierBefore,
      tierAfter: this._tier,
      change,
    });
  }

  _snapshot(timestampMs) {
    return Object.freeze({
      mode: this._mode,
      tier: this._tier,
      settings: this.settings,
      lastWindowP95Ms: this._lastWindowP95Ms,
      consecutiveSlowWindows: this._consecutiveSlowWindows,
      sustainedFastDurationMs: this._sustainedFastDurationMs,
      cooldownRemainingMs: this._cooldownRemainingMs(timestampMs),
      nextEvaluationAtMs: this._nextEvaluationAtMs,
    });
  }
}
