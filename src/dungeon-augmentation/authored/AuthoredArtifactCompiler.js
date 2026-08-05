import {
  canonicalStringify,
  cloneDungeonAugmentationValue,
  deepFreezeDungeonAugmentationValue,
  hashCanonicalValue,
} from '../canonical.js';
import {
  computeDungeonAugmentationPlanHash,
  computeEffectiveDungeonPlanHash,
} from '../validation.js';
import { collectDungeonAugmentationStableStateIds } from '../identity.js';

export const DUNGEON_AUGMENTATION_AUTHORED_SOURCE_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-source/v1';
export const DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-artifact/v1';
export const DUNGEON_AUGMENTATION_AUTHORED_VALIDATION_RECEIPT_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-validation-receipt/v1';
export const DUNGEON_AUGMENTATION_AUTHORED_ASSET_MANIFEST_SCHEMA =
  'ruindivex-dungeon-augmentation-asset-manifest/v1';
export const DUNGEON_AUGMENTATION_AUTHORED_BASE_DESCRIPTOR_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-base-descriptor/v1';

export const INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID = 'industrial-v4-authored-r1';
export const INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION = 1;
export const INDUSTRIAL_V4_AUTHORED_PROFILE_ID = 'industrial-supplement-preview-v4';
export const INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION = 6;
export const INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION = 1;
export const INDUSTRIAL_V4_AUTHORED_GENERATION_MODE = 'authored-artifact';
export const INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED = 'layout:industrial-v4-authored-r1';
export const INDUSTRIAL_V4_AUTHORED_TRUSTED_PAYLOAD_VERIFICATION_MODE =
  'sealed-bundled-payload';

export const INDUSTRIAL_V4_AUTHORED_COMPOSITION = deepFreezeDungeonAugmentationValue({
  operationCount: 5,
  nodeCount: 24,
  segmentCount: 26,
  pyramidLoopCount: 1,
  objectiveCoverageNetworkCount: 4,
});

const ARTIFACT_HASH_OMIT_KEYS = Object.freeze(['artifactHash']);
const trustedBundledArtifacts = new WeakSet();
const SOURCE_HASH_OMIT_KEYS = Object.freeze([
  'artifactHash',
  'sourceContentHash',
  'baseGeometryHash',
  'baseDraftDescriptorHash',
  'canonicalBaseRandomTapeHash',
  'overlayPlanHash',
  'effectiveLayoutHash',
  'materializedLayoutHash',
  'materializedLayoutDescriptorHash',
  'renderBatchManifestHash',
  'runtimeStateManifestHash',
  'assetManifestHash',
]);
const REQUIRED_VALIDATION_CHECKS = Object.freeze([
  'overlay',
  'materialization',
  'progression',
  'traversal',
  'presentation',
  'seams',
  'structuralFrames',
  'verticalTransfers',
  'returnRoutes',
  'assets',
]);
const FORBIDDEN_PROCEDURAL_PLAN_FIELDS = Object.freeze([
  'completionMode',
  'prunedRouteNetworkGrants',
  'routeNetworkEntityOmissions',
  'routeNetworkPruningOverrides',
  'routeNetworkConflictExclusions',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0;
}

function stableHash(value) {
  return typeof value === 'string' && /^v1-[0-9a-f]{32}$/u.test(value);
}

function sha256Hash(value) {
  return typeof value === 'string' && /^sha256-[0-9a-f]{64}$/u.test(value);
}

function sortRecordsById(records = []) {
  return [...records].sort((left, right) => String(left?.id ?? left?.uri ?? '')
    .localeCompare(String(right?.id ?? right?.uri ?? '')));
}

function provenance(sourceContentHash) {
  return {
    kind: INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
    artifactId: INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
    artifactRevision: INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
    sourceContentHash,
  };
}

function withAuthoredProvenance(record, sourceContentHash) {
  return {
    ...record,
    placementProvenance: provenance(sourceContentHash),
  };
}

function validateAuthoredProvenance(overlayPlan, sourceContentHash, errors) {
  for (const record of [
    overlayPlan,
    ...(overlayPlan?.operations ?? []),
    ...(overlayPlan?.nodes ?? []),
    ...(overlayPlan?.segments ?? []),
  ]) {
    const recordProvenance = record?.placementProvenance;
    if (recordProvenance?.kind !== INDUSTRIAL_V4_AUTHORED_GENERATION_MODE
      || recordProvenance?.artifactId !== INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID
      || Number(recordProvenance?.artifactRevision)
        !== INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION
      || recordProvenance?.sourceContentHash !== sourceContentHash) {
      errors.push(diagnostic(
        'authored-artifact-provenance-mismatch',
        `Authored placement provenance is invalid for ${record?.id ?? 'overlay'}.`,
        { id: record?.id ?? null },
      ));
    }
  }
}

function diagnostic(code, message, details = {}) {
  return { code, message, details };
}

export class DungeonAugmentationAuthoredArtifactError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DungeonAugmentationAuthoredArtifactError';
    this.code = code;
    this.details = details;
  }
}

function throwCompilationError(errors) {
  throw new DungeonAugmentationAuthoredArtifactError(
    'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_INVALID',
    errors.map((entry) => String(entry?.message ?? entry?.code ?? entry)).join(' '),
    { errors },
  );
}

function validateIdentity(source, errors) {
  const expected = {
    schema: DUNGEON_AUGMENTATION_AUTHORED_SOURCE_SCHEMA,
    artifactId: INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
    artifactRevision: INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
    profileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
    profileRevision: INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
    gameplayTuningRevision: INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
    generationMode: INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
    canonicalLayoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (source?.[field] !== expectedValue) {
      errors.push(diagnostic(
        'authored-source-identity-mismatch',
        `Authored source ${field} must equal ${JSON.stringify(expectedValue)}.`,
        { field, expected: expectedValue, actual: source?.[field] ?? null },
      ));
    }
  }
}

