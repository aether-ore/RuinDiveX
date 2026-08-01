import assert from 'node:assert/strict';
import test from 'node:test';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  createDungeonRouteEndpointSeam,
  dungeonVolumeOverlapWithinGrant,
  dungeonVolumesOverlap,
} from '../src/dungeon-augmentation/geometry.js';
import { materializeIndustrialOverlay } from '../src/dungeon-augmentation/IndustrialOverlayMaterializer.js';

const TILE_SIZE = 2.8;
const PROFILE_ID = 'industrial-supplement-preview-v4';
const REGION_ID = 'industrial-v1:main-region';
const GRANT_ID = `${REGION_ID}:route-network-grant:coverage:enemyNest_keycardRoom`;
const OPERATION_ID = 'supplement:industrial-v1-main-region:routenetwork:1:operation:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom';
const SEGMENT_ID = 'supplement:industrial-v1-main-region:routenetwork:1:segment:0:industrial-v1-main-region-route-network-grant-coverage-enemynest_keycardroom';
const HISTORICAL_FLOOR_KEY = '-16,15@y14.000';
const THEME_BINDING = Object.freeze({
  themeId: 'industrial-v1',
  themeSessionId: 'issue-066-canonical-regression',
});

function worldPoint(gridX, gridZ, elevation = 14) {
  return { x: gridX * TILE_SIZE, y: elevation, z: gridZ * TILE_SIZE };
}

function routeSocket({
  id,
  nodeId,
  localSocketId,
  position,
  facing,
  kind = 'supplementSocket',
}) {
  return {
    kind,
    id,
    socketId: id,
    nodeId,
    localSocketId,
    position,
    facing,
    widthMeters: TILE_SIZE * 3,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    clearanceHeightMeters: 3.6,
    state: 'connected',
    segmentId: SEGMENT_ID,
  };
}

function createIssue066Fixture({ reversed = false, dogleg = false } = {}) {
  const sourceNodeId = 'keycardRoom';
  const destinationNodeId = 'enemyNest';

  // This is the exact first canonical host threshold. The authoritative seam
  // owns threshold grid Z=16; its first exterior cell is the historical
  // -16,15 floor named by ISSUE-070.
  const canonicalSourcePosition = {
    x: -44.8,
    y: 14,
    z: 43.39999999999999,
  };
  const canonicalSource = routeSocket({
    id: `${REGION_ID}:route-socket:enemyNest_keycardRoom:0`,
    nodeId: sourceNodeId,
    localSocketId: 'exit',
    position: canonicalSourcePosition,
    facing: { x: 0, y: 0, z: -1 },
    kind: 'parentSocket',
  });
  const canonicalDestination = routeSocket({
    id: `${REGION_ID}:route-socket:enemyNest_keycardRoom:1`,
    nodeId: destinationNodeId,
    localSocketId: 'entry',
    position: worldPoint(-16, 1),
    facing: { x: 0, y: 0, z: 1 },
    kind: 'parentSocket',
  });

  const forwardPath = dogleg ? [
    canonicalSource.position,
    worldPoint(-15, 16),
    worldPoint(-15, 14),
    worldPoint(-16, 14),
    ...Array.from({ length: 13 }, (_, index) => worldPoint(-16, 13 - index)),
  ] : [
    canonicalSource.position,
    ...Array.from({ length: 15 }, (_, index) => worldPoint(-16, 15 - index)),
  ];

  const originalFromSeam = createDungeonRouteEndpointSeam(canonicalSource, {
    id: `${SEGMENT_ID}:from-endpoint-seam`,
    segmentId: SEGMENT_ID,
    operationId: OPERATION_ID,
    networkId: OPERATION_ID,
    nodeId: sourceNodeId,
    socketId: canonicalSource.id,
    localSocketId: canonicalSource.localSocketId,
    role: 'from',
    tileSize: TILE_SIZE,
    elevationBand: 1,
  });
  const originalToSeam = createDungeonRouteEndpointSeam(canonicalDestination, {
    id: `${SEGMENT_ID}:to-endpoint-seam`,
    segmentId: SEGMENT_ID,
    operationId: OPERATION_ID,
    networkId: OPERATION_ID,
    nodeId: destinationNodeId,
    socketId: canonicalDestination.id,
    localSocketId: canonicalDestination.localSocketId,
    role: 'to',
    tileSize: TILE_SIZE,
    elevationBand: 1,
  });

  const from = reversed ? canonicalDestination : canonicalSource;
  const to = reversed ? canonicalSource : canonicalDestination;
  const endpointSeams = reversed ? [{
    ...structuredClone(originalToSeam),
    role: 'from',
    sourceRole: 'to',
    materializedRole: 'from',
  }, {
    ...structuredClone(originalFromSeam),
    role: 'to',
    sourceRole: 'from',
    materializedRole: 'to',
  }] : [originalFromSeam, originalToSeam];
  const path = reversed ? [...forwardPath].reverse() : forwardPath;

  const segment = {
    id: SEGMENT_ID,
    operationId: OPERATION_ID,
    connectorFamily: 'service-gallery',
    from,
    to,
    path,
    endpointSeams,
    bidirectional: true,
  };
  const grantedEndpointSockets = [canonicalSource, canonicalDestination];
  const operation = {
    id: OPERATION_ID,
    type: 'routeNetwork',
    parentRegionId: REGION_ID,
    grantId: GRANT_ID,
    routeNetworkKind: 'objective-route-coverage',
    topologyTemplateId: 'issue-066-linear-regression',
    progressionBandId: 1,
    accessDomainId: `${REGION_ID}:access-domain:band-1`,
    elevationModes: ['split-level-platform'],
    endpointSocketIds: grantedEndpointSockets.map(({ id }) => id),
    nodeIds: [],
    segmentIds: [SEGMENT_ID],
    stableRuntimeStateIds: {
      encounter: `${OPERATION_ID}:state:encounter-cleared`,
      mechanism: `${OPERATION_ID}:state:mechanism-activated`,
      reward: `${OPERATION_ID}:state:reward-claimed`,
      shortcut: `${OPERATION_ID}:state:shortcut-activated`,
    },
    themeBinding: THEME_BINDING,
  };
  const nodes = [];
  const rooms = [{
    id: sourceNodeId,
    x: -16,
    z: 19,
    width: 9,
    depth: 9,
    baseElevation: 14,
    plannedBaseElevation: 14,
    suppressRoomGeometry: true,
    exitSockets: [],
  }, {
    id: destinationNodeId,
    x: -16,
    z: -3,
    width: 9,
    depth: 9,
    baseElevation: 14,
    plannedBaseElevation: 14,
    suppressRoomGeometry: true,
    exitSockets: [],
  }];
  const overlayPlan = {
    profileId: PROFILE_ID,
    profileRevision: 5,
    difficulty: 1,
    operations: [operation],
    nodes,
    segments: [segment],
  };
  const extensionRegions = [{
    id: REGION_ID,
    routeNetworkGrants: [{
      id: GRANT_ID,
      kind: 'objective-route-coverage',
      routeNetworkKind: 'objective-route-coverage',
      endpointSockets: grantedEndpointSockets,
      progressionBandId: 1,
      accessDomainId: `${REGION_ID}:access-domain:band-1`,
    }],
  }];
  return { overlayPlan, extensionRegions, segment, endpointSeams, nodes, rooms };
}

