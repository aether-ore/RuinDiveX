import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addAuthoredRoomFloor,
  DungeonGenerator,
  stampDungeonSupplementConnectorJunctionCores,
} from '../src/DungeonGenerator.js';
import { createDungeonRouteEndpointSeam } from '../src/dungeon-augmentation/geometry.js';
import { createRouteNetworkConflictEntitySignature } from '../src/dungeon-augmentation/index.js';

const TILE_SIZE = 2.8;

function exactSocket({
  id,
  roomId,
  progressionRoomId = null,
  parentRouteId = null,
  routeNetworkSocketKind = null,
  x,
  z,
  facingX,
  facingZ,
}) {
  return {
    id,
    roomId,
    ...(progressionRoomId == null ? {} : { progressionRoomId }),
    ...(parentRouteId == null ? {} : { parentRouteId }),
    ...(routeNetworkSocketKind == null ? {} : { routeNetworkSocketKind }),
    x,
    z,
    elevation: 0,
    facingX,
    facingZ,
    position: { x: x * TILE_SIZE, y: 0, z: z * TILE_SIZE },
    facing: { x: facingX, y: 0, z: facingZ },
  };
}

function endpointSeam(segmentId, operationId, socket, role, parentOwnerId = null) {
  return createDungeonRouteEndpointSeam(socket, {
    id: `${segmentId}:${role}-endpoint-seam`,
    segmentId,
    operationId,
    networkId: operationId,
    nodeId: socket.progressionRoomId ?? socket.roomId,
    socketId: socket.id,
    role,
    tileSize: TILE_SIZE,
    parentOwnerId,
  });
}

function routePlan({ id, operationId, fromSocket, toSocket, path, endpointSeams }) {
  return {
    id,
    isDungeonSupplement: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: operationId,
    routeNetworkGrantId: `${operationId}:grant`,
    fromRoomId: fromSocket.roomId,
    toRoomId: toSocket.roomId,
    fromSocket,
    toSocket,
    bridgePath: path.map((point) => ({ ...point })),
    fullPath: path.map((point) => ({ ...point })),
    endpointSeams,
  };
}

function supportFloor(cell, { roomId = null, connectorOwnerId = null } = {}) {
  return {
    x: cell.gridX,
    z: cell.gridZ,
    elevation: Number(cell.position?.y ?? 0),
    level: 0,
    type: 'floor',
    surface: connectorOwnerId ? 'connectorGalleryFloor' : 'floor',
    ...(roomId == null ? {} : { roomId }),
    ...(connectorOwnerId == null ? {} : {
      signedConnectorFloorOwnerId: connectorOwnerId,
    }),
  };
}

function addInteriorSupport(floors, seam, ownership) {
  floors.push(...seam.orderedCells
    .filter(({ signedDepthTiles }) => signedDepthTiles < 0)
    .map((cell) => supportFloor(cell, ownership)));
}

function corridorStationFixture() {
  const operationId = 'supplement:test:route-network:0';
  const segmentId = `${operationId}:segment:0`;
  const parentRouteId = 'authored-a_authored-b_ground';
  const fromSocket = exactSocket({
    id: 'industrial:test:station:north',
    roomId: 'supplement:test:connector-junction-proxy',
    progressionRoomId: 'authored-b',
    parentRouteId,
    routeNetworkSocketKind: 'authored-corridor-station',
    x: 0,
    z: 0,
    facingX: 0,
    facingZ: -1,
  });
  const toSocket = exactSocket({
    id: 'supplement:test:node:challenge:entry',
    roomId: 'supplement:test:node:challenge',
    x: 0,
    z: -8,
    facingX: 0,
    facingZ: 1,
  });
  const fromSeam = endpointSeam(
    segmentId,
    operationId,
    fromSocket,
    'from',
    parentRouteId,
  );
  const toSeam = endpointSeam(segmentId, operationId, toSocket, 'to');
  const path = Array.from({ length: 9 }, (_, index) => ({ x: 0, z: -index }));
  const plan = routePlan({
    id: segmentId,
    operationId,
    fromSocket,
    toSocket,
    path,
    endpointSeams: [fromSeam, toSeam],
  });
  const floorTiles = [];
  addInteriorSupport(floorTiles, fromSeam, { connectorOwnerId: parentRouteId });
  addInteriorSupport(floorTiles, toSeam, { roomId: toSocket.roomId });
  const unrelatedParentFloor = {
    x: 99,
    z: 99,
    elevation: 0,
    level: 0,
    type: 'hallway',
    surface: 'connectorGalleryFloor',
    signedConnectorFloorOwnerId: parentRouteId,
  };
  floorTiles.push(unrelatedParentFloor);
  return { plan, floorTiles, fromSeam, toSeam, parentRouteId, unrelatedParentFloor };
}