function validateUniqueIds(records, kind, errors) {
  const ids = new Set();
  for (const record of records) {
    if (!nonEmptyString(record?.id)) {
      errors.push(diagnostic(
        'authored-source-id-missing',
        `Every authored ${kind} must have an ID.`,
        { kind },
      ));
      continue;
    }
    if (ids.has(record.id)) {
      errors.push(diagnostic(
        'authored-source-id-duplicated',
        `Authored ${kind} ID ${record.id} is duplicated.`,
        { kind, id: record.id },
      ));
    }
    ids.add(record.id);
  }
}

function inspectComposition(overlayPlan, errors) {
  const operations = Array.isArray(overlayPlan?.operations) ? overlayPlan.operations : [];
  const nodes = Array.isArray(overlayPlan?.nodes) ? overlayPlan.nodes : [];
  const segments = Array.isArray(overlayPlan?.segments) ? overlayPlan.segments : [];
  const pyramidLoopCount = operations.filter(({ routeNetworkKind }) => (
    routeNetworkKind === 'landmark-perimeter-loop'
  )).length;
  const objectiveCoverageNetworkCount = operations.filter(({ routeNetworkKind }) => (
    routeNetworkKind === 'objective-route-coverage'
  )).length;
  const actual = {
    operationCount: operations.length,
    nodeCount: nodes.length,
    segmentCount: segments.length,
    pyramidLoopCount,
    objectiveCoverageNetworkCount,
  };
  for (const [field, expected] of Object.entries(INDUSTRIAL_V4_AUTHORED_COMPOSITION)) {
    if (actual[field] !== expected) {
      errors.push(diagnostic(
        'authored-source-composition-mismatch',
        `Authored V4 ${field} must equal ${expected}; received ${actual[field]}.`,
        { field, expected, actual: actual[field] },
      ));
    }
  }
  validateUniqueIds(operations, 'operation', errors);
  validateUniqueIds(nodes, 'node', errors);
  validateUniqueIds(segments, 'segment', errors);
  for (const field of FORBIDDEN_PROCEDURAL_PLAN_FIELDS) {
    if (Object.hasOwn(overlayPlan ?? {}, field)) {
      errors.push(diagnostic(
        'authored-source-procedural-evidence-forbidden',
        `Authored V4 overlay cannot carry procedural ${field} evidence.`,
        { field },
      ));
    }
  }
  for (const operation of operations) {
    if (Object.hasOwn(operation ?? {}, 'selectionManifest')) {
      errors.push(diagnostic(
        'authored-source-selection-manifest-forbidden',
        `Authored operation ${operation.id ?? '(unnamed)'} cannot carry a selection manifest.`,
        { operationId: operation.id ?? null },
      ));
    }
  }
  return actual;
}

function validateMaterializedLayout(layout, errors) {
  if (!isRecord(layout)) {
    errors.push(diagnostic(
      'authored-materialized-layout-missing',
      'Authored V4 must include a pre-materialized layout.',
    ));
    return;
  }
  for (const field of [
    'rooms',
    'connectionPlans',
    'connectorJunctionProxies',
    'supplementalRoomIds',
    'supplementalConnectorJunctionIds',
    'supplementalConnectionIds',
    'supplementalPhysicalConnectionIds',
    'supplementalGraphOnlyConnectionIds',
  ]) {
    if (!Array.isArray(layout[field])) {
      errors.push(diagnostic(
        'authored-materialized-layout-field-invalid',
        `Authored materializedLayout.${field} must be an array.`,
        { field },
      ));
    }
  }
  const compactDescriptors = layout.recordMode === 'compact-descriptors';
  const fullRecords = layout.recordMode === 'full-records';
  if (!isRecord(layout.assemblyOverlayPlan)
    && !((compactDescriptors || fullRecords) && isRecord(layout.assemblyOverlayPlanRef))) {
    errors.push(diagnostic(
      'authored-materialized-assembly-plan-missing',
      'Authored materializedLayout must include an assembly overlay or a compact overlay reference.',
    ));
  }
  if (compactDescriptors) {
    for (const [kind, records] of [
      ['room', layout.rooms],
      ['connection', layout.connectionPlans],
      ['connector-junction', layout.connectorJunctionProxies],
    ]) {
      for (const record of records ?? []) {
        if (!nonEmptyString(record?.recordHash) || record?.kind !== kind) {
          errors.push(diagnostic(
            'authored-materialized-descriptor-invalid',
            `Every compact ${kind} descriptor must carry its kind and record hash.`,
            { kind, id: record?.id ?? null },
          ));
        }
      }
    }
  }
  if (fullRecords) {
    validateUniqueIds(layout.rooms, 'materialized room', errors);
    validateUniqueIds(layout.connectionPlans, 'materialized connection', errors);
    validateUniqueIds(layout.connectorJunctionProxies, 'materialized junction', errors);
  }
  if (layout?.diagnostics?.accepted !== true) {
    errors.push(diagnostic(
      'authored-materialization-not-accepted',
      'Authored materializedLayout diagnostics must be accepted.',
      { diagnostics: layout?.diagnostics ?? null },
    ));
  }
}

