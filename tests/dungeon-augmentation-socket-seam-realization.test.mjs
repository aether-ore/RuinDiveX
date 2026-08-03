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
const V4_PROFILE_ID = 'industrial-supplement-preview-v4';

function planarConnectorPlan({
  id,
  elevation = 0,
  isDungeonSupplement = false,
  level = 0,
  localElevation = null,
  z = 0,
}) {
  const path = Array.from({ length: 5 }, (_, x) => ({ x, z }));
  return {
    id,
    level,
    ...(Number.isFinite(localElevation) ? { localElevation } : {}),
    elevation,
    sourceElevation: elevation,
    destinationElevation: elevation,
    elevationDelta: 0,
    direction: 'level',
    isDungeonSupplement,
    ...(isDungeonSupplement ? {
      augmentationOperationType: 'routeNetwork',
      augmentationOperationId: `${id}:operation`,
      routeNetworkGrantId: `${id}:grant`,
    } : {}),
    fromRoomId: `${id}:from-room`,
    toRoomId: `${id}:to-room`,
    fromSocket: {
      id: `${id}:from-socket`,
      roomId: `${id}:from-room`,
      x: 0,
      z,
      elevation,
      facingX: 1,
      facingZ: 0,
    },
    toSocket: {
      id: `${id}:to-socket`,
      roomId: `${id}:to-room`,
      x: path.length - 1,
      z,
      elevation,
      facingX: -1,
      facingZ: 0,
    },
    bridgePath: path.map((point) => ({ ...point })),
    fullPath: path.map((point) => ({ ...point })),
    connectorVariantConstraints: { roomFootprints: [] },
  };
}

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

test('V4 planar service-lane helpers retain exact source-plan provenance without changing V1', () => {
  const basePlan = planarConnectorPlan({
    id: 'authored:test:lower-plan',
    elevation: -14,
  });
  const supplementalPlan = planarConnectorPlan({
    id: 'supplement:test:planar-helper',
    isDungeonSupplement: true,
  });
  const v4Tiles = new Map();
  const v4Generator = new DungeonGenerator({
    tileSize: TILE_SIZE,
    random: () => 0.5,
    augmentationProfileId: V4_PROFILE_ID,
  });
  v4Generator._stampConnectionPlans(v4Tiles, [supplementalPlan]);

  v4Generator._addConnectorExplorationSpaces(
    v4Tiles,
    [],
    [basePlan, supplementalPlan],
  );

  const helper = v4Tiles.get('2,1');
  assert.ok(helper);
  assert.equal(helper.connectorId, supplementalPlan.id);
  assert.equal(helper.connectorZone, 'service_lane');
  assert.deepEqual(helper.connectorPlanarHelperProvenance, {
    schema: 'ruindivex-connector-planar-helper-provenance/v1',
    kind: 'planar-connector-helper',
    sourcePlanId: supplementalPlan.id,
    sourcePlanLevel: 0,
    gridX: 2,
    gridZ: 1,
    helperStampedLocalElevation: 0,
    intendedSourceWorldElevation: 0,
    intendedDestinationWorldElevation: 0,
    connectorZone: 'service_lane',
  });
  const centerHelper = v4Tiles.get('2,0');
  assert.equal(centerHelper.connectorId, supplementalPlan.id);
  assert.deepEqual(centerHelper.connectorPlanarHelperProvenance, {
    schema: 'ruindivex-connector-planar-helper-provenance/v1',
    kind: 'planar-connector-helper',
    sourcePlanId: supplementalPlan.id,
    sourcePlanLevel: 0,
    gridX: 2,
    gridZ: 0,
    helperStampedLocalElevation: 0,
    intendedSourceWorldElevation: 0,
    intendedDestinationWorldElevation: 0,
    connectorZone: 'main_gallery',
  });

  const legacyTiles = new Map();
  const legacyGenerator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  legacyGenerator._stampConnectionPlans(legacyTiles, [
    planarConnectorPlan({
      id: supplementalPlan.id,
      isDungeonSupplement: true,
    }),
  ]);
  legacyGenerator._addConnectorExplorationSpaces(
    legacyTiles,
    [],
    [
      planarConnectorPlan({ id: basePlan.id, elevation: -14 }),
      planarConnectorPlan({
        id: supplementalPlan.id,
        isDungeonSupplement: true,
      }),
    ],
  );
  assert.equal(
    Object.hasOwn(legacyTiles.get('2,1'), 'connectorPlanarHelperProvenance'),
    false,
  );
  assert.equal(
    Object.hasOwn(legacyTiles.get('2,0'), 'connectorPlanarHelperProvenance'),
    false,
  );
});

