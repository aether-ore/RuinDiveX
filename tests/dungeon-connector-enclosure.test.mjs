import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../src/TraversalCapabilities.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

const REAL_SEED = 'v1-bidirectional-connector-sweep-0000';
const AUGMENTED_SEED = 'layout:augmentation-runtime-check';
const AUGMENTED_BASE_PLAN_HASH = 'v1:layout:augmentation-runtime-check:depth:1:revolvingFusillade';
const ADJACENT_THRESHOLD_WITNESS_SEED = 'layout:augmentation-v2-witness-023';
const ADJACENT_THRESHOLD_WITNESS_BASE_PLAN_HASH =
  'v1:layout:augmentation-v2-witness-023:depth:1:revolvingFusillade';
const AUGMENTATION_PROFILE_ID = 'industrial-supplement-preview-v2';
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

test('a late augmented assembly throw disposes the partial candidate exactly once', { timeout: 60_000 }, () => {
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
  ) => {
    const runs = collectBoundaryWallRuns(
      tiles,
      openAirTileKeys,
      rooms,
      connectorWallOpenings,
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
    augmentationProfileId: AUGMENTATION_PROFILE_ID,
    augmentationSeed: ADJACENT_THRESHOLD_WITNESS_SEED,
    basePlanHash: ADJACENT_THRESHOLD_WITNESS_BASE_PLAN_HASH,
  });
  const inertTexture = new THREE.Texture();
  inertTexture.name = 'adjacentThresholdWitnessTexture';
  generator._loadRuinTexture = () => inertTexture;

  let dungeon = null;
  try {
    dungeon = generator.generate();
    assert.equal(dungeon.augmentationStatus, 'applied');
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
    for (const doorId of ['Door_Beta', 'Door_Gamma']) {
      const door = doorById.get(doorId);
      assert.ok(door, `${doorId} was not assembled`);
      assert.ok(
        door.thresholdReservedConnectorApertureCount > 0,
        `${doorId} did not reserve its adjacent supplemental connector aperture`,
      );
    }
  } finally {
    disposeDungeon(dungeon);
    inertTexture.dispose();
  }
});

test('a nonzero-elevation supplement keeps every connector mouth open and reachable', { timeout: 60_000 }, () => {
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

  let wallRuns = [];
  const collectBoundaryWallRuns = generator._collectBoundaryWallRuns.bind(generator);
  generator._collectBoundaryWallRuns = (
    tiles,
    openAirTileKeys,
    rooms,
    connectorWallOpenings,
  ) => {
    wallRuns = collectBoundaryWallRuns(
      tiles,
      openAirTileKeys,
      rooms,
      connectorWallOpenings,
    );
    return wallRuns;
  };

  let dungeon = null;
  try {
    dungeon = generator.generate();
    assert.equal(dungeon.augmentationStatus, 'applied');
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

    for (const plan of optionalPlans) {
      const exteriorFloors = dungeon.floorTiles.filter((floor) => (
        (floor.connectionId === plan.id || floor.connectorId === plan.id)
        && !floor.roomId
      ));
      assert.ok(exteriorFloors.length >= 3, `${plan.id} did not realize a three-wide exterior floor`);
      assert.ok(
        exteriorFloors.every((floor) => (
          Math.abs(Number(floor.elevation ?? 0) - Number(plan.sourceElevation ?? 0)) <= EPSILON
        )),
        `${plan.id} retained a zero-elevation placeholder outside its bound region`,
      );
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
    disposeDungeon(dungeon);
    inertTexture.dispose();
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
    assert.equal(dungeon.generationAttempts, 7);
    assert.equal(sourceRandomCalls, 560);
    assert.equal(dungeon.augmentationReplayDiagnostics.accepted, false);
    assert.equal(dungeon.augmentationReplayDiagnostics.fallbackToAcceptedBase, true);
    assert.equal(dungeon.augmentationReplayDiagnostics.randomCallCount, 80);
    assert.ok(
      dungeon.augmentationReplayDiagnostics.consumedRandomCallCount > 0
        && dungeon.augmentationReplayDiagnostics.consumedRandomCallCount < 80,
      'connector preflight should reject before replaying renderer dressing RNG',
    );
    assert.equal(dungeon.augmentationReplayDiagnostics.parentGenerationAttempts, 7);
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