function validateMaterializedDescriptorParity(descriptors, layout, errors, {
  verifyRecordHashes = true,
} = {}) {
  if (descriptors?.recordMode !== 'compact-descriptors'
    || layout?.recordMode !== 'full-records') {
    errors.push(diagnostic(
      'authored-materialized-record-mode-invalid',
      'Authored V4 must seal full runtime records and separate compact descriptors.',
    ));
    return;
  }
  for (const [field, kind] of [
    ['rooms', 'room'],
    ['connectionPlans', 'connection'],
    ['connectorJunctionProxies', 'connector-junction'],
  ]) {
    const descriptorRecords = descriptors[field] ?? [];
    const fullRecords = layout[field] ?? [];
    const descriptorById = new Map(descriptorRecords.map((record) => [String(record.id), record]));
    if (descriptorRecords.length !== fullRecords.length
      || descriptorById.size !== descriptorRecords.length) {
      errors.push(diagnostic(
        'authored-materialized-descriptor-count-mismatch',
        `Authored ${field} descriptors do not match the full runtime records.`,
        { field, descriptorCount: descriptorRecords.length, recordCount: fullRecords.length },
      ));
      continue;
    }
    for (const record of fullRecords) {
      const descriptor = descriptorById.get(String(record?.id ?? ''));
      const descriptorInvalid = descriptor?.kind !== kind
        || !stableHash(descriptor?.recordHash);
      const recordHash = verifyRecordHashes
        ? hashCanonicalValue(record, {
            namespace: `ruindivex-industrial-v4-authored-${kind}-record/v1`,
          })
        : descriptor?.recordHash;
      if (descriptorInvalid || descriptor?.recordHash !== recordHash) {
        errors.push(diagnostic(
          'authored-materialized-descriptor-record-mismatch',
          `Authored ${kind} ${record?.id ?? '(unnamed)'} does not match its descriptor.`,
          { field, id: record?.id ?? null, expected: descriptor?.recordHash ?? null, actual: recordHash },
        ));
      }
    }
  }
  for (const field of [
    'supplementalRoomIds',
    'supplementalConnectorJunctionIds',
    'supplementalConnectionIds',
    'supplementalPhysicalConnectionIds',
    'supplementalGraphOnlyConnectionIds',
  ]) {
    if (canonicalStringify(descriptors?.[field] ?? [])
      !== canonicalStringify(layout?.[field] ?? [])) {
      errors.push(diagnostic(
        'authored-materialized-descriptor-id-set-mismatch',
        `Authored ${field} differs between full records and descriptors.`,
        { field },
      ));
    }
  }
  if (canonicalStringify(descriptors?.diagnostics?.routeNetworks ?? [])
    !== canonicalStringify(layout?.diagnostics?.routeNetworks ?? [])) {
    errors.push(diagnostic(
      'authored-materialized-descriptor-route-network-mismatch',
      'Authored route-network diagnostics differ between full records and descriptors.',
    ));
  }
}

const CANONICAL_BASE_COLLECTION_FIELDS = Object.freeze([
  'occupiedVolumes',
  'connectionOccupiedVolumes',
  'connectionClearanceVolumes',
  'connectionLandingVolumes',
  'protectedVolumes',
]);

function createCanonicalBaseRecordDescriptor(record, kind) {
  const common = {
    id: String(record?.id ?? ''),
    kind,
    recordHash: hashCanonicalValue(record, {
      namespace: `ruindivex-industrial-v4-authored-base-${kind}/v1`,
    }),
  };
  if (kind === 'room') {
    return {
      ...common,
      type: record?.type ?? null,
      archetypeId: record?.archetypeId ?? null,
      progressionBand: Number(record?.progressionBand ?? 0),
      gridPosition: cloneDungeonAugmentationValue(record?.gridPosition ?? null),
      widthTiles: Number(record?.widthTiles ?? 0),
      depthTiles: Number(record?.depthTiles ?? 0),
      socketIds: (record?.sockets ?? []).map(({ id }) => String(id)).sort(),
    };
  }
  return {
    ...common,
    logicalConnectionId: record?.logicalConnectionId ?? null,
    fromRoomId: record?.fromRoomId ?? null,
    toRoomId: record?.toRoomId ?? null,
    connectorFamily: record?.connectorFamily ?? null,
    connectorVariantId: record?.connectorVariantId ?? null,
    pathPointCount: Array.isArray(record?.path) ? record.path.length : 0,
  };
}

function createCanonicalBaseDraftDescriptor(draft, baseGeometryHash) {
  const rooms = sortRecordsById(draft?.rooms ?? []).map((record) => (
    createCanonicalBaseRecordDescriptor(record, 'room')
  ));
  const connectionPlans = sortRecordsById(draft?.connectionPlans ?? []).map((record) => (
    createCanonicalBaseRecordDescriptor(record, 'connection')
  ));
  const collections = Object.fromEntries(CANONICAL_BASE_COLLECTION_FIELDS.map((field) => {
    const records = Array.isArray(draft?.[field]) ? draft[field] : [];
    return [field, {
      count: records.length,
      collectionHash: hashCanonicalValue(records, {
        namespace: `ruindivex-industrial-v4-authored-base-${field}/v1`,
      }),
    }];
  }));
  return {
    schema: DUNGEON_AUGMENTATION_AUTHORED_BASE_DESCRIPTOR_SCHEMA,
    recordMode: 'compact-descriptors',
    sourceSchema: draft?.schema ?? null,
    baseGeometryHash,
    basePlanHash: baseGeometryHash,
    planHash: baseGeometryHash,
    tileSize: Number(draft?.tileSize ?? 0),
    difficulty: Number(draft?.difficulty ?? 1),
    counts: {
      rooms: rooms.length,
      connectionPlans: connectionPlans.length,
      ...Object.fromEntries(Object.entries(collections).map(([field, descriptor]) => (
        [field, descriptor.count]
      ))),
    },
    rooms,
    connectionPlans,
    collections,
  };
}