function exactSegmentOverlayFixture(plan) {
  const operation = {
    id: plan.augmentationOperationId,
    type: 'routeNetwork',
    grantId: plan.routeNetworkGrantId,
    routeNetworkKind: 'objective-route-coverage',
  };
  const segment = {
    id: plan.id,
    operationId: operation.id,
    kind: 'route-network-segment',
    routeRole: 'objective-route-coverage:spine',
    connectorFamily: 'service-gallery',
    from: {
      nodeId: plan.fromRoomId,
      socketId: plan.fromSocket.id,
      position: { ...plan.fromSocket.position },
    },
    to: {
      nodeId: plan.toRoomId,
      socketId: plan.toSocket.id,
      position: { ...plan.toSocket.position },
    },
    path: plan.bridgePath.map(({ x, z }) => ({
      x: x * TILE_SIZE,
      y: 0,
      z: z * TILE_SIZE,
    })),
  };
  return {
    operation,
    segment,
    overlayPlan: {
      augmentationPlanHash: 'augmentation:exact-endpoint-failure',
      effectivePlanHash: 'effective:exact-endpoint-failure',
      operations: [operation],
      nodes: [],
      segments: [segment],
    },
  };
}

test('generator realizes a corridor-station seam against its authored parent owner', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const fixture = corridorStationFixture();

  const result = generator._realizeAuthoritativeSupplementSocketSeams(
    new Map(),
    fixture.floorTiles,
    [fixture.plan],
  );

  assert.equal(result.seamCount, 2);
  assert.equal(result.cellWitnessCount, 30);
  assert.equal(fixture.plan.authoritativeSocketSeams[0].roomId, 'authored-b');
  assert.equal(
    fixture.plan.authoritativeSocketSeams[0].overlapEnvelope.parentOwnerId,
    fixture.parentRouteId,
  );
  const sharedParentApproaches = result.floorTiles.filter((floor) => (
    floor.signedConnectorFloorOwnerId === fixture.parentRouteId
      && floor.authoritativeSocketSeamIds?.includes(fixture.fromSeam.id)
  ));
  assert.equal(sharedParentApproaches.length, 6);
  assert.equal(sharedParentApproaches.every((floor) => (
    floor.sharedConnectorFloorOwnerIds?.includes(fixture.plan.id)
  )), true);
  assert.equal(fixture.unrelatedParentFloor.authoritativeSocketSeamIds, undefined);
  assert.equal(fixture.unrelatedParentFloor.sharedConnectorFloorOwnerIds, undefined);
});

