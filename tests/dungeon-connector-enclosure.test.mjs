import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../src/TraversalCapabilities.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

const REAL_SEED = 'v1-bidirectional-connector-sweep-0000';
const AUGMENTED_SEED = 'layout:augmentation-realized-v4-000';
const AUGMENTED_BASE_PLAN_HASH = 'v1:layout:augmentation-realized-v4-000:depth:1:revolvingFusillade';
const ADJACENT_THRESHOLD_WITNESS_SEED = 'layout:augmentation-v2-witness-023';
const ADJACENT_THRESHOLD_WITNESS_BASE_PLAN_HASH =
  'v1:layout:augmentation-v2-witness-023:depth:1:revolvingFusillade';
const AUGMENTATION_PROFILE_ID = 'industrial-supplement-preview-v4';
const LEGACY_ADJACENT_AUGMENTATION_PROFILE_ID = 'industrial-supplement-preview-v2';
const FALLBACK_SEED = 'layout:augmentation-realized-sweep-004';
const FALLBACK_BASE_PLAN_HASH = 'v1:layout:augmentation-realized-sweep-004:depth:1:revolvingFusillade';
const EPSILON = 0.001;
const DEFAULT_RUIN_WALL_HEIGHT = 15.6;
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function tileKey(x, z) {
  return `${x},${z}`;
}

function getVerticalEnvelope(tile, roomById = new Map()) {
  const room = roomById.get(tile.roomId);
  const bottom = Number(
    room?.baseElevation
      ?? tile.connectorMinY
      ?? tile.elevation
      ?? 0,
  );
  const authoredTop = Number(
    room?.ceilingY
      ?? tile.connectorCeilingY
      ?? (bottom + DEFAULT_RUIN_WALL_HEIGHT),
  );
  return {
    bottom,
    top: Math.max(bottom + PLAYER_TRAVERSAL_ENVELOPE.headClearance, authoredTop),
  };
}

function collectConnectorEnvelopeDiscontinuities({
  tiles,
  rooms = [],
  openAirTileKeys = new Set(),
}) {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const discontinuities = [];

  for (const tile of tiles.values()) {
    if (openAirTileKeys.has(tileKey(tile.x, tile.z))) continue;
    const envelope = getVerticalEnvelope(tile, roomById);

    for (const [dx, dz] of DIRECTIONS) {
      const neighborKey = tileKey(tile.x + dx, tile.z + dz);
      if (openAirTileKeys.has(neighborKey)) continue;
      const neighbor = tiles.get(neighborKey);
      if (!neighbor) continue;
      const tileTransferIds = new Set([
        ...(tile.augmentationTransferIds ?? []),
        ...(tile.augmentationTransferId ? [tile.augmentationTransferId] : []),
      ].map(String));
      const sharesAuthoredTransfer = tileTransferIds.size > 0
        && [
          ...(neighbor.augmentationTransferIds ?? []),
          ...(neighbor.augmentationTransferId ? [neighbor.augmentationTransferId] : []),
        ].some((id) => tileTransferIds.has(String(id)));
      if (sharesAuthoredTransfer
        || tile.surface === 'industrialRamp'
        || neighbor.surface === 'industrialRamp') continue;
      if (!(tile.connectorId || tile.connectionId || neighbor.connectorId || neighbor.connectionId)) {
        continue;
      }

      const neighborEnvelope = getVerticalEnvelope(neighbor, roomById);
      const horizontal = dz !== 0;
      const face = {
        horizontal,
        dx,
        dz,
        line: horizontal ? tile.z + dz * 0.5 : tile.x + dx * 0.5,
        axis: horizontal ? tile.x : tile.z,
        tile: { x: tile.x, z: tile.z },
        neighbor: { x: neighbor.x, z: neighbor.z },
      };

      if (neighborEnvelope.bottom > envelope.bottom + EPSILON) {
        const top = Math.min(envelope.top, neighborEnvelope.bottom);
        if (top - envelope.bottom > EPSILON) {
          discontinuities.push({
            ...face,
            kind: 'raised-neighbor-floor',
            bottom: envelope.bottom,
            top,
          });
        }
      }
      if (neighborEnvelope.top < envelope.top - EPSILON) {
        const bottom = Math.max(envelope.bottom, neighborEnvelope.top);
        if (envelope.top - bottom > EPSILON) {
          discontinuities.push({
            ...face,
            kind: 'lower-neighbor-ceiling',
            bottom,
            top: envelope.top,
          });
        }
      }
    }
  }

  return discontinuities;
}

function wallRunCovers(discontinuity, run) {
  return run.horizontal === discontinuity.horizontal
    && run.dx === discontinuity.dx
    && run.dz === discontinuity.dz
    && Math.abs(run.line - discontinuity.line) <= EPSILON
    && run.start <= discontinuity.axis
    && run.end >= discontinuity.axis
    && run.wallBottomY <= discontinuity.bottom + EPSILON
    && run.wallTopY >= discontinuity.top - EPSILON;
}

function wallRunBlocksSocket(socket, run, tileSize) {
  const facingX = Math.sign(Number(socket.facingX ?? 0));
  const facingZ = Math.sign(Number(socket.facingZ ?? 0));
  const horizontal = facingZ !== 0;
  const line = horizontal
    ? Number(socket.z) + facingZ * 0.5
    : Number(socket.x) + facingX * 0.5;
  if (run.horizontal !== horizontal || Math.abs(run.line - line) > EPSILON) return false;
  const minimumY = Number(socket.elevation ?? 0);
  const maximumY = minimumY + Math.max(
    PLAYER_TRAVERSAL_ENVELOPE.headClearance,
    Number(socket.clearanceHeight ?? 0),
  );
  if (run.wallTopY <= minimumY + EPSILON || run.wallBottomY >= maximumY - EPSILON) {
    return false;
  }
  const halfWidthTiles = Math.floor(Math.max(
    3,
    Math.round(Number(socket.landingWidth ?? 0) / tileSize) || 1,
  ) / 2);
  const lateralX = -facingZ;
  const lateralZ = facingX;
  for (let lateral = -halfWidthTiles; lateral <= halfWidthTiles; lateral += 1) {
    const x = Number(socket.x) + lateralX * lateral;
    const z = Number(socket.z) + lateralZ * lateral;
    const axis = horizontal ? x : z;
    if (run.start <= axis && run.end >= axis) return true;
  }
  return false;
}

function disposeDungeon(dungeon) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  dungeon?.group?.traverse?.((object) => {
    if (object.geometry?.isBufferGeometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material?.isMaterial) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  dungeon?.group?.clear?.();
}

function assertLockedGatesAtSource(dungeon) {
  const lockedGates = dungeon.doors.filter(({ locked }) => locked);
  assert.ok(lockedGates.length > 0, 'no locked gates were assembled');
  for (const gate of lockedGates) {
    const gatePlan = dungeon.connectionPlans.find((plan) => (
      plan.id === gate.connectionPlanId
    ));
    assert.ok(gatePlan, `${gate.id} has no physical connection plan`);
    assert.equal(gate.gatePlacementSide, 'source', `${gate.id} is not source-side`);
    assert.equal(gate.thresholdOwnerRoomId, gate.fromRoomId);
    assert.ok(gate.thresholdAnchored, `${gate.id} is not socket-anchored`);
    assert.ok(Math.abs(
      gate.graphBlockingPosition.x - gatePlan.fromSocket.x * dungeon.tileSize
    ) <= EPSILON, `${gate.id} graph X does not match its source socket`);
    assert.ok(Math.abs(
      gate.graphBlockingPosition.z - gatePlan.fromSocket.z * dungeon.tileSize
    ) <= EPSILON, `${gate.id} graph Z does not match its source socket`);
    assert.ok(Math.abs(
      gate.position.x
        - (gatePlan.fromSocket.x + gatePlan.fromSocket.facingX * 0.5) * dungeon.tileSize
    ) <= EPSILON, `${gate.id} visual X is not outside its source socket`);
    assert.ok(Math.abs(
      gate.position.z
        - (gatePlan.fromSocket.z + gatePlan.fromSocket.facingZ * 0.5) * dungeon.tileSize
    ) <= EPSILON, `${gate.id} visual Z is not outside its source socket`);
  }
}

test('adjacent vertical envelopes emit fascia above a lower roof and below a raised floor', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const tiles = new Map([
    ['0,0', {
      x: 0,
      z: 0,
      connectorId: 'synthetic-connector',
      connectorMinY: 0,
      connectorCeilingY: 8.4,
    }],
    ['1,0', {
      x: 1,
      z: 0,
      connectorId: 'synthetic-connector',
      connectorMinY: 2,
      connectorCeilingY: 12.2,
    }],
  ]);

  const sharedFaceRuns = generator
    ._collectBoundaryWallRuns(tiles, new Set(), [])
    .filter((run) => !run.horizontal && Math.abs(run.line - 0.5) <= EPSILON);
  const intervals = sharedFaceRuns
    .map((run) => ({
      dx: run.dx,
      bottom: run.wallBottomY,
      top: run.wallTopY,
    }))
    .sort((first, second) => first.bottom - second.bottom);

  assert.deepEqual(intervals, [
    { dx: 1, bottom: 0, top: 2 },
    { dx: -1, bottom: 8.4, top: 12.2 },
  ]);
});

test('wall rendering and collision consume the same authoritative pre-render runs', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const run = {
    facadeId: 'supplement-authoritative-wall-run',
    horizontal: true,
    line: 4.5,
    start: 2.5,
    end: 5.5,
    lengthTiles: 3,
    wallBottomY: 2.8,
    wallTopY: 8.4,
    wallHeight: 5.6,
    ownerId: 'supplement-room',
    ownerIds: ['supplement-room'],
  };
  const rendered = [];
  generator._collectBoundaryWallRuns = () => {
    throw new Error('authoritative wall runs were reconstructed');
  };
  generator._addBoundaryWallRun = (_group, acceptedRun) => rendered.push(acceptedRun);

  const zones = generator._addWalls(
    new THREE.Group(),
    new Map(),
    {},
    new Set(),
    [],
    new Map(),
    [run],
  );

  assert.deepEqual(rendered, [run]);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].wallFacadeId, run.facadeId);
  assert.equal(zones[0].position.y, 5.6);
  assert.equal(zones[0].halfWidth, run.lengthTiles * generator.tileSize * 0.5);
});

test('walkability cannot step between tile centers through a thin threshold wall', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const fromTile = { x: 0, z: 0, elevation: 0, level: 0 };
  const toTile = { x: 0, z: 1, elevation: 0, level: 0 };
  const thinThresholdWall = {
    position: new THREE.Vector3(0, 1.5, generator.tileSize * 0.5),
    halfWidth: generator.tileSize,
    halfDepth: 0.11,
    verticalHalfHeight: 1.5,
  };

  assert.equal(
    generator._doesFloorTraversalSegmentIntersectZone(
      fromTile,
      toTile,
      thinThresholdWall,
      PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
    ),
    true,
    'the center-to-center movement segment should cross the thin wall',
  );

  const unrestricted = generator._createReachableFloorTileKeySet(
    fromTile,
    [fromTile, toTile],
  );
  assert.equal(unrestricted.has(generator._getFloorTileGraphKey(toTile)), true);

  const wallAware = generator._createReachableFloorTileKeySet(
    fromTile,
    [fromTile, toTile],
    {
      canTraverseEdge: (source, destination) => (
        !generator._doesFloorTraversalSegmentIntersectZone(
          source,
          destination,
          thinThresholdWall,
          PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
        )
      ),
    },
  );
  assert.equal(
    wallAware.has(generator._getFloorTileGraphKey(toTile)),
    false,
    'the reachability flood must stop at the physical threshold wall',
  );
});

test('an elevated traversal link remains walkable when it crosses above a thin wall', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const fromTile = { x: 0, z: 0, elevation: 0, level: 0 };
  const toTile = { x: 0, z: 1, elevation: 20, level: 0 };
  fromTile.traversalLinks = [{
    toFloorKey: generator._getFloorTileGraphKey(toTile),
    action: 'lift',
  }];
  const lowThresholdWall = {
    position: new THREE.Vector3(0, 1.5, generator.tileSize * 0.72),
    halfWidth: generator.tileSize,
    halfDepth: 0.11,
    verticalHalfHeight: 1.5,
  };

  assert.equal(
    generator._doesFloorTraversalSegmentIntersectZone(
      fromTile,
      toTile,
      lowThresholdWall,
      PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
    ),
    false,
    'the traversal is already vertically clear where its X/Z segment crosses the wall',
  );

  const reachable = generator._createReachableFloorTileKeySet(
    fromTile,
    [fromTile, toTile],
    {
      canTraverseEdge: (source, destination) => (
        !generator._doesFloorTraversalSegmentIntersectZone(
          source,
          destination,
          lowThresholdWall,
          PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
        )
      ),
    },
  );
  assert.equal(
    reachable.has(generator._getFloorTileGraphKey(toTile)),
    true,
    'a wall below an elevated lift/ladder link must not create a false rejection',
  );
});

test('connector validation rejects a thin solid barrier between clear tile centers', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const sourceFloor = {
    x: 0,
    z: 0,
    elevation: 0,
    level: 0,
    roomId: 'hubTown',
  };
  const destinationFloor = {
    x: 0,
    z: 1,
    elevation: 0,
    level: 0,
    roomId: 'destination',
  };
  const thinBarrier = {
    id: 'thin-connector-barrier',
    position: new THREE.Vector3(0, 1.5, generator.tileSize * 0.5),
    halfWidth: generator.tileSize,
    halfDepth: 0.11,
    verticalHalfHeight: 1.5,
  };
  assert.equal(generator._isFloorTileBlockedBySolidZone(sourceFloor, [thinBarrier]), false);
  assert.equal(generator._isFloorTileBlockedBySolidZone(destinationFloor, [thinBarrier]), false);

  const validation = generator._validateConnectorEntranceWalkability({
    floorTiles: [sourceFloor, destinationFloor],
    rooms: [
      { id: 'hubTown', x: 0, z: 0, width: 1, depth: 1, baseElevation: 0 },
      { id: 'destination', x: 0, z: 1, width: 1, depth: 1, baseElevation: 0 },
    ],
    solidZones: [thinBarrier],
    useSegmentBarriers: true,
    connectionPlans: [{
      id: 'thin-barrier-connector',
      elevation: 0,
      fromSocket: {
        id: 'source-socket',
        roomId: 'hubTown',
        x: 0,
        z: 0,
        elevation: 0,
        facingX: 0,
        facingZ: 1,
      },
      toSocket: {
        id: 'destination-socket',
        roomId: 'destination',
        x: 0,
        z: 1,
        elevation: 0,
        facingX: 0,
        facingZ: -1,
      },
    }],
  });

  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some((error) => error.includes('cannot be traversed')));
  assert.ok(validation.details.checks.every((check) => !(
    check.traversableOutward && check.traversableReturn
  )));
});

