import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  DUNGEON_SELECTION_BAG_FAMILIES,
  createDungeonSelectionBagWitness,
} from '../src/dungeon-augmentation/selectionBagWitness.js';

import {
  EXPECTED_ELEVATION_MODES,
  EXPECTED_ENCOUNTER_PROFILE_IDS,
  EXPECTED_JUNCTION_KINDS,
  EXPECTED_ROOM_LAYOUT_IDS,
  EXPECTED_TOPOLOGY_TEMPLATE_IDS,
  RELEASE_AUGMENTATION_REALIZATION_ATTEMPT_LIMIT,
  RELEASE_CANONICAL_PROBES,
  RELEASE_GENERATOR_PHASE_TIMING_SCHEMA,
  RELEASE_PERFORMANCE_BUDGET_MS,
  RELEASE_PHASE_HEARTBEAT_SCHEMA,
  RELEASE_PROFILE_ID,
  RELEASE_PROFILE_REVISION,
  RELEASE_PREDECESSOR_STAGE_IDS,
  RELEASE_REQUIRED_SUITE_IDS,
  RELEASE_REFERENCE_MACHINE,
  RELEASE_SHARD_TOPOLOGY,
  RELEASE_SUITE_CONTRACTS,
  RELEASE_WARM_PROCESS_EVIDENCE_SCHEMA,
  RELEASE_WARM_PROCESS_MODE,
  aggregateShardEvidence,
  assertCleanReleaseProvenance,
  assertMatchingReleaseProvenance,
  assertSealedEvidence,
  createAcceptedParentWitness,
  captureReleaseDungeonGeneratorMetrics,
  createCanonicalProbeEvidence,
  createCorpusManifest,
  createReleaseAttestation,
  createReleaseArtifactIdentity,
  createReleasePhaseHeartbeatReporter,
  createReleaseSuiteReceipt,
  createReleaseWorkerFailureDiagnostics,
  createSeedWorkerEvidence,
  createShardEvidence,
  hashCanonicalValue,
  inspectReleaseSeedWorkerRecordPublication,
  readReleasePhaseHeartbeat,
  releaseSourceDirtyFromGitStatusResult,
  runReleaseSeedWorkerProcess,
  sealEvidence,
  selectCorpusEntries,
  validateAggregateEvidenceForCurrentProvenance,
  validateAcceptedParentWitness,
  validateCorpusManifest,
  validateCompletedReleaseWorkerPhaseEvidence,
  validateReleasePredecessorEvidenceCollection,
  validateReleaseAttestation,
  validateReleaseSuiteReceipt,
  validateSeedWorkerEvidence,
  validateShardArtifactCollection,
  validateShardEvidence,
  writeImmutableJson,
} from '../scripts/dungeon-augmentation-release-evidence.mjs';
import {
  RELEASE_PARENT_SNAPSHOT_MAX_CONCURRENCY,
  RELEASE_PARENT_SNAPSHOT_WORKER_KIND,
  collectOrderedAcceptedParentSnapshots,
  createReleaseParentSnapshotWorkerPool,
  resolveReleaseParentSnapshotConcurrency,
} from '../scripts/dungeon-augmentation-parent-snapshot-pool.mjs';

const provenance = Object.freeze({
  gitCommit: '0123456789abcdef',
  gitBranch: 'test',
  sourceDirty: false,
  sourceHash: 'sha256-test-sources',
  sourceFileCount: 1,
  nodeVersion: RELEASE_REFERENCE_MACHINE.nodeVersion,
  platform: RELEASE_REFERENCE_MACHINE.platform,
  machine: Object.freeze({
    cpuModel: RELEASE_REFERENCE_MACHINE.cpuModel,
    logicalCpuCount: RELEASE_REFERENCE_MACHINE.logicalCpuCount,
    totalMemoryBytes: RELEASE_REFERENCE_MACHINE.totalMemoryBytes,
  }),
  profile: Object.freeze({
    id: RELEASE_PROFILE_ID,
    revision: RELEASE_PROFILE_REVISION,
    hash: 'sha256-test-profile',
  }),
});

function createParentWitness(index) {
  const seed = `layout:augmentation-realized-v4-${String(index).padStart(3, '0')}`;
  return createAcceptedParentWitness({
    basePlanHash: `v1:${seed}:depth:1:revolvingFusillade`,
    generationAttempts: 1,
    rooms: [{ id: `room-${index}`, x: index, z: 0, width: 5, depth: 5 }],
    connectionPlans: [],
  }, 100 + index);
}

function resealParentWitness(witness) {
  const { hash: _hash, ...payload } = witness;
  return {
    ...payload,
    hash: hashCanonicalValue(
      payload,
      'dungeon-augmentation-v4-release-evidence-v1:accepted-parent',
    ),
  };
}

function createManifest(
  generatedAt = '2026-07-31T00:00:00.000Z',
  manifestProvenance = provenance,
) {
  const count = 1000;
  const entries = Array.from({ length: count }, (_, ordinal) => ({
    ordinal,
    rawIndex: ordinal,
    seed: `layout:augmentation-realized-v4-${String(ordinal).padStart(3, '0')}`,
    basePlanHash: `v1:layout:augmentation-realized-v4-${String(ordinal).padStart(3, '0')}:depth:1:revolvingFusillade`,
    parentWitness: createParentWitness(ordinal),
  }));
  return createCorpusManifest({
    tier: 'release',
    rawStartIndex: 0,
    rawEndIndexExclusive: count,
    requestedAcceptedParentCount: count,
    entries,
    skippedParentSeeds: [],
    provenance: manifestProvenance,
    generatedAt,
  });
}

function createSelectionBagWitnesses() {
  return Object.fromEntries(DUNGEON_SELECTION_BAG_FAMILIES.map((family) => {
    const firstId = `${family}-a`;
    const secondId = `${family}-b`;
    return [family, [createDungeonSelectionBagWitness({
      family,
      bag: {
        order: [firstId, secondId],
        cycle: 0,
        consumedIds: [],
      },
      legalIds: [firstId, secondId],
      selection: {
        id: firstId,
        refilled: false,
        state: {
          order: [firstId, secondId],
          cycle: 0,
          consumedIds: [firstId],
        },
      },
    })]];
  }));
}

function createGeneratorPhaseTimings({
  parentGenerationMs = 100,
  planningMs = 50,
  materializationMs = 25,
  threeJsAssemblyMs = 25,
  strictValidationMs = 25,
  disposalMs = 25,
  planningTimeMs = 75,
  assemblyTimeMs = 30,
} = {}) {
  return {
    schema: RELEASE_GENERATOR_PHASE_TIMING_SCHEMA,
    parentGenerationMs,
    planningMs,
    materializationMs,
    threeJsAssemblyMs,
    strictValidationMs,
    disposalMs,
    totalMs: parentGenerationMs
      + planningMs
      + materializationMs
      + threeJsAssemblyMs
      + strictValidationMs
      + disposalMs,
    planningTimeMs,
    assemblyTimeMs,
  };
}

function createPhaseSnapshot(entry, {
  targetStarted = false,
  phase = 'planning',
  status = 'started',
  phaseElapsedMs = 5_000,
} = {}) {
  const warmupOrdinal = (entry.ordinal + 1) % 1000;
  const phaseStartedEpochMs = 1_000;
  return {
    schema: RELEASE_PHASE_HEARTBEAT_SCHEMA,
    sequence: 0,
    phase,
    status,
    phaseStartedEpochMs,
    emittedAtEpochMs: phaseStartedEpochMs,
    phaseElapsedMs,
    targetStarted,
    targetOrdinal: entry.ordinal,
    targetSeed: entry.seed,
    warmupOrdinal,
    warmupSeed: `layout:augmentation-realized-v4-${String(warmupOrdinal).padStart(3, '0')}`,
    phaseTimings: createGeneratorPhaseTimings({
      planningTimeMs: null,
      assemblyTimeMs: null,
    }),
    observedAtEpochMs: phaseStartedEpochMs + phaseElapsedMs,
  };
}

function createWarmProcessEvidence(entry) {
  const warmupOrdinal = (entry.ordinal + 1) % 1000;
  const warmupWitness = createParentWitness(warmupOrdinal);
  const warmupSeed = `layout:augmentation-realized-v4-${String(warmupOrdinal).padStart(3, '0')}`;
  return {
    schema: RELEASE_WARM_PROCESS_EVIDENCE_SCHEMA,
    mode: RELEASE_WARM_PROCESS_MODE,
    completed: true,
    includedInTargetTiming: false,
    targetTimingStartedAfterWarmup: true,
    workerIsolation: 'one-timed-target-per-process',
    watchdogScope: 'warmup-and-target-process',
    watchdogTimeoutMs: RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed,
    targetOrdinal: entry.ordinal,
    warmupOrdinal,
    warmupRawIndex: warmupOrdinal,
    warmupSeed,
    warmupBasePlanHash: `v1:${warmupSeed}:depth:1:revolvingFusillade`,
    warmupParentWitnessHash: warmupWitness.hash,
    warmupSourceRandomCalls: warmupWitness.sourceRandomCalls,
    warmupAugmentationStatus: 'applied',
    warmupRealizationAttempts: 1,
    diagnosticElapsedMs: 250,
    generatorPhaseTimings: createGeneratorPhaseTimings(),
  };
}

function createRecord(entry, ordinal = entry.ordinal) {
  return {
    ordinal,
    rawIndex: entry.rawIndex,
    seed: entry.seed,
    basePlanHash: entry.basePlanHash,
    parentWitnessHash: entry.parentWitness.hash,
    sourceRandomCalls: entry.parentWitness.sourceRandomCalls,
    acceptedParentParity: true,
    status: 'applied',
    realizationAttempts: 1,
    releaseValidationAccepted: true,
    releaseValidationErrorCount: 0,
    acceptedAsPlayableAlpha: false,
    strictRealizedAccepted: true,
    elapsedMs: 8_000,
    elapsedPhases: {
      generationMs: 7_500,
      strictValidationMs: 500,
      disposalMs: 0,
      totalMs: 8_000,
    },
    generatorPhaseTimings: createGeneratorPhaseTimings(),
    topologyTemplateSelections: [
      EXPECTED_TOPOLOGY_TEMPLATE_IDS[ordinal % EXPECTED_TOPOLOGY_TEMPLATE_IDS.length],
    ],
    junctionKindSelections: [
      EXPECTED_JUNCTION_KINDS[ordinal % EXPECTED_JUNCTION_KINDS.length],
    ],
    elevationModeSelections: [
      EXPECTED_ELEVATION_MODES[ordinal % EXPECTED_ELEVATION_MODES.length],
    ],
    encounterProfileSelections: [
      EXPECTED_ENCOUNTER_PROFILE_IDS[ordinal % EXPECTED_ENCOUNTER_PROFILE_IDS.length],
    ],
    roomLayoutSelections: [
      EXPECTED_ROOM_LAYOUT_IDS[ordinal % EXPECTED_ROOM_LAYOUT_IDS.length],
    ],
    selectionBagWitnesses: createSelectionBagWitnesses(),
    completeLayoutSignatures: [`signature-${ordinal}`],
    warmProcessEvidence: createWarmProcessEvidence(entry),
  };
}