function validateCanonicalBaseDraftDescriptor(descriptor, errors, {
  expectedBaseGeometryHash = null,
} = {}) {
  if (descriptor?.schema !== DUNGEON_AUGMENTATION_AUTHORED_BASE_DESCRIPTOR_SCHEMA
    || descriptor?.recordMode !== 'compact-descriptors'
    || !Array.isArray(descriptor?.rooms)
    || !Array.isArray(descriptor?.connectionPlans)
    || !isRecord(descriptor?.collections)) {
    errors.push(diagnostic(
      'authored-base-descriptor-invalid',
      'Authored V4 artifact must carry compact canonical-base descriptors.',
    ));
    return;
  }
  if (expectedBaseGeometryHash != null
    && (descriptor.baseGeometryHash !== expectedBaseGeometryHash
      || descriptor.basePlanHash !== expectedBaseGeometryHash
      || descriptor.planHash !== expectedBaseGeometryHash)) {
    errors.push(diagnostic(
      'authored-base-descriptor-geometry-hash-mismatch',
      'Canonical-base descriptors reference a different base geometry hash.',
    ));
  }
  validateUniqueIds(descriptor.rooms, 'base-room descriptor', errors);
  validateUniqueIds(descriptor.connectionPlans, 'base-connection descriptor', errors);
  for (const [kind, records] of [
    ['room', descriptor.rooms],
    ['connection', descriptor.connectionPlans],
  ]) {
    for (const record of records) {
      if (record?.kind !== kind || !stableHash(record?.recordHash)) {
        errors.push(diagnostic(
          'authored-base-record-descriptor-invalid',
          `Every canonical base ${kind} descriptor must carry its kind and record hash.`,
          { kind, id: record?.id ?? null },
        ));
      }
    }
  }
  if (Number(descriptor?.counts?.rooms) !== descriptor.rooms.length
    || Number(descriptor?.counts?.connectionPlans) !== descriptor.connectionPlans.length) {
    errors.push(diagnostic(
      'authored-base-descriptor-count-mismatch',
      'Canonical-base room or connection descriptor counts do not match.',
    ));
  }
  for (const field of CANONICAL_BASE_COLLECTION_FIELDS) {
    const collection = descriptor.collections[field];
    if (!isRecord(collection)
      || !nonNegativeInteger(collection.count)
      || Number(descriptor?.counts?.[field]) !== Number(collection.count)
      || !stableHash(collection.collectionHash)) {
      errors.push(diagnostic(
        'authored-base-collection-descriptor-invalid',
        `Canonical-base ${field} descriptor is invalid.`,
        { field },
      ));
    }
  }
}

function validateCanonicalRandomTape(randomTape, errors) {
  if (!Array.isArray(randomTape) || randomTape.length === 0
    || randomTape.some((value) => (
      !Number.isFinite(Number(value))
        || Number(value) < 0
        || Number(value) >= 1
    ))) {
    errors.push(diagnostic(
      'authored-base-random-tape-invalid',
      'Authored V4 must include a non-empty canonical base random tape in [0, 1).',
    ));
  }
}

function canonicalRandomTapeHash(randomTape) {
  return hashCanonicalValue(randomTape, {
    namespace: 'ruindivex-industrial-v4-authored-base-random-tape/v1',
  });
}

function runtimeStateManifestPayload(manifest) {
  return {
    schema: 'ruindivex-dungeon-augmentation-runtime-state-manifest/v1',
    ids: [...(manifest?.ids ?? [])].map(String).sort(),
  };
}

function sealRuntimeStateManifest(manifest) {
  const payload = runtimeStateManifestPayload(manifest);
  return {
    ...payload,
    count: payload.ids.length,
    contentHash: hashCanonicalValue(payload, {
      namespace: 'ruindivex-industrial-v4-authored-runtime-state-manifest/v1',
    }),
  };
}

function validateRuntimeStateManifest(manifest, errors) {
  if (manifest?.schema !== 'ruindivex-dungeon-augmentation-runtime-state-manifest/v1'
    || !Array.isArray(manifest?.ids)
    || manifest.ids.length === 0) {
    errors.push(diagnostic(
      'authored-runtime-state-manifest-invalid',
      'Authored V4 must declare every stable runtime-state ID.',
    ));
    return;
  }
  const ids = manifest.ids.map(String);
  if (ids.some((id) => id.length === 0) || new Set(ids).size !== ids.length) {
    errors.push(diagnostic(
      'authored-runtime-state-manifest-duplicated',
      'Authored runtime-state IDs must be non-empty and unique.',
    ));
  }
  if (ids.some((id, index) => index > 0 && ids[index - 1].localeCompare(id) > 0)) {
    errors.push(diagnostic(
      'authored-runtime-state-manifest-not-canonical',
      'Authored runtime-state IDs must use canonical lexical order.',
    ));
  }
  if (Object.hasOwn(manifest, 'count') && Number(manifest.count) !== ids.length) {
    errors.push(diagnostic(
      'authored-runtime-state-manifest-count-mismatch',
      'Authored runtime-state manifest count does not match its IDs.',
    ));
  }
  if (Object.hasOwn(manifest, 'contentHash')) {
    const expected = sealRuntimeStateManifest(manifest).contentHash;
    if (manifest.contentHash !== expected) {
      errors.push(diagnostic(
        'authored-runtime-state-manifest-hash-mismatch',
        'Authored runtime-state manifest failed integrity verification.',
      ));
    }
  }
}

function collectArtifactRuntimeStateIds(overlayPlan, materializedLayout) {
  return collectDungeonAugmentationStableStateIds({
    ...(overlayPlan ?? {}),
    connectionPlans: materializedLayout?.connectionPlans,
    stateBindings: materializedLayout?.stateBindings,
  });
}