test('locked-gate full-height structural clearance is reserved at source thresholds', () => {
  const generator = new DungeonGenerator();
  const tiles = new Map();
  const sourceKeys = [
    '2,-1', '2,0', '2,1',
    '19,2', '20,2', '21,2',
  ];
  const destinationKeys = [
    '8,-1', '8,0', '8,1',
    '19,8', '20,8', '21,8',
  ];
  for (const key of [...sourceKeys, ...destinationKeys]) {
    const [x, z] = key.split(',').map(Number);
    tiles.set(key, { x, z, type: 'floor' });
  }
  const rooms = [
    { id: 'west', x: 0, z: 0, width: 5, depth: 5 },
    { id: 'east', x: 10, z: 0, width: 5, depth: 5 },
    { id: 'north', x: 20, z: 0, width: 5, depth: 5 },
    { id: 'south', x: 20, z: 10, width: 5, depth: 5 },
  ];
  const connectionPlans = [
    {
      id: 'west_east_ground',
      level: 0,
      doorId: 'Door_Test_X',
      fromRoomId: 'west',
      toRoomId: 'east',
      bridgePath: Array.from({ length: 7 }, (_, index) => ({ x: index + 2, z: 0 })),
      fromSocket: { x: 2, z: 0, facingX: 1, facingZ: 0 },
      toSocket: { x: 8, z: 0, facingX: -1, facingZ: 0 },
    },
    {
      id: 'north_south_ground',
      level: 0,
      doorId: 'Door_Test_Z',
      fromRoomId: 'north',
      toRoomId: 'south',
      bridgePath: Array.from({ length: 7 }, (_, index) => ({ x: 20, z: index + 2 })),
      fromSocket: { x: 20, z: 2, facingX: 0, facingZ: 1 },
      toSocket: { x: 20, z: 8, facingX: 0, facingZ: -1 },
    },
  ];

  const reserved = generator._createFullHeightDoorVoidTileKeys(
    tiles,
    rooms,
    connectionPlans,
  );
  assert.deepEqual([...reserved].sort(), [...sourceKeys].sort());
  assert.equal(destinationKeys.some((key) => reserved.has(key)), false);
});

test('every level-zero supplemental vertical connector requires a bidirectional spine', () => {
  const generator = new DungeonGenerator();
  const validate = (traversalKind, includeReturnLink) => {
    const source = {
      x: 0,
      z: 0,
      elevation: 0,
      level: 0,
      roomId: 'sourceRoom',
      surface: 'connectorGalleryFloor',
    };
    const destination = {
      x: 2,
      z: 0,
      elevation: 14,
      level: 1,
      roomId: 'destinationRoom',
      surface: 'upperConnectionBridge',
    };
    const sourceFloorKey = generator._getFloorTileGraphKey(source);
    const destinationFloorKey = generator._getFloorTileGraphKey(destination);
    source.traversalLinks = [{
      id: `${traversalKind}:forward`,
      action: traversalKind,
      toFloorKey: destinationFloorKey,
    }];
    destination.traversalLinks = includeReturnLink ? [{
      id: `${traversalKind}:return`,
      action: traversalKind,
      toFloorKey: sourceFloorKey,
    }] : [];
    const connectionId = `supplement-${traversalKind}`;
    const result = generator._validatePlatformability({
      floorTiles: [source, destination],
      rooms: [
        {
          id: 'sourceRoom',
          type: 'supplement',
          x: 0,
          z: 0,
          width: 1,
          depth: 1,
          baseElevation: 0,
          isDungeonSupplement: true,
        },
        {
          id: 'destinationRoom',
          type: 'supplement',
          x: 2,
          z: 0,
          width: 1,
          depth: 1,
          baseElevation: 14,
          isDungeonSupplement: true,
        },
      ],
      connectionPlans: [{
        id: connectionId,
        level: 0,
        requiredForProgression: false,
        isDungeonSupplement: true,
        connectorVariantId: `fixture-${traversalKind}`,
        connectorVariant: { traversalKind },
        elevationDelta: 14,
        traversalFloorKeys: [sourceFloorKey, destinationFloorKey],
        bridgePath: [{ x: 0, z: 0 }, { x: 2, z: 0 }],
        fromRoomId: 'sourceRoom',
        toRoomId: 'destinationRoom',
        fromSocket: {
          id: `${connectionId}:source`,
          roomId: 'sourceRoom',
          connectorType: 'service',
          x: 0,
          z: 0,
          elevation: 0,
          floorKey: sourceFloorKey,
        },
        toSocket: {
          id: `${connectionId}:destination`,
          roomId: 'destinationRoom',
          connectorType: 'service',
          x: 2,
          z: 0,
          elevation: 14,
          floorKey: destinationFloorKey,
        },
      }],
    });
    return {
      result,
      check: result.details.connectorSpineChecks.find(({ connectionId: id }) => (
        id === connectionId
      )),
    };
  };

  for (const traversalKind of ['slope', 'ladder', 'automatic_lift']) {
    const oneWay = validate(traversalKind, false);
    assert.ok(oneWay.check, `${traversalKind} level-zero supplement was not validated`);
    assert.equal(oneWay.check.traversableOutward, true);
    assert.equal(oneWay.check.traversableReturn, false);
    assert.ok(oneWay.result.errors.some((error) => error.includes('return spine')));

    const bidirectional = validate(traversalKind, true);
    assert.ok(bidirectional.check, `${traversalKind} bidirectional check is missing`);
    assert.equal(bidirectional.check.accepted, true);
    assert.equal(bidirectional.check.traversableOutward, true);
    assert.equal(bidirectional.check.traversableReturn, true);
  }
});

test('even-width connector apertures reserve exactly their declared lane count', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const socket = {
    id: 'four-lane-socket',
    x: 4,
    z: 7,
    elevation: 0,
    facingX: 0,
    facingZ: 1,
    landingWidth: generator.tileSize * 4,
  };
  const lanes = generator._getConnectorEntranceLanes(socket, { x: 0, z: 1 });
  assert.equal(lanes.length, 4);
  assert.deepEqual(lanes.map(({ x }) => x), [2, 3, 4, 5]);

  const openings = generator._createConnectorWallOpeningMap([{
    id: 'four-lane-connection',
    elevation: 0,
    fromSocket: socket,
  }]);
  assert.equal([...openings.values()].flat().length, 4);
});

test('a V4 connector entrance rejects a wall in any lane of either two-tile approach', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const connectionId = 'supplement:test:strict-entrance';
  const floorTiles = [];
  for (let x = -1; x <= 5; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      floorTiles.push({
        x,
        z,
        elevation: 0,
        level: 0,
        roomId: x <= 1 ? 'hubTown' : x >= 3 ? 'supplement-room' : null,
        surface: 'roomFloor',
      });
    }
  }
  const floorKey = (x, z) => generator._getFloorTileGraphKey(
    floorTiles.find((tile) => tile.x === x && tile.z === z),
  );
  const fromSocket = {
    id: `${connectionId}:from`,
    roomId: 'hubTown',
    x: 1,
    z: 0,
    elevation: 0,
    facingX: 1,
    facingZ: 0,
    connectorType: 'ground_corridor',
    landingWidth: generator.tileSize * 3,
    clearanceHeight: 3.6,
    floorKey: floorKey(1, 0),
  };
  const toSocket = {
    id: `${connectionId}:to`,
    roomId: 'supplement-room',
    x: 3,
    z: 0,
    elevation: 0,
    facingX: -1,
    facingZ: 0,
    connectorType: 'ground_corridor',
    landingWidth: generator.tileSize * 3,
    clearanceHeight: 3.6,
    floorKey: floorKey(3, 0),
  };
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  const validation = generator._validateConnectorEntranceWalkability({
    floorTiles,
    rooms: [
      { id: 'hubTown', type: 'hub', x: 0, z: 0, width: 5, depth: 3, baseElevation: 0 },
      {
        id: 'supplement-room',
        type: 'supplement',
        x: 4,
        z: 0,
        width: 3,
        depth: 3,
        baseElevation: 0,
        isDungeonSupplement: true,
      },
    ],
    connectionPlans: [{
      id: connectionId,
      fromRoomId: 'hubTown',
      toRoomId: 'supplement-room',
      fromSocket,
      toSocket,
      elevation: 0,
      bridgePath: [{ x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }],
      isDungeonSupplement: true,
      isRouteNetworkConnection: true,
      augmentationOperationType: 'routeNetwork',
    }],
    wallRuns: [{
      facadeId: 'retained-center-lane-wall',
      horizontal: false,
      line: 1.5,
      start: 0,
      end: 0,
      wallBottomY: 0,
      wallTopY: 5.6,
    }],
    solidZones: [],
    segmentBarrierZones: [],
    useSegmentBarriers: true,
  });

  assert.equal(validation.accepted, false);
  const sourceCheck = validation.details.checks.find((check) => check.socketId === fromSocket.id);
  assert.equal(sourceCheck.strictApproachContract, true);
  assert.equal(sourceCheck.requiredLaneCount, 3);
  assert.equal(sourceCheck.requiredApproachDepthTiles, 2);
  assert.equal(sourceCheck.blockingWallFacadeId, 'retained-center-lane-wall');
  assert.match(validation.errors.join('\n'), /blocked by boundary wall/);
});

test('graph-only route records cannot carve physical wall openings', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const plan = {
    id: 'supplement:test:graph-only-wall-opening',
    fromSocket: {
      id: 'supplement:test:graph-only-wall-opening:from',
      x: 0,
      z: 0,
      elevation: 0,
      facingX: 0,
      facingZ: 1,
      landingWidth: generator.tileSize * 3,
      clearanceHeight: 3.6,
    },
    toSocket: {
      id: 'supplement:test:graph-only-wall-opening:to',
      x: 0,
      z: 2,
      elevation: 0,
      facingX: 0,
      facingZ: -1,
      landingWidth: generator.tileSize * 3,
      clearanceHeight: 3.6,
    },
    bridgePath: [{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 0, z: 2 }],
    isDungeonSupplement: true,
    isRouteNetworkConnection: true,
    isSupplementGraphConnection: true,
    connectorVariantConstraints: { graphOnly: true },
  };

  assert.equal(generator._createConnectorWallOpeningMap([plan]).size, 0);
  const physicalOpenings = generator._createConnectorWallOpeningMap([{
    ...plan,
    isSupplementGraphConnection: false,
    connectorVariantConstraints: {},
  }]);
  assert.ok(physicalOpenings.size > 0);
});

test('augmented door threshold wings carve a close adjacent connector aperture', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const group = new THREE.Group();
  const wallMaterial = new THREE.MeshBasicMaterial();
  const materials = {
    wallMacroTiles: { mm: wallMaterial },
    wallTrim: wallMaterial,
  };
  const adjacentPlan = {
    id: 'adjacent-connector-plan',
    elevation: 0,
    fromSocket: {
      id: 'adjacent-connector-socket',
      x: 4,
      z: 2,
      elevation: 0,
      facingX: 1,
      facingZ: 0,
      landingWidth: generator.tileSize * 3,
      clearanceHeight: PLAYER_TRAVERSAL_ENVELOPE.headClearance,
    },
  };
  const connectorWallOpenings = generator._createConnectorWallOpeningMap([adjacentPlan]);
  const solidZones = [];
  const seal = generator._addDoorThresholdSeal({
    group,
    descriptor: {
      id: 'Door_Test',
      to: { id: 'destination', x: 0, z: 0, width: 9, depth: 9 },
    },
    placement: { point: { x: 4, z: 0 }, alongX: true },
    position: new THREE.Vector3(generator.tileSize * 4.5, 0, 0),
    materials,
    solidZones,
    aerialBoundaryZones: [],
    preserveAdjacentConnectorEntrances: true,
    connectorWallOpenings,
    doorConnectionPlanId: 'door-plan',
  });
  const inside = { x: 4, z: 2, elevation: 0, level: 0 };
  const outside = { x: 5, z: 2, elevation: 0, level: 0 };
  const connectorCenterZ = adjacentPlan.fromSocket.z * generator.tileSize;

  assert.ok(seal.reservedConnectorApertureCount > 0);
  const apertureHeaders = seal.wallZones.filter((zone) => (
    Math.abs(connectorCenterZ - zone.position.z) <= zone.halfDepth
    && zone.position.y - zone.verticalHalfHeight > 0
  ));
  assert.ok(apertureHeaders.length > 0);
  assert.ok(apertureHeaders.every((zone) => (
    zone.position.y - zone.verticalHalfHeight
      >= PLAYER_TRAVERSAL_ENVELOPE.headClearance + 0.05
  )));
  assert.equal(
    seal.wallZones.some((zone) => generator._doesFloorTraversalSegmentIntersectZone(
      inside,
      outside,
      zone,
      PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
    )),
    false,
    'no threshold-wing segment may cross the registered adjacent connector mouth',
  );

  disposeDungeon({ group });
});

test('an elevated connector aperture removes the blocking lower sill envelope', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const group = new THREE.Group();
  const wallMaterial = new THREE.MeshBasicMaterial();
  const materials = {
    wallMacroTiles: { mm: wallMaterial },
    wallTrim: wallMaterial,
  };
  const connectorElevation = 5;
  const adjacentPlan = {
    id: 'elevated-adjacent-connector-plan',
    elevation: connectorElevation,
    fromSocket: {
      id: 'elevated-adjacent-connector-socket',
      x: 4,
      z: 2,
      elevation: connectorElevation,
      facingX: 1,
      facingZ: 0,
      landingWidth: generator.tileSize * 3,
      clearanceHeight: PLAYER_TRAVERSAL_ENVELOPE.headClearance,
    },
  };
  const connectorWallOpenings = generator._createConnectorWallOpeningMap([adjacentPlan]);
  const seal = generator._addDoorThresholdSeal({
    group,
    descriptor: {
      id: 'Door_Elevated_Test',
      to: { id: 'destination', x: 0, z: 0, width: 9, depth: 9 },
    },
    placement: { point: { x: 4, z: 0 }, alongX: true },
    position: new THREE.Vector3(generator.tileSize * 4.5, 0, 0),
    materials,
    solidZones: [],
    aerialBoundaryZones: [],
    preserveAdjacentConnectorEntrances: true,
    connectorWallOpenings,
    doorConnectionPlanId: 'door-plan',
  });
  const inside = { x: 4, z: 2, elevation: connectorElevation, level: 0 };
  const outside = { x: 5, z: 2, elevation: connectorElevation, level: 0 };

  assert.ok(seal.reservedConnectorApertureCount > 0);
  assert.equal(
    seal.wallZones.some((zone) => generator._doesFloorTraversalSegmentIntersectZone(
      inside,
      outside,
      zone,
      PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
    )),
    false,
    'no retained sill may overlap the grounded step envelope at an elevated connector mouth',
  );

  disposeDungeon({ group });
});

