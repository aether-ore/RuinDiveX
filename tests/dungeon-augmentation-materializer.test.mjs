import assert from 'node:assert/strict';
import test from 'node:test';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { DUNGEON_CONNECTOR_VARIANT_IDS } from '../src/DungeonConnectorVariants.js';
import { GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS } from '../src/dungeon-augmentation/catalog.js';
import {
  inspectIndustrialSupplementStoryPresentationLegality,
  materializeIndustrialOverlay,
} from '../src/dungeon-augmentation/IndustrialOverlayMaterializer.js';
import { hashCanonicalValue } from '../src/dungeon-augmentation/canonical.js';
import {
  INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS,
} from '../src/dungeon-augmentation/IndustrialSupplementContent.js';
import {
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST,
  resolveIndustrialSupplementBlueprint,
} from '../src/dungeon-augmentation/IndustrialSupplementBlueprintCatalog.js';
import {
  inspectIndustrialSupplementRealizedStructuralQuality,
} from '../src/dungeon-augmentation/IndustrialSupplementStructuralQuality.js';
import {
  INDUSTRIAL_SUPPLEMENT_V4_RUNTIME_CONTRACT_MODE,
  buildIndustrialSupplementAnchorPlacementRequests,
  resolveIndustrialSupplementAnchorPlacementRequests,
} from '../src/dungeon-augmentation/IndustrialSupplementRuntimeContracts.js';
import {
  createDungeonJunctionGeometryRecord,
  createDungeonRouteEndpointSeam,
  createDungeonSocketLandingOverlapVolume,
  dungeonLandmarkSharedThresholdParentPosition,
  dungeonVolumeOverlapWithinGrant,
  transformDungeonLocalPoint,
} from '../src/dungeon-augmentation/geometry.js';

const TILE_SIZE = 2.8;

function supplementNode({
  id = 'supplement:industrial-v1-main:edgePadding:0:node:0',
  operationId = 'supplement:industrial-v1-main:edgePadding:0:operation',
  center = { x: 0, y: 0, z: 0 },
  size = { x: 8.4, y: 5.6, z: 14 },
  rotationQuarterTurns = 0,
} = {}) {
  return {
    id,
    operationId,
    grammarId: 'supplement-gallery-bay-v1',
    topology: 'through-gallery',
    placement: { center, rotationQuarterTurns },
    size,
    sockets: [],
    anchors: [],
  };
}

function physicalBlueprintSocket(blueprint, socket, {
  center = { x: 0, y: 0, z: 0 },
  rotationQuarterTurns = 0,
} = {}) {
  const halfWidth = (blueprint.dimensionsTiles.width - 1) * TILE_SIZE * 0.5;
  const halfDepth = (blueprint.dimensionsTiles.depth - 1) * TILE_SIZE * 0.5;
  const apertureCenter = socket.center * TILE_SIZE;
  const localPosition = socket.side === 'N'
    ? { x: apertureCenter, y: socket.y, z: -halfDepth }
    : socket.side === 'S'
      ? { x: apertureCenter, y: socket.y, z: halfDepth }
      : socket.side === 'W'
        ? { x: -halfWidth, y: socket.y, z: apertureCenter }
        : { x: halfWidth, y: socket.y, z: apertureCenter };
  const localFacing = socket.side === 'N'
    ? { x: 0, y: 0, z: -1 }
    : socket.side === 'S'
      ? { x: 0, y: 0, z: 1 }
      : socket.side === 'W'
        ? { x: -1, y: 0, z: 0 }
        : { x: 1, y: 0, z: 0 };
  const position = transformDungeonLocalPoint(localPosition, {
    center,
    rotationQuarterTurns,
  });
  const facing = transformDungeonLocalPoint(localFacing, {
    center: { x: 0, y: 0, z: 0 },
    rotationQuarterTurns,
  });
  return {
    id: `test-socket:${socket.id}`,
    localSocketId: socket.id,
    blueprintSocketId: socket.id,
    localPosition,
    localFacing,
    position,
    facing,
    state: 'capped',
  };
}

function materializePhysicalBlueprintRoom(blueprintId, {
  center = { x: 0, y: 0, z: 0 },
  rotationQuarterTurns = 0,
  optionalPresentationEnabled = true,
  contentRole = null,
  includeLegacyDoorwayFrameAnchors = false,
} = {}) {
  const blueprint = resolveIndustrialSupplementBlueprint(blueprintId);
  assert.ok(blueprint, `${blueprintId} resolves`);
  const operationId = `test-operation:${blueprintId}`;
  const nodeId = `test-node:${blueprintId}`;
  const themeBinding = { themeId: 'industrial-v1', themeSessionId: 'transfer-test' };
  const stableRuntimeStateIds = Object.fromEntries([
    'encounter',
    'mechanism',
    'reward',
    'shortcut',
  ].map((kind) => [kind, `${operationId}:state:${kind}`]));
  const operation = {
    id: operationId,
    type: 'routeNetwork',
    themeBinding,
    stableRuntimeStateIds,
  };
  const sockets = blueprint.sockets.map((socket) => physicalBlueprintSocket(
    blueprint,
    socket,
    { center, rotationQuarterTurns },
  ));
  const node = {
    id: nodeId,
    operationId,
    kind: contentRole ? 'supplementRoom' : 'supplementPhysicalTest',
    grammarId: `test-grammar:${blueprintId}`,
    moduleKind: contentRole ? 'room' : null,
    contentRole,
    blueprintId,
    themeBinding,
    placement: {
      center,
      rotationQuarterTurns,
    },
    size: {
      x: blueprint.widthMeters,
      y: Math.max(8.4, Number(blueprint.upperY ?? 0) + 3.6),
      z: blueprint.depthMeters,
    },
    sockets,
    anchors: includeLegacyDoorwayFrameAnchors ? sockets.map((socket, index) => ({
      id: `${nodeId}:legacy-doorway-frame:${index}`,
      localAnchorId: `${socket.localSocketId}-frame`,
      kind: 'doorway-frame',
      assetRole: 'frame',
      position: { ...socket.position },
      facing: { ...socket.facing },
    })) : [],
    stableRuntimeStateIds,
  };
  const result = materializeIndustrialOverlay({
    overlayPlan: {
      difficulty: 2,
      optionalPresentationEnabled,
      operations: [operation],
      nodes: [node],
      segments: [],
    },
    tileSize: TILE_SIZE,
  });
  const room = result.rooms.find(({ id }) => id === nodeId);
  assert.ok(room, `${blueprintId} materializes: ${JSON.stringify(result.diagnostics.errors)}`);
  return { blueprint, room, result };
}

function materializePhysicalBlueprintNetwork(blueprintIds, {
  optionalPresentationEnabled = true,
} = {}) {
  const operationId = 'test-operation:multi-blueprint-story-network';
  const themeBinding = { themeId: 'industrial-v1', themeSessionId: 'story-network-test' };
  const stableRuntimeStateIds = Object.fromEntries([
    'encounter',
    'mechanism',
    'reward',
    'shortcut',
  ].map((kind) => [kind, `${operationId}:state:${kind}`]));
  const nodes = blueprintIds.map((blueprintId, index) => {
    const blueprint = resolveIndustrialSupplementBlueprint(blueprintId);
    assert.ok(blueprint, `${blueprintId} resolves`);
    const center = { x: index * TILE_SIZE * 40, y: 0, z: 0 };
    const nodeId = `test-node:story-network:${index}:${blueprintId}`;
    return {
      id: nodeId,
      operationId,
      kind: 'supplementPhysicalTest',
      grammarId: `test-grammar:${blueprintId}`,
      blueprintId,
      themeBinding,
      placement: { center, rotationQuarterTurns: 0 },
      size: {
        x: blueprint.widthMeters,
        y: Math.max(8.4, Number(blueprint.upperY ?? 0) + 3.6),
        z: blueprint.depthMeters,
      },
      sockets: blueprint.sockets.map((socket) => physicalBlueprintSocket(
        blueprint,
        socket,
        { center, rotationQuarterTurns: 0 },
      )),
      anchors: [],
      stableRuntimeStateIds,
    };
  });
  const result = materializeIndustrialOverlay({
    overlayPlan: {
      difficulty: 2,
      optionalPresentationEnabled,
      operations: [{
        id: operationId,
        type: 'routeNetwork',
        themeBinding,
        stableRuntimeStateIds,
      }],
      nodes,
      segments: [],
    },
    tileSize: TILE_SIZE,
  });
  const rooms = nodes.map(({ id }) => {
    const room = result.rooms.find((candidate) => candidate.id === id);
    assert.ok(room, `${id} materializes: ${JSON.stringify(result.diagnostics.errors)}`);
    return room;
  });
  return { result, rooms };
}

function exactLocalCell(cells, localTile, localElevation = null) {
  return (cells ?? []).filter((cell) => (
    Math.abs(Number(cell.localTile?.x) - Number(localTile?.x)) <= 0.000001
      && Math.abs(Number(cell.localTile?.z) - Number(localTile?.z)) <= 0.000001
      && (localElevation == null
        || Math.abs(Number(cell.localTile?.elevation) - Number(localElevation)) <= 0.000001)
  ));
}

function assertPointApproximatelyEqual(actual, expected, message) {
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(
      Math.abs(Number(actual?.[axis]) - Number(expected?.[axis])) <= 0.000001,
      `${message} ${axis}: expected ${expected?.[axis]}, received ${actual?.[axis]}`,
    );
  }
}

test('rotated half-grid blueprint cells retain distinct stable grid identities', () => {
  const { room: positiveRoom } = materializePhysicalBlueprintRoom('ind-junction-through-t-01', {
    // This exact V4 placement previously produced 71.39999999999999 and
    // 74.19999999999999 meter cells. Raw division collapsed both onto x=26.
    center: { x: 68.6, y: 28, z: 100.8 },
    rotationQuarterTurns: 1,
  });
  const { room: negativeRoom } = materializePhysicalBlueprintRoom('ind-junction-through-t-01', {
    center: { x: -68.6, y: 14, z: 44.8 },
    rotationQuarterTurns: 2,
  });
  const baseCells = positiveRoom.augmentationFloorTiers
    .find(({ id }) => id === 'base')
    ?.worldCells ?? [];
  const cellAt = (localX, localZ) => baseCells.find((cell) => (
    Number(cell.localTile?.x) === localX
      && Number(cell.localTile?.z) === localZ
  ));

  assert.deepEqual(
    [1, 2, 3].map((localZ) => cellAt(0, localZ)?.grid.x),
    [26, 27, 28],
  );
  assert.equal(
    new Set(baseCells.map(({ grid }) => `${grid.x},${grid.z}`)).size,
    baseCells.length,
  );
  const negativeBaseCells = negativeRoom.augmentationFloorTiers
    .find(({ id }) => id === 'base')
    ?.worldCells ?? [];
  const negativeCellAt = (localX, localZ) => negativeBaseCells.find((cell) => (
    Number(cell.localTile?.x) === localX
      && Number(cell.localTile?.z) === localZ
  ));
  assert.deepEqual(
    [-1, 0, 1].map((localX) => negativeCellAt(localX, -3)?.grid.x),
    [-23, -24, -25],
  );
  assert.equal(
    new Set(negativeBaseCells.map(({ grid }) => `${grid.x},${grid.z}`)).size,
    negativeBaseCells.length,
  );
});

test('calm discovery keeps log and cache on distinct rotated survey supports', () => {
  const semanticAnchors = new Map(
    INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS['calm-discovery'].anchors
      .map((anchor) => [anchor.id, anchor]),
  );
  assert.equal(semanticAnchors.get('discovery-log')?.kind, 'discovery');
  assert.equal(semanticAnchors.get('discovery-cache')?.kind, 'reward');

  const center = { x: 56, y: 14, z: -33.6 };
  let stableSupportIds = null;
  for (let rotationQuarterTurns = 0; rotationQuarterTurns < 4; rotationQuarterTurns += 1) {
    const { room } = materializePhysicalBlueprintRoom(
      'ind-room-survey-relay-cache-01',
      { center, rotationQuarterTurns, contentRole: 'discovery' },
    );
    const anchors = new Map(room.augmentationAnchors.map((anchor) => [
      anchor.localAnchorId,
      anchor,
    ]));
    const discoveryLog = anchors.get('discovery-log');
    const discoveryCache = anchors.get('discovery-cache');
    assert.ok(discoveryLog);
    assert.ok(discoveryCache);
    assert.equal(discoveryLog.blueprintFeatureId, 'src-survey-notes');
    assert.equal(discoveryCache.blueprintFeatureId, 'src-reward');
    assert.equal(discoveryLog.authoritativeBlueprintPlacement, true);
    assert.equal(discoveryCache.authoritativeBlueprintPlacement, true);
    assert.notEqual(discoveryLog.supportCellId, discoveryCache.supportCellId);
    assert.deepEqual(discoveryLog.localTile, { x: -2, z: -2, elevation: 0 });
    assert.deepEqual(discoveryCache.localTile, { x: 2, z: 0, elevation: 0 });

    const supportIds = [discoveryLog.supportCellId, discoveryCache.supportCellId];
    if (stableSupportIds == null) stableSupportIds = supportIds;
    else assert.deepEqual(supportIds, stableSupportIds);
    const expectedLogPosition = transformDungeonLocalPoint({
      x: -2 * TILE_SIZE,
      y: 0,
      z: -2 * TILE_SIZE,
    }, { center, rotationQuarterTurns });
    const expectedCachePosition = transformDungeonLocalPoint({
      x: 2 * TILE_SIZE,
      y: 0,
      z: 0,
    }, { center, rotationQuarterTurns });
    assert.deepEqual(discoveryLog.position, expectedLogPosition);
    assert.deepEqual(discoveryCache.position, expectedCachePosition);

    const built = buildIndustrialSupplementAnchorPlacementRequests({
      mode: INDUSTRIAL_SUPPLEMENT_V4_RUNTIME_CONTRACT_MODE,
      rooms: [room],
    });
    assert.equal(built.accepted, true, JSON.stringify(built.errors));
    const semanticRequests = built.requests.filter(({ localAnchorId }) => (
      ['discovery-log', 'discovery-cache'].includes(localAnchorId)
    ));
    assert.equal(semanticRequests.length, 2);
    const semanticRequestIds = new Set(semanticRequests.map(({ id }) => id));
    const resolved = resolveIndustrialSupplementAnchorPlacementRequests({
      mode: INDUSTRIAL_SUPPLEMENT_V4_RUNTIME_CONTRACT_MODE,
      requests: built.requests,
      floors: room.augmentationFloorTiers,
      zones: room.augmentationZones,
    });
    assert.equal(resolved.accepted, true, JSON.stringify(resolved.errors));
    assert.deepEqual(
      resolved.placements
        .filter(({ requestId }) => semanticRequestIds.has(requestId))
        .map(({ supportFloorCellId }) => supportFloorCellId)
        .sort(),
      [...supportIds].sort(),
    );
  }
});

test('switchgear reward binds its authored base cell outside the blueprint stair transfer', () => {
  const { room } = materializePhysicalBlueprintRoom(
    'ind-room-switchgear-cache-descent-01',
    { center: { x: 0, y: 14, z: 0 }, contentRole: 'treasure' },
  );
  const anchor = room.augmentationAnchors.find(({ localAnchorId }) => (
    localAnchorId === 'vault-reward'
  ));
  const floors = room.augmentationFloorTiers.flatMap((tier) => tier.worldCells ?? []);
  const support = floors.find(({ id }) => id === anchor?.supportCellId);
  const transfers = room.augmentationTransfers.flatMap((transfer) => (
    (transfer.worldCells ?? []).map((cell) => ({ transfer, cell }))
  ));
  const covering = transfers.filter(({ cell }) => (
    Number(cell.grid?.x) === Number(support?.grid?.x)
      && Number(cell.grid?.z) === Number(support?.grid?.z)
  ));
  assert.ok(anchor);
  assert.deepEqual(anchor.localTile, { x: 2, z: 2, elevation: 0 });
  assert.match(anchor.supportCellId, /:floor-tier:base:cell:2:2$/);
  assert.equal(support?.walkable, true);
  assert.deepEqual(covering, []);
});

test('V4 physical blueprints emit one source-bound presentation record without generic prop promotion', () => {
  let sourceFeatureCount = 0;
  let dormantGameplayReservationCount = 0;
  let delegatedTransferReservationCount = 0;
  for (const sourceBlueprint of INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST) {
    const { blueprint, room, result } = materializePhysicalBlueprintRoom(sourceBlueprint.id);
    const records = room.augmentationPresentationRecords;
    const sourceFeatureIds = blueprint.features.map(({ id }) => String(id)).sort();
    sourceFeatureCount += sourceFeatureIds.length;
    assert.equal(records.length, sourceFeatureIds.length, `${blueprint.id} one record per source`);
    assert.deepEqual(
      records.map(({ sourceFeatureId }) => sourceFeatureId).sort(),
      sourceFeatureIds,
      `${blueprint.id} exact source feature set`,
    );
    assert.equal(new Set(records.map(({ id }) => id)).size, records.length);
    assert.equal(new Set(records.map(({ sourceFeatureRuntimeId }) => (
      sourceFeatureRuntimeId
    ))).size, records.length);
    const collisionIds = new Set(room.augmentationCollisionRecords.map(({ id }) => String(id)));
    const anchorIds = new Set(room.augmentationAnchors.map(({ id }) => String(id)));
    const transferIds = new Set(room.augmentationTransfers.map(({ id }) => String(id)));
    for (const record of records) {
      assert.equal(
        record.schema,
        'ruindivex-industrial-supplement-presentation-record/v1',
      );
      assert.ok(record.collisionRecordIds.every((id) => collisionIds.has(String(id))));
      assert.ok(Number(record.authoredFootprint.widthMeters) > 0);
      assert.ok(Number(record.authoredFootprint.heightMeters) > 0);
      assert.ok(Number(record.authoredFootprint.depthMeters) > 0);
      assert.ok(Number.isFinite(Number(record.transform.rotationY)));
      const source = blueprint.features.find(({ id }) => String(id) === record.sourceFeatureId);
      assert.equal(record.authoredFootprint.widthMeters, Number(source.w ?? 1) * TILE_SIZE);
      assert.equal(record.authoredFootprint.depthMeters, Number(source.d ?? 1) * TILE_SIZE);
      assert.equal(record.realizationOwner, record.presentationOwner);
      assert.equal(record.realizationRequired, true);
      assert.equal(
        record.renderedBySupplementAssembler,
        record.presentationOwner === 'supplement-assembler'
          && record.selectedForRendering === true,
      );
      if (record.sourceFeatureType !== 'story') {
        assert.equal(record.required, true);
        assert.equal(record.optional, false);
        assert.equal(record.realizationRequired, true);
      }
      if (['cover', 'machine'].includes(record.sourceFeatureType)) {
        assert.equal(record.presentationOwner, 'supplement-assembler');
        assert.equal(record.required, true);
        assert.equal(record.selectedForRendering, true);
        assert.ok(record.collisionRecordIds.length > 0);
        assert.equal(
          record.presentationAssetRole,
          record.sourceFeatureType === 'cover' ? 'gameplayCover' : 'machineryLandmark',
        );
        assert.equal(record.realizationKind, 'theme-object-root');
        assert.deepEqual(record.ownerBindingIds, []);
        assert.equal(record.runtimeActivation, 'not-applicable');
      } else if (['control', 'hazard', 'reward', 'spawn'].includes(
        record.sourceFeatureType,
      )) {
        dormantGameplayReservationCount += 1;
        assert.equal(record.presentationOwner, 'gameplay-runtime');
        assert.equal(record.realizationKind, 'gameplay-anchor');
        assert.equal(record.ownerBindingIds.length, 1);
        assert.ok(anchorIds.has(record.ownerBindingIds[0]));
        assert.equal(record.runtimeActivation, 'dormant');
        assert.deepEqual(record.runtimeConsumerBindingIds, []);
        assert.equal(record.selectedForRendering, false);
      } else if (record.sourceFeatureType === 'transfer') {
        delegatedTransferReservationCount += 1;
        assert.equal(record.presentationOwner, 'supplement-connector-assembler');
        assert.equal(record.realizationKind, 'physical-transfer');
        assert.equal(record.ownerBindingIds.length, 1);
        assert.ok(transferIds.has(record.ownerBindingIds[0]));
        assert.equal(record.runtimeActivation, 'not-applicable');
        assert.deepEqual(record.runtimeConsumerBindingIds, []);
        assert.equal(record.selectedForRendering, false);
      }
    }
    const assemblyNode = result.assemblyOverlayPlan.nodes.find(({ id }) => id === room.id);
    assert.deepEqual(assemblyNode.presentationRecords, records);
    assert.equal(assemblyNode.anchors.some((anchor) => (
      anchor.isManifestCover === true
        || anchor.isManifestLandmark === true
        || (anchor.assetRole === 'prop' && anchor.sourceRecordId)
    )), false, `${blueprint.id} has no generic authored-solid prop path`);
  }
  assert.ok(sourceFeatureCount > 100);
  assert.ok(dormantGameplayReservationCount > 0);
  assert.ok(delegatedTransferReservationCount > 0);
});