function createShard(manifest, selection, records = null, {
  result = 'passed',
  shardProvenance = manifest.provenance,
  failure = null,
} = {}) {
  const failedEntry = selection.entries[0];
  const resolvedFailure = result === 'failed'
    ? failure ?? createReleaseWorkerFailureDiagnostics({
        errorName: 'SyntheticWorkerFailure',
        message: 'Synthetic release worker failed.',
        entry: failedEntry,
        timedOut: true,
        lastPhaseEvidence: createPhaseSnapshot(failedEntry),
      })
    : null;
  return createShardEvidence({
    manifest,
    selection,
    provenance: shardProvenance,
    records: records ?? selection.entries.map((entry) => createRecord(entry)),
    result,
    failure: resolvedFailure,
    generatedAt: '2026-07-31T00:01:00.000Z',
  });
}

function createPassingAggregate(manifest, tier) {
  const topology = RELEASE_SHARD_TOPOLOGY[tier];
  const shards = Array.from({ length: topology.shardCount }, (_, shardIndex) => {
    const selection = selectCorpusEntries(manifest, {
      tier,
      shardIndex,
      shardCount: topology.shardCount,
    });
    return createShard(manifest, selection);
  });
  return aggregateShardEvidence({
    manifest,
    shards,
    generatedAt: `2026-07-31T00:0${tier === 'smoke' ? 2 : tier === 'normal' ? 3 : 4}:00.000Z`,
  });
}

function createPassingCanonicalPredecessor(manifest) {
  const records = RELEASE_CANONICAL_PROBES.map((probe) => {
    const source = createRecord(manifest.entries[probe.ordinal]);
    return {
      ordinal: probe.ordinal,
      seed: probe.seed,
      status: source.status,
      realizationAttempts: source.realizationAttempts,
      releaseValidationAccepted: source.releaseValidationAccepted,
      releaseValidationErrorCount: source.releaseValidationErrorCount,
      acceptedAsPlayableAlpha: source.acceptedAsPlayableAlpha,
      strictRealizedAccepted: source.strictRealizedAccepted,
      acceptedParentParity: source.acceptedParentParity,
      elapsedMs: source.elapsedMs,
      generatorPhaseTimings: source.generatorPhaseTimings,
      workerEvidenceHash: `sha256-canonical-worker-${probe.ordinal}`,
    };
  });
  return createCanonicalProbeEvidence({
    manifest,
    provenance: manifest.provenance,
    records,
    generatedAt: '2026-07-31T00:01:30.000Z',
  });
}

function createPassingPredecessorEvidence(manifest) {
  return {
    canonical: createPassingCanonicalPredecessor(manifest),
    smoke: createPassingAggregate(manifest, 'smoke'),
    normal: createPassingAggregate(manifest, 'normal'),
  };
}

function createSuiteReceipt(suiteId, {
  receiptProvenance = provenance,
  failedCommandIndex = -1,
  sourceStable = true,
  postRunSourceHash = receiptProvenance.sourceHash,
  postRunSourceDirty = receiptProvenance.sourceDirty,
} = {}) {
  const contract = RELEASE_SUITE_CONTRACTS[suiteId];
  return createReleaseSuiteReceipt({
    suiteId,
    provenance: receiptProvenance,
    sourceStable,
    postRunSourceHash,
    postRunSourceDirty,
    generatedAt: '2026-07-31T00:08:00.000Z',
    commandResults: contract.commands.map((command, index) => ({
      id: command.id,
      runner: command.runner,
      args: [...command.args],
      status: index === failedCommandIndex ? 1 : 0,
      signal: null,
      error: null,
      skipped: false,
      elapsedMs: 100 + index,
    })),
  });
}

test('git source status and clean provenance are fail-closed before release work', () => {
  assert.equal(releaseSourceDirtyFromGitStatusResult({ status: 0, stdout: '' }), false);
  assert.equal(
    releaseSourceDirtyFromGitStatusResult({ status: 0, stdout: ' M src/file.js\n' }),
    true,
  );
  assert.throws(
    () => releaseSourceDirtyFromGitStatusResult({
      status: 128,
      stdout: '',
      stderr: 'fatal: status unavailable',
    }),
    /could not determine git source cleanliness/u,
  );
  assert.equal(assertCleanReleaseProvenance(provenance), provenance);
  assert.throws(
    () => assertCleanReleaseProvenance({ ...provenance, sourceDirty: true }),
    /source is dirty/u,
  );
  assert.throws(
    () => assertCleanReleaseProvenance({ ...provenance, sourceDirty: null }),
    /source is indeterminate/u,
  );
});

test('cleanliness participates in artifact identity and every provenance boundary', () => {
  const dirty = { ...provenance, sourceDirty: true };
  assert.notEqual(
    createReleaseArtifactIdentity(provenance),
    createReleaseArtifactIdentity(dirty),
  );
  assert.throws(
    () => assertMatchingReleaseProvenance(dirty, provenance, 'synthetic boundary'),
    /sourceDirty does not match/u,
  );
});

function syntheticParentSnapshot(rawIndex, status = 'accepted') {
  const seed = `layout:augmentation-realized-v4-${String(rawIndex).padStart(3, '0')}`;
  if (status === 'skipped') {
    return {
      status,
      rawIndex,
      seed,
      sourceRandomCalls: 0,
      errorName: 'SyntheticParentRejected',
      reason: 'synthetic rejected parent',
    };
  }
  return {
    status,
    rawIndex,
    seed,
    basePlanHash: `v1:${seed}:depth:1:revolvingFusillade`,
    sourceRandomCalls: rawIndex + 1,
    parentWitness: { hash: `sha256-parent-${rawIndex}` },
  };
}