test('a different physical segment cannot carve through its own logical gate', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const group = new THREE.Group();
  const wallMaterial = new THREE.MeshBasicMaterial();
  const materials = {
    wallMacroTiles: { mm: wallMaterial },
    wallTrim: wallMaterial,
  };
  const logicalConnectionId = 'authored-gated-logical-edge';
  const supplementalPhysicalPlan = {
    id: 'supplement:gate:physical:segment',
    logicalConnectionId,
    elevation: 0,
    fromSocket: {
      id: 'supplement:gate:physical:socket',
      x: 4,
      z: 2,
      elevation: 0,
      facingX: 1,
      facingZ: 0,
      landingWidth: generator.tileSize * 3,
      clearanceHeight: PLAYER_TRAVERSAL_ENVELOPE.headClearance,
    },
  };
  const connectorWallOpenings = generator._createConnectorWallOpeningMap([
    supplementalPhysicalPlan,
  ]);
  const seal = generator._addDoorThresholdSeal({
    group,
    descriptor: {
      id: 'Door_Logical_Gate_Test',
      to: { id: 'destination', x: 0, z: 0, width: 9, depth: 9 },
    },
    placement: { point: { x: 4, z: 0 }, alongX: true },
    position: new THREE.Vector3(generator.tileSize * 4.5, 0, 0),
    materials,
    solidZones: [],
    aerialBoundaryZones: [],
    preserveAdjacentConnectorEntrances: true,
    connectorWallOpenings,
    doorConnectionPlanId: 'authored-gate-parent-physical',
    doorLogicalConnectionId: logicalConnectionId,
  });
  const inside = { x: 4, z: 2, elevation: 0, level: 0 };
  const outside = { x: 5, z: 2, elevation: 0, level: 0 };

  assert.equal(seal.reservedConnectorApertureCount, 0);
  assert.equal(seal.wallZones.length, 2);
  assert.ok(
    seal.wallZones.some((zone) => generator._doesFloorTraversalSegmentIntersectZone(
      inside,
      outside,
      zone,
      PLAYER_TRAVERSAL_ENVELOPE.collisionRadius,
    )),
    'a supplemental physical segment must not carve through its own logical gate',
  );

  disposeDungeon({ group });
});

test('a vertically separated supplement preserves an authored floor in the same X/Z column', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const authoredFloor = {
    x: 0,
    z: 0,
    type: 'hallway',
    surface: 'authoredLowerGallery',
    elevation: 0,
    level: 0,
    connectorId: 'authored-lower-connector',
    connectionId: 'authored-lower-connector',
  };
  const tiles = new Map([['0,0', authoredFloor]]);
  const path = [-2, -1, 0, 1, 2].map((x) => ({ x, z: 0 }));
  const plan = {
    id: 'supplement:fixture:optionalbranch:0:segment:0',
    logicalConnectionId: 'supplement:fixture:optionalbranch:0',
    fromRoomId: 'supplement-source',
    toRoomId: 'supplement-destination',
    level: 0,
    elevation: 14,
    sourceElevation: 14,
    destinationElevation: 14,
    elevationDelta: 0,
    fullPath: path,
    bridgePath: path,
    fromSocket: { id: 'supplement-source:exit', x: -2, z: 0, elevation: 14 },
    toSocket: { id: 'supplement-destination:entry', x: 2, z: 0, elevation: 14 },
    connectorVariantConstraints: { roomFootprints: [] },
    isDungeonSupplement: true,
    augmentationOperationId: 'supplement:fixture:optionalbranch:0:operation',
  };

  generator._stampConnectionPlans(tiles, [plan]);
  generator._addConnectorExplorationSpaces(tiles, [], [plan]);
  const floors = generator._applyConnectorTraversalSurfaces(
    tiles,
    [plan],
    [authoredFloor],
  );

  assert.equal(tiles.get('0,0'), authoredFloor);
  assert.equal(authoredFloor.elevation, 0);
  assert.equal(authoredFloor.connectorId, 'authored-lower-connector');
  assert.ok(floors.includes(authoredFloor));
  assert.ok(floors.some((floor) => (
    floor !== authoredFloor
    && floor.x === 0
    && floor.z === 0
    && Math.abs(Number(floor.elevation) - 14) <= EPSILON
    && floor.connectorId === plan.id
  )));
});

test('a same-elevation supplement cannot steal an unrelated authored floor owner', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const authoredFloor = {
    x: 0,
    z: 0,
    type: 'hallway',
    surface: 'authoredGallery',
    elevation: 0,
    level: 0,
    roomId: 'authored-unrelated-room',
    connectorId: 'authored-unrelated-connector',
    connectionId: 'authored-unrelated-connector',
  };
  const tiles = new Map([['0,0', authoredFloor]]);
  const plan = {
    id: 'supplement:test:foreign-floor-theft',
    fromRoomId: 'supplement-source',
    toRoomId: 'supplement-destination',
    level: 0,
    elevation: 0,
    sourceElevation: 0,
    destinationElevation: 0,
    elevationDelta: 0,
    fullPath: [
      { x: -2, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
    ],
    bridgePath: [
      { x: -2, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
    ],
    fromSocket: {
      id: 'supplement-source:exit',
      roomId: 'supplement-source',
      x: -2,
      z: 0,
      elevation: 0,
      facingX: 1,
      facingZ: 0,
    },
    toSocket: {
      id: 'supplement-destination:entry',
      roomId: 'supplement-destination',
      x: 2,
      z: 0,
      elevation: 0,
      facingX: -1,
      facingZ: 0,
    },
    isDungeonSupplement: true,
    augmentationOperationId: 'supplement:test:foreign-floor-theft:operation',
  };

  assert.throws(
    () => generator._stampConnectionPlans(tiles, [plan]),
    (error) => error?.code === 'DUNGEON_AUGMENTATION_FOREIGN_FLOOR_OWNERSHIP',
  );
  assert.equal(tiles.size, 1, 'the plan must be preflighted before any floor is stamped');
  assert.equal(tiles.get('0,0'), authoredFloor);
  assert.equal(authoredFloor.roomId, 'authored-unrelated-room');
  assert.equal(authoredFloor.connectorId, 'authored-unrelated-connector');
  assert.equal(authoredFloor.surface, 'authoredGallery');

  const exactThresholdFloor = {
    x: -2,
    z: 0,
    type: 'floor',
    surface: 'authoredRoomFloor',
    elevation: 0,
    level: 0,
    roomId: 'supplement-source',
  };
  const exactThresholdTiles = new Map([['-2,0', exactThresholdFloor]]);
  generator._stampConnectionPlans(exactThresholdTiles, [{
    ...plan,
    fullPath: [{ x: -2, z: 0 }, { x: -1, z: 0 }],
    bridgePath: [{ x: -2, z: 0 }, { x: -1, z: 0 }],
  }]);
  assert.equal(exactThresholdFloor.roomId, 'supplement-source');
  assert.equal(exactThresholdFloor.connectorId, plan.id);
});

test('rejected generation candidates do not dispose generator-cached textures', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));
  generator.textureCache.set('candidate-shared-texture', texture);
  let textureDisposals = 0;
  let materialDisposals = 0;
  let geometryDisposals = 0;
  texture.addEventListener('dispose', () => { textureDisposals += 1; });
  material.addEventListener('dispose', () => { materialDisposals += 1; });
  geometry.addEventListener('dispose', () => { geometryDisposals += 1; });

  generator._disposeGeneratedDungeonCandidate({ group });

  assert.equal(group.userData.generationCandidateDisposed, true);
  assert.equal(textureDisposals, 0);
  assert.equal(materialDisposals, 1);
  assert.equal(geometryDisposals, 1);
  texture.dispose();
});

test('effective augmentation validation includes theme-fragment collision zones', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const baseZone = {
    id: 'authored-solid',
    position: new THREE.Vector3(-20, 1, -20),
    halfWidth: 1,
    halfDepth: 1,
    verticalHalfHeight: 1,
  };
  const themeFragmentZone = {
    id: 'theme-fragment-solid',
    position: new THREE.Vector3(0, 1, generator.tileSize * 0.5),
    halfWidth: generator.tileSize * 0.45,
    halfDepth: 0.08,
    verticalHalfHeight: 1,
  };
  const baseSolidZones = [baseZone];
  const fragment = { solidZones: [themeFragmentZone] };

  const effectiveSolidZones = generator._createDungeonAugmentationValidationSolidZones(
    baseSolidZones,
    fragment,
    true,
  );

  assert.notEqual(effectiveSolidZones, baseSolidZones);
  assert.deepEqual(effectiveSolidZones, [baseZone, themeFragmentZone]);
  assert.deepEqual(baseSolidZones, [baseZone], 'combining collision must not mutate the base facade');
  assert.equal(
    generator._createDungeonAugmentationValidationSolidZones(
      baseSolidZones,
      fragment,
      false,
    ),
    baseSolidZones,
    'the augmentation-disabled path must retain the legacy collision array identity',
  );
});

test('barrier-aware platformability rejects a thin wall between adjacent walkable tiles', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const floorTiles = [
    {
      x: 0,
      z: 0,
      elevation: 0,
      level: 0,
      roomId: 'hubTown',
      surface: 'roomFloor',
    },
    {
      x: 0,
      z: 1,
      elevation: 0,
      level: 0,
      roomId: 'supplement-room',
      surface: 'roomFloor',
    },
  ];
  const rooms = [
    {
      id: 'hubTown',
      type: 'supplement',
      x: 0,
      z: 0,
      width: 1,
      depth: 1,
      baseElevation: 0,
      isDungeonSupplement: true,
    },
    {
      id: 'supplement-room',
      type: 'supplement',
      x: 0,
      z: 1,
      width: 1,
      depth: 1,
      baseElevation: 0,
      isDungeonSupplement: true,
    },
  ];
  const thinWall = {
    id: 'thin-wall-between-tile-centers',
    position: new THREE.Vector3(0, 1, generator.tileSize * 0.5),
    halfWidth: generator.tileSize * 0.45,
    halfDepth: 0.08,
    verticalHalfHeight: 1,
  };
  const specification = {
    floorTiles,
    rooms,
    solidZones: [thinWall],
    connectionPlans: [],
    doors: [],
    landmarks: {},
    encounters: [],
  };

  const legacyPointOnlyValidation = generator._validatePlatformability(specification);
  const barrierAwareValidation = generator._validatePlatformability({
    ...specification,
    useSegmentBarriers: true,
  });

  assert.equal(legacyPointOnlyValidation.accepted, true);
  assert.equal(barrierAwareValidation.accepted, false);
  assert.equal(barrierAwareValidation.details.segmentBarriersValidated, true);
  assert.match(barrierAwareValidation.errors.join('\n'), /solid barrier|platformably reachable floor/);
});

test('graph-only supplement links cannot make an orphaned realized corridor pass platformability', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const physicalConnectionId = 'supplement:test:route-network:physical';
  const graphConnectionId = 'supplement:test:route-network:graph-only';
  const hubFloor = {
    x: 0,
    z: 0,
    elevation: 0,
    level: 0,
    roomId: 'hubTown',
    surface: 'roomFloor',
    connectorId: physicalConnectionId,
    connectionId: physicalConnectionId,
  };
  const orphanFloor = {
    x: 2,
    z: 0,
    elevation: 0,
    level: 0,
    roomId: 'supplement-room',
    surface: 'roomFloor',
    connectorId: physicalConnectionId,
    connectionId: physicalConnectionId,
    signedConnectorFloorOwnerId: physicalConnectionId,
  };
  const fromSocket = {
    id: `${physicalConnectionId}:from`,
    roomId: 'hubTown',
    x: 0,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(hubFloor),
  };
  const toSocket = {
    id: `${physicalConnectionId}:to`,
    roomId: 'supplement-room',
    x: 2,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(orphanFloor),
  };
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  const physicalPlan = {
    id: physicalConnectionId,
    fromRoomId: 'hubTown',
    toRoomId: 'supplement-room',
    fromSocket,
    toSocket,
    level: 0,
    elevation: 0,
    elevationDelta: 0,
    bridgePath: [{ x: 0, z: 0 }, { x: 2, z: 0 }],
    traversalFloorKeys: [fromSocket.floorKey, toSocket.floorKey],
    isDungeonSupplement: true,
    isRouteNetworkConnection: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'supplement:test:route-network',
    connectorVariantConstraints: {},
  };
  const graphOnlyPlan = {
    ...physicalPlan,
    id: graphConnectionId,
    isSupplementGraphConnection: true,
    connectorVariantConstraints: { graphOnly: true },
  };
  const validation = generator._validatePlatformability({
    floorTiles: [hubFloor, orphanFloor],
    rooms: [
      { id: 'hubTown', type: 'hub', x: 0, z: 0, width: 1, depth: 1, baseElevation: 0 },
      {
        id: 'supplement-room',
        type: 'supplement',
        x: 2,
        z: 0,
        width: 1,
        depth: 1,
        baseElevation: 0,
        isDungeonSupplement: true,
      },
    ],
    solidZones: [],
    connectionPlans: [physicalPlan, graphOnlyPlan],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });

  assert.equal(validation.accepted, false);
  assert.equal(validation.details.supplementConnectivityChecks.length, 1);
  assert.equal(validation.details.supplementConnectivityChecks[0].accepted, false);
  assert.equal(validation.details.supplementRoomConnectivityChecks.length, 1);
  assert.equal(validation.details.supplementRoomConnectivityChecks[0].accepted, false);
  assert.ok(validation.details.orphanSupplementFloorCount > 0);
  assert.match(validation.errors.join('\n'), /orphaned|no traversable spine/);
});