test('V4 assembly strips legacy per-socket doorway frames while retaining source metadata', () => {
  const { room, result } = materializePhysicalBlueprintRoom(
    'ind-junction-through-t-01',
    { includeLegacyDoorwayFrameAnchors: true },
  );
  const sourceDoorwayFrames = room.augmentationAnchors.filter((anchor) => (
    String(anchor.kind ?? anchor.type ?? '') === 'doorway-frame'
  ));
  assert.equal(sourceDoorwayFrames.length, room.augmentationSocketRecords.length);

  const assemblyNode = result.assemblyOverlayPlan.nodes.find(({ id }) => id === room.id);
  assert.ok(assemblyNode);
  assert.equal(assemblyNode.authoritativeBlueprintRealization, true);
  assert.deepEqual(
    assemblyNode.anchors.filter((anchor) => (
      String(anchor.kind ?? anchor.type ?? '') === 'doorway-frame'
    )),
    [],
  );
  assert.equal(
    assemblyNode.anchors.some(({ assetRole }) => assetRole === 'frame'),
    false,
  );
});

test('optional story decoration uses isolated deterministic selection without gameplay drift', () => {
  const blueprintId = 'ind-room-switchgear-cache-descent-01';
  const enabled = materializePhysicalBlueprintRoom(blueprintId, {
    optionalPresentationEnabled: true,
  });
  const replay = materializePhysicalBlueprintRoom(blueprintId, {
    optionalPresentationEnabled: true,
  });
  const disabled = materializePhysicalBlueprintRoom(blueprintId, {
    optionalPresentationEnabled: false,
  });
  const storyRecords = (entry) => entry.room.augmentationPresentationRecords.filter((record) => (
    record.semanticRole === 'story-marking'
  ));
  assert.equal(storyRecords(enabled).length, 1);
  assert.equal(storyRecords(enabled).filter(({ selectedForRendering }) => selectedForRendering).length, 1);
  assert.deepEqual(storyRecords(replay), storyRecords(enabled));
  assert.equal(storyRecords(disabled).filter(({ selectedForRendering }) => selectedForRendering).length, 0);
  assert.equal(storyRecords(enabled)[0].optional, true);
  assert.equal(storyRecords(enabled)[0].nonblocking, true);
  assert.equal(storyRecords(enabled)[0].presentationSurface, 'floor-flush-decal');
  assert.equal(storyRecords(enabled)[0].storyPlacementLegal, true);
  assert.equal(storyRecords(disabled)[0].selectionStatus, 'optional-decoration-disabled');
  assert.equal(
    storyRecords(disabled)[0].storySelectionHash,
    storyRecords(enabled)[0].storySelectionHash,
  );

  for (const field of [
    'augmentationCollisionRecords',
    'augmentationFloorTiers',
    'augmentationClearRoutes',
    'augmentationZones',
    'augmentationAnchors',
    'augmentationTransfers',
    'augmentationBlueprintFeatures',
    'augmentationBlueprintStateRecords',
  ]) {
    assert.deepEqual(disabled.room[field], enabled.room[field], `${field} remains invariant`);
  }
});

test('story selection stably chooses exactly one of two legal candidates in one route network', () => {
  const blueprintIds = [
    'ind-room-switchgear-cache-descent-01',
    'ind-room-switchgear-cache-descent-01',
  ];
  const enabled = materializePhysicalBlueprintNetwork(blueprintIds, {
    optionalPresentationEnabled: true,
  });
  const replay = materializePhysicalBlueprintNetwork(blueprintIds, {
    optionalPresentationEnabled: true,
  });
  const disabled = materializePhysicalBlueprintNetwork(blueprintIds, {
    optionalPresentationEnabled: false,
  });
  const storyRecords = (entry) => entry.rooms.flatMap((room) => (
    room.augmentationPresentationRecords.filter(({ semanticRole }) => (
      semanticRole === 'story-marking'
    ))
  )).sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const enabledStories = storyRecords(enabled);
  const replayStories = storyRecords(replay);
  const disabledStories = storyRecords(disabled);

  assert.equal(enabledStories.length, 2);
  assert.equal(enabledStories.every(({ storyPlacementLegal }) => storyPlacementLegal === true), true);
  assert.equal(enabledStories.every(({ storySelectionCandidateCount }) => (
    storySelectionCandidateCount === 2
  )), true);
  assert.equal(enabledStories.filter(({ selectedForRendering }) => selectedForRendering).length, 1);
  assert.deepEqual(replayStories, enabledStories);
  assert.equal(disabledStories.filter(({ selectedForRendering }) => selectedForRendering).length, 0);
  assert.deepEqual(
    disabledStories.map(({ storySelectionHash }) => storySelectionHash),
    enabledStories.map(({ storySelectionHash }) => storySelectionHash),
  );
  assert.equal(new Set(enabledStories.map(({ storySelectionHash }) => storySelectionHash)).size, 1);
});

test('story placement rejects every protected gameplay class including authoritative sightlines', () => {
  const record = {
    id: 'story-candidate',
    operationId: 'story-operation',
    collisionRecordIds: [],
    transform: { position: { x: 0, y: 0, z: 0 } },
    worldFootprint: { widthMeters: 0.5, depthMeters: 0.5 },
  };
  const emptyRoom = () => ({
    augmentationCollisionRecords: [],
    augmentationProtectedSightlines: [],
    augmentationZones: [],
    augmentationTransfers: [],
    augmentationAnchors: [],
    augmentationSocketRecords: [],
  });
  const atCandidate = { x: 0, y: 0, z: 0 };
  const cases = [
    {
      name: 'blocking solid',
      room: {
        augmentationCollisionRecords: [{
          id: 'solid', blocking: true, center: atCandidate, size: { x: 1, z: 1 },
        }],
      },
      reason: 'collision:solid',
    },
    {
      name: 'authored void',
      room: {
        augmentationCollisionRecords: [{
          id: 'void', excludesFloor: true, center: atCandidate, size: { x: 1, z: 1 },
        }],
      },
      reason: 'collision:void',
    },
    {
      name: 'clear route',
      room: {
        augmentationZones: [{
          id: 'clear-route', zoneKind: 'clear', worldCells: [{ position: atCandidate }],
        }],
      },
      reason: 'dilated-zone:clear-route',
    },
    {
      name: 'hazard envelope',
      room: {
        augmentationZones: [{
          id: 'hazard', zoneKind: 'hazard', worldCells: [{ position: atCandidate }],
        }],
      },
      reason: 'dilated-zone:hazard',
    },
    {
      name: 'physical traversal',
      room: {
        augmentationTransfers: [{ id: 'transfer', worldCells: [{ position: atCandidate }] }],
      },
      reason: 'dilated-transfer:transfer',
    },
    ...['spawn', 'control', 'reward'].map((kind) => ({
      name: `${kind} anchor`,
      room: {
        augmentationAnchors: [{ id: `${kind}-anchor`, kind, position: atCandidate }],
      },
      reason: `anchor:${kind}-anchor`,
    })),
    {
      name: 'socket landing',
      room: {
        augmentationSocketRecords: [{
          id: 'socket', runtimeId: 'socket', position: atCandidate, widthMeters: TILE_SIZE,
        }],
      },
      reason: 'socket-landing:socket',
    },
    {
      name: 'endpoint seam',
      connectionPlans: [{
        id: 'connection',
        operationId: 'story-operation',
        endpointSeams: [{
          id: 'seam',
          orderedCells: [{ gridX: 0, gridZ: 0 }],
        }],
      }],
      reason: 'endpoint-seam:seam',
    },
    {
      name: 'authoritative protected sightline',
      room: {
        augmentationProtectedSightlines: [{
          id: 'sightline',
          sightlineId: 'entry-to-focal-landmark',
          protectionKind: 'required-sightline',
          authoritative: true,
          worldCells: [{
            position: atCandidate,
            widthMeters: TILE_SIZE,
            depthMeters: TILE_SIZE,
          }],
        }],
      },
      reason: 'protected-sightline:entry-to-focal-landmark',
    },
  ];

  assert.deepEqual(inspectIndustrialSupplementStoryPresentationLegality({
    room: emptyRoom(),
    record,
    tileSize: TILE_SIZE,
  }), { legal: true, reasons: [] });
  for (const fixture of cases) {
    const inspection = inspectIndustrialSupplementStoryPresentationLegality({
      room: { ...emptyRoom(), ...(fixture.room ?? {}) },
      record,
      effectiveConnections: fixture.connectionPlans ?? [],
      tileSize: TILE_SIZE,
    });
    assert.equal(inspection.legal, false, fixture.name);
    assert.ok(inspection.reasons.includes(fixture.reason), fixture.name);
  }

  const advisorySightline = emptyRoom();
  advisorySightline.augmentationProtectedSightlines = [{
    id: 'advisory-sightline',
    sightlineId: 'advisory',
    protectionKind: 'required-sightline',
    authoritative: false,
    worldCells: [{ position: atCandidate }],
  }];
  assert.equal(inspectIndustrialSupplementStoryPresentationLegality({
    room: advisorySightline,
    record,
    tileSize: TILE_SIZE,
  }).legal, true);
});

test('optional decoration leaves representative final gameplay contract hashes unchanged', () => {
  const representativeBlueprintIds = [
    'ind-room-switchgear-cache-descent-01',
    'ind-room-reaverbot-foundry-01',
    'ind-rise-long-freight-ramp-01',
  ];
  const materializeSet = (optionalPresentationEnabled) => representativeBlueprintIds.map(
    (blueprintId, index) => materializePhysicalBlueprintRoom(blueprintId, {
      center: { x: index * TILE_SIZE * 20, y: 0, z: 0 },
      optionalPresentationEnabled,
    }).room,
  );
  const finalGameplayContract = (rooms) => {
    const generator = new DungeonGenerator({
      random: () => {
        throw new Error('representative gameplay contract must not consume RNG');
      },
    });
    const floorTiles = rooms.flatMap((room) => [
      ...room.augmentationFloorTiers.flatMap((tier) => tier.worldCells.map((cell) => ({
        id: cell.id,
        x: cell.grid.x,
        z: cell.grid.z,
        elevation: cell.elevation,
        roomId: room.id,
        surface: 'industrialSupplementTier',
        augmentationFloorCellId: cell.id,
        augmentationFloorTierId: tier.id,
        augmentationFloorTierRuntimeId: tier.runtimeId,
      }))),
      ...room.augmentationTransfers.flatMap((transfer) => transfer.worldCells.map((cell) => ({
        id: cell.id,
        x: cell.grid.x,
        z: cell.grid.z,
        elevation: cell.elevation,
        roomId: room.id,
        surface: transfer.form === 'ramp' ? 'industrialRamp' : 'industrialTransfer',
        isPlatformingSurface: true,
        augmentationTransferCellId: cell.id,
        augmentationTransferId: transfer.id,
        rampStartElevation: transfer.worldElevationRange?.from,
        rampEndElevation: transfer.worldElevationRange?.to,
      }))),
    ]);
    generator._annotateDungeonSupplementWalkabilityIntent(floorTiles, rooms);
    const solids = generator._createDungeonSupplementManifestSolidZones(rooms);
    const navigation = rooms.flatMap((room) => {
      const roomFloors = floorTiles.filter((floor) => floor.roomId === room.id);
      const walkableFloors = roomFloors.filter((floor) => (
        floor.walkabilityIntent !== 'support-only'
          && !generator._isFloorTileBlockedBySolidZone(floor, solids)
      ));
      const start = [...walkableFloors].sort((left, right) => (
        String(left.id).localeCompare(String(right.id))
      ))[0];
      const reachable = start
        ? generator._createReachableFloorTileKeySet(start, walkableFloors)
        : new Set();
      const returnable = start
        ? generator._createFloorTileKeySetThatCanReach(start, walkableFloors)
        : new Set();
      return roomFloors.map((floor) => {
        const floorKey = generator._getFloorTileGraphKey(floor);
        return {
          id: floor.id,
          roomId: floor.roomId,
          grid: { x: floor.x, z: floor.z },
          elevation: floor.elevation,
          surface: floor.surface,
          walkabilityIntent: floor.walkabilityIntent ?? null,
          blocked: generator._isFloorTileBlockedBySolidZone(floor, solids),
          reachable: reachable.has(floorKey),
          returnable: returnable.has(floorKey),
        };
      });
    }).sort((left, right) => left.id.localeCompare(right.id));
    const navigationById = new Map(navigation.map((floor) => [String(floor.id), floor]));
    const anchorRoles = rooms.flatMap((room) => room.augmentationAnchors.map((anchor) => ({
      id: anchor.id,
      roomId: room.id,
      sourceFeatureId: anchor.sourceFeatureId ?? null,
      blueprintFeatureType: anchor.blueprintFeatureType ?? null,
      kind: anchor.kind ?? null,
      spatialRole: anchor.spatialRole ?? null,
      supportCellId: anchor.supportCellId ?? null,
      runtimeStateId: anchor.runtimeStateId ?? null,
      encounterRecipeId: anchor.encounterRecipe?.id ?? null,
      mechanismRecipeId: anchor.mechanismRecipe?.id ?? null,
      rewardRecipeId: anchor.rewardRecipe?.id ?? null,
      position: anchor.position ?? anchor.worldPosition ?? null,
    }))).sort((left, right) => left.id.localeCompare(right.id));
    const runtimeRoleBindings = rooms.flatMap((room) => (
      room.augmentationPresentationRecords
        .filter(({ presentationOwner }) => presentationOwner === 'gameplay-runtime')
        .map((record) => ({
          id: record.id,
          semanticRole: record.semanticRole,
          ownerBindingIds: record.ownerBindingIds,
          runtimeConsumerBindingIds: record.runtimeConsumerBindingIds,
          runtimeActivation: record.runtimeActivation,
        }))
    )).sort((left, right) => left.id.localeCompare(right.id));
    const spawns = anchorRoles.filter(({ blueprintFeatureType }) => (
      blueprintFeatureType === 'spawn'
    )).map((anchor) => ({
      ...anchor,
      supportWalkability: navigationById.get(String(anchor.supportCellId)) ?? null,
    }));
    const collision = solids.map((solid) => ({
      id: solid.id,
      roomId: solid.roomId ?? null,
      sourceKind: solid.sourceKind ?? null,
      sourceId: solid.sourceId ?? null,
      center: solid.center,
      size: solid.size,
      blocking: solid.blocking !== false,
      excludesFloor: solid.excludesFloor === true,
      occupiedSupportCellIds: solid.occupiedSupportCellIds ?? [],
    })).sort((left, right) => left.id.localeCompare(right.id));
    const traversal = rooms.flatMap((room) => [
      ...room.augmentationTransfers.map((transfer) => ({
        kind: 'transfer',
        id: transfer.id,
        form: transfer.form,
        endpointSupportCellIds: transfer.endpointSupportCellIds,
        worldConnectivityEdges: transfer.worldConnectivityEdges,
        worldElevationRange: transfer.worldElevationRange,
      })),
      ...room.augmentationClearRoutes.map((route) => ({
        kind: 'clear-route',
        id: route.runtimeId ?? route.id,
        traversal: route.traversal,
        worldCellIds: route.worldCellIds,
        worldConnectivityEdgeIds: route.worldConnectivityEdgeIds,
      })),
      ...room.augmentationFloorTiers.map((tier) => ({
        kind: 'floor-connectivity',
        id: tier.runtimeId ?? tier.id,
        worldConnectivityEdges: tier.worldConnectivityEdges,
      })),
    ]).sort((left, right) => left.id.localeCompare(right.id));
    assert.ok(collision.length > 0, 'collision projection is representative');
    assert.ok(navigation.length > 0 && navigation.some(({ reachable }) => reachable));
    assert.ok(anchorRoles.length > 0 && runtimeRoleBindings.length > 0);
    assert.ok(spawns.length > 0 && spawns.every(({ supportWalkability }) => supportWalkability));
    assert.ok(traversal.length > 0);
    const projections = {
      collision,
      navigation,
      anchors: { anchorRoles, runtimeRoleBindings },
      spawn: spawns,
      traversal,
    };
    const hashes = Object.fromEntries(Object.entries(projections).map(([name, value]) => [
      name,
      hashCanonicalValue(value, {
        namespace: `ruindivex-industrial-optional-decoration-${name}/v1`,
      }),
    ]));
    return {
      hashes,
      combinedHash: hashCanonicalValue(hashes, {
        namespace: 'ruindivex-industrial-optional-decoration-gameplay-contract/v1',
      }),
    };
  };

  const enabled = finalGameplayContract(materializeSet(true));
  const disabled = finalGameplayContract(materializeSet(false));
  assert.deepEqual(enabled.hashes, disabled.hashes);
  assert.equal(enabled.combinedHash, disabled.combinedHash);
  assert.ok(Object.values(enabled.hashes).every((hash) => /^v1-[0-9a-f]{32}$/.test(hash)));
});

test('V4 physical transfer endpoints resolve only their exact authored support identities', () => {
  let endpointCount = 0;
  let floorSupportCount = 0;
  let transferSupportCount = 0;

  for (const sourceBlueprint of INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST.filter((blueprint) => (
    blueprint.physicalTransfers.length > 0
  ))) {
    const { blueprint, room } = materializePhysicalBlueprintRoom(sourceBlueprint.id);
    const realizedTransferById = new Map(room.augmentationTransfers.map((transfer) => (
      [transfer.localTransferId, transfer]
    )));
    assert.equal(realizedTransferById.size, blueprint.physicalTransfers.length);

    for (const sourceTransfer of blueprint.physicalTransfers) {
      const realizedTransfer = realizedTransferById.get(sourceTransfer.id);
      assert.ok(realizedTransfer, `${blueprint.id}/${sourceTransfer.id} realizes`);
      for (const role of ['from', 'to']) {
        endpointCount += 1;
        const sourceEndpoint = sourceTransfer.endpoints[role];
        const endpoint = realizedTransfer.worldEndpoints[role];
        const ownCells = exactLocalCell(
          realizedTransfer.worldCells,
          sourceEndpoint.localTransferCell,
        );
        assert.equal(
          ownCells.length,
          1,
          `${blueprint.id}/${sourceTransfer.id}/${role} exact own transfer cell`,
        );
        assert.equal(endpoint.transferCellId, ownCells[0].id);
        assert.deepEqual(endpoint.authoredLocalTransferCell, sourceEndpoint.localTransferCell);
        assert.deepEqual(endpoint.localSupportRef, sourceEndpoint.localSupportRef);

        const support = sourceEndpoint.localSupportRef;
        if (support.kind === 'floor-cell') {
          floorSupportCount += 1;
          const tier = room.augmentationFloorTiers.find(({ id }) => (
            id === support.floorTierId
          ));
          const floorCells = exactLocalCell(tier?.worldCells, support.localTile);
          assert.equal(
            floorCells.length,
            1,
            `${blueprint.id}/${sourceTransfer.id}/${role} exact floor support`,
          );
          assert.equal(endpoint.floorCellId, floorCells[0].id);
          assert.equal(endpoint.floorTierRuntimeId, tier.runtimeId);
          assert.equal(endpoint.adjacentTransferCellId, null);
          assert.equal(endpoint.supportCellId, floorCells[0].id);
        } else {
          transferSupportCount += 1;
          const supportingTransfer = realizedTransferById.get(support.transferId);
          const transferCells = exactLocalCell(
            supportingTransfer?.worldCells,
            support.localTile,
            endpoint.localElevation,
          );
          assert.equal(
            transferCells.length,
            1,
            `${blueprint.id}/${sourceTransfer.id}/${role} exact transfer support`,
          );
          assert.equal(endpoint.floorCellId, null);
          assert.equal(endpoint.adjacentTransferCellId, transferCells[0].id);
          assert.equal(endpoint.supportCellId, transferCells[0].id);
          assert.equal(endpoint.adjacentTransferRuntimeId, supportingTransfer.id);
        }
        assert.deepEqual(endpoint.supportRef, {
          kind: support.kind,
          id: endpoint.supportCellId,
        });
        assert.deepEqual(endpoint.supportCellIds, [endpoint.supportCellId]);
        assert.equal(endpoint.supportReachable, true);
      }
    }
  }

  assert.equal(endpointCount, 54);
  assert.equal(floorSupportCount, 42);
  assert.equal(transferSupportCount, 12);
});

