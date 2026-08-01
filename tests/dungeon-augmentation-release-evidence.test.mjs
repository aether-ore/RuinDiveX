import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
  RELEASE_PERFORMANCE_BUDGET_MS,
  RELEASE_PROFILE_ID,
  RELEASE_PROFILE_REVISION,
  RELEASE_REQUIRED_SUITE_IDS,
  RELEASE_REFERENCE_MACHINE,
  RELEASE_SHARD_TOPOLOGY,
  RELEASE_SUITE_CONTRACTS,
  RELEASE_WARM_PROCESS_EVIDENCE_SCHEMA,
  RELEASE_WARM_PROCESS_MODE,
  aggregateShardEvidence,
  assertSealedEvidence,
  createAcceptedParentWitness,
  createCorpusManifest,
  createReleaseAttestation,
  createReleaseSuiteReceipt,
  createSeedWorkerEvidence,
  createShardEvidence,
  hashCanonicalValue,
  runReleaseSeedWorkerProcess,
  sealEvidence,
  selectCorpusEntries,
  validateAggregateEvidenceForCurrentProvenance,
  validateAcceptedParentWitness,
  validateCorpusManifest,
  validateReleaseAttestation,
  validateReleaseSuiteReceipt,
  validateSeedWorkerEvidence,
  validateShardArtifactCollection,
  validateShardEvidence,
  writeImmutableJson,
} from '../scripts/dungeon-augmentation-release-evidence.mjs';

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
      totalMs: 8_000,
    },
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
} = {}) {
  return createShardEvidence({
    manifest,
    selection,
    provenance: shardProvenance,
    records: records ?? selection.entries.map((entry) => createRecord(entry)),
    result,
    generatedAt: '2026-07-31T00:01:00.000Z',
  });
}

function createSuiteReceipt(suiteId, {
  receiptProvenance = provenance,
  failedCommandIndex = -1,
  sourceStable = true,
  postRunSourceHash = receiptProvenance.sourceHash,
} = {}) {
  const contract = RELEASE_SUITE_CONTRACTS[suiteId];
  return createReleaseSuiteReceipt({
    suiteId,
    provenance: receiptProvenance,
    sourceStable,
    postRunSourceHash,
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
    label: 'phase sum drift', mutate: (record) => { record.elapsedPhases.totalMs += 1; },
  }, {
    label: 'elapsed total drift', mutate: (record) => { record.elapsedMs += 1; },
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
      /finite nonnegative and internally consistent phase timing/u,
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
});

test('release attestation rejects missing, duplicate, and mixed-source receipts', () => {
  const manifest = createManifest();
  const selection = selectCorpusEntries(manifest, {
    tier: 'smoke', shardIndex: 0, shardCount: 1,
  });
  const aggregate = aggregateShardEvidence({
    manifest,
    shards: [createShard(manifest, selection)],
    generatedAt: '2026-07-31T00:09:00.000Z',
  });
  const receipts = RELEASE_REQUIRED_SUITE_IDS.map((suiteId) => createSuiteReceipt(suiteId));
  const attestation = createReleaseAttestation({
    aggregate,
    suiteReceipts: receipts,
    generatedAt: '2026-07-31T00:10:00.000Z',
  });
  assert.equal(validateReleaseAttestation(attestation), attestation);
  assert.equal(attestation.gates.exactReceiptCoverage, true);
  assert.equal(attestation.gates.sameSourceProvenance, true);
  assert.equal(attestation.gates.receiptsPassed, true);
  assert.equal(attestation.gates.releaseCorpusTier, false);
  assert.equal(attestation.releaseAccepted, false);

  assert.throws(
    () => createReleaseAttestation({ aggregate, suiteReceipts: receipts.slice(1) }),
    /missing receipts: canonical-unit/u,
  );
  assert.throws(
    () => createReleaseAttestation({
      aggregate,
      suiteReceipts: [...receipts, receipts[0]],
    }),
    /duplicate canonical-unit receipts/u,
  );

  const mixedProvenance = structuredClone(provenance);
  mixedProvenance.sourceHash = 'sha256-other-receipt-source';
  const mixedReceipts = receipts.map((receipt) => receipt.suiteId === 'playwright'
    ? createSuiteReceipt('playwright', { receiptProvenance: mixedProvenance })
    : receipt);
  assert.throws(
    () => createReleaseAttestation({ aggregate, suiteReceipts: mixedReceipts }),
    /sourceHash does not match/u,
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
  const attestation = createReleaseAttestation({ aggregate, suiteReceipts: receipts });
  assert.equal(attestation.gates.receiptsPassed, false);
  assert.equal(attestation.releaseAccepted, false);
});

test('package smoke and normal aliases use only the immutable ordinal evidence workflow', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  ));
  assert.equal(
    packageJson.scripts['test:dungeon-augmentation:realized:smoke'],
    'node scripts/verify-dungeon-augmentation-release.mjs --tier=smoke',
  );
  assert.equal(
    packageJson.scripts['test:dungeon-augmentation:realized'],
    'node scripts/verify-dungeon-augmentation-release.mjs --tier=normal',
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
