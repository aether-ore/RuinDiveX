import {
  cloneDungeonAugmentationValue,
  deepFreezeDungeonAugmentationValue,
  hashCanonicalValue,
} from '../canonical.js';
import {
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
  INDUSTRIAL_V4_AUTHORED_COMPOSITION,
  INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
  INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
  INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
} from './AuthoredArtifactCompiler.js';

export const DUNGEON_AUGMENTATION_AUTHORED_COMPILER_RECEIPT_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-compiler-receipt/v1';
export const DUNGEON_AUGMENTATION_AUTHORED_RELIABILITY_RECEIPT_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-reliability-receipt/v1';
export const DUNGEON_AUGMENTATION_AUTHORED_ASSET_DECODE_RECEIPT_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-asset-decode-receipt/v1';
export const DUNGEON_AUGMENTATION_AUTHORED_PINNED_RUNTIME_RECEIPT_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-pinned-runtime-receipt/v1';
export const DUNGEON_AUGMENTATION_AUTHORED_RELEASE_EVIDENCE_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-release-evidence/v1';

export const AUTHORED_V4_RELEASE_RECEIPT_IDS = Object.freeze([
  'artifactCompiler',
  'reliability100Start',
  'assetDecode',
  'pinnedHardwareRuntime',
]);

export const AUTHORED_V4_RELEASE_LIMITS = deepFreezeDungeonAugmentationValue({
  minimumCompilerRuns: 2,
  minimumConsecutiveColdStarts: 100,
  artifactVerificationAndPreparationP95Ms: 100,
  mainThreadAssemblyAndActivationMaximumMs: 8,
  coldFirstPlayableP95Ms: 2_000,
  coldFirstPlayableMaximumMs: 3_000,
  minimumRuntimeWorkloadMs: 60_000,
});