test('disjoint signed envelopes preserve a proven V4 helper across stacked floors', () => {
  const supplementalPlan = planarConnectorPlan({
    id: 'supplement:test:stacked-planar-helper',
    isDungeonSupplement: true,
  });
  const tiles = new Map();
  const generator = new DungeonGenerator({
    tileSize: TILE_SIZE,
    random: () => 0.5,
    augmentationProfileId: V4_PROFILE_ID,
  });
  generator._stampConnectionPlans(tiles, [supplementalPlan]);
  generator._addConnectorExplorationSpaces(tiles, [], [supplementalPlan]);
  const helper = tiles.get('2,0');
  const lowerFloor = {
    x: 2,
    z: 0,
    elevation: -14,
    level: -1,
    type: 'floor',
    surface: 'floor',
    roomId: 'authored:test:lower-room',
  };
  const upperPlan = planarConnectorPlan({
    id: 'authored:test:upper-plan',
    elevation: -9.95,
    level: 1,
    localElevation: 4.05,
  });

  const floorTiles = generator._applyConnectorTraversalSurfaces(
    tiles,
    [upperPlan],
    [...tiles.values(), lowerFloor],
  );
  const floorsAtTarget = floorTiles
    .filter((floor) => floor.x === 2 && floor.z === 0)
    .sort((left, right) => left.elevation - right.elevation);

  assert.deepEqual(floorsAtTarget.map((floor) => floor.elevation), [-14, -9.95, 0]);
  assert.equal(tiles.get('2,0'), helper);
  assert.equal(helper.connectorId, supplementalPlan.id);
  assert.equal(helper.connectionId, undefined);
  assert.equal(helper.structuralEnvelopeOnly, false);
  assert.deepEqual(helper.connectorEnvelopeOwnerIds, [upperPlan.id]);
  assert.equal(
    helper.connectorPlanarHelperProvenance.sourcePlanId,
    supplementalPlan.id,
  );
  const upperFloor = floorsAtTarget.find((floor) => floor.elevation === -9.95);
  assert.equal(upperFloor.signedConnectorFloorOwnerId, upperPlan.id);
  assert.equal(lowerFloor.roomId, 'authored:test:lower-room');
});

test('a signed plan consumes and rekeys only its own exact V4 planar helper', () => {
  const upperPlan = planarConnectorPlan({
    id: 'authored:test:rekeyed-upper-plan',
    elevation: -9.95,
  });
  const tiles = new Map();
  const generator = new DungeonGenerator({
    tileSize: TILE_SIZE,
    random: () => 0.5,
    augmentationProfileId: V4_PROFILE_ID,
  });
  generator._addConnectorExplorationSpaces(tiles, [], [upperPlan]);
  const helper = tiles.get('2,1');
  assert.equal(helper.elevation, 0);
  assert.equal(helper.connectorPlanarHelperProvenance.sourcePlanId, upperPlan.id);

  const floorTiles = generator._applyConnectorTraversalSurfaces(
    tiles,
    [upperPlan],
    [...tiles.values()],
  );

  assert.equal(tiles.get('2,1'), helper);
  assert.equal(helper.elevation, -9.95);
  assert.equal(helper.signedConnectorFloorOwnerId, upperPlan.id);
  assert.equal(Object.hasOwn(helper, 'connectorPlanarHelperProvenance'), false);
  assert.equal(floorTiles.some((floor) => (
    floor.x === 2 && floor.z === 1 && Math.abs(floor.elevation) <= 0.05
  )), false);
});

