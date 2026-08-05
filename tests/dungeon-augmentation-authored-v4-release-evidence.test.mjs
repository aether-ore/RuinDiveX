import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORED_V4_RELEASE_LIMITS,
  AUTHORED_V4_RELEASE_RECEIPT_IDS,
  createAuthoredV4ArtifactCompilerReceipt,
  createAuthoredV4AssetDecodeReceipt,
  createAuthoredV4PinnedRuntimeReceipt,
  createAuthoredV4ReliabilityReceipt,
  createAuthoredV4ReleaseEvidence,
  evaluateAuthoredV4ArtifactCompilerReceipt,
  evaluateAuthoredV4AssetDecodeReceipt,
  evaluateAuthoredV4PinnedRuntimeReceipt,
  evaluateAuthoredV4ReliabilityReceipt,
  evaluateAuthoredV4ReleaseEvidence,
} from '../src/dungeon-augmentation/authored/AuthoredV4ReleaseEvidence.js';
import {
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
  INDUSTRIAL_V4_AUTHORED_COMPOSITION,
  INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
  INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
  INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
} from '../src/dungeon-augmentation/authored/AuthoredArtifactCompiler.js';

const artifactIdentity = Object.freeze({
  artifactId: INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
  artifactRevision: INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
  profileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  profileRevision: INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
  gameplayTuningRevision: INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
  generationMode: INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
  canonicalLayoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  artifactHash: 'v1-artifact',
  sourceContentHash: 'v1-source',
  baseGeometryHash: 'v1-base',
  overlayPlanHash: 'v1-overlay',
  effectiveLayoutHash: 'v1-effective',
  materializedLayoutHash: 'v1-materialized',
  assetManifestHash: 'v1-assets',
});

const validationChecks = Object.freeze({
  assets: true,
  materialization: true,
  overlay: true,
  presentation: true,
  progression: true,
  returnRoutes: true,
  seams: true,
  structuralFrames: true,
  traversal: true,
  verticalTransfers: true,
});

function validCompilerReceipt(overrides = {}) {
  return createAuthoredV4ArtifactCompilerReceipt({
    artifactIdentity,
    compilationRuns: [
      { artifactHash: artifactIdentity.artifactHash, byteHash: 'sha256-identical-bytes' },
      { artifactHash: artifactIdentity.artifactHash, byteHash: 'sha256-identical-bytes' },
    ],
    deterministicOutput: true,
    validationReceipt: {
      accepted: true,
      checks: validationChecks,
      composition: INDUSTRIAL_V4_AUTHORED_COMPOSITION,
      errors: [],
      warnings: [],
    },
    inventory: {
      assetCount: 2,
      runtimeStateIdCount: 85,
      allAssetsDeclared: true,
      allRuntimeStateIdsDeclared: true,
      assetManifestHashCovered: true,
      runtimeStateManifestHashCovered: true,
    },
    ...overrides,
  });
}

function validStarts(count = 100) {
  return Array.from({ length: count }, (_, ordinal) => ({
    ordinal,
    coldStart: true,
    status: 'applied',
    plannerWorkerCreated: false,
    geometryHash: artifactIdentity.materializedLayoutHash,
    contentHash: artifactIdentity.effectiveLayoutHash,
    requestedLayoutSeed: `layout:request-${ordinal % 7}`,
    resolvedLayoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  }));
}

function validReliabilityReceipt(overrides = {}) {
  return createAuthoredV4ReliabilityReceipt({
    artifactIdentity,
    starts: validStarts(),
    gameplayTuningIsolationAccepted: true,
    unapprovedGeometryMutationCount: 0,
    ...overrides,
  });
}

function validAssetDecodeReceipt(overrides = {}) {
  return createAuthoredV4AssetDecodeReceipt({
    artifactIdentity,
    declaredAssetCount: 2,
    completionAware: true,
    complete: true,
    cancelled: false,
    assets: [
      {
        id: 'texture:one',
        contentHash: 'sha256-one',
        fetched: true,
        decoded: true,
        error: null,
      },
      {
        id: 'texture:two',
        contentHash: 'sha256-two',
        fetched: true,
        decoded: true,
        error: null,
      },
    ],
    ...overrides,
  });
}