test('bounded parent snapshot scans commit raw-order output and stop at the exact accepted endpoint', async () => {
  const completionOrder = [];
  const batches = [];
  const scan = await collectOrderedAcceptedParentSnapshots({
    rawStartIndex: 0,
    maximumRawAttempts: 10,
    requestedAcceptedParentCount: 3,
    concurrency: 3,
    async buildBatch(rawIndices) {
      batches.push([...rawIndices]);
      return Promise.all(rawIndices.map(async (rawIndex, offset) => {
        await new Promise((resolve) => setTimeout(resolve, (rawIndices.length - offset) * 2));
        completionOrder.push(rawIndex);
        return syntheticParentSnapshot(rawIndex, rawIndex === 0 ? 'skipped' : 'accepted');
      }));
    },
  });
  assert.deepEqual(batches, [[0, 1, 2], [3, 4, 5]]);
  assert.notDeepEqual(completionOrder, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(scan.entries.map(({ ordinal, rawIndex }) => ({ ordinal, rawIndex })), [{
    ordinal: 0, rawIndex: 1,
  }, {
    ordinal: 1, rawIndex: 2,
  }, {
    ordinal: 2, rawIndex: 3,
  }]);
  assert.deepEqual(scan.skippedParentSeeds.map(({ rawIndex }) => rawIndex), [0]);
  assert.equal(scan.rawEndIndexExclusive, 4);
});

test('parent snapshot scans fail fast and preserve the sequential exhaustion boundary', async () => {
  let batchCalls = 0;
  await assert.rejects(
    collectOrderedAcceptedParentSnapshots({
      rawStartIndex: 10,
      maximumRawAttempts: 6,
      requestedAcceptedParentCount: 2,
      concurrency: 3,
      async buildBatch() {
        batchCalls += 1;
        throw new Error('synthetic worker failure');
      },
    }),
    /synthetic worker failure/u,
  );
  assert.equal(batchCalls, 1);

  await assert.rejects(
    collectOrderedAcceptedParentSnapshots({
      rawStartIndex: 0,
      maximumRawAttempts: 2,
      requestedAcceptedParentCount: 2,
      concurrency: 2,
      buildBatch: async (rawIndices) => rawIndices.map((rawIndex) => (
        syntheticParentSnapshot(rawIndex, 'skipped')
      )),
    }),
    /exhausted 2 raw seeds after finding 0\/2/u,
  );
});

test('parent snapshot concurrency is hardware-bounded and worker lanes stay isolated', async () => {
  assert.equal(RELEASE_PARENT_SNAPSHOT_MAX_CONCURRENCY, 8);
  assert.equal(resolveReleaseParentSnapshotConcurrency(null, 16), 8);
  assert.equal(resolveReleaseParentSnapshotConcurrency(null, 1), 1);
  assert.equal(resolveReleaseParentSnapshotConcurrency(6, 4), 3);
  assert.throws(() => resolveReleaseParentSnapshotConcurrency(9, 16), /1 through 8/u);

  const workerContracts = [];
  class SyntheticWorker extends EventEmitter {
    constructor(_workerUrl, options) {
      super();
      this.options = options;
      workerContracts.push(options.workerData);
    }

    postMessage({ requestId, rawIndex }) {
      queueMicrotask(() => this.emit('message', {
        requestId,
        ok: true,
        snapshot: syntheticParentSnapshot(rawIndex),
      }));
    }

    terminate() {
      return Promise.resolve(0);
    }
  }
  const pool = createReleaseParentSnapshotWorkerPool({
    concurrency: 2,
    WorkerImplementation: SyntheticWorker,
  });
  try {
    const snapshots = await pool.runBatch([7, 8]);
    assert.deepEqual(snapshots.map(({ rawIndex }) => rawIndex), [7, 8]);
    assert.deepEqual(workerContracts, [{
      kind: RELEASE_PARENT_SNAPSHOT_WORKER_KIND,
      laneIndex: 0,
    }, {
      kind: RELEASE_PARENT_SNAPSHOT_WORKER_KIND,
      laneIndex: 1,
    }]);
    await assert.rejects(pool.runBatch([1, 2, 3]), /exceeds its bounded lanes/u);
  } finally {
    await pool.close();
  }
});

test('parallel manifest construction is restricted to augmentation-disabled parent snapshots', async () => {
  const [builderSource, workerSource] = await Promise.all([
    readFile(new URL('../scripts/build-dungeon-augmentation-release-corpus.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/dungeon-augmentation-parent-snapshot-worker.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(builderSource, /collectOrderedAcceptedParentSnapshots/u);
  assert.match(builderSource, /createReleaseParentSnapshotWorkerPool/u);
  assert.match(builderSource, /createCorpusManifest\(\{[\s\S]*?provenance,/u);
  assert.doesNotMatch(builderSource, /new DungeonGenerator/u);
  assert.match(workerSource, /augmentationProfileId:\s*null/u);
  assert.doesNotMatch(workerSource, /industrial-supplement-preview-v4/u);
});

test('release corpus manifests are sealed and reject payload mutation', () => {
  const manifest = createManifest();
  assert.equal(validateCorpusManifest(manifest), manifest);
  const modified = structuredClone(manifest);
  modified.entries[0].seed = 'modified';
  assert.throws(() => assertSealedEvidence(modified), /evidenceHash/);
});

test('accepted-parent witnesses require strict positive attempt and RNG hash inputs', () => {
  const valid = createParentWitness(0);
  assert.equal(validateAcceptedParentWitness(valid), valid);
  assert.throws(
    () => createAcceptedParentWitness({
      basePlanHash: valid.basePlanHash,
      generationAttempts: '1',
      rooms: [{ id: 'room-string-attempt' }],
      connectionPlans: [],
    }, valid.sourceRandomCalls),
    /strict base, attempt, RNG, room, connection, or hash inputs/u,
  );
  assert.throws(
    () => createAcceptedParentWitness({
      basePlanHash: valid.basePlanHash,
      generationAttempts: 1,
      rooms: [{ id: 'room-string-rng' }],
      connectionPlans: [],
    }, String(valid.sourceRandomCalls)),
    /strict base, attempt, RNG, room, connection, or hash inputs/u,
  );
  const mutations = [{
    label: 'zero generation attempts',
    mutate: (witness) => { witness.generationAttempts = 0; },
  }, {
    label: 'fractional generation attempts',
    mutate: (witness) => { witness.generationAttempts = 1.5; },
  }, {
    label: 'string RNG calls',
    mutate: (witness) => { witness.sourceRandomCalls = '100'; },
  }, {
    label: 'zero RNG calls',
    mutate: (witness) => { witness.sourceRandomCalls = 0; },
  }, {
    label: 'missing rooms',
    mutate: (witness) => { delete witness.rooms; },
  }, {
    label: 'missing connection hash input',
    mutate: (witness) => { delete witness.connectionPlans; },
  }, {
    label: 'missing base hash',
    mutate: (witness) => { witness.basePlanHash = ''; },
    expected: /invalid raw-seed identity/u,
  }];
  for (const { label, mutate, expected } of mutations) {
    const manifest = structuredClone(createManifest());
    const witness = structuredClone(manifest.entries[0].parentWitness);
    mutate(witness);
    manifest.entries[0].parentWitness = resealParentWitness(witness);
    assert.throws(
      () => validateCorpusManifest(sealEvidence(manifest)),
      expected ?? /strict base, attempt, RNG, room, connection, or hash inputs/u,
      label,
    );
  }
});

test('canonical ordinal shards partition each immutable corpus view exactly', () => {
  const manifest = createManifest();
  const smoke = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: RELEASE_SHARD_TOPOLOGY.smoke.shardCount,
  });
  assert.deepEqual(
    [smoke.ordinalStart, smoke.ordinalEndExclusive],
    [0, 10],
  );
  const normalSelections = Array.from({ length: 10 }, (_, shardIndex) => (
    selectCorpusEntries(manifest, { tier: 'normal', shardIndex, shardCount: 10 })
  ));
  assert.deepEqual(
    normalSelections.map(({ ordinalStart, ordinalEndExclusive }) => (
      [ordinalStart, ordinalEndExclusive]
    )),
    Array.from({ length: 10 }, (_, shardIndex) => [shardIndex * 10, (shardIndex + 1) * 10]),
  );
  const releaseSelections = Array.from({ length: 20 }, (_, shardIndex) => (
    selectCorpusEntries(manifest, { tier: 'release', shardIndex, shardCount: 20 })
  ));
  assert.deepEqual(
    releaseSelections.map(({ entries }) => entries.length),
    Array.from({ length: 20 }, () => 50),
  );
  assert.deepEqual(
    normalSelections.flatMap(({ entries }) => entries).map(({ ordinal }) => ordinal),
    Array.from({ length: 100 }, (_, ordinal) => ordinal),
  );
  assert.throws(
    () => selectCorpusEntries(manifest, { tier: 'smoke', shardIndex: 0, shardCount: 2 }),
    /requires exactly 1 shard/u,
  );
  assert.throws(
    () => selectCorpusEntries(manifest, { tier: 'release', shardIndex: 0, shardCount: 10 }),
    /requires exactly 20 shard/u,
  );
});

test('aggregate evidence enforces exact coverage, first realization, and performance', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const shards = [createShard(manifest, selection)];
  const accepted = aggregateShardEvidence({
    manifest,
    shards,
    generatedAt: '2026-07-31T00:02:00.000Z',
  });
  assert.equal(accepted.corpusAccepted, true);
  assert.deepEqual(Object.values(accepted.gates), Object.values(accepted.gates).map(() => true));

  const failedRecords = selection.entries.map((entry) => createRecord(entry));
  failedRecords[0].realizationAttempts = 2;
  failedRecords[1].elapsedMs = 40_000;
  failedRecords[1].elapsedPhases = {
    generationMs: 39_000,
    strictValidationMs: 1_000,
    disposalMs: 0,
    totalMs: 40_000,
  };
  const rejected = aggregateShardEvidence({
    manifest,
    shards: [createShard(manifest, selection, failedRecords)],
    generatedAt: '2026-07-31T00:03:00.000Z',
  });
  assert.equal(rejected.corpusAccepted, false);
  assert.equal(rejected.gates.firstRealization, false);
  assert.equal(rejected.gates.performance, false);

  const overrideAttempt = aggregateShardEvidence({
    manifest,
    shards: [createShard(manifest, selection, failedRecords)],
    performanceBudgetMs: {
      median: 100_000,
      p95: 100_000,
      maximum: 100_000,
      ciTimeoutPerSeed: 999_000,
    },
  });
  assert.deepEqual(overrideAttempt.performance.budgetMs, RELEASE_PERFORMANCE_BUDGET_MS);
  assert.equal(overrideAttempt.gates.performance, false);

  const resealedRaisedBudget = structuredClone(rejected);
  resealedRaisedBudget.performance.budgetMs = {
    median: 100_000,
    p95: 100_000,
    maximum: 100_000,
    ciTimeoutPerSeed: 999_000,
  };
  assert.throws(
    () => validateAggregateEvidenceForCurrentProvenance(
      sealEvidence(resealedRaisedBudget),
      provenance,
    ),
    /authoritative performance budget/u,
  );
});

test('re-sealed zero-record and gate-mutated aggregates cannot forge release acceptance', () => {
  const manifest = createManifest();
  const zeroRecordAggregate = aggregateShardEvidence({
    manifest,
    shards: [],
    generatedAt: '2026-07-31T00:02:30.000Z',
  });
  assert.equal(zeroRecordAggregate.recordCount, 0);
  assert.equal(zeroRecordAggregate.corpusAccepted, false);

  const verdictOnlyForgery = structuredClone(zeroRecordAggregate);
  verdictOnlyForgery.corpusAccepted = true;
  verdictOnlyForgery.result = 'passed';
  assert.throws(
    () => validateAggregateEvidenceForCurrentProvenance(
      sealEvidence(verdictOnlyForgery),
      provenance,
    ),
    /complete shard-result summaries|verdict does not match/u,
  );

  const fullGateForgery = structuredClone(zeroRecordAggregate);
  fullGateForgery.corpusAccepted = true;
  fullGateForgery.result = 'passed';
  fullGateForgery.gates = Object.fromEntries(
    Object.keys(fullGateForgery.gates).map((gate) => [gate, true]),
  );
  assert.throws(
    () => validateAggregateEvidenceForCurrentProvenance(
      sealEvidence(fullGateForgery),
      provenance,
    ),
    /complete shard-result summaries|acceptance gates/u,
  );
  const receipts = RELEASE_REQUIRED_SUITE_IDS.map((suiteId) => createSuiteReceipt(suiteId));
  assert.throws(
    () => createReleaseAttestation({
      aggregate: sealEvidence(fullGateForgery),
      suiteReceipts: receipts,
    }),
    /complete shard-result summaries|acceptance gates/u,
  );

  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const accepted = aggregateShardEvidence({
    manifest,
    shards: [createShard(manifest, selection)],
  });
  for (const gate of Object.keys(accepted.gates)) {
    const gateForgery = structuredClone(accepted);
    gateForgery.gates[gate] = false;
    assert.throws(
      () => validateAggregateEvidenceForCurrentProvenance(
        sealEvidence(gateForgery),
        provenance,
      ),
      /acceptance gates/u,
      gate,
    );
  }

  const recordForgery = structuredClone(accepted);
  recordForgery.records[0].status = 'unchanged';
  assert.throws(
    () => validateAggregateEvidenceForCurrentProvenance(
      sealEvidence(recordForgery),
      provenance,
    ),
    /acceptance gates/u,
  );
});

test('re-sealed record mutations independently fail every per-record acceptance gate', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const mutations = [{
    gate: 'zeroFallback',
    mutate: (record) => { record.status = 'unchanged'; },
  }, {
    gate: 'firstRealization',
    mutate: (record) => { record.realizationAttempts = 2; },
  }, {
    gate: 'releaseValidation',
    mutate: (record) => { record.releaseValidationAccepted = false; },
  }, {
    gate: 'releaseValidation',
    mutate: (record) => { record.releaseValidationErrorCount = 1; },
  }, {
    gate: 'releaseValidation',
    mutate: (record) => { record.acceptedAsPlayableAlpha = true; },
  }, {
    gate: 'strictRealizedValidation',
    mutate: (record) => { record.strictRealizedAccepted = false; },
  }, {
    gate: 'acceptedParentParity',
    mutate: (record) => { record.acceptedParentParity = false; },
  }, {
    gate: 'performance',
    mutate: (record) => {
      record.elapsedPhases = {
        generationMs: 39_000,
        strictValidationMs: 1_000,
        disposalMs: 0,
        totalMs: 40_000,
      };
      record.elapsedMs = 40_000;
    },
  }];
  for (const { gate, mutate } of mutations) {
    const records = selection.entries.map((entry) => createRecord(entry));
    mutate(records[0]);
    const aggregate = aggregateShardEvidence({
      manifest,
      shards: [createShard(manifest, selection, records)],
    });
    assert.equal(aggregate.gates[gate], false, gate);
    assert.equal(aggregate.corpusAccepted, false, gate);
  }
});

test('failed shard and dirty-source mutations fail their explicit acceptance gates', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const failedShard = createShard(manifest, selection, null, { result: 'failed' });
  const failedAggregate = aggregateShardEvidence({ manifest, shards: [failedShard] });
  assert.equal(failedAggregate.gates.shardResultsPassed, false);

  const dirtyProvenance = structuredClone(provenance);
  dirtyProvenance.sourceDirty = true;
  const dirtyManifest = createManifest('2026-07-31T00:00:02.000Z', dirtyProvenance);
  const dirtySelection = selectCorpusEntries(dirtyManifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const dirtyAggregate = aggregateShardEvidence({
    manifest: dirtyManifest,
    shards: [createShard(dirtyManifest, dirtySelection)],
  });
  assert.equal(dirtyAggregate.gates.cleanSourceProvenance, false);
  assert.equal(dirtyAggregate.corpusAccepted, false);
});

test('normal corpus aggregation applies exact family and frequency diversity gates', () => {
  const manifest = createManifest();
  const shards = Array.from({ length: 10 }, (_, shardIndex) => {
    const selection = selectCorpusEntries(manifest, {
      tier: 'normal', shardIndex, shardCount: 10,
    });
    return createShard(manifest, selection);
  });
  const aggregate = aggregateShardEvidence({
    manifest,
    shards,
    generatedAt: '2026-07-31T00:04:00.000Z',
  });
  assert.equal(aggregate.diversity.required, true);
  assert.equal(aggregate.diversity.accepted, true);
  assert.equal(aggregate.gates.diversity, true);
  assert.equal(aggregate.diversity.exactEncounterFamilies, true);
  assert.equal(aggregate.diversity.exactRoomLayoutFamilies, true);
});

test('normal diversity rejects skewed families and zero complete-signature totals', () => {
  const manifest = createManifest();
  const skewedShards = Array.from({ length: 10 }, (_, shardIndex) => {
    const selection = selectCorpusEntries(manifest, {
      tier: 'normal', shardIndex, shardCount: 10,
    });
    const records = selection.entries.map((entry) => {
      const record = createRecord(entry);
      record.topologyTemplateSelections = [EXPECTED_TOPOLOGY_TEMPLATE_IDS[0]];
      record.completeLayoutSignatures = ['one-repeated-signature'];
      return record;
    });
    return createShard(manifest, selection, records);
  });
  const skewed = aggregateShardEvidence({ manifest, shards: skewedShards });
  assert.equal(skewed.gates.diversity, false);

  const unsignedShards = Array.from({ length: 10 }, (_, shardIndex) => {
    const selection = selectCorpusEntries(manifest, {
      tier: 'normal', shardIndex, shardCount: 10,
    });
    const records = selection.entries.map((entry) => ({
      ...createRecord(entry),
      status: 'unchanged',
      completeLayoutSignatures: [],
    }));
    return createShard(manifest, selection, records);
  });
  const unsigned = aggregateShardEvidence({ manifest, shards: unsignedShards });
  assert.equal(unsigned.diversity.completeSignatureEvidencePresent, false);
  assert.equal(unsigned.gates.diversity, false);
  assert.equal(unsigned.corpusAccepted, false);
});

test('aggregation exposes missing ordinals and rejects overlapping shard ownership', () => {
  const manifest = createManifest();
  const firstSelection = selectCorpusEntries(manifest, {
    tier: 'normal', shardIndex: 0, shardCount: 10,
  });
  const firstShard = createShard(manifest, firstSelection);
  const incomplete = aggregateShardEvidence({
    manifest,
    shards: [firstShard],
    generatedAt: '2026-07-31T00:05:00.000Z',
  });
  assert.equal(incomplete.corpusAccepted, false);
  assert.equal(incomplete.gates.exactOrdinalCoverage, false);
  assert.equal(incomplete.gates.exactRecordCoverage, false);
  assert.equal(incomplete.gates.exactShardTopology, false);
  assert.deepEqual(incomplete.missingOrdinals, Array.from({ length: 90 }, (_, index) => index + 10));
  assert.throws(
    () => aggregateShardEvidence({ manifest, shards: [firstShard, firstShard] }),
    /appears in more than one shard/,
  );
  const smokeSelection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  assert.throws(
    () => aggregateShardEvidence({
      manifest,
      shards: [firstShard, createShard(manifest, smokeSelection)],
    }),
    /cannot mix smoke, normal, and release ordinal views/,
  );
});

test('only canonical shard ranges can become aggregate evidence', () => {
  const manifest = createManifest();
  const singleSeedSelection = selectCorpusEntries(manifest, {
    tier: 'normal', ordinalStart: 7, ordinalCount: 1,
  });
  assert.throws(
    () => createShard(manifest, singleSeedSelection),
    /canonical normal topology/u,
  );
});

test('release shards require valid nonempty selection-bag witnesses for every family', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });

  const missingFamily = structuredClone(createShard(manifest, selection));
  missingFamily.records[0].selectionBagWitnesses.roomLayout = [];
  assert.throws(
    () => validateShardEvidence(sealEvidence(missingFamily), manifest),
    /roomLayout.*selection-bag-witness-sequence-empty/u,
  );

  const illegalSelection = structuredClone(createShard(manifest, selection));
  illegalSelection.records[0].selectionBagWitnesses.topology[0].selectedId = 'topology-not-legal';
  assert.throws(
    () => validateShardEvidence(sealEvidence(illegalSelection), manifest),
    /topology.*selection-bag-witness-selection-illegal/u,
  );
});