test('supplemental traversal reuses an already seam-stamped planar helper identity', () => {
  const plan = planarConnectorPlan({
    id: 'supplement:test:seam-stamped-planar-helper',
    isDungeonSupplement: true,
  });
  const tiles = new Map();
  const generator = new DungeonGenerator({
    tileSize: TILE_SIZE,
    random: () => 0.5,
    augmentationProfileId: V4_PROFILE_ID,
  });
  generator._stampConnectionPlans(tiles, [plan]);
  generator._addConnectorExplorationSpaces(tiles, [], [plan]);
  const helper = tiles.get('2,0');
  const seamId = `${plan.id}:to-endpoint-seam`;
  const seamCellId = `${seamId}:cell:1:0`;
  helper.signedConnectorFloorOwnerId = plan.id;
  helper.authoritativeSocketSeamIds = [seamId];
  helper.authoritativeSocketSeamCellIds = [seamCellId];
  helper.authoritativeSocketSeamOwnerIds = [plan.id];

  const floorTiles = generator._applyConnectorTraversalSurfaces(
    tiles,
    [plan],
    [...tiles.values()],
  );
  const realizedAtTarget = floorTiles.filter((floor) => (
    floor.x === helper.x
      && floor.z === helper.z
      && Math.abs(Number(floor.elevation) - Number(helper.elevation)) <= 0.05
  ));

  assert.deepEqual(realizedAtTarget, [helper]);
  assert.deepEqual(helper.authoritativeSocketSeamIds, [seamId]);
  assert.deepEqual(helper.authoritativeSocketSeamCellIds, [seamCellId]);
  assert.deepEqual(helper.authoritativeSocketSeamOwnerIds, [plan.id]);
  assert.equal(Object.hasOwn(helper, 'connectorPlanarHelperProvenance'), false);
});

test('V4 supplemental traversal safely shares a flat authored connector crossing', () => {
  const authoredPlan = planarConnectorPlan({ id: 'authored:test:crossing-route' });
  authoredPlan.bridgePath = [];
  authoredPlan.fullPath = [];
  const supplementalPlan = planarConnectorPlan({
    id: 'supplement:test:crossing-route',
    isDungeonSupplement: true,
  });
  const crossingFloor = {
    x: 2,
    z: 0,
    elevation: 0,
    level: 0,
    type: 'hallway',
    surface: 'connectorGalleryFloor',
    connectorId: authoredPlan.id,
    connectionId: authoredPlan.id,
  };
  const tiles = new Map([['2,0', crossingFloor]]);
  const generator = new DungeonGenerator({
    tileSize: TILE_SIZE,
    random: () => 0.5,
    augmentationProfileId: V4_PROFILE_ID,
  });

  const floorTiles = generator._applyConnectorTraversalSurfaces(
    tiles,
    // Production V4 realizes accepted authored connectors first, then invokes
    // this pass with only supplemental plans. The existing floor identity is
    // therefore the authoritative witness for the authored crossing.
    [supplementalPlan],
    [crossingFloor],
  );

  assert.equal(floorTiles.find((floor) => floor.x === 2 && floor.z === 0), crossingFloor);
  assert.equal(crossingFloor.connectorId, authoredPlan.id);
  assert.equal(crossingFloor.connectionId, authoredPlan.id);
  assert.deepEqual(crossingFloor.sharedConnectorFloorOwnerIds, [supplementalPlan.id]);
  assert.deepEqual(crossingFloor.v4SupplementalRouteOwnerIds, [supplementalPlan.id]);
  assert.equal(crossingFloor.walkabilityIntent, 'required-clear');
  assert.equal(crossingFloor.noEnemySpawn, true);
  assert.deepEqual(crossingFloor.connectorEnvelopeOwnerIds, [supplementalPlan.id]);
  assert.equal(supplementalPlan.localConnectorCrossingCutThroughs.length, 1);
  assert.deepEqual(
    crossingFloor.localConnectorCrossingCutThroughIds,
    [supplementalPlan.localConnectorCrossingCutThroughs[0].id],
  );
  assert.equal(
    supplementalPlan.localConnectorCrossingCutThroughs[0].retainedPrimaryOwnerId,
    authoredPlan.id,
  );
});