function materializeFixture(options = {}) {
  const fixture = createIssue066Fixture(options);
  const result = materializeIndustrialOverlay({
    rooms: fixture.rooms,
    overlayPlan: fixture.overlayPlan,
    extensionRegions: fixture.extensionRegions,
    tileSize: TILE_SIZE,
  });
  return {
    ...fixture,
    result,
    plan: result.connectionPlans.find(({ id }) => id === SEGMENT_ID) ?? null,
  };
}

function floorTilesForPlan(plan, rooms) {
  const seamCellByFloorKey = new Map();
  for (const seam of plan.endpointSeams) {
    for (const cell of seam.orderedCells) {
      const floorKey = `${cell.gridX},${cell.gridZ}@y${Number(cell.position.y).toFixed(3)}`;
      const records = seamCellByFloorKey.get(floorKey) ?? [];
      records.push({ seam, cell });
      seamCellByFloorKey.set(floorKey, records);
    }
  }
  const cells = new Map();
  const addFloor = (x, z, elevation, roomId = null) => {
    const floorKey = `${x},${z}@y${Number(elevation).toFixed(3)}`;
    const seamRecords = seamCellByFloorKey.get(floorKey) ?? [];
    const floor = cells.get(floorKey) ?? {
      x,
      z,
      elevation,
      level: 1,
      surface: 'connectorGalleryFloor',
      connectionId: SEGMENT_ID,
      connectorId: SEGMENT_ID,
      signedConnectorFloorOwnerId: SEGMENT_ID,
      ...(roomId == null ? {} : { roomId }),
    };
    floor.authoritativeSocketSeamIds = [...new Set([
      ...(floor.authoritativeSocketSeamIds ?? []),
      ...seamRecords.map(({ seam }) => seam.id),
    ])];
    floor.authoritativeSocketSeamCellIds = [...new Set([
      ...(floor.authoritativeSocketSeamCellIds ?? []),
      ...seamRecords.map(({ cell }) => cell.id),
    ])];
    floor.authoritativeSocketSeamOwnerIds = [...new Set([
      ...(floor.authoritativeSocketSeamOwnerIds ?? []),
      ...seamRecords.map(() => SEGMENT_ID),
    ])];
    cells.set(floorKey, floor);
  };

  for (const seam of plan.endpointSeams) {
    const roomId = seam.nodeId;
    for (const cell of seam.orderedCells) {
      addFloor(cell.gridX, cell.gridZ, cell.position.y, roomId);
    }
  }
  for (const cell of plan.authoritativeTraversalSpine.orderedCells) {
    for (let lane = -1; lane <= 1; lane += 1) {
      addFloor(cell.grid.x + lane, cell.grid.z, cell.elevation);
    }
  }
  assert.ok(rooms.length >= 2);
  return [...cells.values()];
}

