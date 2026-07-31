import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonController } from '../src/DungeonController.js';
import {
  DungeonGenerator,
  resolveDungeonSupplementLadderFace,
} from '../src/DungeonGenerator.js';
import { createDungeonProgressionData } from '../src/DungeonProgression.js';
import { Player } from '../src/Player.js';

const makeRoom = (overrides = {}) => ({
  id: 'keycardRoom',
  type: 'keycard',
  x: 4,
  z: 7,
  width: 9,
  depth: 9,
  baseElevation: 14,
  floorElevation: 14,
  minY: 12,
  maxY: 20,
  ceilingHeight: 10,
  ceilingY: 24,
  exitSockets: [],
  mechanicalPyramidCenter: { x: 4, z: 7, elevation: 4 },
  ...overrides,
});

test('supplement ladder mounts on the lower approach face instead of inside the upper wall', () => {
  const owner = { id: 'supplement-ladder-room' };
  const floor = (x, z, elevation) => ({
    roomId: owner.id,
    x,
    z,
    elevation,
  });
  const lowerApproach = floor(33, 38, 28);
  const face = resolveDungeonSupplementLadderFace({
    owner,
    centerGrid: { x: 34, z: 38 },
    bottomElevation: 28,
    topElevation: 30.8,
    floorTiles: [
      lowerApproach,
      floor(34, 38, 28),
      floor(34, 38, 30.8),
      floor(35, 38, 30.8),
      floor(34, 37, 28),
      floor(34, 37, 30.8),
      floor(34, 39, 28),
      floor(34, 39, 30.8),
    ],
  });

  assert.deepEqual(face.normal, { x: -1, z: 0 });
  assert.equal(face.bottomApproachFloor, lowerApproach);
  assert.equal(face.planeOffsetTiles, 0.5);
  assert.equal(face.source, 'floor-tier-transition');
});

test('legacy conveyor decoration cannot rewrite authoritative supplement floor elevations', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const authoritative = {
    type: 'floor',
    surface: 'industrialSupplementTier',
    x: 0,
    z: 0,
    elevation: 0,
    roomId: 'supplement-room',
    augmentationBlueprintId: 'ind-room-ladder-defense-rise-01',
    augmentationFloorTierRuntimeId: 'supplement-room:floor-tier:base',
    augmentationFloorCellId: 'supplement-room:floor-tier:base:cell:0:0',
  };
  const ordinary = { type: 'floor', x: 1, z: 0, elevation: 0 };
  const tiles = new Map([
    ['0,0', authoritative],
    ['1,0', ordinary],
  ]);

  generator._markConveyorBridge(
    tiles,
    { id: 'from' },
    { id: 'to' },
    { path: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
  );

  assert.equal(authoritative.elevation, 0);
  assert.equal(authoritative.surface, 'industrialSupplementTier');
  assert.equal(ordinary.surface, 'conveyorBridge');
});

test('player weapon origins retain their local height at signed room elevations', () => {
  for (const baseElevation of [0, -14, 14]) {
    const player = Object.create(Player.prototype);
    player.root = { position: new THREE.Vector3(3, baseElevation, 5) };
    player._getActiveBusterArmSide = () => 'left';
    player.humanoid = {
      getAttachmentPoint: () => ({
        getWorldPosition: (target) => target.set(3.2, baseElevation + 0.25, 5.3),
      }),
    };
    player.externalRig = {
      getBusterMuzzleWorldPosition: (target) => target.set(3.3, baseElevation + 0.3, 5.4),
      getDrillTipWorldPosition: (target) => target.set(3.4, baseElevation + 0.2, 5.5),
    };

    player.getActiveArmWeapon = () => ({ type: 'busterArm' });
    const handOrigin = player.getAttackOrigin();
    const busterOrigin = player.getProjectileOrigin();
    player.getActiveArmWeapon = () => ({ type: 'drillArm' });
    const drillOrigin = player.getProjectileOrigin();

    assert.equal(handOrigin.y - baseElevation, 1);
    assert.equal(busterOrigin.y - baseElevation, 1);
    assert.ok(Math.abs((drillOrigin.y - baseElevation) - 0.9) < 0.000001);
    assert.deepEqual([handOrigin.x, handOrigin.z], [3.2, 5.3]);
    assert.deepEqual([busterOrigin.x, busterOrigin.z], [3.3, 5.4]);
    assert.deepEqual([drillOrigin.x, drillOrigin.z], [3.4, 5.5]);
  }
});