test('all 16 elevation blueprints retain exact endpoints through rotations and mirrored traversal', () => {
  const elevationBlueprintIds = new Set([
    'ind-room-ladder-defense-rise-01',
    'ind-room-lift-defense-rise-01',
    'ind-room-compact-ramp-defense-rise-01',
    'ind-room-maintenance-rise-01',
    'ind-rise-switchback-ramp-01',
    'ind-rise-stair-cascade-01',
    'ind-rise-freight-lift-dogleg-01',
    'ind-rise-ladder-bridge-01',
    'ind-room-turbine-helix-01',
    'ind-room-floodgate-descent-01',
    'ind-room-crane-gantry-lift-01',
    'ind-room-pressure-lock-reward-rise-01',
    'ind-room-pressure-lock-reward-descent-01',
    'ind-room-switchgear-cache-descent-01',
    'ind-rise-long-freight-ramp-01',
    'ind-room-inclined-sorter-01',
  ]);
  const elevationBlueprints = INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST.filter(({ id }) => (
    elevationBlueprintIds.has(id)
  ));
  assert.equal(elevationBlueprints.length, 16);

  const center = { x: 137.2, y: -8.4, z: -53.2 };
  let realizedVariantCount = 0;
  let checkedEndpointCount = 0;

  for (const sourceBlueprint of elevationBlueprints) {
    for (let rotationQuarterTurns = 0; rotationQuarterTurns < 4; rotationQuarterTurns += 1) {
      const { blueprint, room } = materializePhysicalBlueprintRoom(sourceBlueprint.id, {
        center,
        rotationQuarterTurns,
      });
      const realizedTransferById = new Map(room.augmentationTransfers.map((transfer) => (
        [transfer.localTransferId, transfer]
      )));

      for (const sourceTransfer of blueprint.physicalTransfers) {
        const realizedTransfer = realizedTransferById.get(sourceTransfer.id);
        assert.ok(realizedTransfer, `${blueprint.id}/${sourceTransfer.id} realizes`);

        // The physical contract is bidirectional. Reversing traversal swaps
        // the exposed endpoint order; it must not rebuild, round, or otherwise
        // mutate either accepted endpoint identity.
        for (const mirroredTraversal of [false, true]) {
          realizedVariantCount += 1;
          const orderedRoles = mirroredTraversal ? ['to', 'from'] : ['from', 'to'];
          const orderedEndpoints = orderedRoles.map((role) => {
            checkedEndpointCount += 1;
            const sourceEndpoint = sourceTransfer.endpoints[role];
            const endpoint = realizedTransfer.worldEndpoints[role];
            const transferCell = realizedTransfer.worldCells.find(({ id }) => (
              id === endpoint.transferCellId
            ));
            assert.ok(
              transferCell,
              `${blueprint.id}/${sourceTransfer.id}/${role}/r${rotationQuarterTurns} transfer cell`,
            );
            assert.deepEqual(
              endpoint.authoredLocalTransferCell,
              sourceEndpoint.localTransferCell,
              `${blueprint.id}/${sourceTransfer.id}/${role}/r${rotationQuarterTurns} local identity`,
            );
            assert.deepEqual(
              endpoint.position,
              transformDungeonLocalPoint({
                x: Number(sourceEndpoint.localTransferCell.x) * TILE_SIZE,
                y: Number(sourceEndpoint.localElevation),
                z: Number(sourceEndpoint.localTransferCell.z) * TILE_SIZE,
              }, {
                center,
                rotationQuarterTurns,
              }),
              `${blueprint.id}/${sourceTransfer.id}/${role}/r${rotationQuarterTurns} world identity`,
            );
            assert.deepEqual(
              endpoint.supportPosition,
              sourceEndpoint.localSupportRef.kind === 'floor-cell'
                ? room.augmentationFloorTiers
                  .find(({ id }) => id === sourceEndpoint.localSupportRef.floorTierId)
                  ?.worldCells.find(({ id }) => id === endpoint.supportCellId)?.position
                : realizedTransferById
                  .get(sourceEndpoint.localSupportRef.transferId)
                  ?.worldCells.find(({ id }) => id === endpoint.supportCellId)?.position,
              `${blueprint.id}/${sourceTransfer.id}/${role}/r${rotationQuarterTurns} support identity`,
            );
            assert.deepEqual(endpoint.supportRef, {
              kind: sourceEndpoint.localSupportRef.kind,
              id: endpoint.supportCellId,
            });
            assert.deepEqual(endpoint.supportCellIds, [endpoint.supportCellId]);
            assert.equal(endpoint.supportReachable, true);
            return endpoint;
          });
          assert.deepEqual(
            orderedEndpoints.map(({ role }) => role),
            orderedRoles,
            `${blueprint.id}/${sourceTransfer.id}/r${rotationQuarterTurns} mirrored endpoint order`,
          );
          assert.ok(
            Math.abs(
              (orderedEndpoints[1].elevation - orderedEndpoints[0].elevation)
                + (mirroredTraversal ? 1 : -1)
                  * (realizedTransfer.toElevation - realizedTransfer.fromElevation),
            ) <= 0.000001,
            `${blueprint.id}/${sourceTransfer.id}/r${rotationQuarterTurns} mirrored elevation delta`,
          );
        }
      }
    }
  }

  assert.equal(realizedVariantCount, 184);
  assert.equal(checkedEndpointCount, 368);
});

test('exact transfer refs cover offset ramps, half-grid lifts, and intermediate landings', () => {
  const foundry = materializePhysicalBlueprintRoom('ind-room-reaverbot-foundry-01').room;
  const foundryEndpoint = foundry.augmentationTransfers[0].worldEndpoints.from;
  assert.deepEqual(foundryEndpoint.localTile, { x: 4, z: 4, elevation: 0 });
  assert.deepEqual(foundryEndpoint.supportLocalTile, { x: 4, z: 2, elevation: 0 });

  const lift = materializePhysicalBlueprintRoom('ind-room-lift-defense-rise-01').room;
  const liftEndpoint = lift.augmentationTransfers[0].worldEndpoints.from;
  assert.deepEqual(liftEndpoint.authoredLocalTransferCell, { x: -2.5, z: -0.5 });
  assert.deepEqual(liftEndpoint.supportLocalTile, { x: -2, z: 0, elevation: 0 });

  const switchback = materializePhysicalBlueprintRoom('ind-rise-switchback-ramp-01').room;
  const lowerFlight = switchback.augmentationTransfers.find(({ localTransferId }) => (
    localTransferId === 'sr-flight-lower'
  ));
  const landing = switchback.augmentationTransfers.find(({ localTransferId }) => (
    localTransferId === 'sr-mid-landing'
  ));
  const intermediateEndpoint = lowerFlight.worldEndpoints.to;
  const exactLandingCell = exactLocalCell(
    landing.worldCells,
    { x: -2, z: -0.5 },
    1.4,
  )[0];
  assert.ok(exactLandingCell);
  assert.equal(intermediateEndpoint.floorCellId, null);
  assert.equal(intermediateEndpoint.adjacentTransferCellId, exactLandingCell.id);
  assert.equal(intermediateEndpoint.supportCellId, exactLandingCell.id);
});

test('lift-defense solids preserve every unoccupied floor and the reopened east route', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });

  for (let rotationQuarterTurns = 0; rotationQuarterTurns < 4; rotationQuarterTurns += 1) {
    const { blueprint, room } = materializePhysicalBlueprintRoom(
      'ind-room-lift-defense-rise-01',
      { rotationQuarterTurns },
    );
    const featureById = new Map(blueprint.features.map((feature) => [feature.id, feature]));
    assert.deepEqual(
      ['lft-hoist-motor', 'lft-cover-east'].map((id) => {
        const feature = featureById.get(id);
        return [feature.x, feature.z];
      }),
      [[4, 2], [4, 3]],
    );

    const floorTiles = room.augmentationFloorTiers.flatMap((tier) => (
      tier.worldCells.map((cell) => ({
        x: cell.grid.x,
        z: cell.grid.z,
        elevation: cell.elevation,
        roomId: room.id,
        surface: 'industrialSupplementTier',
        augmentationFloorCellId: cell.id,
        augmentationFloorTierId: tier.id,
        augmentationFloorTierRuntimeId: tier.runtimeId,
        localTile: cell.localTile,
      }))
    ));
    const floorBySupportId = new Map(floorTiles.map((floor) => (
      [String(floor.augmentationFloorCellId), floor]
    )));
    const lift = room.augmentationTransfers.find(({ localTransferId }) => (
      localTransferId === 'lft-cargo-lift'
    ));
    const fromFloor = floorBySupportId.get(String(lift.worldEndpoints.from.supportCellId));
    const toFloor = floorBySupportId.get(String(lift.worldEndpoints.to.supportCellId));
    assert.ok(fromFloor && toFloor, 'the lift keeps exact floor-backed endpoints');
    const lowerApproach = floorTiles.find(({ localTile }) => (
      localTile.x === -2 && localTile.z === 1 && localTile.elevation === 0
    ));
    const upperApproach = floorTiles.find(({ localTile }) => (
      localTile.x === -2 && localTile.z === -1 && localTile.elevation === 2.8
    ));
    assert.ok(lowerApproach && upperApproach, 'the lift retains both clear approach floors');
    lowerApproach.traversalLinks = [{
      id: `${lift.id}:forward`,
      action: 'automatic_lift',
      toFloorKey: generator._getFloorTileGraphKey(upperApproach),
    }];
    upperApproach.traversalLinks = [{
      id: `${lift.id}:reverse`,
      action: 'automatic_lift',
      toFloorKey: generator._getFloorTileGraphKey(lowerApproach),
    }];

    generator._annotateDungeonSupplementWalkabilityIntent(
      floorTiles,
      [{ id: room.id, isDungeonSupplement: true }],
    );
    const solidZones = generator._createDungeonSupplementManifestSolidZones([room]);
    const navigableFloors = floorTiles.filter((floor) => (
      floor.walkabilityIntent !== 'support-only'
        && !generator._isFloorTileBlockedBySolidZone(floor, solidZones)
    ));
    assert.ok(navigableFloors.includes(lowerApproach));
    assert.ok(navigableFloors.includes(upperApproach));
    const canTraverseEdge = (first, second, action) => (
      action === 'automatic_lift'
        || !solidZones.some((zone) => generator._doesFloorTraversalSegmentIntersectZone(
          first,
          second,
          zone,
          0.42,
        ))
    );
    const start = floorTiles.find(({ localTile }) => (
      localTile.x === 0 && localTile.z === 5 && localTile.elevation === 0
    ));
    const reachable = generator._createReachableFloorTileKeySet(start, navigableFloors, {
      canTraverseEdge,
    });
    const returnable = generator._createFloorTileKeySetThatCanReach(start, navigableFloors, {
      canTraverseEdge,
    });
    assert.equal(reachable.size, navigableFloors.length, `rotation ${rotationQuarterTurns}`);
    assert.equal(returnable.size, navigableFloors.length, `rotation ${rotationQuarterTurns}`);

    const reopenedEastRoute = floorTiles.find(({ localTile }) => (
      localTile.x === 3 && localTile.z === 3 && localTile.elevation === 0
    ));
    assert.ok(reopenedEastRoute);
    assert.equal(
      generator._isFloorTileBlockedBySolidZone(reopenedEastRoute, solidZones),
      false,
    );
    const reopenedKey = generator._getFloorTileGraphKey(reopenedEastRoute);
    assert.equal(reachable.has(reopenedKey), true);
    assert.equal(returnable.has(reopenedKey), true);
  }
});

test('solid blueprint collisions expose exact occupied floor and transfer identities', () => {
  const supportIndex = (room) => new Map([
    ...room.augmentationFloorTiers.flatMap(({ worldCells }) => worldCells),
    ...room.augmentationTransfers.flatMap(({ worldCells }) => worldCells),
  ].map((cell) => [String(cell.id), cell]));
  const collisionFor = (room, localFeatureId) => room.augmentationCollisionRecords.find(
    (record) => record.blocking === true
      && room.augmentationBlueprintFeatures.some((feature) => (
        feature.localFeatureId === localFeatureId
          && feature.collisionId === record.id
      )),
  );

  const ladder = materializePhysicalBlueprintRoom('ind-room-ladder-defense-rise-01').room;
  const ladderCells = supportIndex(ladder);
  const westCover = ladder.augmentationCover.find(({ localFeatureId }) => (
    localFeatureId === 'ldr-cover-west'
  ));
  const westCollision = collisionFor(ladder, 'ldr-cover-west');
  assert.ok(westCover);
  assert.ok(westCollision);
  assert.deepEqual(westCollision.occupiedSupportCellIds, westCover.occupiedSupportCellIds);
  assert.deepEqual(
    westCollision.occupiedSupportCellIds.map((id) => {
      const cell = ladderCells.get(String(id));
      return [cell.localTile.x, cell.localTile.z];
    }).sort(),
    [[-2, 1]],
  );
  const ladderFlankAnchor = ladder.augmentationAnchors.find(({ sourceFeatureId }) => (
    sourceFeatureId === 'ldr-flank'
  ));
  assert.deepEqual(ladderFlankAnchor?.localTile, { x: -1, z: 3, elevation: 0 });
  const ladderFlank = exactLocalCell(
    ladder.augmentationFloorTiers.find(({ id }) => id === 'base').worldCells,
    ladderFlankAnchor.localTile,
    0,
  )[0];
  assert.ok(ladderFlank);
  assert.equal(westCollision.occupiedSupportCellIds.includes(ladderFlank.id), false);
  const eastCollision = collisionFor(ladder, 'ldr-cover-east');
  const formerBlockedApproachCell = exactLocalCell(
    ladder.augmentationFloorTiers.find(({ id }) => id === 'base').worldCells,
    { x: 1, z: 3 },
    0,
  )[0];
  assert.ok(eastCollision);
  assert.ok(formerBlockedApproachCell);
  assert.deepEqual(
    eastCollision.occupiedSupportCellIds.map((id) => {
      const cell = ladderCells.get(String(id));
      return [cell.localTile.x, cell.localTile.z];
    }),
    [[2, 3]],
  );
  assert.equal(
    eastCollision.occupiedSupportCellIds.includes(formerBlockedApproachCell.id),
    false,
  );

  const sorter = materializePhysicalBlueprintRoom('ind-room-inclined-sorter-01').room;
  const eastDivider = collisionFor(sorter, 'isg-divider-east');
  const eastFlank = sorter.augmentationAnchors.find(({ sourceFeatureId }) => (
    sourceFeatureId === 'isg-flank-east'
  ));
  const beltStop = sorter.augmentationAnchors.find(({ sourceFeatureId }) => (
    sourceFeatureId === 'isg-belt-stop'
  ));
  assert.ok(eastDivider);
  assert.ok(eastFlank?.supportCellId);
  assert.deepEqual(
    { x: eastFlank.localTile.x, z: eastFlank.localTile.z },
    { x: 3, z: -1 },
  );
  assert.ok(Math.abs(eastFlank.localTile.elevation - 1.75) <= 0.000001);
  assert.match(eastFlank.supportCellId, /:blueprint-transfer:isg-incline:cell:6:3$/);
  assert.deepEqual(
    { x: beltStop?.localTile.x, z: beltStop?.localTile.z },
    { x: 3, z: 0 },
  );
  assert.ok(Math.abs(beltStop.localTile.elevation - 1.4) <= 0.000001);
  assert.match(beltStop?.supportCellId, /:blueprint-transfer:isg-incline:cell:6:4$/);
  assert.equal(eastDivider.occupiedSupportCellIds.includes(eastFlank.supportCellId), false);
  assert.equal(eastDivider.occupiedSupportCellIds.includes(beltStop.supportCellId), false);

  for (const room of [ladder, sorter]) {
    const cells = supportIndex(room);
    for (const collision of room.augmentationCollisionRecords.filter((record) => (
      record.blocking === true
        && ['cover', 'landmark'].includes(record.sourceKind)
    ))) {
      assert.ok(Array.isArray(collision.occupiedSupportCellIds));
      assert.ok(collision.occupiedSupportCellIds.every((id) => cells.has(String(id))));
    }
  }

  const rotated = materializePhysicalBlueprintRoom('ind-room-ladder-defense-rise-01', {
    rotationQuarterTurns: 1,
  }).room;
  const rotatedCover = collisionFor(rotated, 'ldr-cover-west');
  const rotatedCells = supportIndex(rotated);
  assert.deepEqual(rotatedCover.occupiedSupportCellIds, westCollision.occupiedSupportCellIds);
  const stableOccupiedId = westCollision.occupiedSupportCellIds[0];
  assert.notDeepEqual(
    rotatedCells.get(stableOccupiedId).grid,
    ladderCells.get(stableOccupiedId).grid,
  );
});

test('mixed-lattice solids align to committed support grids without moving exact sockets', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const cases = [
    {
      blueprintId: 'ind-room-dispatch-vault-01',
      featureId: 'dv-partition-e',
      center: { x: 119, y: -14, z: 68.6 },
      rotationQuarterTurns: 0,
      expectedAuthoredPosition: { x: 124.6, y: -14, z: 72.8 },
      expectedRealizedPosition: { x: 126, y: -14, z: 72.8 },
      seamFloor: { x: 44, z: 27, elevation: -14 },
      seamEdge: [
        { x: 44, z: 27, elevation: -14 },
        { x: 44, z: 28, elevation: -14 },
      ],
    },
    {
      blueprintId: 'ind-room-switchgear-cache-descent-01',
      featureId: 'sgd-cable-spool-cover',
      center: { x: -36.4, y: 0, z: 373.8 },
      rotationQuarterTurns: 1,
      expectedAuthoredPosition: { x: -30.8, y: 0, z: 379.4 },
      expectedRealizedPosition: { x: -32.2, y: 0, z: 380.8 },
      seamFloor: { x: -10, z: 135, elevation: 0 },
      seamEdge: [
        { x: -11, z: 135, elevation: 0 },
        { x: -10, z: 135, elevation: 0 },
      ],
    },
  ];

  for (const specification of cases) {
    const { blueprint, room } = materializePhysicalBlueprintRoom(
      specification.blueprintId,
      specification,
    );
    const feature = room.augmentationBlueprintFeatures.find(({ localFeatureId }) => (
      localFeatureId === specification.featureId
    ));
    const collision = room.augmentationCollisionRecords.find(({ id }) => (
      id === feature?.collisionId
    ));
    const presentation = room.augmentationPresentationRecords.find(({ sourceFeatureId }) => (
      sourceFeatureId === specification.featureId
    ));
    assert.ok(feature);
    assert.ok(collision);
    assert.ok(presentation);
    assertPointApproximatelyEqual(
      feature.authoredWorldPosition,
      specification.expectedAuthoredPosition,
      `${specification.featureId} preserves its authored position`,
    );
    assertPointApproximatelyEqual(
      feature.position,
      specification.expectedRealizedPosition,
      `${specification.featureId} uses its committed support-grid center`,
    );
    assertPointApproximatelyEqual(
      collision.center,
      specification.expectedRealizedPosition,
      `${specification.featureId} collision follows the realized position`,
    );
    assertPointApproximatelyEqual(
      presentation.transform.position,
      specification.expectedRealizedPosition,
      `${specification.featureId} presentation follows the realized position`,
    );

    const expectedSocketById = new Map(blueprint.sockets.map((socket) => [
      String(socket.id),
      physicalBlueprintSocket(blueprint, socket, specification),
    ]));
    for (const socket of room.augmentationSocketRecords) {
      const expected = expectedSocketById.get(String(socket.localSocketId));
      assert.ok(expected);
      assert.deepEqual(socket.position, expected.position);
      assert.deepEqual(socket.facing, expected.facing);
    }

    const supportById = new Map([
      ...room.augmentationFloorTiers.flatMap(({ worldCells }) => worldCells),
      ...room.augmentationTransfers.flatMap(({ worldCells }) => worldCells),
    ].map((cell) => [String(cell.id), cell]));
    const occupiedSupports = feature.occupiedSupportCellIds.map((id) => supportById.get(String(id)));
    assert.ok(occupiedSupports.length > 0 && occupiedSupports.every(Boolean));
    const solidZone = generator._createDungeonSupplementManifestSolidZones([room])
      .find(({ id }) => id === collision.id);
    assert.ok(solidZone);
    assert.equal(
      generator._isFloorTileBlockedBySolidZone(specification.seamFloor, [solidZone]),
      false,
      `${specification.featureId} does not consume the quantized seam lane`,
    );
    assert.equal(
      generator._doesFloorTraversalSegmentIntersectZone(
        specification.seamEdge[0],
        specification.seamEdge[1],
        solidZone,
        0.42,
      ),
      false,
      `${specification.featureId} does not consume the seam edge envelope`,
    );
    for (const support of occupiedSupports) {
      assert.equal(generator._isFloorTileBlockedBySolidZone({
        x: support.grid.x,
        z: support.grid.z,
        elevation: support.elevation,
        roomId: room.id,
        augmentationFloorCellId: support.id,
      }, [solidZone]), true, `${specification.featureId} retains occupied support collision`);
    }
  }
});