function validPinnedRuntimeReceipt(assetDecodeReceipt, overrides = {}) {
  return createAuthoredV4PinnedRuntimeReceipt({
    artifactIdentity,
    assetDecodeReceiptHash: assetDecodeReceipt.receiptHash,
    pinnedHardware: true,
    hardware: {
      machineId: 'pinned-industrial-v4-01',
      cpu: 'Pinned CPU',
      gpu: 'Pinned GPU',
      operatingSystem: 'Pinned OS',
      browser: 'Pinned Browser',
    },
    measurements: {
      artifactVerificationAndPreparationP95Ms:
        AUTHORED_V4_RELEASE_LIMITS.artifactVerificationAndPreparationP95Ms,
      mainThreadAssemblyAndActivationMaximumMs:
        AUTHORED_V4_RELEASE_LIMITS.mainThreadAssemblyAndActivationMaximumMs,
      coldFirstPlayableP95Ms: AUTHORED_V4_RELEASE_LIMITS.coldFirstPlayableP95Ms,
      coldFirstPlayableMaximumMs: AUTHORED_V4_RELEASE_LIMITS.coldFirstPlayableMaximumMs,
    },
    workload: {
      durationMs: AUTHORED_V4_RELEASE_LIMITS.minimumRuntimeWorkloadMs,
      stableFrameSampling: true,
      boundedMemory: true,
      longTaskObservationSupported: true,
      completeTeardown: true,
    },
    browserVisualJourneyAccepted: true,
    ...overrides,
  });
}

function validEvidence({ offlinePlannerDiagnostics = null } = {}) {
  const artifactCompilerReceipt = validCompilerReceipt();
  const reliabilityReceipt = validReliabilityReceipt();
  const assetDecodeReceipt = validAssetDecodeReceipt();
  const pinnedRuntimeReceipt = validPinnedRuntimeReceipt(assetDecodeReceipt);
  return createAuthoredV4ReleaseEvidence({
    artifactIdentity,
    artifactCompilerReceipt,
    reliabilityReceipt,
    assetDecodeReceipt,
    pinnedRuntimeReceipt,
    offlinePlannerDiagnostics,
  });
}

test('authored V4 release evidence is the four-receipt artifact contract, not a seed corpus', () => {
  const evidence = validEvidence();
  const evaluation = evaluateAuthoredV4ReleaseEvidence(evidence);

  assert.equal(evaluation.accepted, true);
  assert.deepEqual(evidence.requiredReceiptIds, AUTHORED_V4_RELEASE_RECEIPT_IDS);
  assert.equal(evidence.generationMode, 'authored-artifact');
  assert.equal(Object.hasOwn(evidence, 'canonicalGate'), false);
  assert.equal(Object.hasOwn(evidence, 'corpusAggregate'), false);
  assert.equal(Object.hasOwn(evidence, 'seedCorpus'), false);
});

test('compiler evidence requires repeated byte/hash identity and the complete authored validator set', () => {
  const byteDrift = validCompilerReceipt({
    compilationRuns: [
      { artifactHash: artifactIdentity.artifactHash, byteHash: 'sha256-first' },
      { artifactHash: artifactIdentity.artifactHash, byteHash: 'sha256-second' },
    ],
  });
  const byteDriftEvaluation = evaluateAuthoredV4ArtifactCompilerReceipt(byteDrift);
  assert.equal(byteDriftEvaluation.accepted, false);
  assert.ok(byteDriftEvaluation.failedChecks.includes('byteIdentical'));

  const warning = validCompilerReceipt({
    validationReceipt: {
      accepted: true,
      checks: validationChecks,
      composition: INDUSTRIAL_V4_AUTHORED_COMPOSITION,
      errors: [],
      warnings: [{ code: 'unapproved-warning' }],
    },
  });
  assert.equal(evaluateAuthoredV4ArtifactCompilerReceipt(warning).accepted, false);

  const approvedWarning = validCompilerReceipt({
    approvedWarningCodes: ['reviewed-presentation-note'],
    validationReceipt: {
      accepted: true,
      checks: validationChecks,
      composition: INDUSTRIAL_V4_AUTHORED_COMPOSITION,
      errors: [],
      warnings: [{ code: 'reviewed-presentation-note' }],
    },
  });
  assert.equal(evaluateAuthoredV4ArtifactCompilerReceipt(approvedWarning).accepted, true);
});