test('missing endpoint-seam interior support attributes only the exact route segment', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const fixture = corridorStationFixture();
  const missingCell = fixture.fromSeam.orderedCells.find(({ signedDepthTiles }) => (
    signedDepthTiles < 0
  ));
  fixture.floorTiles = fixture.floorTiles.filter((floor) => !(
    floor.x === missingCell.gridX
      && floor.z === missingCell.gridZ
      && Math.abs(Number(floor.elevation ?? 0) - Number(missingCell.position.y ?? 0)) <= 0.05
  ));
  const { operation, segment, overlayPlan } = exactSegmentOverlayFixture(fixture.plan);

  let caught = null;
  try {
    generator._realizeAuthoritativeSupplementSocketSeams(
      new Map(),
      fixture.floorTiles,
      [fixture.plan],
      overlayPlan,
    );
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.code, 'DUNGEON_AUGMENTATION_SOCKET_SEAM_INTERIOR_SUPPORT_MISSING');
  assert.deepEqual(caught.augmentationDiagnostics?.failedRouteNetworkGrants, [{
    grantId: operation.grantId,
    augmentationOperationId: operation.id,
    routeNetworkKind: operation.routeNetworkKind,
    connectionIds: [segment.id],
    roomIds: [],
    socketIds: [],
    failureKinds: ['DUNGEON_AUGMENTATION_SOCKET_SEAM_INTERIOR_SUPPORT_MISSING'],
  }]);
  assert.deepEqual(caught.augmentationDiagnostics?.routeNetworkConflictExclusions, [{
    grantId: operation.grantId,
    entityKind: 'segment',
    entityId: segment.id,
    signature: createRouteNetworkConflictEntitySignature(segment, 'segment'),
    reason: 'route-network-socket-seam-interior-support-missing',
  }]);
  assert.equal(
    Object.hasOwn(caught.augmentationDiagnostics, 'routeNetworkPruningOverrides'),
    false,
  );
});

test('generator rejects a foreign physical owner even inside an exact corridor-station seam', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const fixture = corridorStationFixture();
  fixture.floorTiles[0].signedConnectorFloorOwnerId = 'foreign-authored-route';

  assert.throws(
    () => generator._realizeAuthoritativeSupplementSocketSeams(
      new Map(),
      fixture.floorTiles,
      [fixture.plan],
    ),
    (error) => error?.code === 'DUNGEON_AUGMENTATION_ENDPOINT_OVERLAP_OUTSIDE_SEAM',
  );
});

test('foreign endpoint-seam ownership attributes only the exact route segment for replay exclusion', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const fixture = corridorStationFixture();
  fixture.floorTiles[0].signedConnectorFloorOwnerId = 'foreign-authored-route';
  const operation = {
    id: fixture.plan.augmentationOperationId,
    type: 'routeNetwork',
    grantId: fixture.plan.routeNetworkGrantId,
    routeNetworkKind: 'objective-route-coverage',
  };
  const segment = {
    id: fixture.plan.id,
    operationId: operation.id,
    kind: 'route-network-segment',
    routeRole: 'objective-route-coverage:spine',
    connectorFamily: 'service-gallery',
    from: {
      nodeId: fixture.plan.fromRoomId,
      socketId: fixture.plan.fromSocket.id,
      position: { ...fixture.plan.fromSocket.position },
    },
    to: {
      nodeId: fixture.plan.toRoomId,
      socketId: fixture.plan.toSocket.id,
      position: { ...fixture.plan.toSocket.position },
    },
    path: fixture.plan.bridgePath.map(({ x, z }) => ({
      x: x * TILE_SIZE,
      y: 0,
      z: z * TILE_SIZE,
    })),
  };
  const overlayPlan = {
    augmentationPlanHash: 'augmentation:exact-endpoint-overlap',
    effectivePlanHash: 'effective:exact-endpoint-overlap',
    operations: [operation],
    nodes: [],
    segments: [segment],
  };

  let caught = null;
  try {
    generator._realizeAuthoritativeSupplementSocketSeams(
      new Map(),
      fixture.floorTiles,
      [fixture.plan],
      overlayPlan,
    );
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.code, 'DUNGEON_AUGMENTATION_ENDPOINT_OVERLAP_OUTSIDE_SEAM');
  assert.deepEqual(caught.augmentationDiagnostics?.failedRouteNetworkGrants, [{
    grantId: operation.grantId,
    augmentationOperationId: operation.id,
    routeNetworkKind: operation.routeNetworkKind,
    connectionIds: [segment.id],
    roomIds: [],
    socketIds: [],
    failureKinds: ['DUNGEON_AUGMENTATION_ENDPOINT_OVERLAP_OUTSIDE_SEAM'],
  }]);
  assert.deepEqual(caught.augmentationDiagnostics?.routeNetworkConflictExclusions, [{
    grantId: operation.grantId,
    entityKind: 'segment',
    entityId: segment.id,
    signature: createRouteNetworkConflictEntitySignature(segment, 'segment'),
    reason: 'route-network-endpoint-overlap-outside-seam',
  }]);
  assert.equal(
    Object.hasOwn(caught.augmentationDiagnostics, 'routeNetworkPruningOverrides'),
    false,
  );
});

