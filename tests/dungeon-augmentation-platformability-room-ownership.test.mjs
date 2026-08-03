import assert from 'node:assert/strict';
import test from 'node:test';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

const floorKey = (x, z, elevation) => `${x},${z}@y${Number(elevation).toFixed(3)}`;

function createStackedRoomValidation({ upperOwnerId }) {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const supplementRoomId = 'supplement:fixture:routeNetwork:3:node:1';
  const upperFloor = {
    x: 0,
    z: 0,
    elevation: 5,
    type: 'floor',
    surface: 'parentUpperTier',
    roomId: upperOwnerId,
  };
  const hubFloor = {
    x: -2,
    z: 0,
    elevation: 0,
    type: 'floor',
    surface: 'hubFloor',
    roomId: 'hubTown',
    traversalLinks: [{
      id: 'fixture-parent-lift',
      toFloorKey: floorKey(upperFloor.x, upperFloor.z, upperFloor.elevation),
      action: 'automatic_lift',
    }],
  };
  const corridorFloor = {
    x: -1,
    z: 0,
    elevation: 0,
    type: 'floor',
    surface: 'hallway',
    roomId: 'fixtureCorridor',
  };
  const supplementBaseFloor = {
    x: 0,
    z: 0,
    elevation: 0,
    type: 'floor',
    surface: 'supplementBase',
    roomId: supplementRoomId,
    augmentationFloorCellId: `${supplementRoomId}:floor-tier:base:cell:0:0`,
  };
  const rooms = [{
    id: 'hubTown',
    type: 'hub',
    x: -2,
    z: 0,
    width: 1,
    depth: 1,
    baseElevation: 0,
  }, {
    id: supplementRoomId,
    type: 'industrial',
    x: 0,
    z: 0,
    width: 3,
    depth: 3,
    baseElevation: 0,
    ceilingHeight: 4,
    isDungeonSupplement: true,
    augmentationFloorTiers: [{
      id: 'base',
      runtimeId: `${supplementRoomId}:floor-tier:base`,
      authoritative: true,
      worldCells: [{
        id: supplementBaseFloor.augmentationFloorCellId,
        grid: { x: 0, z: 0 },
        elevation: 0,
      }],
    }],
  }];

  return generator._validatePlatformability({
    floorTiles: [hubFloor, corridorFloor, supplementBaseFloor, upperFloor],
    rooms,
    solidZones: [],
    connectionPlans: [],
    doors: [],
    landmarks: {},
    encounters: [],
  });
}

test('authoritative V4 room ceiling checks ignore reachable floors owned by a stacked parent', () => {
  const supplementRoomId = 'supplement:fixture:routeNetwork:3:node:1';
  const foreignUpperValidation = createStackedRoomValidation({
    upperOwnerId: 'parentUpperRoom',
  });
  assert.equal(
    foreignUpperValidation.errors.some((error) => (
      error === `${supplementRoomId} lacks ceiling clearance above its highest reachable tier.`
    )),
    false,
    foreignUpperValidation.errors.join('\n'),
  );

  const ownedUpperValidation = createStackedRoomValidation({
    upperOwnerId: supplementRoomId,
  });
  assert.equal(
    ownedUpperValidation.errors.some((error) => (
      error === `${supplementRoomId} lacks ceiling clearance above its highest reachable tier.`
    )),
    true,
    'a genuinely room-owned upper tier must still satisfy the ceiling validator',
  );
});