test('every strict supplemental connector floor belongs to its bidirectional local spine', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const connectionId = 'supplement:test:local-spine-ownership';
  const floor = (x, roomId = null, owned = false) => ({
    x,
    z: 0,
    elevation: 0,
    level: 0,
    roomId,
    surface: 'connectorGalleryFloor',
    ...(owned ? {
      connectorId: connectionId,
      connectionId,
      signedConnectorFloorOwnerId: connectionId,
    } : {}),
  });
  const hubFloor = floor(0, 'hubTown', true);
  const supplementFloor = floor(1, 'supplement-room', true);
  const unrelatedBridgeFloor = floor(2, null, false);
  const strayOwnedFloor = floor(3, null, true);
  const fromSocket = {
    id: `${connectionId}:from`,
    roomId: 'hubTown',
    x: 0,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(hubFloor),
  };
  const toSocket = {
    id: `${connectionId}:to`,
    roomId: 'supplement-room',
    x: 1,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(supplementFloor),
  };
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  const plan = {
    id: connectionId,
    fromRoomId: 'hubTown',
    toRoomId: 'supplement-room',
    fromSocket,
    toSocket,
    level: 0,
    elevation: 0,
    sourceElevation: 0,
    destinationElevation: 0,
    elevationDelta: 0,
    bridgePath: [{ x: 0, z: 0 }, { x: 1, z: 0 }],
    traversalFloorKeys: [
      fromSocket.floorKey,
      toSocket.floorKey,
      generator._getFloorTileGraphKey(strayOwnedFloor),
    ],
    isDungeonSupplement: true,
    isRouteNetworkConnection: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'supplement:test:local-spine-operation',
    connectorVariantConstraints: {},
  };

  const validation = generator._validatePlatformability({
    floorTiles: [hubFloor, supplementFloor, unrelatedBridgeFloor, strayOwnedFloor],
    rooms: [
      { id: 'hubTown', type: 'hub', x: 0, z: 0, width: 1, depth: 1, baseElevation: 0 },
      {
        id: 'supplement-room',
        type: 'supplement',
        x: 1,
        z: 0,
        width: 1,
        depth: 1,
        baseElevation: 0,
        isDungeonSupplement: true,
        augmentationOperationType: 'routeNetwork',
      },
    ],
    solidZones: [],
    connectionPlans: [plan],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });

  const connectorCheck = validation.details.connectorSpineChecks[0];
  const supplementCheck = validation.details.supplementConnectivityChecks[0];
  const strayFloorKey = generator._getFloorTileGraphKey(strayOwnedFloor);
  assert.equal(validation.accepted, false);
  assert.equal(connectorCheck.strictLocalComponentAccepted, false);
  assert.ok(connectorCheck.locallyUnreachableTraversalFloorKeys.includes(strayFloorKey));
  assert.ok(connectorCheck.locallyNonReturnableTraversalFloorKeys.includes(strayFloorKey));
  assert.equal(supplementCheck.accepted, false);
  assert.match(validation.errors.join('\n'), /outside its source-side connector component/);
});

test('an unrelated overhead route cannot satisfy an unmaterialized supplemental room', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const connectionId = 'supplement:test:overhead-false-positive';
  const hubFloor = {
    x: 0,
    z: 0,
    elevation: 14,
    level: 1,
    roomId: 'hubTown',
    surface: 'upperConnectionBridge',
    connectorId: connectionId,
    connectionId,
    signedConnectorFloorOwnerId: connectionId,
  };
  const unrelatedOverheadFloor = {
    x: 1,
    z: 0,
    elevation: 14,
    level: 1,
    roomId: 'unrelated-overhead-route',
    surface: 'upperConnectionBridge',
    connectorId: connectionId,
    connectionId,
    signedConnectorFloorOwnerId: connectionId,
  };
  const fromSocket = {
    id: `${connectionId}:from`,
    roomId: 'hubTown',
    x: 0,
    z: 0,
    elevation: 14,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(hubFloor),
  };
  const toSocket = {
    id: `${connectionId}:to`,
    roomId: 'supplement-underpass',
    x: 1,
    z: 0,
    elevation: 14,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(unrelatedOverheadFloor),
  };
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  const connectionPlan = {
    id: connectionId,
    fromRoomId: 'hubTown',
    toRoomId: 'supplement-underpass',
    fromSocket,
    toSocket,
    level: 0,
    elevation: 14,
    sourceElevation: 14,
    destinationElevation: 14,
    elevationDelta: 0,
    bridgePath: [{ x: 0, z: 0 }, { x: 1, z: 0 }],
    traversalFloorKeys: [fromSocket.floorKey, toSocket.floorKey],
    isDungeonSupplement: true,
    isRouteNetworkConnection: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'supplement:test:overhead-operation',
    connectorVariantConstraints: {},
  };

  const validation = generator._validatePlatformability({
    floorTiles: [hubFloor, unrelatedOverheadFloor],
    rooms: [
      {
        id: 'hubTown',
        type: 'supplement',
        x: 0,
        z: 0,
        width: 1,
        depth: 1,
        baseElevation: 14,
        isDungeonSupplement: true,
      },
      {
        id: 'supplement-underpass',
        type: 'supplement',
        x: 1,
        z: 0,
        width: 1,
        depth: 1,
        baseElevation: 0,
        isDungeonSupplement: true,
      },
    ],
    solidZones: [],
    connectionPlans: [connectionPlan],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });

  const underpassCheck = validation.details.supplementRoomConnectivityChecks.find((check) => (
    check.roomId === 'supplement-underpass'
  ));
  assert.equal(validation.accepted, false);
  assert.ok(underpassCheck);
  assert.equal(underpassCheck.realizedRoomOwnedFloorCount, 0);
  assert.equal(underpassCheck.accepted, false);
  assert.match(validation.errors.join('\n'), /no supplemental floor reachable/);
});

test('a legacy declared 15x13 supplement preserves its complete replay footprint', () => {
  const validate = ({ oneOwnedFloor = false } = {}) => {
    const generator = new DungeonGenerator({ random: () => 0.5 });
    const connectionId = `supplement:test:partial-room-${oneOwnedFloor ? 'one-floor' : 'strip'}`;
    const operationId = `${connectionId}:operation`;
    const hubFloor = {
      x: -8,
      z: 0,
      elevation: 0,
      level: 0,
      roomId: 'hubTown',
      surface: 'roomFloor',
      connectorId: connectionId,
      connectionId,
      signedConnectorFloorOwnerId: connectionId,
    };
    const survivingRoomFloors = (oneOwnedFloor
      ? [0]
      : Array.from({ length: 13 }, (_, index) => index - 6)
    ).map((z) => ({
      x: -7,
      z,
      elevation: 0,
      level: 0,
      roomId: 'partial-supplement-room',
      surface: 'roomFloor',
    }));
    const approachFloor = survivingRoomFloors.find((floor) => floor.z === 0);
    approachFloor.connectorId = connectionId;
    approachFloor.connectionId = connectionId;
    approachFloor.signedConnectorFloorOwnerId = connectionId;
    const fromSocket = {
      id: `${connectionId}:from`,
      roomId: 'hubTown',
      x: hubFloor.x,
      z: hubFloor.z,
      elevation: 0,
      connectorType: 'ground_corridor',
      floorKey: generator._getFloorTileGraphKey(hubFloor),
    };
    const toSocket = {
      id: `${connectionId}:to`,
      roomId: 'partial-supplement-room',
      x: approachFloor.x,
      z: approachFloor.z,
      elevation: 0,
      connectorType: 'ground_corridor',
      floorKey: generator._getFloorTileGraphKey(approachFloor),
    };
    fromSocket.matchingSocketId = toSocket.id;
    toSocket.matchingSocketId = fromSocket.id;
    const connectionPlan = {
      id: connectionId,
      fromRoomId: 'hubTown',
      toRoomId: 'partial-supplement-room',
      fromSocket,
      toSocket,
      level: 0,
      elevation: 0,
      sourceElevation: 0,
      destinationElevation: 0,
      elevationDelta: 0,
      bridgePath: [
        { x: hubFloor.x, z: hubFloor.z, elevation: 0 },
        { x: approachFloor.x, z: approachFloor.z, elevation: 0 },
      ],
      traversalFloorKeys: [fromSocket.floorKey, toSocket.floorKey],
      isDungeonSupplement: true,
      isRouteNetworkConnection: true,
      augmentationOperationType: 'routeNetwork',
      augmentationOperationId: operationId,
      connectorVariantConstraints: {},
    };

    const validation = generator._validatePlatformability({
      floorTiles: [hubFloor, ...survivingRoomFloors],
      rooms: [
        { id: 'hubTown', type: 'hub', x: -8, z: 0, width: 1, depth: 1, baseElevation: 0 },
        {
          id: 'partial-supplement-room',
          type: 'supplement',
          x: 0,
          z: 0,
          width: 15,
          depth: 13,
          baseElevation: 0,
          isDungeonSupplement: true,
          augmentationOperationType: 'routeNetwork',
          augmentationOperationId: operationId,
        },
      ],
      solidZones: [],
      connectionPlans: [connectionPlan],
      doors: [],
      landmarks: {},
      encounters: [],
      useSegmentBarriers: true,
    });

    return { validation, oneOwnedFloor };
  };

  for (const fixture of [validate(), validate({ oneOwnedFloor: true })]) {
    const roomCheck = fixture.validation.details.supplementRoomConnectivityChecks.find((check) => (
      check.roomId === 'partial-supplement-room'
    ));
    assert.ok(roomCheck);
    assert.equal(
      fixture.validation.details.supplementConnectivityChecks[0].accepted,
      true,
      'the physical connector fixture should remain valid',
    );
    assert.equal(roomCheck.meetsSubstantiveRoomFootprint, true);
    assert.equal(roomCheck.expectedBaseFootprintFloorCount, 15 * 13);
    assert.equal(roomCheck.realizedBaseFootprintFloorCount, fixture.oneOwnedFloor ? 1 : 13);
    assert.equal(roomCheck.missingBaseFootprintColumnKeys.length, fixture.oneOwnedFloor ? 194 : 182);
    assert.equal(roomCheck.baseFootprintCoverageAccepted, false);
    assert.equal(roomCheck.accepted, false);
    assert.equal(fixture.validation.accepted, false);
    assert.match(
      fixture.validation.errors.join('\n'),
      /does not physically realize its complete 195-tile declared base-floor footprint/,
    );
  }
});

test('V4 platformability consumes authoritative realized floor cells instead of re-parsing a stale mask', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const connectionId = 'supplement:test:authoritative-floor-cells';
  const operationId = `${connectionId}:operation`;
  const floor = (x, roomId) => ({
    x,
    z: 0,
    elevation: 0,
    level: 0,
    roomId,
    surface: 'roomFloor',
  });
  const hubFloor = floor(0, 'hubTown');
  const roomFloors = [1, 2, 3].map((x) => floor(x, 'authoritative-room'));
  const approachFloor = roomFloors[0];
  for (const entry of [hubFloor, approachFloor]) {
    entry.connectorId = connectionId;
    entry.connectionId = connectionId;
    entry.signedConnectorFloorOwnerId = connectionId;
  }
  const fromSocket = {
    id: `${connectionId}:from`,
    roomId: 'hubTown',
    x: 0,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(hubFloor),
  };
  const toSocket = {
    id: `${connectionId}:to`,
    roomId: 'authoritative-room',
    x: 1,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(approachFloor),
  };
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  const plan = {
    id: connectionId,
    fromRoomId: 'hubTown',
    toRoomId: 'authoritative-room',
    fromSocket,
    toSocket,
    level: 0,
    elevation: 0,
    sourceElevation: 0,
    destinationElevation: 0,
    elevationDelta: 0,
    bridgePath: [{ x: 0, z: 0 }, { x: 1, z: 0 }],
    traversalFloorKeys: [fromSocket.floorKey, toSocket.floorKey],
    isDungeonSupplement: true,
    isRouteNetworkConnection: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: operationId,
    connectorVariantConstraints: {},
  };
  const authoritativeTierRuntimeId = 'authoritative-room:floor-tier:base';
  const validation = generator._validatePlatformability({
    floorTiles: [hubFloor, ...roomFloors],
    rooms: [
      { id: 'hubTown', type: 'hub', x: 0, z: 0, width: 1, depth: 1, baseElevation: 0 },
      {
        id: 'authoritative-room',
        type: 'supplement',
        x: 2,
        z: 0,
        width: 3,
        depth: 1,
        baseElevation: 0,
        isDungeonSupplement: true,
        augmentationOperationType: 'routeNetwork',
        augmentationOperationId: operationId,
        augmentationModuleKind: 'room',
        augmentationModuleManifest: { id: 'authoritative-test-manifest' },
        // Deliberately stale metadata: the immutable realization below is the
        // only physical source of truth and describes all three room cells.
        augmentationFloorMask: ['#'],
        augmentationFloorTiers: [{
          id: 'base',
          runtimeId: authoritativeTierRuntimeId,
          localElevation: 0,
          worldElevation: 0,
          authoritative: true,
          worldCells: roomFloors.map((entry, index) => ({
            id: `${authoritativeTierRuntimeId}:cell:${index}`,
            grid: { x: entry.x, z: entry.z },
            elevation: 0,
          })),
        }],
      },
    ],
    solidZones: [],
    connectionPlans: [plan],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });

  const roomCheck = validation.details.supplementRoomConnectivityChecks.find((check) => (
    check.roomId === 'authoritative-room'
  ));
  assert.equal(validation.accepted, true, validation.errors.join('\n'));
  assert.ok(roomCheck);
  assert.equal(roomCheck.usesAuthoredFloorMask, true);
  assert.equal(roomCheck.expectedBaseFootprintFloorCount, 3);
  assert.equal(roomCheck.realizedBaseFootprintFloorCount, 3);
  assert.deepEqual(roomCheck.missingBaseFootprintColumnKeys, []);
  assert.equal(roomCheck.baseFootprintCoverageAccepted, true);
});