test('generator preserves source identities when a gated segment is materialized in reverse', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const operationId = 'supplement:test:source-reversal';
  const segmentId = `${operationId}:segment:0`;
  const originalFrom = exactSocket({
    id: 'supplement:test:source-reversal:a',
    roomId: 'supplement:test:node:a',
    x: 0,
    z: 0,
    facingX: 1,
    facingZ: 0,
  });
  const originalTo = exactSocket({
    id: 'supplement:test:source-reversal:b',
    roomId: 'supplement:test:node:b',
    x: 8,
    z: 0,
    facingX: -1,
    facingZ: 0,
  });
  const originalFromSeam = endpointSeam(
    segmentId,
    operationId,
    originalFrom,
    'from',
  );
  const originalToSeam = endpointSeam(segmentId, operationId, originalTo, 'to');
  const reversedFromSeam = {
    ...structuredClone(originalToSeam),
    role: 'from',
    sourceRole: 'to',
    materializedRole: 'from',
  };
  const reversedToSeam = {
    ...structuredClone(originalFromSeam),
    role: 'to',
    sourceRole: 'from',
    materializedRole: 'to',
  };
  const reversedPath = Array.from({ length: 9 }, (_, index) => ({ x: 8 - index, z: 0 }));
  const plan = routePlan({
    id: segmentId,
    operationId,
    fromSocket: originalTo,
    toSocket: originalFrom,
    path: reversedPath,
    endpointSeams: [reversedFromSeam, reversedToSeam],
  });
  const floorTiles = [];
  addInteriorSupport(floorTiles, reversedFromSeam, { roomId: originalTo.roomId });
  addInteriorSupport(floorTiles, reversedToSeam, { roomId: originalFrom.roomId });

  const result = generator._realizeAuthoritativeSupplementSocketSeams(
    new Map(),
    floorTiles,
    [plan],
  );

  assert.equal(result.seamCount, 2);
  assert.deepEqual(
    plan.authoritativeSocketSeams.map(({ role, sourceRole, socketId }) => ({
      role,
      sourceRole,
      socketId,
    })),
    [
      { role: 'from', sourceRole: 'to', socketId: originalTo.id },
      { role: 'to', sourceRole: 'from', socketId: originalFrom.id },
    ],
  );
});

test('legacy supplement records remain outside V4 seam realization', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const legacyFloor = {
    x: 0,
    z: 0,
    elevation: 0,
    level: 0,
    type: 'floor',
    roomId: 'legacy-room',
  };
  const legacyPlan = {
    id: 'legacy-v3-segment',
    isDungeonSupplement: true,
    augmentationOperationType: 'legacyOverlay',
    augmentationProfileRevision: 3,
  };

  const result = generator._realizeAuthoritativeSupplementSocketSeams(
    new Map(),
    [legacyFloor],
    [legacyPlan],
  );

  assert.equal(result.physicalPlanCount, 0);
  assert.equal(result.seamCount, 0);
  assert.deepEqual(result.floorTiles, [legacyFloor]);
  assert.equal(legacyPlan.authoritativeSocketSeams, undefined);
});