function reconcileRuntimeStateManifest(sourceManifest, overlayPlan, materializedLayout) {
  const ids = [...new Set([
    ...(sourceManifest?.ids ?? []).map(String),
    ...collectArtifactRuntimeStateIds(overlayPlan, materializedLayout),
  ])].filter(Boolean).sort();
  const manifest = sealRuntimeStateManifest({
    schema: 'ruindivex-dungeon-augmentation-runtime-state-manifest/v1',
    ids,
  });
  materializedLayout.stateBindings = manifest.ids.map((runtimeStateId) => ({
    runtimeStateId,
  }));
  return manifest;
}

function validateRuntimeStateIdentityProjection(artifact, errors) {
  const projectedIds = collectArtifactRuntimeStateIds(
    artifact?.overlayPlan,
    artifact?.materializedLayout,
  );
  const manifestIds = artifact?.runtimeStateManifest?.ids ?? [];
  if (canonicalStringify(projectedIds) !== canonicalStringify(manifestIds)) {
    const projected = new Set(projectedIds);
    const manifest = new Set(manifestIds);
    errors.push(diagnostic(
      'authored-runtime-state-identity-projection-mismatch',
      'The authored runtime-state manifest must exactly match the save-identity projection.',
      {
        onlyProjected: projectedIds.filter((id) => !manifest.has(id)),
        onlyManifest: manifestIds.filter((id) => !projected.has(id)),
      },
    ));
  }
}

function validateAssetManifest(manifest, errors) {
  if (manifest?.schema !== DUNGEON_AUGMENTATION_AUTHORED_ASSET_MANIFEST_SCHEMA
    || !Array.isArray(manifest?.assets)) {
    errors.push(diagnostic(
      'authored-asset-manifest-invalid',
      'Authored V4 must include a supported asset manifest.',
    ));
    return;
  }
  validateUniqueIds(manifest.assets, 'asset', errors);
  const uris = new Set();
  for (const asset of manifest.assets) {
    if (!nonEmptyString(asset?.uri)
      || !sha256Hash(asset?.contentHash)
      || !positiveInteger(asset?.byteLength)
      || !nonEmptyString(asset?.kind)) {
      errors.push(diagnostic(
        'authored-asset-record-invalid',
        `Authored asset ${asset?.id ?? '(unnamed)'} must declare kind, uri, byteLength, and SHA-256 contentHash.`,
        { assetId: asset?.id ?? null },
      ));
    }
    if (uris.has(asset?.uri)) {
      errors.push(diagnostic(
        'authored-asset-uri-duplicated',
        `Authored asset URI ${asset?.uri ?? '(missing)'} is duplicated.`,
        { assetId: asset?.id ?? null },
      ));
    }
    uris.add(asset?.uri);
  }
}

function validateRenderBatchDescriptors(renderBatches, errors) {
  if (!Array.isArray(renderBatches) || renderBatches.length === 0) {
    errors.push(diagnostic(
      'authored-render-batches-invalid',
      'Authored V4 must include at least one compact render-batch descriptor.',
    ));
    return;
  }
  validateUniqueIds(renderBatches, 'render batch', errors);
  for (const batch of renderBatches) {
    if (!nonEmptyString(batch?.geometryKey)
      || typeof batch?.materialKey !== 'string'
      || !positiveInteger(batch?.meshCount)
      || !positiveInteger(batch?.instanceCount)
      || Number(batch.instanceCount) < Number(batch.meshCount)
      || typeof batch?.instanced !== 'boolean') {
      errors.push(diagnostic(
        'authored-render-batch-descriptor-invalid',
        `Authored render batch ${batch?.id ?? '(unnamed)'} is invalid.`,
        { batchId: batch?.id ?? null },
      ));
    }
  }
}

function normalizeValidationResult(result, name) {
  if (result === undefined || result === null) return null;
  if (result === true) return { accepted: true, errors: [], warnings: [] };
  if (result === false) {
    return {
      accepted: false,
      errors: [diagnostic(`${name}-rejected`, `${name} rejected the authored source.`)],
      warnings: [],
    };
  }
  return {
    accepted: result?.accepted === true,
    errors: Array.isArray(result?.errors) ? result.errors : [],
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
  };
}

function validateReleaseReceipt(receipt, errors, warnings) {
  if (receipt?.accepted !== true) {
    errors.push(diagnostic(
      'authored-validation-receipt-not-accepted',
      'Authored source validation receipt is not accepted.',
    ));
  }
  errors.push(...(Array.isArray(receipt?.errors) ? receipt.errors : []));
  warnings.push(...(Array.isArray(receipt?.warnings) ? receipt.warnings : []));
  for (const check of REQUIRED_VALIDATION_CHECKS) {
    if (receipt?.checks?.[check] !== true) {
      errors.push(diagnostic(
        'authored-validation-check-missing',
        `Authored validation receipt must accept ${check}.`,
        { check },
      ));
    }
  }
}

function stampOverlay(sourceOverlayPlan, sourceContentHash, baseGeometryHash) {
  const overlayPlan = cloneDungeonAugmentationValue(sourceOverlayPlan);
  const authoredProvenance = provenance(sourceContentHash);
  Object.assign(overlayPlan, {
    artifactId: INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
    artifactRevision: INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
    profileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
    profileRevision: INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
    gameplayTuningRevision: INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
    generationMode: INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
    canonicalLayoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
    resolvedLayoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
    augmentationSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
    layoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
    basePlanHash: baseGeometryHash,
    placementProvenance: authoredProvenance,
    operations: (overlayPlan.operations ?? []).map((record) => (
      withAuthoredProvenance(record, sourceContentHash)
    )),
    nodes: (overlayPlan.nodes ?? []).map((record) => (
      withAuthoredProvenance(record, sourceContentHash)
    )),
    segments: (overlayPlan.segments ?? []).map((record) => (
      withAuthoredProvenance(record, sourceContentHash)
    )),
  });
  overlayPlan.augmentationPlanHash = computeDungeonAugmentationPlanHash(overlayPlan);
  overlayPlan.effectivePlanHash = computeEffectiveDungeonPlanHash(
    baseGeometryHash,
    overlayPlan.augmentationPlanHash,
  );
  return overlayPlan;
}

