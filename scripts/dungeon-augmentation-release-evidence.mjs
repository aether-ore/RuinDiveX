import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  accessSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DUNGEON_AUGMENTATION_PROFILES,
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMARS,
} from '../src/dungeon-augmentation/catalog.js';
import {
  INDUSTRIAL_SUPPLEMENT_ENCOUNTER_PROFILE_IDS,
} from '../src/dungeon-augmentation/IndustrialSupplementContent.js';
import {
  DUNGEON_SELECTION_BAG_FAMILIES,
  validateDungeonSelectionBagWitnessSequence,
} from '../src/dungeon-augmentation/selectionBagWitness.js';

export const RELEASE_EVIDENCE_SCHEMA_VERSION = 1;
export const RELEASE_PROFILE_ID = 'industrial-supplement-preview-v4';
export const RELEASE_PROFILE_REVISION = 5;
export const RELEASE_CORPUS_COUNTS = Object.freeze({
  smoke: 10,
  normal: 100,
  release: 1000,
});
export const RELEASE_SHARD_TOPOLOGY = Object.freeze({
  smoke: Object.freeze({ shardCount: 1, shardSize: 10 }),
  normal: Object.freeze({ shardCount: 10, shardSize: 10 }),
  release: Object.freeze({ shardCount: 20, shardSize: 50 }),
});
export const RELEASE_MASTER_CORPUS_COUNT = RELEASE_CORPUS_COUNTS.release;
export const RELEASE_PERFORMANCE_BUDGET_MS = Object.freeze({
  median: 10_000,
  p95: 20_000,
  maximum: 30_000,
  ciTimeoutPerSeed: 180_000,
});
export const RELEASE_AUGMENTATION_REALIZATION_ATTEMPT_LIMIT = 1;
export const RELEASE_WARM_PROCESS_EVIDENCE_SCHEMA =
  'ruindivex-dungeon-augmentation-warm-process-evidence/v1';
export const RELEASE_WARM_PROCESS_MODE = 'worker-local-preroll';
export const RELEASE_PHASE_HEARTBEAT_SCHEMA =
  'ruindivex-dungeon-augmentation-release-phase-heartbeat/v1';
export const RELEASE_GENERATOR_PHASE_TIMING_SCHEMA =
  'ruindivex-dungeon-augmentation-generator-phase-timings/v1';
export const RELEASE_GENERATOR_PHASES = Object.freeze([
  'parent-generation',
  'planning',
  'materialization',
  'three-js-assembly',
  'strict-validation',
  'disposal',
]);
export const RELEASE_CANONICAL_PROBES = Object.freeze([
  Object.freeze({
    ordinal: 0,
    seed: 'layout:augmentation-realized-v4-000',
  }),
  Object.freeze({
    ordinal: 1,
    seed: 'layout:augmentation-realized-v4-001',
  }),
]);
export const RELEASE_CANONICAL_GATE_SCHEMA =
  'ruindivex-dungeon-augmentation-canonical-release-gate/v1';
export const RELEASE_PREDECESSOR_STAGE_IDS = Object.freeze([
  'canonical',
  'smoke',
  'normal',
]);
export const RELEASE_SUITE_RECEIPT_SCHEMA =
  'ruindivex-dungeon-augmentation-release-suite-receipt/v1';
export const RELEASE_ATTESTATION_SCHEMA =
  'ruindivex-dungeon-augmentation-release-attestation/v1';
export const RELEASE_REQUIRED_SUITE_IDS = Object.freeze([
  'canonical-unit',
  'enclosure',
  'legacy-replay',
  'persistence-lifecycle',
  'playwright',
]);
export const RELEASE_SUITE_CONTRACTS = Object.freeze({
  'canonical-unit': Object.freeze({
    label: 'canonical unit and blueprint manifest',
    commands: Object.freeze([
      Object.freeze({
        id: 'canonical-unit-and-blueprints',
        runner: 'node',
        args: Object.freeze(['scripts/verify-dungeon-augmentation.mjs', '--unit']),
      }),
    ]),
  }),
  enclosure: Object.freeze({
    label: 'collision-derived enclosure',
    commands: Object.freeze([
      Object.freeze({
        id: 'connector-enclosure',
        runner: 'node',
        args: Object.freeze(['--test', 'tests/dungeon-connector-enclosure.test.mjs']),
      }),
      Object.freeze({
        id: 'connector-lift-boarding-enclosure',
        runner: 'node',
        args: Object.freeze(['--test', 'tests/dungeon-connector-lift-geometry.test.mjs']),
      }),
    ]),
  }),
  'legacy-replay': Object.freeze({
    label: 'immutable V1-V3 replay and real V1 scene assembly',
    commands: Object.freeze([
      Object.freeze({
        id: 'legacy-applied-overlay-fixtures',
        runner: 'node',
        args: Object.freeze([
          '--test',
          'tests/dungeon-augmentation-legacy-applied-replay.test.mjs',
        ]),
      }),
      Object.freeze({
        id: 'legacy-realized-parity-100',
        runner: 'node',
        args: Object.freeze([
          'scripts/verify-dungeon-augmentation-legacy-realized.mjs',
          '--count=100',
        ]),
      }),
      Object.freeze({
        id: 'legacy-v1-connector-scene',
        runner: 'node',
        args: Object.freeze([
          'node_modules/@playwright/test/cli.js',
          'test',
          'tests/dungeon-connector-runtime.spec.js',
          '--workers=1',
        ]),
      }),
    ]),
  }),
  'persistence-lifecycle': Object.freeze({
    label: 'persistence and five-cycle lifecycle',
    commands: Object.freeze([
      Object.freeze({
        id: 'persistence-contracts',
        runner: 'node',
        args: Object.freeze([
          '--test',
          'tests/dungeon-augmentation-persistence.test.mjs',
        ]),
      }),
      Object.freeze({
        id: 'five-cycle-resource-plateau',
        runner: 'node',
        args: Object.freeze([
          'node_modules/@playwright/test/cli.js',
          'test',
          'tests/dungeon-augmentation-runtime.spec.js',
          '--grep=five opt-in enter/fresh-reset/exit cycles plateau supplement ownership and resources',
          '--workers=1',
        ]),
      }),
    ]),
  }),
  playwright: Object.freeze({
    label: 'ordinary-movement and disposable-alpha Playwright journeys',
    commands: Object.freeze([
      Object.freeze({
        id: 'augmentation-runtime-journeys',
        runner: 'node',
        args: Object.freeze([
          'node_modules/@playwright/test/cli.js',
          'test',
          'tests/player-test-invulnerability.spec.js',
          'tests/dungeon-augmentation-runtime.spec.js',
          'tests/dungeon-augmentation-recovery.spec.js',
          'tests/dungeon-augmentation-journey.spec.js',
          'tests/dungeon-augmentation-visual-acceptance.spec.js',
          '--workers=1',
        ]),
      }),
    ]),
  }),
});
export const RELEASE_REFERENCE_MACHINE = Object.freeze({
  nodeVersion: 'v24.17.0',
  platform: 'win32-x64',
  cpuModel: 'AMD Ryzen 7 9800X3D 8-Core Processor',
  logicalCpuCount: 16,
  totalMemoryBytes: 33_453_711_360,
});

export function validateReleaseSelectionBagWitnesses(selectionBagWitnesses) {
  if (!selectionBagWitnesses || typeof selectionBagWitnesses !== 'object') {
    throw new Error('Release seed record lacks authoritative selection-bag witnesses.');
  }
  for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
    const validation = validateDungeonSelectionBagWitnessSequence(
      selectionBagWitnesses[family],
      { family, requireNonEmpty: true },
    );
    if (!validation.accepted) {
      const first = validation.errors[0] ?? {};
      throw new Error(
        `Release seed selection-bag witness ${family} is invalid: ${first.code ?? 'unknown'}.`,
      );
    }
  }
  const unknownFamilies = Object.keys(selectionBagWitnesses).filter((family) => (
    !DUNGEON_SELECTION_BAG_FAMILIES.includes(family)
  ));
  if (unknownFamilies.length > 0) {
    throw new Error(
      `Release seed selection-bag witnesses contain unknown families: ${unknownFamilies.join(', ')}.`,
    );
  }
  return selectionBagWitnesses;
}

export function runReleaseSeedWorkerProcess({
  executablePath,
  args,
  cwd,
  stdio = ['ignore', 'ignore', 'inherit'],
  spawnSyncImpl = spawnSync,
}) {
  return spawnSyncImpl(executablePath, args, {
    cwd,
    stdio,
    timeout: RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed,
    windowsHide: true,
  });
}
const RELEASE_PROFILE = DUNGEON_AUGMENTATION_PROFILES[RELEASE_PROFILE_ID];
const sortedProfileFamilies = (values = []) => Object.freeze(
  [...new Set(values.map(String))].sort((left, right) => left.localeCompare(right)),
);
export const EXPECTED_TOPOLOGY_TEMPLATE_IDS = sortedProfileFamilies(
  RELEASE_PROFILE.routeNetworkPlanning.topologyTemplates,
);
export const EXPECTED_JUNCTION_KINDS = sortedProfileFamilies(
  RELEASE_PROFILE.routeNetworkPlanning.junctionKinds,
);
export const EXPECTED_ELEVATION_MODES = sortedProfileFamilies(
  RELEASE_PROFILE.routeNetworkPlanning.elevationModes,
);
export const EXPECTED_ENCOUNTER_PROFILE_IDS = sortedProfileFamilies(
  INDUSTRIAL_SUPPLEMENT_ENCOUNTER_PROFILE_IDS,
);
export const EXPECTED_ROOM_LAYOUT_IDS = Object.freeze(
  RELEASE_PROFILE.grammarPool
    .map(({ id }) => INDUSTRIAL_SUPPLEMENT_BLUEPRINT_GRAMMARS[id])
    .filter((grammar) => (
      grammar?.selectionConstraints?.routeNetworkModuleKind === 'room'
    ))
    .map(({ id }) => String(id))
    .sort((left, right) => left.localeCompare(right)),
);

const EVIDENCE_HASH_NAMESPACE = 'dungeon-augmentation-v4-release-evidence-v1';
const RELEASE_SOURCE_ROOTS = Object.freeze(['src', 'scripts', 'tests']);
const RELEASE_SOURCE_FILE_NAMES = new Set(['package.json', 'package-lock.json']);
const RELEASE_SCRIPT_PATTERN = /(?:dungeon-augmentation|document-dungeon-augmentation)/u;
const RELEASE_TEST_PATTERN = /dungeon-augmentation|DungeonSupplementAssembler\.test/u;

function normalizeCanonicalValue(value) {
  if (Array.isArray(value)) return value.map(normalizeCanonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      normalizeCanonicalValue(value[key]),
    ]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (typeof value === 'undefined') return null;
  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(normalizeCanonicalValue(value));
}

export function hashCanonicalValue(value, namespace = EVIDENCE_HASH_NAMESPACE) {
  return `sha256-${createHash('sha256')
    .update(`${namespace}\u0000${canonicalStringify(value)}`)
    .digest('hex')}`;
}

function evidencePayload(value) {
  const { evidenceHash: _evidenceHash, ...payload } = value ?? {};
  return payload;
}

export function sealEvidence(value) {
  const payload = evidencePayload(value);
  return {
    ...payload,
    evidenceHash: hashCanonicalValue(payload),
  };
}