test('the reliability receipt requires 100 consecutive worker-free starts across requested seeds', () => {
  const tooShort = validReliabilityReceipt({ starts: validStarts(99) });
  assert.ok(
    evaluateAuthoredV4ReliabilityReceipt(tooShort).failedChecks.includes('minimumColdStarts'),
  );

  const workerStarts = validStarts();
  workerStarts[42].plannerWorkerCreated = true;
  const workerCreated = validReliabilityReceipt({ starts: workerStarts });
  assert.ok(
    evaluateAuthoredV4ReliabilityReceipt(workerCreated).failedChecks.includes('noPlannerWorker'),
  );

  const geometryDriftStarts = validStarts();
  geometryDriftStarts[73].geometryHash = 'v1-seed-dependent-geometry';
  const geometryDrift = validReliabilityReceipt({ starts: geometryDriftStarts });
  assert.ok(
    evaluateAuthoredV4ReliabilityReceipt(geometryDrift).failedChecks
      .includes('identicalGeometry'),
  );
});

test('asset and pinned-runtime receipts fail closed on incomplete decode, budgets, or teardown', () => {
  const incompleteAsset = validAssetDecodeReceipt({
    assets: [
      {
        id: 'texture:one',
        contentHash: 'sha256-one',
        fetched: true,
        decoded: true,
        error: null,
      },
      {
        id: 'texture:two',
        contentHash: 'sha256-two',
        fetched: true,
        decoded: false,
        error: null,
      },
    ],
  });
  assert.ok(
    evaluateAuthoredV4AssetDecodeReceipt(incompleteAsset).failedChecks.includes('decodeComplete'),
  );

  const assetDecodeReceipt = validAssetDecodeReceipt();
  const slowRuntime = validPinnedRuntimeReceipt(assetDecodeReceipt, {
    measurements: {
      artifactVerificationAndPreparationP95Ms: 100.01,
      mainThreadAssemblyAndActivationMaximumMs: 8.01,
      coldFirstPlayableP95Ms: 2_000.01,
      coldFirstPlayableMaximumMs: 3_000.01,
    },
    workload: {
      durationMs: 60_000,
      stableFrameSampling: true,
      boundedMemory: true,
      longTaskObservationSupported: true,
      completeTeardown: false,
    },
  });
  const runtimeEvaluation = evaluateAuthoredV4PinnedRuntimeReceipt(slowRuntime);
  assert.equal(runtimeEvaluation.accepted, false);
  assert.ok(runtimeEvaluation.failedChecks.includes('artifactPreparationP95'));
  assert.ok(runtimeEvaluation.failedChecks.includes('assemblyActivationMaximum'));
  assert.ok(runtimeEvaluation.failedChecks.includes('coldFirstPlayableP95'));
  assert.ok(runtimeEvaluation.failedChecks.includes('coldFirstPlayableMaximum'));
  assert.ok(runtimeEvaluation.failedChecks.includes('completeTeardown'));
});

test('offline procedural-planner diagnostics remain sealed but cannot block authored release', () => {
  const evidence = validEvidence({
    offlinePlannerDiagnostics: {
      accepted: false,
      status: 'timed-out',
      seedCount: 0,
      errors: ['planner intentionally unavailable'],
    },
  });
  const evaluation = evaluateAuthoredV4ReleaseEvidence(evidence);

  assert.equal(evaluation.accepted, true);
  assert.deepEqual(evaluation.offlinePlannerDiagnostics, {
    present: true,
    releaseBlocking: false,
  });
});

test('tampering and legacy seeded-corpus fields invalidate an otherwise accepted attestation', () => {
  const evidence = structuredClone(validEvidence());
  evidence.seedCorpus = { accepted: true, seedCount: 1_000 };
  const evaluation = evaluateAuthoredV4ReleaseEvidence(evidence);

  assert.equal(evaluation.accepted, false);
  assert.ok(evaluation.failedChecks.includes('seal'));
  assert.ok(evaluation.failedChecks.includes('noLegacySeededCorpusEvidence'));
  assert.equal(
    evaluation.diagnostics[0].code,
    'legacy-seeded-release-evidence-forbidden',
  );
});