test('true supplemental rooms reject exterior platform floors and blocked elevated ramps', () => {
  const validate = ({ exteriorPlatform = false, blockedRamp = false } = {}) => {
    const generator = new DungeonGenerator({ random: () => 0.5 });
    const connectionId = `supplement:test:owned-floor-envelope:${exteriorPlatform ? 'exterior' : 'blocked'}`;
    const operationId = `${connectionId}:operation`;
    const hubFloor = {
      x: -8,
      z: 0,
      elevation: 0,
      level: 0,
      roomId: 'hubTown',
      surface: 'roomFloor',
      connectorId: connectionId,
      connectionId,
      signedConnectorFloorOwnerId: connectionId,
    };
    const roomFloors = [];
    for (let x = -7; x <= 7; x += 1) {
      for (let z = -6; z <= 6; z += 1) {
        roomFloors.push({
          x,
          z,
          elevation: 0,
          level: 0,
          roomId: 'owned-floor-envelope-room',
          surface: 'roomFloor',
        });
      }
    }
    const approachFloor = roomFloors.find((floor) => floor.x === -7 && floor.z === 0);
    approachFloor.connectorId = connectionId;
    approachFloor.connectionId = connectionId;
    approachFloor.signedConnectorFloorOwnerId = connectionId;
    const extraFloor = exteriorPlatform ? {
      x: 8,
      z: 0,
      elevation: 1,
      level: 0.1,
      roomId: 'owned-floor-envelope-room',
      surface: 'upperConnectionBridge',
      isPlatformingSurface: true,
    } : {
      x: 0,
      z: 0,
      elevation: 1.4,
      level: 0.1,
      roomId: 'owned-floor-envelope-room',
      surface: 'industrialRamp',
      isPlatformingSurface: true,
      rampStartElevation: 0,
      rampEndElevation: 2.8,
      rampDirectionX: 1,
      rampDirectionZ: 0,
    };
    const fromSocket = {
      id: `${connectionId}:from`,
      roomId: 'hubTown',
      x: hubFloor.x,
      z: hubFloor.z,
      elevation: 0,
      facingX: 1,
      facingZ: 0,
      connectorType: 'ground_corridor',
      floorKey: generator._getFloorTileGraphKey(hubFloor),
    };
    const toSocket = {
      id: `${connectionId}:to`,
      roomId: 'owned-floor-envelope-room',
      x: approachFloor.x,
      z: approachFloor.z,
      elevation: 0,
      facingX: -1,
      facingZ: 0,
      connectorType: 'ground_corridor',
      floorKey: generator._getFloorTileGraphKey(approachFloor),
    };
    fromSocket.matchingSocketId = toSocket.id;
    toSocket.matchingSocketId = fromSocket.id;
    const plan = {
      id: connectionId,
      fromRoomId: 'hubTown',
      toRoomId: 'owned-floor-envelope-room',
      fromSocket,
      toSocket,
      level: 0,
      elevation: 0,
      sourceElevation: 0,
      destinationElevation: 0,
      elevationDelta: 0,
      bridgePath: [
        { x: hubFloor.x, z: hubFloor.z, elevation: 0 },
        { x: approachFloor.x, z: approachFloor.z, elevation: 0 },
      ],
      traversalFloorKeys: [fromSocket.floorKey, toSocket.floorKey],
      isDungeonSupplement: true,
      isRouteNetworkConnection: true,
      augmentationOperationType: 'routeNetwork',
      augmentationOperationId: operationId,
      connectorVariantConstraints: {},
    };
    const solidZones = blockedRamp ? [{
      id: 'blocked-supplement-ramp-solid',
      position: new THREE.Vector3(0, 1.4, 0),
      halfWidth: generator.tileSize * 0.45,
      halfDepth: generator.tileSize * 0.45,
      verticalHalfHeight: 0.5,
    }] : [];
    return generator._validatePlatformability({
      floorTiles: [hubFloor, ...roomFloors, extraFloor],
      rooms: [
        { id: 'hubTown', type: 'hub', x: -8, z: 0, width: 1, depth: 1, baseElevation: 0 },
        {
          id: 'owned-floor-envelope-room',
          type: 'supplement',
          x: 0,
          z: 0,
          width: 15,
          depth: 13,
          baseElevation: 0,
          isDungeonSupplement: true,
          augmentationOperationType: 'routeNetwork',
          augmentationOperationId: operationId,
        },
      ],
      solidZones,
      connectionPlans: [plan],
      doors: [],
      landmarks: {},
      encounters: [],
      useSegmentBarriers: true,
    });
  };

  const exterior = validate({ exteriorPlatform: true });
  const exteriorCheck = exterior.details.supplementRoomConnectivityChecks[0];
  assert.equal(exterior.accepted, false);
  assert.deepEqual(
    exteriorCheck.outsideDeclaredRoomFloorKeys,
    ['8,0@y1.000'],
  );
  assert.match(exterior.errors.join('\n'), /outside its declared footprint and exact connector thresholds/);

  const blocked = validate({ blockedRamp: true });
  const blockedCheck = blocked.details.supplementRoomConnectivityChecks[0];
  assert.equal(blocked.accepted, false);
  assert.ok(blockedCheck.nonNavigableRoomFloorKeys.includes('0,0@y1.400'));
  assert.ok(blocked.details.blockedSupplementFloorKeys.includes('0,0@y1.400'));
  assert.match(blocked.errors.join('\n'), /blocked room-owned floor/);
});

test('a lower owned floor cannot realize a supplemental centerline planned at another elevation', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const connectionId = 'supplement:test:elevation-exact-centerline';
  const ownedFloor = (x, roomId = null) => ({
    x,
    z: 0,
    elevation: 0,
    level: 0,
    roomId,
    surface: 'connectorGalleryFloor',
    connectorId: connectionId,
    connectionId,
    signedConnectorFloorOwnerId: connectionId,
  });
  const hubFloor = ownedFloor(0, 'hubTown');
  const lowerMiddleFloor = ownedFloor(1, null);
  const supplementFloor = ownedFloor(2, 'supplement-room');
  const fromSocket = {
    id: `${connectionId}:from`,
    roomId: 'hubTown',
    x: 0,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(hubFloor),
  };
  const toSocket = {
    id: `${connectionId}:to`,
    roomId: 'supplement-room',
    x: 2,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(supplementFloor),
  };
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  const plan = {
    id: connectionId,
    fromRoomId: 'hubTown',
    toRoomId: 'supplement-room',
    fromSocket,
    toSocket,
    level: 0,
    elevation: 0,
    sourceElevation: 0,
    destinationElevation: 0,
    elevationDelta: 0,
    bridgePath: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }],
    traversalFloorKeys: [
      fromSocket.floorKey,
      generator._getFloorTileGraphKey(lowerMiddleFloor),
      toSocket.floorKey,
    ],
    galleryCrossSections: [{
      pathIndex: 1,
      sections: [{ elevation: 14 }],
    }],
    isDungeonSupplement: true,
    isRouteNetworkConnection: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'supplement:test:elevation-exact-operation',
    connectorVariantConstraints: {},
  };

  const validation = generator._validatePlatformability({
    floorTiles: [hubFloor, lowerMiddleFloor, supplementFloor],
    rooms: [
      { id: 'hubTown', type: 'hub', x: 0, z: 0, width: 1, depth: 1, baseElevation: 0 },
      {
        id: 'supplement-room',
        type: 'supplement',
        x: 2,
        z: 0,
        width: 1,
        depth: 1,
        baseElevation: 0,
        isDungeonSupplement: true,
        augmentationOperationType: 'routeNetwork',
      },
    ],
    solidZones: [],
    connectionPlans: [plan],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });

  const centerlineCheck = validation.details.supplementConnectivityChecks[0]
    .centerlineChecks[1];
  assert.equal(validation.accepted, false);
  assert.equal(centerlineCheck.expectedElevation, 14);
  assert.deepEqual(centerlineCheck.expectedElevations, [14]);
  assert.equal(centerlineCheck.floorKey, null);
  assert.equal(centerlineCheck.elevationMatchesExpected, false);
  assert.match(validation.errors.join('\n'), /centerline point/);
});

test('a local traversal proof cannot be seeded by a floor outside its owned tile set', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const unrelatedOverpass = {
    x: 4,
    z: 7,
    elevation: 14,
    level: 1,
    roomId: 'unrelated-overpass',
    surface: 'upperConnectionBridge',
  };
  const localUnderpassFloor = {
    x: 4,
    z: 7,
    elevation: 0,
    level: 0,
    roomId: 'supplement-underpass',
    surface: 'roomFloor',
  };

  const reachable = generator._createReachableFloorTileKeySet(
    unrelatedOverpass,
    [localUnderpassFloor],
  );

  assert.equal(reachable.size, 0);
});

test('a route-network room with only a graph record has no physical connector', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const hubFloor = {
    x: 0,
    z: 0,
    elevation: 0,
    level: 0,
    roomId: 'hubTown',
    surface: 'roomFloor',
  };
  const supplementFloor = {
    x: 1,
    z: 0,
    elevation: 0,
    level: 0,
    roomId: 'supplement-graph-only-room',
    surface: 'roomFloor',
  };
  const graphConnectionId = 'supplement:test:graph-record-only';
  const fromSocket = {
    id: `${graphConnectionId}:from`,
    roomId: 'hubTown',
    x: 0,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(hubFloor),
  };
  const toSocket = {
    id: `${graphConnectionId}:to`,
    roomId: 'supplement-graph-only-room',
    x: 1,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(supplementFloor),
  };
  const validation = generator._validatePlatformability({
    floorTiles: [hubFloor, supplementFloor],
    rooms: [
      {
        id: 'hubTown',
        type: 'supplement',
        x: 0,
        z: 0,
        width: 1,
        depth: 1,
        baseElevation: 0,
        isDungeonSupplement: true,
      },
      {
        id: 'supplement-graph-only-room',
        type: 'supplement',
        x: 1,
        z: 0,
        width: 1,
        depth: 1,
        baseElevation: 0,
        isDungeonSupplement: true,
        augmentationOperationType: 'routeNetwork',
      },
    ],
    solidZones: [],
    connectionPlans: [{
      id: graphConnectionId,
      fromRoomId: 'hubTown',
      toRoomId: 'supplement-graph-only-room',
      fromSocket,
      toSocket,
      isDungeonSupplement: true,
      isRouteNetworkConnection: true,
      isSupplementGraphConnection: true,
      augmentationOperationType: 'routeNetwork',
      connectorVariantConstraints: { graphOnly: true },
    }],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });

  const roomCheck = validation.details.supplementRoomConnectivityChecks.find((check) => (
    check.roomId === 'supplement-graph-only-room'
  ));
  assert.equal(validation.accepted, false);
  assert.ok(roomCheck);
  assert.deepEqual(roomCheck.attachedPhysicalConnectionIds, []);
  assert.equal(roomCheck.accepted, false);
  assert.match(validation.errors.join('\n'), /no exact, physically assembled supplemental connector/);
});

test('a degree-two supplemental room must connect its approaches through one local component', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const floor = (x, z, roomId = null) => ({
    x,
    z,
    elevation: 0,
    level: 0,
    roomId,
    surface: 'roomFloor',
  });
  const hubFloor = floor(0, 0, 'hubTown');
  const leftFloor = floor(1, 0, 'split-supplement-room');
  const centerFloor = floor(2, 0, 'split-supplement-room');
  const rightFloor = floor(3, 0, 'split-supplement-room');
  const alternateRoute = [
    floor(0, 1),
    floor(1, 1),
    floor(2, 1),
    floor(3, 1, 'alternateRouteRoom'),
  ];
  const makePlan = ({ id, fromRoomId, toRoomId, fromFloor, toFloor }) => {
    fromFloor.connectorId = id;
    fromFloor.connectionId = id;
    fromFloor.signedConnectorFloorOwnerId = id;
    toFloor.connectorId = id;
    toFloor.connectionId = id;
    toFloor.signedConnectorFloorOwnerId = id;
    const fromSocket = {
      id: `${id}:from`,
      roomId: fromRoomId,
      x: fromFloor.x,
      z: fromFloor.z,
      elevation: 0,
      connectorType: 'ground_corridor',
      floorKey: generator._getFloorTileGraphKey(fromFloor),
    };
    const toSocket = {
      id: `${id}:to`,
      roomId: toRoomId,
      x: toFloor.x,
      z: toFloor.z,
      elevation: 0,
      connectorType: 'ground_corridor',
      floorKey: generator._getFloorTileGraphKey(toFloor),
    };
    fromSocket.matchingSocketId = toSocket.id;
    toSocket.matchingSocketId = fromSocket.id;
    return {
      id,
      fromRoomId,
      toRoomId,
      fromSocket,
      toSocket,
      level: 0,
      elevation: 0,
      sourceElevation: 0,
      destinationElevation: 0,
      elevationDelta: 0,
      bridgePath: [
        { x: fromFloor.x, z: fromFloor.z },
        { x: toFloor.x, z: toFloor.z },
      ],
      traversalFloorKeys: [fromSocket.floorKey, toSocket.floorKey],
      isDungeonSupplement: true,
      isRouteNetworkConnection: true,
      augmentationOperationType: 'routeNetwork',
      augmentationOperationId: 'supplement:test:split-room-operation',
      connectorVariantConstraints: {},
    };
  };
  const plans = [
    makePlan({
      id: 'supplement:test:split-room-left',
      fromRoomId: 'hubTown',
      toRoomId: 'split-supplement-room',
      fromFloor: hubFloor,
      toFloor: leftFloor,
    }),
    makePlan({
      id: 'supplement:test:split-room-right',
      fromRoomId: 'alternateRouteRoom',
      toRoomId: 'split-supplement-room',
      fromFloor: alternateRoute.at(-1),
      toFloor: rightFloor,
    }),
  ];
  const dividingWall = {
    id: 'supplement-room-interior-divider',
    position: new THREE.Vector3(generator.tileSize * 2.5, 1, 0),
    halfWidth: 0.08,
    halfDepth: generator.tileSize * 0.45,
    verticalHalfHeight: 1,
  };
  const validation = generator._validatePlatformability({
    floorTiles: [hubFloor, leftFloor, centerFloor, rightFloor, ...alternateRoute],
    rooms: [
      { id: 'hubTown', type: 'hub', x: 0, z: 0, width: 1, depth: 1, baseElevation: 0 },
      {
        id: 'alternateRouteRoom',
        type: 'camp',
        x: 3,
        z: 1,
        width: 1,
        depth: 1,
        baseElevation: 0,
      },
      {
        id: 'split-supplement-room',
        type: 'supplement',
        x: 2,
        z: 0,
        width: 3,
        depth: 1,
        baseElevation: 0,
        isDungeonSupplement: true,
        augmentationOperationType: 'routeNetwork',
      },
    ],
    solidZones: [dividingWall],
    connectionPlans: plans,
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });

  const roomCheck = validation.details.supplementRoomConnectivityChecks.find((check) => (
    check.roomId === 'split-supplement-room'
  ));
  assert.equal(validation.accepted, false);
  assert.ok(roomCheck);
  assert.equal(roomCheck.distinctLocalApproachCount, 2);
  assert.equal(roomCheck.localRoomConnectivityAccepted, false);
  assert.ok(roomCheck.locallyUnreachableRoomFloorKeys.length > 0);
  assert.match(validation.errors.join('\n'), /one locally clear, bidirectional component/);
});

