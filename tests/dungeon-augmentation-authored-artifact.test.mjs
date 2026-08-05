import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  compileIndustrialV4AuthoredArtifact,
  DUNGEON_AUGMENTATION_AUTHORED_ASSET_MANIFEST_SCHEMA,
  DUNGEON_AUGMENTATION_AUTHORED_SOURCE_SCHEMA,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
  INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
  INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
  INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
  stableIndustrialV4AuthoredArtifactText,
  verifyIndustrialV4AuthoredArtifact,
} from '../src/dungeon-augmentation/authored/AuthoredArtifactCompiler.js';
import { loadIndustrialV4AuthoredArtifact } from
  '../src/dungeon-augmentation/authored/IndustrialV4AuthoredArtifact.js';

const VALIDATION_CHECKS = Object.freeze([
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSource() {
  const operationShapes = [
    ['pyramid-loop', 'landmark-perimeter-loop', 5, 6],
    ['enemy-nest-keycard', 'objective-route-coverage', 5, 5],
    ['keycard-trap', 'objective-route-coverage', 5, 5],
    ['trap-conveyor', 'objective-route-coverage', 5, 5],
    ['conveyor-boss', 'objective-route-coverage', 4, 5],
  ];
  const operations = [];
  const nodes = [];
  const segments = [];
  for (const [slug, routeNetworkKind, nodeCount, segmentCount] of operationShapes) {
    const operationId = `supplement:industrial-v1-main-region:authored:${slug}`;
    const nodeIds = Array.from(
      { length: nodeCount },
      (_, ordinal) => `${operationId}:node:${ordinal}`,
    );
    const segmentIds = Array.from(
      { length: segmentCount },
      (_, ordinal) => `${operationId}:segment:${ordinal}`,
    );
    operations.push({
      id: operationId,
      type: 'routeNetwork',
      routeNetworkKind,
      nodeIds,
      segmentIds,
    });
    nodes.push(...nodeIds.map((id, ordinal) => ({
      id,
      operationId,
      ordinal,
      placement: { center: { x: ordinal * 14, y: 0, z: operations.length * 28 } },
    })));
    segments.push(...segmentIds.map((id, ordinal) => ({
      id,
      operationId,
      physicalOrdinal: ordinal,
      fromNodeId: nodeIds[ordinal % nodeIds.length],
      toNodeId: nodeIds[(ordinal + 1) % nodeIds.length],
      path: [
        { x: ordinal * 14, y: 0, z: operations.length * 28 },
        { x: (ordinal + 1) * 14, y: 0, z: operations.length * 28 },
      ],
    })));
  }
  const overlayPlan = {
    schema: 'ruindivex-dungeon-augmentation-overlay/v2',
    revision: 2,
    profileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
    profileRevision: INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
    basePlanHash: 'replaced-by-compiler',
    operations,
    nodes,
    segments,
  };
  return {
    schema: DUNGEON_AUGMENTATION_AUTHORED_SOURCE_SCHEMA,
    artifactId: INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
    artifactRevision: INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
    profileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
    profileRevision: INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
    gameplayTuningRevision: INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
    generationMode: INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
    canonicalLayoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
    canonicalBaseDraft: {
      schema: 'ruindivex-industrial-base-draft/v1',
      basePlanHash: 'source-placeholder',
      planHash: 'source-placeholder',
      tileSize: 2.8,
      difficulty: 1,
      rooms: [],
      connectionPlans: [],
      occupiedVolumes: [],
      connectionOccupiedVolumes: [],
      connectionClearanceVolumes: [],
      connectionLandingVolumes: [],
      protectedVolumes: [],
    },
    canonicalBaseRandomTape: [0.5],
    overlayPlan,
    materializedLayout: {
      recordMode: 'full-records',
      rooms: [],
      connectionPlans: [],
      connectorJunctionProxies: [],
      assemblyOverlayPlan: clone(overlayPlan),
      supplementalRoomIds: nodes.map(({ id }) => id),
      supplementalConnectorJunctionIds: [],
      supplementalConnectionIds: segments.map(({ id }) => id),
      supplementalPhysicalConnectionIds: segments.map(({ id }) => id),
      supplementalGraphOnlyConnectionIds: [],
      diagnostics: { accepted: true, reason: 'fixture-materialized', errors: [] },
    },
    materializedLayoutDescriptors: {
      recordMode: 'compact-descriptors',
      rooms: [],
      connectionPlans: [],
      connectorJunctionProxies: [],
      assemblyOverlayPlanRef: {
        schema: 'ruindivex-dungeon-augmentation-overlay-reference/v1',
        augmentationPlanHash: 'replaced-by-compiler',
      },
      supplementalRoomIds: nodes.map(({ id }) => id),
      supplementalConnectorJunctionIds: [],
      supplementalConnectionIds: segments.map(({ id }) => id),
      supplementalPhysicalConnectionIds: segments.map(({ id }) => id),
      supplementalGraphOnlyConnectionIds: [],
      diagnostics: { accepted: true, reason: 'fixture-materialized', errors: [] },
    },
    renderBatches: [{
      id: 'fixture-render-batch',
      geometryKey: 'BoxGeometry',
      materialKey: 'fixture-material',
      meshCount: 1,
      instanceCount: 1,
      instanced: false,
    }],
    runtimeStateManifest: {
      schema: 'ruindivex-dungeon-augmentation-runtime-state-manifest/v1',
      ids: ['fixture:state:authored'],
    },
    assetManifest: {
      schema: DUNGEON_AUGMENTATION_AUTHORED_ASSET_MANIFEST_SCHEMA,
      assets: [],
    },
    validationReceipt: {
      accepted: true,
      errors: [],
      warnings: [],
      checks: Object.fromEntries(VALIDATION_CHECKS.map((name) => [name, true])),
    },
  };
}

test('authored artifact compiler seals the exact fixed V4 composition deterministically', () => {
  const first = compileIndustrialV4AuthoredArtifact(createSource());
  const second = compileIndustrialV4AuthoredArtifact(createSource());

  assert.equal(first.artifactId, 'industrial-v4-authored-r1');
  assert.equal(first.profileRevision, 6);
  assert.equal(first.generationMode, 'authored-artifact');
  assert.equal(first.canonicalLayoutSeed, 'layout:industrial-v4-authored-r1');
  assert.equal(first.overlayPlan.operations.length, 5);
  assert.equal(first.overlayPlan.nodes.length, 24);
  assert.equal(first.overlayPlan.segments.length, 26);
  assert.equal(first.effectivePlanHash, first.effectiveLayoutHash);
  assert.equal(first.augmentationPlanHash, first.overlayPlanHash);
  assert.equal(first.basePlanHash, first.baseGeometryHash);
  assert.equal(first.canonicalBaseDraft.recordMode, 'compact-descriptors');
  assert.equal(first.canonicalBaseDraft.baseGeometryHash, first.baseGeometryHash);
  assert.equal(first.materializedLayout.recordMode, 'full-records');
  assert.equal(first.materializedLayoutDescriptors.recordMode, 'compact-descriptors');
  assert.match(first.baseDraftDescriptorHash, /^v1-[0-9a-f]{32}$/u);
  assert.match(first.canonicalBaseRandomTapeHash, /^v1-[0-9a-f]{32}$/u);
  assert.match(first.materializedLayoutDescriptorHash, /^v1-[0-9a-f]{32}$/u);
  assert.match(first.renderBatchManifestHash, /^v1-[0-9a-f]{32}$/u);
  assert.equal(first.runtimeStateManifestHash, first.runtimeStateManifest.contentHash);
  assert.equal(first.artifactHash, second.artifactHash);
  assert.equal(stableIndustrialV4AuthoredArtifactText(first),
    stableIndustrialV4AuthoredArtifactText(second));
  assert.equal(verifyIndustrialV4AuthoredArtifact(first).accepted, true);
  assert.ok(Object.isFrozen(first));

  for (const record of [
    first.overlayPlan,
    ...first.overlayPlan.operations,
    ...first.overlayPlan.nodes,
    ...first.overlayPlan.segments,
  ]) {
    assert.deepEqual(record.placementProvenance, {
      kind: 'authored-artifact',
      artifactId: 'industrial-v4-authored-r1',
      artifactRevision: 1,
      sourceContentHash: first.sourceContentHash,
    });
  }
});

test('loader ignores requested layout seeds and returns one verified artifact', async () => {
  const artifact = compileIndustrialV4AuthoredArtifact(createSource());
  const first = await loadIndustrialV4AuthoredArtifact({
    artifact,
    requestedLayoutSeed: 'layout:any-seed-a',
  });
  const second = await loadIndustrialV4AuthoredArtifact({
    artifact,
    requestedLayoutSeed: 'layout:any-seed-b',
  });
  assert.equal(first.artifactHash, second.artifactHash);
  assert.equal(first.canonicalLayoutSeed, INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED);
});

test('artifact verification detects mutation and loader fails closed', async () => {
  const tampered = clone(compileIndustrialV4AuthoredArtifact(createSource()));
  tampered.overlayPlan.nodes[0].placement.center.x += 1;
  const verification = verifyIndustrialV4AuthoredArtifact(tampered);
  assert.equal(verification.accepted, false);
  assert.ok(verification.errors.some(({ code }) => code === 'authored-artifact-hash-mismatch'));
  await assert.rejects(
    loadIndustrialV4AuthoredArtifact({ artifact: tampered }),
    { code: 'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_INTEGRITY_MISMATCH' },
  );
});

test('artifact verification seals compact base, tape, state, and render descriptors', () => {
  const artifact = compileIndustrialV4AuthoredArtifact(createSource());
  assert.deepEqual(artifact.canonicalBaseDraft.counts, {
    rooms: 0,
    connectionPlans: 0,
    occupiedVolumes: 0,
    connectionOccupiedVolumes: 0,
    connectionClearanceVolumes: 0,
    connectionLandingVolumes: 0,
    protectedVolumes: 0,
  });

  for (const mutate of [
    (value) => { value.canonicalBaseDraft.tileSize = 9; },
    (value) => { value.canonicalBaseRandomTape[0] = 0.75; },
    (value) => { value.runtimeStateManifest.ids[0] = 'fixture:state:tampered'; },
    (value) => { value.renderBatches[0].instanceCount = 2; },
  ]) {
    const tampered = clone(artifact);
    mutate(tampered);
    assert.equal(verifyIndustrialV4AuthoredArtifact(tampered).accepted, false);
  }
});

test('compiler rejects composition drift, warnings, and failed injected validation', () => {
  const wrongCount = createSource();
  wrongCount.overlayPlan.nodes.pop();
  assert.throws(
    () => compileIndustrialV4AuthoredArtifact(wrongCount),
    { code: 'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_INVALID' },
  );

  const warned = createSource();
  warned.validationReceipt.warnings.push({ code: 'unapproved-warning' });
  assert.throws(
    () => compileIndustrialV4AuthoredArtifact(warned),
    { code: 'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_INVALID' },
  );

  const proceduralSnapshot = createSource();
  proceduralSnapshot.overlayPlan.operations[0].selectionManifest = { chosenIndex: 2 };
  assert.throws(
    () => compileIndustrialV4AuthoredArtifact(proceduralSnapshot),
    { code: 'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_INVALID' },
  );

  assert.throws(
    () => compileIndustrialV4AuthoredArtifact(createSource(), {
      validateOverlay: () => ({
        accepted: false,
        errors: [{ code: 'physical-validation-failed', message: 'fixture rejection' }],
      }),
    }),
    { code: 'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_INVALID' },
  );
});

test('artifact loading honors cancellation without starting planner work', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadIndustrialV4AuthoredArtifact({
      artifact: compileIndustrialV4AuthoredArtifact(createSource()),
      signal: controller.signal,
    }),
    { name: 'AbortError', code: 'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_ABORTED' },
  );

  const compilerSource = await readFile(new URL(
    '../src/dungeon-augmentation/authored/AuthoredArtifactCompiler.js',
    import.meta.url,
  ), 'utf8');
  const loaderSource = await readFile(new URL(
    '../src/dungeon-augmentation/authored/IndustrialV4AuthoredArtifact.js',
    import.meta.url,
  ), 'utf8');
  assert.doesNotMatch(compilerSource, /planner\.js|BrowserPlannerWorker/u);
  assert.doesNotMatch(loaderSource, /planner\.js|BrowserPlannerWorker/u);
});