/**
 * Seals a hand-authored, renderer-free V4 source into the only artifact shape
 * accepted by the browser runtime. This compiler intentionally has no planner
 * dependency and performs no seed-based selection or repair.
 */
export function compileIndustrialV4AuthoredArtifact(source, {
  validateOverlay = null,
  validateMaterialized = null,
} = {}) {
  const errors = [];
  const warnings = [];
  if (!isRecord(source)) {
    throwCompilationError([diagnostic(
      'authored-source-invalid',
      'Authored V4 source must be a plain object.',
    )]);
  }
  try {
    canonicalStringify(source);
  } catch (error) {
    throwCompilationError([diagnostic(
      'authored-source-not-serializable',
      error.message,
      { path: error.path ?? null },
    )]);
  }

  validateIdentity(source, errors);
  if (!isRecord(source.canonicalBaseDraft)) {
    errors.push(diagnostic(
      'authored-base-draft-missing',
      'Authored V4 must include canonicalBaseDraft.',
    ));
  }
  if (!isRecord(source.overlayPlan)) {
    errors.push(diagnostic(
      'authored-overlay-plan-missing',
      'Authored V4 must include overlayPlan.',
    ));
  }
  const composition = inspectComposition(source.overlayPlan, errors);
  validateMaterializedLayout(source.materializedLayout, errors);
  validateMaterializedLayout(source.materializedLayoutDescriptors, errors);
  validateMaterializedDescriptorParity(
    source.materializedLayoutDescriptors,
    source.materializedLayout,
    errors,
  );
  validateAssetManifest(source.assetManifest, errors);
  validateCanonicalRandomTape(source.canonicalBaseRandomTape, errors);
  validateRuntimeStateManifest(source.runtimeStateManifest, errors);
  validateRenderBatchDescriptors(source.renderBatches, errors);
  validateReleaseReceipt(source.validationReceipt, errors, warnings);

  const sourceContentHash = hashCanonicalValue(source, {
    namespace: 'ruindivex-industrial-v4-authored-source/v1',
    omitKeys: SOURCE_HASH_OMIT_KEYS,
  });
  const canonicalBaseDraftSource = cloneDungeonAugmentationValue(
    source.canonicalBaseDraft ?? {},
  );
  const baseGeometryHash = hashCanonicalValue(canonicalBaseDraftSource, {
    namespace: 'ruindivex-industrial-v4-authored-base-geometry/v1',
    omitKeys: ['basePlanHash', 'planHash'],
  });
  canonicalBaseDraftSource.basePlanHash = baseGeometryHash;
  canonicalBaseDraftSource.planHash = baseGeometryHash;
  const canonicalBaseDraft = createCanonicalBaseDraftDescriptor(
    canonicalBaseDraftSource,
    baseGeometryHash,
  );
  const baseDraftDescriptorHash = hashCanonicalValue(canonicalBaseDraft, {
    namespace: 'ruindivex-industrial-v4-authored-base-descriptor/v1',
  });
  const overlayPlan = stampOverlay(source.overlayPlan ?? {}, sourceContentHash, baseGeometryHash);
  const overlayPlanHash = overlayPlan.augmentationPlanHash;
  const effectiveLayoutHash = overlayPlan.effectivePlanHash;
  const materializedLayout = cloneDungeonAugmentationValue(source.materializedLayout ?? {});
  materializedLayout.recordMode = materializedLayout.recordMode === 'compact-descriptors'
    ? 'compact-descriptors'
    : 'full-records';
  delete materializedLayout.assemblyOverlayPlan;
  materializedLayout.assemblyOverlayPlanRef = {
    schema: 'ruindivex-dungeon-augmentation-overlay-reference/v1',
    augmentationPlanHash: overlayPlan.augmentationPlanHash,
  };
  const materializedLayoutDescriptors = cloneDungeonAugmentationValue(
    source.materializedLayoutDescriptors ?? {},
  );
  delete materializedLayoutDescriptors.assemblyOverlayPlan;
  materializedLayoutDescriptors.assemblyOverlayPlanRef = {
    schema: 'ruindivex-dungeon-augmentation-overlay-reference/v1',
    augmentationPlanHash: overlayPlan.augmentationPlanHash,
  };
  const materializedLayoutDescriptorHash = hashCanonicalValue(
    materializedLayoutDescriptors,
    { namespace: 'ruindivex-industrial-v4-authored-materialized-descriptors/v1' },
  );
  const runtimeStateManifest = reconcileRuntimeStateManifest(
    source.runtimeStateManifest,
    overlayPlan,
    materializedLayout,
  );
  const runtimeStateManifestHash = runtimeStateManifest.contentHash;
  const materializedLayoutHash = hashCanonicalValue(materializedLayout, {
    namespace: 'ruindivex-industrial-v4-authored-materialized-layout/v1',
  });
  const assetManifest = {
    ...cloneDungeonAugmentationValue(source.assetManifest ?? {}),
    assets: sortRecordsById(source.assetManifest?.assets ?? []).map((asset) => (
      cloneDungeonAugmentationValue(asset)
    )),
  };
  const assetManifestHash = hashCanonicalValue(assetManifest, {
    namespace: 'ruindivex-industrial-v4-authored-asset-manifest/v1',
  });
  const canonicalBaseRandomTape = cloneDungeonAugmentationValue(
    source.canonicalBaseRandomTape,
  );
  const canonicalBaseRandomTapeHash = canonicalRandomTapeHash(canonicalBaseRandomTape);
  const renderBatches = sortRecordsById(source.renderBatches ?? []).map((batch) => (
    cloneDungeonAugmentationValue(batch)
  ));
  const renderBatchManifestHash = hashCanonicalValue(renderBatches, {
    namespace: 'ruindivex-industrial-v4-authored-render-batches/v1',
  });
  const overlayResult = normalizeValidationResult(
    typeof validateOverlay === 'function'
      ? validateOverlay({ overlayPlan, canonicalBaseDraft: canonicalBaseDraftSource, source })
      : null,
    'overlay validation',
  );
  const materializedResult = normalizeValidationResult(
    typeof validateMaterialized === 'function'
      ? validateMaterialized({
        materializedLayout,
        overlayPlan,
        canonicalBaseDraft: canonicalBaseDraftSource,
        source,
      })
      : null,
    'materialized validation',
  );
  for (const result of [overlayResult, materializedResult].filter(Boolean)) {
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (result.accepted !== true && result.errors.length === 0) {
      errors.push(diagnostic(
        'authored-validator-rejected',
        'An authored artifact validator rejected the source.',
      ));
    }
  }

  if (warnings.length > 0) {
    errors.push(diagnostic(
      'authored-validation-warnings-not-approved',
      'Authored V4 artifacts must compile without warnings.',
      { warningCount: warnings.length },
    ));
  }
  if (errors.length > 0) throwCompilationError(errors);

  const validationReceipt = {
    schema: DUNGEON_AUGMENTATION_AUTHORED_VALIDATION_RECEIPT_SCHEMA,
    accepted: true,
    errors: [],
    warnings: [],
    checks: Object.fromEntries(REQUIRED_VALIDATION_CHECKS.map((check) => [check, true])),
    composition,
    sourceReceiptHash: hashCanonicalValue(source.validationReceipt, {
      namespace: 'ruindivex-industrial-v4-authored-source-receipt/v1',
    }),
  };
  const artifact = {
    schema: DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_SCHEMA,
    artifactId: INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
    artifactRevision: INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
    generationMode: INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
    profileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
    profileRevision: INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
    gameplayTuningRevision: INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
    canonicalLayoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
    sourceContentHash,
    baseGeometryHash,
    basePlanHash: baseGeometryHash,
    baseDraftDescriptorHash,
    canonicalBaseRandomTapeHash,
    overlayPlanHash,
    augmentationPlanHash: overlayPlanHash,
    effectiveLayoutHash,
    effectivePlanHash: effectiveLayoutHash,
    materializedLayoutHash,
    materializedLayoutDescriptorHash,
    renderBatchManifestHash,
    runtimeStateManifestHash,
    assetManifestHash,
    canonicalBaseDraft,
    canonicalBaseRandomTape,
    overlayPlan,
    materializedLayout,
    materializedLayoutDescriptors,
    renderBatches,
    runtimeStateManifest,
    assetManifest,
    validationReceipt,
  };
  artifact.artifactHash = hashCanonicalValue(artifact, {
    namespace: 'ruindivex-industrial-v4-authored-artifact/v1',
    omitKeys: ARTIFACT_HASH_OMIT_KEYS,
  });
  return deepFreezeDungeonAugmentationValue(artifact);
}