test('V4 supplemental crossing salvage rejects ramp and transfer surfaces', async (t) => {
  for (const [name, unsafeFields] of [
    ['ramp', {
      surface: 'industrialRamp',
      rampStartElevation: 0,
      rampEndElevation: 1,
    }],
    ['transfer', {
      augmentationTransferId: 'supplement:test:transfer',
    }],
  ]) {
    await t.test(name, () => {
      const authoredPlan = planarConnectorPlan({ id: `authored:test:${name}-route` });
      authoredPlan.bridgePath = [];
      authoredPlan.fullPath = [];
      const supplementalPlan = planarConnectorPlan({
        id: `supplement:test:${name}-route`,
        isDungeonSupplement: true,
      });
      const crossingFloor = {
        x: 2,
        z: 0,
        elevation: 0,
        level: 0,
        type: 'hallway',
        surface: 'connectorGalleryFloor',
        connectorId: authoredPlan.id,
        connectionId: authoredPlan.id,
        ...unsafeFields,
      };
      const generator = new DungeonGenerator({
        tileSize: TILE_SIZE,
        random: () => 0.5,
        augmentationProfileId: V4_PROFILE_ID,
      });

      assert.throws(
        () => generator._applyConnectorTraversalSurfaces(
          new Map([['2,0', crossingFloor]]),
          [authoredPlan, supplementalPlan],
          [crossingFloor],
        ),
        (error) => error?.code === 'DUNGEON_AUGMENTATION_FOREIGN_FLOOR_OWNERSHIP',
      );
      assert.equal(crossingFloor.localConnectorCrossingCutThroughIds, undefined);
    });
  }
});

test('V4 authored traversal clears only a leaked supplemental room label outside declared cells', () => {
  const generator = new DungeonGenerator({
    tileSize: TILE_SIZE,
    random: () => 0.5,
    augmentationProfileId: V4_PROFILE_ID,
  });
  const authoredPlan = planarConnectorPlan({ id: 'authored:test:room-cut-through' });
  const leakedRoomId = 'supplement:test:room-outside-declared-floor';
  const crossingFloor = {
    x: 2,
    z: 0,
    elevation: 0,
    level: 0,
    type: 'floor',
    surface: 'floor',
    roomId: leakedRoomId,
    augmentationOwnerId: 'supplement:test:operation',
    augmentationBlueprintId: 'ind-room-test-01',
    augmentationModuleTemplateId: 'ind-room-test-01',
    augmentationModuleKind: 'room',
  };

  const floorTiles = generator._applyConnectorTraversalSurfaces(
    new Map([['2,0', crossingFloor]]),
    [authoredPlan],
    [crossingFloor],
  );

  assert.equal(floorTiles.includes(crossingFloor), true);
  assert.equal(crossingFloor.roomId, undefined);
  assert.equal(crossingFloor.augmentationBlueprintId, undefined);
  assert.equal(crossingFloor.connectorId, authoredPlan.id);
  assert.equal(crossingFloor.connectionId, authoredPlan.id);
  assert.equal(crossingFloor.surface, 'connectorGalleryFloor');
  assert.equal(crossingFloor.walkabilityIntent, 'required-clear');
  assert.equal(authoredPlan.localSupplementRoomCutThroughs.length, 1);
  assert.equal(
    authoredPlan.localSupplementRoomCutThroughs[0].removedRoomId,
    leakedRoomId,
  );
  assert.deepEqual(
    crossingFloor.localSupplementRoomCutThroughIds,
    [authoredPlan.localSupplementRoomCutThroughs[0].id],
  );
});

test('V4 authored traversal never cuts an authoritative supplemental room or transfer cell', async (t) => {
  for (const [name, protectedFields] of [
    ['floor-cell', {
      augmentationFloorCellId: 'supplement:test:floor-cell',
      augmentationFloorTierId: 'base',
    }],
    ['transfer-cell', {
      augmentationTransferId: 'supplement:test:lift',
      augmentationTransferCellId: 'supplement:test:lift-cell',
    }],
  ]) {
    await t.test(name, () => {
      const generator = new DungeonGenerator({
        tileSize: TILE_SIZE,
        random: () => 0.5,
        augmentationProfileId: V4_PROFILE_ID,
      });
      const authoredPlan = planarConnectorPlan({ id: `authored:test:protected-${name}` });
      const protectedFloor = {
        x: 2,
        z: 0,
        elevation: 0,
        level: 0,
        type: 'floor',
        surface: 'floor',
        roomId: `supplement:test:protected-${name}-room`,
        augmentationBlueprintId: 'ind-room-test-01',
        ...protectedFields,
      };

      generator._applyConnectorTraversalSurfaces(
        new Map([['2,0', protectedFloor]]),
        [authoredPlan],
        [protectedFloor],
      );

      assert.equal(protectedFloor.roomId, `supplement:test:protected-${name}-room`);
      assert.equal(protectedFloor.localSupplementRoomCutThroughIds, undefined);
      assert.deepEqual(authoredPlan.localSupplementRoomCutThroughs, []);
    });
  }
});