test('room-owned facade zones and encounters use absolute room elevation', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const room = makeRoom();
  const plan = {
    id: 'keycardRoom_trapRoom_ground',
    fromRoomId: room.id,
    toRoomId: 'trapRoom',
    connectorType: 'ladder_gallery',
    level: 0,
    elevation: 14,
    sourceElevation: 14,
    destinationElevation: 0,
    elevationDelta: -14,
    direction: 'descending',
    purpose: 'main_route',
    fromSocket: { id: 'from', elevation: 14 },
    toSocket: { id: 'to', elevation: 0 },
  };

  const [facade] = generator._createVerticalConnectors([room], [plan]);
  assert.equal(facade.position.y, 14);
  assert.equal(facade.baseElevation, 14);
  assert.equal(facade.ceilingY, 24);
  assert.deepEqual(
    facade.connections.map(({ sourceElevation, destinationElevation, elevationDelta, direction }) => ({
      sourceElevation,
      destinationElevation,
      elevationDelta,
      direction,
    })),
    [{ sourceElevation: 14, destinationElevation: 0, elevationDelta: -14, direction: 'descending' }],
  );

  const [zone] = generator._createRoomZones([room], 'keycard');
  assert.equal(zone.position.y, 14);

  const [encounter] = generator._createEncounterDefinitions([room], null, []);
  assert.equal(encounter.zone.position.y, 14);
  assert.equal(encounter.triggerZone.position.y, 18);
  assert.ok(encounter.spawnPoints.every((point) => point.y === 14));
});

test('aerial collision reads absolute signed room and connector ceilings', () => {
  const positiveRoom = makeRoom();
  const negativeRoom = makeRoom({
    id: 'negativeRoom',
    x: 20,
    baseElevation: -14,
    floorElevation: -14,
    minY: -14,
    maxY: -4,
    ceilingY: -4,
  });
  const controller = Object.create(DungeonController.prototype);
  controller.tileSize = 2.8;
  controller.dungeon = { rooms: [positiveRoom, negativeRoom] };
  controller.tiles = new Map([
    ['100,0', {
      x: 100,
      z: 0,
      elevation: 14,
      connectorMinY: 14,
      connectorCeilingY: 22.4,
    }],
  ]);
  controller.floorTilesByColumn = new Map([
    ['100,0', [{ x: 100, z: 0, elevation: 14, connectorCeilingY: 22.4 }]],
    ['101,0', [{ x: 101, z: 0, elevation: -14 }]],
  ]);

  assert.equal(
    controller._getAerialCeilingHeight(new THREE.Vector3(positiveRoom.x * 2.8, 16, positiveRoom.z * 2.8)),
    24,
  );
  assert.equal(
    controller._getAerialCeilingHeight(new THREE.Vector3(negativeRoom.x * 2.8, -10, negativeRoom.z * 2.8)),
    -4,
  );
  assert.equal(controller._getAerialCeilingHeight(new THREE.Vector3(280, 16, 0)), 22.4);
  assert.ok(Math.abs(
    controller._getAerialCeilingHeight(new THREE.Vector3(282.8, -13, 0)) - (-5.6),
  ) < 0.000001);
});