test('direct floor solids stay centered on occupied support-grid bounds across rotations and parity origins', () => {
  const centers = [
    { x: 0, y: 0, z: 0 },
    { x: TILE_SIZE * 0.5, y: 0, z: 0 },
    { x: 0, y: 0, z: TILE_SIZE * 0.5 },
    { x: TILE_SIZE * 0.5, y: 0, z: TILE_SIZE * 0.5 },
  ];
  let alignedSolidRecordCount = 0;

  for (const sourceBlueprint of INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST) {
    for (const center of centers) {
      for (let rotationQuarterTurns = 0; rotationQuarterTurns < 4; rotationQuarterTurns += 1) {
        const { room } = materializePhysicalBlueprintRoom(sourceBlueprint.id, {
          center,
          rotationQuarterTurns,
        });
        const supportById = new Map([
          ...room.augmentationFloorTiers.flatMap(({ worldCells }) => worldCells),
          ...room.augmentationTransfers.flatMap(({ worldCells }) => worldCells),
        ].map((cell) => [String(cell.id), cell]));
        const floorSupportIds = new Set(room.augmentationFloorTiers.flatMap(({ worldCells }) => (
          worldCells.map(({ id }) => String(id))
        )));
        const directSolids = room.augmentationBlueprintFeatures.filter((feature) => (
          feature.blocking === true
            && ['cover', 'machine'].includes(feature.blueprintFeatureType)
            && feature.supportAttachment === 'direct'
            && (feature.occupiedSupportCellIds?.length ?? 0) > 0
            && feature.occupiedSupportCellIds.every((id) => floorSupportIds.has(String(id)))
        ));

        for (const feature of directSolids) {
          alignedSolidRecordCount += 1;
          const supports = feature.occupiedSupportCellIds.map((id) => supportById.get(String(id)));
          assert.ok(supports.every(Boolean));
          const gridXs = supports.map(({ grid }) => Number(grid.x));
          const gridZs = supports.map(({ grid }) => Number(grid.z));
          const expectedPosition = {
            x: (Math.min(...gridXs) + Math.max(...gridXs)) * 0.5 * TILE_SIZE,
            y: feature.position.y,
            z: (Math.min(...gridZs) + Math.max(...gridZs)) * 0.5 * TILE_SIZE,
          };
          assertPointApproximatelyEqual(
            feature.position,
            expectedPosition,
            `${sourceBlueprint.id}/${feature.localFeatureId}/r${rotationQuarterTurns}`,
          );
          const collision = room.augmentationCollisionRecords.find(({ id }) => (
            id === feature.collisionId
          ));
          assert.ok(collision);
          assertPointApproximatelyEqual(
            collision.center,
            expectedPosition,
            `${sourceBlueprint.id}/${feature.localFeatureId} collision`,
          );
        }

        for (const sourceFeatureId of new Set(directSolids.map(({ localFeatureId }) => (
          localFeatureId
        )))) {
          const representative = directSolids.find(({ localFeatureId }) => (
            localFeatureId === sourceFeatureId
          ));
          const presentation = room.augmentationPresentationRecords.find((record) => (
            record.sourceFeatureId === sourceFeatureId
          ));
          assert.ok(presentation);
          assertPointApproximatelyEqual(
            presentation.transform.position,
            representative.position,
            `${sourceBlueprint.id}/${sourceFeatureId} presentation`,
          );
        }
      }
    }
  }

  assert.ok(alignedSolidRecordCount > 400);
});

test('all authored encounter, control, and reward supports keep standing-envelope clearance', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const centers = [
    { x: 0, y: 0, z: 0 },
    { x: TILE_SIZE * 0.5, y: 0, z: 0 },
    { x: 0, y: 0, z: TILE_SIZE * 0.5 },
    { x: TILE_SIZE * 0.5, y: 0, z: TILE_SIZE * 0.5 },
  ];

  for (const sourceBlueprint of INDUSTRIAL_SUPPLEMENT_BLUEPRINT_LIST) {
    for (const center of centers) {
      for (let rotationQuarterTurns = 0; rotationQuarterTurns < 4; rotationQuarterTurns += 1) {
        const { room } = materializePhysicalBlueprintRoom(sourceBlueprint.id, {
          center,
          rotationQuarterTurns,
        });
        const blockingZones = generator._createDungeonSupplementManifestSolidZones([room]);
        const floorSupportById = new Map(room.augmentationFloorTiers.flatMap((tier) => (
          tier.worldCells.map((cell) => [String(cell.id), {
            cell,
            floorTierId: tier.id,
          }])
        )));
        const transferSupportById = new Map(room.augmentationTransfers.flatMap((transfer) => (
          transfer.worldCells.map((cell) => [String(cell.id), {
            cell,
            transfer,
          }])
        )));
        const gameplayAnchors = room.augmentationAnchors.filter(({ blueprintFeatureType }) => (
          ['spawn', 'control', 'reward'].includes(blueprintFeatureType)
        ));
        for (const anchor of gameplayAnchors) {
          const support = floorSupportById.get(String(anchor.supportCellId))
            ?? transferSupportById.get(String(anchor.supportCellId));
          assert.ok(
            support,
            `${sourceBlueprint.id}/${anchor.sourceFeatureId} exact support`,
          );
          // Final generation commits authoritative supports to integer floor
          // coordinates. Exercise that standing capsule, not merely the
          // pre-stamp authored point, including half-grid room centers.
          const floor = {
            x: support.cell.grid.x,
            z: support.cell.grid.z,
            elevation: support.cell.elevation,
            roomId: room.id,
            ...(support.transfer ? {
              surface: support.transfer.form === 'ramp'
                ? 'industrialRamp'
                : 'industrialTransfer',
              isPlatformingSurface: true,
              augmentationTransferCellId: support.cell.id,
              augmentationTransferId: support.transfer.id,
              rampStartElevation: support.transfer.worldElevationRange?.from,
              rampEndElevation: support.transfer.worldElevationRange?.to,
            } : {
              surface: 'industrialSupplementTier',
              augmentationFloorCellId: support.cell.id,
              augmentationFloorTierId: support.floorTierId,
            }),
          };
          const overlaps = blockingZones.filter((zone) => (
            generator._isFloorTileBlockedBySolidZone(floor, [zone])
          ));
          assert.deepEqual(
            overlaps.map(({ id }) => id),
            [],
            `${sourceBlueprint.id}/${anchor.sourceFeatureId} rotation ${rotationQuarterTurns} center ${center.x},${center.z}`,
          );
        }
      }
    }
  }
});

test('required foundry flank and observation log targets remain finally walkable', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const inspectTarget = (blueprintId, featureId) => {
    const { room } = materializePhysicalBlueprintRoom(blueprintId);
    const floorTiles = [
      ...room.augmentationFloorTiers.flatMap((tier) => tier.worldCells.map((cell) => ({
        x: cell.grid.x,
        z: cell.grid.z,
        elevation: cell.elevation,
        roomId: room.id,
        surface: 'industrialSupplementTier',
        augmentationFloorCellId: cell.id,
        augmentationFloorTierId: tier.id,
        augmentationFloorTierRuntimeId: tier.runtimeId,
        localTile: cell.localTile,
      }))),
      ...room.augmentationTransfers.flatMap((transfer) => transfer.worldCells.map((cell) => ({
        x: cell.grid.x,
        z: cell.grid.z,
        elevation: cell.elevation,
        roomId: room.id,
        surface: transfer.form === 'ramp' ? 'industrialRamp' : 'industrialTransfer',
        isPlatformingSurface: true,
        augmentationTransferCellId: cell.id,
        augmentationTransferId: transfer.id,
        localTile: cell.localTile,
        rampStartElevation: transfer.worldElevationRange?.from,
        rampEndElevation: transfer.worldElevationRange?.to,
      }))),
    ];
    generator._annotateDungeonSupplementWalkabilityIntent(
      floorTiles,
      [{ id: room.id, isDungeonSupplement: true }],
    );
    const solidZones = generator._createDungeonSupplementManifestSolidZones([room]);
    const navigableFloors = floorTiles.filter((floor) => (
      floor.walkabilityIntent !== 'support-only'
        && !generator._isFloorTileBlockedBySolidZone(floor, solidZones)
    ));
    const baseFloors = floorTiles.filter(({ augmentationFloorTierId }) => (
      augmentationFloorTierId === 'base'
    ));
    const maximumLocalZ = Math.max(...baseFloors.map(({ localTile }) => localTile.z));
    const startFloor = baseFloors.find(({ localTile }) => (
      localTile.x === 0 && localTile.z === maximumLocalZ
    ));
    const anchor = room.augmentationAnchors.find(({ sourceFeatureId }) => (
      sourceFeatureId === featureId
    ));
    const targetFloor = floorTiles.find(({ augmentationFloorCellId }) => (
      augmentationFloorCellId === anchor?.supportCellId
    ));
    const reachableKeys = generator._createReachableFloorTileKeySet(
      startFloor,
      navigableFloors,
    );
    const returnableKeys = generator._createFloorTileKeySetThatCanReach(
      startFloor,
      navigableFloors,
    );
    const floorKey = generator._getFloorTileGraphKey(targetFloor);
    return {
      room,
      floorTiles,
      anchor,
      targetFloor,
      blocked: generator._isFloorTileBlockedBySolidZone(targetFloor, solidZones),
      reachable: reachableKeys.has(floorKey),
      returnable: returnableKeys.has(floorKey),
    };
  };

  const foundry = inspectTarget('ind-room-reaverbot-foundry-01', 'rf-flank-e');
  assert.deepEqual(foundry.anchor.localTile, { x: 1, z: -2, elevation: 0 });
  assert.equal(foundry.targetFloor.walkabilityIntent, 'required-clear');
  assert.equal(foundry.blocked, false);
  assert.equal(foundry.reachable, true);
  assert.equal(foundry.returnable, true);
  assert.equal(foundry.room.augmentationTransfers.some((transfer) => (
    transfer.worldCells.some(({ localTile }) => (
      localTile.x === 1 && localTile.z === -2
    ))
  )), false, 'foundry flank has no ramp overhead in its authored column');
  assert.ok(foundry.room.augmentationZones.find(({ id }) => id === 'rf-encounter-zone')
    .worldCells.some(({ floorCellId }) => floorCellId === foundry.anchor.supportCellId));
  const otherFoundryAnchors = foundry.room.augmentationAnchors.filter((anchor) => (
    anchor.sourceFeatureId?.startsWith('rf-')
      && anchor.sourceFeatureId !== 'rf-flank-e'
      && anchor.blueprintFeatureType === 'spawn'
  ));
  assert.ok(otherFoundryAnchors.every((anchor) => (
    Math.hypot(
      anchor.position.x - foundry.anchor.position.x,
      anchor.position.y - foundry.anchor.position.y,
      anchor.position.z - foundry.anchor.position.z,
    ) >= 2.8
  )));

  const observation = inspectTarget('ind-room-observation-break-01', 'ob-lore');
  assert.deepEqual(observation.anchor.localTile, { x: -3, z: 0, elevation: 0 });
  assert.equal(observation.targetFloor.walkabilityIntent, 'required-clear');
  assert.equal(observation.blocked, false);
  assert.equal(observation.reachable, true);
  assert.equal(observation.returnable, true);
  const observationCache = observation.room.augmentationAnchors.find(({ sourceFeatureId }) => (
    sourceFeatureId === 'ob-cache'
  ));
  assert.ok(Math.hypot(
    observationCache.position.x - observation.anchor.position.x,
    observationCache.position.z - observation.anchor.position.z,
  ) > 1.6, 'log and cache remain outside their combined reward reservation radii');
});

function materializeVerticalBranch({
  connectorFamily,
  sourceElevation = 0,
  destinationElevation = 14,
  destinationX = 20,
} = {}) {
  const operationId = `supplement:vertical:${connectorFamily}:optionalBranch:0:operation`;
  const nodeId = `supplement:vertical:${connectorFamily}:optionalBranch:0:node:0`;
  const segmentId = `supplement:vertical:${connectorFamily}:optionalBranch:0:segment:0`;
  const parentRoom = {
    id: `vertical-parent-${connectorFamily}`,
    x: 0,
    z: 0,
    width: 3,
    depth: 3,
    plannedBaseElevation: sourceElevation,
    baseElevation: sourceElevation,
    exitSockets: [],
  };
  const overlayPlan = {
    operations: [{ id: operationId, type: 'optionalBranch', segmentIds: [segmentId] }],
    nodes: [supplementNode({
      id: nodeId,
      operationId,
      center: { x: destinationX * TILE_SIZE, y: destinationElevation, z: 0 },
      size: { x: 8.4, y: 5.6, z: 8.4 },
    })],
    segments: [{
      id: segmentId,
      operationId,
      connectorFamily,
      from: {
        nodeId: parentRoom.id,
        position: { x: TILE_SIZE, y: sourceElevation, z: 0 },
        facing: { x: 1, y: 0, z: 0 },
      },
      to: {
        nodeId,
        position: { x: (destinationX - 1) * TILE_SIZE, y: destinationElevation, z: 0 },
        facing: { x: -1, y: 0, z: 0 },
      },
      path: [
        { x: TILE_SIZE, y: sourceElevation, z: 0 },
        { x: (destinationX - 1) * TILE_SIZE, y: destinationElevation, z: 0 },
      ],
    }],
  };
  const result = materializeIndustrialOverlay({
    rooms: [parentRoom],
    overlayPlan,
    tileSize: TILE_SIZE,
  });
  return {
    result,
    plan: result.connectionPlans.find((connection) => connection.id === segmentId),
  };
}

test('non-square supplemental room footprints follow placement quarter-turn rotation', () => {
  const overlayPlan = {
    operations: [],
    segments: [],
    nodes: [
      supplementNode({ id: 'unrotated', center: { x: -28, y: 0, z: 0 } }),
      supplementNode({ id: 'rotated', center: { x: 28, y: 0, z: 0 }, rotationQuarterTurns: 1 }),
      supplementNode({ id: 'negative-turn', center: { x: 0, y: 0, z: 28 }, rotationQuarterTurns: -1 }),
    ],
  };

  const result = materializeIndustrialOverlay({ overlayPlan, tileSize: TILE_SIZE });
  const roomById = new Map(result.rooms.map((room) => [room.id, room]));

  assert.deepEqual(
    { width: roomById.get('unrotated').width, depth: roomById.get('unrotated').depth },
    { width: 3, depth: 5 },
  );
  assert.deepEqual(
    { width: roomById.get('rotated').width, depth: roomById.get('rotated').depth },
    { width: 5, depth: 3 },
  );
  assert.deepEqual(
    { width: roomById.get('negative-turn').width, depth: roomById.get('negative-turn').depth },
    { width: 5, depth: 3 },
  );
  assert.equal(roomById.get('negative-turn').augmentationRotationQuarterTurns, 3);
});

test('half-grid grammar sockets clamp to the owning room boundary at their inherited elevation', () => {
  const parentRoom = {
    id: 'authored-parent',
    x: 13,
    z: 88,
    width: 5,
    depth: 5,
    plannedBaseElevation: -14,
    baseElevation: -14,
    exitSockets: [],
  };
  const operationId = 'supplement:industrial-v1-main:optionalBranch:0:operation';
  const nodeId = 'supplement:industrial-v1-main:optionalBranch:0:node:0';
  const segmentId = 'supplement:industrial-v1-main:optionalBranch:0:segment:0';
  const rawHalfGridX = 16.5 * TILE_SIZE;
  const overlayPlan = {
    operations: [{ id: operationId, type: 'optionalBranch', segmentIds: [segmentId] }],
    nodes: [supplementNode({
      id: nodeId,
      operationId,
      center: { x: 19 * TILE_SIZE, y: -14, z: 88 * TILE_SIZE },
      rotationQuarterTurns: 1,
    })],
    segments: [{
      id: segmentId,
      operationId,
      from: {
        nodeId: parentRoom.id,
        position: { x: 15 * TILE_SIZE, y: -14, z: 88 * TILE_SIZE },
        facing: { x: 1, y: 0, z: 0 },
      },
      to: {
        nodeId,
        position: { x: rawHalfGridX, y: -14, z: 88 * TILE_SIZE },
        facing: { x: -1, y: 0, z: 0 },
      },
      path: [
        { x: 15 * TILE_SIZE, y: -14, z: 88 * TILE_SIZE },
        { x: rawHalfGridX, y: -14, z: 88 * TILE_SIZE },
      ],
    }],
  };

  const result = materializeIndustrialOverlay({
    rooms: [parentRoom],
    overlayPlan,
    tileSize: TILE_SIZE,
  });

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  const supplementRoom = result.rooms.find((room) => room.id === nodeId);
  const plan = result.connectionPlans.find((connection) => connection.id === segmentId);
  assert.ok(supplementRoom);
  assert.ok(plan);
  assert.deepEqual(
    { minX: supplementRoom.x - 2, maxX: supplementRoom.x + 2 },
    { minX: 17, maxX: 21 },
  );
  assert.deepEqual(plan.fullPath, [
    { x: 15, z: 88 },
    { x: 16, z: 88 },
    { x: 17, z: 88 },
  ]);
  assert.equal(plan.toSocket.x, 17);
  assert.equal(plan.toSocket.facingX, -1);
  assert.equal(plan.toSocket.elevation, -14);
  assert.equal(plan.toSocket.floorKey, '17,88@y-14.000');
});

