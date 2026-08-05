import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  RELEASE_AUGMENTATION_REALIZATION_ATTEMPT_LIMIT,
  RELEASE_GENERATOR_PHASE_TIMING_SCHEMA,
  RELEASE_PERFORMANCE_BUDGET_MS,
  RELEASE_PROFILE_ID,
  RELEASE_PROFILE_REVISION,
  sealEvidence,
} from '../scripts/dungeon-augmentation-release-evidence.mjs';
import {
  RELEASE_CANONICAL_PROBES,
  RELEASE_GATE_TIERS,
  canonicalProbeGates,
  createCanonicalProbeEvidence,
  createReleaseGateSteps,
  runReleaseGateSteps,
  validateCanonicalProbeEvidence,
} from '../scripts/dungeon-augmentation-release-gates.mjs';

const projectRoot = path.resolve('release-gate-project');
const artifactRoot = path.join(projectRoot, 'artifacts', 'release');
const provenance = Object.freeze({
  gitCommit: '0123456789abcdef',
  sourceDirty: false,
  sourceHash: 'sha256-release-gate-test',
  nodeVersion: 'v24.17.0',
  platform: 'win32-x64',
  machine: Object.freeze({
    cpuModel: 'Release Gate Test CPU',
    logicalCpuCount: 8,
    totalMemoryBytes: 16_000_000_000,
  }),
  profile: Object.freeze({
    id: RELEASE_PROFILE_ID,
    revision: RELEASE_PROFILE_REVISION,
    hash: 'sha256-release-gate-profile',
  }),
});
const manifest = sealEvidence({
  kind: 'synthetic-release-manifest',
  profile: provenance.profile,
  provenance,
});

function createCanonicalRecord(probe, elapsedMs = 9_000) {
  const generatorPhaseTimings = {
    schema: RELEASE_GENERATOR_PHASE_TIMING_SCHEMA,
    parentGenerationMs: 1_000,
    planningMs: 3_000,
    materializationMs: 1_000,
    threeJsAssemblyMs: 1_000,
    strictValidationMs: 1_000,
    disposalMs: elapsedMs - 7_000,
    totalMs: elapsedMs,
    planningTimeMs: 3_000,
    assemblyTimeMs: 1_000,
  };
  return {
    ordinal: probe.ordinal,
    seed: probe.seed,
    status: 'applied',
    realizationAttempts: 1,
    releaseValidationAccepted: true,
    releaseValidationErrorCount: 0,
    acceptedAsPlayableAlpha: false,
    strictRealizedAccepted: true,
    acceptedParentParity: true,
    elapsedMs,
    generatorPhaseTimings,
    workerEvidenceHash: `sha256-worker-${probe.ordinal}`,
  };
}

test('release gates pin the canonical seed pair, attempt cap, budgets, and watchdog', () => {
  assert.deepEqual(RELEASE_CANONICAL_PROBES, [{
    ordinal: 0,
    seed: 'layout:augmentation-realized-v4-000',
  }, {
    ordinal: 1,
    seed: 'layout:augmentation-realized-v4-001',
  }]);
  assert.deepEqual(RELEASE_GATE_TIERS.map(({ id, seedCount }) => [id, seedCount]), [
    ['canonical', 2],
    ['smoke', 10],
    ['normal', 100],
    ['release', 1_000],
  ]);
  assert.equal(RELEASE_AUGMENTATION_REALIZATION_ATTEMPT_LIMIT, 1);
  assert.deepEqual(RELEASE_PERFORMANCE_BUDGET_MS, {
    median: 10_000,
    p95: 20_000,
    maximum: 30_000,
    ciTimeoutPerSeed: 180_000,
  });
});

test('gate plans reuse one immutable manifest and include every prerequisite tier', () => {
  const expected = {
    canonical: ['manifest', 'canonical'],
    smoke: ['manifest', 'canonical', 'smoke'],
    normal: ['manifest', 'canonical', 'smoke', 'normal'],
    release: ['manifest', 'canonical', 'smoke', 'normal', 'release'],
  };
  for (const [through, stepIds] of Object.entries(expected)) {
    const plan = createReleaseGateSteps({ projectRoot, artifactRoot, through });
    assert.deepEqual(plan.steps.map(({ id }) => id), stepIds);
    assert.equal(plan.manifestPath, path.join(
      artifactRoot,
      'accepted-parent-manifest-1000.json',
    ));
    assert.equal(plan.watchdogTimeoutMs, 180_000);
    assert.deepEqual(plan.performanceBudgetMs, {
      median: 10_000,
      p95: 20_000,
      maximum: 30_000,
    });
    for (const step of plan.steps.filter(({ id }) => ['smoke', 'normal', 'release'].includes(id))) {
      assert.equal(step.script, 'scripts/verify-dungeon-augmentation-release.mjs');
      assert.ok(step.args.includes(`--artifact-root=${artifactRoot}`));
    }
  }
});

test('public corpus and release aliases cannot bypass their prerequisite gates', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../package.json', import.meta.url),
    'utf8',
  ));
  const expected = {
    'test:dungeon-augmentation:realized:smoke': 'smoke',
    'test:dungeon-augmentation:realized': 'normal',
    'test:dungeon-augmentation:realized:release': 'release',
    'verify:dungeon-augmentation:corpus:smoke': 'smoke',
    'verify:dungeon-augmentation:corpus:normal': 'normal',
    'verify:dungeon-augmentation:corpus:release': 'release',
    'verify:dungeon-augmentation:release': 'release',
  };
  for (const [alias, through] of Object.entries(expected)) {
    assert.equal(
      packageJson.scripts[alias],
      `node scripts/run-dungeon-augmentation-release-gates.mjs --through=${through}`,
      alias,
    );
  }
});