test('one-seed worker evidence is isolated and uses the exact per-seed timeout', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const worker = createSeedWorkerEvidence({
    manifest,
    selection,
    provenance,
    records: [createRecord(selection.entries[0])],
    result: 'passed',
    generatedAt: '2026-07-31T00:06:00.000Z',
  });
  assert.equal(
    validateSeedWorkerEvidence(worker, manifest, { tier: 'release', ordinal: 57 }),
    worker,
  );
  assert.throws(
    () => validateSeedWorkerEvidence(worker, manifest, { tier: 'release', ordinal: 58 }),
    /expected 58/u,
  );

  let captured = null;
  const result = runReleaseSeedWorkerProcess({
    executablePath: 'node',
    args: ['worker.mjs'],
    cwd: process.cwd(),
    spawnSyncImpl: (executablePath, args, options) => {
      captured = { executablePath, args, options };
      return { status: 0 };
    },
  });
  assert.equal(result.status, 0);
  assert.equal(captured.options.timeout, RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed);
  assert.equal(captured.options.timeout, 180_000);
});

test('release warm-up and target generators are both pinned to one realization attempt', async () => {
  assert.equal(RELEASE_AUGMENTATION_REALIZATION_ATTEMPT_LIMIT, 1);
  const [workerSource, generatorSource] = await Promise.all([
    readFile(
      new URL('../scripts/verify-dungeon-augmentation-realized.mjs', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../src/DungeonGenerator.js', import.meta.url), 'utf8'),
  ]);
  assert.equal(
    workerSource.match(
      /augmentationRealizationAttemptLimit:\s*RELEASE_AUGMENTATION_REALIZATION_ATTEMPT_LIMIT/gu,
    )?.length,
    2,
  );
  assert.equal(
    workerSource.match(/captureDungeonGeneratorMetrics\(dungeon\)/gu)?.length,
    2,
    'Warm-up and target verifier paths must both use fallback-aware metric capture.',
  );
  assert.doesNotMatch(
    workerSource,
    /(?:planningTimeMs|assemblyTimeMs):\s*Number\.isFinite\([^)]*\)\s*\?[^:]*:\s*0/gu,
    'Verifier diagnostics must not synthesize missing generator metrics as zero.',
  );
  assert.match(
    generatorSource,
    /const DUNGEON_AUGMENTATION_MAX_REALIZATION_ATTEMPTS = 8;/u,
  );
  assert.match(
    generatorSource,
    /augmentationRealizationAttemptLimit = DUNGEON_AUGMENTATION_MAX_REALIZATION_ATTEMPTS/u,
  );
});

test('synthetic watchdog timeouts retain the last complete warm-up planning heartbeat', async () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const targetEntry = selection.entries[0];
  const warmupEntry = manifest.entries[targetEntry.ordinal + 1];
  const temporaryDirectory = await mkdtemp(path.join(
    os.tmpdir(),
    'dungeon-augmentation-phase-heartbeat-',
  ));
  const heartbeatPath = path.join(temporaryDirectory, 'worker.phase.jsonl');
  let epochMilliseconds = 10_000;
  let monotonicMilliseconds = 0;
  const advance = (milliseconds) => {
    epochMilliseconds += milliseconds;
    monotonicMilliseconds += milliseconds;
  };
  try {
    const reporter = createReleasePhaseHeartbeatReporter({
      targetPath: heartbeatPath,
      targetEntry,
      warmupEntry,
      epochNow: () => epochMilliseconds,
      monotonicNow: () => monotonicMilliseconds,
    });
    reporter.startPhase('parent-generation');
    advance(20);
    reporter.observeGeneratorPhase({ phase: 'planning', status: 'started' });
    advance(45_000);
    await appendFile(heartbeatPath, '{"interrupted":', 'utf8');

    const snapshot = await readReleasePhaseHeartbeat(heartbeatPath, {
      manifest,
      selection,
      observedAtEpochMs: epochMilliseconds,
    });
    assert.equal(snapshot.phase, 'planning');
    assert.equal(snapshot.status, 'started');
    assert.equal(snapshot.targetStarted, false);
    assert.equal(snapshot.phaseElapsedMs, 45_000);
    assert.equal(snapshot.phaseTimings.parentGenerationMs, 20);
    assert.equal(snapshot.phaseTimings.planningMs, 45_000);

    const failure = createReleaseWorkerFailureDiagnostics({
      errorName: 'Error',
      message: 'spawnSync node ETIMEDOUT',
      entry: targetEntry,
      timedOut: true,
      lastPhaseEvidence: snapshot,
    });
    assert.equal(failure.timeoutPhase, 'warmup:planning');
    assert.equal(failure.timeoutPhaseElapsedMs, 45_000);
    assert.equal(failure.generatorPhaseTimings.planningMs, 45_000);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('post-generation strict-validation failures retain captured planner and assembly metrics', async () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const targetEntry = selection.entries[0];
  const warmupEntry = manifest.entries[targetEntry.ordinal + 1];
  const temporaryDirectory = await mkdtemp(path.join(
    os.tmpdir(),
    'dungeon-augmentation-post-generation-metrics-',
  ));
  const heartbeatPath = path.join(temporaryDirectory, 'worker.phase.jsonl');
  let epochMilliseconds = 20_000;
  let monotonicMilliseconds = 0;
  const advance = (milliseconds) => {
    epochMilliseconds += milliseconds;
    monotonicMilliseconds += milliseconds;
  };
  try {
    const reporter = createReleasePhaseHeartbeatReporter({
      targetPath: heartbeatPath,
      targetEntry,
      warmupEntry,
      epochNow: () => epochMilliseconds,
      monotonicNow: () => monotonicMilliseconds,
    });
    reporter.beginTarget();
    reporter.startPhase('parent-generation');
    advance(10);
    reporter.observeGeneratorPhase({ phase: 'planning', status: 'started' });
    advance(20);
    reporter.observeGeneratorPhase({ phase: 'planning', status: 'completed' });
    reporter.captureGeneratorMetrics({ planningTimeMs: 19.5, assemblyTimeMs: 7.25 });
    reporter.startPhase('strict-validation');
    advance(3);
    const failurePhaseEvidence = reporter.captureFailure();
    assert.equal(failurePhaseEvidence.phase, 'strict-validation');
    assert.equal(failurePhaseEvidence.phaseTimings.planningTimeMs, 19.5);
    assert.equal(failurePhaseEvidence.phaseTimings.assemblyTimeMs, 7.25);

    const failure = createReleaseWorkerFailureDiagnostics({
      errorName: 'AssertionError',
      message: 'synthetic post-generation validation failure',
      entry: targetEntry,
      workerFailure: {
        failurePhaseEvidence,
        generatorPhaseTimings: failurePhaseEvidence.phaseTimings,
      },
      lastPhaseEvidence: failurePhaseEvidence,
    });
    assert.equal(failure.generatorPhaseTimings.planningTimeMs, 19.5);
    assert.equal(failure.generatorPhaseTimings.assemblyTimeMs, 7.25);

    const persisted = await readReleasePhaseHeartbeat(heartbeatPath, {
      manifest,
      selection,
      observedAtEpochMs: epochMilliseconds,
    });
    assert.equal(persisted.phaseTimings.planningTimeMs, 19.5);
    assert.equal(persisted.phaseTimings.assemblyTimeMs, 7.25);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('successful workers require terminal target-disposal evidence matching published timings', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const entry = selection.entries[0];
  const snapshot = createPhaseSnapshot(entry, {
    targetStarted: true,
    phase: 'disposal',
    status: 'completed',
    phaseElapsedMs: 2,
  });
  snapshot.phaseTimings = createGeneratorPhaseTimings();
  assert.equal(
    validateCompletedReleaseWorkerPhaseEvidence(
      snapshot,
      snapshot.phaseTimings,
      { manifest, selection },
    ),
    snapshot,
  );

  for (const { label, mutate } of [{
    label: 'warmup terminal',
    mutate: (candidate) => { candidate.targetStarted = false; },
  }, {
    label: 'stale planning heartbeat',
    mutate: (candidate) => {
      candidate.phase = 'planning';
      candidate.status = 'started';
    },
  }, {
    label: 'timing drift',
    mutate: (_candidate, timings) => { timings.planningTimeMs += 1; },
  }]) {
    const candidate = structuredClone(snapshot);
    const timings = structuredClone(snapshot.phaseTimings);
    mutate(candidate, timings);
    assert.throws(
      () => validateCompletedReleaseWorkerPhaseEvidence(
        candidate,
        timings,
        { manifest, selection },
      ),
      /completed target disposal|published generator phase timings/u,
      label,
    );
  }
});

test('failed zero-record workers cannot create vacuous seed-level aggregate passes', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const aggregate = aggregateShardEvidence({
    manifest,
    shards: [createShard(manifest, selection, [], { result: 'failed' })],
  });
  assert.equal(aggregate.recordCount, 0);
  assert.equal(aggregate.corpusAccepted, false);
  for (const gate of [
    'exactRecordCoverage',
    'zeroFallback',
    'firstRealization',
    'releaseValidation',
    'strictRealizedValidation',
    'acceptedParentParity',
    'diversity',
    'performance',
  ]) {
    assert.equal(aggregate.gates[gate], false, gate);
  }
  assert.equal(aggregate.diversity.accepted, false);
});

test('manifest seed-worker publication accepts one applied record unchanged', () => {
  const manifest = createManifest();
  const entry = manifest.entries[57];
  const record = createRecord(entry);
  const before = structuredClone(record);

  const publication = inspectReleaseSeedWorkerRecordPublication(record);

  assert.equal(publication.accepted, true);
  assert.equal(publication.record, record);
  assert.equal(publication.failure, null);
  assert.deepEqual(record, before);
});

test('actual unchanged generator fallback retains final metrics in a zero-record worker', async () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const entry = selection.entries[0];
  const warmupEntry = manifest.entries[entry.ordinal + 1];
  const temporaryDirectory = await mkdtemp(path.join(
    os.tmpdir(),
    'dungeon-augmentation-unchanged-worker-metrics-',
  ));
  const heartbeatPath = path.join(temporaryDirectory, 'worker.phase.jsonl');
  let epochMilliseconds = 30_000;
  let monotonicMilliseconds = 0;
  const advance = (milliseconds) => {
    epochMilliseconds += milliseconds;
    monotonicMilliseconds += milliseconds;
  };
  try {
    const reporter = createReleasePhaseHeartbeatReporter({
      targetPath: heartbeatPath,
      targetEntry: entry,
      warmupEntry,
      epochNow: () => epochMilliseconds,
      monotonicNow: () => monotonicMilliseconds,
    });
    reporter.beginTarget();
    reporter.startPhase('parent-generation');
    advance(10);

    const generator = new DungeonGenerator({
      random: () => 0.5,
      difficulty: 1,
      augmentationProfileId: RELEASE_PROFILE_ID,
      augmentationSeed: entry.seed,
      basePlanHash: entry.basePlanHash,
      augmentationRealizationAttemptLimit: 1,
    });
    generator.augmentationPhaseObserver = (event) => reporter.observeGeneratorPhase(event);
    generator._generateAcceptedIndustrialDungeon = () => ({
      dungeon: {
        basePlanHash: entry.basePlanHash,
        generationAttempts: 1,
        rooms: [],
        connectionPlans: [],
        progression: { validation: { accepted: true, errors: [] } },
      },
      randomTape: [],
    });
    generator._createIndustrialDungeonAugmentationPlanningSnapshot = () => ({
      rooms: [],
      connectionPlans: [],
    });
    generator._generateOnce = function generateRejectedAugmentationCandidate() {
      this._reportDungeonAugmentationPhase('planning', 'started');
      advance(4);
      this._reportDungeonAugmentationPhase('planning', 'completed', { elapsedMs: 22 });
      this._reportDungeonAugmentationPhase('three-js-assembly', 'started');
      advance(9);
      this._reportDungeonAugmentationPhase('three-js-assembly', 'completed', {
        elapsedMs: 7.25,
      });
      return {
        augmentationStatus: 'applied',
        augmentationPlanHash: 'v1-synthetic-rejected-plan',
        augmentationMetrics: { planningTimeMs: 222, assemblyTimeMs: 7.25 },
        augmentationDiagnostics: {
          schema: 'ruindivex-dungeon-augmentation-diagnostics/v1',
          accepted: false,
          reason: 'synthetic-drop-space-egress-failure',
          planningTimeMs: 222,
          errors: ['The final augmentation candidate failed drop-space egress.'],
        },
        progression: {
          validation: {
            accepted: false,
            errors: ['The final augmentation candidate failed drop-space egress.'],
          },
        },
      };
    };
    generator._disposeGeneratedDungeonCandidate = () => {};

    const dungeon = generator.generate();
    assert.equal(dungeon.augmentationStatus, 'unchanged');
    assert.equal(dungeon.augmentationMetrics, undefined);
    assert.equal(dungeon.augmentationDiagnostics.rejectedOverlay.attempts.length, 1);
    assert.equal(
      dungeon.augmentationDiagnostics.rejectedOverlay.attempts[0].diagnostics.planningTimeMs,
      222,
    );
    assert.deepEqual(captureReleaseDungeonGeneratorMetrics(dungeon), {
      planningTimeMs: 222,
      assemblyTimeMs: null,
    });
    const withEarlierRejectedAttempt = structuredClone(dungeon);
    withEarlierRejectedAttempt.augmentationDiagnostics.rejectedOverlay.attempts.unshift({
      realizationAttempt: 0,
      diagnostics: { planningTimeMs: 111 },
    });
    assert.equal(
      captureReleaseDungeonGeneratorMetrics(withEarlierRejectedAttempt).planningTimeMs,
      222,
    );
    const capturedMetrics = reporter.captureDungeonGeneratorMetrics(dungeon);
    assert.deepEqual(capturedMetrics, {
      planningTimeMs: 222,
      assemblyTimeMs: 7.25,
    });
    reporter.observeGeneratorPhase({
      phase: 'three-js-assembly', status: 'completed', elapsedMs: 999,
    });
    assert.equal(
      reporter.captureDungeonGeneratorMetrics(dungeon).assemblyTimeMs,
      7.25,
      'An unmatched completion event cannot replace the final attempt assembly metric.',
    );

    reporter.startPhase('strict-validation');
    advance(2);
    reporter.completePhase('strict-validation');
    reporter.startPhase('disposal');
    advance(1);
    reporter.completePhase('disposal');
    const generatorPhaseTimings = reporter.timings({ scope: 'target' });
    assert.equal(generatorPhaseTimings.planningTimeMs, 222);
    assert.equal(generatorPhaseTimings.assemblyTimeMs, 7.25);

    const record = {
      ...createRecord(entry),
      status: 'unchanged',
      completeLayoutSignatures: [],
      generatorPhaseTimings,
      rejectionAttempts: [{
        realizationAttempt: 1,
        reason: 'physical-validation-fallback',
        failureCodes: ['DUNGEON_AUGMENTATION_DROP_SPACE_EGRESS_FAILED'],
        errorMessages: ['The final augmentation candidate failed drop-space egress.'],
        errorCount: 1,
        lastPlanningDecision: null,
      }],
    };
    const publication = inspectReleaseSeedWorkerRecordPublication(record);
    assert.equal(publication.accepted, false);
    assert.equal(publication.record, null);
    assert.equal(publication.failure.generatorPhaseTimings.planningTimeMs, 222);
    assert.equal(publication.failure.generatorPhaseTimings.assemblyTimeMs, 7.25);

    const phaseEvidence = reporter.snapshot();
    assert.equal(phaseEvidence.phase, 'disposal');
    assert.equal(phaseEvidence.status, 'completed');
    assert.deepEqual(phaseEvidence.phaseTimings, generatorPhaseTimings);
    const failedWorker = createSeedWorkerEvidence({
      manifest,
      selection,
      provenance,
      records: [],
      result: 'failed',
      failure: {
        ...publication.failure,
        currentOrdinal: entry.ordinal,
        currentSeed: entry.seed,
        failurePhaseEvidence: phaseEvidence,
        lastPhaseEvidence: phaseEvidence,
      },
    });
    assert.equal(failedWorker.records.length, 0);
    assert.equal(validateSeedWorkerEvidence(failedWorker, manifest), failedWorker);

    const missingPostGenerationMetrics = structuredClone(failedWorker);
    for (const timings of [
      missingPostGenerationMetrics.failure.generatorPhaseTimings,
      missingPostGenerationMetrics.failure.failurePhaseEvidence.phaseTimings,
      missingPostGenerationMetrics.failure.lastPhaseEvidence.phaseTimings,
    ]) {
      timings.planningTimeMs = null;
      timings.assemblyTimeMs = null;
    }
    assert.throws(
      () => validateSeedWorkerEvidence(
        sealEvidence(missingPostGenerationMetrics),
        manifest,
      ),
      /generator phase timings/u,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('unchanged manifest results retain diagnostics but publish a valid zero-record failure', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const entry = selection.entries[0];
  const record = {
    ...createRecord(entry),
    status: 'unchanged',
    completeLayoutSignatures: [],
    rejectionAttempts: [{
      realizationAttempt: 1,
      reason: 'physical-validation-fallback',
      failureCodes: [
        'DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE',
        'DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE',
      ],
      errorMessages: ['Pyramid segment 1 exits on the wrong seam side.'],
      errorCount: 1,
      lastPlanningDecision: {
        attempt: 0,
        rejection: 'route-network-planning-failed',
      },
    }],
  };
  const before = structuredClone(record);

  const publication = inspectReleaseSeedWorkerRecordPublication(record);

  assert.equal(publication.accepted, false);
  assert.equal(publication.record, null);
  assert.equal(
    publication.failure.errorCode,
    'RELEASE_SEED_WORKER_AUGMENTATION_NOT_APPLIED',
  );
  assert.equal(publication.failure.augmentationStatus, 'unchanged');
  assert.deepEqual(publication.failure.failureCodes, [
    'DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE',
  ]);
  assert.equal(
    publication.failure.rejectionMessage,
    'Pyramid segment 1 exits on the wrong seam side.',
  );
  assert.match(
    publication.failure.message,
    /requires augmentationStatus "applied".*Pyramid segment 1 exits on the wrong seam side\./u,
  );
  assert.deepEqual(publication.failure.elapsedPhases, record.elapsedPhases);
  assert.deepEqual(
    publication.failure.generatorPhaseTimings,
    record.generatorPhaseTimings,
  );
  assert.deepEqual(record, before);

  const phaseEvidence = createPhaseSnapshot(entry, {
    targetStarted: true,
    phase: 'disposal',
    status: 'completed',
  });
  phaseEvidence.phaseTimings = structuredClone(
    publication.failure.generatorPhaseTimings,
  );
  const failed = createSeedWorkerEvidence({
    manifest,
    selection,
    provenance,
    records: [],
    result: 'failed',
    failure: {
      ...publication.failure,
      currentOrdinal: entry.ordinal,
      currentSeed: entry.seed,
      failurePhaseEvidence: phaseEvidence,
      lastPhaseEvidence: phaseEvidence,
    },
  });
  assert.equal(failed.records.length, 0);
  assert.equal(validateSeedWorkerEvidence(failed, manifest), failed);
});

test('failed workers require zero records and phase-bearing failure diagnostics', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const entry = selection.entries[0];
  const phaseEvidence = createPhaseSnapshot(entry);
  const failure = {
    errorName: 'SyntheticWorkerFailure',
    message: 'Synthetic release worker failed.',
    currentOrdinal: entry.ordinal,
    currentSeed: entry.seed,
    failurePhaseEvidence: phaseEvidence,
    lastPhaseEvidence: phaseEvidence,
    generatorPhaseTimings: phaseEvidence.phaseTimings,
  };
  const failed = createSeedWorkerEvidence({
    manifest,
    selection,
    provenance,
    records: [],
    result: 'failed',
    failure,
  });
  assert.equal(validateSeedWorkerEvidence(failed, manifest), failed);

  const driftedFailureTimings = structuredClone(failed);
  driftedFailureTimings.failure.generatorPhaseTimings = {
    ...driftedFailureTimings.failure.generatorPhaseTimings,
    planningTimeMs: 1,
  };
  assert.throws(
    () => validateSeedWorkerEvidence(sealEvidence(driftedFailureTimings), manifest),
    /generator timings do not match/u,
  );

  const missingFailureMetric = structuredClone(failed);
  missingFailureMetric.failure.generatorPhaseTimings = {
    ...missingFailureMetric.failure.generatorPhaseTimings,
  };
  delete missingFailureMetric.failure.generatorPhaseTimings.assemblyTimeMs;
  assert.throws(
    () => validateSeedWorkerEvidence(sealEvidence(missingFailureMetric), manifest),
    /generator phase timings/u,
  );

  const wrongFailureIdentity = structuredClone(failed);
  wrongFailureIdentity.failure.currentSeed = 'layout:not-the-manifest-seed';
  assert.throws(
    () => validateSeedWorkerEvidence(sealEvidence(wrongFailureIdentity), manifest),
    /lacks phase evidence/u,
  );

  const failedWithRecord = createSeedWorkerEvidence({
    manifest,
    selection,
    provenance,
    records: [createRecord(entry)],
    result: 'failed',
    failure,
  });
  assert.throws(
    () => validateSeedWorkerEvidence(failedWithRecord, manifest),
    /zero failed records/u,
  );

  const failedWithoutPhase = createSeedWorkerEvidence({
    manifest,
    selection,
    provenance,
    records: [],
    result: 'failed',
    failure: { errorName: 'SyntheticWorkerFailure', message: 'missing phase' },
  });
  assert.throws(
    () => validateSeedWorkerEvidence(failedWithoutPhase, manifest),
    /lacks phase evidence/u,
  );
});

test('failed shards bind timeout and generator timings to their last phase evidence', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const failed = createShard(manifest, selection, [], { result: 'failed' });
  assert.equal(validateShardEvidence(failed, manifest), failed);

  const failedEntry = selection.entries[0];
  const postGenerationPhase = createPhaseSnapshot(failedEntry, {
    targetStarted: true,
    phase: 'disposal',
    status: 'completed',
  });
  postGenerationPhase.phaseTimings = createGeneratorPhaseTimings();
  const postGenerationFailure = createReleaseWorkerFailureDiagnostics({
    errorName: 'ReleaseSeedWorkerAugmentationRejected',
    message: 'Synthetic unchanged publication failure.',
    entry: failedEntry,
    lastPhaseEvidence: postGenerationPhase,
  });
  const postGenerationShard = createShard(manifest, selection, [], {
    result: 'failed',
    failure: postGenerationFailure,
  });
  assert.equal(validateShardEvidence(postGenerationShard, manifest), postGenerationShard);
  const missingPostGenerationMetrics = structuredClone(postGenerationShard);
  for (const timings of [
    missingPostGenerationMetrics.failure.generatorPhaseTimings,
    missingPostGenerationMetrics.failure.lastPhaseEvidence.phaseTimings,
  ]) {
    timings.planningTimeMs = null;
    timings.assemblyTimeMs = null;
  }
  assert.throws(
    () => validateShardEvidence(sealEvidence(missingPostGenerationMetrics), manifest),
    /generator phase timings/u,
  );

  for (const { label, mutate, expected } of [{
    label: 'timeout phase drift',
    mutate: (candidate) => { candidate.failure.timeoutPhase = 'target:planning'; },
    expected: /authoritative worker phase diagnostics/u,
  }, {
    label: 'timeout elapsed drift',
    mutate: (candidate) => { candidate.failure.timeoutPhaseElapsedMs += 1; },
    expected: /authoritative worker phase diagnostics/u,
  }, {
    label: 'planner metric omitted',
    mutate: (candidate) => {
      candidate.failure.generatorPhaseTimings = {
        ...candidate.failure.generatorPhaseTimings,
      };
      delete candidate.failure.generatorPhaseTimings.planningTimeMs;
    },
    expected: /phase timings/u,
  }, {
    label: 'assembly metric drift',
    mutate: (candidate) => {
      candidate.failure.generatorPhaseTimings = {
        ...candidate.failure.generatorPhaseTimings,
        assemblyTimeMs: 1,
      };
    },
    expected: /generator timings do not match/u,
  }]) {
    const candidate = structuredClone(failed);
    mutate(candidate);
    assert.throws(
      () => validateShardEvidence(sealEvidence(candidate), manifest),
      expected,
      label,
    );
  }
});

test('re-sealed seed records must exactly match manifest and parent RNG identity', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const entry = selection.entries[0];
  const mutations = [{
    label: 'ordinal', mutate: (record) => { record.ordinal += 1; },
  }, {
    label: 'raw index', mutate: (record) => { record.rawIndex += 1; },
  }, {
    label: 'seed', mutate: (record) => { record.seed = 'layout:wrong-seed'; },
  }, {
    label: 'base hash', mutate: (record) => { record.basePlanHash = 'v1:wrong'; },
  }, {
    label: 'parent witness', mutate: (record) => { record.parentWitnessHash = 'sha256-wrong'; },
  }, {
    label: 'source RNG calls', mutate: (record) => { record.sourceRandomCalls += 1; },
  }];
  for (const { label, mutate } of mutations) {
    const record = createRecord(entry);
    mutate(record);
    const worker = createSeedWorkerEvidence({
      manifest,
      selection,
      provenance,
      records: [record],
      result: 'passed',
    });
    assert.throws(
      () => validateSeedWorkerEvidence(worker, manifest),
      /exact manifest parent and RNG identity/u,
      label,
    );
  }
});

test('re-sealed seed records reject nonnumeric, negative, and inconsistent timing', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const entry = selection.entries[0];
  const mutations = [{
    label: 'null elapsed', mutate: (record) => { record.elapsedMs = null; },
  }, {
    label: 'string elapsed', mutate: (record) => { record.elapsedMs = '8000'; },
  }, {
    label: 'negative elapsed', mutate: (record) => { record.elapsedMs = -1; },
  }, {
    label: 'null phase', mutate: (record) => { record.elapsedPhases.generationMs = null; },
  }, {
    label: 'string phase', mutate: (record) => { record.elapsedPhases.strictValidationMs = '500'; },
  }, {
    label: 'negative phase', mutate: (record) => { record.elapsedPhases.generationMs = -1; },
  }, {
    label: 'missing disposal phase', mutate: (record) => { delete record.elapsedPhases.disposalMs; },
  }, {
    label: 'phase sum drift', mutate: (record) => { record.elapsedPhases.totalMs += 1; },
  }, {
    label: 'elapsed total drift', mutate: (record) => { record.elapsedMs += 1; },
  }, {
    label: 'missing planner timing', mutate: (record) => {
      record.generatorPhaseTimings.planningTimeMs = null;
    },
  }, {
    label: 'negative assembly timing', mutate: (record) => {
      record.generatorPhaseTimings.assemblyTimeMs = -1;
    },
  }, {
    label: 'generator phase sum drift', mutate: (record) => {
      record.generatorPhaseTimings.totalMs += 1;
    },
  }];
  for (const { label, mutate } of mutations) {
    const record = createRecord(entry);
    mutate(record);
    const worker = createSeedWorkerEvidence({
      manifest,
      selection,
      provenance,
      records: [record],
      result: 'passed',
    });
    assert.throws(
      () => validateSeedWorkerEvidence(worker, manifest),
      /phase timing/u,
      label,
    );
  }
});

test('applied records require nonempty typed complete signatures', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  for (const signatures of [undefined, [], [''], [null]]) {
    const record = createRecord(selection.entries[0]);
    record.completeLayoutSignatures = signatures;
    const worker = createSeedWorkerEvidence({
      manifest,
      selection,
      provenance,
      records: [record],
      result: 'passed',
    });
    assert.throws(
      () => validateSeedWorkerEvidence(worker, manifest),
      /nonempty complete-layout signatures/u,
    );
  }
});