test('elevated connector-junction base tiers stay outside the single-layer structural map', () => {
  const junctionId = 'supplement:test:elevated-junction';
  const tiles = new Map();
  const elevatedFloors = stampDungeonSupplementConnectorJunctionCores(
    tiles,
    [{
      id: junctionId,
      stampConnectorJunctionFloor: true,
      baseElevation: -14,
      plannedBaseElevation: -14,
      augmentationFloorTiers: [{
        id: 'base',
        localTierId: 'base',
        authoritative: true,
        localElevation: 0,
        worldElevation: -14,
        worldCells: [{
          id: `${junctionId}:floor-tier:base:cell:0:0`,
          grid: { x: 0, z: 118 },
          elevation: -14,
        }],
      }],
    }],
    [
      { id: 'supplement:test:arm:a', isDungeonSupplement: true, fromRoomId: junctionId },
      { id: 'supplement:test:arm:b', isDungeonSupplement: true, toRoomId: junctionId },
    ],
  );

  assert.equal(tiles.has('0,118'), false);
  assert.equal(elevatedFloors.length, 1);
  assert.equal(elevatedFloors[0].elevation, -14);
  assert.equal(elevatedFloors[0].connectorJunctionOwnerId, junctionId);
  assert.equal(
    elevatedFloors[0].augmentationFloorCellId,
    `${junctionId}:floor-tier:base:cell:0:0`,
  );

  const authoredProgressionTile = {
    x: 0,
    z: 118,
    type: 'hallway',
    surface: 'industrialRamp',
    elevation: 2.8,
    level: 1,
    connectionId: 'authored-route',
  };
  tiles.set('0,118', authoredProgressionTile);
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  generator._clearProgressionAccessObstructions(tiles, [], new Set(['0,118']));

  assert.equal(authoredProgressionTile.elevation, 0);
  assert.equal(elevatedFloors[0].elevation, -14);
  assert.notEqual(elevatedFloors[0], tiles.get('0,118'));
});

test('elevated supplement-room base tiers stay outside the empty structural-map layer', () => {
  const roomId = 'supplement:test:elevated-room';
  const tiles = new Map();
  const elevatedFloors = [];

  addAuthoredRoomFloor(tiles, {
    id: roomId,
    isDungeonSupplement: true,
    baseElevation: -14,
    plannedBaseElevation: -14,
    tileType: 'floor',
    augmentationOperationId: 'supplement:test:operation',
    augmentationBlueprintId: 'ind-room-dispatch-vault-01',
    augmentationFloorTiers: [{
      id: `${roomId}:floor-tier:base`,
      localTierId: 'base',
      authoritative: true,
      localElevation: 0,
      worldElevation: -14,
      worldCells: [{
        id: `${roomId}:floor-tier:base:cell:1:2`,
        grid: { x: 44, z: 27 },
        elevation: -14,
      }],
    }],
  }, elevatedFloors);

  assert.equal(tiles.has('44,27'), false);
  assert.equal(elevatedFloors.length, 1);
  assert.equal(elevatedFloors[0].roomId, roomId);
  assert.equal(elevatedFloors[0].elevation, -14);

  const authoredProgressionTile = {
    x: 44,
    z: 27,
    type: 'hallway',
    surface: 'industrialRamp',
    elevation: 2.8,
    level: 1,
    connectionId: 'authored-route',
  };
  tiles.set('44,27', authoredProgressionTile);
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  generator._clearProgressionAccessObstructions(tiles, [], new Set(['44,27']));

  assert.equal(authoredProgressionTile.elevation, 0);
  assert.equal(elevatedFloors[0].elevation, -14);
  assert.notEqual(elevatedFloors[0], tiles.get('44,27'));
});