test('V4 late room cleanup keeps authored connector geometry and clears only stale room ownership', () => {
  const generator = new DungeonGenerator({
    tileSize: TILE_SIZE,
    random: () => 0.5,
    augmentationProfileId: V4_PROFILE_ID,
  });
  const roomId = 'supplement:test:late-room-cut-through';
  const authoredPlan = planarConnectorPlan({
    id: 'authored:test:upper-room-cut-through',
    elevation: 4.05,
    level: 1,
  });
  const room = {
    id: roomId,
    isDungeonSupplement: true,
    augmentationFloorTiers: [{
      id: 'base',
      authoritative: true,
      worldElevation: 0,
      worldCells: [{
        id: `${roomId}:floor-tier:base:cell:0:0`,
        grid: { x: 29, z: 107 },
        elevation: 0,
      }],
    }],
    augmentationTransfers: [],
  };
  const declaredFloor = {
    x: 29,
    z: 107,
    elevation: 0,
    roomId,
    augmentationFloorCellId: `${roomId}:floor-tier:base:cell:0:0`,
  };
  const leakedUpperFloor = {
    x: 29,
    z: 107,
    elevation: 4.05,
    level: 1,
    type: 'floor',
    surface: 'upperConnectionBridge',
    roomId,
    connectionId: authoredPlan.id,
    augmentationFloorCellId: `${roomId}:stale-cell`,
    augmentationFloorTierId: 'base',
    augmentationFloorTierRuntimeId: `${roomId}:floor-tier:base`,
    mergedFloorOwnerIds: [authoredPlan.id, roomId],
  };

  const result = generator._clearLeakedSupplementRoomOwnershipFromAuthoredFloors(
    [declaredFloor, leakedUpperFloor],
    [room],
    [authoredPlan],
  );

  assert.equal(result.diagnostics.clearedFloorCount, 1);
  assert.equal(declaredFloor.roomId, roomId);
  assert.equal(declaredFloor.augmentationFloorCellId, `${roomId}:floor-tier:base:cell:0:0`);
  assert.equal(leakedUpperFloor.roomId, undefined);
  assert.equal(leakedUpperFloor.augmentationFloorCellId, undefined);
  assert.equal(leakedUpperFloor.augmentationFloorTierId, undefined);
  assert.equal(leakedUpperFloor.connectionId, authoredPlan.id);
  assert.equal(leakedUpperFloor.surface, 'upperConnectionBridge');
  assert.deepEqual(leakedUpperFloor.mergedFloorOwnerIds, [authoredPlan.id]);
  assert.equal(leakedUpperFloor.walkabilityIntent, 'required-clear');
  assert.deepEqual(
    leakedUpperFloor.localSupplementRoomCutThroughIds,
    [result.diagnostics.records[0].id],
  );
});