test('every supplemental room floor can return to its exact connector approach', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const connectionId = 'supplement:test:one-way-room-floor';
  const hubFloor = {
    x: 0,
    z: 0,
    elevation: 5,
    level: 0,
    roomId: 'hubTown',
    surface: 'roomFloor',
    connectorId: connectionId,
    connectionId,
    signedConnectorFloorOwnerId: connectionId,
  };
  const approachFloor = {
    x: 1,
    z: 0,
    elevation: 5,
    level: 0,
    roomId: 'one-way-supplement-room',
    surface: 'roomFloor',
    connectorId: connectionId,
    connectionId,
    signedConnectorFloorOwnerId: connectionId,
    traversalLinks: [],
  };
  const pitFloor = {
    x: 3,
    z: 0,
    elevation: 0,
    level: 0,
    roomId: 'one-way-supplement-room',
    surface: 'roomFloor',
  };
  approachFloor.traversalLinks.push({
    id: `${connectionId}:one-way-drop`,
    action: 'drop',
    toFloorKey: generator._getFloorTileGraphKey(pitFloor),
  });
  const fromSocket = {
    id: `${connectionId}:from`,
    roomId: 'hubTown',
    x: 0,
    z: 0,
    elevation: 5,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(hubFloor),
  };
  const toSocket = {
    id: `${connectionId}:to`,
    roomId: 'one-way-supplement-room',
    x: 1,
    z: 0,
    elevation: 5,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(approachFloor),
  };
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  const plan = {
    id: connectionId,
    fromRoomId: 'hubTown',
    toRoomId: 'one-way-supplement-room',
    fromSocket,
    toSocket,
    level: 0,
    elevation: 5,
    sourceElevation: 5,
    destinationElevation: 5,
    elevationDelta: 0,
    bridgePath: [{ x: 0, z: 0 }, { x: 1, z: 0 }],
    traversalFloorKeys: [fromSocket.floorKey, toSocket.floorKey],
    isDungeonSupplement: true,
    isRouteNetworkConnection: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'supplement:test:one-way-room-operation',
    connectorVariantConstraints: {},
  };

  const validation = generator._validatePlatformability({
    floorTiles: [hubFloor, approachFloor, pitFloor],
    rooms: [
      { id: 'hubTown', type: 'hub', x: 0, z: 0, width: 1, depth: 1, baseElevation: 5 },
      {
        id: 'one-way-supplement-room',
        type: 'supplement',
        x: 2,
        z: 0,
        width: 3,
        depth: 1,
        baseElevation: 5,
        isDungeonSupplement: true,
        augmentationOperationType: 'routeNetwork',
      },
    ],
    solidZones: [],
    connectionPlans: [plan],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });

  const roomCheck = validation.details.supplementRoomConnectivityChecks.find((check) => (
    check.roomId === 'one-way-supplement-room'
  ));
  const pitFloorKey = generator._getFloorTileGraphKey(pitFloor);
  assert.equal(validation.accepted, false);
  assert.ok(roomCheck);
  assert.deepEqual(roomCheck.locallyUnreachableRoomFloorKeys, []);
  assert.ok(roomCheck.locallyNonReturnableRoomFloorKeys.includes(pitFloorKey));
  assert.ok(validation.details.nonReturnableSupplementFloorKeys.includes(pitFloorKey));
  assert.equal(roomCheck.localRoomConnectivityAccepted, false);
  assert.match(validation.errors.join('\n'), /one locally clear, bidirectional component/);
});

test('every route-station junction arm is bidirectionally connected', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const connectionId = 'supplement:test:one-way-junction-connector';
  const parentRouteId = 'authored:test:one-way-parent-route';
  const hubFloor = {
    x: 4,
    z: 0,
    elevation: 0,
    level: 0,
    roomId: 'hubTown',
    surface: 'roomFloor',
    connectorId: connectionId,
    connectionId,
    signedConnectorFloorOwnerId: connectionId,
  };
  const stationFloor = {
    x: 5,
    z: 0,
    elevation: 0,
    level: 0,
    roomId: 'route-station-room',
    surface: 'roomFloor',
    connectorId: connectionId,
    connectionId,
    signedConnectorFloorOwnerId: connectionId,
    traversalLinks: [],
  };
  const parentBeforeFloor = {
    x: 1,
    z: 0,
    elevation: 0,
    level: 0,
    roomId: null,
    surface: 'connectorGalleryFloor',
    connectorId: parentRouteId,
    connectionId: parentRouteId,
    signedConnectorFloorOwnerId: parentRouteId,
  };
  const parentAfterFloor = {
    x: 9,
    z: 0,
    elevation: 0,
    level: 0,
    roomId: null,
    surface: 'connectorGalleryFloor',
    connectorId: parentRouteId,
    connectionId: parentRouteId,
    signedConnectorFloorOwnerId: parentRouteId,
  };
  stationFloor.traversalLinks.push(
    {
      id: `${parentRouteId}:one-way-before`,
      action: 'link',
      toFloorKey: generator._getFloorTileGraphKey(parentBeforeFloor),
    },
    {
      id: `${parentRouteId}:one-way-after`,
      action: 'link',
      toFloorKey: generator._getFloorTileGraphKey(parentAfterFloor),
    },
  );
  const fromSocket = {
    id: `${connectionId}:from`,
    roomId: 'hubTown',
    x: 4,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(hubFloor),
  };
  const toSocket = {
    id: `${connectionId}:to`,
    roomId: 'route-station-room',
    x: 5,
    z: 0,
    elevation: 0,
    connectorType: 'ground_corridor',
    floorKey: generator._getFloorTileGraphKey(stationFloor),
  };
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  const physicalPlan = {
    id: connectionId,
    fromRoomId: 'hubTown',
    toRoomId: 'route-station-room',
    fromSocket,
    toSocket,
    level: 0,
    elevation: 0,
    sourceElevation: 0,
    destinationElevation: 0,
    elevationDelta: 0,
    bridgePath: [{ x: 4, z: 0 }, { x: 5, z: 0 }],
    traversalFloorKeys: [fromSocket.floorKey, toSocket.floorKey],
    isDungeonSupplement: true,
    isRouteNetworkConnection: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'supplement:test:one-way-junction-operation',
    connectorVariantConstraints: {},
  };
  const parentPlan = {
    id: parentRouteId,
    fromRoomId: 'authored-before',
    toRoomId: 'authored-after',
    bridgePath: [{ x: 1, z: 0 }, { x: 5, z: 0 }, { x: 9, z: 0 }],
    isSupplementGraphConnection: true,
    connectorVariantConstraints: { graphOnly: true },
  };

  const validation = generator._validatePlatformability({
    floorTiles: [hubFloor, stationFloor, parentBeforeFloor, parentAfterFloor],
    rooms: [
      { id: 'hubTown', type: 'hub', x: 4, z: 0, width: 1, depth: 1, baseElevation: 0 },
      {
        id: 'route-station-room',
        type: 'supplement',
        x: 5,
        z: 0,
        width: 11,
        depth: 1,
        baseElevation: 0,
        isDungeonSupplement: true,
        isRouteStationProxy: true,
        parentRouteId,
        junctionKind: 'through-t',
        augmentationJunction: { junctionKind: 'through-t' },
        augmentationOperationType: 'routeNetwork',
        augmentationOperationId: physicalPlan.augmentationOperationId,
      },
    ],
    solidZones: [],
    connectionPlans: [physicalPlan, parentPlan],
    doors: [],
    landmarks: {},
    encounters: [],
    useSegmentBarriers: true,
  });

  const junctionCheck = validation.details.supplementJunctionConnectivityChecks[0];
  assert.equal(validation.accepted, false);
  assert.equal(junctionCheck.approachCount, 3);
  assert.ok(junctionCheck.approachChecks.every((check) => check.locallyReachable));
  assert.ok(junctionCheck.approachChecks.some((check) => !check.returnReachable));
  assert.equal(junctionCheck.accepted, false);
  assert.match(validation.errors.join('\n'), /junction does not provide/);
});

test('compact supplement connector junctions require three exact-elevation physical arms and a fully reachable owned core', () => {
  const validate = ({
    removeThirdArm = false,
    raiseDisconnectedCoreFloor = false,
    mergeUnrelatedElevatedOwner = false,
  } = {}) => {
    const generator = new DungeonGenerator({ random: () => 0.5 });
    const operationId = 'supplement:test:compact-junction-operation';
    const junctionId = `${operationId}:junction`;
    const coreFloors = [];
    for (let x = 1; x <= 3; x += 1) {
      for (let z = -1; z <= 1; z += 1) {
        coreFloors.push({
          x,
          z,
          elevation: raiseDisconnectedCoreFloor && x === 2 && z === 0 ? 14 : 0,
          level: 0,
          roomId: junctionId,
          surface: 'supplementConnectorJunctionCore',
          connectorJunctionOwnerId: junctionId,
          isDungeonSupplementConnectorFloor: true,
          augmentationOwnerId: operationId,
          noEnemySpawn: true,
          traversalLinks: [],
        });
      }
    }
    const floorAt = (x, z) => coreFloors.find((floor) => floor.x === x && floor.z === z);
    if (mergeUnrelatedElevatedOwner) {
      floorAt(2, 0).mergedFloorOwnerIds = [junctionId, 'unrelated-elevated-route'];
      floorAt(2, 0).mergedFloorSourceCount = 2;
    }
    const hubFloor = {
      x: 0,
      z: 0,
      elevation: 0,
      level: 0,
      roomId: 'hubTown',
      surface: 'roomFloor',
      traversalLinks: [],
    };
    const rewardFloor = {
      x: 4,
      z: 0,
      elevation: 0,
      level: 0,
      roomId: 'large-reward-room',
      surface: 'roomFloor',
      traversalLinks: [],
    };
    const challengeFloor = {
      x: 2,
      z: 2,
      elevation: 0,
      level: 0,
      roomId: 'large-challenge-room',
      surface: 'roomFloor',
      traversalLinks: [],
    };
    const makePlan = (id, fromRoomId, fromFloor, toRoomId, toFloor) => {
      fromFloor.connectorId = id;
      fromFloor.connectionId = id;
      fromFloor.signedConnectorFloorOwnerId = id;
      toFloor.connectorId = id;
      toFloor.connectionId = id;
      toFloor.signedConnectorFloorOwnerId = id;
      const fromSocket = {
        id: `${id}:from`,
        roomId: fromRoomId,
        x: fromFloor.x,
        z: fromFloor.z,
        elevation: 0,
        connectorType: 'ground_corridor',
        floorKey: generator._getFloorTileGraphKey(fromFloor),
      };
      const toSocket = {
        id: `${id}:to`,
        roomId: toRoomId,
        x: toFloor.x,
        z: toFloor.z,
        elevation: 0,
        connectorType: 'ground_corridor',
        floorKey: generator._getFloorTileGraphKey(toFloor),
      };
      fromSocket.matchingSocketId = toSocket.id;
      toSocket.matchingSocketId = fromSocket.id;
      return {
        id,
        fromRoomId,
        toRoomId,
        fromSocket,
        toSocket,
        level: 0,
        elevation: 0,
        sourceElevation: 0,
        destinationElevation: 0,
        elevationDelta: 0,
        bridgePath: [
          { x: fromFloor.x, z: fromFloor.z, elevation: 0 },
          { x: toFloor.x, z: toFloor.z, elevation: 0 },
        ],
        traversalFloorKeys: [fromSocket.floorKey, toSocket.floorKey],
        isDungeonSupplement: true,
        isRouteNetworkConnection: true,
        augmentationOperationType: 'routeNetwork',
        augmentationOperationId: operationId,
        connectorVariantConstraints: {},
      };
    };
    const plans = [
      makePlan(`${operationId}:west`, 'hubTown', hubFloor, junctionId, floorAt(1, 0)),
      makePlan(`${operationId}:east`, junctionId, floorAt(3, 0), 'large-reward-room', rewardFloor),
      makePlan(`${operationId}:south`, junctionId, floorAt(2, 1), 'large-challenge-room', challengeFloor),
    ];
    if (removeThirdArm) plans.pop();
    return generator._validatePlatformability({
      floorTiles: [hubFloor, rewardFloor, challengeFloor, ...coreFloors],
      rooms: [
        { id: 'hubTown', type: 'hub', x: 0, z: 0, width: 1, depth: 1, baseElevation: 0 },
        {
          id: 'large-reward-room',
          type: 'supplement',
          x: 4,
          z: 0,
          width: 15,
          depth: 13,
          baseElevation: 0,
          isDungeonSupplement: true,
          suppressRoomGeometry: true,
          augmentationOperationType: 'routeNetwork',
          augmentationOperationId: operationId,
        },
        {
          id: 'large-challenge-room',
          type: 'supplement',
          x: 2,
          z: 2,
          width: 15,
          depth: 13,
          baseElevation: 0,
          isDungeonSupplement: true,
          suppressRoomGeometry: true,
          augmentationOperationType: 'routeNetwork',
          augmentationOperationId: operationId,
        },
        {
          id: junctionId,
          type: 'supplement',
          x: 2,
          z: 0,
          width: 3,
          depth: 3,
          baseElevation: 0,
          isDungeonSupplement: false,
          isDungeonSupplementConnector: true,
          isConnectorJunctionProxy: true,
          suppressRoomGeometry: true,
          stampConnectorJunctionFloor: true,
          junctionKind: 'through-t',
          countsAsMeaningfulStation: true,
          augmentationOperationId: operationId,
        },
      ],
      solidZones: [],
      connectionPlans: plans,
      doors: [],
      landmarks: {},
      encounters: [],
      useSegmentBarriers: true,
    });
  };

  const valid = validate();
  assert.equal(valid.accepted, true, valid.errors.join('\n'));
  const validCheck = valid.details.supplementJunctionConnectivityChecks.find((check) => (
    check.connectorModuleProxy
  ));
  assert.ok(validCheck);
  assert.equal(validCheck.approachCount, 3);
  assert.equal(validCheck.coreFloorCount, 9);
  assert.equal(validCheck.coreFloorCoverageAccepted, true);

  const missingArm = validate({ removeThirdArm: true });
  assert.equal(missingArm.accepted, false);
  assert.match(missingArm.errors.join('\n'), /at least 3 physically assembled approaches/);

  const wrongElevation = validate({ raiseDisconnectedCoreFloor: true });
  assert.equal(wrongElevation.accepted, false);
  assert.equal(
    wrongElevation.details.supplementJunctionConnectivityChecks.find((check) => (
      check.connectorModuleProxy
    )).coreFloorCoverageAccepted,
    false,
  );
  assert.match(wrongElevation.errors.join('\n'), /exact-elevation, bidirectionally walkable component/);

  const parasiticOverpass = validate({ mergeUnrelatedElevatedOwner: true });
  assert.equal(parasiticOverpass.accepted, false);
  const parasiticCheck = parasiticOverpass.details.supplementJunctionConnectivityChecks.find((check) => (
    check.connectorModuleProxy
  ));
  assert.deepEqual(parasiticCheck.foreignCoreFloorOwnerIds, ['unrelated-elevated-route']);
  assert.equal(parasiticCheck.coreFloorCoverageAccepted, false);
  assert.match(
    parasiticOverpass.errors.join('\n'),
    /exact-elevation, bidirectionally walkable component/,
  );
});

