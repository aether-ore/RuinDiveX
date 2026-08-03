import assert from 'node:assert/strict';
import test from 'node:test';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

const createRoom = (id, x) => ({
  id,
  type: 'enemy',
  x,
  z: 0,
  width: 9,
  depth: 9,
  baseElevation: 0,
});

const createRoomFloors = (room) => {
  const floors = [];
  for (let x = room.x - 4; x <= room.x + 4; x += 1) {
    for (let z = -4; z <= 4; z += 1) {
      floors.push({
        x,
        z,
        elevation: 0,
        level: 0,
        type: 'floor',
        surface: 'floor',
        roomId: room.id,
      });
    }
  }
  return floors;
};

const pointCoordinates = (points) => points.map((point) => point.toArray());

test('finalized room spawn context compiles invariant floor filtering once without output drift', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const rooms = [createRoom('room-a', -6), createRoom('room-b', 6)];
  const floorTiles = rooms.flatMap(createRoomFloors);
  const solidZones = [];
  const occupiedSupportCellIdSets =
    generator._createSolidZoneOccupiedSupportCellIdSets(solidZones);
  const createBlockingPlatformColumnMap =
    generator._createBlockingPlatformColumnMap.bind(generator);
  const isFloorTileBlockedBySolidZone =
    generator._isFloorTileBlockedBySolidZone.bind(generator);
  let blockingPlatformBuildCount = 0;
  let solidZoneCheckCount = 0;
  generator._createBlockingPlatformColumnMap = (...args) => {
    blockingPlatformBuildCount += 1;
    return createBlockingPlatformColumnMap(...args);
  };
  generator._isFloorTileBlockedBySolidZone = (...args) => {
    solidZoneCheckCount += 1;
    return isFloorTileBlockedBySolidZone(...args);
  };

  const uncached = rooms.map((room) => generator._roomSpawnPoints(
    room,
    floorTiles,
    solidZones,
    occupiedSupportCellIdSets,
  ));
  assert.equal(blockingPlatformBuildCount, rooms.length);
  assert.equal(solidZoneCheckCount, floorTiles.length * rooms.length);

  blockingPlatformBuildCount = 0;
  solidZoneCheckCount = 0;
  const context = generator._createFinalizedRoomSpawnContext(
    floorTiles,
    solidZones,
    occupiedSupportCellIdSets,
  );
  const cached = rooms.map((room) => generator._roomSpawnPoints(
    room,
    floorTiles,
    solidZones,
    occupiedSupportCellIdSets,
    context,
  ));

  assert.deepEqual(cached.map(pointCoordinates), uncached.map(pointCoordinates));
  assert.equal(blockingPlatformBuildCount, 1);
  assert.equal(solidZoneCheckCount, floorTiles.length);

  const replay = generator._roomSpawnPoints(
    rooms[0],
    floorTiles,
    solidZones,
    occupiedSupportCellIdSets,
    context,
  );
  assert.deepEqual(pointCoordinates(replay), pointCoordinates(cached[0]));
  assert.notEqual(replay[0], cached[0][0]);
  assert.equal(blockingPlatformBuildCount, 1);
  assert.equal(solidZoneCheckCount, floorTiles.length);
});