test('ISSUE-066 canonical segment owns a complete two-way spine through both exterior seam leads', () => {
  const { result, plan } = materializeFixture();
  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  assert.ok(plan);
  assert.deepEqual(plan.fullPath.slice(0, 3), [
    { x: -16, z: 16 },
    { x: -16, z: 15 },
    { x: -16, z: 14 },
  ]);
  assert.deepEqual(plan.fullPath.slice(-3), [
    { x: -16, z: 3 },
    { x: -16, z: 2 },
    { x: -16, z: 1 },
  ]);
  assert.equal(plan.endpointSeams.every(({ orderedCells }) => orderedCells.length === 15), true);
  assert.ok(plan.authoritativeTraversalSpine);
  assert.ok(plan.authoritativeTraversalSpine.requiredFloorKeys.includes(HISTORICAL_FLOOR_KEY));
  assert.equal(plan.authoritativeTraversalSpine.precommitTraversal.forwardAccepted, true);
  assert.equal(plan.authoritativeTraversalSpine.precommitTraversal.reverseAccepted, true);

  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  plan.traversalFloorKeys = [...plan.authoritativeTraversalSpine.requiredFloorKeys];
  const floorTiles = floorTilesForPlan(plan, result.rooms);
  const platformability = generator._validatePlatformability({
    floorTiles,
    rooms: result.rooms,
    solidZones: [],
    connectionPlans: [plan],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });
  const spine = platformability.details.connectorSpineChecks.find(({ connectionId }) => (
    connectionId === SEGMENT_ID
  ));
  assert.ok(spine);
  assert.equal(spine.missingTraversalFloorKeys.length, 0);
  assert.equal(
    spine.traversableOutward,
    true,
    JSON.stringify({ spine, errors: platformability.errors }),
  );
  assert.equal(spine.traversableReturn, true);
  assert.equal(spine.strictLocalComponentAccepted, true);
  assert.equal(spine.accepted, true, platformability.errors.join('\n'));
});

test('ISSUE-066 canonical path overlaps an authored gallery only inside its exact source seam', () => {
  const { plan } = materializeFixture();
  assert.ok(plan);
  const sourceSeam = plan.endpointSeams[0];
  const authoredGalleryCells = sourceSeam.orderedCells.filter(({ signedDepthTiles }) => (
    signedDepthTiles <= 0
  ));
  const pathVolumes = plan.fullPath.map(({ x, z }, ordinal) => ({
    id: `${SEGMENT_ID}:path-cell:${ordinal}`,
    center: { x: x * TILE_SIZE, y: 16.8, z: z * TILE_SIZE },
    size: { x: TILE_SIZE, y: 5.6, z: TILE_SIZE },
  }));
  const authoredVolumes = authoredGalleryCells.map((cell) => ({
    id: `enemyNest_keycardRoom_ground:${cell.id}`,
    center: { x: cell.position.x, y: 16.8, z: cell.position.z },
    size: { x: TILE_SIZE, y: 5.6, z: TILE_SIZE },
  }));
  const overlaps = pathVolumes.flatMap((pathVolume) => authoredVolumes
    .filter((baseVolume) => dungeonVolumeOverlapWithinGrant(
      pathVolume,
      baseVolume,
      sourceSeam.overlapEnvelope,
    ))
    .map((baseVolume) => ({ pathVolume, baseVolume })));
  assert.ok(overlaps.length > 0);
  assert.equal(pathVolumes.some((pathVolume) => authoredVolumes.some((baseVolume) => (
    dungeonVolumesOverlap(pathVolume, baseVolume)
      && !dungeonVolumeOverlapWithinGrant(
        pathVolume,
        baseVolume,
        sourceSeam.overlapEnvelope,
      )
  ))), false);
});