test('floorless ladder and lift shaft points require exact reachable landings and links', () => {
  const validateVerticalContract = (kind, {
    removeTopLanding = false,
    removeReturnLink = false,
    shortcut = false,
    addAlternateRoute = false,
    removeShortcutMechanism = false,
    blockSourceShaftMouth = false,
  } = {}) => {
    const generator = new DungeonGenerator({ random: () => 0.5 });
    const connectionId = `supplement:test:${kind}-shaft`;
    const contractId = `${connectionId}:${kind}`;
    const action = kind === 'ladder' ? 'ladder' : 'automatic_lift';
    const bottomFloor = {
      x: 0,
      z: 0,
      elevation: 0,
      level: 0,
      roomId: 'hubTown',
      surface: 'connectorGalleryFloor',
      connectorId: connectionId,
      connectionId,
      signedConnectorFloorOwnerId: connectionId,
      traversalLinks: [{
        id: `${contractId}:forward`,
        action,
        toFloorKey: 'pending',
      }],
    };
    const topFloor = {
      x: 2,
      z: 0,
      elevation: 14,
      level: 1,
      roomId: 'vertical-supplement-room',
      surface: 'upperConnectionBridge',
      connectorId: connectionId,
      connectionId,
      signedConnectorFloorOwnerId: connectionId,
      traversalLinks: removeReturnLink ? [] : [{
        id: `${contractId}:reverse`,
        action,
        toFloorKey: 'pending',
      }],
    };
    const bottomFloorKey = generator._getFloorTileGraphKey(bottomFloor);
    const topFloorKey = generator._getFloorTileGraphKey(topFloor);
    bottomFloor.traversalLinks[0].toFloorKey = topFloorKey;
    if (topFloor.traversalLinks[0]) topFloor.traversalLinks[0].toFloorKey = bottomFloorKey;
    if (addAlternateRoute) {
      bottomFloor.traversalLinks.push({
        id: `${connectionId}:authored-alternate:forward`,
        action,
        toFloorKey: topFloorKey,
      });
      topFloor.traversalLinks.push({
        id: `${connectionId}:authored-alternate:reverse`,
        action,
        toFloorKey: bottomFloorKey,
      });
    }
    const fromSocket = {
      id: `${connectionId}:from`,
      roomId: 'hubTown',
      x: 0,
      z: 0,
      elevation: 0,
      connectorType: 'ground_corridor',
      floorKey: bottomFloorKey,
    };
    const toSocket = {
      id: `${connectionId}:to`,
      roomId: 'vertical-supplement-room',
      x: 2,
      z: 0,
      elevation: 14,
      connectorType: 'ground_corridor',
      floorKey: topFloorKey,
    };
    const contract = {
      id: contractId,
      bottomFloorKey,
      ...(removeTopLanding ? {} : { topFloorKey }),
      bottomLandingTiles: [{ floorKey: bottomFloorKey }],
      topLandingTiles: removeTopLanding ? [] : [{ floorKey: topFloorKey }],
      ...(kind === 'ladder'
        ? { apertureGridPoint: { x: 1, z: 0 } }
        : { liftShaft: { gridColumns: [{ x: 1, z: 0 }] } }),
    };
    const plan = {
      id: connectionId,
      fromRoomId: 'hubTown',
      toRoomId: 'vertical-supplement-room',
      fromSocket,
      toSocket,
      level: 0,
      elevation: 0,
      sourceElevation: 0,
      destinationElevation: 14,
      elevationDelta: 14,
      bridgePath: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }],
      traversalFloorKeys: [bottomFloorKey, topFloorKey],
      isDungeonSupplement: true,
      isRouteNetworkConnection: true,
      augmentationOperationType: 'routeNetwork',
      augmentationOperationId: `supplement:test:${kind}-operation`,
      topologyTemplateId: 'stacked-interchange',
      elevationModes: [kind],
      ladderContracts: kind === 'ladder' ? [contract] : [],
      liftContracts: kind === 'lift' ? [contract] : [],
      connectorVariantConstraints: {},
      ...(shortcut ? {
        oneSideActivatedShortcut: true,
        shortcutMode: kind === 'ladder' ? 'drop-ladder' : 'shortcut-lift',
        shortcutMechanismId: `${connectionId}:mechanism`,
        shortcutStateId: `${connectionId}:state`,
        shortcutActivationSide: 'far-side',
        shortcutInitialState: kind === 'ladder' ? 'retracted' : 'unavailable',
        shortcutActivatedState: kind === 'ladder' ? 'deployed' : 'available',
      } : {}),
    };
    const shaftMouthBarrier = {
      id: `${connectionId}:source-shaft-mouth-blocker`,
      position: new THREE.Vector3(generator.tileSize * 0.5, 7, 0),
      halfWidth: 0.08,
      halfDepth: generator.tileSize * 0.45,
      verticalHalfHeight: 20,
    };
    return generator._validatePlatformability({
      floorTiles: [bottomFloor, topFloor],
      rooms: [
        { id: 'hubTown', type: 'hub', x: 0, z: 0, width: 1, depth: 1, baseElevation: 0 },
        {
          id: 'vertical-supplement-room',
          type: 'supplement',
          x: 2,
          z: 0,
          width: 15,
          depth: 13,
          baseElevation: 14,
          // This is an endpoint landing fixture, not a materialized
          // supplemental room. Keep the connector contract test independent
          // of the legacy 15x13 replay-footprint contract.
          isDungeonSupplement: true,
          suppressRoomGeometry: true,
          augmentationOperationType: 'routeNetwork',
          augmentationOperationId: plan.augmentationOperationId,
        },
      ],
      solidZones: blockSourceShaftMouth ? [shaftMouthBarrier] : [],
      connectionPlans: [plan],
      doors: [],
      landmarks: {
        mechanisms: shortcut && !removeShortcutMechanism ? [{
          id: plan.shortcutMechanismId,
          stateId: plan.shortcutStateId,
          shortcutStateId: plan.shortcutStateId,
          runtimeStateIds: [plan.shortcutStateId],
          connectionId: plan.id,
          roomId: plan.toRoomId,
          activationSide: 'far-side',
          position: new THREE.Vector3(2 * generator.tileSize, 14, 0),
          isDungeonSupplement: true,
        }] : [],
      },
      encounters: [],
      useSegmentBarriers: true,
    });
  };

  for (const kind of ['ladder', 'lift']) {
    const valid = validateVerticalContract(kind);
    assert.equal(valid.accepted, true, valid.errors.join('\n'));
    assert.equal(valid.details.supplementConnectivityChecks[0].accepted, true);
    assert.equal(
      valid.details.supplementConnectivityChecks[0].centerlineChecks[1].contractTraversal,
      true,
    );

    const missingLanding = validateVerticalContract(kind, { removeTopLanding: true });
    assert.equal(missingLanding.accepted, false);
    assert.match(missingLanding.errors.join('\n'), /centerline point|assembled ramp, ladder, or lift/);

    const missingReturn = validateVerticalContract(kind, { removeReturnLink: true });
    assert.equal(missingReturn.accepted, false);
    assert.match(missingReturn.errors.join('\n'), /return spine|centerline point/);

    const blockedSourceMouth = validateVerticalContract(kind, {
      blockSourceShaftMouth: true,
    });
    assert.equal(blockedSourceMouth.accepted, false);
    const blockedContract = blockedSourceMouth.details.supplementConnectivityChecks[0]
      .verticalContractChecks[0];
    assert.equal(blockedContract.landingApproachesClear, false);
    assert.equal(blockedContract.landingApproachChecks[0].accepted, false);
    assert.match(blockedSourceMouth.errors.join('\n'), /barrier-clear approach/);
  }

  const inaccessibleShortcutControl = validateVerticalContract('ladder', { shortcut: true });
  assert.equal(inaccessibleShortcutControl.accepted, false);
  assert.equal(
    inaccessibleShortcutControl.details.supplementShortcutConnectivityChecks[0]
      .farSideReachableBeforeActivation,
    false,
  );

  const validFarSideShortcut = validateVerticalContract('ladder', {
    shortcut: true,
    addAlternateRoute: true,
  });
  assert.equal(validFarSideShortcut.accepted, true, validFarSideShortcut.errors.join('\n'));
  assert.equal(
    validFarSideShortcut.details.supplementShortcutConnectivityChecks[0].accepted,
    true,
  );

  const missingFarSideControl = validateVerticalContract('ladder', {
    shortcut: true,
    addAlternateRoute: true,
    removeShortcutMechanism: true,
  });
  assert.equal(missingFarSideControl.accepted, false);
  assert.equal(
    missingFarSideControl.details.supplementShortcutConnectivityChecks[0]
      .mechanismRecordAccepted,
    false,
  );
});

test('a late augmented assembly throw disposes the partial candidate exactly once', { timeout: 180_000 }, () => {
  const browserRandom = new SeededRandom(hashSeed(AUGMENTED_SEED));
  const generator = new DungeonGenerator({
    random: () => browserRandom.next(),
    difficulty: 1,
    augmentationProfileId: AUGMENTATION_PROFILE_ID,
    augmentationSeed: AUGMENTED_SEED,
    basePlanHash: AUGMENTED_BASE_PLAN_HASH,
  });
  const cachedTexture = new THREE.Texture();
  cachedTexture.name = 'lateAssemblyCleanupCachedTexture';
  generator.textureCache.set('lateAssemblyCleanupCachedTexture', cachedTexture);
  generator._loadRuinTexture = () => cachedTexture;

  // Exercise the same accepted-parent replay path used by generate(). A raw
  // _generateOnce() starts at the beginning of the seed stream, which can be
  // an authored parent attempt that was intentionally rejected before the
  // accepted random tape was captured.
  generator.augmentationProfileId = null;
  const { dungeon: acceptedParent, randomTape } = generator
    ._generateAcceptedIndustrialDungeon({ captureAcceptedRandomTape: true });
  generator.augmentationProfileId = AUGMENTATION_PROFILE_ID;
  let replayCursor = 0;
  generator.random = () => {
    assert.ok(replayCursor < randomTape.length, 'augmented replay exceeded parent RNG tape');
    const value = randomTape[replayCursor];
    replayCursor += 1;
    return value;
  };

  const createMaterials = generator._createMaterials.bind(generator);
  let detachedMaterial = null;
  generator._createMaterials = () => {
    const materials = createMaterials();
    detachedMaterial = new THREE.MeshBasicMaterial({ map: cachedTexture });
    detachedMaterial.addEventListener('dispose', () => { detachedMaterialDisposals += 1; });
    materials.lateAssemblyCleanupSentinel = detachedMaterial;
    return materials;
  };

  let capturedGroup = null;
  const supplementGeometries = new Map();
  const supplementMaterials = new Map();
  let cachedTextureDisposals = 0;
  let detachedMaterialDisposals = 0;
  cachedTexture.addEventListener('dispose', () => { cachedTextureDisposals += 1; });
  generator._createStaticRenderCullGroups = (group) => {
    capturedGroup = group;
    const supplementRoot = group.getObjectByName('DungeonSupplementRoot');
    assert.ok(supplementRoot, 'late failure did not reach the assembled supplement root');
    supplementRoot.traverse((object) => {
      if (object.geometry && !supplementGeometries.has(object.geometry)) {
        supplementGeometries.set(object.geometry, 0);
        object.geometry.addEventListener('dispose', () => {
          supplementGeometries.set(
            object.geometry,
            supplementGeometries.get(object.geometry) + 1,
          );
        });
      }
      for (const material of (Array.isArray(object.material)
        ? object.material
        : [object.material])) {
        if (!material || supplementMaterials.has(material)) continue;
        supplementMaterials.set(material, 0);
        material.addEventListener('dispose', () => {
          supplementMaterials.set(material, supplementMaterials.get(material) + 1);
        });
      }
    });
    const error = new Error('Synthetic late augmented assembly failure.');
    error.code = 'SYNTHETIC_LATE_AUGMENTED_ASSEMBLY_FAILURE';
    throw error;
  };

  try {
    assert.throws(
      () => generator._generateOnce(),
      (error) => error.code === 'SYNTHETIC_LATE_AUGMENTED_ASSEMBLY_FAILURE',
    );
    assert.ok(replayCursor > 0, 'fixture did not consume the accepted parent replay tape');
    assert.ok(capturedGroup);
    assert.equal(capturedGroup.userData.generationCandidateDisposed, true);
    assert.ok(supplementGeometries.size > 0, 'fixture assembled no supplement geometry');
    assert.ok(supplementMaterials.size > 0, 'fixture assembled no supplement materials');
    assert.ok(
      [...supplementGeometries.values()].every((count) => count === 1),
      `supplement geometry disposal counts: ${JSON.stringify([...supplementGeometries.values()])}`,
    );
    assert.ok(
      [...supplementMaterials.values()].every((count) => count === 1),
      `supplement material disposal counts: ${JSON.stringify([...supplementMaterials.values()])}`,
    );
    assert.ok(detachedMaterial, 'fixture did not create its detached candidate material');
    assert.equal(detachedMaterialDisposals, 1);
    assert.equal(cachedTextureDisposals, 0);
  } finally {
    generator._disposeGeneratedDungeonCandidate(acceptedParent);
    cachedTexture.dispose();
  }
});