test('re-sealed warm-process evidence proves untimed same-process preroll before the target', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const entry = selection.entries[0];
  const mutations = [{
    label: 'not completed', mutate: (evidence) => { evidence.completed = false; },
  }, {
    label: 'included in target', mutate: (evidence) => { evidence.includedInTargetTiming = true; },
  }, {
    label: 'timing began early', mutate: (evidence) => { evidence.targetTimingStartedAfterWarmup = false; },
  }, {
    label: 'wrong warmup seed', mutate: (evidence) => { evidence.warmupSeed = 'layout:wrong'; },
  }, {
    label: 'warmup fallback', mutate: (evidence) => { evidence.warmupAugmentationStatus = 'unchanged'; },
  }, {
    label: 'warmup retry', mutate: (evidence) => { evidence.warmupRealizationAttempts = 2; },
  }, {
    label: 'warmup RNG drift', mutate: (evidence) => { evidence.warmupSourceRandomCalls += 1; },
  }, {
    label: 'null warmup duration', mutate: (evidence) => { evidence.diagnosticElapsedMs = null; },
  }, {
    label: 'missing warmup phase timing', mutate: (evidence) => {
      delete evidence.generatorPhaseTimings;
    },
  }, {
    label: 'missing warmup assembly timing', mutate: (evidence) => {
      evidence.generatorPhaseTimings.assemblyTimeMs = null;
    },
  }, {
    label: 'wrong watchdog', mutate: (evidence) => { evidence.watchdogTimeoutMs = 30_000; },
  }];
  for (const { label, mutate } of mutations) {
    const record = createRecord(entry);
    mutate(record.warmProcessEvidence);
    const worker = createSeedWorkerEvidence({
      manifest,
      selection,
      provenance,
      records: [record],
      result: 'passed',
    });
    assert.throws(
      () => validateSeedWorkerEvidence(worker, manifest),
      /worker-local warm-process evidence/u,
      label,
    );
  }
});