test('V4 late room cleanup removes a stale wrong-elevation duplicate only with its signed replacement', () => {
  const generator = new DungeonGenerator({
    tileSize: TILE_SIZE,
    random: () => 0.5,
    augmentationProfileId: V4_PROFILE_ID,
  });
  const roomId = 'supplement:test:stale-upper-duplicate';
  const authoredPlan = planarConnectorPlan({
    id: 'authored:test:shifted-upper-route',
    elevation: -9.95,
    level: 1,
    localElevation: 4.05,
  });
  const room = {
    id: roomId,
    isDungeonSupplement: true,
    augmentationFloorTiers: [{
      id: 'base',
      authoritative: true,
      worldElevation: 0,
      worldCells: [{ id: `${roomId}:base`, grid: { x: 29, z: 107 }, elevation: 0 }],
    }],
    augmentationTransfers: [],
  };
  const staleFloor = {
    x: 29,
    z: 107,
    elevation: 4.05,
    level: 1,
    type: 'floor',
    surface: 'upperConnectionBridge',
    roomId,
    connectionId: authoredPlan.id,
    mergedFloorOwnerIds: [authoredPlan.id, roomId],
  };
  const retainedFloor = {
    x: 29,
    z: 107,
    elevation: -9.95,
    type: 'hallway',
    surface: 'connectorGalleryFloor',
    connectorId: authoredPlan.id,
    connectionId: authoredPlan.id,
    signedConnectorFloorOwnerId: authoredPlan.id,
  };
  const tiles = new Map([['29,107', staleFloor]]);

  const result = generator._clearLeakedSupplementRoomOwnershipFromAuthoredFloors(
    [staleFloor, retainedFloor],
    [room],
    [authoredPlan],
    tiles,
  );

  assert.deepEqual(result.floorTiles, [retainedFloor]);
  assert.equal(result.diagnostics.clearedFloorCount, 1);
  assert.equal(result.diagnostics.clearedOwnershipFloorCount, 0);
  assert.equal(result.diagnostics.removedStaleFloorCount, 1);
  assert.equal(
    result.diagnostics.records[0].action,
    'remove-stale-room-owned-connector-floor',
  );
  assert.equal(result.diagnostics.records[0].floorKey, '29,107@y4.050');
  assert.equal(result.diagnostics.records[0].retainedFloorKey, '29,107@y-9.950');
  assert.deepEqual(
    retainedFloor.localSupplementRoomCutThroughIds,
    [result.diagnostics.records[0].id],
  );
  assert.equal(tiles.has('29,107'), false);
});

test('V4 late room cleanup preserves vertical connector and exact seam floors', async (t) => {
  const roomId = 'supplement:test:late-room-protection';
  const room = {
    id: roomId,
    isDungeonSupplement: true,
    augmentationFloorTiers: [{
      id: 'base',
      authoritative: true,
      worldElevation: 0,
      worldCells: [{ id: `${roomId}:base`, grid: { x: 0, z: 0 }, elevation: 0 }],
    }],
    augmentationTransfers: [],
  };
  await t.test('vertical authored connector', () => {
    const generator = new DungeonGenerator({
      tileSize: TILE_SIZE,
      random: () => 0.5,
      augmentationProfileId: V4_PROFILE_ID,
    });
    const verticalPlan = planarConnectorPlan({
      id: 'authored:test:vertical-room-protection',
      elevation: 0,
    });
    verticalPlan.destinationElevation = 4.05;
    verticalPlan.connectorVariant = { traversalKind: 'lift' };
    const floor = {
      x: 5,
      z: 5,
      elevation: 4.05,
      roomId,
      connectionId: verticalPlan.id,
      surface: 'liftLanding',
    };
    const result = generator._clearLeakedSupplementRoomOwnershipFromAuthoredFloors(
      [floor],
      [room],
      [verticalPlan],
    );
    assert.equal(result.diagnostics.clearedFloorCount, 0);
    assert.equal(floor.roomId, roomId);
  });

  await t.test('exact supplemental seam', () => {
    const generator = new DungeonGenerator({
      tileSize: TILE_SIZE,
      random: () => 0.5,
      augmentationProfileId: V4_PROFILE_ID,
    });
    const authoredPlan = planarConnectorPlan({
      id: 'authored:test:seam-room-protection',
      elevation: 4.05,
    });
    const supplementalPlan = planarConnectorPlan({
      id: 'supplement:test:seam-room-protection',
      elevation: 4.05,
      isDungeonSupplement: true,
    });
    supplementalPlan.fromRoomId = roomId;
    supplementalPlan.endpointSeams = [{
      id: `${supplementalPlan.id}:from-endpoint-seam`,
      nodeId: roomId,
      orderedCells: [{ gridX: 5, gridZ: 5, elevation: 4.05 }],
    }];
    const floor = {
      x: 5,
      z: 5,
      elevation: 4.05,
      roomId,
      connectionId: authoredPlan.id,
      surface: 'upperConnectionBridge',
    };
    const result = generator._clearLeakedSupplementRoomOwnershipFromAuthoredFloors(
      [floor],
      [room],
      [authoredPlan, supplementalPlan],
    );
    assert.equal(result.diagnostics.clearedFloorCount, 0);
    assert.equal(floor.roomId, roomId);
  });
});