test('a browser-identical accepted seed seals every connector-adjacent envelope discontinuity', { timeout: 60_000 }, () => {
  const browserRandom = new SeededRandom(hashSeed(`layout:${REAL_SEED}`));
  const generator = new DungeonGenerator({
    random: () => browserRandom.next(),
    difficulty: 1,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = `connectorEnclosureTexture_${REAL_SEED}`;
  generator._loadRuinTexture = () => inertTexture;

  let captured = null;
  const collectBoundaryWallRuns = generator._collectBoundaryWallRuns.bind(generator);
  generator._collectBoundaryWallRuns = (
    tiles,
    openAirTileKeys,
    rooms,
    connectorWallOpenings,
    authoritativeFloorTiles,
  ) => {
    const runs = collectBoundaryWallRuns(
      tiles,
      openAirTileKeys,
      rooms,
      connectorWallOpenings,
      authoritativeFloorTiles,
    );
    captured = { tiles, openAirTileKeys, rooms, runs };
    return runs;
  };

  let dungeon = null;
  try {
    dungeon = generator.generate();
    assert.equal(
      dungeon.progression.validation.accepted,
      true,
      dungeon.progression.validation.errors.join('\n'),
    );
    assertLockedGatesAtSource(dungeon);
    assert.ok(captured, 'standard dungeon assembly never collected its structural wall shell');

    const slopePlans = dungeon.connectionPlans.filter((plan) => (
      plan.connectorVariant?.traversalKind === 'slope'
    ));
    assert.ok(slopePlans.length > 0, 'the real witness seed must include a signed slope');

    const discontinuities = collectConnectorEnvelopeDiscontinuities(captured);
    assert.ok(
      discontinuities.length > 0,
      'the real witness seed did not exercise adjacent connector envelope discontinuities',
    );
    assert.ok(
      discontinuities.some(({ kind }) => kind === 'lower-neighbor-ceiling'),
      'the real witness seed did not exercise a roof-height fascia',
    );

    const assembledWallRuns = [];
    const assembledCeilings = [];
    dungeon.group.traverse((object) => {
      if (object.name === 'dungeonBoundaryWall' && object.userData?.wallRun) {
        assembledWallRuns.push(object.userData.wallRun);
      }
      if (object.name === 'dungeonRoomCeiling') assembledCeilings.push(object);
    });
    assert.equal(
      assembledWallRuns.length,
      captured.runs.length,
      'a planned wall run was not represented by an assembled boundary mesh',
    );

    const uncovered = discontinuities.filter((discontinuity) => (
      !assembledWallRuns.some((run) => wallRunCovers(discontinuity, run))
    ));
    assert.deepEqual(uncovered, [], `unsealed connector envelope intervals: ${JSON.stringify(uncovered, null, 2)}`);

    const roomById = new Map(captured.rooms.map((room) => [room.id, room]));
    const expectedCeilingCells = [...captured.tiles.values()].filter((tile) => (
      !captured.openAirTileKeys.has(tileKey(tile.x, tile.z))
      && !roomById.get(tile.roomId)?.specialEnvironmentId
    ));
    assert.equal(
      assembledCeilings.length,
      expectedCeilingCells.length,
      'every enclosed spatial cell must have exactly one rendered ceiling',
    );
    for (const tile of expectedCeilingCells) {
      const room = roomById.get(tile.roomId);
      const floorY = Number(room?.baseElevation ?? tile.connectorMinY ?? tile.elevation ?? 0);
      const ceilingY = Number(room?.ceilingY ?? tile.connectorCeilingY ?? (floorY + 8.4));
      const matches = assembledCeilings.filter((ceiling) => (
        Math.abs(ceiling.position.x - tile.x * dungeon.tileSize) <= EPSILON
        && Math.abs(ceiling.position.z - tile.z * dungeon.tileSize) <= EPSILON
        && Math.abs(Number(ceiling.userData.ceilingHeight) - ceilingY) <= EPSILON
        && Math.abs(Number(ceiling.userData.floorElevation) - floorY) <= EPSILON
      ));
      assert.equal(matches.length, 1, `missing/multiple ceiling meshes at ${tile.x},${tile.z}`);
    }

    const collisionByFacadeId = new Map((dungeon.aerialBoundaryZones ?? [])
      .filter((zone) => zone.wallFacadeId)
      .map((zone) => [zone.wallFacadeId, zone]));
    assert.equal(
      collisionByFacadeId.size,
      captured.runs.length,
      'every rendered boundary run must have one exact collision zone',
    );
    for (const run of captured.runs) {
      const zone = collisionByFacadeId.get(run.facadeId);
      assert.ok(zone, `missing boundary collision for ${run.facadeId}`);
      const expectedLength = run.lengthTiles * dungeon.tileSize;
      assert.ok(Math.abs(zone.position.y - (run.wallBottomY + run.wallHeight * 0.5)) <= EPSILON);
      assert.ok(Math.abs(zone.verticalHalfHeight - run.wallHeight * 0.5) <= EPSILON);
      assert.ok(Math.abs(
        (run.horizontal ? zone.halfWidth : zone.halfDepth) - expectedLength * 0.5,
      ) <= EPSILON);
      assert.ok(Math.abs(
        (run.horizontal ? zone.halfDepth : zone.halfWidth) - 0.11,
      ) <= EPSILON);
      assert.equal(zone.allowFlyOver, false);
    }
  } finally {
    disposeDungeon(dungeon);
    inertTexture.dispose();
  }
});

test('the v2 adjacent-threshold witness reserves both authored connector apertures end to end', { timeout: 60_000 }, () => {
  const browserRandom = new SeededRandom(hashSeed(ADJACENT_THRESHOLD_WITNESS_SEED));
  const generator = new DungeonGenerator({
    random: () => browserRandom.next(),
    difficulty: 1,
    augmentationProfileId: LEGACY_ADJACENT_AUGMENTATION_PROFILE_ID,
    augmentationSeed: ADJACENT_THRESHOLD_WITNESS_SEED,
    basePlanHash: ADJACENT_THRESHOLD_WITNESS_BASE_PLAN_HASH,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = 'adjacentThresholdWitnessTexture';
  generator._loadRuinTexture = () => inertTexture;

  let dungeon = null;
  try {
    dungeon = generator.generate();
    assert.equal(
      dungeon.augmentationStatus,
      'applied',
      dungeon.augmentationStatus === 'applied'
        ? undefined
        : JSON.stringify(dungeon.augmentationDiagnostics),
    );
    assert.equal(
      dungeon.progression.validation.accepted,
      true,
      dungeon.progression.validation.errors.join('\n'),
    );

    const entranceValidation = dungeon.progression.validation.connectorEntrances;
    const rejectedEntrances = entranceValidation.checks.filter((check) => !check.accepted);
    assert.ok(entranceValidation.checkedSocketCount > 0);
    assert.equal(
      entranceValidation.acceptedSocketCount,
      entranceValidation.checkedSocketCount,
      JSON.stringify(rejectedEntrances, null, 2),
    );
    assert.ok(
      entranceValidation.checks.every((check) => (
        check.accepted
        && check.socketReachable
        && check.outsideReachable
        && check.traversableOutward
        && check.traversableReturn
        && check.blockingWallFacadeId === null
      )),
      JSON.stringify(rejectedEntrances, null, 2),
    );

    const doorById = new Map(dungeon.doors.map((door) => [door.id, door]));
    assertLockedGatesAtSource(dungeon);
    assert.ok(doorById.has('Door_Beta'));
    assert.ok(doorById.has('Door_Gamma'));
  } finally {
    disposeDungeon(dungeon);
    inertTexture.dispose();
  }
});

test('a nonzero-elevation supplement keeps every connector mouth open and reachable', { timeout: 180_000 }, () => {
  const browserRandom = new SeededRandom(hashSeed(AUGMENTED_SEED));
  const generator = new DungeonGenerator({
    random: () => browserRandom.next(),
    difficulty: 1,
    augmentationProfileId: AUGMENTATION_PROFILE_ID,
    augmentationSeed: AUGMENTED_SEED,
    basePlanHash: AUGMENTED_BASE_PLAN_HASH,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = 'connectorEntranceAugmentationTexture';
  generator._loadRuinTexture = () => inertTexture;

  generator.augmentationProfileId = null;
  const { dungeon: acceptedParent, randomTape } = generator
    ._generateAcceptedIndustrialDungeon({ captureAcceptedRandomTape: true });
  generator.augmentationProfileId = AUGMENTATION_PROFILE_ID;
  let replayCursor = 0;
  generator.random = () => {
    assert.ok(replayCursor < randomTape.length, 'augmented replay exceeded parent RNG tape');
    const value = randomTape[replayCursor];
    replayCursor += 1;
    return value;
  };

  let wallRuns = [];
  const collectBoundaryWallRuns = generator._collectBoundaryWallRuns.bind(generator);
  generator._collectBoundaryWallRuns = (
    tiles,
    openAirTileKeys,
    rooms,
    connectorWallOpenings,
    authoritativeFloorTiles,
  ) => {
    wallRuns = collectBoundaryWallRuns(
      tiles,
      openAirTileKeys,
      rooms,
      connectorWallOpenings,
      authoritativeFloorTiles,
    );
    return wallRuns;
  };

  let dungeon = null;
  try {
    dungeon = generator._generateOnce();
    assert.equal(replayCursor, randomTape.length);
    assert.equal(
      dungeon.augmentationStatus,
      'applied',
      dungeon.augmentationStatus === 'applied'
        ? undefined
        : JSON.stringify(dungeon.augmentationDiagnostics),
    );
    assert.equal(
      dungeon.progression.validation.accepted,
      true,
      dungeon.progression.validation.errors.join('\n'),
    );
    const optionalPlans = dungeon.connectionPlans.filter((plan) => (
      plan.isDungeonSupplement && !plan.isSupplementGraphConnection
    ));
    assert.ok(optionalPlans.length > 0, 'witness seed did not materialize a physical branch');
    assert.ok(
      optionalPlans.some((plan) => Math.abs(Number(plan.sourceElevation ?? 0)) > EPSILON),
      'witness branch did not exercise a nonzero parent-region elevation',
    );
    const connectorSpineById = new Map(
      dungeon.progression.validation.platformability.connectorSpineChecks
        .map((check) => [check.connectionId, check]),
    );

    for (const plan of optionalPlans) {
      const spineCheck = connectorSpineById.get(plan.id);
      assert.ok(spineCheck, `${plan.id} was omitted from connector spine validation`);
      assert.equal(spineCheck.traversableOutward, true, `${plan.id} has no outward spine`);
      assert.equal(spineCheck.traversableReturn, true, `${plan.id} has no return spine`);
      const exteriorFloors = dungeon.floorTiles.filter((floor) => (
        (floor.connectionId === plan.id || floor.connectorId === plan.id)
        && !floor.roomId
      ));
      assert.ok(exteriorFloors.length >= 3, `${plan.id} did not realize a three-wide exterior floor`);
      const sourceElevation = Number(plan.sourceElevation ?? 0);
      const destinationElevation = Number(plan.destinationElevation ?? sourceElevation);
      if (Math.abs(destinationElevation - sourceElevation) <= EPSILON) {
        assert.ok(
          exteriorFloors.every((floor) => (
            Math.abs(Number(floor.elevation ?? 0) - sourceElevation) <= EPSILON
          )),
          `${plan.id} retained an off-elevation placeholder outside its bound region`,
        );
      } else {
        const minimumElevation = Math.min(sourceElevation, destinationElevation);
        const maximumElevation = Math.max(sourceElevation, destinationElevation);
        assert.ok(
          exteriorFloors.every((floor) => (
            Number(floor.elevation ?? 0) >= minimumElevation - EPSILON
            && Number(floor.elevation ?? 0) <= maximumElevation + EPSILON
          )),
          `${plan.id} realized a vertical floor outside its signed elevation span`,
        );
        assert.ok(
          exteriorFloors.some((floor) => (
            Math.abs(Number(floor.elevation ?? 0) - sourceElevation) <= EPSILON
          )),
          `${plan.id} has no source-elevation landing`,
        );
        assert.ok(
          exteriorFloors.some((floor) => (
            Math.abs(Number(floor.elevation ?? 0) - destinationElevation) <= EPSILON
          )),
          `${plan.id} has no destination-elevation landing`,
        );
      }
      for (const socket of [plan.fromSocket, plan.toSocket]) {
        assert.equal(
          wallRuns.some((run) => wallRunBlocksSocket(socket, run, dungeon.tileSize)),
          false,
          `${socket.id} is blocked by an assembled boundary wall`,
        );
      }
    }
    const entranceValidation = dungeon.progression.validation.connectorEntrances;
    assert.ok(entranceValidation.checkedSocketCount > 0);
    assert.equal(
      entranceValidation.acceptedSocketCount,
      entranceValidation.checkedSocketCount,
      JSON.stringify(entranceValidation.checks.filter((check) => !check.accepted), null, 2),
    );
    assert.ok(
      entranceValidation.checks.every((check) => (
        check.socketReachable
        && check.outsideReachable
        && check.traversableOutward
        && check.traversableReturn
        && check.blockingWallFacadeId === null
      )),
      'one or more generated connector mouths failed bidirectional reachability',
    );
  } finally {
    generator._disposeGeneratedDungeonCandidate(dungeon);
    generator._disposeGeneratedDungeonCandidate(acceptedParent);
  }
});

test('a forced-invalid overlay retains its accepted authored dungeon', { timeout: 120_000 }, () => {
  const sourceRandom = new SeededRandom(hashSeed(FALLBACK_SEED));
  let sourceRandomCalls = 0;
  const generator = new DungeonGenerator({
    random: () => {
      sourceRandomCalls += 1;
      return sourceRandom.next();
    },
    difficulty: 1,
    augmentationProfileId: 'industrial-supplement-preview-v1',
    augmentationSeed: FALLBACK_SEED,
    basePlanHash: FALLBACK_BASE_PLAN_HASH,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = 'connectorEntranceFallbackTexture';
  generator.textureCache.set('connectorEntranceFallbackTexture', inertTexture);
  generator._loadRuinTexture = () => inertTexture;
  const validateConnectorEntrances = generator
    ._validateConnectorEntranceWalkability
    .bind(generator);
  generator._validateConnectorEntranceWalkability = (specification) => {
    const validation = validateConnectorEntrances(specification);
    const hasSupplement = specification.connectionPlans?.some((plan) => (
      plan.isDungeonSupplement
    ));
    if (!hasSupplement) return validation;
    return {
      ...validation,
      accepted: false,
      errors: [
        ...validation.errors,
        'Synthetic regression rejection after connector-entrance validation.',
      ],
      warnings: [],
    };
  };

  let dungeon = null;
  try {
    dungeon = generator.generate();
    assert.equal(dungeon.progression.validation.accepted, true);
    assert.equal(dungeon.augmentationStatus, 'unchanged');
    assert.equal(dungeon.rooms.length, 13);
    assert.equal(dungeon.rooms.some((room) => room.isDungeonSupplement), false);
    assert.equal(dungeon.basePlanHash, FALLBACK_BASE_PLAN_HASH);
    assert.equal(dungeon.effectivePlanHash, FALLBACK_BASE_PLAN_HASH);
    assert.equal(dungeon.augmentationPlanHash, null);
    assert.equal(dungeon.generationAttempts, 4);
    assert.equal(sourceRandomCalls, 320);
    assert.equal(dungeon.augmentationReplayDiagnostics.accepted, false);
    assert.equal(dungeon.augmentationReplayDiagnostics.fallbackToAcceptedBase, true);
    assert.equal(dungeon.augmentationReplayDiagnostics.randomCallCount, 80);
    assert.ok(
      dungeon.augmentationReplayDiagnostics.consumedRandomCallCount > 0
        && dungeon.augmentationReplayDiagnostics.consumedRandomCallCount < 80,
      'connector preflight should reject before replaying renderer dressing RNG',
    );
    assert.equal(dungeon.augmentationReplayDiagnostics.parentGenerationAttempts, 4);
    assert.equal(dungeon.augmentationReplayDiagnostics.realizationAttempts, 8);
    assert.ok(dungeon.augmentationReplayDiagnostics.errors.length > 0);
    assert.equal(
      dungeon.augmentationDiagnostics.rejectedOverlay.attempts.length,
      8,
    );
    assert.ok(dungeon.augmentationDiagnostics.rejectedOverlay.attempts.every((attempt) => (
      attempt.consumedRandomCallCount > 0
        && attempt.consumedRandomCallCount < 80
        && typeof attempt.reason === 'string'
        && attempt.diagnostics
    )));
  } finally {
    disposeDungeon(dungeon);
    inertTexture.dispose();
  }
});
