import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';
import {
  createIndustrialAugmentationHost,
  createIndustrialBaseDraft,
} from '../src/dungeon-augmentation/IndustrialDraftAdapter.js';
import {
  canonicalStringify,
  augmentDungeonDraft,
  computeDungeonAugmentationPlanHash,
  computeEffectiveDungeonPlanHash,
  createDungeonRouteEndpointSeam,
  createSegment,
  hashCanonicalValue,
  materializeIndustrialOverlay,
} from '../src/dungeon-augmentation/index.js';
import {
  DUNGEON_AUGMENTATION_AUTHORED_ASSET_MANIFEST_SCHEMA,
  DUNGEON_AUGMENTATION_AUTHORED_SOURCE_SCHEMA,
  DUNGEON_AUGMENTATION_AUTHORED_VALIDATION_RECEIPT_SCHEMA,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
  INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
  INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
  INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
} from '../src/dungeon-augmentation/authored/AuthoredArtifactCompiler.js';
import { INDUSTRIAL_V4_AUTHORED_LEVEL_SOURCE as PREVIOUS_AUTHORED_SOURCE } from
  '../src/dungeon-augmentation/authored/IndustrialV4AuthoredLevelSource.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const outputPath = path.resolve(
  repositoryRoot,
  outputArgument?.slice('--output='.length)
    ?? 'src/dungeon-augmentation/authored/IndustrialV4AuthoredLevelSource.js',
);
const AUTHORING_SEED = 'layout:augmentation-realized-v4-001';
const BASE_PLAN_HASH = `v1:${AUTHORING_SEED}:depth:1:revolvingFusillade`;
const TILE_SIZE = 2.8;
const BOSS_SCAFFOLD_SAFE_SHIFT_METERS = -8.4;
const TEXTURE_NAMES = Object.freeze([
  'accent_conduit', 'accent_glyph', 'accent_hatch', 'accent_recessed',
  'accent_sensor', 'accent_slate', 'accent_symbol', 'accent_vent',
  'accent_wiring', 'ceiling_panel', 'door_frame', 'door_keycard',
  'door_sealed', 'floor_circuit', 'floor_cracked', 'floor_cross_panel',
  'floor_mossy', 'floor_octagon', 'floor_panel', 'floor_plain',
  'floor_shrine', 'special_conveyor', 'special_trap', 'terminal_mechanism',
  'wall_macro_industrial_bl', 'wall_macro_industrial_bm',
  'wall_macro_industrial_br', 'wall_macro_industrial_ml',
  'wall_macro_industrial_mm', 'wall_macro_industrial_mr',
  'wall_macro_industrial_tl', 'wall_macro_industrial_tm',
  'wall_macro_industrial_tr',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function moveNodeX(node, deltaX) {
  node.placement.center.x += deltaX;
  for (const socket of node.sockets ?? []) socket.position.x += deltaX;
  for (const anchor of node.anchors ?? []) anchor.position.x += deltaX;
  for (const volume of [
    ...(node.occupiedVolumes ?? []),
    ...(node.clearanceVolumes ?? []),
  ]) volume.center.x += deltaX;
}

function authoredLocalApproachWitness(endpoint, socketById) {
  const socket = socketById.get(String(endpoint.socketId)) ?? endpoint;
  return {
    nodeId: String(endpoint.nodeId ?? socket.nodeId ?? ''),
    socketId: String(endpoint.socketId ?? endpoint.id ?? socket.id ?? ''),
    localSocketId: socket.localSocketId ?? endpoint.localSocketId ?? null,
    path: [
      {
        x: socket.position.x - socket.facing.x * 5.6,
        y: socket.position.y - socket.facing.y * 5.6,
        z: socket.position.z - socket.facing.z * 5.6,
      },
      { ...socket.position },
    ],
  };
}

function rebuildSegment(oldSegment, pathPoints, socketById) {
  const from = clone(oldSegment.from);
  const to = clone(oldSegment.to);
  const fromSocket = socketById.get(String(from.socketId));
  const toSocket = socketById.get(String(to.socketId));
  if (fromSocket) {
    from.position = { ...fromSocket.position };
    from.facing = { ...fromSocket.facing };
  }
  if (toSocket) {
    to.position = { ...toSocket.position };
    to.facing = { ...toSocket.facing };
  }
  const rebuilt = createSegment({
    id: oldSegment.id,
    operationId: oldSegment.operationId,
    parentRegionId: oldSegment.parentRegionId,
    physicalOrdinal: oldSegment.physicalOrdinal,
    logicalEdgeId: oldSegment.logicalEdgeId,
    from,
    to,
    connectorFamily: oldSegment.connectorFamily,
    themeBinding: clone(oldSegment.themeBinding),
    coordinateSpace: oldSegment.coordinateSpace,
    path: clone(pathPoints),
    heightMeters: oldSegment.heightMeters,
    landingDepthMeters: 5.6,
  });
  const rebuiltGeometryKeys = new Set([
    'from', 'to', 'path', 'occupiedVolumes', 'clearanceVolumes',
    'landings', 'landingVolumes', 'endpointSeams', 'localApproachWitnesses',
  ]);
  for (const [key, value] of Object.entries(oldSegment)) {
    if (!rebuiltGeometryKeys.has(key) && !(key in rebuilt)) rebuilt[key] = clone(value);
  }
  rebuilt.endpointSeams = (oldSegment.endpointSeams ?? []).map((seam, index) => {
    const endpoint = index === 0 ? from : to;
    return createDungeonRouteEndpointSeam(endpoint, {
      id: seam.id,
      segmentId: oldSegment.id,
      operationId: oldSegment.operationId,
      networkId: seam.networkId,
      nodeId: seam.nodeId,
      socketId: seam.socketId,
      localSocketId: seam.localSocketId,
      role: seam.role,
      tileSize: seam.tileSize,
      widthTiles: seam.widthTiles,
      insideDepthTiles: seam.insideDepthTiles,
      outsideDepthTiles: seam.outsideDepthTiles,
      clearanceHeightMeters: seam.overlapEnvelope?.size?.y ?? 5.6,
      elevationBand: seam.elevationBand,
      parentOwnerId: seam.overlapEnvelope?.parentOwnerId ?? null,
    });
  });
  rebuilt.localApproachWitnesses = [from, to].map((endpoint) => (
    authoredLocalApproachWitness(endpoint, socketById)
  ));
  return rebuilt;
}

function convertAcceptedPlanToAuthoredOverlay(proceduralOverlay) {
  const overlay = clone(proceduralOverlay);
  const operation = overlay.operations.find(({ grantId }) => (
    String(grantId).endsWith('coverage:conveyorRoom_bossRoom')
  ));
  if (!operation) throw new Error(
    'Authored conveyor-to-boss operation is missing; planned grants: '
      + (overlay.operations ?? []).map(({ grantId }) => String(grantId)).join(', '),
  );
  const movedNodes = overlay.nodes.filter((node) => (
    node.operationId === operation.id && [3, 4].includes(Number(node.ordinal))
  ));
  if (movedNodes.length !== 2) {
    throw new Error(`Expected two scaffold-repair nodes; received ${movedNodes.length}.`);
  }
  for (const node of movedNodes) moveNodeX(node, BOSS_SCAFFOLD_SAFE_SHIFT_METERS);
  const socketById = new Map(overlay.nodes.flatMap((node) => (
    (node.sockets ?? []).map((socket) => [String(socket.id), socket])
  )));
  const replacementById = new Map();
  for (const segment of overlay.segments.filter(({ operationId }) => (
    operationId === operation.id
  ))) {
    if (Number(segment.physicalOrdinal) === 4) {
      const toX = Number(segment.to.position.x) + BOSS_SCAFFOLD_SAFE_SHIFT_METERS;
      replacementById.set(segment.id, rebuildSegment(segment, [
        { ...segment.from.position },
        { x: toX, y: segment.from.position.y, z: segment.from.position.z },
        { x: toX, y: segment.to.position.y, z: segment.to.position.z },
      ], socketById));
    } else if (Number(segment.physicalOrdinal) === 5) {
      replacementById.set(segment.id, rebuildSegment(segment,
        segment.path.map((point) => ({
          x: point.x + BOSS_SCAFFOLD_SAFE_SHIFT_METERS,
          y: point.y,
          z: point.z,
        })), socketById));
    } else if (Number(segment.physicalOrdinal) === 6) {
      replacementById.set(segment.id, rebuildSegment(segment,
        segment.path.map((point, index) => (index < 2 ? {
          x: point.x + BOSS_SCAFFOLD_SAFE_SHIFT_METERS,
          y: point.y,
          z: point.z,
        } : { ...point })), socketById));
    }
  }
  if (replacementById.size !== 3) {
    throw new Error(`Expected three rebuilt scaffold-repair segments; received ${replacementById.size}.`);
  }
  overlay.segments = overlay.segments.map((segment) => (
    replacementById.get(segment.id) ?? segment
  ));
  for (const key of [
    'completionMode',
    'prunedRouteNetworkGrants',
    'routeNetworkEntityOmissions',
    'routeNetworkPruningOverrides',
    'routeNetworkConflictExclusions',
  ]) delete overlay[key];
  for (const authoredOperation of overlay.operations) delete authoredOperation.selectionManifest;
  Object.assign(overlay, {
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
  });
  overlay.augmentationPlanHash = computeDungeonAugmentationPlanHash(overlay);
  overlay.effectivePlanHash = computeEffectiveDungeonPlanHash(
    overlay.basePlanHash,
    overlay.augmentationPlanHash,
  );
  return overlay;
}

function mergeRequiredAuthoredOperations(proceduralOverlay, previousOverlay) {
  const planned = clone(proceduralOverlay);
  const previousOperations = previousOverlay.operations ?? [];
  const plannedByGrantId = new Map((planned.operations ?? []).map((operation) => (
    [String(operation.grantId), operation]
  )));
  const selected = previousOperations.map((previousOperation) => {
    const plannedOperation = plannedByGrantId.get(String(previousOperation.grantId));
    return {
      operation: clone(plannedOperation ?? previousOperation),
      source: plannedOperation ? planned : previousOverlay,
    };
  });
  const operationIds = new Set(selected.map(({ operation }) => String(operation.id)));
  planned.operations = selected.map(({ operation }) => operation);
  planned.nodes = selected.flatMap(({ operation, source }) => (
    (source.nodes ?? []).filter((node) => String(node.operationId) === String(operation.id))
  ));
  planned.segments = selected.flatMap(({ operation, source }) => (
    (source.segments ?? []).filter((segment) => (
      String(segment.operationId) === String(operation.id)
    ))
  ));
  if (new Set(planned.operations.map(({ grantId }) => String(grantId))).size
    !== previousOperations.length
    || operationIds.size !== previousOperations.length) {
    throw new Error('Authored required-operation merge produced duplicate identities.');
  }
  return planned;
}

function collectRuntimeStateIds(value, ids = new Set(), key = '', seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return [...ids].sort();
    seen.add(value);
  }
  if (Array.isArray(value)) {
    if (/stateids$/i.test(key)) {
      for (const entry of value) if (typeof entry === 'string' && entry) ids.add(entry);
    }
    for (const entry of value) collectRuntimeStateIds(entry, ids, key, seen);
  } else if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (/stateid$/i.test(childKey) && typeof childValue === 'string' && childValue) {
        ids.add(childValue);
      }
      collectRuntimeStateIds(childValue, ids, childKey, seen);
    }
  }
  return [...ids].sort();
}

