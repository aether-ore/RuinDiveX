// Retain a complete 60-second release capture at up to 240 Hz. Subsystems share
// the same upper bound; 20 Hz occlusion/scanner samples need at most 1,200 slots.
const DEFAULT_FRAME_SAMPLE_CAPACITY = 14_400;
const DEFAULT_SUBSYSTEM_SAMPLE_CAPACITY = 14_400;
const DEFAULT_OCCLUSION_SAMPLE_CAPACITY = 1_200;
const DEFAULT_MAX_SUBSYSTEMS = 16;
const DEFAULT_LONG_TASK_THRESHOLD_MS = 50;

function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function positiveInteger(value, fallback) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

export const DUNGEON_PERFORMANCE_FIXTURE_IDENTITY_FIELDS = Object.freeze([
  'worldKind',
  'layoutSeed',
  'basePlanHash',
  'augmentationPlanHash',
  'effectivePlanHash',
]);

export function isCompleteDungeonPerformanceFixtureIdentity(identity) {
  if (!identity || identity.worldKind !== 'dungeon') return false;
  return DUNGEON_PERFORMANCE_FIXTURE_IDENTITY_FIELDS
    .filter((field) => field !== 'worldKind')
    .every((field) => (
      typeof identity[field] === 'string' && identity[field].length > 0
    ));
}

export function dungeonPerformanceFixtureIdentitiesMatch(first, second) {
  return isCompleteDungeonPerformanceFixtureIdentity(first)
    && isCompleteDungeonPerformanceFixtureIdentity(second)
    && DUNGEON_PERFORMANCE_FIXTURE_IDENTITY_FIELDS.every((field) => (
      first[field] === second[field]
    ));
}

class BoundedNumericSeries {
  constructor(capacity) {
    this.capacity = positiveInteger(capacity, 1);
    this.values = new Float64Array(this.capacity);
    this.count = 0;
    this.nextIndex = 0;
    this.total = 0;
    this.maximum = 0;
  }

  add(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return false;
    if (this.count === this.capacity) {
      this.total -= this.values[this.nextIndex];
    } else {
      this.count += 1;
    }
    this.values[this.nextIndex] = numeric;
    this.total += numeric;
    this.nextIndex = (this.nextIndex + 1) % this.capacity;
    if (numeric > this.maximum) this.maximum = numeric;
    return true;
  }

  reset() {
    this.count = 0;
    this.nextIndex = 0;
    this.total = 0;
    this.maximum = 0;
  }

  summary({ suffix = 'Ms' } = {}) {
    const samples = new Array(this.count);
    const oldestIndex = this.count === this.capacity ? this.nextIndex : 0;
    for (let index = 0; index < this.count; index += 1) {
      samples[index] = this.values[(oldestIndex + index) % this.capacity];
    }
    samples.sort((left, right) => left - right);
    const key = (name) => `${name}${suffix}`;
    return {
      sampleCount: this.count,
      capacity: this.capacity,
      [key('mean')]: this.count > 0 ? this.total / this.count : 0,
      [key('p50')]: percentile(samples, 0.5),
      [key('p95')]: percentile(samples, 0.95),
      [key('p99')]: percentile(samples, 0.99),
      [key('max')]: this.count > 0 ? samples[samples.length - 1] : 0,
      lifetimeMax: this.maximum,
    };
  }
}

function collectionSize(value) {
  if (value == null) return 0;
  if (Number.isFinite(Number(value))) return Math.max(0, Math.trunc(Number(value)));
  if (Number.isFinite(Number(value.size))) return Math.max(0, Math.trunc(Number(value.size)));
  if (Number.isFinite(Number(value.length))) return Math.max(0, Math.trunc(Number(value.length)));
  return 0;
}

function isEffectivelyVisible(object, boundary = null) {
  let current = object;
  while (current) {
    if (current.visible === false) return false;
    if (current === boundary) break;
    current = current.parent;
  }
  return true;
}