test('a failed canonical pair blocks the 10-, 100-, and 1,000-seed tiers', () => {
  const plan = createReleaseGateSteps({ projectRoot, artifactRoot, through: 'release' });
  const calls = [];
  const outcome = runReleaseGateSteps({
    plan,
    provenance,
    spawnSyncImpl(executablePath, args, options) {
      calls.push({ executablePath, args, options });
      return { status: calls.length === 1 ? 0 : 1 };
    },
  });
  assert.equal(outcome.result, 'failed');
  assert.equal(outcome.failedStage, 'canonical');
  assert.deepEqual(outcome.completedStages, ['manifest']);
  assert.deepEqual(outcome.blockedStages, ['smoke', 'normal', 'release']);
  assert.equal(calls.length, 2);
});

test('each corpus tier blocks every larger tier after its first failure', () => {
  const cases = [{
    failedStage: 'smoke', statuses: [0, 0, 1], blocked: ['normal', 'release'],
  }, {
    failedStage: 'normal', statuses: [0, 0, 0, 1], blocked: ['release'],
  }, {
    failedStage: 'release', statuses: [0, 0, 0, 0, 1], blocked: [],
  }];
  for (const scenario of cases) {
    const plan = createReleaseGateSteps({ projectRoot, artifactRoot, through: 'release' });
    let callIndex = 0;
    const outcome = runReleaseGateSteps({
      plan,
      provenance,
      spawnSyncImpl() {
        const status = scenario.statuses[callIndex];
        callIndex += 1;
        return { status };
      },
    });
    assert.equal(outcome.failedStage, scenario.failedStage);
    assert.deepEqual(outcome.blockedStages, scenario.blocked);
    assert.equal(callIndex, scenario.statuses.length);
  }
});

test('dirty or indeterminate provenance blocks the top runner before any gate child starts', () => {
  const plan = createReleaseGateSteps({ projectRoot, artifactRoot, through: 'release' });
  for (const sourceDirty of [true, null]) {
    let spawnCount = 0;
    assert.throws(
      () => runReleaseGateSteps({
        plan,
        provenance: { ...provenance, sourceDirty },
        spawnSyncImpl() {
          spawnCount += 1;
          return { status: 0 };
        },
      }),
      /release gate runner source is (?:dirty|indeterminate)/u,
    );
    assert.equal(spawnCount, 0);
  }
});

test('canonical evidence passes only with both applied attempt-one records inside budgets', () => {
  const records = RELEASE_CANONICAL_PROBES.map((probe, index) => (
    createCanonicalRecord(probe, 9_000 + index * 1_000)
  ));
  const evidence = createCanonicalProbeEvidence({
    manifest,
    provenance,
    records,
    generatedAt: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(evidence.accepted, true);
  assert.equal(evidence.performance.medianMs, 9_500);
  assert.equal(evidence.performance.p95Ms, 10_000);
  assert.equal(validateCanonicalProbeEvidence(evidence, manifest), evidence);

  const overBudget = records.map((record) => ({ ...record }));
  overBudget[1].elapsedMs = 31_000;
  assert.equal(canonicalProbeGates(overBudget).performance, false);
  const rejected = createCanonicalProbeEvidence({
    manifest,
    provenance,
    records: overBudget,
    generatedAt: '2026-08-01T00:00:01.000Z',
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.result, 'failed');
  assert.equal(rejected.failure.errorName, 'CanonicalReleaseGateRejected');
  assert.equal(validateCanonicalProbeEvidence(rejected, manifest), rejected);
});

test('canonical evidence rejects malformed or incomplete six-phase timing proof', () => {
  const records = RELEASE_CANONICAL_PROBES.map((probe) => createCanonicalRecord(probe));
  const missingPhase = records.map((record) => ({
    ...record,
    generatorPhaseTimings: { ...record.generatorPhaseTimings },
  }));
  delete missingPhase[1].generatorPhaseTimings.materializationMs;
  assert.equal(canonicalProbeGates(missingPhase).phaseEvidence, false);

  const evidence = createCanonicalProbeEvidence({
    manifest,
    provenance,
    records: missingPhase,
    generatedAt: '2026-08-01T00:00:02.000Z',
  });
  assert.equal(evidence.accepted, false);
  assert.throws(
    () => validateCanonicalProbeEvidence(evidence, manifest),
    /generator phase timings is malformed or internally inconsistent/,
  );
});

test('unit verifier CLI rejects unknown and silently contracted modes', async () => {
  const verifierSource = await readFile(
    new URL('../scripts/verify-dungeon-augmentation.mjs', import.meta.url),
    'utf8',
  );
  assert.match(verifierSource, /const unknownArguments = commandArguments\.filter/u);
  assert.match(verifierSource, /Unsupported argument\(s\)/u);
  assert.match(
    verifierSource,
    /--count must be an integer greater than or equal to 100/u,
  );
  assert.match(verifierSource, /--list-files cannot be combined/u);
  assert.match(verifierSource, /readdirSync\(new URL\('\.\.\/tests\//u);
  assert.match(verifierSource, /\^dungeon-augmentation-/u);
  assert.match(verifierSource, /dungeon-room-spawn-context-performance\.test\.mjs/u);
  assert.match(verifierSource, /dungeon-scaffold-access-optimization\.test\.mjs/u);
  assert.match(verifierSource, /--test-concurrency=1/u);
});
