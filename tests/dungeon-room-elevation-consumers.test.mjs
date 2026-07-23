import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonController } from '../src/DungeonController.js';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
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