test('room-local landmark and console placement follows positive and negative bases', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  generator._addLargeRefractorShrine = (group, position) => {
    const object = new THREE.Group();
    object.position.copy(position);
    group.add(object);
    return object;
  };
  const shrineRoom = makeRoom({
    id: 'shrineRoom',
    type: 'shrine',
    baseElevation: -14,
    floorElevation: -14,
    minY: -14,
    maxY: -7,
    ceilingY: -4,
    mechanicalPyramidCenter: null,
    refractorFocalPoint: { x: 4, z: 7, elevation: 5.5 },
  });
  const landmarks = generator._addRoomLandmarks(
    new THREE.Group(),
    [shrineRoom],
    {},
    new Map(),
    [],
    [],
  );
  assert.equal(landmarks.shrine.position.y, -8.5);

  const conveyorRoom = makeRoom({ id: 'conveyorRoom', type: 'conveyor' });
  const baseTile = { x: 4, z: 7, roomId: conveyorRoom.id, elevation: 14, level: 5, surface: 'floor', type: 'floor' };
  const upperTile = { x: 5, z: 7, roomId: conveyorRoom.id, elevation: 18, level: 0, surface: 'floor', type: 'floor' };
  const resolved = generator._resolveConveyorConsoleTile(
    { x: 4, z: 7 },
    conveyorRoom,
    [upperTile, baseTile],
    [],
  );
  assert.equal(resolved, baseTile);
});

test('translated V1 structural supports stop at the owning room floor', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const material = new THREE.MeshBasicMaterial();
  const group = new THREE.Group();
  const baseTile = {
    x: 0,
    z: 0,
    elevation: 14,
    roomBaseElevation: 14,
    surface: 'catwalk',
  };
  generator._addFactoryTileSupports(group, baseTile, { supportMetal: material });
  assert.equal(group.children.length, 0, 'the translated room floor is not a raised catwalk');

  const upperTile = { ...baseTile, elevation: 18 };
  generator._addFactoryTileSupports(group, upperTile, { supportMetal: material });
  const posts = group.children.filter((object) => object.name === 'factoryCatwalkSupport');
  assert.equal(posts.length, 4);
  assert.ok(posts.every((post) => post.position.y > 14 && post.position.y < 18));

  const [assembly] = generator._createSolidArchitecturalDeckAssemblies([{
    ...upperTile,
    roomId: 'translatedRoom',
    massGroupId: 'translatedDeck',
    supportStyle: 'solid_mass',
  }]);
  assert.equal(assembly.baseElevation, 14);
  material.dispose();
});

test('module-local platform tier names cannot merge collision or render masses across rooms', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const platformTile = (roomId, x, z) => ({
    roomId,
    x,
    z,
    elevation: 16.8,
    roomBaseElevation: 14,
    level: 1,
    surface: 'supplementAuthoredFloor',
    type: 'floor',
    isPlatformingSurface: true,
    platformGroupId: 'upper',
  });
  const tiles = [
    platformTile('supplementRoomA', 0, 0),
    platformTile('supplementRoomA', 1, 0),
    platformTile('supplementRoomA', 0, 1),
    platformTile('supplementRoomB', 20, 20),
    platformTile('supplementRoomB', 21, 20),
  ];

  const assemblies = generator._createPurposePlatformAssemblies(tiles);
  assert.equal(assemblies.length, 2);
  assert.deepEqual(
    assemblies.map(({ roomId }) => roomId).sort(),
    ['supplementRoomA', 'supplementRoomB'],
  );
  for (const assembly of assemblies) {
    const representedTileCount = assembly.rectangles.reduce((total, rectangle) => (
      total
      + (rectangle.maxX - rectangle.minX + 1)
        * (rectangle.maxZ - rectangle.minZ + 1)
    ), 0);
    assert.equal(representedTileCount, assembly.tiles.length);
    assert.equal(assembly.localGroupId, 'upper');
  }

  const surfaces = generator._createGeneratedPlatformSurfaces(tiles);
  assert.equal(surfaces.length, 3, 'the L mask remains two exact rectangles plus room B');
  assert.ok(surfaces.every(({ id }) => id !== 'generatedSolidPlatform_upper'));
  assert.ok(surfaces.every(({ halfWidth, halfDepth }) => halfWidth < 6 && halfDepth < 6));
  assert.deepEqual(
    [...new Set(surfaces.map(({ roomId }) => roomId))].sort(),
    ['supplementRoomA', 'supplementRoomB'],
  );
});