function countSceneObjects(scene) {
  const counts = {
    objects: 0,
    meshes: 0,
    lights: 0,
    visibleLights: 0,
    shadowCastingLights: 0,
    shadowCastingObjects: 0,
  };
  scene?.traverse?.((object) => {
    counts.objects += 1;
    if (object?.isMesh) counts.meshes += 1;
    if (object?.isLight) {
      counts.lights += 1;
      if (isEffectivelyVisible(object, scene)) counts.visibleLights += 1;
      if (object.castShadow && isEffectivelyVisible(object, scene)) {
        counts.shadowCastingLights += 1;
      }
    } else if (object?.castShadow && isEffectivelyVisible(object, scene)) {
      counts.shadowCastingObjects += 1;
    }
  });
  return counts;
}

/**
 * Fixed-memory runtime telemetry for the shared dungeon renderer.
 *
 * Recording methods allocate nothing after a subsystem is first registered.
 * Snapshot allocation and scene traversal happen only when diagnostics are
 * explicitly requested, never during the production frame loop.
 */
export class DungeonPerformanceTelemetry {
  constructor({
    enabled = false,
    frameSampleCapacity = DEFAULT_FRAME_SAMPLE_CAPACITY,
    subsystemSampleCapacity = DEFAULT_SUBSYSTEM_SAMPLE_CAPACITY,
    occlusionSampleCapacity = DEFAULT_OCCLUSION_SAMPLE_CAPACITY,
    maxSubsystems = DEFAULT_MAX_SUBSYSTEMS,
    longTaskThresholdMs = DEFAULT_LONG_TASK_THRESHOLD_MS,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    PerformanceObserverClass = globalThis.PerformanceObserver,
    observeLongTasks = true,
  } = {}) {
    this.enabled = enabled === true;
    this.frameSamples = new BoundedNumericSeries(frameSampleCapacity);
    this.subsystemSampleCapacity = positiveInteger(
      subsystemSampleCapacity,
      DEFAULT_SUBSYSTEM_SAMPLE_CAPACITY,
    );
    this.occlusionCandidateSamples = new BoundedNumericSeries(occlusionSampleCapacity);
    this.occlusionAndLosSamples = new BoundedNumericSeries(occlusionSampleCapacity);
    this.pendingOcclusionAndLosMs = 0;
    this.pendingOcclusionAndLosSample = false;
    this.firstFrameSampleAtMs = null;
    this.lastFrameSampleAtMs = null;
    this.maximumFrameSampleGapMs = 0;
    this.totalFrameSampleCount = 0;
    this.maxSubsystems = positiveInteger(maxSubsystems, DEFAULT_MAX_SUBSYSTEMS);
    this.longTaskThresholdMs = finiteNonNegative(
      longTaskThresholdMs,
      DEFAULT_LONG_TASK_THRESHOLD_MS,
    );
    this.nowProvider = typeof now === 'function' ? now : () => Date.now();
    this.subsystems = new Map();
    this.longTasks = {
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    };
    this.longTaskObserver = null;
    this.longTaskObservationSupported = false;
    if (this.enabled && observeLongTasks) {
      this._installLongTaskObserver(PerformanceObserverClass);
    }
  }