test('release seed workers reject missing and state-drifted selection-bag evidence', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'release', ordinalStart: 57, ordinalCount: 1,
  });
  const worker = createSeedWorkerEvidence({
    manifest,
    selection,
    provenance,
    records: [createRecord(selection.entries[0])],
    result: 'passed',
    generatedAt: '2026-07-31T00:06:30.000Z',
  });

  const missingWitnesses = structuredClone(worker);
  delete missingWitnesses.records[0].selectionBagWitnesses;
  assert.throws(
    () => validateSeedWorkerEvidence(sealEvidence(missingWitnesses), manifest),
    /lacks authoritative selection-bag witnesses/u,
  );

  const driftedWitnesses = structuredClone(worker);
  driftedWitnesses.records[0]
    .selectionBagWitnesses.encounter[0].after.consumedIds = [];
  assert.throws(
    () => validateSeedWorkerEvidence(sealEvidence(driftedWitnesses), manifest),
    /encounter.*selection-bag-witness-consumed-state-drift/u,
  );
});

test('mixed manifest and source provenance artifacts are rejected', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const shard = createShard(manifest, selection);
  const otherManifest = createManifest('2026-07-31T00:00:01.000Z');
  const otherSelection = selectCorpusEntries(otherManifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  assert.throws(
    () => validateShardEvidence(createShard(otherManifest, otherSelection), manifest),
    /different corpus manifest/u,
  );

  const mixedSourceShard = structuredClone(shard);
  mixedSourceShard.provenance.sourceHash = 'sha256-other-source';
  assert.throws(
    () => validateShardEvidence(sealEvidence(mixedSourceShard), manifest),
    /sourceHash does not match/u,
  );
  assert.throws(
    () => validateShardEvidence(manifest, manifest),
    /Expected release shard evidence/u,
  );
  assert.throws(
    () => validateShardArtifactCollection([
      { artifact: shard, label: 'valid shard' },
      { artifact: createShard(otherManifest, otherSelection), label: 'foreign shard' },
    ], manifest),
    /Invalid or mixed foreign shard/u,
  );
});