test('orphan connector envelopes cannot emit shell geometry without nearby footing', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const floorTiles = [
    { x: 0, z: 0, elevation: 0, roomId: 'authoredRoom' },
    { x: 1, z: 0, elevation: 0, connectionId: 'routeA' },
  ];
  const nearEnvelope = {
    x: 2,
    z: 1,
    structuralEnvelopeOnly: true,
    surface: 'connectorStructuralEnvelope',
    connectionId: 'routeA',
  };
  const orphanEnvelope = {
    x: 6,
    z: 5,
    structuralEnvelopeOnly: true,
    surface: 'connectorStructuralEnvelope',
    connectionId: 'routeA',
  };
  const authoredStructure = { x: 8, z: 8, roomId: 'authoredRoom', type: 'floor' };
  const tiles = new Map([
    ['2,1', nearEnvelope],
    ['6,5', orphanEnvelope],
    ['8,8', authoredStructure],
  ]);

  const diagnostics = generator._pruneOrphanStructuralEnvelopeCells(tiles, floorTiles);

  assert.equal(diagnostics.removedCellCount, 1);
  assert.deepEqual(diagnostics.removedCells, [{
    x: 6,
    z: 5,
    connectionId: 'routeA',
    roomId: null,
  }]);
  assert.equal(tiles.get('2,1'), nearEnvelope, 'one-cell shell padding remains valid');
  assert.equal(tiles.has('6,5'), false, 'unowned shell island is removed authoritatively');
  assert.equal(tiles.get('8,8'), authoredStructure, 'authored geometry is never pruned');
});

test('authoritative V4 realization removes detached connector gallery duplicates only', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const entrance = { id: 'entrance', x: 0, z: 0, isDungeonSupplement: false };
  const entranceFloor = { x: 0, z: 0, elevation: 0, roomId: 'entrance', surface: 'floor' };
  const connectedGallery = {
    x: 1,
    z: 0,
    elevation: 0,
    connectionId: 'connectedRoute',
    surface: 'connectorGalleryFloor',
  };
  const orphanGalleryA = {
    x: 10,
    z: 10,
    elevation: 0,
    connectionId: 'phantomUpperRoute',
    surface: 'connectorGalleryFloor',
  };
  const orphanGalleryB = { ...orphanGalleryA, x: 11 };
  const authoredRoomFloor = {
    x: 20,
    z: 20,
    elevation: 0,
    roomId: 'authoredDestination',
    surface: 'floor',
  };
  const disconnectedPlatform = {
    x: 30,
    z: 30,
    elevation: 4,
    roomId: 'authoredDestination',
    surface: 'jumpPlatform',
    isPlatformingSurface: true,
  };
  const floorTiles = [
    entranceFloor,
    connectedGallery,
    orphanGalleryA,
    orphanGalleryB,
    authoredRoomFloor,
    disconnectedPlatform,
  ];
  const tiles = new Map(floorTiles.map((floor) => [`${floor.x},${floor.z}`, floor]));

  const result = generator._pruneDisconnectedConnectorGalleryFloors(
    tiles,
    floorTiles,
    [entrance, { id: 'authoredDestination', x: 20, z: 20 }],
  );

  assert.equal(result.diagnostics.removedFloorTileCount, 2);
  assert.deepEqual(result.diagnostics.removedFloorTilesByConnectionId, {
    phantomUpperRoute: 2,
  });
  assert.ok(result.floorTiles.includes(connectedGallery));
  assert.ok(result.floorTiles.includes(authoredRoomFloor));
  assert.ok(result.floorTiles.includes(disconnectedPlatform));
  assert.ok(!result.floorTiles.includes(orphanGalleryA));
  assert.ok(!result.floorTiles.includes(orphanGalleryB));
  assert.equal(tiles.has('10,10'), false);
  assert.equal(tiles.has('11,10'), false);
});

test('translated conveyor puzzle keys retain their authored absolute floor layer', () => {
  const observedHints = [];
  const controller = {
    tileSize: 2.8,
    _parseTileKey: DungeonController.prototype._parseTileKey,
    getTileElevation(x, z, elevationHint) {
      observedHints.push({ x, z, elevationHint });
      return elevationHint;
    },
  };
  const position = DungeonController.prototype._getConveyorPuzzleTilePosition.call(
    controller,
    {
      spawner: { key: '1,2', position: new THREE.Vector3(2.8, -14, 5.6) },
      target: { key: '4,2', position: new THREE.Vector3(11.2, -14, 5.6) },
    },
    '3,2',
  );
  assert.ok(position.distanceTo(new THREE.Vector3(8.4, -14, 5.6)) < 0.000001);
  assert.deepEqual(observedHints, [{ x: 3, z: 2, elevationHint: -14 }]);
});