test('cross-band source gates materialize at the exact shallow parent threshold', () => {
  const operationId = 'supplement:cross-band:routeNetwork:0:operation';
  const grantId = 'industrial-v1:main-region:route-network-grant:cross-band-test';
  const nodeId = `${operationId}:node:0`;
  const shallowSegmentId = `${operationId}:segment:shallow`;
  const deepSegmentId = `${operationId}:segment:deep`;
  const shallowSocket = {
    id: 'industrial-v1:main-region:socket:keycardRoom:east',
    nodeId: 'keycardRoom',
    roomId: 'keycardRoom',
    position: { x: 5.6, y: 0, z: 0 },
    facing: { x: 1, y: 0, z: 0 },
    progressionBandId: 0,
    accessDomainId: 'industrial-v1:main-region:access-domain:band-0',
    widthMeters: 8.4,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    clearanceHeightMeters: 3.6,
    routeNetworkSocketKind: 'parent-room-wall',
  };
  const deepSocket = {
    id: 'industrial-v1:main-region:socket:trapRoom:west',
    nodeId: 'trapRoom',
    roomId: 'trapRoom',
    position: { x: 50.4, y: 0, z: 0 },
    facing: { x: -1, y: 0, z: 0 },
    progressionBandId: 1,
    accessDomainId: 'industrial-v1:main-region:access-domain:band-1',
    widthMeters: 8.4,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    clearanceHeightMeters: 3.6,
    routeNetworkSocketKind: 'parent-room-wall',
  };
  const sourceGate = {
    gateId: `${grantId}:source-gate:${shallowSocket.id}`,
    gatePlacementSide: 'source',
    sourceGateSocketId: shallowSocket.id,
    shallowEndpointSocketIds: [shallowSocket.id],
    crossedBoundaryIds: ['Door_Alpha'],
    requiredCredentialIds: ['Keycard_Alpha'],
    requiredKeycardId: 'Keycard_Alpha',
    encounterRequirementId: null,
    supplementalIdentity: true,
  };
  const node = supplementNode({
    id: nodeId,
    operationId,
    center: { x: 28, y: 0, z: 0 },
    size: { x: 8.4, y: 5.6, z: 8.4 },
  });
  const shallowNodeSocket = {
    kind: 'supplementSocket',
    id: `${nodeId}:west`,
    socketId: `${nodeId}:west`,
    nodeId,
    position: { x: 22.4, y: 0, z: 0 },
    facing: { x: -1, y: 0, z: 0 },
  };
  const deepNodeSocket = {
    kind: 'supplementSocket',
    id: `${nodeId}:east`,
    socketId: `${nodeId}:east`,
    nodeId,
    position: { x: 33.6, y: 0, z: 0 },
    facing: { x: 1, y: 0, z: 0 },
  };
  const segments = [{
    id: shallowSegmentId,
    operationId,
    connectorFamily: 'service-gallery',
    // Deliberately put the shallow parent endpoint second. The authoritative
    // materialized plan must still orient its physical source at this socket.
    from: shallowNodeSocket,
    to: { ...shallowSocket, kind: 'parentSocket', socketId: shallowSocket.id },
    path: [shallowNodeSocket.position, shallowSocket.position],
    sourceGate: structuredClone(sourceGate),
    gatePlacementSide: 'source',
    sourceGateSocketId: shallowSocket.id,
    gateEndpointRole: 'to',
    requiredCredentialIds: ['Keycard_Alpha'],
  }, {
    id: deepSegmentId,
    operationId,
    connectorFamily: 'service-gallery',
    from: deepNodeSocket,
    to: { ...deepSocket, kind: 'parentSocket', socketId: deepSocket.id },
    path: [deepNodeSocket.position, deepSocket.position],
  }];
  node.sockets = [
    { ...shallowNodeSocket, state: 'connected', segmentId: shallowSegmentId },
    { ...deepNodeSocket, state: 'connected', segmentId: deepSegmentId },
  ];
  const operation = {
    id: operationId,
    type: 'routeNetwork',
    parentRegionId: 'industrial-v1:main-region',
    grantId,
    routeNetworkKind: 'cross-band-shortcut',
    endpointSocketIds: [shallowSocket.id, deepSocket.id],
    shallowEndpointSocketIds: [shallowSocket.id],
    progressionBandId: 1,
    accessDomainId: 'industrial-v1:main-region:access-domain:band-1',
    elevationModes: ['shortcut-lift'],
    nodeIds: [nodeId],
    segmentIds: segments.map(({ id }) => id),
  };
  const extensionRegions = [{
    id: 'industrial-v1:main-region',
    routeNetworkGrants: [{
      id: grantId,
      kind: 'cross-band-shortcut',
      endpointSockets: [shallowSocket, deepSocket],
      shallowEndpointSocketIds: [shallowSocket.id],
      sourceGate,
      progressionBandId: 1,
      accessDomainId: 'industrial-v1:main-region:access-domain:band-1',
    }],
  }];
  const rooms = [{
    id: 'keycardRoom', x: 0, z: 0, width: 3, depth: 3, baseElevation: 0, exitSockets: [],
  }, {
    id: 'trapRoom', x: 20, z: 0, width: 3, depth: 3, baseElevation: 0, exitSockets: [],
  }];
  const materialize = (overlaySegments) => materializeIndustrialOverlay({
    rooms: structuredClone(rooms),
    overlayPlan: {
      operations: [structuredClone(operation)],
      nodes: [structuredClone(node)],
      segments: structuredClone(overlaySegments),
    },
    extensionRegions: structuredClone(extensionRegions),
    tileSize: TILE_SIZE,
  });

  const result = materialize(segments);
  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  const shallowPlan = result.connectionPlans.find(({ id }) => id === shallowSegmentId);
  const deepPlan = result.connectionPlans.find(({ id }) => id === deepSegmentId);
  assert.ok(shallowPlan);
  assert.ok(deepPlan);
  assert.equal(shallowPlan.fromRoomId, 'keycardRoom');
  assert.equal(shallowPlan.progressionFromRoomId, 'keycardRoom');
  assert.equal(shallowPlan.fromSocket.id, shallowSocket.id);
  assert.equal(shallowPlan.fullPath[0].x, shallowPlan.fromSocket.x);
  assert.equal(shallowPlan.logicalGateId, sourceGate.gateId);
  assert.equal(shallowPlan.doorId, sourceGate.gateId);
  assert.equal(shallowPlan.gatePlacementSide, 'source');
  assert.equal(shallowPlan.gateSourceSocketId, shallowSocket.id);
  assert.equal(shallowPlan.overlayGateEndpointRole, 'to');
  assert.equal(shallowPlan.supplementalGateIdentity, true);
  assert.deepEqual(shallowPlan.requiredCredentialIds, ['Keycard_Alpha']);
  assert.equal(shallowPlan.requiredKeycardId, 'Keycard_Alpha');
  assert.equal(shallowPlan.hostsLogicalGate, true);
  assert.equal(deepPlan.doorId, null);
  assert.equal(deepPlan.hostsLogicalGate, undefined);

  const lateGateSegments = structuredClone(segments);
  lateGateSegments[0].gateEndpointRole = 'from';
  const lateGate = materialize(lateGateSegments);
  assert.equal(lateGate.diagnostics.accepted, false);
  assert.match(lateGate.diagnostics.errors.join(' | '), /exact shallow parent socket/i);

  const wrongCredentialSegments = structuredClone(segments);
  wrongCredentialSegments[0].requiredCredentialIds = [];
  wrongCredentialSegments[0].sourceGate.requiredCredentialIds = [];
  wrongCredentialSegments[0].sourceGate.requiredKeycardId = null;
  const wrongCredential = materialize(wrongCredentialSegments);
  assert.equal(wrongCredential.diagnostics.accepted, false);
  assert.match(wrongCredential.diagnostics.errors.join(' | '), /invalid shallow source-gate contract/i);
});

test('materialized routes approach grammar sockets along their declared cardinal facing', () => {
  const parentRoom = {
    id: 'authored-parent',
    x: -5,
    z: -2,
    width: 3,
    depth: 3,
    exitSockets: [],
  };
  const operationId = 'supplement:fixture:optionalBranch:0:operation';
  const nodeId = 'supplement:fixture:optionalBranch:0:node:0';
  const segmentId = 'supplement:fixture:optionalBranch:0:segment:0';
  const overlayPlan = {
    operations: [{ id: operationId, type: 'optionalBranch', segmentIds: [segmentId] }],
    nodes: [supplementNode({ id: nodeId, operationId })],
    segments: [{
      id: segmentId,
      operationId,
      from: {
        nodeId: parentRoom.id,
        position: { x: -4 * TILE_SIZE, y: 0, z: -2 * TILE_SIZE },
        facing: { x: 1, y: 0, z: 0 },
      },
      // The raw path arrives from the west even though the grammar socket is
      // on the north wall. Materialization must add a north-side approach
      // instead of combining those axes into a diagonal socket facing.
      to: {
        nodeId,
        position: { x: 0, y: 0, z: -2.5 * TILE_SIZE },
        facing: { x: 0, y: 0, z: -1 },
      },
      path: [
        { x: -4 * TILE_SIZE, y: 0, z: -2 * TILE_SIZE },
        { x: 0, y: 0, z: -2.5 * TILE_SIZE },
      ],
    }],
  };

  const result = materializeIndustrialOverlay({
    rooms: [parentRoom],
    overlayPlan,
    tileSize: TILE_SIZE,
  });
  const plan = result.connectionPlans.find((connection) => connection.id === segmentId);

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  assert.ok(plan);
  assert.deepEqual(plan.fullPath.slice(-2), [
    { x: 0, z: -3 },
    { x: 0, z: -2 },
  ]);
  assert.deepEqual(
    { x: plan.toSocket.facingX, z: plan.toSocket.facingZ },
    { x: 0, z: -1 },
  );
  assert.equal(Math.abs(plan.toSocket.facingX) + Math.abs(plan.toSocket.facingZ), 1);
});

test('edge padding keeps the authored logical plan and realizes namespaced physical segments through rooms', () => {
  const operationId = 'supplement:industrial-v1-main:edgePadding:0:operation';
  const nodeId = 'supplement:industrial-v1-main:edgePadding:0:node:0';
  const firstSegmentId = 'supplement:industrial-v1-main:edgePadding:0:segment:0';
  const secondSegmentId = 'supplement:industrial-v1-main:edgePadding:0:segment:1';
  const rooms = [
    { id: 'authored-a', x: -10, z: 0, width: 3, depth: 3, exitSockets: [] },
    { id: 'authored-b', x: 10, z: 0, width: 3, depth: 3, exitSockets: [] },
  ];
  const connectionPlans = [{
    id: 'authored-a_authored-b_ground',
    logicalConnectionId: 'authored-a_authored-b',
    fromRoomId: 'authored-a',
    toRoomId: 'authored-b',
    doorId: 'Door_Alpha',
    level: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    requiredForProgression: true,
    purpose: 'critical_route',
    routeClassification: 'main_route',
    fullPath: Array.from({ length: 21 }, (_, index) => ({ x: index - 10, z: 0 })),
    bridgePath: Array.from({ length: 19 }, (_, index) => ({ x: index - 9, z: 0 })),
    fromSocket: {
      id: 'authored-a_authored-b_ground_exit',
      roomId: 'authored-a',
      role: 'exit',
      x: -9,
      z: 0,
      level: 0,
      elevation: 0,
      facingX: 1,
      facingZ: 0,
      connectorType: 'ground_corridor',
      floorKey: '-9,0,0',
    },
    toSocket: {
      id: 'authored-a_authored-b_ground_entrance',
      roomId: 'authored-b',
      role: 'entrance',
      x: 9,
      z: 0,
      level: 0,
      elevation: 0,
      facingX: -1,
      facingZ: 0,
      connectorType: 'ground_corridor',
      floorKey: '9,0,0',
    },
    connectorVariantConstraints: {
      roomFootprints: [],
      blockedLanePoints: [{ x: 5, z: 5 }],
    },
  }];
  const originalRooms = structuredClone(rooms);
  const originalPlans = structuredClone(connectionPlans);
  const endpoint = (kind, id, node, x, facingX) => ({
    kind,
    id,
    nodeId: node,
    socketId: id,
    position: { x: x * TILE_SIZE, y: 0, z: 0 },
    facing: { x: facingX, y: 0, z: 0 },
  });
  const overlayPlan = {
    nodes: [supplementNode({
      id: nodeId,
      operationId,
      size: { x: 8.4, y: 5.6, z: 8.4 },
    })],
    operations: [{
      id: operationId,
      type: 'edgePadding',
      originalEdgeId: 'eligible-edge',
      originalLogicalEdge: {
        id: 'authored-a_authored-b',
        gateId: 'Door_Alpha',
        gatePlacementSide: 'destination',
        credentialRequirement: 'Keycard_Alpha',
        progressionTier: 1,
        dominanceBoundary: 'authored-a_authored-b:gate:Door_Alpha',
      },
      originalEdgeSnapshot: {
        id: 'eligible-edge',
        logicalEdgeId: 'authored-a_authored-b',
      },
      segmentIds: [firstSegmentId, secondSegmentId],
    }],
    segments: [
      {
        id: firstSegmentId,
        operationId,
        physicalOrdinal: 0,
        logicalEdgeId: 'authored-a_authored-b',
        from: endpoint('parentSocket', 'authored-a:exit', 'authored-a', -9, 1),
        to: endpoint('supplementSocket', `${nodeId}:entry`, nodeId, -1, -1),
        path: [{ x: -9 * TILE_SIZE, y: 0, z: 0 }, { x: -1 * TILE_SIZE, y: 0, z: 0 }],
      },
      {
        id: secondSegmentId,
        operationId,
        physicalOrdinal: 1,
        logicalEdgeId: 'authored-a_authored-b',
        from: endpoint('supplementSocket', `${nodeId}:exit`, nodeId, 1, 1),
        to: endpoint('parentSocket', 'authored-b:entry', 'authored-b', 9, -1),
        path: [{ x: 1 * TILE_SIZE, y: 0, z: 0 }, { x: 9 * TILE_SIZE, y: 0, z: 0 }],
      },
    ],
  };
  const extensionRegions = [{
    id: 'industrial-v1-main',
    spliceEdges: [{
      id: 'eligible-edge',
      physicalConnectionId: 'authored-a_authored-b_ground',
      logicalEdgeId: 'authored-a_authored-b',
      from: { position: { x: -9 * TILE_SIZE, y: 0, z: 0 } },
      to: { position: { x: 9 * TILE_SIZE, y: 0, z: 0 } },
    }],
  }];

  const result = materializeIndustrialOverlay({
    rooms,
    connectionPlans,
    overlayPlan,
    extensionRegions,
    tileSize: TILE_SIZE,
  });

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  assert.deepEqual(rooms, originalRooms);
  assert.deepEqual(connectionPlans, originalPlans);
  assert.deepEqual(result.supplementalConnectionIds, [firstSegmentId, secondSegmentId]);
  assert.equal(result.diagnostics.paddingConnectionCount, 2);
  assert.equal(result.diagnostics.optionalConnectionCount, 0);
  assert.deepEqual(result.diagnostics.paddedConnections, [{
    operationId,
    logicalConnectionId: 'authored-a_authored-b',
    parentConnectionId: 'authored-a_authored-b_ground',
    gateId: 'Door_Alpha',
    physicalConnectionIds: [firstSegmentId, secondSegmentId],
  }]);

  const logicalPlan = result.connectionPlans.find(({ id }) => id === 'authored-a_authored-b_ground');
  assert.equal(logicalPlan.logicalConnectionId, 'authored-a_authored-b');
  assert.equal(logicalPlan.doorId, 'Door_Alpha');
  assert.equal(logicalPlan.logicalGateId, 'Door_Alpha');
  assert.equal(logicalPlan.isLogicalPaddedConnectionRecord, true);
  assert.deepEqual(logicalPlan.supplementalPhysicalSegmentIds, [firstSegmentId, secondSegmentId]);
  assert.deepEqual(logicalPlan.originalConnectionPlanSnapshot, originalPlans[0]);
  assert.equal(Object.isFrozen(logicalPlan.originalConnectionPlanSnapshot), true);
  assert.equal(Object.isFrozen(logicalPlan.originalConnectionPlanSnapshot.fullPath), true);
  assert.notDeepEqual(logicalPlan.fullPath, originalPlans[0].fullPath);

  const physicalPlans = result.connectionPlans.filter(({ id }) => (
    id === firstSegmentId || id === secondSegmentId
  ));
  assert.deepEqual(
    physicalPlans.map(({ fromRoomId, toRoomId }) => [fromRoomId, toRoomId]),
    [['authored-a', nodeId], [nodeId, 'authored-b']],
  );
  for (const [index, physicalPlan] of physicalPlans.entries()) {
    assert.equal(physicalPlan.logicalConnectionId, 'authored-a_authored-b');
    assert.equal(physicalPlan.parentConnectionId, 'authored-a_authored-b_ground');
    assert.equal(physicalPlan.doorId, index === 0 ? 'Door_Alpha' : null);
    assert.equal(physicalPlan.hostsLogicalGate, index === 0);
    assert.equal(physicalPlan.gatePlacementSide, index === 0 ? 'source' : undefined);
    assert.equal(physicalPlan.logicalGateId, 'Door_Alpha');
    assert.equal(physicalPlan.credentialRequirement, 'Keycard_Alpha');
    assert.equal(physicalPlan.progressionTier, 1);
    assert.equal(physicalPlan.dominanceBoundary, 'authored-a_authored-b:gate:Door_Alpha');
    assert.equal(physicalPlan.requiredForProgression, true);
    assert.equal(physicalPlan.isPaddedByDungeonSupplement, true);
  }

  const roomById = new Map(result.rooms.map((room) => [room.id, room]));
  const supplementSocketConnections = roomById.get(nodeId).exitSockets.map(({ connectionId }) => connectionId);
  assert.deepEqual(supplementSocketConnections, [firstSegmentId, secondSegmentId]);
  assert.equal(roomById.get('authored-a').exitSockets.at(-1).connectionId, firstSegmentId);
  assert.equal(roomById.get('authored-b').exitSockets.at(-1).connectionId, secondSegmentId);
  assert.equal(
    result.connectionPlans.find(({ id }) => id === 'authored-a_authored-b_ground')
      .gatePlacementSide,
    'source',
  );
});

test('ladder supplement segments materialize an authored 14m connector contract', () => {
  const { result, plan } = materializeVerticalBranch({ connectorFamily: 'ladder' });

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  assert.ok(plan);
  assert.equal(plan.connectorFamily, 'ladder');
  assert.equal(plan.connectorVariantId, DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY);
  assert.equal(plan.direction, 'ascending');
  assert.equal(plan.sourceElevation, 0);
  assert.equal(plan.destinationElevation, 14);
  assert.equal(plan.elevationDelta, 14);
  assert.equal(plan.fromSocket.elevation, 0);
  assert.equal(plan.toSocket.elevation, 14);
  assert.equal(plan.connectorVariant?.traversalKind, 'ladder');
  assert.equal(plan.connectorVariant?.elevationDelta, 14);
  assert.equal(plan.connectorVariant?.sourceEndpoint?.elevation, 0);
  assert.equal(plan.connectorVariant?.destinationEndpoint?.elevation, 14);
  assert.equal(plan.connectorVariant?.mechanisms?.length, 1);
  assert.equal(plan.connectorVariant?.mechanisms?.[0]?.type, 'ladder');
});

test('lift supplement segments preserve descending endpoints in their authored contract', () => {
  const { result, plan } = materializeVerticalBranch({
    connectorFamily: 'lift',
    sourceElevation: 14,
    destinationElevation: 0,
  });

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  assert.ok(plan);
  assert.equal(plan.connectorFamily, 'lift');
  assert.equal(plan.connectorVariantId, DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT);
  assert.equal(plan.direction, 'descending');
  assert.equal(plan.sourceElevation, 14);
  assert.equal(plan.destinationElevation, 0);
  assert.equal(plan.elevationDelta, -14);
  assert.equal(plan.fromSocket.elevation, 14);
  assert.equal(plan.toSocket.elevation, 0);
  assert.equal(plan.connectorVariant?.traversalKind, 'automatic_lift');
  assert.equal(plan.connectorVariant?.elevationDelta, -14);
  assert.ok(plan.connectorVariant?.liftShaft);
  assert.equal(plan.connectorVariant?.mechanisms?.length, 1);
});

test('incompatible vertical connector paths reject materialization without flat fallback', () => {
  const { result, plan } = materializeVerticalBranch({
    connectorFamily: 'ladder',
    destinationX: 7,
  });

  assert.equal(result.diagnostics.accepted, false);
  assert.equal(plan, undefined);
  assert.match(
    result.diagnostics.errors.join(' | '),
    /cannot realize ladder contract: .*no exterior straight run/i,
  );
  assert.equal(result.diagnostics.optionalConnectionCount, 0);
});

function routeNode({ id, operationId, center, sockets, junction = null, contentRole = null }) {
  return {
    id,
    operationId,
    grammarId: 'supplement-route-network-fixture-v1',
    placement: { center, rotationQuarterTurns: 0 },
    size: { x: 19.6, y: 8.4, z: 19.6 },
    sockets,
    anchors: [],
    contentRole,
    junction,
  };
}

function routeSocket(id, nodeId, position, facing) {
  return {
    id,
    nodeId,
    socketId: id,
    position,
    facing,
    widthMeters: 8.4,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    state: 'connected',
  };
}