test('malformed V4 planar-helper provenance cannot preserve foreign physical ownership', () => {
  const supplementalPlan = planarConnectorPlan({
    id: 'supplement:test:malformed-planar-helper',
    isDungeonSupplement: true,
  });
  const tiles = new Map();
  const generator = new DungeonGenerator({
    tileSize: TILE_SIZE,
    random: () => 0.5,
    augmentationProfileId: V4_PROFILE_ID,
  });
  generator._addConnectorExplorationSpaces(tiles, [], [supplementalPlan]);
  const helper = tiles.get('2,1');
  helper.connectorPlanarHelperProvenance.gridX = 99;
  const upperPlan = planarConnectorPlan({
    id: 'authored:test:malformed-upper-plan',
    elevation: -9.95,
    level: 1,
    localElevation: 4.05,
  });

  generator._applyConnectorTraversalSurfaces(
    tiles,
    [upperPlan],
    [...tiles.values()],
  );

  assert.equal(helper.connectorId, upperPlan.id);
  assert.equal(helper.connectionId, upperPlan.id);
  assert.equal(helper.connectorEnvelopeOwnerIds, undefined);
  assert.equal(Object.hasOwn(helper, 'connectorPlanarHelperProvenance'), false);
});

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

test('generator locally shares an exact seam floor owned by another V4 supplement module', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const fixture = corridorStationFixture();
  const modularOwnerId = 'supplement:test:foreign-modular-route';
  fixture.floorTiles[0].signedConnectorFloorOwnerId = modularOwnerId;

  const result = generator._realizeAuthoritativeSupplementSocketSeams(
    new Map(),
    fixture.floorTiles,
    [fixture.plan],
  );

  assert.equal(result.seamCount, 2);
  assert.equal(result.cutThroughCount, 1);
  assert.deepEqual(result.cutThroughs, [{
    schema: 'ruindivex-dungeon-route-endpoint-seam-cut-through/v1',
    id: `${fixture.fromSeam.id}:cut-through:${fixture.fromSeam.orderedCells[0].id}`,
    connectionId: fixture.plan.id,
    operationId: fixture.plan.augmentationOperationId,
    seamId: fixture.fromSeam.id,
    cellId: fixture.fromSeam.orderedCells[0].id,
    floorKey: fixture.floorTiles[0].floorKey,
    action: 'reuse-shared-supplement-floor',
    retainedOwnerIds: [modularOwnerId],
    requiredClear: true,
  }]);
  assert.ok(fixture.floorTiles[0].sharedConnectorFloorOwnerIds.includes(modularOwnerId));
  assert.ok(fixture.floorTiles[0].sharedConnectorFloorOwnerIds.includes(fixture.plan.id));
  assert.equal(fixture.floorTiles[0].walkabilityIntent, 'required-clear');
  assert.deepEqual(
    fixture.plan.authoritativeSocketSeamCutThroughs,
    result.cutThroughs,
  );
});

test('generator fills only a missing supplemental-node seam interior as a local cut-through', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const fixture = corridorStationFixture();
  const missingCell = fixture.toSeam.orderedCells.find(({ signedDepthTiles }) => (
    signedDepthTiles < 0
  ));
  fixture.floorTiles = fixture.floorTiles.filter((floor) => !(
    floor.x === missingCell.gridX
      && floor.z === missingCell.gridZ
      && Math.abs(Number(floor.elevation ?? 0) - Number(missingCell.position.y ?? 0)) <= 0.05
  ));

  const result = generator._realizeAuthoritativeSupplementSocketSeams(
    new Map(),
    fixture.floorTiles,
    [fixture.plan],
  );

  assert.equal(result.cutThroughCount, 1);
  assert.equal(result.cutThroughs[0].action, 'create-supplemental-interior-support');
  assert.equal(result.cutThroughs[0].cellId, missingCell.id);
  const createdFloor = result.floorTiles.find((floor) => (
    floor.x === missingCell.gridX
      && floor.z === missingCell.gridZ
      && Math.abs(Number(floor.elevation ?? 0) - Number(missingCell.position.y ?? 0)) <= 0.05
  ));
  assert.ok(createdFloor);
  assert.equal(createdFloor.signedConnectorFloorOwnerId, fixture.plan.id);
  assert.equal(createdFloor.walkabilityIntent, 'required-clear');
  assert.ok(createdFloor.authoritativeSocketSeamCutThroughIds.includes(
    result.cutThroughs[0].id,
  ));
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