export function verifyIndustrialV4AuthoredArtifact(artifact, {
  profileId = INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  verifyArtifactHash = true,
  expectedArtifactHash: trustedArtifactHash = null,
  verificationMode = 'exhaustive',
} = {}) {
  const errors = [];
  const trustedBundledPayload = verificationMode
    === INDUSTRIAL_V4_AUTHORED_TRUSTED_PAYLOAD_VERIFICATION_MODE;
  if (!isRecord(artifact)) {
    errors.push(diagnostic('authored-artifact-invalid', 'Authored artifact must be an object.'));
  } else {
    const identity = {
      schema: DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_SCHEMA,
      artifactId: INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
      artifactRevision: INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
      generationMode: INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
      profileId,
      profileRevision: INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
      gameplayTuningRevision: INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
      canonicalLayoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
    };
    for (const [field, expected] of Object.entries(identity)) {
      if (artifact[field] !== expected) {
        errors.push(diagnostic(
          'authored-artifact-identity-mismatch',
          `Authored artifact ${field} does not match.`,
          { field, expected, actual: artifact[field] ?? null },
        ));
      }
    }
    const expectedHashes = {};
    if (trustedBundledPayload) {
      if (stableHash(trustedArtifactHash)) {
        expectedHashes.artifactHash = trustedArtifactHash;
      } else {
        errors.push(diagnostic(
          'authored-artifact-trusted-hash-missing',
          'Authenticated payload verification requires a sealed build-receipt hash.',
        ));
      }
    } else {
      const expectedOverlayHash = computeDungeonAugmentationPlanHash(
        artifact.overlayPlan ?? {},
      );
      const expectedEffectiveHash = computeEffectiveDungeonPlanHash(
        artifact.baseGeometryHash,
        expectedOverlayHash,
      );
      Object.assign(expectedHashes, {
        baseDraftDescriptorHash: hashCanonicalValue(
          artifact.canonicalBaseDraft ?? {},
          { namespace: 'ruindivex-industrial-v4-authored-base-descriptor/v1' },
        ),
        canonicalBaseRandomTapeHash: canonicalRandomTapeHash(
          artifact.canonicalBaseRandomTape ?? [],
        ),
        overlayPlanHash: expectedOverlayHash,
        augmentationPlanHash: expectedOverlayHash,
        effectiveLayoutHash: expectedEffectiveHash,
        effectivePlanHash: expectedEffectiveHash,
        materializedLayoutHash: hashCanonicalValue(artifact.materializedLayout ?? {}, {
          namespace: 'ruindivex-industrial-v4-authored-materialized-layout/v1',
        }),
        materializedLayoutDescriptorHash: hashCanonicalValue(
          artifact.materializedLayoutDescriptors ?? {},
          { namespace: 'ruindivex-industrial-v4-authored-materialized-descriptors/v1' },
        ),
        renderBatchManifestHash: hashCanonicalValue(
          artifact.renderBatches ?? [],
          { namespace: 'ruindivex-industrial-v4-authored-render-batches/v1' },
        ),
        runtimeStateManifestHash: sealRuntimeStateManifest(
          artifact.runtimeStateManifest ?? {},
        ).contentHash,
        assetManifestHash: hashCanonicalValue(artifact.assetManifest ?? {}, {
          namespace: 'ruindivex-industrial-v4-authored-asset-manifest/v1',
        }),
      });
      if (verifyArtifactHash) {
        expectedHashes.artifactHash = hashCanonicalValue(artifact, {
          namespace: 'ruindivex-industrial-v4-authored-artifact/v1',
          omitKeys: ARTIFACT_HASH_OMIT_KEYS,
        });
      } else if (stableHash(trustedArtifactHash)) {
        expectedHashes.artifactHash = trustedArtifactHash;
      } else {
        errors.push(diagnostic(
          'authored-artifact-trusted-hash-missing',
          'Fast authored-artifact verification requires a sealed build-receipt hash.',
        ));
      }
    }
    for (const [field, expected] of Object.entries(expectedHashes)) {
      if (artifact[field] !== expected) {
        errors.push(diagnostic(
          'authored-artifact-hash-mismatch',
          `Authored artifact ${field} failed integrity verification.`,
          { field, expected, actual: artifact[field] ?? null },
        ));
      }
    }
    if (artifact.basePlanHash !== artifact.baseGeometryHash
      || artifact.overlayPlan?.basePlanHash !== artifact.baseGeometryHash
      || artifact.canonicalBaseDraft?.basePlanHash !== artifact.baseGeometryHash
      || artifact.canonicalBaseDraft?.baseGeometryHash !== artifact.baseGeometryHash) {
      errors.push(diagnostic(
        'authored-artifact-base-hash-mismatch',
        'Authored artifact base geometry identities disagree.',
      ));
    }
    inspectComposition(artifact.overlayPlan, errors);
    validateCanonicalBaseDraftDescriptor(artifact.canonicalBaseDraft, errors, {
      expectedBaseGeometryHash: artifact.baseGeometryHash,
    });
    validateMaterializedLayout(artifact.materializedLayout, errors);
    validateMaterializedLayout(artifact.materializedLayoutDescriptors, errors);
    validateMaterializedDescriptorParity(
      artifact.materializedLayoutDescriptors,
      artifact.materializedLayout,
      errors,
      { verifyRecordHashes: !trustedBundledPayload },
    );
    validateAssetManifest(artifact.assetManifest, errors);
    validateCanonicalRandomTape(artifact.canonicalBaseRandomTape, errors);
    validateRuntimeStateManifest(artifact.runtimeStateManifest, errors);
    if (!trustedBundledPayload) validateRuntimeStateIdentityProjection(artifact, errors);
    validateRenderBatchDescriptors(artifact.renderBatches, errors);
    validateAuthoredProvenance(artifact.overlayPlan, artifact.sourceContentHash, errors);
    if (artifact.materializedLayout?.assemblyOverlayPlanRef
      && artifact.materializedLayout.assemblyOverlayPlanRef.augmentationPlanHash
        !== artifact.overlayPlanHash) {
      errors.push(diagnostic(
        'authored-materialized-overlay-reference-mismatch',
        'Compact materialized descriptors reference a different overlay hash.',
      ));
    }
    validateReleaseReceipt(artifact.validationReceipt, errors, []);
  }
  return deepFreezeDungeonAugmentationValue({
    accepted: errors.length === 0,
    errors,
    artifactId: artifact?.artifactId ?? null,
    artifactHash: artifact?.artifactHash ?? null,
  });
}

