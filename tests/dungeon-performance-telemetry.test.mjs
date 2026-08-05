import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DUNGEON_PERFORMANCE_TELEMETRY_DEFAULTS,
  DungeonPerformanceTelemetry,
  dungeonPerformanceFixtureIdentitiesMatch,
  evaluateDungeonRuntimeReleaseGate,
  isCompleteDungeonPerformanceFixtureIdentity,
} from '../src/dungeon-augmentation/DungeonPerformanceTelemetry.js';

class FakePerformanceObserver {
  static latest = null;

  constructor(callback) {
    this.callback = callback;
    this.observed = null;
    this.disconnected = false;
    FakePerformanceObserver.latest = this;
  }

  observe(options) {
    this.observed = options;
  }

  emit(entries) {
    this.callback({ getEntries: () => entries });
  }

  disconnect() {
    this.disconnected = true;
  }
}

function traversable(objects) {
  return {
    visible: true,
    parent: null,
    traverse(callback) {
      for (const object of objects) callback(object);
    },
  };
}

const completeFixtureIdentity = Object.freeze({
  worldKind: 'dungeon',
  layoutSeed: 'layout:performance-fixture',
  basePlanHash: 'v1-base-performance-fixture',
  augmentationPlanHash: 'v1-augmentation-performance-fixture',
  effectivePlanHash: 'v1-effective-performance-fixture',
});

test('telemetry retains fixed-size frame, subsystem, and occlusion windows', () => {
  let nowMs = 100;
  const telemetry = new DungeonPerformanceTelemetry({
    enabled: true,
    frameSampleCapacity: 4,
    subsystemSampleCapacity: 3,
    occlusionSampleCapacity: 4,
    maxSubsystems: 2,
    now: () => nowMs,
    observeLongTasks: false,
  });

  for (const duration of [10, 20, 30, 40, 50]) telemetry.recordFrame(duration);
  for (const duration of [1, 2, 3, 4]) telemetry.recordSubsystem('controllerUpdate', duration);
  assert.equal(telemetry.recordSubsystem('cameraOcclusion', 2), true);
  assert.equal(telemetry.recordSubsystem('unbounded-third-name', 1), false);
  for (const count of [1, 2, 3, 100, 4]) telemetry.recordOcclusionCandidateCount(count);

  const startedAtMs = telemetry.beginSubsystem();
  nowMs = 108;
  telemetry.endSubsystem('controllerUpdate', startedAtMs);
  const snapshot = telemetry.getSnapshot();

  assert.deepEqual(snapshot.frames, {
    sampleCount: 4,
    capacity: 4,
    meanMs: 35,
    p50Ms: 30,
    p95Ms: 50,
    p99Ms: 50,
    maxMs: 50,
    lifetimeMax: 50,
    totalSampleCount: 5,
    sampleSpanMs: 0,
    maxSampleGapMs: 0,
  });
  assert.equal(snapshot.subsystemTimings.controllerUpdate.sampleCount, 3);
  assert.equal(snapshot.subsystemTimings.controllerUpdate.p50Ms, 4);
  assert.equal(snapshot.subsystemTimings.controllerUpdate.p95Ms, 8);
  assert.equal(snapshot.occlusionCandidates.sampleCount, 4);
  assert.equal(snapshot.occlusionCandidates.p95, 100);
  assert.equal(Object.hasOwn(snapshot.subsystemTimings, 'unbounded-third-name'), false);
});

test('default telemetry retains 60 seconds at 240 Hz and records the maximum sample gap', () => {
  let nowMs = 0;
  const telemetry = new DungeonPerformanceTelemetry({
    enabled: true,
    now: () => nowMs,
    observeLongTasks: false,
  });
  const frameDurationMs = 1_000 / 240;
  for (let index = 0; index < 14_400; index += 1) {
    nowMs = index * frameDurationMs;
    telemetry.recordFrame(frameDurationMs);
    telemetry.recordSubsystem('controllerUpdate', 0.25);
  }

  const completeWindow = telemetry.getSnapshot();
  assert.equal(
    DUNGEON_PERFORMANCE_TELEMETRY_DEFAULTS.frameSampleCapacity,
    14_400,
  );
  assert.equal(
    DUNGEON_PERFORMANCE_TELEMETRY_DEFAULTS.subsystemSampleCapacity,
    14_400,
  );
  assert.equal(completeWindow.frames.sampleCount, 14_400);
  assert.equal(completeWindow.frames.totalSampleCount, 14_400);
  assert.equal(completeWindow.subsystemTimings.controllerUpdate.sampleCount, 14_400);
  assert.ok(completeWindow.frames.sampleSpanMs >= 59_995);
  assert.ok(completeWindow.frames.maxSampleGapMs <= frameDurationMs + 1e-9);

  nowMs += 500;
  telemetry.recordFrame(frameDurationMs);
  assert.equal(telemetry.getSnapshot().frames.maxSampleGapMs, 500);
  telemetry.resetSamples();
  assert.equal(telemetry.getSnapshot().frames.maxSampleGapMs, 0);
});