test('machine provenance is exact across artifacts and gates the named reference machine', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const shard = createShard(manifest, selection);
  for (const [field, value] of [
    ['cpuModel', 'Other CPU'],
    ['logicalCpuCount', 8],
    ['totalMemoryBytes', RELEASE_REFERENCE_MACHINE.totalMemoryBytes - 1],
  ]) {
    const mixed = structuredClone(shard);
    mixed.provenance.machine[field] = value;
    assert.throws(
      () => validateShardEvidence(sealEvidence(mixed), manifest),
      new RegExp(`machine\\.${field} does not match`, 'u'),
    );
  }
  const missing = structuredClone(shard);
  delete missing.provenance.machine.cpuModel;
  assert.throws(
    () => validateShardEvidence(sealEvidence(missing), manifest),
    /lacks exact CPU, logical-CPU, or total-memory provenance/u,
  );

  const otherMachineProvenance = structuredClone(provenance);
  otherMachineProvenance.machine.cpuModel = 'Other CPU';
  const otherManifest = createManifest(
    '2026-07-31T00:00:03.000Z',
    otherMachineProvenance,
  );
  const otherSelection = selectCorpusEntries(otherManifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const otherAggregate = aggregateShardEvidence({
    manifest: otherManifest,
    shards: [createShard(otherManifest, otherSelection)],
  });
  assert.equal(otherAggregate.gates.referenceMachine, false);
  assert.equal(otherAggregate.corpusAccepted, false);
});

test('release documentation evidence must match the current source provenance', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const aggregate = aggregateShardEvidence({
    manifest,
    shards: [createShard(manifest, selection)],
    generatedAt: '2026-07-31T00:07:00.000Z',
  });
  assert.equal(
    validateAggregateEvidenceForCurrentProvenance(aggregate, provenance),
    aggregate,
  );
  assert.throws(
    () => validateAggregateEvidenceForCurrentProvenance(aggregate, {
      ...provenance,
      sourceHash: 'sha256-stale-source',
    }),
    /sourceHash does not match/u,
  );
});

test('release suite receipts are sealed against command substitution and source drift', () => {
  const receipt = createSuiteReceipt('canonical-unit');
  assert.equal(validateReleaseSuiteReceipt(receipt), receipt);

  const substituted = structuredClone(receipt);
  substituted.commandResults[0].args = ['--test', 'tests/unrelated.test.mjs'];
  assert.throws(
    () => validateReleaseSuiteReceipt(sealEvidence(substituted)),
    /malformed or substituted/u,
  );

  const drifted = createSuiteReceipt('canonical-unit', {
    sourceStable: false,
    postRunSourceHash: 'sha256-post-run-drift',
  });
  assert.equal(drifted.result, 'failed');
  assert.equal(validateReleaseSuiteReceipt(drifted), drifted);

  const dirtyAfterRun = createSuiteReceipt('canonical-unit', {
    sourceStable: true,
    postRunSourceDirty: true,
  });
  assert.equal(dirtyAfterRun.sourceStable, false);
  assert.equal(dirtyAfterRun.result, 'failed');
  assert.equal(validateReleaseSuiteReceipt(dirtyAfterRun), dirtyAfterRun);
  const contradictoryDirtyAfterRun = structuredClone(dirtyAfterRun);
  contradictoryDirtyAfterRun.sourceStable = true;
  assert.throws(
    () => validateReleaseSuiteReceipt(sealEvidence(contradictoryDirtyAfterRun)),
    /sourceStable conflicts/u,
  );

  const dirtyBeforeRunProvenance = { ...provenance, sourceDirty: true };
  const dirtyBeforeRun = createSuiteReceipt('canonical-unit', {
    receiptProvenance: dirtyBeforeRunProvenance,
    sourceStable: true,
    postRunSourceDirty: false,
  });
  assert.equal(dirtyBeforeRun.sourceStable, false);
  assert.equal(dirtyBeforeRun.result, 'failed');
});