const ARTIFACT_HASH_FIELDS = Object.freeze([
  'artifactHash',
  'sourceContentHash',
  'baseGeometryHash',
  'overlayPlanHash',
  'effectiveLayoutHash',
  'materializedLayoutHash',
  'assetManifestHash',
]);
const VALIDATION_CHECK_IDS = Object.freeze([
  'assets',
  'materialization',
  'overlay',
  'presentation',
  'progression',
  'returnRoutes',
  'seams',
  'structuralFrames',
  'traversal',
  'verticalTransfers',
]);
const LEGACY_SEEDED_EVIDENCE_FIELDS = Object.freeze([
  'canonicalGate',
  'corpus',
  'corpusAggregate',
  'masterManifest',
  'releaseSeeds',
  'seedCorpus',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Infinity;
}

function integer(value) {
  return Number.isInteger(value) ? value : -1;
}

function clone(value) {
  return cloneDungeonAugmentationValue(value ?? null);
}

function receiptNamespace(schema) {
  return `${schema}/receipt-hash`;
}

function computeReceiptHash(receipt) {
  return hashCanonicalValue(receipt, {
    namespace: receiptNamespace(receipt?.schema ?? 'invalid'),
    omitKeys: ['receiptHash'],
  });
}

function computeEvidenceHash(evidence) {
  return hashCanonicalValue(evidence, {
    namespace: `${DUNGEON_AUGMENTATION_AUTHORED_RELEASE_EVIDENCE_SCHEMA}/evidence-hash`,
    omitKeys: ['evidenceHash'],
  });
}

function sealedReceipt(value) {
  const receipt = clone(value);
  receipt.receiptHash = computeReceiptHash(receipt);
  return deepFreezeDungeonAugmentationValue(receipt);
}

function diagnostic(code, message, details = {}) {
  return Object.freeze({ code, message, details: Object.freeze(clone(details)) });
}

function resultFromChecks(schema, checks, diagnostics = []) {
  const failedChecks = Object.entries(checks)
    .filter(([, accepted]) => accepted !== true)
    .map(([id]) => id);
  return deepFreezeDungeonAugmentationValue({
    schema,
    accepted: failedChecks.length === 0 && diagnostics.length === 0,
    checks,
    failedChecks,
    diagnostics,
  });
}

function staticArtifactIdentityChecks(identity) {
  return {
    artifactId: identity?.artifactId === INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
    artifactRevision:
      identity?.artifactRevision === INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
    profileId: identity?.profileId === INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
    profileRevision: identity?.profileRevision === INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
    gameplayTuningRevision:
      identity?.gameplayTuningRevision
        === INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
    generationMode: identity?.generationMode === INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
    canonicalLayoutSeed: identity?.canonicalLayoutSeed === INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
    hashIdentity: ARTIFACT_HASH_FIELDS.every((field) => nonEmptyString(identity?.[field])),
  };
}

function artifactIdentitiesMatch(left, right) {
  const fields = [
    'artifactId',
    'artifactRevision',
    'profileId',
    'profileRevision',
    'gameplayTuningRevision',
    'generationMode',
    'canonicalLayoutSeed',
    ...ARTIFACT_HASH_FIELDS,
  ];
  return fields.every((field) => left?.[field] === right?.[field]);
}

export function createAuthoredV4ReleaseArtifactIdentity(artifact = {}) {
  return deepFreezeDungeonAugmentationValue({
    artifactId: artifact.artifactId,
    artifactRevision: artifact.artifactRevision,
    profileId: artifact.profileId,
    profileRevision: artifact.profileRevision,
    gameplayTuningRevision: artifact.gameplayTuningRevision,
    generationMode: artifact.generationMode,
    canonicalLayoutSeed: artifact.canonicalLayoutSeed,
    ...Object.fromEntries(ARTIFACT_HASH_FIELDS.map((field) => [field, artifact[field]])),
  });
}

function compilerReceiptChecks(receipt) {
  const runs = Array.isArray(receipt?.compilationRuns) ? receipt.compilationRuns : [];
  const validation = receipt?.validationReceipt;
  const composition = validation?.composition;
  const inventory = receipt?.inventory;
  const approvedWarningCodes = Array.isArray(receipt?.approvedWarningCodes)
    ? receipt.approvedWarningCodes
    : [];
  const approvedWarnings = new Set(approvedWarningCodes);
  const checks = {
    schema: receipt?.schema === DUNGEON_AUGMENTATION_AUTHORED_COMPILER_RECEIPT_SCHEMA,
    seal: nonEmptyString(receipt?.receiptHash)
      && receipt.receiptHash === computeReceiptHash(receipt),
    ...Object.fromEntries(Object.entries(staticArtifactIdentityChecks(receipt?.artifactIdentity))
      .map(([id, accepted]) => [`identity:${id}`, accepted])),
    repeatedCompilation: runs.length >= AUTHORED_V4_RELEASE_LIMITS.minimumCompilerRuns,
    byteIdentical: runs.length >= AUTHORED_V4_RELEASE_LIMITS.minimumCompilerRuns
      && runs.every(({ byteHash }) => nonEmptyString(byteHash))
      && new Set(runs.map(({ byteHash }) => byteHash)).size === 1,
    artifactHashIdentical: runs.length >= AUTHORED_V4_RELEASE_LIMITS.minimumCompilerRuns
      && runs.every(({ artifactHash }) => (
        artifactHash === receipt?.artifactIdentity?.artifactHash
      )),
    deterministicOutput: receipt?.deterministicOutput === true,
    validationAccepted: validation?.accepted === true,
    validationErrors: Array.isArray(validation?.errors) && validation.errors.length === 0,
    approvedWarningCodes: approvedWarningCodes.every(nonEmptyString)
      && new Set(approvedWarningCodes).size === approvedWarningCodes.length,
    validationWarnings: Array.isArray(validation?.warnings)
      && validation.warnings.every(({ code }) => approvedWarnings.has(code)),
    validationChecks: VALIDATION_CHECK_IDS.every((id) => validation?.checks?.[id] === true),
    composition: Object.entries(INDUSTRIAL_V4_AUTHORED_COMPOSITION)
      .every(([field, expected]) => composition?.[field] === expected),
    assetsDeclared: integer(inventory?.assetCount) > 0
      && inventory?.allAssetsDeclared === true
      && inventory?.assetManifestHashCovered === true,
    runtimeStateIdsDeclared: integer(inventory?.runtimeStateIdCount) > 0
      && inventory?.allRuntimeStateIdsDeclared === true
      && inventory?.runtimeStateManifestHashCovered === true,
    receiptVerdict: receipt?.accepted === true,
  };
  return checks;
}

export function evaluateAuthoredV4ArtifactCompilerReceipt(receipt) {
  const checks = compilerReceiptChecks(receipt);
  return resultFromChecks(
    'ruindivex-dungeon-augmentation-authored-compiler-receipt-evaluation/v1',
    checks,
  );
}

export function createAuthoredV4ArtifactCompilerReceipt({
  artifact = null,
  artifactIdentity = artifact,
  compilationRuns = [],
  deterministicOutput = false,
  validationReceipt = artifact?.validationReceipt ?? null,
  inventory = null,
  approvedWarningCodes = [],
} = {}) {
  const resolvedInventory = inventory ?? {
    assetCount: artifact?.assetManifest?.assets?.length ?? 0,
    runtimeStateIdCount: artifact?.runtimeStateManifest?.ids?.length ?? 0,
    allAssetsDeclared: false,
    allRuntimeStateIdsDeclared: false,
    assetManifestHashCovered: false,
    runtimeStateManifestHashCovered: false,
  };
  const base = {
    schema: DUNGEON_AUGMENTATION_AUTHORED_COMPILER_RECEIPT_SCHEMA,
    kind: 'artifact-compiler',
    artifactIdentity: createAuthoredV4ReleaseArtifactIdentity(artifactIdentity ?? {}),
    compilationRuns: clone(compilationRuns),
    deterministicOutput: deterministicOutput === true,
    validationReceipt: clone(validationReceipt),
    inventory: clone(resolvedInventory),
    approvedWarningCodes: clone(approvedWarningCodes),
  };
  const provisional = sealedReceipt({ ...base, accepted: true });
  const accepted = evaluateAuthoredV4ArtifactCompilerReceipt(provisional).accepted;
  return sealedReceipt({ ...base, accepted });
}

function reliabilityReceiptChecks(receipt) {
  const starts = Array.isArray(receipt?.starts) ? receipt.starts : [];
  const identity = receipt?.artifactIdentity;
  const requestedSeeds = new Set(starts.map(({ requestedLayoutSeed }) => requestedLayoutSeed));
  const checks = {
    schema: receipt?.schema === DUNGEON_AUGMENTATION_AUTHORED_RELIABILITY_RECEIPT_SCHEMA,
    seal: nonEmptyString(receipt?.receiptHash)
      && receipt.receiptHash === computeReceiptHash(receipt),
    ...Object.fromEntries(Object.entries(staticArtifactIdentityChecks(identity))
      .map(([id, accepted]) => [`identity:${id}`, accepted])),
    minimumColdStarts:
      starts.length >= AUTHORED_V4_RELEASE_LIMITS.minimumConsecutiveColdStarts,
    contiguousOrdinals: starts.every(({ ordinal }, index) => ordinal === index),
    allCold: starts.every(({ coldStart }) => coldStart === true),
    allApplied: starts.every(({ status }) => status === 'applied'),
    noPlannerWorker: starts.every(({ plannerWorkerCreated }) => plannerWorkerCreated === false),
    identicalGeometry: starts.length > 0
      && starts.every(({ geometryHash }) => geometryHash === identity?.materializedLayoutHash),
    identicalContent: starts.length > 0
      && starts.every(({ contentHash }) => contentHash === identity?.effectiveLayoutHash),
    canonicalResolvedSeed: starts.length > 0
      && starts.every(({ resolvedLayoutSeed }) => (
        resolvedLayoutSeed === INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED
      )),
    requestedSeedDiversity: requestedSeeds.size >= 2
      && [...requestedSeeds].every(nonEmptyString),
    gameplayTuningIsolation: receipt?.gameplayTuningIsolationAccepted === true,
    noUnapprovedGeometryMutations: integer(receipt?.unapprovedGeometryMutationCount) === 0,
    receiptVerdict: receipt?.accepted === true,
  };
  return checks;
}

export function evaluateAuthoredV4ReliabilityReceipt(receipt) {
  return resultFromChecks(
    'ruindivex-dungeon-augmentation-authored-reliability-receipt-evaluation/v1',
    reliabilityReceiptChecks(receipt),
  );
}

export function createAuthoredV4ReliabilityReceipt({
  artifactIdentity,
  starts = [],
  gameplayTuningIsolationAccepted = false,
  unapprovedGeometryMutationCount = null,
} = {}) {
  const base = {
    schema: DUNGEON_AUGMENTATION_AUTHORED_RELIABILITY_RECEIPT_SCHEMA,
    kind: '100-start-reliability',
    artifactIdentity: createAuthoredV4ReleaseArtifactIdentity(artifactIdentity ?? {}),
    starts: clone(starts),
    gameplayTuningIsolationAccepted: gameplayTuningIsolationAccepted === true,
    unapprovedGeometryMutationCount,
  };
  const provisional = sealedReceipt({ ...base, accepted: true });
  const accepted = evaluateAuthoredV4ReliabilityReceipt(provisional).accepted;
  return sealedReceipt({ ...base, accepted });
}

function assetDecodeReceiptChecks(receipt) {
  const assets = Array.isArray(receipt?.assets) ? receipt.assets : [];
  const ids = assets.map(({ id }) => id);
  const checks = {
    schema: receipt?.schema === DUNGEON_AUGMENTATION_AUTHORED_ASSET_DECODE_RECEIPT_SCHEMA,
    seal: nonEmptyString(receipt?.receiptHash)
      && receipt.receiptHash === computeReceiptHash(receipt),
    ...Object.fromEntries(Object.entries(staticArtifactIdentityChecks(receipt?.artifactIdentity))
      .map(([id, accepted]) => [`identity:${id}`, accepted])),
    manifestIdentity:
      receipt?.assetManifestHash === receipt?.artifactIdentity?.assetManifestHash,
    completionAware: receipt?.completionAware === true,
    declaredAssetCount: integer(receipt?.declaredAssetCount) > 0
      && assets.length === integer(receipt?.declaredAssetCount),
    uniqueAssetIds: ids.length > 0
      && ids.every(nonEmptyString)
      && new Set(ids).size === ids.length,
    fetchComplete: assets.every(({ fetched }) => fetched === true),
    decodeComplete: assets.every(({ decoded }) => decoded === true),
    contentHashesPresent: assets.every(({ contentHash }) => nonEmptyString(contentHash)),
    noFailures: assets.every(({ error }) => error == null),
    complete: receipt?.complete === true,
    notCancelled: receipt?.cancelled === false,
    receiptVerdict: receipt?.accepted === true,
  };
  return checks;
}

export function evaluateAuthoredV4AssetDecodeReceipt(receipt) {
  return resultFromChecks(
    'ruindivex-dungeon-augmentation-authored-asset-decode-receipt-evaluation/v1',
    assetDecodeReceiptChecks(receipt),
  );
}

export function createAuthoredV4AssetDecodeReceipt({
  artifactIdentity,
  assetManifestHash = artifactIdentity?.assetManifestHash,
  declaredAssetCount = 0,
  completionAware = false,
  complete = false,
  cancelled = false,
  assets = [],
} = {}) {
  const base = {
    schema: DUNGEON_AUGMENTATION_AUTHORED_ASSET_DECODE_RECEIPT_SCHEMA,
    kind: 'asset-fetch-decode',
    artifactIdentity: createAuthoredV4ReleaseArtifactIdentity(artifactIdentity ?? {}),
    assetManifestHash,
    declaredAssetCount,
    completionAware: completionAware === true,
    complete: complete === true,
    cancelled: cancelled === true,
    assets: clone(assets),
  };
  const provisional = sealedReceipt({ ...base, accepted: true });
  const accepted = evaluateAuthoredV4AssetDecodeReceipt(provisional).accepted;
  return sealedReceipt({ ...base, accepted });
}

function pinnedRuntimeReceiptChecks(receipt) {
  const measurements = receipt?.measurements;
  const workload = receipt?.workload;
  const hardware = receipt?.hardware;
  const checks = {
    schema:
      receipt?.schema === DUNGEON_AUGMENTATION_AUTHORED_PINNED_RUNTIME_RECEIPT_SCHEMA,
    seal: nonEmptyString(receipt?.receiptHash)
      && receipt.receiptHash === computeReceiptHash(receipt),
    ...Object.fromEntries(Object.entries(staticArtifactIdentityChecks(receipt?.artifactIdentity))
      .map(([id, accepted]) => [`identity:${id}`, accepted])),
    pinnedHardware: receipt?.pinnedHardware === true,
    hardwareIdentity: [
      hardware?.machineId,
      hardware?.cpu,
      hardware?.gpu,
      hardware?.operatingSystem,
      hardware?.browser,
    ].every(nonEmptyString),
    artifactPreparationP95: finiteNumber(
      measurements?.artifactVerificationAndPreparationP95Ms,
    ) <= AUTHORED_V4_RELEASE_LIMITS.artifactVerificationAndPreparationP95Ms,
    assemblyActivationMaximum: finiteNumber(
      measurements?.mainThreadAssemblyAndActivationMaximumMs,
    ) <= AUTHORED_V4_RELEASE_LIMITS.mainThreadAssemblyAndActivationMaximumMs,
    coldFirstPlayableP95: finiteNumber(
      measurements?.coldFirstPlayableP95Ms,
    ) <= AUTHORED_V4_RELEASE_LIMITS.coldFirstPlayableP95Ms,
    coldFirstPlayableMaximum: finiteNumber(
      measurements?.coldFirstPlayableMaximumMs,
    ) <= AUTHORED_V4_RELEASE_LIMITS.coldFirstPlayableMaximumMs,
    workloadDuration: finiteNumber(workload?.durationMs)
      >= AUTHORED_V4_RELEASE_LIMITS.minimumRuntimeWorkloadMs,
    stableFrameSampling: workload?.stableFrameSampling === true,
    boundedMemory: workload?.boundedMemory === true,
    longTaskObservationSupported: workload?.longTaskObservationSupported === true,
    completeTeardown: workload?.completeTeardown === true,
    visualJourney: receipt?.browserVisualJourneyAccepted === true,
    separateAssetReceipt: nonEmptyString(receipt?.assetDecodeReceiptHash),
    receiptVerdict: receipt?.accepted === true,
  };
  return checks;
}

export function evaluateAuthoredV4PinnedRuntimeReceipt(receipt) {
  return resultFromChecks(
    'ruindivex-dungeon-augmentation-authored-pinned-runtime-receipt-evaluation/v1',
    pinnedRuntimeReceiptChecks(receipt),
  );
}

export function createAuthoredV4PinnedRuntimeReceipt({
  artifactIdentity,
  assetDecodeReceiptHash = null,
  pinnedHardware = false,
  hardware = null,
  measurements = null,
  workload = null,
  browserVisualJourneyAccepted = false,
} = {}) {
  const base = {
    schema: DUNGEON_AUGMENTATION_AUTHORED_PINNED_RUNTIME_RECEIPT_SCHEMA,
    kind: 'pinned-hardware-runtime',
    artifactIdentity: createAuthoredV4ReleaseArtifactIdentity(artifactIdentity ?? {}),
    assetDecodeReceiptHash,
    pinnedHardware: pinnedHardware === true,
    hardware: clone(hardware),
    measurements: clone(measurements),
    workload: clone(workload),
    browserVisualJourneyAccepted: browserVisualJourneyAccepted === true,
  };
  const provisional = sealedReceipt({ ...base, accepted: true });
  const accepted = evaluateAuthoredV4PinnedRuntimeReceipt(provisional).accepted;
  return sealedReceipt({ ...base, accepted });
}

export class DungeonAugmentationAuthoredReleaseEvidenceError extends Error {
  constructor(message, evaluation = null) {
    super(message);
    this.name = 'DungeonAugmentationAuthoredReleaseEvidenceError';
    this.code = 'DUNGEON_AUGMENTATION_AUTHORED_RELEASE_EVIDENCE_INVALID';
    this.evaluation = evaluation;
  }
}

export function evaluateAuthoredV4ReleaseEvidence(evidence) {
  const receipts = evidence?.receipts ?? {};
  const evaluations = {
    artifactCompiler: evaluateAuthoredV4ArtifactCompilerReceipt(receipts.artifactCompiler),
    reliability100Start: evaluateAuthoredV4ReliabilityReceipt(receipts.reliability100Start),
    assetDecode: evaluateAuthoredV4AssetDecodeReceipt(receipts.assetDecode),
    pinnedHardwareRuntime: evaluateAuthoredV4PinnedRuntimeReceipt(
      receipts.pinnedHardwareRuntime,
    ),
  };
  const receiptValues = AUTHORED_V4_RELEASE_RECEIPT_IDS.map((id) => receipts[id]);
  const legacyFields = LEGACY_SEEDED_EVIDENCE_FIELDS.filter((field) => (
    Object.hasOwn(evidence ?? {}, field)
  ));
  const checks = {
    schema: evidence?.schema === DUNGEON_AUGMENTATION_AUTHORED_RELEASE_EVIDENCE_SCHEMA,
    seal: nonEmptyString(evidence?.evidenceHash)
      && evidence.evidenceHash === computeEvidenceHash(evidence),
    generationMode: evidence?.generationMode === INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
    ...Object.fromEntries(Object.entries(staticArtifactIdentityChecks(evidence?.artifactIdentity))
      .map(([id, accepted]) => [`identity:${id}`, accepted])),
    exactRequiredReceiptIds: Array.isArray(evidence?.requiredReceiptIds)
      && evidence.requiredReceiptIds.length === AUTHORED_V4_RELEASE_RECEIPT_IDS.length
      && evidence.requiredReceiptIds.every((id, index) => (
        id === AUTHORED_V4_RELEASE_RECEIPT_IDS[index]
      )),
    requiredReceiptsAccepted: Object.values(evaluations).every(({ accepted }) => accepted),
    sameArtifactIdentity: receiptValues.every((receipt) => (
      artifactIdentitiesMatch(evidence?.artifactIdentity, receipt?.artifactIdentity)
    )),
    compilerAssetInventoryMatchesDecode: integer(
      receipts.artifactCompiler?.inventory?.assetCount,
    ) === integer(receipts.assetDecode?.declaredAssetCount),
    runtimeBindsAssetDecodeReceipt:
      receipts.pinnedHardwareRuntime?.assetDecodeReceiptHash
        === receipts.assetDecode?.receiptHash,
    noLegacySeededCorpusEvidence: legacyFields.length === 0,
    releaseVerdict: evidence?.releaseAccepted === true,
  };
  const diagnostics = legacyFields.length > 0
    ? [diagnostic(
      'legacy-seeded-release-evidence-forbidden',
      'Authored V4 release evidence cannot use canonical or seed-corpus gates.',
      { fields: legacyFields },
    )]
    : [];
  const result = resultFromChecks(
    'ruindivex-dungeon-augmentation-authored-release-evidence-evaluation/v1',
    checks,
    diagnostics,
  );
  return deepFreezeDungeonAugmentationValue({
    ...result,
    receiptEvaluations: evaluations,
    offlinePlannerDiagnostics: {
      present: evidence?.offlinePlannerDiagnostics != null,
      releaseBlocking: false,
    },
  });
}

export function assertAuthoredV4ReleaseEvidence(evidence) {
  const evaluation = evaluateAuthoredV4ReleaseEvidence(evidence);
  if (!evaluation.accepted) {
    throw new DungeonAugmentationAuthoredReleaseEvidenceError(
      `Authored V4 release evidence failed: ${evaluation.failedChecks.join(', ')}.`,
      evaluation,
    );
  }
  return evidence;
}

export function createAuthoredV4ReleaseEvidence({
  artifactIdentity,
  artifactCompilerReceipt,
  reliabilityReceipt,
  assetDecodeReceipt,
  pinnedRuntimeReceipt,
  offlinePlannerDiagnostics = null,
} = {}) {
  const base = {
    schema: DUNGEON_AUGMENTATION_AUTHORED_RELEASE_EVIDENCE_SCHEMA,
    generationMode: INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
    artifactIdentity: createAuthoredV4ReleaseArtifactIdentity(artifactIdentity ?? {}),
    requiredReceiptIds: [...AUTHORED_V4_RELEASE_RECEIPT_IDS],
    receipts: {
      artifactCompiler: clone(artifactCompilerReceipt),
      reliability100Start: clone(reliabilityReceipt),
      assetDecode: clone(assetDecodeReceipt),
      pinnedHardwareRuntime: clone(pinnedRuntimeReceipt),
    },
    offlinePlannerDiagnostics: clone(offlinePlannerDiagnostics),
    releaseAccepted: true,
  };
  const evidence = clone(base);
  evidence.evidenceHash = computeEvidenceHash(evidence);
  const frozen = deepFreezeDungeonAugmentationValue(evidence);
  return assertAuthoredV4ReleaseEvidence(frozen);
}

export const verifyAuthoredV4ReleaseEvidence = evaluateAuthoredV4ReleaseEvidence;
