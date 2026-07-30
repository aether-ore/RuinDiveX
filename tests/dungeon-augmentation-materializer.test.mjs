import assert from 'node:assert/strict';
import test from 'node:test';
import { DUNGEON_CONNECTOR_VARIANT_IDS } from '../src/DungeonConnectorVariants.js';
import { GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS } from '../src/dungeon-augmentation/catalog.js';
import { materializeIndustrialOverlay } from '../src/dungeon-augmentation/IndustrialOverlayMaterializer.js';
import {
  INDUSTRIAL_SUPPLEMENT_MODULE_MANIFESTS,
} from '../src/dungeon-augmentation/IndustrialSupplementContent.js';
import {
  inspectIndustrialSupplementRealizedStructuralQuality,
} from '../src/dungeon-augmentation/IndustrialSupplementStructuralQuality.js';
import {
  createDungeonJunctionGeometryRecord,
  createDungeonSocketLandingOverlapVolume,
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
    { x: 4, z: 0 },
    { x: 5, z: 0 },
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
        path: [{ x: 9.8, y: 0, z: -40.6 }, destinationSocket.position],
      },
    ],
  };
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

test('shared junction thresholds materialize only the two adjacent junction-core boundary cells', () => {
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
  assert.deepEqual(plan.fullPath, [{ x: 0, z: 0 }, { x: 1, z: 0 }]);
  assert.deepEqual(plan.bridgePath, plan.fullPath);
  assert.deepEqual(plan.fromSocket.grantedWorldPosition, { x: 0, y: 0, z: 0 });
  assert.deepEqual(plan.toSocket.grantedWorldPosition, { x: 0, y: 0, z: 0 });
  assert.deepEqual(
    [plan.fromSocket.x, plan.fromSocket.z, plan.toSocket.x, plan.toSocket.z],
    [0, 0, 1, 0],
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