test('fixture identity helpers require a complete stable augmented dungeon identity', () => {
  assert.equal(isCompleteDungeonPerformanceFixtureIdentity(completeFixtureIdentity), true);
  assert.equal(
    dungeonPerformanceFixtureIdentitiesMatch(
      completeFixtureIdentity,
      structuredClone(completeFixtureIdentity),
    ),
    true,
  );
  assert.equal(isCompleteDungeonPerformanceFixtureIdentity({
    ...completeFixtureIdentity,
    augmentationPlanHash: null,
  }), false);
  assert.equal(dungeonPerformanceFixtureIdentitiesMatch(
    completeFixtureIdentity,
    { ...completeFixtureIdentity, effectivePlanHash: 'v1-drifted' },
  ), false);
});

test('optional long-task observation tracks count, maximum, and total without retaining entries', () => {
  const telemetry = new DungeonPerformanceTelemetry({
    enabled: true,
    PerformanceObserverClass: FakePerformanceObserver,
    longTaskThresholdMs: 50,
  });
  assert.deepEqual(FakePerformanceObserver.latest.observed, {
    type: 'longtask',
    buffered: true,
  });

  FakePerformanceObserver.latest.emit([
    { duration: 49.9 },
    { duration: 50 },
    { duration: 75 },
    { duration: Number.NaN },
  ]);
  const snapshot = telemetry.getSnapshot();
  assert.deepEqual(snapshot.longTasks, {
    count: 2,
    totalDurationMs: 125,
    maxDurationMs: 75,
    thresholdMs: 50,
    observing: true,
    supported: true,
  });

  const observer = FakePerformanceObserver.latest;
  telemetry.dispose();
  assert.equal(observer.disconnected, true);
  assert.equal(telemetry.getSnapshot().longTasks.observing, false);
});

test('diagnostic snapshots collect renderer, scene, light, cull, quality, and resource counters on demand', () => {
  const scene = traversable([]);
  const activeRoot = traversable([]);
  activeRoot.parent = scene;
  const visibleMesh = { isMesh: true, castShadow: true, visible: true, parent: activeRoot };
  const visibleLocalLight = {
    isLight: true,
    castShadow: true,
    visible: true,
    parent: activeRoot,
  };
  const hiddenOwner = { visible: false, parent: activeRoot };
  const hiddenLocalLight = {
    isLight: true,
    castShadow: false,
    visible: true,
    parent: hiddenOwner,
  };
  activeRoot.traverse = (callback) => {
    for (const object of [activeRoot, visibleMesh, visibleLocalLight, hiddenOwner, hiddenLocalLight]) {
      callback(object);
    }
  };
  scene.traverse = (callback) => {
    callback(scene);
    activeRoot.traverse(callback);
  };

  const telemetry = new DungeonPerformanceTelemetry({
    enabled: true,
    observeLongTasks: false,
  });
  const quality = { mode: 'Auto', tier: 'Balanced', settings: { dprCap: 1.25 } };
  const snapshot = telemetry.getSnapshot({
    renderer: {
      info: {
        render: { calls: 321, triangles: 12_345 },
        memory: { geometries: 44, textures: 12 },
      },
    },
    scene,
    activeRoot,
    localLights: [visibleLocalLight, hiddenLocalLight],
    cullGroups: [
      { group: { visible: true } },
      { group: { visible: false } },
      { group: { visible: false } },
    ],
    cullStats: {
      visibleGroupCount: 1,
      hiddenGroupCount: 2,
      visibleDrawObjectCount: 10,
      hiddenDrawObjectCount: 20,
    },
    quality,
    retainedResources: {
      geometries: new Set([{}, {}]),
      materials: new Set([{}]),
      textures: new Set([{}, {}, {}]),
      renderTargets: new Set([{}]),
    },
    disposableResources: [{}, {}, {}, {}],
  });

  assert.equal(snapshot.schema, 'ruindivex-dungeon-performance/v1');
  assert.deepEqual(snapshot.renderer, {
    calls: 321,
    triangles: 12_345,
    geometries: 44,
    textures: 12,
  });
  assert.deepEqual(snapshot.lighting, {
    visibleLights: 1,
    visibleLocalLights: 1,
    shadowCastingLights: 1,
    shadowCastingObjects: 1,
  });
  assert.deepEqual(snapshot.culling, {
    totalChunks: 3,
    visibleChunks: 1,
    hiddenChunks: 2,
    visibleDrawObjects: 10,
    hiddenDrawObjects: 20,
  });
  assert.equal(snapshot.scene.objects, 6);
  assert.equal(snapshot.scene.meshes, 1);
  assert.equal(snapshot.scene.lights, 2);
  assert.equal(snapshot.resources.retained.total, 7);
  assert.equal(snapshot.resources.disposableResourceCount, 4);
  assert.deepEqual(snapshot.quality, quality);
  assert.notEqual(snapshot.quality, quality);
});

