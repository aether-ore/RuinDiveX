import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeIndustrialOverlay } from '../src/dungeon-augmentation/IndustrialOverlayMaterializer.js';

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
    assert.equal(physicalPlan.doorId, index === physicalPlans.length - 1 ? 'Door_Alpha' : null);
    assert.equal(physicalPlan.hostsLogicalGate, index === physicalPlans.length - 1);
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
});