  _installLongTaskObserver(PerformanceObserverClass) {
    if (typeof PerformanceObserverClass !== 'function') return false;
    try {
      const observer = new PerformanceObserverClass((list) => {
        for (const entry of list?.getEntries?.() ?? []) {
          const durationMs = Number(entry?.duration);
          if (!Number.isFinite(durationMs) || durationMs < this.longTaskThresholdMs) continue;
          this.longTasks.count += 1;
          this.longTasks.totalDurationMs += durationMs;
          this.longTasks.maxDurationMs = Math.max(this.longTasks.maxDurationMs, durationMs);
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
      this.longTaskObserver = observer;
      this.longTaskObservationSupported = true;
      return true;
    } catch {
      this.longTaskObserver = null;
      return false;
    }
  }

  now() {
    return Number(this.nowProvider()) || 0;
  }

  beginSubsystem() {
    return this.enabled ? this.now() : null;
  }

  endSubsystem(name, startedAtMs, endedAtMs = null) {
    if (!this.enabled) return false;
    if (!Number.isFinite(Number(startedAtMs))) return false;
    const resolvedEndedAtMs = endedAtMs == null ? this.now() : Number(endedAtMs);
    return this.recordSubsystem(
      name,
      Math.max(0, resolvedEndedAtMs - Number(startedAtMs)),
    );
  }

  recordFrame(durationMs) {
    if (!this.enabled) return false;
    const recorded = this.frameSamples.add(durationMs);
    if (recorded) {
      const sampledAtMs = this.now();
      this.firstFrameSampleAtMs ??= sampledAtMs;
      if (this.lastFrameSampleAtMs != null) {
        this.maximumFrameSampleGapMs = Math.max(
          this.maximumFrameSampleGapMs,
          Math.max(0, sampledAtMs - this.lastFrameSampleAtMs),
        );
      }
      this.lastFrameSampleAtMs = sampledAtMs;
      this.totalFrameSampleCount += 1;
    }
    if (this.pendingOcclusionAndLosSample) {
      this.occlusionAndLosSamples.add(this.pendingOcclusionAndLosMs);
    }
    this.pendingOcclusionAndLosMs = 0;
    this.pendingOcclusionAndLosSample = false;
    return recorded;
  }

  recordSubsystem(name, durationMs) {
    if (!this.enabled) return false;
    if (typeof name !== 'string' || name.length === 0) return false;
    let series = this.subsystems.get(name);
    if (!series) {
      if (this.subsystems.size >= this.maxSubsystems) return false;
      series = new BoundedNumericSeries(this.subsystemSampleCapacity);
      this.subsystems.set(name, series);
    }
    const recorded = series.add(durationMs);
    if (recorded && ['cameraOcclusion', 'targetScannerLos'].includes(name)) {
      this.pendingOcclusionAndLosMs += finiteNonNegative(durationMs);
      this.pendingOcclusionAndLosSample = true;
    }
    return recorded;
  }

  recordOcclusionCandidateCount(candidateCount) {
    return this.enabled && this.occlusionCandidateSamples.add(candidateCount);
  }

  resetSamples() {
    this.frameSamples.reset();
    this.occlusionCandidateSamples.reset();
    this.occlusionAndLosSamples.reset();
    this.pendingOcclusionAndLosMs = 0;
    this.pendingOcclusionAndLosSample = false;
    this.firstFrameSampleAtMs = null;
    this.lastFrameSampleAtMs = null;
    this.maximumFrameSampleGapMs = 0;
    this.totalFrameSampleCount = 0;
    for (const series of this.subsystems.values()) series.reset();
    this.longTasks.count = 0;
    this.longTasks.totalDurationMs = 0;
    this.longTasks.maxDurationMs = 0;
  }

  getSnapshot({
    renderer = null,
    scene = null,
    activeRoot = null,
    localLights = [],
    cullGroups = [],
    cullStats = null,
    quality = null,
    retainedResources = null,
    disposableResources = null,
    provenance = null,
  } = {}) {
    const sceneCounts = countSceneObjects(scene);
    const activeRootCounts = countSceneObjects(activeRoot);
    const visibleLocalLightCount = [...(localLights ?? [])]
      .filter((light) => light?.isLight && isEffectivelyVisible(light, activeRoot)).length;
    const subsystemTimings = {};
    for (const [name, series] of [...this.subsystems.entries()]
      .sort(([left], [right]) => left.localeCompare(right))) {
      subsystemTimings[name] = series.summary();
    }
    const renderInfo = renderer?.info ?? {};
    const retained = retainedResources ?? {};
    const retainedCounts = {
      geometries: collectionSize(retained.geometries),
      materials: collectionSize(retained.materials),
      textures: collectionSize(retained.textures),
      renderTargets: collectionSize(retained.renderTargets),
    };
    retainedCounts.total = Object.values(retainedCounts)
      .reduce((total, count) => total + count, 0);
    const totalCullGroups = collectionSize(cullGroups);
    const visibleCullGroups = Number.isFinite(Number(cullStats?.visibleGroupCount))
      ? Math.max(0, Math.trunc(Number(cullStats.visibleGroupCount)))
      : [...(cullGroups ?? [])].filter((entry) => (entry?.group ?? entry)?.visible !== false).length;
    const hiddenCullGroups = Number.isFinite(Number(cullStats?.hiddenGroupCount))
      ? Math.max(0, Math.trunc(Number(cullStats.hiddenGroupCount)))
      : Math.max(0, totalCullGroups - visibleCullGroups);

    return {
      schema: 'ruindivex-dungeon-performance/v1',
      frames: {
        ...this.frameSamples.summary(),
        totalSampleCount: this.totalFrameSampleCount,
        sampleSpanMs: this.firstFrameSampleAtMs == null
          || this.lastFrameSampleAtMs == null
          ? 0
          : Math.max(0, this.lastFrameSampleAtMs - this.firstFrameSampleAtMs),
        maxSampleGapMs: this.maximumFrameSampleGapMs,
      },
      longTasks: {
        count: this.longTasks.count,
        totalDurationMs: this.longTasks.totalDurationMs,
        maxDurationMs: this.longTasks.maxDurationMs,
        thresholdMs: this.longTaskThresholdMs,
        observing: Boolean(this.longTaskObserver),
        supported: this.longTaskObservationSupported,
      },
      subsystemTimings,
      renderer: {
        calls: finiteNonNegative(renderInfo.render?.calls),
        triangles: finiteNonNegative(renderInfo.render?.triangles),
        geometries: finiteNonNegative(renderInfo.memory?.geometries),
        textures: finiteNonNegative(renderInfo.memory?.textures),
      },
      lighting: {
        visibleLights: sceneCounts.visibleLights,
        visibleLocalLights: visibleLocalLightCount,
        shadowCastingLights: sceneCounts.shadowCastingLights,
        shadowCastingObjects: sceneCounts.shadowCastingObjects,
      },
      culling: {
        totalChunks: totalCullGroups,
        visibleChunks: visibleCullGroups,
        hiddenChunks: hiddenCullGroups,
        visibleDrawObjects: finiteNonNegative(cullStats?.visibleDrawObjectCount),
        hiddenDrawObjects: finiteNonNegative(cullStats?.hiddenDrawObjectCount),
      },
      occlusionCandidates: this.occlusionCandidateSamples.summary({ suffix: '' }),
      occlusionAndLos: this.occlusionAndLosSamples.summary(),
      scene: sceneCounts,
      activeRoot: activeRootCounts,
      resources: {
        retained: retainedCounts,
        disposableResourceCount: collectionSize(disposableResources),
      },
      quality: quality == null ? null : structuredClone(quality),
      provenance: provenance == null ? null : structuredClone(provenance),
    };
  }

  dispose() {
    this.longTaskObserver?.disconnect?.();
    this.longTaskObserver = null;
  }
}

export const DUNGEON_PERFORMANCE_TELEMETRY_DEFAULTS = Object.freeze({
  frameSampleCapacity: DEFAULT_FRAME_SAMPLE_CAPACITY,
  subsystemSampleCapacity: DEFAULT_SUBSYSTEM_SAMPLE_CAPACITY,
  occlusionSampleCapacity: DEFAULT_OCCLUSION_SAMPLE_CAPACITY,
  maxSubsystems: DEFAULT_MAX_SUBSYSTEMS,
  longTaskThresholdMs: DEFAULT_LONG_TASK_THRESHOLD_MS,
});

export const DUNGEON_RUNTIME_RELEASE_LIMITS = Object.freeze({
  minimumFrameSamples: 1_800,
  minimumOcclusionAndLosSamples: 600,
  minimumFrameSampleSpanMs: 59_000,
  minimumSampleDurationMs: 60_000,
  maximumFrameSampleGapMs: 250,
  frameP95Ms: 33.3,
  frameP99Ms: 50,
  rendererCalls: 500,
  visibleLocalLights: 8,
  shadowCastingLights: 1,
  controllerP95Ms: 10,
  occlusionAndLosP95Ms: 2,
  spatialCandidateP95: 64,
  longTaskMaxMs: 50,
});

/** Evaluates one warmed fixed-fixture snapshot against the 30 FPS release gate. */
export function evaluateDungeonRuntimeReleaseGate(snapshot, {
  limits = DUNGEON_RUNTIME_RELEASE_LIMITS,
} = {}) {
  const source = snapshot ?? {};
  const metric = (value) => Number.isFinite(Number(value)) ? Number(value) : Infinity;
  const controllerP95Ms = metric(
    source.subsystemTimings?.controllerUpdate?.p95Ms,
  );
  const occlusionAndLosP95Ms = metric(source.occlusionAndLos?.p95Ms);
  const supportedTiers = new Set(['High', 'Balanced', 'Performance']);
  const provenance = source.provenance ?? {};
  const checks = {
    snapshotSchema: source.schema === 'ruindivex-dungeon-performance/v1',
    fixedFixtureProvenance: provenance.sampleKind === 'fixed-fixture'
      && typeof provenance.fixtureId === 'string'
      && provenance.fixtureId.length > 0,
    completeFixtureProvenance:
      isCompleteDungeonPerformanceFixtureIdentity(provenance.fixtureIdentity)
      && isCompleteDungeonPerformanceFixtureIdentity(provenance.currentFixtureIdentity),
    stableFixtureProvenance:
      typeof provenance.currentFixtureId === 'string'
      && provenance.currentFixtureId === provenance.fixtureId
      && dungeonPerformanceFixtureIdentitiesMatch(
        provenance.fixtureIdentity,
        provenance.currentFixtureIdentity,
      ),
    qualityTierProvenance: supportedTiers.has(provenance.qualityTier),
    qualityTierMatchesCapture: supportedTiers.has(provenance.qualityTier)
      && source.quality?.tier === provenance.qualityTier,
    warmedSampleProvenance: provenance.warmupCompleted === true
      && metric(provenance.sampleDurationMs) >= limits.minimumSampleDurationMs,
    longTaskObservationSupported: source.longTasks?.supported === true
      && source.longTasks?.observing === true,
    frameSampleCount: metric(source.frames?.sampleCount)
      >= limits.minimumFrameSamples,
    frameSampleSpan: metric(source.frames?.sampleSpanMs)
      >= limits.minimumFrameSampleSpanMs,
    frameSampleGap: metric(source.frames?.maxSampleGapMs)
      <= limits.maximumFrameSampleGapMs,
    occlusionAndLosSampleCount: metric(source.occlusionAndLos?.sampleCount)
      >= limits.minimumOcclusionAndLosSamples,
    frameP95: metric(source.frames?.p95Ms) <= limits.frameP95Ms,
    frameP99: metric(source.frames?.p99Ms) <= limits.frameP99Ms,
    rendererCalls: metric(source.renderer?.calls) <= limits.rendererCalls,
    visibleLocalLights: metric(source.lighting?.visibleLocalLights)
      <= limits.visibleLocalLights,
    shadowCastingLights: metric(source.lighting?.shadowCastingLights)
      <= limits.shadowCastingLights,
    controllerP95: controllerP95Ms <= limits.controllerP95Ms,
    occlusionAndLosP95: occlusionAndLosP95Ms <= limits.occlusionAndLosP95Ms,
    spatialCandidateP95: metric(source.occlusionCandidates?.p95)
      <= limits.spatialCandidateP95,
    longTaskMaximum: metric(source.longTasks?.maxDurationMs)
      <= limits.longTaskMaxMs,
  };
  const errors = Object.entries(checks)
    .filter(([, accepted]) => !accepted)
    .map(([name]) => name);
  return Object.freeze({
    schema: 'ruindivex-dungeon-runtime-release-gate/v1',
    accepted: errors.length === 0,
    errors: Object.freeze(errors),
    checks: Object.freeze(checks),
    measurements: Object.freeze({
      frameSampleCount: metric(source.frames?.sampleCount),
      frameSampleSpanMs: metric(source.frames?.sampleSpanMs),
      frameSampleGapMaxMs: metric(source.frames?.maxSampleGapMs),
      occlusionAndLosSampleCount: metric(source.occlusionAndLos?.sampleCount),
      frameP95Ms: metric(source.frames?.p95Ms),
      frameP99Ms: metric(source.frames?.p99Ms),
      rendererCalls: metric(source.renderer?.calls),
      visibleLocalLights: metric(source.lighting?.visibleLocalLights),
      shadowCastingLights: metric(source.lighting?.shadowCastingLights),
      controllerP95Ms,
      occlusionAndLosP95Ms,
      spatialCandidateP95: metric(source.occlusionCandidates?.p95),
      longTaskMaxMs: metric(source.longTasks?.maxDurationMs),
      sampleDurationMs: metric(provenance.sampleDurationMs),
    }),
    limits,
  });
}