test('floor canonicalization preserves every intersecting seam and shared owner identity', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const first = {
    x: 4,
    z: 5,
    elevation: 2.8,
    surface: 'connectorGalleryFloor',
    signedConnectorFloorOwnerId: 'segment-a',
    authoritativeSocketSeamIds: ['seam-a'],
    authoritativeSocketSeamCellIds: ['seam-a:cell:0:0'],
    authoritativeSocketSeamOwnerIds: ['segment-a'],
    authoritativeSocketSeamNodeIds: ['node-a'],
  };
  const second = {
    x: 4,
    z: 5,
    elevation: 2.8,
    surface: 'industrialRamp',
    signedConnectorFloorOwnerId: 'segment-b',
    authoritativeSocketSeamIds: ['seam-b'],
    authoritativeSocketSeamCellIds: ['seam-b:cell:0:0'],
    authoritativeSocketSeamOwnerIds: ['segment-b'],
    authoritativeSocketSeamNodeIds: ['node-b'],
    augmentationTransferIds: ['transfer-b'],
  };

  const result = generator._canonicalizeAbsoluteFloorTiles([first, second], {
    trackOwnerProvenance: true,
    strictAuthoritativeSeamOwnership: true,
  });

  assert.equal(result.floorTiles.length, 1);
  const [floor] = result.floorTiles;
  assert.equal(floor.surface, 'industrialRamp');
  assert.deepEqual(floor.authoritativeSocketSeamIds, ['seam-a', 'seam-b']);
  assert.deepEqual(floor.authoritativeSocketSeamCellIds, [
    'seam-a:cell:0:0',
    'seam-b:cell:0:0',
  ]);
  assert.deepEqual(floor.authoritativeSocketSeamOwnerIds, ['segment-a', 'segment-b']);
  assert.deepEqual(floor.authoritativeSocketSeamNodeIds, ['node-a', 'node-b']);
  assert.ok(floor.sharedConnectorFloorOwnerIds.includes('segment-a'));
  assert.deepEqual(floor.augmentationTransferIds, ['transfer-b']);
});

test('strict V4 floor canonicalization rejects unadvertised scalar-owner overlap', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  assert.throws(
    () => generator._canonicalizeAbsoluteFloorTiles([
      {
        x: 1,
        z: 2,
        elevation: 0,
        surface: 'connectorGalleryFloor',
        signedConnectorFloorOwnerId: 'unrelated-a',
      },
      {
        x: 1,
        z: 2,
        elevation: 0,
        surface: 'industrialRamp',
        signedConnectorFloorOwnerId: 'unrelated-b',
      },
    ], {
      trackOwnerProvenance: true,
      strictAuthoritativeSeamOwnership: true,
    }),
    (error) => error?.code === 'DUNGEON_AUGMENTATION_CANONICAL_FLOOR_IDENTITY_CONFLICT',
  );
});

test('disconnected authoritative seam cells survive pruning for hard validation', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const entranceFloor = {
    x: 0,
    z: 0,
    elevation: 0,
    roomId: 'entrance',
    surface: 'floor',
  };
  const genericOrphan = {
    x: 20,
    z: 20,
    elevation: 0,
    connectionId: 'generic-orphan',
    surface: 'connectorGalleryFloor',
  };
  const seamOrphan = {
    x: 24,
    z: 20,
    elevation: 0,
    connectionId: 'v4-segment',
    signedConnectorFloorOwnerId: 'v4-segment',
    surface: 'connectorGalleryFloor',
    authoritativeSocketSeamIds: ['v4-segment:from-endpoint-seam'],
    authoritativeSocketSeamCellIds: ['v4-segment:from-endpoint-seam:cell:2:0'],
    authoritativeSocketSeamOwnerIds: ['v4-segment'],
  };
  const floors = [entranceFloor, genericOrphan, seamOrphan];
  const tiles = new Map(floors.map((floor) => [`${floor.x},${floor.z}`, floor]));

  const result = generator._pruneDisconnectedConnectorGalleryFloors(
    tiles,
    floors,
    [{ id: 'entrance', x: 0, z: 0 }],
  );

  assert.equal(result.floorTiles.includes(genericOrphan), false);
  assert.equal(result.floorTiles.includes(seamOrphan), true);
  assert.equal(result.diagnostics.removedFloorTileCount, 1);
  assert.equal(result.diagnostics.preservedAuthoritativeSeamFloorCount, 1);
  assert.deepEqual(
    result.diagnostics.preservedAuthoritativeSeamFloorKeys,
    ['24,20@y0.000'],
  );
});