export function assertSealedEvidence(value, label = 'release evidence') {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  const expected = hashCanonicalValue(evidencePayload(value));
  if (value.evidenceHash !== expected) {
    throw new Error(`${label} evidenceHash does not match its canonical payload.`);
  }
  return value;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function pathExistsSync(targetPath) {
  try {
    accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function temporaryEvidencePath(targetPath) {
  return `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function writeImmutableJson(targetPath, value) {
  const resolvedPath = path.resolve(targetPath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  if (await pathExists(resolvedPath)) {
    const existing = JSON.parse(await readFile(resolvedPath, 'utf8'));
    if (canonicalStringify(existing) === canonicalStringify(value)) return 'reused';
    throw new Error(`Immutable evidence already exists at ${resolvedPath}. Use a new path.`);
  }
  const temporaryPath = temporaryEvidencePath(resolvedPath);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
  return 'written';
}

export function writeImmutableJsonSync(targetPath, value) {
  const resolvedPath = path.resolve(targetPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  if (pathExistsSync(resolvedPath)) {
    const existing = JSON.parse(readFileSync(resolvedPath, 'utf8'));
    if (canonicalStringify(existing) === canonicalStringify(value)) return 'reused';
    throw new Error(`Immutable evidence already exists at ${resolvedPath}. Use a new path.`);
  }
  const temporaryPath = temporaryEvidencePath(resolvedPath);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    renameSync(temporaryPath, resolvedPath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
  return 'written';
}

export async function readJson(targetPath) {
  return JSON.parse(await readFile(path.resolve(targetPath), 'utf8'));
}

const RELEASE_GENERATOR_PHASE_TIMING_FIELDS = Object.freeze({
  'parent-generation': 'parentGenerationMs',
  planning: 'planningMs',
  materialization: 'materializationMs',
  'three-js-assembly': 'threeJsAssemblyMs',
  'strict-validation': 'strictValidationMs',
  disposal: 'disposalMs',
});
const RELEASE_GENERATOR_METRIC_FIELDS = Object.freeze([
  'planningTimeMs',
  'assemblyTimeMs',
]);

function emptyReleaseGeneratorPhaseTimings() {
  return {
    schema: RELEASE_GENERATOR_PHASE_TIMING_SCHEMA,
    parentGenerationMs: 0,
    planningMs: 0,
    materializationMs: 0,
    threeJsAssemblyMs: 0,
    strictValidationMs: 0,
    disposalMs: 0,
    totalMs: 0,
  };
}

export function captureReleaseGeneratorMetrics(augmentationMetrics) {
  return {
    planningTimeMs: finiteNonnegativeNumber(augmentationMetrics?.planningTimeMs)
      ? augmentationMetrics.planningTimeMs
      : null,
    assemblyTimeMs: finiteNonnegativeNumber(augmentationMetrics?.assemblyTimeMs)
      ? augmentationMetrics.assemblyTimeMs
      : null,
  };
}

export function captureReleaseDungeonGeneratorMetrics(dungeon, {
  observedAttemptMetrics = null,
} = {}) {
  if (dungeon?.augmentationMetrics != null) {
    return captureReleaseGeneratorMetrics(dungeon.augmentationMetrics);
  }

  const rejectedAttempts = dungeon?.augmentationDiagnostics?.rejectedOverlay?.attempts;
  const finalRejectedAttempt = Array.isArray(rejectedAttempts)
    ? rejectedAttempts.at(-1) ?? null
    : null;
  const attemptMetrics = finalRejectedAttempt?.augmentationMetrics
    ?? finalRejectedAttempt?.diagnostics?.augmentationMetrics
    ?? null;
  if (attemptMetrics != null) {
    return captureReleaseGeneratorMetrics(attemptMetrics);
  }

  const attemptDiagnostics = finalRejectedAttempt?.diagnostics;
  return captureReleaseGeneratorMetrics({
    planningTimeMs: attemptDiagnostics?.planningTimeMs,
    // Rejected-overlay diagnostics currently retain the planner metric, while
    // the release observer receives the exact completed Three.js assembly
    // duration. The observer resets this value whenever a new planning attempt
    // starts, so it belongs to the same final rejected attempt rather than an
    // earlier repair pass. A missing completion remains null and fails closed.
    assemblyTimeMs: attemptDiagnostics?.assemblyTimeMs
      ?? observedAttemptMetrics?.assemblyTimeMs,
  });
}

export function retainReleaseGeneratorMetrics(phaseTimings, augmentationMetrics) {
  if (!phaseTimings) return null;
  const captured = captureReleaseGeneratorMetrics(augmentationMetrics);
  return validateReleaseGeneratorPhaseTimings({
    ...phaseTimings,
    planningTimeMs: captured.planningTimeMs ?? phaseTimings.planningTimeMs ?? null,
    assemblyTimeMs: captured.assemblyTimeMs ?? phaseTimings.assemblyTimeMs ?? null,
  });
}

function releaseGeneratorPhaseTimingTotal(timings) {
  return Object.values(RELEASE_GENERATOR_PHASE_TIMING_FIELDS).reduce((total, field) => (
    total + Number(timings?.[field] ?? 0)
  ), 0);
}

export function validateReleaseGeneratorPhaseTimings(timings, {
  label = 'release generator phase timings',
  requireGeneratorMetrics = false,
} = {}) {
  const fields = Object.values(RELEASE_GENERATOR_PHASE_TIMING_FIELDS);
  if (!timings
    || typeof timings !== 'object'
    || Array.isArray(timings)
    || timings.schema !== RELEASE_GENERATOR_PHASE_TIMING_SCHEMA
    || fields.some((field) => !finiteNonnegativeNumber(timings[field]))
    || RELEASE_GENERATOR_METRIC_FIELDS.some((field) => !Object.hasOwn(timings, field))
    || !finiteNonnegativeNumber(timings.totalMs)
    || Math.abs(releaseGeneratorPhaseTimingTotal(timings) - timings.totalMs) > 1e-6
    || (requireGeneratorMetrics && (
      !finiteNonnegativeNumber(timings.planningTimeMs)
        || !finiteNonnegativeNumber(timings.assemblyTimeMs)
    ))
    || (timings.planningTimeMs != null && !finiteNonnegativeNumber(timings.planningTimeMs))
    || (timings.assemblyTimeMs != null && !finiteNonnegativeNumber(timings.assemblyTimeMs))) {
    throw new Error(`${label} is malformed or internally inconsistent.`);
  }
  return timings;
}

function releaseFailurePhaseRequiresGeneratorMetrics(phaseEvidence) {
  return phaseEvidence?.phase === 'strict-validation'
    || phaseEvidence?.phase === 'disposal';
}

export function canonicalProbePerformance(records = []) {
  const elapsed = records
    .map(({ elapsedMs }) => elapsedMs)
    .filter(finiteNonnegativeNumber);
  return {
    medianMs: median(elapsed),
    p95Ms: nearestRank(elapsed, 0.95),
    maximumMs: elapsed.length > 0 ? Math.max(...elapsed) : null,
    budgetMs: {
      median: RELEASE_PERFORMANCE_BUDGET_MS.median,
      p95: RELEASE_PERFORMANCE_BUDGET_MS.p95,
      maximum: RELEASE_PERFORMANCE_BUDGET_MS.maximum,
    },
  };
}

export function canonicalProbeGates(records = []) {
  const performance = canonicalProbePerformance(records);
  const exactCanonicalCoverage = records.length === RELEASE_CANONICAL_PROBES.length
    && RELEASE_CANONICAL_PROBES.every((probe, index) => (
      records[index]?.ordinal === probe.ordinal
      && records[index]?.seed === probe.seed
    ));
  const complete = exactCanonicalCoverage;
  return {
    exactCanonicalCoverage,
    zeroFallback: complete && records.every(({ status }) => status === 'applied'),
    firstRealization: complete && records.every(({ realizationAttempts }) => (
      realizationAttempts === RELEASE_AUGMENTATION_REALIZATION_ATTEMPT_LIMIT
    )),
    releaseValidation: complete && records.every((record) => (
      record.releaseValidationAccepted === true
      && Number(record.releaseValidationErrorCount ?? 0) === 0
      && record.acceptedAsPlayableAlpha !== true
    )),
    strictRealizedValidation: complete
      && records.every(({ strictRealizedAccepted }) => strictRealizedAccepted === true),
    acceptedParentParity: complete
      && records.every(({ acceptedParentParity }) => acceptedParentParity === true),
    phaseEvidence: complete && records.every((record) => {
      try {
        validateReleaseGeneratorPhaseTimings(record.generatorPhaseTimings, {
          label: `canonical probe ${record.seed} generator phase timings`,
          requireGeneratorMetrics: true,
        });
        return true;
      } catch {
        return false;
      }
    }),
    performance: complete
      && performance.medianMs <= RELEASE_PERFORMANCE_BUDGET_MS.median
      && performance.p95Ms <= RELEASE_PERFORMANCE_BUDGET_MS.p95
      && performance.maximumMs <= RELEASE_PERFORMANCE_BUDGET_MS.maximum,
  };
}

export function createCanonicalProbeEvidence({
  manifest,
  provenance,
  records,
  failure = null,
  generatedAt = new Date().toISOString(),
}) {
  assertMatchingReleaseProvenance(provenance, manifest.provenance, 'canonical release gate');
  const performance = canonicalProbePerformance(records);
  const gates = canonicalProbeGates(records);
  const accepted = Object.values(gates).every(Boolean);
  const resolvedFailure = accepted ? null : failure ?? {
    errorName: 'CanonicalReleaseGateRejected',
    message: `Canonical release gates failed: ${Object.entries(gates)
      .filter(([, passed]) => !passed)
      .map(([gate]) => gate)
      .join(', ')}.`,
  };
  return sealEvidence({
    schema: RELEASE_CANONICAL_GATE_SCHEMA,
    kind: 'dungeon-augmentation-canonical-release-gate',
    generatedAt,
    result: accepted ? 'passed' : 'failed',
    accepted,
    profile: manifest.profile,
    provenance,
    manifestHash: manifest.evidenceHash,
    attemptLimit: RELEASE_AUGMENTATION_REALIZATION_ATTEMPT_LIMIT,
    watchdogTimeoutMs: RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed,
    expectedProbes: RELEASE_CANONICAL_PROBES,
    records,
    failure: resolvedFailure,
    performance,
    gates,
  });
}

export function validateCanonicalProbeEvidence(evidence, manifest) {
  assertSealedEvidence(evidence, 'canonical release gate');
  assertMatchingReleaseProvenance(
    evidence.provenance,
    manifest.provenance,
    'canonical release gate',
  );
  if (evidence.schema !== RELEASE_CANONICAL_GATE_SCHEMA
    || evidence.kind !== 'dungeon-augmentation-canonical-release-gate'
    || evidence.manifestHash !== manifest.evidenceHash
    || canonicalStringify(evidence.profile) !== canonicalStringify(manifest.profile)
    || evidence.attemptLimit !== RELEASE_AUGMENTATION_REALIZATION_ATTEMPT_LIMIT
    || evidence.watchdogTimeoutMs !== RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed
    || canonicalStringify(evidence.expectedProbes) !== canonicalStringify(RELEASE_CANONICAL_PROBES)
    || !Array.isArray(evidence.records)) {
    throw new Error('Canonical release gate evidence has an invalid contract or manifest identity.');
  }
  const records = evidence.records;
  const seenOrdinals = new Set();
  for (const record of records) {
    const expected = RELEASE_CANONICAL_PROBES[record?.ordinal];
    if (!expected
      || record.seed !== expected.seed
      || seenOrdinals.has(record.ordinal)
      || typeof record.workerEvidenceHash !== 'string'
      || !record.workerEvidenceHash.startsWith('sha256-')
      || !finiteNonnegativeNumber(record.elapsedMs)) {
      throw new Error('Canonical release gate contains an invalid or duplicate probe record.');
    }
    validateReleaseGeneratorPhaseTimings(record.generatorPhaseTimings, {
      label: `canonical probe ${record.seed} generator phase timings`,
      requireGeneratorMetrics: true,
    });
    seenOrdinals.add(record.ordinal);
  }
  const performance = canonicalProbePerformance(records);
  const gates = canonicalProbeGates(records);
  const accepted = Object.values(gates).every(Boolean);
  if (canonicalStringify(evidence.performance) !== canonicalStringify(performance)
    || canonicalStringify(evidence.gates) !== canonicalStringify(gates)
    || evidence.accepted !== accepted
    || evidence.result !== (accepted ? 'passed' : 'failed')
    || (accepted && evidence.failure != null)
    || (!accepted && (!evidence.failure || typeof evidence.failure !== 'object'))) {
    throw new Error('Canonical release gate result, gates, or failure diagnostics are inconsistent.');
  }
  return evidence;
}

export function createReleasePhaseHeartbeatReporter({
  targetPath,
  targetEntry,
  warmupEntry,
  epochNow = () => Date.now(),
  monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  if (typeof targetPath !== 'string' || !targetPath
    || !Number.isSafeInteger(targetEntry?.ordinal)
    || typeof targetEntry?.seed !== 'string' || !targetEntry.seed
    || !Number.isSafeInteger(warmupEntry?.ordinal)
    || typeof warmupEntry?.seed !== 'string' || !warmupEntry.seed) {
    throw new Error('Release phase heartbeat reporter requires a path and exact target/warmup entries.');
  }
  const resolvedPath = path.resolve(targetPath);
  const timingsByScope = {
    warmup: emptyReleaseGeneratorPhaseTimings(),
    target: emptyReleaseGeneratorPhaseTimings(),
  };
  const generatorMetricsByScope = {
    warmup: captureReleaseGeneratorMetrics(null),
    target: captureReleaseGeneratorMetrics(null),
  };
  const observedAttemptMetricsByScope = {
    warmup: captureReleaseGeneratorMetrics(null),
    target: captureReleaseGeneratorMetrics(null),
  };
  let sequence = 0;
  let targetStarted = false;
  let active = null;
  let lastEvent = null;
  let failureSnapshot = null;

  const scopeName = () => (targetStarted ? 'target' : 'warmup');
  const timingSnapshot = (scope = scopeName(), { includeActive = false } = {}) => {
    const snapshot = {
      ...timingsByScope[scope],
      ...generatorMetricsByScope[scope],
    };
    if (includeActive && active?.scope === scope) {
      const field = RELEASE_GENERATOR_PHASE_TIMING_FIELDS[active.phase];
      snapshot[field] += Math.max(0, monotonicNow() - active.startedMonotonicMs);
    }
    snapshot.totalMs = releaseGeneratorPhaseTimingTotal(snapshot);
    return snapshot;
  };
  const appendEvent = ({ phase, status, phaseStartedEpochMs, phaseElapsedMs }) => {
    const emittedAtEpochMs = Math.max(Number(epochNow()), Number(phaseStartedEpochMs));
    const event = {
      schema: RELEASE_PHASE_HEARTBEAT_SCHEMA,
      sequence,
      phase,
      status,
      phaseStartedEpochMs,
      emittedAtEpochMs,
      phaseElapsedMs,
      targetStarted,
      targetOrdinal: targetEntry.ordinal,
      targetSeed: targetEntry.seed,
      warmupOrdinal: warmupEntry.ordinal,
      warmupSeed: warmupEntry.seed,
      phaseTimings: timingSnapshot(),
    };
    sequence += 1;
    writeFileSync(resolvedPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
    lastEvent = event;
    return event;
  };
  const completeActivePhase = () => {
    if (!active) return null;
    const finished = active;
    const elapsedMs = Math.max(0, monotonicNow() - finished.startedMonotonicMs);
    const field = RELEASE_GENERATOR_PHASE_TIMING_FIELDS[finished.phase];
    timingsByScope[finished.scope][field] += elapsedMs;
    timingsByScope[finished.scope].totalMs = releaseGeneratorPhaseTimingTotal(
      timingsByScope[finished.scope],
    );
    active = null;
    return appendEvent({
      phase: finished.phase,
      status: 'completed',
      phaseStartedEpochMs: finished.startedEpochMs,
      phaseElapsedMs: elapsedMs,
    });
  };
  const startPhase = (phase) => {
    if (!RELEASE_GENERATOR_PHASES.includes(phase)) {
      throw new Error(`Unknown release generator phase ${phase}.`);
    }
    completeActivePhase();
    const startedEpochMs = Number(epochNow());
    active = {
      phase,
      scope: scopeName(),
      startedEpochMs,
      startedMonotonicMs: monotonicNow(),
    };
    return appendEvent({
      phase,
      status: 'started',
      phaseStartedEpochMs: startedEpochMs,
      phaseElapsedMs: 0,
    });
  };
  const completePhase = (phase = active?.phase) => {
    if (!active || phase !== active.phase) return null;
    return completeActivePhase();
  };
  const snapshot = ({ preferFailure = false } = {}) => {
    if (preferFailure && failureSnapshot) return { ...failureSnapshot };
    if (!lastEvent) return null;
    const observedAtEpochMs = Math.max(Number(epochNow()), lastEvent.emittedAtEpochMs);
    return {
      ...lastEvent,
      observedAtEpochMs,
      phaseElapsedMs: lastEvent.status === 'started'
        ? Math.max(lastEvent.phaseElapsedMs, observedAtEpochMs - lastEvent.phaseStartedEpochMs)
        : lastEvent.phaseElapsedMs,
      phaseTimings: timingSnapshot(scopeName(), { includeActive: true }),
    };
  };

  return Object.freeze({
    startPhase,
    completePhase,
    beginTarget() {
      completeActivePhase();
      targetStarted = true;
    },
    observeGeneratorPhase(event) {
      if (!event || !RELEASE_GENERATOR_PHASES.includes(event.phase)) return;
      const scope = scopeName();
      if (event.status === 'started') {
        if (event.phase === 'planning') {
          observedAttemptMetricsByScope[scope] = captureReleaseGeneratorMetrics(null);
        }
        startPhase(event.phase);
      }
      if (event.status === 'completed') {
        const completion = completePhase(event.phase);
        const observedElapsedMs = finiteNonnegativeNumber(event.elapsedMs)
          ? event.elapsedMs
          : completion?.phaseElapsedMs;
        if (completion
          && event.phase === 'planning'
          && finiteNonnegativeNumber(observedElapsedMs)) {
          observedAttemptMetricsByScope[scope].planningTimeMs = observedElapsedMs;
        }
        if (completion
          && event.phase === 'three-js-assembly'
          && finiteNonnegativeNumber(observedElapsedMs)) {
          observedAttemptMetricsByScope[scope].assemblyTimeMs = observedElapsedMs;
        }
      }
    },
    captureGeneratorMetrics(augmentationMetrics) {
      generatorMetricsByScope[scopeName()] = captureReleaseGeneratorMetrics(
        augmentationMetrics,
      );
      return { ...generatorMetricsByScope[scopeName()] };
    },
    captureDungeonGeneratorMetrics(dungeon) {
      const scope = scopeName();
      generatorMetricsByScope[scope] = captureReleaseDungeonGeneratorMetrics(dungeon, {
        observedAttemptMetrics: observedAttemptMetricsByScope[scope],
      });
      return { ...generatorMetricsByScope[scope] };
    },
    captureFailure() {
      failureSnapshot = snapshot();
      return failureSnapshot;
    },
    snapshot,
    timings({
      scope = scopeName(),
      planningTimeMs = generatorMetricsByScope[scope].planningTimeMs,
      assemblyTimeMs = generatorMetricsByScope[scope].assemblyTimeMs,
    } = {}) {
      const result = {
        ...timingSnapshot(scope, { includeActive: true }),
        planningTimeMs,
        assemblyTimeMs,
      };
      return validateReleaseGeneratorPhaseTimings(result, {
        requireGeneratorMetrics: planningTimeMs != null || assemblyTimeMs != null,
      });
    },
  });
}

export function createReleaseWorkerFailureDiagnostics({
  errorName = 'VerifierProcessFailure',
  message = 'Release seed worker failed.',
  entry,
  timedOut = false,
  timeoutMs = RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed,
  workerEvidenceHash = null,
  workerFailure = null,
  lastPhaseEvidence = null,
} = {}) {
  const phaseEvidence = workerFailure?.failurePhaseEvidence
    ?? lastPhaseEvidence
    ?? workerFailure?.lastPhaseEvidence
    ?? null;
  const phaseScope = phaseEvidence
    ? (phaseEvidence.targetStarted ? 'target' : 'warmup')
    : null;
  return {
    errorName,
    message,
    currentOrdinal: entry?.ordinal ?? null,
    currentSeed: entry?.seed ?? null,
    timedOut: timedOut === true,
    timeoutMs,
    timeoutPhase: timedOut && phaseEvidence ? `${phaseScope}:${phaseEvidence.phase}` : null,
    timeoutPhaseElapsedMs: timedOut && phaseEvidence
      ? phaseEvidence.phaseElapsedMs
      : null,
    lastPhaseEvidence: phaseEvidence,
    generatorPhaseTimings: workerFailure?.generatorPhaseTimings
      ?? phaseEvidence?.phaseTimings
      ?? null,
    workerEvidenceHash,
  };
}

function validateReleasePhaseHeartbeatEvent(event, {
  manifest = null,
  selection = null,
  label = 'release phase heartbeat',
} = {}) {
  if (!event
    || typeof event !== 'object'
    || Array.isArray(event)
    || event.schema !== RELEASE_PHASE_HEARTBEAT_SCHEMA
    || !Number.isSafeInteger(event.sequence)
    || event.sequence < 0
    || typeof event.phase !== 'string'
    || !RELEASE_GENERATOR_PHASES.includes(event.phase)
    || !['started', 'completed'].includes(event.status)
    || !finiteNonnegativeNumber(event.phaseStartedEpochMs)
    || !finiteNonnegativeNumber(event.emittedAtEpochMs)
    || !finiteNonnegativeNumber(event.phaseElapsedMs)
    || typeof event.targetStarted !== 'boolean'
    || !Number.isSafeInteger(event.targetOrdinal)
    || typeof event.targetSeed !== 'string'
    || !event.targetSeed
    || !Number.isSafeInteger(event.warmupOrdinal)
    || typeof event.warmupSeed !== 'string'
    || !event.warmupSeed) {
    throw new Error(`${label} is malformed.`);
  }
  validateReleaseGeneratorPhaseTimings(event.phaseTimings, {
    label: `${label} phase timings`,
  });
  if (event.emittedAtEpochMs < event.phaseStartedEpochMs) {
    throw new Error(`${label} precedes its active phase.`);
  }
  if (selection) {
    const target = selection.entries?.[0];
    const warmup = manifest?.entries?.[(Number(target?.ordinal) + 1) % manifest.entries.length];
    if (selection.entries?.length !== 1
      || event.targetOrdinal !== target?.ordinal
      || event.targetSeed !== target?.seed
      || event.warmupOrdinal !== warmup?.ordinal
      || event.warmupSeed !== warmup?.seed) {
      throw new Error(`${label} does not match its target and warmup manifest entries.`);
    }
  }
  return event;
}

export function validateReleasePhaseHeartbeatSnapshot(snapshot, options = {}) {
  validateReleasePhaseHeartbeatEvent(snapshot, options);
  if (!finiteNonnegativeNumber(snapshot.observedAtEpochMs)
    || snapshot.observedAtEpochMs < snapshot.emittedAtEpochMs) {
    throw new Error(`${options.label ?? 'release phase heartbeat'} has an invalid observation time.`);
  }
  return snapshot;
}

export function validateCompletedReleaseWorkerPhaseEvidence(
  snapshot,
  generatorPhaseTimings,
  options = {},
) {
  const label = options.label ?? 'completed release seed worker phase evidence';
  validateReleasePhaseHeartbeatSnapshot(snapshot, { ...options, label });
  validateReleaseGeneratorPhaseTimings(generatorPhaseTimings, {
    label: `${label} generator phase timings`,
    requireGeneratorMetrics: true,
  });
  if (snapshot.targetStarted !== true
    || snapshot.phase !== 'disposal'
    || snapshot.status !== 'completed') {
    throw new Error(`${label} does not prove completed target disposal.`);
  }
  if (canonicalStringify(snapshot.phaseTimings)
    !== canonicalStringify(generatorPhaseTimings)) {
    throw new Error(`${label} does not match the published generator phase timings.`);
  }
  return snapshot;
}

export async function readReleasePhaseHeartbeat(targetPath, {
  manifest = null,
  selection = null,
  observedAtEpochMs = Date.now(),
} = {}) {
  let contents;
  try {
    contents = await readFile(path.resolve(targetPath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const lines = contents.split(/\r?\n/u).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let event;
    try {
      event = JSON.parse(lines[index]);
      validateReleasePhaseHeartbeatEvent(event, {
        manifest,
        selection,
        label: `release phase heartbeat line ${index + 1}`,
      });
    } catch {
      // A watchdog can interrupt the final append. The last complete valid
      // line remains authoritative diagnostic evidence.
      continue;
    }
    const observed = Math.max(Number(observedAtEpochMs), event.emittedAtEpochMs);
    const phaseElapsedMs = event.status === 'started'
      ? Math.max(event.phaseElapsedMs, observed - event.phaseStartedEpochMs)
      : event.phaseElapsedMs;
    const phaseTimings = { ...event.phaseTimings };
    if (event.status === 'started') {
      const activeTimingField = RELEASE_GENERATOR_PHASE_TIMING_FIELDS[event.phase];
      phaseTimings[activeTimingField] += phaseElapsedMs;
      phaseTimings.totalMs = releaseGeneratorPhaseTimingTotal(phaseTimings);
    }
    const snapshot = {
      ...event,
      observedAtEpochMs: observed,
      phaseElapsedMs,
      phaseTimings,
    };
    return validateReleasePhaseHeartbeatSnapshot(snapshot, {
      manifest,
      selection,
    });
  }
  return null;
}

async function collectFiles(rootPath) {
  const results = [];
  const visit = async (candidatePath) => {
    const candidateStat = await stat(candidatePath);
    if (candidateStat.isDirectory()) {
      const names = await readdir(candidatePath);
      for (const name of names.sort()) await visit(path.join(candidatePath, name));
      return;
    }
    results.push(candidatePath);
  };
  await visit(rootPath);
  return results;
}

function isReleaseSourceFile(projectRoot, filePath) {
  const relativePath = path.relative(projectRoot, filePath).replaceAll('\\', '/');
  if (RELEASE_SOURCE_FILE_NAMES.has(relativePath)) return true;
  if (relativePath.startsWith('src/')) return /\.(?:js|mjs|json)$/u.test(relativePath);
  if (relativePath.startsWith('scripts/')) return RELEASE_SCRIPT_PATTERN.test(relativePath);
  if (relativePath.startsWith('tests/')) return RELEASE_TEST_PATTERN.test(relativePath);
  return false;
}

export async function createReleaseSourceHash(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);
  const candidates = [];
  for (const rootName of RELEASE_SOURCE_ROOTS) {
    const rootPath = path.join(resolvedRoot, rootName);
    if (await pathExists(rootPath)) candidates.push(...await collectFiles(rootPath));
  }
  for (const fileName of RELEASE_SOURCE_FILE_NAMES) {
    const filePath = path.join(resolvedRoot, fileName);
    if (await pathExists(filePath)) candidates.push(filePath);
  }
  const files = [...new Set(candidates)]
    .filter((filePath) => isReleaseSourceFile(resolvedRoot, filePath))
    .sort((left, right) => left.localeCompare(right));
  const records = [];
  for (const filePath of files) {
    const contents = await readFile(filePath);
    records.push({
      path: path.relative(resolvedRoot, filePath).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  }
  return {
    fileCount: records.length,
    hash: hashCanonicalValue(records, `${EVIDENCE_HASH_NAMESPACE}:release-sources`),
  };
}

function readGitValue(projectRoot, args) {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export function releaseSourceDirtyFromGitStatusResult(result) {
  if (!result
    || result.error
    || result.status !== 0
    || typeof result.stdout !== 'string') {
    const detail = result?.error?.message
      || String(result?.stderr ?? '').trim()
      || `status ${result?.status ?? 'unknown'}`;
    throw new Error(
      `Release evidence could not determine git source cleanliness${detail ? `: ${detail}` : ''}.`,
    );
  }
  return result.stdout.trim().length > 0;
}

function readReleaseSourceDirty(projectRoot) {
  return releaseSourceDirtyFromGitStatusResult(spawnSync('git', [
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    'src',
    'scripts',
    'tests',
    'package.json',
    'package-lock.json',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  }));
}

export function createReleaseProfileDescriptor(profile) {
  if (profile?.id !== RELEASE_PROFILE_ID || profile?.revision !== RELEASE_PROFILE_REVISION) {
    throw new Error(
      `Expected ${RELEASE_PROFILE_ID} revision ${RELEASE_PROFILE_REVISION}; received ${profile?.id ?? 'missing'} revision ${profile?.revision ?? 'missing'}.`,
    );
  }
  return {
    id: profile.id,
    revision: profile.revision,
    hash: hashCanonicalValue(profile, `${EVIDENCE_HASH_NAMESPACE}:profile`),
  };
}

export async function createReleaseProvenance({ projectRoot, profile }) {
  const gitCommit = readGitValue(projectRoot, ['rev-parse', 'HEAD']);
  if (!gitCommit) throw new Error('Release evidence requires a git worktree with a resolvable HEAD.');
  const sourceDirty = readReleaseSourceDirty(projectRoot);
  const source = await createReleaseSourceHash(projectRoot);
  const logicalCpus = os.cpus();
  const machine = {
    cpuModel: String(logicalCpus[0]?.model ?? '').trim(),
    logicalCpuCount: logicalCpus.length,
    totalMemoryBytes: os.totalmem(),
  };
  validateReleaseMachineProvenance(machine, 'current release machine');
  return {
    gitCommit,
    gitBranch: readGitValue(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    sourceDirty,
    sourceHash: source.hash,
    sourceFileCount: source.fileCount,
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    machine,
    profile: createReleaseProfileDescriptor(profile),
  };
}

export function assertCleanReleaseProvenance(
  provenance,
  label = 'release evidence source',
) {
  if (provenance?.sourceDirty !== false) {
    const state = provenance?.sourceDirty === true ? 'dirty' : 'indeterminate';
    throw new Error(`${label} is ${state}; release evidence requires a clean source worktree.`);
  }
  return provenance;
}

export function createReleaseArtifactIdentity(provenance) {
  if (typeof provenance?.sourceDirty !== 'boolean') {
    throw new Error('Release artifact identity requires determinate source cleanliness.');
  }
  validateReleaseMachineProvenance(provenance.machine, 'release artifact identity machine');
  return hashCanonicalValue({
    gitCommit: provenance.gitCommit,
    sourceDirty: provenance.sourceDirty,
    sourceHash: provenance.sourceHash,
    profileHash: provenance.profile?.hash,
    nodeVersion: provenance.nodeVersion,
    platform: provenance.platform,
    machine: provenance.machine,
  }, 'dungeon-augmentation-v4-release-artifact-root-v1')
    .replace(/[^a-z0-9-]/giu, '-');
}

export function validateReleaseMachineProvenance(machine, label = 'release evidence machine') {
  if (!machine
    || typeof machine !== 'object'
    || Array.isArray(machine)
    || typeof machine.cpuModel !== 'string'
    || !machine.cpuModel.trim()
    || !Number.isSafeInteger(machine.logicalCpuCount)
    || machine.logicalCpuCount <= 0
    || !Number.isSafeInteger(machine.totalMemoryBytes)
    || machine.totalMemoryBytes <= 0) {
    throw new Error(`${label} lacks exact CPU, logical-CPU, or total-memory provenance.`);
  }
  return machine;
}

export function isReleaseReferenceMachine(provenance) {
  return provenance?.nodeVersion === RELEASE_REFERENCE_MACHINE.nodeVersion
    && provenance?.platform === RELEASE_REFERENCE_MACHINE.platform
    && provenance?.machine?.cpuModel === RELEASE_REFERENCE_MACHINE.cpuModel
    && provenance?.machine?.logicalCpuCount === RELEASE_REFERENCE_MACHINE.logicalCpuCount
    && provenance?.machine?.totalMemoryBytes === RELEASE_REFERENCE_MACHINE.totalMemoryBytes;
}

export function assertMatchingReleaseProvenance(actual, expected, label = 'release evidence') {
  validateReleaseMachineProvenance(actual?.machine, `${label} actual machine`);
  validateReleaseMachineProvenance(expected?.machine, `${label} expected machine`);
  for (const field of ['gitCommit', 'sourceHash', 'nodeVersion', 'platform']) {
    if (actual?.[field] !== expected?.[field]) {
      throw new Error(`${label} ${field} does not match the corpus manifest.`);
    }
  }
  if (typeof actual?.sourceDirty !== 'boolean'
    || typeof expected?.sourceDirty !== 'boolean'
    || actual.sourceDirty !== expected.sourceDirty) {
    throw new Error(`${label} sourceDirty does not match the corpus manifest.`);
  }
  for (const field of ['id', 'revision', 'hash']) {
    if (actual?.profile?.[field] !== expected?.profile?.[field]) {
      throw new Error(`${label} profile.${field} does not match the corpus manifest.`);
    }
  }
  for (const field of ['cpuModel', 'logicalCpuCount', 'totalMemoryBytes']) {
    if (actual.machine[field] !== expected.machine[field]) {
      throw new Error(`${label} machine.${field} does not match the corpus manifest.`);
    }
  }
  return true;
}

function stableRoomRecord(room) {
  return {
    id: room.id ?? null,
    archetypeId: room.archetypeId ?? room.type ?? null,
    x: Number(room.x ?? 0),
    z: Number(room.z ?? 0),
    width: Number(room.width ?? 0),
    depth: Number(room.depth ?? 0),
    elevation: Number(room.elevation ?? room.floorElevation ?? 0),
    accessBand: Number(room.accessBand ?? room.progressionBand ?? 0),
    isBossRoom: room.isBossRoom === true,
    isShrineRoom: room.isShrineRoom === true,
  };
}

function stableConnectionRecord(connection) {
  return {
    id: connection.id ?? null,
    fromRoomId: connection.fromRoomId ?? null,
    toRoomId: connection.toRoomId ?? null,
    connectorFamily: connection.connectorFamily ?? connection.variantFamily ?? null,
    variantId: connection.connectorVariantId ?? connection.variantId ?? null,
    locked: connection.locked === true || connection.requiresCredential === true,
  };
}

export function createAcceptedParentWitness(dungeon, sourceRandomCalls) {
  const rooms = (dungeon?.rooms ?? [])
    .filter((room) => room?.isDungeonSupplement !== true)
    .map(stableRoomRecord)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const connectionPlans = (dungeon?.connectionPlans ?? [])
    .filter((connection) => (
      connection?.isDungeonSupplement !== true
      && connection?.isPaddedByDungeonSupplement !== true
      && connection?.isSupplementGraphConnection !== true
    ))
    .map(stableConnectionRecord)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const payload = {
    basePlanHash: dungeon?.basePlanHash ?? null,
    generationAttempts: dungeon?.generationAttempts ?? 0,
    sourceRandomCalls: sourceRandomCalls ?? 0,
    rooms,
    connectionPlans,
  };
  return validateAcceptedParentWitness({
    ...payload,
    hash: hashCanonicalValue(payload, `${EVIDENCE_HASH_NAMESPACE}:accepted-parent`),
  });
}

export function validateAcceptedParentWitness(witness, {
  expectedBasePlanHash = null,
  label = 'accepted-parent witness',
} = {}) {
  if (!witness || typeof witness !== 'object' || Array.isArray(witness)) {
    throw new Error(`${label} must be an object.`);
  }
  if (typeof witness.basePlanHash !== 'string'
    || !witness.basePlanHash
    || (expectedBasePlanHash != null && witness.basePlanHash !== expectedBasePlanHash)
    || !Number.isSafeInteger(witness.generationAttempts)
    || witness.generationAttempts <= 0
    || !Number.isSafeInteger(witness.sourceRandomCalls)
    || witness.sourceRandomCalls <= 0
    || !Array.isArray(witness.rooms)
    || witness.rooms.length === 0
    || !Array.isArray(witness.connectionPlans)
    || typeof witness.hash !== 'string'
    || !witness.hash) {
    throw new Error(`${label} lacks strict base, attempt, RNG, room, connection, or hash inputs.`);
  }
  const { hash: _hash, ...payload } = witness;
  const expectedHash = hashCanonicalValue(
    payload,
    `${EVIDENCE_HASH_NAMESPACE}:accepted-parent`,
  );
  if (witness.hash !== expectedHash) {
    throw new Error(`${label} hash does not match its strict parent payload.`);
  }
  return witness;
}

export function createCorpusManifest({
  tier = 'release',
  rawStartIndex,
  rawEndIndexExclusive,
  requestedAcceptedParentCount,
  entries,
  skippedParentSeeds,
  provenance,
  generatedAt = new Date().toISOString(),
}) {
  if (tier !== 'release') {
    throw new Error(
      'The immutable parent manifest is always the 1,000-entry release corpus; smoke and normal are ordinal views of it.',
    );
  }
  if (requestedAcceptedParentCount !== RELEASE_MASTER_CORPUS_COUNT) {
    throw new Error(
      `The master corpus requires exactly ${RELEASE_MASTER_CORPUS_COUNT} accepted parents; received ${requestedAcceptedParentCount}.`,
    );
  }
  if (entries.length !== requestedAcceptedParentCount) {
    throw new Error(`Corpus has ${entries.length} entries; expected ${requestedAcceptedParentCount}.`);
  }
  entries.forEach((entry, ordinal) => {
    if (entry.ordinal !== ordinal) throw new Error(`Corpus ordinal ${ordinal} is missing or out of order.`);
    if (!entry.seed || !entry.basePlanHash || !entry.parentWitness?.hash) {
      throw new Error(`Corpus ordinal ${ordinal} is missing its accepted-parent witness.`);
    }
  });
  return validateCorpusManifest(sealEvidence({
    schemaVersion: RELEASE_EVIDENCE_SCHEMA_VERSION,
    kind: 'dungeon-augmentation-release-corpus',
    generatedAt,
    tier,
    profile: provenance.profile,
    provenance,
    seedNamespace: 'layout:augmentation-realized-v4-',
    rawStartIndex,
    rawEndIndexExclusive,
    requestedAcceptedParentCount,
    entries,
    skippedParentSeeds,
  }));
}

export function validateCorpusManifest(manifest) {
  assertSealedEvidence(manifest, 'release corpus manifest');
  validateReleaseMachineProvenance(
    manifest?.provenance?.machine,
    'release corpus manifest machine',
  );
  if (manifest.schemaVersion !== RELEASE_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`Unsupported release corpus schema ${manifest.schemaVersion}.`);
  }
  if (manifest.kind !== 'dungeon-augmentation-release-corpus') {
    throw new Error(`Expected a release corpus manifest; received ${manifest.kind ?? 'unknown'}.`);
  }
  if (manifest.profile?.id !== RELEASE_PROFILE_ID || manifest.profile?.revision !== RELEASE_PROFILE_REVISION) {
    throw new Error('Release corpus profile identity or revision is not authoritative V4 revision 5.');
  }
  if (manifest.tier !== 'release'
    || manifest.requestedAcceptedParentCount !== RELEASE_MASTER_CORPUS_COUNT) {
    throw new Error('Release corpus must be the fixed 1,000-parent master manifest.');
  }
  if (manifest.entries?.length !== manifest.requestedAcceptedParentCount) {
    throw new Error('Release corpus entry count does not match its declared count.');
  }
  if (!Number.isInteger(manifest.rawStartIndex)
    || !Number.isInteger(manifest.rawEndIndexExclusive)
    || manifest.rawStartIndex < 0
    || manifest.rawEndIndexExclusive <= manifest.rawStartIndex) {
    throw new Error('Release corpus raw seed range is invalid.');
  }
  const rawIndexOwners = new Map();
  manifest.entries.forEach((entry, ordinal) => {
    if (entry.ordinal !== ordinal) throw new Error(`Release corpus ordinal ${ordinal} is invalid.`);
    const expectedSeed = `layout:augmentation-realized-v4-${String(entry.rawIndex).padStart(3, '0')}`;
    const expectedBasePlanHash = `v1:${expectedSeed}:depth:1:revolvingFusillade`;
    if (!Number.isInteger(entry.rawIndex)
      || entry.rawIndex < manifest.rawStartIndex
      || entry.rawIndex >= manifest.rawEndIndexExclusive
      || entry.seed !== expectedSeed
      || entry.basePlanHash !== expectedBasePlanHash
      || entry.parentWitness?.basePlanHash !== expectedBasePlanHash) {
      throw new Error(`Release corpus ordinal ${ordinal} has an invalid raw-seed identity.`);
    }
    if (rawIndexOwners.has(entry.rawIndex)) {
      throw new Error(`Release corpus raw seed ${entry.rawIndex} appears more than once.`);
    }
    rawIndexOwners.set(entry.rawIndex, `ordinal ${ordinal}`);
    validateAcceptedParentWitness(entry.parentWitness, {
      expectedBasePlanHash,
      label: `Release corpus ordinal ${ordinal} parent witness`,
    });
  });
  for (const skipped of manifest.skippedParentSeeds ?? []) {
    if (!Number.isInteger(skipped.rawIndex)
      || skipped.rawIndex < manifest.rawStartIndex
      || skipped.rawIndex >= manifest.rawEndIndexExclusive
      || !skipped.reason) {
      throw new Error('Release corpus contains an invalid skipped-parent record.');
    }
    if (rawIndexOwners.has(skipped.rawIndex)) {
      throw new Error(`Release corpus raw seed ${skipped.rawIndex} appears more than once.`);
    }
    rawIndexOwners.set(skipped.rawIndex, 'skipped parent');
  }
  if (rawIndexOwners.size !== manifest.rawEndIndexExclusive - manifest.rawStartIndex) {
    throw new Error('Release corpus does not account for every raw seed in its scanned range.');
  }
  return manifest;
}

export function selectCorpusEntries(manifest, {
  tier = 'release',
  ordinalStart = null,
  ordinalCount = null,
  shardIndex = null,
  shardCount = null,
} = {}) {
  validateCorpusManifest(manifest);
  if (!Object.hasOwn(RELEASE_CORPUS_COUNTS, tier)) {
    throw new Error(`Unknown release corpus view ${tier}.`);
  }
  const viewCount = RELEASE_CORPUS_COUNTS[tier];
  const hasOrdinalSelection = ordinalStart != null || ordinalCount != null;
  const hasShardSelection = shardIndex != null || shardCount != null;
  if (hasOrdinalSelection && hasShardSelection) {
    throw new Error('Ordinal ranges and shard indexes are mutually exclusive.');
  }
  let start = 0;
  let end = viewCount;
  if (hasShardSelection) {
    if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount)
      || shardCount <= 0 || shardIndex < 0 || shardIndex >= shardCount) {
      throw new Error('Shard selection requires 0 <= shardIndex < shardCount.');
    }
    const topology = RELEASE_SHARD_TOPOLOGY[tier];
    if (shardCount !== topology.shardCount) {
      throw new Error(
        `${tier} release evidence requires exactly ${topology.shardCount} shard(s) of ${topology.shardSize} seed(s).`,
      );
    }
    start = topology.shardSize * shardIndex;
    end = start + topology.shardSize;
  } else if (hasOrdinalSelection) {
    start = Number(ordinalStart ?? 0);
    const count = Number(ordinalCount ?? viewCount - start);
    if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count <= 0) {
      throw new Error('Ordinal selection requires a non-negative start and positive count.');
    }
    end = start + count;
  }
  if (start >= viewCount || end > viewCount || start >= end) {
    throw new Error(`Corpus selection [${start}, ${end}) is outside the ${tier} ordinal view.`);
  }
  return {
    tier,
    viewCount,
    ordinalStart: start,
    ordinalEndExclusive: end,
    shardIndex: hasShardSelection ? shardIndex : null,
    shardCount: hasShardSelection ? shardCount : null,
    entries: manifest.entries.slice(start, end),
  };
}

export function assertCanonicalShardSelection(selection, label = 'release shard') {
  const topology = RELEASE_SHARD_TOPOLOGY[selection?.tier];
  if (!topology || selection?.viewCount !== RELEASE_CORPUS_COUNTS[selection?.tier]) {
    throw new Error(`${label} references an unknown corpus view.`);
  }
  const ordinalStart = Number(selection.ordinalStart);
  const ordinalEndExclusive = Number(selection.ordinalEndExclusive);
  const shardIndex = ordinalStart / topology.shardSize;
  if (!Number.isInteger(ordinalStart)
    || !Number.isInteger(ordinalEndExclusive)
    || !Number.isInteger(shardIndex)
    || shardIndex < 0
    || shardIndex >= topology.shardCount
    || ordinalEndExclusive !== ordinalStart + topology.shardSize) {
    throw new Error(
      `${label} must use the canonical ${selection.tier} topology: ${topology.shardCount} shard(s) of ${topology.shardSize} seed(s).`,
    );
  }
  return {
    shardIndex,
    shardCount: topology.shardCount,
    shardSize: topology.shardSize,
  };
}

export function createShardEvidence({
  manifest,
  selection,
  provenance,
  records,
  skippedParentSeeds = [],
  result,
  failure = null,
  generatedAt = new Date().toISOString(),
}) {
  validateCorpusManifest(manifest);
  assertMatchingReleaseProvenance(provenance, manifest.provenance, 'release shard');
  const canonicalShard = assertCanonicalShardSelection(selection);
  if (selection.entries?.length !== canonicalShard.shardSize
    || selection.entries.some((entry, index) => (
      entry.ordinal !== selection.ordinalStart + index
    ))) {
    throw new Error('Release shard selection entries do not match its canonical ordinal range.');
  }
  return sealEvidence({
    schemaVersion: RELEASE_EVIDENCE_SCHEMA_VERSION,
    kind: 'dungeon-augmentation-release-shard',
    generatedAt,
    result,
    profile: manifest.profile,
    provenance,
    manifestHash: manifest.evidenceHash,
    corpusTier: selection.tier,
    corpusViewCount: selection.viewCount,
    shardIndex: canonicalShard.shardIndex,
    shardCount: canonicalShard.shardCount,
    shardSize: canonicalShard.shardSize,
    ordinalStart: selection.ordinalStart,
    ordinalEndExclusive: selection.ordinalEndExclusive,
    expectedEntries: selection.entries.map(({ ordinal, rawIndex, seed, basePlanHash, parentWitness }) => ({
      ordinal,
      rawIndex,
      seed,
      basePlanHash,
      parentWitnessHash: parentWitness.hash,
    })),
    records,
    skippedParentSeeds,
    failure,
  });
}

export function createSeedWorkerEvidence({
  manifest,
  selection,
  provenance,
  records,
  result,
  failure = null,
  generatedAt = new Date().toISOString(),
}) {
  validateCorpusManifest(manifest);
  assertMatchingReleaseProvenance(provenance, manifest.provenance, 'release seed worker');
  if (!Object.hasOwn(RELEASE_CORPUS_COUNTS, selection?.tier)
    || selection.viewCount !== RELEASE_CORPUS_COUNTS[selection.tier]
    || selection?.entries?.length !== 1
    || selection.ordinalEndExclusive !== selection.ordinalStart + 1
    || selection.entries[0]?.ordinal !== selection.ordinalStart) {
    throw new Error('Release seed worker evidence must contain exactly one manifest ordinal.');
  }
  const [entry] = selection.entries;
  return sealEvidence({
    schemaVersion: RELEASE_EVIDENCE_SCHEMA_VERSION,
    kind: 'dungeon-augmentation-release-seed-worker',
    generatedAt,
    result,
    profile: manifest.profile,
    provenance,
    manifestHash: manifest.evidenceHash,
    corpusTier: selection.tier,
    corpusViewCount: selection.viewCount,
    ordinal: entry.ordinal,
    expectedEntry: {
      ordinal: entry.ordinal,
      rawIndex: entry.rawIndex,
      seed: entry.seed,
      basePlanHash: entry.basePlanHash,
      parentWitnessHash: entry.parentWitness.hash,
    },
    records,
    failure,
  });
}

/**
 * Decide whether a completed target record may be published by a manifest
 * seed worker. This is intentionally pure: callers finish disposal/timing
 * first, then atomically receive either the original applied record or a
 * diagnostic failure with no publishable record.
 */
export function inspectReleaseSeedWorkerRecordPublication(record) {
  const augmentationStatus = typeof record?.status === 'string'
    ? record.status
    : null;
  if (augmentationStatus === 'applied') {
    return {
      accepted: true,
      record,
      failure: null,
    };
  }
  const rejectionAttempts = (Array.isArray(record?.rejectionAttempts)
    ? record.rejectionAttempts
    : []).map((attempt) => ({
    ...attempt,
    failureCodes: [...new Set((Array.isArray(attempt?.failureCodes)
      ? attempt.failureCodes
      : [])
      .map(String)
      .filter(Boolean))],
    errorMessages: [...new Set((Array.isArray(attempt?.errorMessages)
      ? attempt.errorMessages
      : [])
      .map(String)
      .filter(Boolean))],
  }));
  const failureCodes = [...new Set(rejectionAttempts
    .flatMap(({ failureCodes: codes }) => codes))];
  const rejectionMessages = [...new Set(rejectionAttempts
    .flatMap(({ errorMessages }) => errorMessages))];
  const rejectionMessage = rejectionMessages.at(-1)
    ?? rejectionAttempts.map(({ reason }) => reason).filter(Boolean).at(-1)
    ?? `Augmentation completed with status ${augmentationStatus ?? 'missing'}.`;
  const message = 'Release seed worker requires augmentationStatus "applied"; '
    + `received ${JSON.stringify(augmentationStatus)}: ${rejectionMessage}`;
  return {
    accepted: false,
    record: null,
    failure: {
      errorName: 'ReleaseSeedWorkerAugmentationRejected',
      errorCode: 'RELEASE_SEED_WORKER_AUGMENTATION_NOT_APPLIED',
      message,
      augmentationStatus,
      failureCodes,
      rejectionMessage,
      rejectionMessages,
      rejectionAttempts,
      elapsedPhases: record?.elapsedPhases && typeof record.elapsedPhases === 'object'
        ? { ...record.elapsedPhases }
        : null,
      generatorPhaseTimings:
        record?.generatorPhaseTimings && typeof record.generatorPhaseTimings === 'object'
          ? { ...record.generatorPhaseTimings }
          : null,
    },
  };
}

function finiteNonnegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function validateReleaseWarmProcessEvidence(evidence, {
  entry,
  manifest,
  label = 'release seed record',
} = {}) {
  const warmupEntry = manifest?.entries?.[(Number(entry?.ordinal) + 1) % manifest.entries.length];
  if (!evidence
    || typeof evidence !== 'object'
    || Array.isArray(evidence)
    || evidence.schema !== RELEASE_WARM_PROCESS_EVIDENCE_SCHEMA
    || evidence.mode !== RELEASE_WARM_PROCESS_MODE
    || evidence.completed !== true
    || evidence.includedInTargetTiming !== false
    || evidence.targetTimingStartedAfterWarmup !== true
    || evidence.workerIsolation !== 'one-timed-target-per-process'
    || evidence.watchdogScope !== 'warmup-and-target-process'
    || evidence.watchdogTimeoutMs !== RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed
    || evidence.targetOrdinal !== entry?.ordinal
    || evidence.warmupOrdinal !== warmupEntry?.ordinal
    || evidence.warmupRawIndex !== warmupEntry?.rawIndex
    || evidence.warmupSeed !== warmupEntry?.seed
    || evidence.warmupBasePlanHash !== warmupEntry?.basePlanHash
    || evidence.warmupParentWitnessHash !== warmupEntry?.parentWitness?.hash
    || evidence.warmupSourceRandomCalls !== warmupEntry?.parentWitness?.sourceRandomCalls
    || evidence.warmupAugmentationStatus !== 'applied'
    || evidence.warmupRealizationAttempts !== 1
    || !finiteNonnegativeNumber(evidence.diagnosticElapsedMs)) {
    throw new Error(`${label} lacks authoritative worker-local warm-process evidence.`);
  }
  try {
    validateReleaseGeneratorPhaseTimings(evidence.generatorPhaseTimings, {
      label: `${label} warm-process generator phase timings`,
      requireGeneratorMetrics: true,
    });
  } catch (error) {
    throw new Error(`${label} lacks authoritative worker-local warm-process evidence.`, {
      cause: error,
    });
  }
  return evidence;
}

export function validateReleaseSeedRecord(record, entry, manifest, {
  label = 'release seed record',
} = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`${label} must be an object.`);
  }
  if (record.ordinal !== entry?.ordinal
    || record.rawIndex !== entry?.rawIndex
    || record.seed !== entry?.seed
    || record.basePlanHash !== entry?.basePlanHash
    || record.parentWitnessHash !== entry?.parentWitness?.hash
    || record.sourceRandomCalls !== entry?.parentWitness?.sourceRandomCalls) {
    throw new Error(`${label} does not match its exact manifest parent and RNG identity.`);
  }
  const phases = record.elapsedPhases;
  if (!phases
    || typeof phases !== 'object'
    || Array.isArray(phases)
    || !finiteNonnegativeNumber(phases.generationMs)
    || !finiteNonnegativeNumber(phases.strictValidationMs)
    || !finiteNonnegativeNumber(phases.disposalMs)
    || !finiteNonnegativeNumber(phases.totalMs)
    || !finiteNonnegativeNumber(record.elapsedMs)
    || Math.abs(
      phases.generationMs + phases.strictValidationMs + phases.disposalMs - phases.totalMs
    ) > 1e-6
    || phases.totalMs !== record.elapsedMs) {
    throw new Error(`${label} lacks finite nonnegative and internally consistent phase timing.`);
  }
  validateReleaseGeneratorPhaseTimings(record.generatorPhaseTimings, {
    label: `${label} generator phase timings`,
    requireGeneratorMetrics: true,
  });
  if (record.status === 'applied'
    && (!Array.isArray(record.completeLayoutSignatures)
      || record.completeLayoutSignatures.length === 0
      || record.completeLayoutSignatures.some((signature) => (
        typeof signature !== 'string' || !signature
      )))) {
    throw new Error(`${label} lacks nonempty complete-layout signatures.`);
  }
  validateReleaseWarmProcessEvidence(record.warmProcessEvidence, {
    entry,
    manifest,
    label,
  });
  validateReleaseSelectionBagWitnesses(record.selectionBagWitnesses);
  return record;
}

export function validateShardEvidence(shard, manifest) {
  assertSealedEvidence(shard, 'release shard');
  validateCorpusManifest(manifest);
  if (shard.kind !== 'dungeon-augmentation-release-shard') {
    throw new Error(`Expected release shard evidence; received ${shard.kind ?? 'unknown'}.`);
  }
  if (shard.manifestHash !== manifest.evidenceHash) {
    throw new Error('Release shard references a different corpus manifest.');
  }
  if (!['passed', 'failed'].includes(shard.result)
    || (shard.result === 'passed' && shard.failure != null)
    || (shard.result === 'failed' && (
      !shard.failure || typeof shard.failure !== 'object' || Array.isArray(shard.failure)
    ))) {
    throw new Error('Release shard result and failure diagnostics are inconsistent.');
  }
  if (!Object.hasOwn(RELEASE_CORPUS_COUNTS, shard.corpusTier)
    || shard.corpusViewCount !== RELEASE_CORPUS_COUNTS[shard.corpusTier]
    || shard.ordinalStart < 0
    || shard.ordinalEndExclusive > shard.corpusViewCount) {
    throw new Error('Release shard references an invalid master-manifest ordinal view.');
  }
  const canonicalShard = assertCanonicalShardSelection({
    tier: shard.corpusTier,
    viewCount: shard.corpusViewCount,
    ordinalStart: shard.ordinalStart,
    ordinalEndExclusive: shard.ordinalEndExclusive,
  });
  if (shard.shardIndex !== canonicalShard.shardIndex
    || shard.shardCount !== canonicalShard.shardCount
    || shard.shardSize !== canonicalShard.shardSize) {
    throw new Error('Release shard canonical topology metadata is invalid.');
  }
  assertMatchingReleaseProvenance(shard.provenance, manifest.provenance, 'release shard');
  const expectedEntries = manifest.entries.slice(shard.ordinalStart, shard.ordinalEndExclusive);
  if (expectedEntries.length !== shard.expectedEntries?.length) {
    throw new Error('Release shard expected-entry count is invalid.');
  }
  expectedEntries.forEach((entry, index) => {
    const expected = shard.expectedEntries[index];
    if (expected?.ordinal !== entry.ordinal
      || expected?.seed !== entry.seed
      || expected?.basePlanHash !== entry.basePlanHash
      || expected?.parentWitnessHash !== entry.parentWitness.hash) {
      throw new Error(`Release shard entry ${entry.ordinal} does not match the corpus manifest.`);
    }
  });
  if (shard.result === 'failed') {
    const failedEntry = manifest.entries[shard.failure.currentOrdinal];
    const phaseEvidence = shard.failure.lastPhaseEvidence ?? null;
    const phaseScope = phaseEvidence
      ? (phaseEvidence.targetStarted ? 'target' : 'warmup')
      : null;
    const expectedTimeoutPhase = shard.failure.timedOut && phaseEvidence
      ? `${phaseScope}:${phaseEvidence.phase}`
      : null;
    const expectedTimeoutPhaseElapsedMs = shard.failure.timedOut && phaseEvidence
      ? phaseEvidence.phaseElapsedMs
      : null;
    if (!failedEntry
      || shard.failure.currentSeed !== failedEntry.seed
      || typeof shard.failure.timedOut !== 'boolean'
      || shard.failure.timeoutMs !== RELEASE_PERFORMANCE_BUDGET_MS.ciTimeoutPerSeed
      || !phaseEvidence
      || shard.failure.timeoutPhase !== expectedTimeoutPhase
      || shard.failure.timeoutPhaseElapsedMs !== expectedTimeoutPhaseElapsedMs) {
      throw new Error('Failed release shard lacks authoritative worker phase diagnostics.');
    }
    validateReleasePhaseHeartbeatSnapshot(phaseEvidence, {
      manifest,
      selection: { entries: [failedEntry] },
      label: 'failed release shard phase evidence',
    });
    validateReleaseGeneratorPhaseTimings(shard.failure.generatorPhaseTimings, {
      label: 'failed release shard generator phase timings',
      requireGeneratorMetrics: releaseFailurePhaseRequiresGeneratorMetrics(phaseEvidence),
    });
    if (canonicalStringify(shard.failure.generatorPhaseTimings)
      !== canonicalStringify(phaseEvidence.phaseTimings)) {
      throw new Error('Failed release shard generator timings do not match its phase evidence.');
    }
  }
  const recordOrdinals = new Set();
  for (const record of shard.records ?? []) {
    if (!Number.isInteger(record.ordinal)
      || record.ordinal < shard.ordinalStart
      || record.ordinal >= shard.ordinalEndExclusive
      || recordOrdinals.has(record.ordinal)) {
      throw new Error(`Release shard contains an invalid or duplicate result ordinal ${record.ordinal}.`);
    }
    recordOrdinals.add(record.ordinal);
    try {
      validateReleaseSeedRecord(record, manifest.entries[record.ordinal], manifest, {
        label: `Release shard result for ordinal ${record.ordinal}`,
      });
    } catch (error) {
      throw new Error(
        `Release shard result for ordinal ${record.ordinal} is invalid: ${error.message}`,
        { cause: error },
      );
    }
  }
  if (shard.result === 'passed' && recordOrdinals.size !== expectedEntries.length) {
    throw new Error('Passed release shard does not contain exactly one result for every expected ordinal.');
  }
  return shard;
}

export function validateShardArtifactCollection(candidates, manifest) {
  return candidates.map(({ artifact, label = 'release shard artifact' }) => {
    try {
      return validateShardEvidence(artifact, manifest);
    } catch (error) {
      throw new Error(`Invalid or mixed ${label}: ${error.message}`, { cause: error });
    }
  });
}

export function validateSeedWorkerEvidence(worker, manifest, {
  tier = null,
  ordinal = null,
} = {}) {
  assertSealedEvidence(worker, 'release seed worker');
  validateCorpusManifest(manifest);
  if (worker.kind !== 'dungeon-augmentation-release-seed-worker') {
    throw new Error(`Expected release seed worker evidence; received ${worker.kind ?? 'unknown'}.`);
  }
  if (worker.manifestHash !== manifest.evidenceHash) {
    throw new Error('Release seed worker references a different corpus manifest.');
  }
  if (!['passed', 'failed'].includes(worker.result)
    || (worker.result === 'passed' && worker.failure != null)
    || (worker.result === 'failed' && (
      !worker.failure || typeof worker.failure !== 'object' || Array.isArray(worker.failure)
    ))) {
    throw new Error('Release seed worker result and failure diagnostics are inconsistent.');
  }
  if (!Object.hasOwn(RELEASE_CORPUS_COUNTS, worker.corpusTier)
    || worker.corpusViewCount !== RELEASE_CORPUS_COUNTS[worker.corpusTier]
    || !Number.isInteger(worker.ordinal)
    || worker.ordinal < 0
    || worker.ordinal >= worker.corpusViewCount) {
    throw new Error('Release seed worker references an invalid master-manifest ordinal.');
  }
  if (tier != null && worker.corpusTier !== tier) {
    throw new Error(`Release seed worker uses ${worker.corpusTier}; expected ${tier}.`);
  }
  if (ordinal != null && worker.ordinal !== ordinal) {
    throw new Error(`Release seed worker uses ordinal ${worker.ordinal}; expected ${ordinal}.`);
  }
  assertMatchingReleaseProvenance(worker.provenance, manifest.provenance, 'release seed worker');
  const entry = manifest.entries[worker.ordinal];
  const expected = worker.expectedEntry;
  if (!entry
    || expected?.ordinal !== entry.ordinal
    || expected?.rawIndex !== entry.rawIndex
    || expected?.seed !== entry.seed
    || expected?.basePlanHash !== entry.basePlanHash
    || expected?.parentWitnessHash !== entry.parentWitness.hash) {
    throw new Error(`Release seed worker entry ${worker.ordinal} does not match the corpus manifest.`);
  }
  if (worker.result === 'failed') {
    const phaseEvidence = worker.failure.failurePhaseEvidence
      ?? worker.failure.lastPhaseEvidence
      ?? null;
    if (!phaseEvidence
      || worker.failure.currentOrdinal !== entry.ordinal
      || worker.failure.currentSeed !== entry.seed) {
      throw new Error('Failed release seed worker lacks phase evidence.');
    }
    validateReleasePhaseHeartbeatSnapshot(phaseEvidence, {
      manifest,
      selection: { entries: [entry] },
      label: 'failed release seed worker phase evidence',
    });
    validateReleaseGeneratorPhaseTimings(worker.failure.generatorPhaseTimings, {
      label: 'failed release seed worker generator phase timings',
      requireGeneratorMetrics: releaseFailurePhaseRequiresGeneratorMetrics(phaseEvidence),
    });
    if (canonicalStringify(worker.failure.generatorPhaseTimings)
      !== canonicalStringify(phaseEvidence.phaseTimings)) {
      throw new Error(
        'Failed release seed worker generator timings do not match its phase evidence.',
      );
    }
  }
  const records = worker.records ?? [];
  if (records.length > 1
    || (worker.result === 'passed' && records.length !== 1)
    || (worker.result === 'failed' && records.length !== 0)) {
    throw new Error('Release seed worker must contain exactly one passing record or zero failed records.');
  }
  for (const record of records) {
    try {
      validateReleaseSeedRecord(record, entry, manifest, {
        label: `Release seed worker result for ordinal ${entry.ordinal}`,
      });
    } catch (error) {
      throw new Error(
        `Release seed worker result for ordinal ${entry.ordinal} is invalid: ${error.message}`,
        { cause: error },
      );
    }
  }
  return worker;
}

function nearestRank(values, proportion) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * proportion) - 1)];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function countSelections(records, key) {
  const selections = records.flatMap((record) => record[key] ?? []);
  const counts = {};
  for (const selection of selections) counts[selection] = (counts[selection] ?? 0) + 1;
  return {
    total: selections.length,
    counts: Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function maximumSelectionRatio(frequency) {
  if (!frequency.total) return null;
  return Math.max(...Object.values(frequency.counts).map((count) => count / frequency.total));
}

function exactKeys(frequency, expected) {
  return canonicalStringify(Object.keys(frequency.counts)) === canonicalStringify(expected);
}

export function aggregateShardEvidence({
  manifest,
  shards,
  generatedAt = new Date().toISOString(),
}) {
  // The release thresholds are an authoritative contract, not a caller
  // option. Keeping the budget out of the aggregate input prevents a direct
  // script/library caller from sealing evidence against relaxed thresholds.
  const performanceBudgetMs = RELEASE_PERFORMANCE_BUDGET_MS;
  validateCorpusManifest(manifest);
  shards.forEach((shard) => validateShardEvidence(shard, manifest));
  const corpusTiers = [...new Set(shards.map(({ corpusTier }) => corpusTier))];
  if (corpusTiers.length > 1) {
    throw new Error('Release aggregate cannot mix smoke, normal, and release ordinal views.');
  }
  const corpusTier = corpusTiers[0] ?? 'release';
  const expectedShardTopology = RELEASE_SHARD_TOPOLOGY[corpusTier];
  const expectedEntries = manifest.entries.slice(0, RELEASE_CORPUS_COUNTS[corpusTier]);
  const ordinalOwners = new Map();
  const records = [];
  for (const shard of shards) {
    for (let ordinal = shard.ordinalStart; ordinal < shard.ordinalEndExclusive; ordinal += 1) {
      if (ordinalOwners.has(ordinal)) {
        throw new Error(`Release corpus ordinal ${ordinal} appears in more than one shard.`);
      }
      ordinalOwners.set(ordinal, shard.evidenceHash);
    }
    records.push(...(shard.records ?? []));
  }
  records.sort((left, right) => left.ordinal - right.ordinal);
  const missingOrdinals = expectedEntries
    .map(({ ordinal }) => ordinal)
    .filter((ordinal) => !ordinalOwners.has(ordinal));
  const duplicateRecordOrdinals = records
    .map(({ ordinal }) => ordinal)
    .filter((ordinal, index, values) => values.indexOf(ordinal) !== index);
  const recordOrdinals = new Set(records.map(({ ordinal }) => ordinal));
  const missingRecordOrdinals = expectedEntries
    .map(({ ordinal }) => ordinal)
    .filter((ordinal) => !recordOrdinals.has(ordinal));
  const elapsedValues = records
    .map(({ elapsedMs }) => elapsedMs)
    .filter(finiteNonnegativeNumber);
  const performance = {
    budgetMs: performanceBudgetMs,
    sampleCount: elapsedValues.length,
    medianMs: median(elapsedValues),
    p95Ms: nearestRank(elapsedValues, 0.95),
    maximumMs: elapsedValues.length > 0 ? Math.max(...elapsedValues) : null,
  };
  const frequencies = {
    topologyTemplates: countSelections(records, 'topologyTemplateSelections'),
    junctionKinds: countSelections(records, 'junctionKindSelections'),
    elevationModes: countSelections(records, 'elevationModeSelections'),
    encounterProfiles: countSelections(records, 'encounterProfileSelections'),
    roomLayouts: countSelections(records, 'roomLayoutSelections'),
    completeLayoutSignatures: countSelections(records, 'completeLayoutSignatures'),
  };
  const requiresCorpusDiversity = expectedEntries.length >= RELEASE_CORPUS_COUNTS.normal;
  const diversityChecks = {
    required: requiresCorpusDiversity,
    exactTopologyFamilies: !requiresCorpusDiversity
      || exactKeys(frequencies.topologyTemplates, EXPECTED_TOPOLOGY_TEMPLATE_IDS),
    exactJunctionFamilies: !requiresCorpusDiversity
      || exactKeys(frequencies.junctionKinds, EXPECTED_JUNCTION_KINDS),
    exactElevationFamilies: !requiresCorpusDiversity
      || exactKeys(frequencies.elevationModes, EXPECTED_ELEVATION_MODES),
    exactEncounterFamilies: !requiresCorpusDiversity
      || exactKeys(frequencies.encounterProfiles, EXPECTED_ENCOUNTER_PROFILE_IDS),
    exactRoomLayoutFamilies: !requiresCorpusDiversity
      || exactKeys(frequencies.roomLayouts, EXPECTED_ROOM_LAYOUT_IDS),
    topologyMaximumRatio: maximumSelectionRatio(frequencies.topologyTemplates),
    junctionMaximumRatio: maximumSelectionRatio(frequencies.junctionKinds),
    elevationMaximumRatio: maximumSelectionRatio(frequencies.elevationModes),
    completeSignatureMaximumRatio: maximumSelectionRatio(frequencies.completeLayoutSignatures),
    completeSignatureEvidencePresent: records.length > 0
      && frequencies.completeLayoutSignatures.total > 0
      && records.every(({ status, completeLayoutSignatures }) => (
        status !== 'applied'
          || Array.isArray(completeLayoutSignatures) && completeLayoutSignatures.length > 0
      )),
  };
  const exactRecordCoverage = missingRecordOrdinals.length === 0
    && duplicateRecordOrdinals.length === 0
    && records.length === expectedEntries.length;
  const completeSeedEvidence = records.length > 0 && exactRecordCoverage;
  diversityChecks.accepted = completeSeedEvidence && (
    !requiresCorpusDiversity || Boolean(
      diversityChecks.exactTopologyFamilies
      && diversityChecks.exactJunctionFamilies
      && diversityChecks.exactElevationFamilies
      && diversityChecks.exactEncounterFamilies
      && diversityChecks.exactRoomLayoutFamilies
      && diversityChecks.completeSignatureEvidencePresent
      && diversityChecks.topologyMaximumRatio <= 0.35 + Number.EPSILON
      && diversityChecks.junctionMaximumRatio <= 0.50 + Number.EPSILON
      && diversityChecks.completeSignatureMaximumRatio <= 0.10 + Number.EPSILON
    )
  );
  const gates = {
    cleanSourceProvenance: manifest.provenance.sourceDirty === false,
    referenceMachine: isReleaseReferenceMachine(manifest.provenance),
    shardResultsPassed: shards.length > 0 && shards.every(({ result }) => result === 'passed'),
    exactShardTopology: shards.length === expectedShardTopology.shardCount
      && new Set(shards.map(({ shardIndex }) => shardIndex)).size === expectedShardTopology.shardCount
      && shards.every(({ shardIndex }) => (
        Number.isInteger(shardIndex)
        && shardIndex >= 0
        && shardIndex < expectedShardTopology.shardCount
      )),
    exactOrdinalCoverage: missingOrdinals.length === 0
      && ordinalOwners.size === expectedEntries.length,
    exactRecordCoverage,
    zeroFallback: completeSeedEvidence
      && records.every(({ status }) => status === 'applied'),
    firstRealization: completeSeedEvidence
      && records.every(({ realizationAttempts }) => realizationAttempts === 1),
    releaseValidation: completeSeedEvidence && records.every((record) => (
      record.releaseValidationAccepted === true
      && Number(record.releaseValidationErrorCount ?? 0) === 0
      && record.acceptedAsPlayableAlpha !== true
    )),
    strictRealizedValidation: completeSeedEvidence
      && records.every(({ strictRealizedAccepted }) => strictRealizedAccepted === true),
    acceptedParentParity: completeSeedEvidence
      && records.every(({ acceptedParentParity }) => acceptedParentParity === true),
    diversity: completeSeedEvidence && diversityChecks.accepted,
    performance: Boolean(
      elapsedValues.length === expectedEntries.length
      && performance.medianMs <= performanceBudgetMs.median
      && performance.p95Ms <= performanceBudgetMs.p95
      && performance.maximumMs <= performanceBudgetMs.maximum
    ),
  };
  const corpusAccepted = Object.values(gates).every(Boolean);
  return sealEvidence({
    schemaVersion: RELEASE_EVIDENCE_SCHEMA_VERSION,
    kind: 'dungeon-augmentation-release-aggregate',
    generatedAt,
    result: corpusAccepted ? 'passed' : 'failed',
    corpusAccepted,
    profile: manifest.profile,
    provenance: manifest.provenance,
    manifestHash: manifest.evidenceHash,
    corpusTier,
    shardTopology: expectedShardTopology,
    expectedSeedCount: expectedEntries.length,
    shardCount: shards.length,
    recordCount: records.length,
    missingOrdinals,
    missingRecordOrdinals,
    duplicateRecordOrdinals: [...new Set(duplicateRecordOrdinals)].sort((left, right) => left - right),
    gates,
    performance,
    diversity: {
      ...diversityChecks,
      frequencies,
    },
    shardEvidenceSummaries: shards.map(({
      evidenceHash,
      result,
      shardIndex,
      shardCount,
      shardSize,
      ordinalStart,
      ordinalEndExclusive,
    }) => ({
      evidenceHash,
      result,
      shardIndex,
      shardCount,
      shardSize,
      ordinalStart,
      ordinalEndExclusive,
    })).sort((left, right) => left.shardIndex - right.shardIndex),
    shardEvidenceHashes: shards.map(({ evidenceHash }) => evidenceHash).sort(),
    records,
  });
}

export function validateAggregateEvidence(aggregate) {
  assertSealedEvidence(aggregate, 'release aggregate');
  validateReleaseMachineProvenance(
    aggregate?.provenance?.machine,
    'release aggregate machine',
  );
  if (aggregate.schemaVersion !== RELEASE_EVIDENCE_SCHEMA_VERSION
    || aggregate.kind !== 'dungeon-augmentation-release-aggregate') {
    throw new Error(`Expected release aggregate evidence; received ${aggregate.kind ?? 'unknown'}.`);
  }
  if (aggregate.profile?.id !== RELEASE_PROFILE_ID
    || aggregate.profile?.revision !== RELEASE_PROFILE_REVISION
    || canonicalStringify(aggregate.profile) !== canonicalStringify(aggregate.provenance?.profile)) {
    throw new Error('Release aggregate does not target authoritative V4 revision 5.');
  }
  if (!Object.hasOwn(RELEASE_CORPUS_COUNTS, aggregate.corpusTier)) {
    throw new Error('Release aggregate references an unknown corpus tier.');
  }
  const expectedSeedCount = RELEASE_CORPUS_COUNTS[aggregate.corpusTier];
  const expectedShardTopology = RELEASE_SHARD_TOPOLOGY[aggregate.corpusTier];
  if (aggregate.expectedSeedCount !== expectedSeedCount
    || canonicalStringify(aggregate.shardTopology)
      !== canonicalStringify(expectedShardTopology)
    || !Array.isArray(aggregate.records)
    || aggregate.recordCount !== aggregate.records.length
    || !Array.isArray(aggregate.shardEvidenceHashes)
    || aggregate.shardCount !== aggregate.shardEvidenceHashes.length) {
    throw new Error('Release aggregate counts or authoritative tier topology are inconsistent.');
  }

  const summaries = aggregate.shardEvidenceSummaries;
  const requiresCompleteShardSummaries = aggregate.result === 'passed'
    || aggregate.corpusAccepted === true;
  if (requiresCompleteShardSummaries && !Array.isArray(summaries)) {
    throw new Error('Passing release aggregate lacks complete shard-result summaries.');
  }
  let shardResultsPassed;
  let exactShardTopology;
  let exactOrdinalCoverage;
  if (Array.isArray(summaries)) {
    const ordinalOwners = new Map();
    const shardIndexes = new Set();
    let canonicalTopology = summaries.length === expectedShardTopology.shardCount;
    for (const summary of summaries) {
      const canonicalStart = Number(summary?.shardIndex) * expectedShardTopology.shardSize;
      const canonicalEnd = canonicalStart + expectedShardTopology.shardSize;
      const validSummary = summary
        && typeof summary === 'object'
        && !Array.isArray(summary)
        && typeof summary.evidenceHash === 'string'
        && summary.evidenceHash.startsWith('sha256-')
        && ['passed', 'failed'].includes(summary.result)
        && Number.isSafeInteger(summary.shardIndex)
        && summary.shardIndex >= 0
        && summary.shardIndex < expectedShardTopology.shardCount
        && summary.shardCount === expectedShardTopology.shardCount
        && summary.shardSize === expectedShardTopology.shardSize
        && summary.ordinalStart === canonicalStart
        && summary.ordinalEndExclusive === canonicalEnd;
      canonicalTopology = canonicalTopology
        && validSummary
        && !shardIndexes.has(summary?.shardIndex);
      if (!validSummary) continue;
      shardIndexes.add(summary.shardIndex);
      for (let ordinal = summary.ordinalStart; ordinal < summary.ordinalEndExclusive; ordinal += 1) {
        if (ordinalOwners.has(ordinal)) {
          canonicalTopology = false;
          continue;
        }
        ordinalOwners.set(ordinal, summary.evidenceHash);
      }
    }
    const summaryHashes = summaries.map(({ evidenceHash }) => evidenceHash).sort();
    if (canonicalStringify(summaryHashes)
      !== canonicalStringify([...aggregate.shardEvidenceHashes].sort())) {
      throw new Error('Release aggregate shard hashes do not match its shard-result summaries.');
    }
    shardResultsPassed = summaries.length > 0
      && summaries.every(({ result }) => result === 'passed');
    exactShardTopology = canonicalTopology
      && shardIndexes.size === expectedShardTopology.shardCount;
    exactOrdinalCoverage = exactShardTopology
      && ordinalOwners.size === expectedSeedCount
      && Array.from({ length: expectedSeedCount }, (_, ordinal) => ordinal)
        .every((ordinal) => ordinalOwners.has(ordinal));
  } else {
    // Historical failed aggregates predate per-shard summaries. They remain
    // readable as failed diagnostics, but can never be promoted to a pass.
    shardResultsPassed = aggregate.gates?.shardResultsPassed === true;
    exactShardTopology = aggregate.gates?.exactShardTopology === true;
    exactOrdinalCoverage = aggregate.gates?.exactOrdinalCoverage === true;
  }

  const recordOrdinals = aggregate.records.map(({ ordinal }) => ordinal);
  const duplicateRecordOrdinals = recordOrdinals
    .filter((ordinal, index, values) => values.indexOf(ordinal) !== index);
  const recordOrdinalSet = new Set(recordOrdinals);
  const missingRecordOrdinals = Array.from({ length: expectedSeedCount }, (_, ordinal) => ordinal)
    .filter((ordinal) => !recordOrdinalSet.has(ordinal));
  const exactRecordCoverage = aggregate.records.length === expectedSeedCount
    && duplicateRecordOrdinals.length === 0
    && missingRecordOrdinals.length === 0
    && recordOrdinals.every((ordinal) => (
      Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal < expectedSeedCount
    ));
  if (canonicalStringify(aggregate.missingRecordOrdinals)
      !== canonicalStringify(missingRecordOrdinals)
    || canonicalStringify(aggregate.duplicateRecordOrdinals)
      !== canonicalStringify([...new Set(duplicateRecordOrdinals)].sort((left, right) => left - right))) {
    throw new Error('Release aggregate record-coverage diagnostics are inconsistent.');
  }
  if (Array.isArray(summaries)) {
    const expectedMissingOrdinals = exactOrdinalCoverage
      ? []
      : Array.from({ length: expectedSeedCount }, (_, ordinal) => ordinal).filter((ordinal) => (
          !summaries.some((summary) => (
            ordinal >= summary.ordinalStart && ordinal < summary.ordinalEndExclusive
          ))
        ));
    if (canonicalStringify(aggregate.missingOrdinals)
      !== canonicalStringify(expectedMissingOrdinals)) {
      throw new Error('Release aggregate shard-coverage diagnostics are inconsistent.');
    }
  }

  for (const record of aggregate.records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('Release aggregate contains a malformed seed record.');
    }
    const phases = record.elapsedPhases;
    if (!phases
      || typeof phases !== 'object'
      || Array.isArray(phases)
      || !finiteNonnegativeNumber(phases.generationMs)
      || !finiteNonnegativeNumber(phases.strictValidationMs)
      || !finiteNonnegativeNumber(phases.disposalMs)
      || !finiteNonnegativeNumber(phases.totalMs)
      || !finiteNonnegativeNumber(record.elapsedMs)
      || Math.abs(
        phases.generationMs + phases.strictValidationMs + phases.disposalMs - phases.totalMs
      ) > 1e-6
      || phases.totalMs !== record.elapsedMs) {
      throw new Error(`Release aggregate record ${record.ordinal ?? 'unknown'} has invalid timing.`);
    }
    validateReleaseGeneratorPhaseTimings(record.generatorPhaseTimings, {
      label: `release aggregate record ${record.ordinal} generator phase timings`,
      requireGeneratorMetrics: true,
    });
    validateReleaseSelectionBagWitnesses(record.selectionBagWitnesses);
  }

  if (canonicalStringify(aggregate.performance?.budgetMs)
    !== canonicalStringify(RELEASE_PERFORMANCE_BUDGET_MS)) {
    throw new Error('Release aggregate does not use the authoritative performance budget.');
  }
  const elapsedValues = (aggregate.records ?? [])
    .map(({ elapsedMs }) => elapsedMs)
    .filter(finiteNonnegativeNumber);
  const expectedPerformance = {
    budgetMs: RELEASE_PERFORMANCE_BUDGET_MS,
    sampleCount: elapsedValues.length,
    medianMs: median(elapsedValues),
    p95Ms: nearestRank(elapsedValues, 0.95),
    maximumMs: elapsedValues.length > 0 ? Math.max(...elapsedValues) : null,
  };
  if (canonicalStringify(aggregate.performance) !== canonicalStringify(expectedPerformance)) {
    throw new Error('Release aggregate performance evidence is internally inconsistent.');
  }
  const frequencies = {
    topologyTemplates: countSelections(aggregate.records, 'topologyTemplateSelections'),
    junctionKinds: countSelections(aggregate.records, 'junctionKindSelections'),
    elevationModes: countSelections(aggregate.records, 'elevationModeSelections'),
    encounterProfiles: countSelections(aggregate.records, 'encounterProfileSelections'),
    roomLayouts: countSelections(aggregate.records, 'roomLayoutSelections'),
    completeLayoutSignatures: countSelections(aggregate.records, 'completeLayoutSignatures'),
  };
  const requiresCorpusDiversity = expectedSeedCount >= RELEASE_CORPUS_COUNTS.normal;
  const diversity = {
    required: requiresCorpusDiversity,
    exactTopologyFamilies: !requiresCorpusDiversity
      || exactKeys(frequencies.topologyTemplates, EXPECTED_TOPOLOGY_TEMPLATE_IDS),
    exactJunctionFamilies: !requiresCorpusDiversity
      || exactKeys(frequencies.junctionKinds, EXPECTED_JUNCTION_KINDS),
    exactElevationFamilies: !requiresCorpusDiversity
      || exactKeys(frequencies.elevationModes, EXPECTED_ELEVATION_MODES),
    exactEncounterFamilies: !requiresCorpusDiversity
      || exactKeys(frequencies.encounterProfiles, EXPECTED_ENCOUNTER_PROFILE_IDS),
    exactRoomLayoutFamilies: !requiresCorpusDiversity
      || exactKeys(frequencies.roomLayouts, EXPECTED_ROOM_LAYOUT_IDS),
    topologyMaximumRatio: maximumSelectionRatio(frequencies.topologyTemplates),
    junctionMaximumRatio: maximumSelectionRatio(frequencies.junctionKinds),
    elevationMaximumRatio: maximumSelectionRatio(frequencies.elevationModes),
    completeSignatureMaximumRatio: maximumSelectionRatio(frequencies.completeLayoutSignatures),
    completeSignatureEvidencePresent: aggregate.records.length > 0
      && frequencies.completeLayoutSignatures.total > 0
      && aggregate.records.every(({ status, completeLayoutSignatures }) => (
        status !== 'applied'
          || Array.isArray(completeLayoutSignatures) && completeLayoutSignatures.length > 0
      )),
  };
  const completeSeedEvidence = aggregate.records.length > 0 && exactRecordCoverage;
  diversity.accepted = completeSeedEvidence && (
    !requiresCorpusDiversity || Boolean(
      diversity.exactTopologyFamilies
      && diversity.exactJunctionFamilies
      && diversity.exactElevationFamilies
      && diversity.exactEncounterFamilies
      && diversity.exactRoomLayoutFamilies
      && diversity.completeSignatureEvidencePresent
      && diversity.topologyMaximumRatio <= 0.35 + Number.EPSILON
      && diversity.junctionMaximumRatio <= 0.50 + Number.EPSILON
      && diversity.completeSignatureMaximumRatio <= 0.10 + Number.EPSILON
    )
  );
  const expectedDiversity = { ...diversity, frequencies };
  if (canonicalStringify(aggregate.diversity) !== canonicalStringify(expectedDiversity)) {
    throw new Error('Release aggregate diversity evidence is internally inconsistent.');
  }

  const expectedPerformanceGate = expectedSeedCount > 0
    && elapsedValues.length === expectedSeedCount
    && expectedPerformance.medianMs <= RELEASE_PERFORMANCE_BUDGET_MS.median
    && expectedPerformance.p95Ms <= RELEASE_PERFORMANCE_BUDGET_MS.p95
    && expectedPerformance.maximumMs <= RELEASE_PERFORMANCE_BUDGET_MS.maximum;
  const expectedGates = {
    cleanSourceProvenance: aggregate.provenance?.sourceDirty === false,
    referenceMachine: isReleaseReferenceMachine(aggregate.provenance),
    shardResultsPassed,
    exactShardTopology,
    exactOrdinalCoverage,
    exactRecordCoverage,
    zeroFallback: completeSeedEvidence
      && aggregate.records.every(({ status }) => status === 'applied'),
    firstRealization: completeSeedEvidence
      && aggregate.records.every(({ realizationAttempts }) => realizationAttempts === 1),
    releaseValidation: completeSeedEvidence && aggregate.records.every((record) => (
      record.releaseValidationAccepted === true
      && Number(record.releaseValidationErrorCount ?? 0) === 0
      && record.acceptedAsPlayableAlpha !== true
    )),
    strictRealizedValidation: completeSeedEvidence
      && aggregate.records.every(({ strictRealizedAccepted }) => strictRealizedAccepted === true),
    acceptedParentParity: completeSeedEvidence
      && aggregate.records.every(({ acceptedParentParity }) => acceptedParentParity === true),
    diversity: completeSeedEvidence && diversity.accepted,
    performance: expectedPerformanceGate,
  };
  if (canonicalStringify(aggregate.gates) !== canonicalStringify(expectedGates)) {
    throw new Error('Release aggregate acceptance gates are internally inconsistent.');
  }
  const corpusAccepted = Object.values(expectedGates).every(Boolean);
  if (aggregate.corpusAccepted !== corpusAccepted
    || aggregate.result !== (corpusAccepted ? 'passed' : 'failed')) {
    throw new Error('Release aggregate verdict does not match its authoritative gates.');
  }
  return aggregate;
}

export function validateAggregateEvidenceForCurrentProvenance(
  aggregate,
  currentProvenance,
  label = 'release documentation evidence',
) {
  const validated = validateAggregateEvidence(aggregate);
  assertMatchingReleaseProvenance(currentProvenance, validated.provenance, label);
  return validated;
}

export function validateReleasePredecessorEvidenceCollection(
  predecessorEvidence,
  referenceIdentity = {},
) {
  if (!predecessorEvidence
    || typeof predecessorEvidence !== 'object'
    || Array.isArray(predecessorEvidence)) {
    throw new Error('Release attestation requires sealed canonical, smoke, and normal predecessor evidence.');
  }
  const suppliedStages = Object.keys(predecessorEvidence);
  const unknownStages = suppliedStages.filter((stage) => (
    !RELEASE_PREDECESSOR_STAGE_IDS.includes(stage)
  ));
  const missingStages = RELEASE_PREDECESSOR_STAGE_IDS.filter((stage) => (
    !Object.hasOwn(predecessorEvidence, stage)
  ));
  if (unknownStages.length > 0
    || missingStages.length > 0
    || suppliedStages.length !== RELEASE_PREDECESSOR_STAGE_IDS.length) {
    throw new Error([
      unknownStages.length > 0
        ? `unknown predecessor stages: ${unknownStages.join(', ')}`
        : null,
      missingStages.length > 0
        ? `missing predecessor stages: ${missingStages.join(', ')}`
        : null,
    ].filter(Boolean).join('; ') || 'Release predecessor evidence coverage is invalid.');
  }

  const normal = validateAggregateEvidence(predecessorEvidence.normal);
  const expectedManifestHash = referenceIdentity.manifestHash ?? normal.manifestHash;
  const expectedProvenance = referenceIdentity.provenance ?? normal.provenance;
  const expectedProfile = referenceIdentity.profile
    ?? expectedProvenance?.profile
    ?? normal.profile;
  if (typeof expectedManifestHash !== 'string' || !expectedManifestHash
    || !expectedProvenance || typeof expectedProvenance !== 'object'
    || !expectedProfile || typeof expectedProfile !== 'object') {
    throw new Error('Release predecessor evidence lacks an authoritative manifest/source/profile identity.');
  }
  const manifestIdentity = {
    evidenceHash: expectedManifestHash,
    provenance: expectedProvenance,
    profile: expectedProfile,
  };
  const canonical = validateCanonicalProbeEvidence(
    predecessorEvidence.canonical,
    manifestIdentity,
  );
  const smoke = validateAggregateEvidence(predecessorEvidence.smoke);
  const aggregates = { smoke, normal };

  for (const [tier, aggregate] of Object.entries(aggregates)) {
    if (aggregate.corpusTier !== tier
      || aggregate.expectedSeedCount !== RELEASE_CORPUS_COUNTS[tier]
      || aggregate.manifestHash !== expectedManifestHash
      || canonicalStringify(aggregate.profile) !== canonicalStringify(expectedProfile)) {
      throw new Error(`Release ${tier} predecessor has the wrong tier, manifest, or profile identity.`);
    }
    assertMatchingReleaseProvenance(
      aggregate.provenance,
      expectedProvenance,
      `release ${tier} predecessor`,
    );
    if (aggregate.result !== 'passed' || aggregate.corpusAccepted !== true) {
      throw new Error(`Release ${tier} predecessor did not pass its authoritative gates.`);
    }
  }
  if (canonical.manifestHash !== expectedManifestHash
    || canonicalStringify(canonical.profile) !== canonicalStringify(expectedProfile)
    || canonical.result !== 'passed'
    || canonical.accepted !== true) {
    throw new Error('Release canonical predecessor did not pass with the required manifest/profile identity.');
  }

  return { canonical, smoke, normal };
}

function releaseSuiteContract(suiteId) {
  const contract = RELEASE_SUITE_CONTRACTS[suiteId];
  if (!contract) throw new Error(`Unknown release suite receipt ${suiteId ?? 'missing'}.`);
  return contract;
}

function releaseSuiteContractHash(suiteId) {
  return hashCanonicalValue(
    { suiteId, ...releaseSuiteContract(suiteId) },
    `${EVIDENCE_HASH_NAMESPACE}:suite-contract`,
  );
}

function releaseCommandPassed(commandResult) {
  return commandResult?.skipped !== true
    && commandResult?.status === 0
    && commandResult?.signal == null
    && commandResult?.error == null;
}

export function createReleaseSuiteReceipt({
  suiteId,
  provenance,
  commandResults,
  sourceStable = true,
  postRunSourceHash = provenance?.sourceHash ?? null,
  postRunSourceDirty = provenance?.sourceDirty ?? null,
  generatedAt = new Date().toISOString(),
}) {
  const contract = releaseSuiteContract(suiteId);
  const commandsPassed = Array.isArray(commandResults)
    && commandResults.length === contract.commands.length
    && commandResults.every(releaseCommandPassed);
  const cleanStableSource = sourceStable === true
    && provenance?.sourceDirty === false
    && postRunSourceDirty === false
    && postRunSourceHash === provenance?.sourceHash;
  return validateReleaseSuiteReceipt(sealEvidence({
    schemaVersion: RELEASE_EVIDENCE_SCHEMA_VERSION,
    schema: RELEASE_SUITE_RECEIPT_SCHEMA,
    kind: 'dungeon-augmentation-release-suite-receipt',
    generatedAt,
    suiteId,
    label: contract.label,
    profile: provenance?.profile,
    provenance,
    contractHash: releaseSuiteContractHash(suiteId),
    sourceStable: cleanStableSource,
    postRunSourceHash,
    postRunSourceDirty,
    result: commandsPassed && cleanStableSource ? 'passed' : 'failed',
    commandResults,
  }));
}

export function validateReleaseSuiteReceipt(receipt) {
  assertSealedEvidence(receipt, 'release suite receipt');
  if (receipt.schemaVersion !== RELEASE_EVIDENCE_SCHEMA_VERSION
    || receipt.schema !== RELEASE_SUITE_RECEIPT_SCHEMA
    || receipt.kind !== 'dungeon-augmentation-release-suite-receipt') {
    throw new Error('Release suite receipt has an unsupported schema or kind.');
  }
  const contract = releaseSuiteContract(receipt.suiteId);
  validateReleaseMachineProvenance(
    receipt?.provenance?.machine,
    `release suite receipt ${receipt.suiteId} machine`,
  );
  if (receipt.profile?.id !== RELEASE_PROFILE_ID
    || receipt.profile?.revision !== RELEASE_PROFILE_REVISION
    || canonicalStringify(receipt.profile) !== canonicalStringify(receipt.provenance?.profile)) {
    throw new Error(`Release suite receipt ${receipt.suiteId} has the wrong V4 profile identity.`);
  }
  if (receipt.contractHash !== releaseSuiteContractHash(receipt.suiteId)
    || receipt.label !== contract.label
    || receipt.commandResults?.length !== contract.commands.length) {
    throw new Error(`Release suite receipt ${receipt.suiteId} does not match its immutable command contract.`);
  }
  receipt.commandResults.forEach((result, index) => {
    const expected = contract.commands[index];
    if (result?.id !== expected.id
      || result?.runner !== expected.runner
      || canonicalStringify(result?.args) !== canonicalStringify(expected.args)
      || !finiteNonnegativeNumber(result?.elapsedMs)
      || (result.skipped === true
        ? result.status != null
        : !Number.isInteger(result.status))) {
      throw new Error(
        `Release suite receipt ${receipt.suiteId} command ${expected.id} is malformed or substituted.`,
      );
    }
  });
  if (typeof receipt.sourceStable !== 'boolean'
    || typeof receipt.postRunSourceHash !== 'string'
    || !receipt.postRunSourceHash
    || typeof receipt.provenance?.sourceDirty !== 'boolean'
    || typeof receipt.postRunSourceDirty !== 'boolean') {
    throw new Error(`Release suite receipt ${receipt.suiteId} lacks post-run source identity.`);
  }
  if (receipt.sourceStable === true && (
    receipt.provenance.sourceDirty !== false
    || receipt.postRunSourceDirty !== false
    || receipt.postRunSourceHash !== receipt.provenance.sourceHash
  )) {
    throw new Error(
      `Release suite receipt ${receipt.suiteId} sourceStable conflicts with source cleanliness or identity.`,
    );
  }
  const expectedResult = receipt.sourceStable
    && receipt.provenance.sourceDirty === false
    && receipt.postRunSourceDirty === false
    && receipt.postRunSourceHash === receipt.provenance.sourceHash
    && receipt.commandResults.every(releaseCommandPassed)
    ? 'passed'
    : 'failed';
  if (receipt.result !== expectedResult) {
    throw new Error(`Release suite receipt ${receipt.suiteId} result disagrees with its commands.`);
  }
  return receipt;
}

function validateRequiredSuiteReceiptCollection(receipts, aggregateProvenance) {
  if (!Array.isArray(receipts)) {
    throw new Error('Release attestation requires an array of sealed suite receipts.');
  }
  const owners = new Map();
  for (const candidate of receipts) {
    const receipt = validateReleaseSuiteReceipt(candidate);
    if (owners.has(receipt.suiteId)) {
      throw new Error(`Release attestation contains duplicate ${receipt.suiteId} receipts.`);
    }
    owners.set(receipt.suiteId, receipt);
    assertMatchingReleaseProvenance(
      receipt.provenance,
      aggregateProvenance,
      `release suite receipt ${receipt.suiteId}`,
    );
  }
  const unknown = [...owners.keys()].filter((suiteId) => (
    !RELEASE_REQUIRED_SUITE_IDS.includes(suiteId)
  ));
  const missing = RELEASE_REQUIRED_SUITE_IDS.filter((suiteId) => !owners.has(suiteId));
  if (unknown.length > 0 || missing.length > 0 || owners.size !== RELEASE_REQUIRED_SUITE_IDS.length) {
    throw new Error([
      unknown.length > 0 ? `unknown receipts: ${unknown.join(', ')}` : null,
      missing.length > 0 ? `missing receipts: ${missing.join(', ')}` : null,
    ].filter(Boolean).join('; ') || 'Release attestation receipt coverage is invalid.');
  }
  return RELEASE_REQUIRED_SUITE_IDS.map((suiteId) => owners.get(suiteId));
}

function deriveReleaseAttestationGates(aggregate, suiteReceipts, predecessorEvidence) {
  const predecessorStages = Object.keys(predecessorEvidence);
  return {
    releaseCorpusTier: aggregate.corpusTier === 'release'
      && aggregate.expectedSeedCount === RELEASE_CORPUS_COUNTS.release,
    corpusAccepted: aggregate.corpusAccepted === true && aggregate.result === 'passed',
    exactPredecessorCoverage: RELEASE_PREDECESSOR_STAGE_IDS.every((stage) => (
      predecessorStages.includes(stage)
    )) && predecessorStages.length === RELEASE_PREDECESSOR_STAGE_IDS.length,
    predecessorStagesPassed: predecessorEvidence.canonical.accepted === true
      && predecessorEvidence.canonical.result === 'passed'
      && predecessorEvidence.smoke.corpusAccepted === true
      && predecessorEvidence.smoke.result === 'passed'
      && predecessorEvidence.normal.corpusAccepted === true
      && predecessorEvidence.normal.result === 'passed',
    predecessorManifestIdentity: RELEASE_PREDECESSOR_STAGE_IDS.every((stage) => (
      predecessorEvidence[stage].manifestHash === aggregate.manifestHash
      && canonicalStringify(predecessorEvidence[stage].profile)
        === canonicalStringify(aggregate.profile)
    )),
    exactReceiptCoverage: suiteReceipts.length === RELEASE_REQUIRED_SUITE_IDS.length,
    sameSourceProvenance: true,
    receiptsPassed: suiteReceipts.every(({ result }) => result === 'passed'),
    receiptSourceStable: suiteReceipts.every(({
      sourceStable,
      postRunSourceHash,
      postRunSourceDirty,
      provenance,
    }) => (
      sourceStable === true
        && provenance.sourceDirty === false
        && postRunSourceDirty === false
        && postRunSourceHash === provenance.sourceHash
    )),
    cleanSourceProvenance: aggregate.provenance.sourceDirty === false
      && suiteReceipts.every(({ provenance, postRunSourceDirty }) => (
        provenance.sourceDirty === false && postRunSourceDirty === false
      ))
      && RELEASE_PREDECESSOR_STAGE_IDS.every((stage) => (
        predecessorEvidence[stage].provenance.sourceDirty === false
      )),
  };
}

export function createReleaseAttestation({
  aggregate,
  suiteReceipts,
  predecessorEvidence,
  generatedAt = new Date().toISOString(),
}) {
  const validatedAggregate = validateAggregateEvidence(aggregate);
  const validatedPredecessors = validateReleasePredecessorEvidenceCollection(
    predecessorEvidence,
    {
      manifestHash: validatedAggregate.manifestHash,
      provenance: validatedAggregate.provenance,
      profile: validatedAggregate.profile,
    },
  );
  const validatedReceipts = validateRequiredSuiteReceiptCollection(
    suiteReceipts,
    validatedAggregate.provenance,
  );
  const gates = deriveReleaseAttestationGates(
    validatedAggregate,
    validatedReceipts,
    validatedPredecessors,
  );
  const releaseAccepted = Object.values(gates).every(Boolean);
  return validateReleaseAttestation(sealEvidence({
    schemaVersion: RELEASE_EVIDENCE_SCHEMA_VERSION,
    schema: RELEASE_ATTESTATION_SCHEMA,
    kind: 'dungeon-augmentation-release-attestation',
    generatedAt,
    result: releaseAccepted ? 'passed' : 'failed',
    releaseAccepted,
    profile: validatedAggregate.profile,
    provenance: validatedAggregate.provenance,
    aggregateEvidenceHash: validatedAggregate.evidenceHash,
    predecessorEvidenceHashes: Object.fromEntries(
      RELEASE_PREDECESSOR_STAGE_IDS.map((stage) => [
        stage,
        validatedPredecessors[stage].evidenceHash,
      ]),
    ),
    suiteReceiptEvidenceHashes: Object.fromEntries(validatedReceipts.map((receipt) => [
      receipt.suiteId,
      receipt.evidenceHash,
    ])),
    gates,
    aggregate: validatedAggregate,
    predecessorEvidence: validatedPredecessors,
    suiteReceipts: validatedReceipts,
  }));
}

export function validateReleaseAttestation(attestation) {
  assertSealedEvidence(attestation, 'release attestation');
  if (attestation.schemaVersion !== RELEASE_EVIDENCE_SCHEMA_VERSION
    || attestation.schema !== RELEASE_ATTESTATION_SCHEMA
    || attestation.kind !== 'dungeon-augmentation-release-attestation') {
    throw new Error(
      'Release documentation requires a sealed aggregate-and-receipts attestation, not a corpus aggregate alone.',
    );
  }
  const aggregate = validateAggregateEvidence(attestation.aggregate);
  const predecessors = validateReleasePredecessorEvidenceCollection(
    attestation.predecessorEvidence,
    {
      manifestHash: aggregate.manifestHash,
      provenance: aggregate.provenance,
      profile: aggregate.profile,
    },
  );
  const receipts = validateRequiredSuiteReceiptCollection(
    attestation.suiteReceipts,
    aggregate.provenance,
  );
  assertMatchingReleaseProvenance(
    attestation.provenance,
    aggregate.provenance,
    'release attestation',
  );
  if (canonicalStringify(attestation.profile) !== canonicalStringify(aggregate.profile)
    || attestation.aggregateEvidenceHash !== aggregate.evidenceHash) {
    throw new Error('Release attestation aggregate identity does not match its embedded evidence.');
  }
  const expectedPredecessorHashes = Object.fromEntries(
    RELEASE_PREDECESSOR_STAGE_IDS.map((stage) => [
      stage,
      predecessors[stage].evidenceHash,
    ]),
  );
  if (canonicalStringify(attestation.predecessorEvidenceHashes)
    !== canonicalStringify(expectedPredecessorHashes)) {
    throw new Error(
      'Release attestation predecessor hashes do not match its embedded evidence.',
    );
  }
  const expectedReceiptHashes = Object.fromEntries(receipts.map((receipt) => [
    receipt.suiteId,
    receipt.evidenceHash,
  ]));
  if (canonicalStringify(attestation.suiteReceiptEvidenceHashes)
    !== canonicalStringify(expectedReceiptHashes)) {
    throw new Error('Release attestation receipt hashes do not match its embedded receipts.');
  }
  const gates = deriveReleaseAttestationGates(aggregate, receipts, predecessors);
  const releaseAccepted = Object.values(gates).every(Boolean);
  if (canonicalStringify(attestation.gates) !== canonicalStringify(gates)
    || attestation.releaseAccepted !== releaseAccepted
    || attestation.result !== (releaseAccepted ? 'passed' : 'failed')) {
    throw new Error('Release attestation verdict does not match its sealed aggregate and receipts.');
  }
  return attestation;
}

export function validateReleaseAttestationForCurrentProvenance(
  attestation,
  currentProvenance,
  label = 'release documentation evidence',
) {
  const validated = validateReleaseAttestation(attestation);
  assertMatchingReleaseProvenance(currentProvenance, validated.provenance, label);
  return validated;
}