test('room elevation commit refreshes canonical floor identities from absolute Y', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const lowerRoom = makeRoom({
    id: 'lowerRoom',
    plannedBaseElevation: -14,
    baseElevation: 0,
    dropSpace: {
      entryFloorKeys: ['3,5@y0.000'],
      entryLipFloorKeys: ['3,5@y0.000'],
      lowerFloorKeys: ['3,5@y0.000'],
      bridgeFloorKeys: ['3,5@y0.000'],
      returnShelfFloorKeys: ['3,5@y0.000'],
      exitFloorKeys: ['3,5@y0.000'],
    },
  });
  const upperRoom = makeRoom({
    id: 'upperRoom',
    plannedBaseElevation: 14,
    baseElevation: 0,
  });
  const lowerFloor = {
    x: 3,
    z: 5,
    level: 0,
    elevation: 0,
    floorKey: '3,5@y0.000',
    roomId: lowerRoom.id,
  };
  const upperFloor = {
    x: 3,
    z: 5,
    level: 0,
    elevation: 0,
    floorKey: '3,5@y0.000',
    roomId: upperRoom.id,
  };

  generator._commitResolvedRoomElevations({
    rooms: [lowerRoom, upperRoom],
    tiles: new Map(),
    floorTiles: [lowerFloor, upperFloor],
    connectionPlans: [],
    solidZones: [],
  });

  assert.equal(lowerFloor.elevation, -14);
  assert.equal(upperFloor.elevation, 14);
  assert.equal(lowerFloor.floorKey, '3,5@y-14.000');
  assert.equal(upperFloor.floorKey, '3,5@y14.000');
  for (const keys of Object.values(lowerRoom.dropSpace)) {
    assert.deepEqual(keys, ['3,5@y-14.000']);
  }
  assert.notEqual(
    generator._getFloorTileGraphKey(lowerFloor),
    generator._getFloorTileGraphKey(upperFloor),
  );
});

test('minimap retains absolute room and route elevations', () => {
  const keycard = makeRoom({ localTierMap: [{ level: 0, elevation: 14 }, { level: 1, elevation: 18 }] });
  const trap = makeRoom({
    id: 'trapRoom',
    type: 'trap',
    baseElevation: 0,
    floorElevation: 0,
    minY: -2,
    maxY: 4,
    ceilingY: 10,
    localTierMap: [{ level: 0, elevation: 0 }],
  });
  const progression = createDungeonProgressionData({
    rooms: [keycard, trap],
    landmarks: { keycards: [], keySeeker: null, shrine: null },
    chests: [],
    encounters: [],
    connectionPlans: [{
      id: 'keycardRoom_trapRoom_ground',
      logicalConnectionId: 'keycardRoom_trapRoom',
      fromRoomId: keycard.id,
      toRoomId: trap.id,
      connectorType: 'ladder_gallery',
      level: 0,
      elevation: 14,
      sourceElevation: 14,
      destinationElevation: 0,
      elevationDelta: -14,
      direction: 'descending',
      routeClassification: 'main_route',
      fromSocket: { id: 'from', elevation: 14 },
      toSocket: { id: 'to', elevation: 0 },
    }],
  });
  const minimapRoom = progression.minimap.rooms.find((room) => room.roomId === keycard.id);
  assert.equal(minimapRoom.baseElevation, 14);
  assert.equal(minimapRoom.ceilingY, 24);
  assert.deepEqual(minimapRoom.elevations, [14, 18]);
  assert.deepEqual(minimapRoom.localElevations, [0, 4]);
  assert.deepEqual(progression.minimap.hallways[0].elevationTransfers[0], {
    routeId: 'keycardRoom_trapRoom_ground',
    sourceElevation: 14,
    destinationElevation: 0,
    elevationDelta: -14,
    direction: 'descending',
  });
  assert.equal(progression.minimap.hallways[0].routes[0].routeClassification, 'main_route');
});