export function assertIndustrialV4AuthoredArtifact(artifact, options = {}) {
  if (artifact && typeof artifact === 'object' && trustedBundledArtifacts.has(artifact)) {
    const profileId = options.profileId ?? INDUSTRIAL_V4_AUTHORED_PROFILE_ID;
    if (artifact.profileId === profileId) return artifact;
  }
  const verification = verifyIndustrialV4AuthoredArtifact(artifact, options);
  if (!verification.accepted) {
    throw new DungeonAugmentationAuthoredArtifactError(
      'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_INTEGRITY_MISMATCH',
      'Industrial V4 authored artifact failed integrity verification.',
      verification,
    );
  }
  if (options.verificationMode
    === INDUSTRIAL_V4_AUTHORED_TRUSTED_PAYLOAD_VERIFICATION_MODE) {
    trustedBundledArtifacts.add(artifact);
  }
  return artifact;
}

export function createDungeonAugmentationAbortError() {
  const error = new Error('Dungeon augmentation artifact loading was aborted.');
  error.name = 'AbortError';
  error.code = 'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_ABORTED';
  return error;
}

export function stableIndustrialV4AuthoredArtifactText(artifact) {
  return `${canonicalStringify(assertIndustrialV4AuthoredArtifact(artifact))}\n`;
}

export const INDUSTRIAL_V4_AUTHORED_REQUIRED_VALIDATION_CHECKS =
  deepFreezeDungeonAugmentationValue([...REQUIRED_VALIDATION_CHECKS]);
export const INDUSTRIAL_V4_AUTHORED_SOURCE_HASH_OMIT_KEYS =
  deepFreezeDungeonAugmentationValue([...SOURCE_HASH_OMIT_KEYS]);