test('release receipts require lift enclosure, real V1 scene, and V4 visual acceptance', () => {
  const liftCommand = RELEASE_SUITE_CONTRACTS.enclosure.commands.find(({ id }) => (
    id === 'connector-lift-boarding-enclosure'
  ));
  assert.deepEqual(liftCommand, {
    id: 'connector-lift-boarding-enclosure',
    runner: 'node',
    args: ['--test', 'tests/dungeon-connector-lift-geometry.test.mjs'],
  });
  const command = RELEASE_SUITE_CONTRACTS['legacy-replay'].commands.find(({ id }) => (
    id === 'legacy-v1-connector-scene'
  ));
  assert.deepEqual(command, {
    id: 'legacy-v1-connector-scene',
    runner: 'node',
    args: [
      'node_modules/@playwright/test/cli.js',
      'test',
      'tests/dungeon-connector-runtime.spec.js',
      '--workers=1',
    ],
  });
  const playwrightCommand = RELEASE_SUITE_CONTRACTS.playwright.commands.find(({ id }) => (
    id === 'augmentation-runtime-journeys'
  ));
  assert.ok(
    playwrightCommand.args.includes('tests/dungeon-augmentation-visual-acceptance.spec.js'),
  );
});

test('release attestation seals passing predecessors and rejects coverage or identity bypasses', () => {
  const manifest = createManifest();
  const aggregate = createPassingAggregate(manifest, 'release');
  const predecessorEvidence = createPassingPredecessorEvidence(manifest);
  const receipts = RELEASE_REQUIRED_SUITE_IDS.map((suiteId) => createSuiteReceipt(suiteId));
  const attestation = createReleaseAttestation({
    aggregate,
    predecessorEvidence,
    suiteReceipts: receipts,
    generatedAt: '2026-07-31T00:10:00.000Z',
  });
  assert.equal(validateReleaseAttestation(attestation), attestation);
  assert.deepEqual(Object.keys(attestation.predecessorEvidence), [
    ...RELEASE_PREDECESSOR_STAGE_IDS,
  ]);
  assert.equal(attestation.gates.exactPredecessorCoverage, true);
  assert.equal(attestation.gates.predecessorStagesPassed, true);
  assert.equal(attestation.gates.predecessorManifestIdentity, true);
  assert.equal(attestation.gates.exactReceiptCoverage, true);
  assert.equal(attestation.gates.sameSourceProvenance, true);
  assert.equal(attestation.gates.receiptsPassed, true);
  assert.equal(attestation.gates.releaseCorpusTier, true);
  assert.equal(attestation.releaseAccepted, true);

  assert.throws(
    () => createReleaseAttestation({
      aggregate,
      predecessorEvidence,
      suiteReceipts: receipts.slice(1),
    }),
    /missing receipts: canonical-unit/u,
  );
  assert.throws(
    () => createReleaseAttestation({
      aggregate,
      predecessorEvidence,
      suiteReceipts: [...receipts, receipts[0]],
    }),
    /duplicate canonical-unit receipts/u,
  );

  for (const stage of RELEASE_PREDECESSOR_STAGE_IDS) {
    const missing = { ...predecessorEvidence };
    delete missing[stage];
    assert.throws(
      () => createReleaseAttestation({
        aggregate,
        predecessorEvidence: missing,
        suiteReceipts: receipts,
      }),
      new RegExp(`missing predecessor stages: ${stage}`, 'u'),
      stage,
    );
  }

  const mixedProvenance = structuredClone(provenance);
  mixedProvenance.sourceHash = 'sha256-other-receipt-source';
  const mixedReceipts = receipts.map((receipt) => receipt.suiteId === 'playwright'
    ? createSuiteReceipt('playwright', { receiptProvenance: mixedProvenance })
    : receipt);
  assert.throws(
    () => createReleaseAttestation({
      aggregate,
      predecessorEvidence,
      suiteReceipts: mixedReceipts,
    }),
    /sourceHash does not match/u,
  );

  const mixedSourcePredecessors = {
    ...predecessorEvidence,
    smoke: structuredClone(predecessorEvidence.smoke),
  };
  mixedSourcePredecessors.smoke.provenance.sourceHash = 'sha256-other-predecessor-source';
  mixedSourcePredecessors.smoke = sealEvidence(mixedSourcePredecessors.smoke);
  assert.throws(
    () => createReleaseAttestation({
      aggregate,
      predecessorEvidence: mixedSourcePredecessors,
      suiteReceipts: receipts,
    }),
    /sourceHash does not match/u,
  );

  const mixedManifestPredecessors = structuredClone(predecessorEvidence);
  mixedManifestPredecessors.normal.manifestHash = 'sha256-other-manifest';
  mixedManifestPredecessors.normal = sealEvidence(mixedManifestPredecessors.normal);
  assert.throws(
    () => createReleaseAttestation({
      aggregate,
      predecessorEvidence: mixedManifestPredecessors,
      suiteReceipts: receipts,
    }),
    /wrong tier, manifest, or profile identity/u,
  );

  const failedCanonical = createCanonicalProbeEvidence({
    manifest,
    provenance,
    records: [],
    generatedAt: '2026-07-31T00:09:30.000Z',
  });
  const forgedCanonical = structuredClone(failedCanonical);
  forgedCanonical.gates = Object.fromEntries(
    Object.keys(forgedCanonical.gates).map((gate) => [gate, true]),
  );
  forgedCanonical.accepted = true;
  forgedCanonical.result = 'passed';
  forgedCanonical.failure = null;
  const forgedPredecessors = {
    ...predecessorEvidence,
    canonical: sealEvidence(forgedCanonical),
  };
  assert.throws(
    () => createReleaseAttestation({
      aggregate,
      predecessorEvidence: forgedPredecessors,
      suiteReceipts: receipts,
    }),
    /result, gates, or failure diagnostics are inconsistent/u,
  );

  const missingEmbeddedPredecessor = structuredClone(attestation);
  delete missingEmbeddedPredecessor.predecessorEvidence.normal;
  missingEmbeddedPredecessor.releaseAccepted = true;
  missingEmbeddedPredecessor.result = 'passed';
  assert.throws(
    () => validateReleaseAttestation(sealEvidence(missingEmbeddedPredecessor)),
    /missing predecessor stages: normal/u,
  );
  assert.throws(
    () => validateReleaseAttestation(aggregate),
    /aggregate-and-receipts attestation/u,
  );
});

test('failed suite receipts remain sealed evidence but cannot pass the final attestation', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const aggregate = aggregateShardEvidence({
    manifest,
    shards: [createShard(manifest, selection)],
  });
  const receipts = RELEASE_REQUIRED_SUITE_IDS.map((suiteId) => (
    suiteId === 'playwright'
      ? createSuiteReceipt(suiteId, { failedCommandIndex: 0 })
      : createSuiteReceipt(suiteId)
  ));
  const predecessorEvidence = createPassingPredecessorEvidence(manifest);
  const attestation = createReleaseAttestation({
    aggregate,
    predecessorEvidence,
    suiteReceipts: receipts,
  });
  assert.equal(attestation.gates.receiptsPassed, false);
  assert.equal(attestation.releaseAccepted, false);
});

test('direct release verifier and finalizer require predecessor artifacts', async () => {
  const [verifierSource, finalizerSource] = await Promise.all([
    readFile(
      new URL('../scripts/verify-dungeon-augmentation-release.mjs', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../scripts/finalize-dungeon-augmentation-release-evidence.mjs', import.meta.url),
      'utf8',
    ),
  ]);
  for (const requiredArgument of [
    '--canonical=',
    '--smoke-aggregate=',
    '--normal-aggregate=',
  ]) {
    assert.ok(verifierSource.includes(requiredArgument), requiredArgument);
  }
  const preflightStart = verifierSource.indexOf("if (tier === 'release') {");
  const releaseWorkStart = verifierSource.indexOf('await mkdir(shardDirectory');
  assert.ok(preflightStart >= 0 && preflightStart < releaseWorkStart);
  assert.match(
    verifierSource.slice(preflightStart, releaseWorkStart),
    /validateReleasePredecessorEvidenceCollection/u,
  );
  assert.match(
    finalizerSource,
    /!canonicalArgument\s*\|\|\s*!smokeAggregateArgument\s*\|\|\s*!normalAggregateArgument/u,
  );
  assert.match(
    finalizerSource,
    /createReleaseAttestation\(\{[\s\S]*predecessorEvidence,[\s\S]*suiteReceipts/u,
  );
});

test('package smoke and normal aliases use the ordered immutable release gates', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  ));
  assert.equal(
    packageJson.scripts['test:dungeon-augmentation:realized:smoke'],
    'node scripts/run-dungeon-augmentation-release-gates.mjs --through=smoke',
  );
  assert.equal(
    packageJson.scripts['test:dungeon-augmentation:realized'],
    'node scripts/run-dungeon-augmentation-release-gates.mjs --through=normal',
  );
  for (const alias of [
    packageJson.scripts['test:dungeon-augmentation:realized:smoke'],
    packageJson.scripts['test:dungeon-augmentation:realized'],
  ]) {
    assert.doesNotMatch(alias, /verify-dungeon-augmentation-realized|--count|--start/u);
  }
  assert.equal(
    packageJson.scripts['build:dungeon-augmentation:corpus:smoke'],
    'npm run build:dungeon-augmentation:corpus',
  );
  assert.equal(
    packageJson.scripts['build:dungeon-augmentation:corpus:normal'],
    'npm run build:dungeon-augmentation:corpus',
  );
});

test('immutable JSON evidence is atomic and refuses a different replacement', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'dungeon-augmentation-evidence-'));
  const outputPath = path.join(temporaryDirectory, 'evidence.json');
  try {
    const manifest = createManifest();
    assert.equal(await writeImmutableJson(outputPath, manifest), 'written');
    assert.equal(await writeImmutableJson(outputPath, manifest), 'reused');
    const stored = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(stored.evidenceHash, manifest.evidenceHash);
    await assert.rejects(
      writeImmutableJson(outputPath, { ...manifest, generatedAt: 'changed' }),
      /Immutable evidence already exists/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