test('runtime release gate enforces every fixed-fixture performance limit', () => {
  const passing = {
    schema: 'ruindivex-dungeon-performance/v1',
    provenance: {
      sampleKind: 'fixed-fixture',
      fixtureId: 'fixture-hash',
      fixtureIdentity: completeFixtureIdentity,
      currentFixtureId: 'fixture-hash',
      currentFixtureIdentity: completeFixtureIdentity,
      qualityTier: 'High',
      warmupCompleted: true,
      sampleDurationMs: 60_000,
    },
    frames: {
      sampleCount: 1_800,
      sampleSpanMs: 59_000,
      maxSampleGapMs: 250,
      p95Ms: 33.3,
      p99Ms: 50,
    },
    longTasks: { maxDurationMs: 50, supported: true, observing: true },
    subsystemTimings: {
      controllerUpdate: { p95Ms: 10 },
    },
    occlusionAndLos: { sampleCount: 600, p95Ms: 2 },
    quality: { tier: 'High' },
    renderer: { calls: 500 },
    lighting: { visibleLocalLights: 8, shadowCastingLights: 1 },
    occlusionCandidates: { p95: 64 },
  };
  const accepted = evaluateDungeonRuntimeReleaseGate(passing);
  assert.equal(accepted.accepted, true);
  assert.deepEqual(accepted.errors, []);

  const rejected = evaluateDungeonRuntimeReleaseGate({
    ...passing,
    frames: {
      sampleCount: 1_799,
      sampleSpanMs: 58_999,
      maxSampleGapMs: 250.01,
      p95Ms: 33.31,
      p99Ms: 50.01,
    },
    longTasks: { maxDurationMs: 50.01, supported: true, observing: true },
    subsystemTimings: {
      controllerUpdate: { p95Ms: 10.01 },
    },
    occlusionAndLos: { sampleCount: 599, p95Ms: 2.01 },
    quality: { tier: 'Balanced' },
    renderer: { calls: 501 },
    lighting: { visibleLocalLights: 9, shadowCastingLights: 2 },
    occlusionCandidates: { p95: 65 },
  });
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.errors, [
    'qualityTierMatchesCapture',
    'frameSampleCount',
    'frameSampleSpan',
    'frameSampleGap',
    'occlusionAndLosSampleCount',
    'frameP95',
    'frameP99',
    'rendererCalls',
    'visibleLocalLights',
    'shadowCastingLights',
    'controllerP95',
    'occlusionAndLosP95',
    'spatialCandidateP95',
    'longTaskMaximum',
  ]);

  const driftedFixture = evaluateDungeonRuntimeReleaseGate({
    ...passing,
    provenance: {
      ...passing.provenance,
      currentFixtureId: 'drifted-fixture-hash',
      currentFixtureIdentity: {
        ...completeFixtureIdentity,
        effectivePlanHash: 'v1-drifted',
      },
    },
  });
  assert.deepEqual(driftedFixture.errors, ['stableFixtureProvenance']);

  const incompleteFixture = evaluateDungeonRuntimeReleaseGate({
    ...passing,
    provenance: {
      ...passing.provenance,
      fixtureIdentity: { ...completeFixtureIdentity, augmentationPlanHash: null },
      currentFixtureIdentity: { ...completeFixtureIdentity, augmentationPlanHash: null },
    },
  });
  assert.deepEqual(incompleteFixture.errors, [
    'completeFixtureProvenance',
    'stableFixtureProvenance',
  ]);
});

test('runtime release gate fails closed without supported observation and sample provenance', () => {
  const result = evaluateDungeonRuntimeReleaseGate({
    schema: 'ruindivex-dungeon-performance/v1',
    frames: {
      sampleCount: 1_800,
      sampleSpanMs: 59_000,
      maxSampleGapMs: 16,
      p95Ms: 10,
      p99Ms: 12,
    },
    longTasks: { maxDurationMs: 0, supported: false, observing: false },
    subsystemTimings: { controllerUpdate: { p95Ms: 1 } },
    occlusionAndLos: { sampleCount: 600, p95Ms: 0.5 },
    quality: { tier: 'High' },
    renderer: { calls: 1 },
    lighting: { visibleLocalLights: 1, shadowCastingLights: 1 },
    occlusionCandidates: { p95: 1 },
  });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.errors, [
    'fixedFixtureProvenance',
    'completeFixtureProvenance',
    'stableFixtureProvenance',
    'qualityTierProvenance',
    'qualityTierMatchesCapture',
    'warmedSampleProvenance',
    'longTaskObservationSupported',
  ]);
});

test('combined occlusion and LOS samples are summed within the same recorded frame', () => {
  const telemetry = new DungeonPerformanceTelemetry({
    enabled: true,
    observeLongTasks: false,
  });
  telemetry.recordSubsystem('cameraOcclusion', 1.1);
  telemetry.recordSubsystem('targetScannerLos', 0.9);
  telemetry.recordFrame(16);
  telemetry.recordSubsystem('targetScannerLos', 0.4);
  telemetry.recordFrame(16);

  const snapshot = telemetry.getSnapshot();
  assert.equal(snapshot.occlusionAndLos.sampleCount, 2);
  assert.equal(snapshot.occlusionAndLos.p50Ms, 0.4);
  assert.equal(snapshot.occlusionAndLos.p95Ms, 2);
});