test('ISSUE-066 source reversal preserves exact seam identities and remains bidirectional', () => {
  const { result, plan } = materializeFixture({ reversed: true });
  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  assert.ok(plan);
  assert.deepEqual(
    plan.endpointSeams.map(({ role, sourceRole, socketId }) => ({ role, sourceRole, socketId })),
    [{
      role: 'from',
      sourceRole: 'from',
      socketId: plan.fromSocket.id,
    }, {
      role: 'to',
      sourceRole: 'to',
      socketId: plan.toSocket.id,
    }],
  );
  assert.equal(plan.authoritativeTraversalSpine.precommitTraversal.forwardAccepted, true);
  assert.equal(plan.authoritativeTraversalSpine.precommitTraversal.reverseAccepted, true);
  assert.ok(plan.authoritativeTraversalSpine.requiredFloorKeys.includes(HISTORICAL_FLOOR_KEY));
});

test('ISSUE-066 one-tile dogleg rejects before a physical connection is committed', () => {
  const { result, plan } = materializeFixture({ dogleg: true });
  assert.equal(result.diagnostics.accepted, false);
  assert.equal(result.diagnostics.atomicRejected, true);
  assert.equal(plan, null);
  assert.match(
    result.diagnostics.errors.join('\n'),
    /DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE/,
  );
});

test('ISSUE-066 final collision proof reports the historical missing centerline floor', () => {
  const { result, plan } = materializeFixture();
  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  assert.ok(plan);
  plan.traversalFloorKeys = [...plan.authoritativeTraversalSpine.requiredFloorKeys];
  const floorTiles = floorTilesForPlan(plan, result.rooms).filter((floor) => (
    `${floor.x},${floor.z}@y${Number(floor.elevation).toFixed(3)}` !== HISTORICAL_FLOOR_KEY
  ));
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const platformability = generator._validatePlatformability({
    floorTiles,
    rooms: result.rooms,
    solidZones: [],
    connectionPlans: [plan],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });
  const check = platformability.details.connectorSpineChecks.find(({ connectionId }) => (
    connectionId === SEGMENT_ID
  ))?.finalCollisionSpineCheck;
  assert.ok(check);
  assert.equal(check.accepted, false);
  assert.deepEqual(check.missingFloorKeys, [HISTORICAL_FLOOR_KEY]);
  assert.match(
    platformability.errors.join('\n'),
    /DUNGEON_AUGMENTATION_ROUTE_CENTERLINE_FLOOR_MISSING/,
  );
});

test('ISSUE-066 final collision proof distinguishes forward and reverse blockage', () => {
  const { result, plan } = materializeFixture();
  assert.equal(result.diagnostics.accepted, true, JSON.stringify(result.diagnostics.errors));
  assert.ok(plan);
  plan.traversalFloorKeys = [...plan.authoritativeTraversalSpine.requiredFloorKeys];
  const floorTiles = floorTilesForPlan(plan, result.rooms);
  const first = plan.authoritativeTraversalSpine.orderedCells[7];
  const second = plan.authoritativeTraversalSpine.orderedCells[8];
  const barrier = {
    id: `${SEGMENT_ID}:regression-midpoint-barrier`,
    position: {
      x: (first.grid.x + second.grid.x) * TILE_SIZE * 0.5,
      y: first.elevation + 1.8,
      z: (first.grid.z + second.grid.z) * TILE_SIZE * 0.5,
    },
    halfWidth: Math.abs(first.grid.x - second.grid.x) === 1 ? 0.05 : TILE_SIZE * 1.5,
    halfDepth: Math.abs(first.grid.z - second.grid.z) === 1 ? 0.05 : TILE_SIZE * 1.5,
    verticalHalfHeight: 1.8,
  };
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const platformability = generator._validatePlatformability({
    floorTiles,
    rooms: result.rooms,
    solidZones: [barrier],
    connectionPlans: [plan],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });
  const check = platformability.details.connectorSpineChecks.find(({ connectionId }) => (
    connectionId === SEGMENT_ID
  ))?.finalCollisionSpineCheck;
  assert.ok(check);
  assert.equal(check.missingFloorKeys.length, 0);
  assert.equal(check.forwardAccepted, false);
  assert.equal(check.reverseAccepted, false);
  assert.match(
    platformability.errors.join('\n'),
    /DUNGEON_AUGMENTATION_ROUTE_FORWARD_TRAVERSAL_REJECTED/,
  );
  assert.match(
    platformability.errors.join('\n'),
    /DUNGEON_AUGMENTATION_ROUTE_REVERSE_TRAVERSAL_REJECTED/,
  );
});