function v4LevelSpineFixture({
  reversed = false,
  worldZ = 0,
  connectorFamily = 'service-gallery',
  leftElevation = 14,
  rightElevation = 14,
  spanCells = 8,
} = {}) {
  const operationId = 'supplement:test:issue-066:operation';
  const grantId = 'industrial:test:issue-066:grant';
  const segmentId = `${operationId}:segment:0`;
  const leftSocket = routeSocket(
    'industrial:test:issue-066:left',
    'authored-left',
    { x: 0, y: leftElevation, z: worldZ },
    { x: 1, y: 0, z: 0 },
  );
  const rightSocket = routeSocket(
    'industrial:test:issue-066:right',
    'authored-right',
    { x: spanCells * TILE_SIZE, y: rightElevation, z: worldZ },
    { x: -1, y: 0, z: 0 },
  );
  const orderedSockets = reversed
    ? [rightSocket, leftSocket]
    : [leftSocket, rightSocket];
  const orderedGridX = reversed
    ? Array.from({ length: spanCells + 1 }, (_, index) => spanCells - index)
    : Array.from({ length: spanCells + 1 }, (_, index) => index);
  const segment = {
    id: segmentId,
    operationId,
    connectorFamily,
    from: { ...orderedSockets[0], kind: 'parentSocket' },
    to: { ...orderedSockets[1], kind: 'parentSocket' },
    path: orderedGridX.map((x, index) => ({
      x: x * TILE_SIZE,
      y: index === orderedGridX.length - 1
        ? orderedSockets[1].position.y
        : orderedSockets[0].position.y,
      z: worldZ,
    })),
  };
  segment.endpointSeams = [
    createDungeonRouteEndpointSeam(segment.from, {
      segmentId,
      operationId,
      nodeId: segment.from.nodeId,
      socketId: segment.from.socketId,
      role: 'from',
      tileSize: TILE_SIZE,
    }),
    createDungeonRouteEndpointSeam(segment.to, {
      segmentId,
      operationId,
      nodeId: segment.to.nodeId,
      socketId: segment.to.socketId,
      role: 'to',
      tileSize: TILE_SIZE,
    }),
  ];
  const themeBinding = { themeId: 'industrial-v1', themeSessionId: 'issue-066-test' };
  const operation = {
    id: operationId,
    type: 'routeNetwork',
    grantId,
    routeNetworkKind: 'objective-route-coverage',
    endpointSocketIds: [leftSocket.id, rightSocket.id],
    nodeIds: [],
    segmentIds: [segmentId],
    accessDomainId: 'industrial:test:band-1',
    progressionBandId: 1,
    themeBinding,
  };
  return {
    segment,
    rooms: [
      {
        id: 'authored-left',
        x: -2,
        z: Math.round(Number(worldZ.toFixed(6)) / TILE_SIZE),
        width: 5,
        depth: 5,
        baseElevation: leftElevation,
        plannedBaseElevation: leftElevation,
        exitSockets: [],
      },
      {
        id: 'authored-right',
        x: spanCells + 2,
        z: Math.round(Number(worldZ.toFixed(6)) / TILE_SIZE),
        width: 5,
        depth: 5,
        baseElevation: rightElevation,
        plannedBaseElevation: rightElevation,
        exitSockets: [],
      },
    ],
    overlayPlan: {
      profileId: 'industrial-supplement-preview-v4',
      profileRevision: 5,
      operations: [operation],
      nodes: [],
      segments: [segment],
    },
    extensionRegions: [{
      id: 'industrial:test:region',
      themeBinding,
      routeNetworkGrants: [{
        id: grantId,
        routeNetworkKind: operation.routeNetworkKind,
        endpointSockets: [leftSocket, rightSocket],
        accessDomainId: operation.accessDomainId,
        progressionBandId: operation.progressionBandId,
        themeBinding,
      }],
    }],
  };
}

function materializeV4LevelSpineFixture(fixture) {
  return materializeIndustrialOverlay({
    rooms: fixture.rooms,
    overlayPlan: fixture.overlayPlan,
    extensionRegions: fixture.extensionRegions,
    tileSize: TILE_SIZE,
  });
}

test('V4 materialization preserves the ordered centerline as authoritative floor intent', () => {
  const fixture = v4LevelSpineFixture();
  const result = materializeV4LevelSpineFixture(fixture);

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  const plan = result.connectionPlans.find(({ id }) => id === fixture.segment.id);
  assert.ok(plan);
  const spine = plan.authoritativeTraversalSpine;
  assert.equal(spine.schema, 'ruindivex-dungeon-authoritative-traversal-spine/v1');
  assert.deepEqual(spine.endpointSeamIds, fixture.segment.endpointSeams.map(({ id }) => id));
  assert.deepEqual(
    spine.floorStampOrder.map(({ kind }) => kind),
    ['endpoint-seam', 'endpoint-seam', 'ordered-centerline'],
  );
  assert.deepEqual(
    spine.orderedCells.map(({ grid }) => grid),
    Array.from({ length: 9 }, (_, x) => ({ x, z: 0 })),
  );
  assert.deepEqual(
    spine.requiredFloorKeys,
    Array.from({ length: 9 }, (_, x) => `${x},0@y14.000`),
  );
  assert.deepEqual(
    spine.orderedCells.slice(0, 3).map(({ seamCellIds }) => seamCellIds.length),
    [1, 1, 1],
  );
  assert.deepEqual(
    spine.orderedCells.slice(-3).map(({ seamCellIds }) => seamCellIds.length),
    [1, 1, 1],
  );
  assert.equal(spine.precommitTraversal.forwardAccepted, true);
  assert.equal(spine.precommitTraversal.reverseAccepted, true);
  assert.equal(spine.precommitTraversal.forwardReachableCellCount, 9);
  assert.equal(spine.precommitTraversal.reverseReachableCellCount, 9);
  assert.equal(spine.finalCollisionVerificationRequired, true);
  assert.equal(plan.connectorVariantConstraints.finalCollisionSpineVerificationRequired, true);
});

test('V4 route connector rejection preserves exact segment and grant diagnostics', () => {
  const fixture = v4LevelSpineFixture({
    connectorFamily: 'lift',
    leftElevation: 0,
    rightElevation: 14,
    spanCells: 4,
  });
  const result = materializeV4LevelSpineFixture(fixture);

  assert.equal(result.diagnostics.accepted, false);
  assert.equal(result.diagnostics.atomicRejected, true);
  assert.match(
    result.diagnostics.errors.join(' | '),
    /cannot realize lift contract: .*no exterior straight run/i,
  );
  assert.deepEqual(result.diagnostics.materializationFailures, [{
    code: 'DUNGEON_SUPPLEMENT_CONNECTOR_CONTRACT_REJECTED',
    diagnosticCode: null,
    message: result.diagnostics.errors[0],
    operationId: fixture.overlayPlan.operations[0].id,
    grantId: fixture.overlayPlan.operations[0].grantId,
    entityKind: 'segment',
    segmentId: fixture.segment.id,
    connectorFamily: 'lift',
  }]);
});

test('V4 authoritative level spines remain exact when source and destination are reversed', () => {
  const fixture = v4LevelSpineFixture({ reversed: true });
  const result = materializeV4LevelSpineFixture(fixture);

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  const spine = result.connectionPlans.find(({ id }) => id === fixture.segment.id)
    ?.authoritativeTraversalSpine;
  assert.ok(spine);
  assert.deepEqual(
    spine.orderedCells.map(({ grid }) => grid),
    Array.from({ length: 9 }, (_, index) => ({ x: 8 - index, z: 0 })),
  );
  assert.equal(spine.precommitTraversal.forwardAccepted, true);
  assert.equal(spine.precommitTraversal.reverseAccepted, true);
});

test('V4 centerlines consume the seam grid identity at half-tile float boundaries', () => {
  const fixture = v4LevelSpineFixture({ worldZ: 43.39999999999999 });
  const result = materializeV4LevelSpineFixture(fixture);

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  const plan = result.connectionPlans.find(({ id }) => id === fixture.segment.id);
  assert.ok(plan);
  const seamThresholdGridZ = fixture.segment.endpointSeams[0].orderedCells.find((cell) => (
    cell.lane === 0 && cell.signedDepthTiles === 0
  )).gridZ;
  assert.equal(seamThresholdGridZ, 16);
  assert.equal(plan.fromSocket.z, seamThresholdGridZ);
  assert.equal(plan.toSocket.z, seamThresholdGridZ);
  assert.ok(plan.fullPath.every(({ z }) => z === seamThresholdGridZ));
  assert.ok(plan.authoritativeTraversalSpine.requiredFloorKeys.every((floorKey) => (
    floorKey.includes(',16@y14.000')
  )));
});

test('V4 level spines reject a wrong-side lead before committing a connection', () => {
  const fixture = v4LevelSpineFixture();
  fixture.segment.path[1] = { x: -TILE_SIZE, y: 14, z: 0 };
  const result = materializeV4LevelSpineFixture(fixture);

  assert.equal(result.diagnostics.accepted, false);
  assert.equal(result.diagnostics.routeNetworkConnectionCount, 0);
  assert.match(
    result.diagnostics.errors.join(' | '),
    /DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE/,
  );
});

test('V4 level spines reject one-tile seam doglegs before committing a connection', () => {
  const fixture = v4LevelSpineFixture();
  fixture.segment.path[2] = { x: TILE_SIZE, y: 14, z: TILE_SIZE };
  const result = materializeV4LevelSpineFixture(fixture);

  assert.equal(result.diagnostics.accepted, false);
  assert.equal(result.diagnostics.routeNetworkConnectionCount, 0);
  assert.match(
    result.diagnostics.errors.join(' | '),
    /DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE/,
  );
});

test('V4 level spines expand accepted waypoints into complete authoritative floor intent', () => {
  const fixture = v4LevelSpineFixture();
  fixture.segment.path = [fixture.segment.path[0], fixture.segment.path.at(-1)];
  fixture.overlayPlan.segments = [fixture.segment];
  const result = materializeV4LevelSpineFixture(fixture);

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  const spine = result.connectionPlans.find(({ id }) => id === fixture.segment.id)
    ?.authoritativeTraversalSpine;
  assert.ok(spine);
  assert.deepEqual(
    spine.requiredFloorKeys,
    Array.from({ length: 9 }, (_, x) => `${x},0@y14.000`),
  );
  assert.equal(
    spine.precommitTraversal.missingFloorDiagnosticCode,
    'DUNGEON_AUGMENTATION_ROUTE_CENTERLINE_FLOOR_MISSING',
  );
});