function collectRenderBatches(dungeon) {
  const root = dungeon.dungeonSupplementRoot
    ?? dungeon.dungeonSupplement?.root
    ?? dungeon.supplementRoot
    ?? null;
  const descriptors = new Map();
  root?.traverse?.((object) => {
    if (!object?.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const materialKey = materials.map((material) => String(
      material?.name ?? material?.type ?? 'material',
    )).join('+');
    const geometryKey = String(object.geometry?.type ?? 'BufferGeometry');
    const key = `${geometryKey}:${materialKey}`;
    const descriptor = descriptors.get(key) ?? {
      id: `industrial-v4-batch-${descriptors.size}`,
      geometryKey,
      materialKey,
      meshCount: 0,
      instanceCount: 0,
      instanced: false,
    };
    descriptor.meshCount += 1;
    descriptor.instanceCount += Math.max(1, Number(object.count ?? 1));
    descriptor.instanced ||= Boolean(object.isInstancedMesh);
    descriptors.set(key, descriptor);
  });
  return [...descriptors.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function compactMaterializedLayout(materializedLayout) {
  const descriptor = (record, kind, details = {}) => ({
    id: String(record.id),
    kind,
    ...details,
    recordHash: hashCanonicalValue(record, {
      namespace: `ruindivex-industrial-v4-authored-${kind}-record/v1`,
    }),
  });
  return {
    schema: 'ruindivex-dungeon-augmentation-effective-layout-records/v1',
    recordMode: 'compact-descriptors',
    rooms: materializedLayout.rooms.map((room) => descriptor(room, 'room', {
      blueprintId: room.augmentationBlueprintId ?? null,
      operationId: room.augmentationOperationId ?? null,
      x: Number(room.x),
      z: Number(room.z),
      baseElevation: Number(room.baseElevation ?? 0),
      isDungeonSupplement: room.isDungeonSupplement === true,
    })),
    connectionPlans: materializedLayout.connectionPlans.map((plan) => descriptor(
      plan,
      'connection',
      {
        fromRoomId: plan.fromRoomId ?? null,
        toRoomId: plan.toRoomId ?? null,
        isDungeonSupplement: plan.isDungeonSupplement === true,
        graphOnly: plan.isSupplementGraphConnection === true
          || plan.connectorVariantConstraints?.graphOnly === true,
      },
    )),
    connectorJunctionProxies: materializedLayout.connectorJunctionProxies.map((proxy) => (
      descriptor(proxy, 'connector-junction', {
        operationId: proxy.augmentationOperationId ?? null,
        x: Number(proxy.x),
        z: Number(proxy.z),
        baseElevation: Number(proxy.baseElevation ?? 0),
      })
    )),
    supplementalRoomIds: [...materializedLayout.supplementalRoomIds],
    supplementalConnectorJunctionIds: [
      ...materializedLayout.supplementalConnectorJunctionIds,
    ],
    supplementalConnectionIds: [...materializedLayout.supplementalConnectionIds],
    supplementalPhysicalConnectionIds: [
      ...materializedLayout.supplementalPhysicalConnectionIds,
    ],
    supplementalGraphOnlyConnectionIds: [
      ...materializedLayout.supplementalGraphOnlyConnectionIds,
    ],
    assemblyOverlayPlanRef: {
      schema: 'ruindivex-dungeon-augmentation-overlay-reference/v1',
      augmentationPlanHash: materializedLayout.assemblyOverlayPlan?.augmentationPlanHash,
    },
    diagnostics: {
      accepted: true,
      reason: materializedLayout.diagnostics?.reason ?? 'materialized',
      errors: [],
      routeNetworks: clone(materializedLayout.diagnostics?.routeNetworks ?? []),
    },
  };
}

function pickDefined(record, keys) {
  return Object.fromEntries(keys
    .filter((key) => record?.[key] !== undefined)
    .map((key) => [key, clone(record[key])]));
}

function normalizeFullMaterializedLayout(materializedLayout) {
  const layout = clone(materializedLayout);
  delete layout.assemblyOverlayPlan;
  layout.recordMode = 'full-records';
  layout.assemblyOverlayPlanRef = {
    schema: 'ruindivex-dungeon-augmentation-overlay-reference/v1',
    augmentationPlanHash: materializedLayout.assemblyOverlayPlan?.augmentationPlanHash,
  };
  for (const room of [
    ...(layout.rooms ?? []),
    ...(layout.connectorJunctionProxies ?? []),
  ]) {
    if (room.augmentationPhysicalRealization) {
      room.augmentationPhysicalRealization = pickDefined(
        room.augmentationPhysicalRealization,
        [
          'id', 'schema', 'roomId', 'nodeId', 'operationId', 'profileId',
          'moduleManifestId', 'moduleManifestSchema', 'blueprintId', 'blueprintSchema',
          'blueprintCanonicalRotationQuarterTurns', 'blueprintWorldRotationQuarterTurns',
          'grammarId', 'contentRole', 'floorMask', 'transfers',
          'stableRuntimeStateIds', 'themeBinding', 'authoritative', 'preRender',
        ],
      );
    }
    if (room.augmentationStructure) {
      room.augmentationStructure = pickDefined(room.augmentationStructure, [
        'id', 'roomId', 'nodeId', 'operationId', 'profileId', 'blueprintId',
        'sourceStructure', 'platforms', 'ramps', 'structureMetadata',
        'structuralQualityReport', 'themeBinding', 'authoritative', 'preRender',
      ]);
    }
  }
  return layout;
}

async function createAssetManifest() {
  const assets = [];
  for (const name of TEXTURE_NAMES) {
    const bytes = await readFile(path.join(
      repositoryRoot,
      'assets', 'textures', 'ruins', `${name}.png`,
    ));
    assets.push({
      id: `ruin-texture:${name}`,
      uri: `/assets/textures/ruins/${name}.png`,
      kind: 'texture',
      byteLength: bytes.byteLength,
      contentHash: `sha256-${createHash('sha256').update(bytes).digest('hex')}`,
    });
  }
  return {
    schema: DUNGEON_AUGMENTATION_AUTHORED_ASSET_MANIFEST_SCHEMA,
    assets,
  };
}

const seeded = new SeededRandom(hashSeed(AUTHORING_SEED));
const canonicalBaseRandomTape = [];
const generator = new DungeonGenerator({
  offlineAugmentationPlanner: augmentDungeonDraft,
  random: () => {
    const value = seeded.next();
    canonicalBaseRandomTape.push(value);
    return value;
  },
  difficulty: 1,
  augmentationProfileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  augmentationSeed: AUTHORING_SEED,
  basePlanHash: BASE_PLAN_HASH,
  augmentationRealizationAttemptLimit: 1,
});
const texture = new THREE.Texture();
generator.textureCache.set('authored-industrial-v4', texture);
generator._loadRuinTexture = () => texture;
const originalPlanIndustrialDungeonAugmentation =
  generator._planIndustrialDungeonAugmentation.bind(generator);
let capturedPlanningContext = null;
generator._planIndustrialDungeonAugmentation = (input) => {
  capturedPlanningContext = generator._createIndustrialDungeonAugmentationPlanningContext(input);
  return null;
};
const baseDungeon = generator._generateOnce();
generator._planIndustrialDungeonAugmentation = originalPlanIndustrialDungeonAugmentation;
if (!capturedPlanningContext) {
  throw new Error('Offline authoring did not capture the pre-commit Industrial planning seam.');
}
const base = {
  dungeon: baseDungeon,
  randomTape: canonicalBaseRandomTape,
};
const canonicalBaseDraft = clone(capturedPlanningContext.baseDraft);
const host = capturedPlanningContext.host;
let randomTapeCursor = 0;
generator.random = () => base.randomTape[randomTapeCursor++];
generator._augmentationReplayPlanningSnapshotOverride =
  clone(capturedPlanningContext.planningSnapshot);
const plannedResult = augmentDungeonDraft(capturedPlanningContext.plannerInput);
const planned = { status: plannedResult?.diagnostics?.accepted === true ? 'applied' : 'unchanged',
  result: plannedResult,
  diagnostics: plannedResult?.diagnostics };
if (planned.status !== 'applied') {
  throw new Error(`Offline authoring planner did not produce a complete plan: ${
    JSON.stringify(planned?.diagnostics ?? null)
  }`);
}
const mergedOverlayPlan = mergeRequiredAuthoredOperations(
  planned.result.overlayPlan,
  PREVIOUS_AUTHORED_SOURCE.overlayPlan,
);
const overlayPlan = convertAcceptedPlanToAuthoredOverlay(mergedOverlayPlan);
const composition = {
  operationCount: overlayPlan.operations.length,
  nodeCount: overlayPlan.nodes.length,
  segmentCount: overlayPlan.segments.length,
};
if (canonicalStringify(composition) !== canonicalStringify({
  operationCount: 5,
  nodeCount: 24,
  segmentCount: 26,
})) {
  throw new Error(`Authored composition drifted: ${JSON.stringify(composition)}`);
}
const materializedLayout = materializeIndustrialOverlay({
  rooms: clone(capturedPlanningContext.planningSnapshot.rooms),
  connectionPlans: clone(capturedPlanningContext.planningSnapshot.connectionPlans),
  overlayPlan,
  extensionRegions: clone(host.extensionRegions),
  tileSize: TILE_SIZE,
});
if (materializedLayout.diagnostics?.accepted !== true) {
  throw new Error(`Authored materialization failed: ${JSON.stringify(
    materializedLayout.diagnostics,
  )}`);
}
const correctedResult = clone(planned.result);
correctedResult.overlayPlan = overlayPlan;
correctedResult.effectiveDraft = clone(canonicalBaseDraft);
correctedResult.effectiveDraft.dungeonAugmentation = {
  schema: 'ruindivex-dungeon-augmentation-effective-draft/v1',
  basePlanHash: overlayPlan.basePlanHash,
  augmentationPlanHash: overlayPlan.augmentationPlanHash,
  effectivePlanHash: overlayPlan.effectivePlanHash,
  overlayPlan,
};
correctedResult.diagnostics = {
  ...correctedResult.diagnostics,
  augmentationPlanHash: overlayPlan.augmentationPlanHash,
  effectivePlanHash: overlayPlan.effectivePlanHash,
  warnings: [],
  errors: [],
};
const planningContext = generator._createIndustrialDungeonAugmentationPlanningContext({
  rooms: base.dungeon.rooms,
  connectionPlans: base.dungeon.connectionPlans,
  planningSnapshotOverride: generator._augmentationReplayPlanningSnapshotOverride,
});
randomTapeCursor = 0;
generator._preparedDungeonAugmentationPlanningResult = {
  requestKey: planningContext.requestKey,
  result: correctedResult,
  elapsedMs: 0,
};
const validatedDungeon = generator._generateOnce();
if (validatedDungeon.progression?.validation?.accepted !== true
  || (validatedDungeon.progression.validation.errors ?? []).length > 0) {
  throw new Error(`Authored renderer-free validation failed: ${JSON.stringify(
    validatedDungeon.progression?.validation ?? null,
  )}`);
}
const runtimeStateIds = collectRuntimeStateIds({
  overlayPlan,
  materializedLayout: compactMaterializedLayout(materializedLayout),
  progression: validatedDungeon.progression,
  encounters: validatedDungeon.encounters,
  rewards: validatedDungeon.chests,
  mechanisms: validatedDungeon.mechanisms,
});
const normalizedMaterializedLayout = normalizeFullMaterializedLayout(materializedLayout);
const source = {
  schema: DUNGEON_AUGMENTATION_AUTHORED_SOURCE_SCHEMA,
  artifactId: INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
  artifactRevision: INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
  profileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  profileRevision: INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
  gameplayTuningRevision: INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
  generationMode: INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
  canonicalLayoutSeed: INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  canonicalBaseDraft,
  canonicalBaseRandomTape: [...base.randomTape],
  overlayPlan,
  materializedLayout: normalizedMaterializedLayout,
  materializedLayoutDescriptors: compactMaterializedLayout(normalizedMaterializedLayout),
  renderBatches: collectRenderBatches(validatedDungeon),
  runtimeStateManifest: {
    schema: 'ruindivex-dungeon-augmentation-runtime-state-manifest/v1',
    ids: runtimeStateIds,
  },
  assetManifest: await createAssetManifest(),
  validationReceipt: {
    schema: DUNGEON_AUGMENTATION_AUTHORED_VALIDATION_RECEIPT_SCHEMA,
    accepted: true,
    errors: [],
    warnings: [],
    checks: {
      overlay: true,
      materialization: true,
      progression: true,
      traversal: true,
      presentation: true,
      seams: true,
      structuralFrames: true,
      verticalTransfers: true,
      returnRoutes: true,
      assets: true,
    },
    composition,
    authoringCorrection: {
      kind: 'boss-scaffold-safe-authored-placement',
      movedNodeOrdinals: [3, 4],
      deltaX: BOSS_SCAFFOLD_SAFE_SHIFT_METERS,
      rebuiltSegmentOrdinals: [4, 5, 6],
      transferGridRangeX: [-31, -29],
      bossScaffoldMinimumGridX: -28,
    },
  },
};
const outputText = `// Generated by scripts/author-industrial-v4-artifact-source.mjs.\n` 
  + `// Browser runtime must load only the compiled artifact, never this offline source.\n` 
  + `export const INDUSTRIAL_V4_AUTHORED_LEVEL_SOURCE = ${JSON.stringify(source)};\n`;
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, outputText, 'utf8');
generator._disposeGeneratedDungeonCandidate(validatedDungeon);
generator._disposeGeneratedDungeonCandidate(base.dungeon);
texture.dispose();
process.stdout.write(`${JSON.stringify({
  accepted: true,
  outputPath,
  composition,
  runtimeStateIdCount: runtimeStateIds.length,
  assetCount: source.assetManifest.assets.length,
  renderBatchCount: source.renderBatches.length,
  overlayPlanHash: overlayPlan.augmentationPlanHash,
})}\n`);