function pyramidRouteNetworkFixture({
  corruptFirstEndpoint = false,
  shortcut = null,
} = {}) {
  const operationId = 'supplement:keycard-pyramid:routeNetwork:0:operation';
  const grantId = 'industrial-v1:keycard-pyramid:perimeter-loop';
  const eastSocketId = 'industrial-v1:keycardRoom:east-unused';
  const westSocketId = 'industrial-v1:keycardRoom:west-unused';
  const junctionId = `${operationId}:node:junction`;
  const rewardId = `${operationId}:node:reward`;
  const junctionWestId = `${junctionId}:west`;
  const junctionEastId = `${junctionId}:east`;
  const rewardEastId = `${rewardId}:east`;
  const rewardWestId = `${rewardId}:west`;
  const east = routeSocket(
    eastSocketId,
    'keycardRoom',
    { x: 8.4, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  );
  const west = routeSocket(
    westSocketId,
    'keycardRoom',
    { x: -8.4, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
  );
  const junctionSockets = [
    routeSocket(junctionWestId, junctionId, { x: 11.2, y: 0, z: -25.2 }, { x: -1, y: 0, z: 0 }),
    routeSocket(junctionEastId, junctionId, { x: 30.8, y: 0, z: -25.2 }, { x: 1, y: 0, z: 0 }),
    routeSocket(`${junctionId}:south`, junctionId, { x: 21, y: 0, z: -15.4 }, { x: 0, y: 0, z: 1 }),
  ];
  const rewardSockets = [
    routeSocket(rewardEastId, rewardId, { x: -11.2, y: 0, z: -25.2 }, { x: 1, y: 0, z: 0 }),
    routeSocket(rewardWestId, rewardId, { x: -30.8, y: 0, z: -25.2 }, { x: -1, y: 0, z: 0 }),
  ];
  const nodes = [
    routeNode({
      id: junctionId,
      operationId,
      center: { x: 21, y: 0, z: -25.2 },
      sockets: junctionSockets,
      contentRole: 'challenge-junction',
      junction: {
        junctionKind: 'through-t',
        throughSocketPairs: [[junctionWestId, junctionEastId]],
        decisionSocketIds: [`${junctionId}:south`],
        countsAsMeaningfulStation: true,
      },
    }),
    routeNode({
      id: rewardId,
      operationId,
      center: { x: -21, y: 0, z: -25.2 },
      sockets: rewardSockets,
      contentRole: 'treasure',
    }),
  ];
  const segment = (id, from, to, path, extra = {}) => ({
    id,
    operationId,
    connectorFamily: 'service-gallery',
    from,
    to,
    path,
    ...extra,
  });
  const segments = [
    segment(
      `${operationId}:segment:entry`,
      {
        ...east,
        kind: 'parentSocket',
        position: corruptFirstEndpoint ? { x: 11.2, y: 0, z: 0 } : east.position,
      },
      { ...junctionSockets[0], kind: 'supplementSocket' },
      [east.position, { x: 11.2, y: 0, z: -25.2 }],
    ),
    segment(
      `${operationId}:segment:cross`,
      { ...junctionSockets[1], kind: 'supplementSocket' },
      { ...rewardSockets[0], kind: 'supplementSocket' },
      [junctionSockets[1].position, rewardSockets[0].position],
      {
        doorId: 'SupplementEncounterGate_0',
        requiresEncounterId: 'SupplementEncounter_0',
        gatePlacementSide: 'source',
        ...(shortcut ? { shortcut } : {}),
      },
    ),
    segment(
      `${operationId}:segment:return`,
      { ...rewardSockets[1], kind: 'supplementSocket' },
      { ...west, kind: 'parentSocket' },
      [rewardSockets[1].position, west.position],
    ),
  ];
  const operation = {
    id: operationId,
    type: 'routeNetwork',
    grantId,
    routeNetworkKind: 'landmark-perimeter-loop',
    endpointSocketIds: [eastSocketId, westSocketId],
    nodeIds: nodes.map(({ id }) => id),
    segmentIds: segments.map(({ id }) => id),
    topologyTemplateId: 'fork-merge-h-loop',
    junctionKinds: ['through-t'],
    elevationModes: ['split-level-platform'],
    accessDomainId: 'industrial:band-0',
    progressionBandId: 0,
    cycleRankDelta: 1,
  };
  return {
    overlayPlan: { operations: [operation], nodes, segments },
    extensionRegions: [{
      id: 'industrial-v1:main-region',
      routeNetworkGrants: [{
        id: grantId,
        kind: 'landmark-perimeter-loop',
        routeNetworkKind: 'landmark-perimeter-loop',
        endpointSockets: [east, west],
        progressionBandId: 0,
        accessDomainId: 'industrial:band-0',
      }],
    }],
  };
}

test('V4 pyramid route networks bind both unused wall sockets exactly and preserve source gates', () => {
  const fixture = pyramidRouteNetworkFixture();
  const keycardRoom = {
    id: 'keycardRoom',
    x: 0,
    z: 0,
    width: 7,
    depth: 7,
    baseElevation: 0,
    plannedBaseElevation: 0,
    exitSockets: [],
  };
  const result = materializeIndustrialOverlay({
    rooms: [keycardRoom],
    overlayPlan: fixture.overlayPlan,
    extensionRegions: fixture.extensionRegions,
    tileSize: TILE_SIZE,
  });

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  assert.equal(result.diagnostics.routeNetworkCount, 1);
  assert.equal(result.diagnostics.routeNetworkConnectionCount, 3);
  const opened = result.rooms.find(({ id }) => id === 'keycardRoom').exitSockets;
  assert.deepEqual(opened.map(({ id }) => id).sort(), [
    'industrial-v1:keycardRoom:east-unused',
    'industrial-v1:keycardRoom:west-unused',
  ]);
  assert.ok(opened.every((socket) => socket.exactSocketBinding === true));
  assert.ok(opened.every((socket) => Math.abs(socket.landingWidth - 8.4) < 1e-9));
  const entry = result.connectionPlans.find(({ id }) => id.endsWith('segment:entry'));
  assert.deepEqual(entry.fullPath.slice(0, 3), [
    { x: 3, z: 0 },
    { x: 3, z: -1 },
    { x: 3, z: -2 },
  ]);
  assert.equal(entry.fromSocket.id, 'industrial-v1:keycardRoom:east-unused');
  assert.deepEqual(entry.landingOverlapGrants[0].size, { x: 5.6, y: 3.6, z: 8.399999999999999 });
  const controlled = result.connectionPlans.find(({ id }) => id.endsWith('segment:cross'));
  assert.equal(controlled.doorId, 'SupplementEncounterGate_0');
  assert.equal(controlled.requiresEncounterId, 'SupplementEncounter_0');
  assert.equal(controlled.gatePlacementSide, 'source');
  assert.equal(controlled.gateSourceRoomId, controlled.fromRoomId);
  const junction = result.rooms.find(({ id }) => id.endsWith('node:junction'));
  assert.equal(junction.junctionKind, 'through-t');
  assert.equal(junction.countsAsMeaningfulStation, true);
  assert.ok(Math.abs(junction.augmentationJunction.clearCoreVolume.size.x - 8.4) < 1e-9);
});

test('V4 pyramid materialization rejects displaced parent thresholds even with authored socket metadata', () => {
  const fixture = pyramidRouteNetworkFixture();
  const [entry, , reconnect] = fixture.overlayPlan.segments;
  const grant = fixture.extensionRegions[0].routeNetworkGrants[0];
  const nodeById = new Map(fixture.overlayPlan.nodes.map((node) => [node.id, node]));
  const bindSharedThreshold = (segment, endpointRole, oppositeRole, grantedSocket) => {
    const endpoint = segment[endpointRole];
    const opposite = segment[oppositeRole];
    const oppositeNode = nodeById.get(opposite.nodeId);
    const oppositeSocket = oppositeNode.sockets.find((socket) => socket.id === opposite.socketId);
    const threshold = dungeonLandmarkSharedThresholdParentPosition(
      grantedSocket,
      oppositeSocket,
    );
    segment.routeRole = 'parent-station-attachment';
    endpoint.position = threshold;
    endpoint.authoredSocketPosition = { ...grantedSocket.position };
    if (endpointRole === 'from') segment.path[0] = { ...threshold };
    else segment.path[segment.path.length - 1] = { ...threshold };
  };
  bindSharedThreshold(entry, 'from', 'to', grant.endpointSockets[0]);
  bindSharedThreshold(reconnect, 'to', 'from', grant.endpointSockets[1]);

  const result = materializeIndustrialOverlay({
    rooms: [{
      id: 'keycardRoom',
      x: 0,
      z: 0,
      width: 7,
      depth: 7,
      baseElevation: 0,
      plannedBaseElevation: 0,
      exitSockets: [],
    }],
    overlayPlan: fixture.overlayPlan,
    extensionRegions: fixture.extensionRegions,
    tileSize: TILE_SIZE,
  });

  assert.equal(result.diagnostics.accepted, false);
  assert.equal(result.diagnostics.routeNetworkConnectionCount, 0);
  assert.match(result.diagnostics.errors.join(' | '), /does not match granted socket/i);
});

test('V4 materialized shortcut plans share deterministic mechanism identity and elevation modes', () => {
  const stateId = 'supplement:pyramid-loop:state:shortcut';
  const fixture = pyramidRouteNetworkFixture({
    shortcut: {
      kind: 'drop-ladder',
      stateId,
      initialState: 'retracted',
      activatedState: 'deployed',
      activationSide: 'far',
      persistent: true,
    },
  });
  const result = materializeIndustrialOverlay({
    rooms: [{
      id: 'keycardRoom',
      x: 0,
      z: 0,
      width: 7,
      depth: 7,
      baseElevation: 0,
      plannedBaseElevation: 0,
      exitSockets: [],
    }],
    overlayPlan: fixture.overlayPlan,
    extensionRegions: fixture.extensionRegions,
    tileSize: TILE_SIZE,
  });

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  const plan = result.connectionPlans.find(({ id }) => id.endsWith('segment:cross'));
  assert.ok(plan);
  assert.equal(plan.shortcutMode, 'drop-ladder');
  assert.equal(plan.shortcutStateId, stateId);
  assert.equal(
    plan.shortcutMechanismId,
    'supplementShortcutMechanism__supplement_keycard-pyramid_routeNetwork_0_operation__supplement_keycard-pyramid_routeNetwork_0_operation_segment_cross',
  );
  assert.deepEqual(plan.elevationModes, ['split-level-platform']);
});

test('V4 route networks reject any parent endpoint position that differs from its exact grant', () => {
  const fixture = pyramidRouteNetworkFixture({ corruptFirstEndpoint: true });
  const result = materializeIndustrialOverlay({
    rooms: [{ id: 'keycardRoom', x: 0, z: 0, width: 7, depth: 7, exitSockets: [] }],
    overlayPlan: fixture.overlayPlan,
    extensionRegions: fixture.extensionRegions,
    tileSize: TILE_SIZE,
  });

  assert.equal(result.diagnostics.accepted, false);
  assert.equal(result.diagnostics.routeNetworkConnectionCount, 0);
  assert.match(result.diagnostics.errors.join(' | '), /does not match granted socket/i);
});

test('corridor-station grants become exact T-junction proxies with one deeper-side graph link', () => {
  const operationId = 'supplement:coverage:routeNetwork:0';
  const grantId = 'industrial:coverage:enemyNest-keycard:0';
  const stationSocketId = `${grantId}:north`;
  const destinationSocketId = `${grantId}:destination-wall`;
  const nodeId = `${operationId}:node:challenge`;
  const nodeEntry = routeSocket(
    `${nodeId}:entry`,
    nodeId,
    { x: 0, y: 0, z: -30.8 },
    { x: 0, y: 0, z: 1 },
  );
  const stationSocket = {
    ...routeSocket(
      stationSocketId,
      'authored-b',
      { x: 0, y: 0, z: -4.2 },
      { x: 0, y: 0, z: -1 },
    ),
    routeNetworkSocketKind: 'authored-corridor-station',
    parentRouteId: 'authored-a_authored-b_ground',
    sourceCenterlinePosition: { x: 0, y: 0, z: 0 },
  };
  const destinationSocket = routeSocket(
    destinationSocketId,
    'authored-b',
    { x: 28, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
  );
  const rooms = [
    { id: 'authored-a', x: -10, z: 0, width: 3, depth: 3, exitSockets: [] },
    { id: 'authored-b', x: 10, z: 0, width: 3, depth: 3, exitSockets: [] },
  ];
  const connectionPlans = [{
    id: 'authored-a_authored-b_ground',
    logicalConnectionId: 'authored-a_authored-b',
    fromRoomId: 'authored-a',
    toRoomId: 'authored-b',
    level: 0,
    elevation: 0,
    doorId: 'Door_Alpha',
    fullPath: Array.from({ length: 21 }, (_, index) => ({ x: index - 10, z: 0 })),
    bridgePath: Array.from({ length: 19 }, (_, index) => ({ x: index - 9, z: 0 })),
    fromSocket: { id: 'a:exit', roomId: 'authored-a', x: -9, z: 0, elevation: 0 },
    toSocket: { id: 'b:entry', roomId: 'authored-b', x: 9, z: 0, elevation: 0 },
    connectorVariantConstraints: {
      roomFootprints: [{
        roomId: 'authored-base-only',
        minX: -12,
        maxX: 12,
        minZ: -2,
        maxZ: 2,
      }],
      blockedLanePoints: [],
    },
  }];
  const segmentId = `${operationId}:segment:0`;
  const overlayPlan = {
    operations: [{
      id: operationId,
      type: 'routeNetwork',
      grantId,
      routeNetworkKind: 'featureless-span-coverage',
      endpointSocketIds: [stationSocketId, destinationSocketId],
      nodeIds: [nodeId],
      segmentIds: [segmentId, `${operationId}:segment:1`],
      progressionBandId: 1,
      accessDomainId: 'industrial:band-1',
    }],
    nodes: [routeNode({
      id: nodeId,
      operationId,
      center: { x: 0, y: 0, z: -40.6 },
      sockets: [nodeEntry, routeSocket(
        `${nodeId}:exit`, nodeId, { x: 9.8, y: 0, z: -40.6 }, { x: 1, y: 0, z: 0 },
      )],
    })],
    segments: [
      {
        id: segmentId,
        operationId,
        connectorFamily: 'service-gallery',
        from: { ...stationSocket, kind: 'parentSocket' },
        to: { ...nodeEntry, kind: 'supplementSocket' },
        path: [stationSocket.position, nodeEntry.position],
      },
      {
        id: `${operationId}:segment:1`,
        operationId,
        connectorFamily: 'service-gallery',
        from: {
          ...routeSocket(`${nodeId}:exit`, nodeId, { x: 9.8, y: 0, z: -40.6 }, { x: 1, y: 0, z: 0 }),
          kind: 'supplementSocket',
        },
        to: { ...destinationSocket, kind: 'parentSocket' },
        path: [
          { x: 9.8, y: 0, z: -40.6 },
          { x: 14, y: 0, z: -40.6 },
          { x: 14, y: 0, z: 0 },
          destinationSocket.position,
        ],
      },
    ],
  };
  for (const segment of overlayPlan.segments) {
    segment.endpointSeams = [
      createDungeonRouteEndpointSeam(segment.from, {
        segmentId: segment.id,
        operationId,
        nodeId: segment.from.nodeId,
        socketId: segment.from.socketId,
        role: 'from',
        tileSize: TILE_SIZE,
      }),
      createDungeonRouteEndpointSeam(segment.to, {
        segmentId: segment.id,
        operationId,
        nodeId: segment.to.nodeId,
        socketId: segment.to.socketId,
        role: 'to',
        tileSize: TILE_SIZE,
      }),
    ];
  }
  const result = materializeIndustrialOverlay({
    rooms,
    connectionPlans,
    overlayPlan,
    extensionRegions: [{
      id: 'industrial-v1:main-region',
      routeNetworkGrants: [{ id: grantId, endpointSockets: [stationSocket, destinationSocket] }],
    }],
    tileSize: TILE_SIZE,
  });

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  assert.equal(result.diagnostics.routeStationGraphConnectionCount, 1);
  const authoredPlan = result.connectionPlans.find(({ id }) => (
    id === 'authored-a_authored-b_ground'
  ));
  assert.deepEqual(authoredPlan.connectorVariantConstraints.roomFootprints, [
    {
      roomId: 'authored-base-only',
      minX: -12,
      maxX: 12,
      minZ: -2,
      maxZ: 2,
    },
  ]);
  const station = result.connectorJunctionProxies.find((room) => room.isRouteStationProxy);
  assert.ok(station);
  assert.equal(result.rooms.some((room) => room.isRouteStationProxy), false);
  assert.equal(result.rooms.some((room) => room.id === station.id), false);
  assert.deepEqual({ x: station.x, z: station.z }, { x: 0, z: 0 });
  assert.equal(station.routeNetworkSocketId, stationSocketId);
  assert.equal(station.junctionKind, 'through-t');
  assert.equal(station.suppressRoomGeometry, true);
  assert.equal(station.isConnectorJunctionProxy, true);
  assert.equal(station.isDungeonSupplement, false);
  assert.equal(result.supplementalRoomIds.includes(station.id), false);
  assert.equal(result.diagnostics.connectorJunctionProxyCount, 1);
  assert.equal(result.diagnostics.roomCount, 1);
  const branch = result.connectionPlans.find(({ id }) => id === segmentId);
  assert.equal(branch.fromRoomId, station.id);
  assert.equal(branch.progressionFromRoomId, 'authored-b');
  assert.deepEqual(branch.fullPath[0], { x: 0, z: -2 });
  assert.equal(branch.fromSocket.id, stationSocketId);
  assert.equal(branch.fromSocket.routeNetworkSocketKind, 'authored-corridor-station');
  assert.equal(branch.fromSocket.connectorJunctionProxyId, station.id);
  assert.equal(branch.fromSocket.progressionRoomId, 'authored-b');
  assert.equal(branch.endpointSeams[0].nodeId, 'authored-b');
  assert.equal(branch.endpointSeams[0].socketId, stationSocketId);
  assert.notEqual(branch.endpointSeams[0].nodeId, station.id);
  const graphLink = result.connectionPlans.find((plan) => plan.parentRouteStationLink);
  assert.equal(graphLink.fromRoomId, station.id);
  assert.equal(graphLink.toRoomId, 'authored-b');
  assert.equal(graphLink.doorId, null);
  assert.equal(graphLink.isSupplementGraphConnection, true);
  assert.deepEqual(result.supplementalPhysicalConnectionIds.sort(), [
    segmentId,
    `${operationId}:segment:1`,
  ].sort());
  assert.deepEqual(result.supplementalGraphOnlyConnectionIds, [graphLink.id]);
  assert.equal(result.diagnostics.connectionCount, 2);
  assert.equal(result.diagnostics.graphOnlyConnectionCount, 1);

  const foreignOwnerOverlay = structuredClone(overlayPlan);
  foreignOwnerOverlay.segments[0].endpointSeams[0].nodeId = 'foreign-parent';
  const foreignOwnerResult = materializeIndustrialOverlay({
    rooms,
    connectionPlans,
    overlayPlan: foreignOwnerOverlay,
    extensionRegions: [{
      id: 'industrial-v1:main-region',
      routeNetworkGrants: [{ id: grantId, endpointSockets: [stationSocket, destinationSocket] }],
    }],
    tileSize: TILE_SIZE,
  });
  assert.equal(foreignOwnerResult.diagnostics.accepted, false);
  assert.match(
    foreignOwnerResult.diagnostics.errors.join(' | '),
    /from endpoint seam identity changed during materialization/i,
  );
});

function sharedJunctionThresholdFixture() {
  const operationId = 'supplement:coverage:shared-threshold:operation';
  const grantId = 'industrial:coverage:shared-threshold';
  const firstStationSocketId = `${grantId}:station:a`;
  const secondStationSocketId = `${grantId}:station:b`;
  const firstParentRouteId = `${grantId}:parent-route:a`;
  const secondParentRouteId = `${grantId}:parent-route:b`;
  const firstJunctionId = `${operationId}:junction:a`;
  const secondJunctionId = `${operationId}:junction:b`;
  const challengeId = `${operationId}:room:challenge`;
  const rewardId = `${operationId}:room:reward`;
  const firstAttachmentSegmentId = `${operationId}:segment:parent-a`;
  const challengeSegmentId = `${operationId}:segment:challenge`;
  const sharedSegmentId = `${operationId}:segment:shared-threshold`;
  const rewardSegmentId = `${operationId}:segment:reward`;
  const secondAttachmentSegmentId = `${operationId}:segment:parent-b`;

  const firstStationSocket = {
    ...routeSocket(
      firstStationSocketId,
      'authored-a-destination',
      { x: -7, y: 0, z: -15.4 },
      { x: 0, y: 0, z: 1 },
    ),
    routeNetworkSocketKind: 'authored-corridor-station',
    parentRouteId: firstParentRouteId,
    sourceCenterlinePosition: { x: -7, y: 0, z: -19.6 },
    distanceMeters: 0,
  };
  const secondStationSocket = {
    ...routeSocket(
      secondStationSocketId,
      'authored-b-destination',
      { x: 7, y: 0, z: 15.4 },
      { x: 0, y: 0, z: -1 },
    ),
    routeNetworkSocketKind: 'authored-corridor-station',
    parentRouteId: secondParentRouteId,
    sourceCenterlinePosition: { x: 7, y: 0, z: 19.6 },
    distanceMeters: 28,
  };

  const connectorSocket = ({
    id,
    nodeId,
    localSocketId,
    position,
    facing,
    segmentId,
  }) => ({
    ...routeSocket(id, nodeId, position, facing),
    localSocketId,
    segmentId,
  });
  const firstSockets = [
    connectorSocket({
      id: `${firstJunctionId}:entry`,
      nodeId: firstJunctionId,
      localSocketId: 'entry',
      position: { x: -7, y: 0, z: -9.8 },
      facing: { x: 0, y: 0, z: -1 },
      segmentId: firstAttachmentSegmentId,
    }),
    connectorSocket({
      id: `${firstJunctionId}:exit`,
      nodeId: firstJunctionId,
      localSocketId: 'exit',
      position: { x: -7, y: 0, z: 9.8 },
      facing: { x: 0, y: 0, z: 1 },
      segmentId: challengeSegmentId,
    }),
    connectorSocket({
      id: `${firstJunctionId}:right`,
      nodeId: firstJunctionId,
      localSocketId: 'right',
      position: { x: 0, y: 0, z: 0 },
      facing: { x: 1, y: 0, z: 0 },
      segmentId: sharedSegmentId,
    }),
  ];
  const secondSockets = [
    connectorSocket({
      id: `${secondJunctionId}:entry`,
      nodeId: secondJunctionId,
      localSocketId: 'entry',
      position: { x: 7, y: 0, z: 9.8 },
      facing: { x: 0, y: 0, z: 1 },
      segmentId: secondAttachmentSegmentId,
    }),
    connectorSocket({
      id: `${secondJunctionId}:exit`,
      nodeId: secondJunctionId,
      localSocketId: 'exit',
      position: { x: 7, y: 0, z: -9.8 },
      facing: { x: 0, y: 0, z: -1 },
      segmentId: rewardSegmentId,
    }),
    connectorSocket({
      id: `${secondJunctionId}:left`,
      nodeId: secondJunctionId,
      localSocketId: 'left',
      position: { x: 0, y: 0, z: 0 },
      facing: { x: -1, y: 0, z: 0 },
      segmentId: sharedSegmentId,
    }),
  ];
  const connectorNode = ({ id, center, sockets, parentEndpointSocketId }) => ({
    id,
    operationId,
    kind: 'supplementConnectorJunction',
    grammarId: 'supplement-route-connector-through-t-v1',
    moduleKind: 'connector-module',
    connectorOwned: true,
    connectorInfrastructure: true,
    exactParentEndpoint: true,
    parentEndpointSocketId,
    parentEndpointSocketKind: 'authored-corridor-station',
    parentThroughRouteDegreeContribution: 1,
    placement: { center, rotationQuarterTurns: 0 },
    size: { x: 14, y: 5.6, z: 19.6 },
    sockets,
    anchors: [],
    occupiedVolumes: [{
      id: `${id}:occupied`,
      ownerId: id,
      center,
      size: { x: 14, y: 5.6, z: 19.6 },
    }],
    clearanceVolumes: [{
      id: `${id}:clearance`,
      ownerId: id,
      center: { ...center, y: 2.8 },
      size: { x: 14, y: 5.6, z: 19.6 },
    }],
    junction: {
      junctionKind: 'through-t',
      throughSocketPairs: [[sockets[0].id, sockets[1].id]],
      decisionSocketIds: [sockets[2].id],
      countsAsMeaningfulStation: true,
    },
    junctionKind: 'through-t',
    countsAsMeaningfulStation: true,
    contentRole: 'junction',
    accessDomainId: 'industrial:band-1',
    progressionBandId: 1,
  });
  const firstJunction = connectorNode({
    id: firstJunctionId,
    center: { x: -7, y: 0, z: 0 },
    sockets: firstSockets,
    parentEndpointSocketId: firstStationSocketId,
  });
  const secondJunction = connectorNode({
    id: secondJunctionId,
    center: { x: 7, y: 0, z: 0 },
    sockets: secondSockets,
    parentEndpointSocketId: secondStationSocketId,
  });

  const challengeEntry = routeSocket(
    `${challengeId}:entry`,
    challengeId,
    { x: -7, y: 0, z: 18.2 },
    { x: 0, y: 0, z: -1 },
  );
  challengeEntry.localSocketId = 'entry';
  challengeEntry.segmentId = challengeSegmentId;
  const rewardEntry = routeSocket(
    `${rewardId}:entry`,
    rewardId,
    { x: 7, y: 0, z: -18.2 },
    { x: 0, y: 0, z: 1 },
  );
  rewardEntry.localSocketId = 'entry';
  rewardEntry.segmentId = rewardSegmentId;
  const challenge = {
    ...routeNode({
      id: challengeId,
      operationId,
      center: { x: -7, y: 0, z: 28 },
      sockets: [challengeEntry],
      contentRole: 'challenge',
    }),
    kind: 'supplementRoom',
    moduleKind: 'room',
  };
  const reward = {
    ...routeNode({
      id: rewardId,
      operationId,
      center: { x: 7, y: 0, z: -28 },
      sockets: [rewardEntry],
      contentRole: 'reward',
    }),
    kind: 'supplementRoom',
    moduleKind: 'room',
  };

  const segment = (id, from, to, path, extra = {}) => ({
    id,
    operationId,
    connectorFamily: 'service-gallery',
    from,
    to,
    path,
    ...extra,
  });
  const sharedPosition = { x: 0, y: 0, z: 0 };
  const sharedApproachWitnesses = [
    {
      nodeId: firstJunctionId,
      socketId: firstSockets[2].id,
      localSocketId: 'right',
      path: [{ x: -5.6, y: 0, z: 0 }, sharedPosition],
    },
    {
      nodeId: secondJunctionId,
      socketId: secondSockets[2].id,
      localSocketId: 'left',
      path: [{ x: 5.6, y: 0, z: 0 }, sharedPosition],
    },
  ];
  const sharedSegment = segment(
    sharedSegmentId,
    { ...firstSockets[2], kind: 'supplementSocket' },
    { ...secondSockets[2], kind: 'supplementSocket' },
    [sharedPosition, { ...sharedPosition }],
    {
      kind: 'shared-junction-threshold',
      sharedCorridorDistanceMeters: 0,
      sharedEndpointFootprint: {
        kind: 'shared-junction-threshold',
        center: sharedPosition,
        size: { x: 2.8, y: 5.6, z: 8.4 },
        nodeIds: [firstJunctionId, secondJunctionId],
        socketIds: [firstSockets[2].id, secondSockets[2].id],
      },
      localApproachWitnesses: sharedApproachWitnesses,
      occupiedVolumes: [],
      clearanceVolumes: [],
      landingVolumes: [],
      landings: [
        { id: `${sharedSegmentId}:from-landing`, position: sharedPosition, flat: true },
        { id: `${sharedSegmentId}:to-landing`, position: sharedPosition, flat: true },
      ],
    },
  );
  const segments = [
    segment(
      firstAttachmentSegmentId,
      { ...firstStationSocket, kind: 'parentSocket' },
      { ...firstSockets[0], kind: 'supplementSocket' },
      [firstStationSocket.position, firstSockets[0].position],
    ),
    segment(
      challengeSegmentId,
      { ...firstSockets[1], kind: 'supplementSocket' },
      { ...challengeEntry, kind: 'supplementSocket' },
      [firstSockets[1].position, challengeEntry.position],
    ),
    sharedSegment,
    segment(
      rewardSegmentId,
      { ...secondSockets[1], kind: 'supplementSocket' },
      { ...rewardEntry, kind: 'supplementSocket' },
      [secondSockets[1].position, rewardEntry.position],
    ),
    segment(
      secondAttachmentSegmentId,
      { ...secondSockets[0], kind: 'supplementSocket' },
      { ...secondStationSocket, kind: 'parentSocket' },
      [secondSockets[0].position, secondStationSocket.position],
    ),
  ];
  const operation = {
    id: operationId,
    type: 'routeNetwork',
    parentRegionId: 'industrial-v1:main-region',
    grantId,
    routeNetworkKind: 'objective-route-coverage',
    endpointSocketIds: [firstStationSocketId, secondStationSocketId],
    nodeIds: [firstJunctionId, challengeId, secondJunctionId, rewardId],
    segmentIds: segments.map(({ id }) => id),
    topologyTemplateId: 'parallel-station-loop',
    junctionKinds: ['through-t'],
    elevationModes: ['split-level-platform'],
    accessDomainId: 'industrial:band-1',
    progressionBandId: 1,
    cycleRankDelta: 1,
  };
  const rooms = [
    { id: 'authored-a-source', x: -10, z: -7, width: 3, depth: 3, exitSockets: [] },
    { id: 'authored-a-destination', x: 2, z: -7, width: 3, depth: 3, exitSockets: [] },
    { id: 'authored-b-source', x: -1, z: 7, width: 3, depth: 3, exitSockets: [] },
    { id: 'authored-b-destination', x: 7, z: 7, width: 3, depth: 3, exitSockets: [] },
  ];
  const parentConnectionPlan = ({
    id,
    fromRoomId,
    toRoomId,
    minX,
    maxX,
    z,
  }) => ({
    id,
    logicalConnectionId: `${id}:logical`,
    fromRoomId,
    toRoomId,
    level: 0,
    elevation: 0,
    doorId: null,
    fullPath: Array.from({ length: maxX - minX + 1 }, (_, index) => ({
      x: minX + index,
      z,
    })),
    bridgePath: Array.from({ length: Math.max(0, maxX - minX - 1) }, (_, index) => ({
      x: minX + index + 1,
      z,
    })),
    fromSocket: { id: `${id}:from`, roomId: fromRoomId, x: minX, z, elevation: 0 },
    toSocket: { id: `${id}:to`, roomId: toRoomId, x: maxX, z, elevation: 0 },
  });
  const connectionPlans = [
    parentConnectionPlan({
      id: firstParentRouteId,
      fromRoomId: 'authored-a-source',
      toRoomId: 'authored-a-destination',
      minX: -10,
      maxX: 2,
      z: -7,
    }),
    parentConnectionPlan({
      id: secondParentRouteId,
      fromRoomId: 'authored-b-source',
      toRoomId: 'authored-b-destination',
      minX: -1,
      maxX: 7,
      z: 7,
    }),
  ];
  return {
    operationId,
    sharedSegmentId,
    firstJunctionId,
    secondJunctionId,
    sharedApproachWitnesses,
    sharedEndpointFootprint: sharedSegment.sharedEndpointFootprint,
    rooms,
    connectionPlans,
    overlayPlan: {
      operations: [operation],
      nodes: [firstJunction, challenge, secondJunction, reward],
      segments,
    },
    extensionRegions: [{
      id: 'industrial-v1:main-region',
      routeNetworkGrants: [{
        id: grantId,
        kind: 'objective-route-coverage',
        routeNetworkKind: 'objective-route-coverage',
        endpointSockets: [firstStationSocket, secondStationSocket],
        progressionBandId: 1,
        accessDomainId: 'industrial:band-1',
      }],
    }],
  };
}

test('shared junction thresholds materialize one shared authoritative seam centerline', () => {
  const fixture = sharedJunctionThresholdFixture();
  const result = materializeIndustrialOverlay({
    rooms: fixture.rooms,
    connectionPlans: fixture.connectionPlans,
    overlayPlan: fixture.overlayPlan,
    extensionRegions: fixture.extensionRegions,
    tileSize: TILE_SIZE,
  });

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  const plan = result.connectionPlans.find(({ id }) => id === fixture.sharedSegmentId);
  assert.ok(plan);
  assert.equal(plan.isSharedThresholdConnection, true);
  assert.equal(plan.sharedThresholdRealization, 'adjacent-junction-core-floors');
  assert.deepEqual(plan.sharedEndpointFootprint, fixture.sharedEndpointFootprint);
  assert.deepEqual(plan.localApproachWitnesses, fixture.sharedApproachWitnesses);
  assert.ok(plan.localApproachWitnesses.every(({ path }) => (
    Math.hypot(
      path[1].x - path[0].x,
      path[1].y - path[0].y,
      path[1].z - path[0].z,
    ) === 5.6
  )));
  assert.deepEqual(plan.fullPath, [{ x: 0, z: 0 }]);
  assert.deepEqual(plan.bridgePath, plan.fullPath);
  assert.deepEqual(plan.fromSocket.grantedWorldPosition, { x: 0, y: 0, z: 0 });
  assert.deepEqual(plan.toSocket.grantedWorldPosition, { x: 0, y: 0, z: 0 });
  assert.deepEqual(
    [plan.fromSocket.x, plan.fromSocket.z, plan.toSocket.x, plan.toSocket.z],
    [0, 0, 0, 0],
  );
  assert.equal(plan.connectorVariantId, null);
  assert.equal(plan.connectorVariant, null);
  assert.equal(plan.connectorVariantConstraints.noCorridorStamp, true);
  assert.equal(plan.connectorVariantConstraints.reservedFootprintColumnCount, 0);
  assert.deepEqual(plan.landingOverlapGrants, []);
  assert.ok(result.supplementalPhysicalConnectionIds.includes(fixture.sharedSegmentId));

  const connectorById = new Map(result.connectorJunctionProxies.map((proxy) => [proxy.id, proxy]));
  for (const junctionId of [fixture.firstJunctionId, fixture.secondJunctionId]) {
    const junction = connectorById.get(junctionId);
    assert.ok(junction);
    assert.equal(junction.isSupplementConnectorJunction, true);
    assert.equal(junction.junctionKind, 'through-t');
    assert.ok(junction.physicalArmCount >= 3);
    assert.ok(junction.physicalArmIds.includes(`${junctionId}:authored-through:0`));
    assert.equal(junction.suppressRoomGeometry, true);
  }
});

test('connector proxies preserve planner-authored parent-through physical arm identities', () => {
  const fixture = sharedJunctionThresholdFixture();
  const expectedArmIdByNodeId = new Map();
  for (const node of fixture.overlayPlan.nodes.filter((candidate) => (
    candidate.exactParentEndpoint === true
      && candidate.parentEndpointSocketKind === 'authored-corridor-station'
  ))) {
    const armId = `${node.id}:authored-parent-through-arm`;
    node.parentThroughPhysicalArmId = armId;
    expectedArmIdByNodeId.set(node.id, armId);
  }

  const result = materializeIndustrialOverlay({
    rooms: fixture.rooms,
    connectionPlans: fixture.connectionPlans,
    overlayPlan: fixture.overlayPlan,
    extensionRegions: fixture.extensionRegions,
    tileSize: TILE_SIZE,
  });

  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  for (const proxy of result.connectorJunctionProxies.filter(({ id }) => (
    expectedArmIdByNodeId.has(id)
  ))) {
    assert.equal(proxy.parentThroughPhysicalArmId, expectedArmIdByNodeId.get(proxy.id));
    assert.ok(proxy.physicalArmIds.includes(expectedArmIdByNodeId.get(proxy.id)));
    assert.equal(proxy.physicalArmIds.some((armId) => (
      armId === `${proxy.id}:authored-through:0`
    )), false);
  }
});

test('collapsed supplement paths require the complete shared-junction threshold contract', () => {
  const malformedFixture = sharedJunctionThresholdFixture();
  const malformedSegment = malformedFixture.overlayPlan.segments.find(({ id }) => (
    id === malformedFixture.sharedSegmentId
  ));
  malformedSegment.sharedEndpointFootprint.size.x = 5.6;
  const malformedResult = materializeIndustrialOverlay({
    rooms: malformedFixture.rooms,
    connectionPlans: malformedFixture.connectionPlans,
    overlayPlan: malformedFixture.overlayPlan,
    extensionRegions: malformedFixture.extensionRegions,
    tileSize: TILE_SIZE,
  });
  assert.equal(malformedResult.diagnostics.accepted, false);
  assert.equal(
    malformedResult.connectionPlans.some(({ id }) => id === malformedFixture.sharedSegmentId),
    false,
  );
  assert.match(malformedResult.diagnostics.errors.join(' | '), /invalid shared-junction threshold/i);

  const untaggedFixture = sharedJunctionThresholdFixture();
  const untaggedSegment = untaggedFixture.overlayPlan.segments.find(({ id }) => (
    id === untaggedFixture.sharedSegmentId
  ));
  delete untaggedSegment.sharedEndpointFootprint;
  delete untaggedSegment.kind;
  const untaggedResult = materializeIndustrialOverlay({
    rooms: untaggedFixture.rooms,
    connectionPlans: untaggedFixture.connectionPlans,
    overlayPlan: untaggedFixture.overlayPlan,
    extensionRegions: untaggedFixture.extensionRegions,
    tileSize: TILE_SIZE,
  });
  assert.equal(untaggedResult.diagnostics.accepted, false);
  assert.equal(
    untaggedResult.connectionPlans.some(({ id }) => id === untaggedFixture.sharedSegmentId),
    false,
  );
  assert.match(
    untaggedResult.diagnostics.errors.join(' | '),
    /collapses to a shared threshold without an exact shared-junction contract/i,
  );
});

test('legacy compact connector modules remain non-room proxies for replay compatibility', () => {
  for (const specification of [
    {
      kind: 'supplementConnectorModule',
      armRoomIds: ['room-a', 'room-b'],
      meaningful: false,
      junctionKind: 'through-t',
    },
    {
      kind: 'supplementConnectorJunction',
      armRoomIds: ['room-a', 'room-b', 'room-c'],
      meaningful: true,
      junctionKind: 'crossroads',
    },
  ]) {
    const operationId = `supplement:test:${specification.kind}:operation`;
    const proxyId = `${operationId}:connector`;
    const roomCenters = [
      { x: -28, y: 0, z: 0 },
      { x: 28, y: 0, z: 0 },
      { x: 0, y: 0, z: 28 },
    ];
    const rooms = specification.armRoomIds.map((id, index) => supplementNode({
      id,
      operationId,
      center: roomCenters[index],
      size: { x: 8.4, y: 5.6, z: 8.4 },
    }));
    const segments = rooms.map((room, index) => {
      const segmentId = `${operationId}:segment:${index}`;
      const roomPosition = room.placement.center;
      return {
        id: segmentId,
        operationId,
        connectorFamily: 'service-gallery',
        from: {
          nodeId: room.id,
          socketId: `${room.id}:exit`,
          position: roomPosition,
        },
        to: {
          nodeId: proxyId,
          socketId: `${proxyId}:arm:${index}`,
          position: { x: 0, y: 0, z: 0 },
        },
        path: [roomPosition, { x: 0, y: 0, z: 0 }],
      };
    });
    const connectorNode = {
      id: proxyId,
      operationId,
      kind: specification.kind,
      grammarId: `test-${specification.kind}`,
      placement: { center: { x: 0, y: 0, z: 0 }, rotationQuarterTurns: 0 },
      size: { x: 8.4, y: 5.6, z: 8.4 },
      sockets: segments.map((segment, index) => ({
        id: segment.to.socketId,
        nodeId: proxyId,
        position: { x: 0, y: 0, z: 0 },
        state: 'connected',
        segmentId: segment.id,
      })),
      anchors: [
        { id: `${proxyId}:encounter`, kind: 'encounter', position: { x: 0, y: 0, z: 0 } },
        { id: `${proxyId}:reward`, kind: 'reward', position: { x: 0, y: 0, z: 0 } },
      ],
      junction: {
        id: `${proxyId}:junction`,
        junctionKind: specification.junctionKind,
        activeSocketIds: segments.map((segment) => segment.to.socketId),
        countsAsMeaningfulStation: specification.meaningful,
      },
      countsAsMeaningfulStation: specification.meaningful,
    };
    const result = materializeIndustrialOverlay({
      overlayPlan: {
        operations: [{
          id: operationId,
          type: 'optionalBranch',
          nodeIds: [...rooms.map(({ id }) => id), proxyId],
          segmentIds: segments.map(({ id }) => id),
        }],
        nodes: [...rooms, connectorNode],
        segments,
      },
      tileSize: TILE_SIZE,
    });

    assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
    assert.deepEqual(result.supplementalRoomIds.sort(), specification.armRoomIds.sort());
    assert.equal(result.rooms.some(({ id }) => id === proxyId), false);
    assert.deepEqual(result.supplementalConnectorJunctionIds, [proxyId]);
    const proxy = result.connectorJunctionProxies.find(({ id }) => id === proxyId);
    assert.ok(proxy);
    assert.equal(proxy.kind, specification.kind);
    assert.equal(proxy.isDungeonSupplement, false);
    assert.equal(proxy.isConnectorJunctionProxy, true);
    assert.equal(proxy.suppressRoomGeometry, true);
    assert.equal(proxy.countsAsMeaningfulStation, specification.meaningful);
    assert.equal(proxy.minimumPhysicalArmCount, specification.armRoomIds.length);
    assert.equal(proxy.physicalArmCount, specification.armRoomIds.length);
    assert.equal(proxy.exitSockets.length, specification.armRoomIds.length);
    assert.equal(proxy.connectorJunctionSockets.length, specification.armRoomIds.length);
    assert.equal(proxy.augmentationAnchors.some(({ kind }) => (
      ['encounter', 'reward', 'progression'].includes(kind)
    )), false);
    const physicalPlans = result.connectionPlans.filter(({ augmentationOperationId }) => (
      augmentationOperationId === operationId
    ));
    assert.equal(physicalPlans.length, specification.armRoomIds.length);
    assert.equal(physicalPlans.every((plan) => (
      plan.toRoomId === proxyId
        && plan.progressionFromRoomId !== proxyId
        && plan.progressionToRoomId !== proxyId
        && plan.progressionFromRoomId !== plan.progressionToRoomId
        && plan.progressionCollapsedSelfEdge === false
        && plan.toSocket.connectorJunctionProxyId === proxyId
        && plan.toSocket.progressionRoomId === plan.progressionToRoomId
    )), true);
  }
});

test('junction and bounded landing geometry expose stable validation records', () => {
  const junction = createDungeonJunctionGeometryRecord({
    id: 'fixture-cross',
    nodeId: 'fixture-node',
    junctionKind: 'staggeredCross',
    center: { x: 12, y: 2, z: -4 },
    activeSocketIds: ['north', 'south', 'east', 'west'],
    tileSize: TILE_SIZE,
  });
  assert.equal(junction.junctionKind, 'staggered-cross');
  assert.equal(junction.widthTiles, 5);
  assert.equal(junction.depthTiles, 13);
  assert.equal(junction.lateralSeparationTiles, 6);
  assert.equal(junction.countsAsMeaningfulStation, true);

  const landing = createDungeonSocketLandingOverlapVolume({
    id: 'doorway-east',
    position: { x: 10, y: 0, z: 20 },
    facing: { x: 1, y: 0, z: 0 },
  }, { tileSize: TILE_SIZE });
  assert.equal(landing.size.x, 5.6);
  assert.ok(Math.abs(landing.size.z - 8.4) < 1e-9);
  assert.equal(dungeonVolumeOverlapWithinGrant(
    { center: { x: 9, y: 1, z: 20 }, size: { x: 4, y: 2, z: 2 } },
    { center: { x: 11, y: 1, z: 20 }, size: { x: 4, y: 2, z: 2 } },
    landing,
  ), true);
});

test('rotated curated rooms retain accepted structural-quality records', () => {
  const materialize = (rotationQuarterTurns, center) => {
    const manifest = INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS.challenge;
    const grammar = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
      manifest.compatibleGrammarIds[0]
    ];
    const operationId = `structural-quality:operation:${rotationQuarterTurns}`;
    const nodeId = `structural-quality:room:${rotationQuarterTurns}`;
    const grantId = `structural-quality:grant:${rotationQuarterTurns}`;
    const themeBinding = {
      themeId: 'industrial-v1',
      themeRevision: 'industrial-v1-presentation-r1',
    };
    const stableRuntimeStateIds = Object.fromEntries([
      'encounter',
      'mechanism',
      'reward',
      'shortcut',
    ].map((kind) => [kind, `${operationId}:state:${kind}`]));
    const segmentIds = {
      entry: `${operationId}:segment:entry`,
      exit: `${operationId}:segment:exit`,
    };
    const sockets = grammar.sockets.map((socket) => {
      const position = transformDungeonLocalPoint(socket.localPosition, {
        center,
        rotationQuarterTurns,
      });
      const facing = transformDungeonLocalPoint(socket.localFacing, {
        center: { x: 0, y: 0, z: 0 },
        rotationQuarterTurns,
      });
      return {
        ...structuredClone(socket),
        id: `${nodeId}:socket:${socket.id}`,
        localSocketId: socket.id,
        nodeId,
        position,
        worldPosition: { ...position },
        facing,
        state: 'connected',
        segmentId: segmentIds[socket.id],
      };
    });
    const parentEndpoints = sockets.map((socket) => {
      const parentId = `structural-quality:parent:${socket.localSocketId}:${rotationQuarterTurns}`;
      return {
        id: `${parentId}:socket`,
        nodeId: parentId,
        roomId: parentId,
        socketId: `${parentId}:socket`,
        position: {
          x: socket.position.x + socket.facing.x * TILE_SIZE * 3,
          y: socket.position.y,
          z: socket.position.z + socket.facing.z * TILE_SIZE * 3,
        },
        facing: {
          x: -socket.facing.x,
          y: 0,
          z: -socket.facing.z,
        },
        widthMeters: socket.widthMeters,
        heightMeters: socket.heightMeters,
        state: 'open',
      };
    });
    const parentRooms = parentEndpoints.map((endpoint) => ({
      id: endpoint.roomId,
      x: Math.round(endpoint.position.x / TILE_SIZE),
      z: Math.round(endpoint.position.z / TILE_SIZE),
      width: 3,
      depth: 3,
      baseElevation: endpoint.position.y,
      plannedBaseElevation: endpoint.position.y,
      exitSockets: [],
    }));
    const segments = sockets.map((socket, index) => ({
      id: segmentIds[socket.localSocketId],
      operationId,
      connectorFamily: 'service-gallery',
      from: {
        ...parentEndpoints[index],
        kind: 'parentSocket',
      },
      to: {
        ...socket,
        kind: 'supplementSocket',
      },
      path: [parentEndpoints[index].position, socket.position],
    }));
    const operation = {
      id: operationId,
      type: 'routeNetwork',
      grantId,
      nodeIds: [nodeId],
      segmentIds: segments.map(({ id }) => id),
      endpointSocketIds: parentEndpoints.map(({ id }) => id),
      topologyTemplateId: 'split-level-ring',
      routeNetworkKind: 'objective-route-coverage',
      accessDomainId: 'structural-quality-domain',
      progressionBandId: 1,
      themeBinding,
      stableRuntimeStateIds,
    };
    const result = materializeIndustrialOverlay({
      rooms: parentRooms,
      overlayPlan: {
        profileId: 'industrial-supplement-preview-v4',
        difficulty: 2,
        operations: [operation],
        nodes: [{
          id: nodeId,
          operationId,
          kind: 'supplementRoom',
          grammarId: grammar.id,
          grammarRevision: grammar.revision,
          moduleKind: 'room',
          contentRole: 'challenge',
          topologyTemplateId: operation.topologyTemplateId,
          placement: { center, rotationQuarterTurns },
          size: structuredClone(grammar.size),
          sockets,
          anchors: [],
          structure: structuredClone(grammar.structure),
          occupiedVolumes: structuredClone(grammar.occupiedVolumes),
          clearanceVolumes: structuredClone(grammar.clearanceVolumes),
          themeBinding,
          stableRuntimeStateIds,
        }],
        segments,
      },
      extensionRegions: [{
        id: 'structural-quality-region',
        routeNetworkGrants: [{
          id: grantId,
          routeNetworkKind: operation.routeNetworkKind,
          endpointSockets: parentEndpoints,
          accessDomainId: operation.accessDomainId,
          progressionBandId: operation.progressionBandId,
        }],
      }],
      tileSize: TILE_SIZE,
    });
    assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
    const room = result.rooms.find(({ id }) => id === nodeId);
    assert.ok(room);
    return room;
  };

  const unrotated = materialize(0, { x: 0, y: 0, z: 0 });
  const rotated = materialize(1, { x: 84, y: 5.6, z: -56 });
  for (const room of [unrotated, rotated]) {
    assert.equal(room.augmentationStructuralQualityReport.accepted, true);
    const report = inspectIndustrialSupplementRealizedStructuralQuality(room);
    assert.equal(report.accepted, true, report.errors.join(', '));
    assert.deepEqual(
      report.metrics.accessibleExitSocketIds,
      report.metrics.requiredExitSocketIds,
    );
    assert.ok(report.metrics.sightlines.every(({ accepted }) => accepted));
    assert.equal(
      room.augmentationProtectedSightlines.length,
      room.augmentationModuleManifest.structuralQuality.requiredSightlines.length,
    );
    assert.ok(room.augmentationProtectedSightlines.every((sightline) => (
      sightline.authoritative === true
        && sightline.protectionKind === 'required-sightline'
        && sightline.protectedOriginCount >= sightline.minimumVisibleOrigins
        && sightline.worldCells.length > 0
    )));
    const protectedSightline = room.augmentationProtectedSightlines[0];
    const protectedCell = protectedSightline.worldCells[0];
    const inspection = inspectIndustrialSupplementStoryPresentationLegality({
      room,
      record: {
        id: 'structural-quality-story-probe',
        operationId: room.augmentationOperationId,
        collisionRecordIds: [],
        transform: { position: protectedCell.position },
        worldFootprint: { widthMeters: 0.25, depthMeters: 0.25 },
      },
      tileSize: TILE_SIZE,
    });
    assert.equal(inspection.legal, false);
    assert.ok(inspection.reasons.includes(
      `protected-sightline:${protectedSightline.sightlineId}`,
    ));
    const tierCells = new Set(room.augmentationFloorTiers.flatMap((tier) => (
      tier.worldCells.map((cell) => (
        `${cell.localTile.x},${cell.localTile.z}@${cell.localTile.elevation}`
      ))
    )));
    assert.ok(room.augmentationZones.every((zone) => zone.worldCells.every((cell) => (
      tierCells.has(`${cell.localTile.x},${cell.localTile.z}@${cell.localTile.elevation}`)
    ))));
    const physicalCoverRecords = room.augmentationCollisionRecords.filter((record) => (
      record.sourceKind === 'cover'
    ));
    assert.equal(physicalCoverRecords.length, room.augmentationCover.length);
    assert.ok(physicalCoverRecords.every((record) => (
      record.blocking === true
      && Number(record.size?.x) > 0
      && Number(record.size?.y) > 0
      && Number(record.size?.z) > 0
    )));
  }
  assert.deepEqual(
    rotated.augmentationStructuralQualityReport.metrics.zoneFloorCoverage,
    unrotated.augmentationStructuralQualityReport.metrics.zoneFloorCoverage,
  );
  assert.deepEqual(
    rotated.augmentationStructuralQualityReport.metrics.sightlines,
    unrotated.augmentationStructuralQualityReport.metrics.sightlines,
  );
  assert.notDeepEqual(
    rotated.augmentationCover.map(({ position }) => position),
    unrotated.augmentationCover.map(({ position }) => position),
  );
});
