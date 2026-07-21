import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';

function navigationController() {
  const controller = Object.create(DungeonController.prototype);
  controller.tileSize = 4;
  controller.aerialBoundaryZones = [];
  controller.doors = [];
  controller.solidZones = [];
  controller.dungeon = { platforms: [] };
  controller.game = { _getPlatformingSurfaces: () => [] };
  controller._isResolvedFloorPositionWalkable = () => true;
  controller._isInsideAerialNavigableFootprint = () => true;
  controller._getAerialCeilingHeight = () => 8;
  return controller;
}

test('ordinary grounded navigation permanently excludes tagged harmful surfaces', () => {
  const controller = navigationController();
  assert.equal(controller._isFloorTileRuntimeWalkable({ x: 0, z: 0, elevation: 0 }), true);
  assert.equal(controller._isFloorTileRuntimeWalkable({
    x: 1, z: 0, elevation: 0, hazardTag: 'environmental:magma',
  }), false);
  assert.equal(controller._isFloorTileRuntimeWalkable({
    x: 2, z: 0, elevation: 0, hazardTag: 'environmental:electrical',
  }), false);
});

test('flyers cross hazard floors but still obey walls, ceilings, and closed gates', () => {
  const controller = navigationController();
  const from = new THREE.Vector3(-2, 2, 0);
  const to = new THREE.Vector3(2, 2, 0);

  // Hazard floors are deliberately absent from the aerial blocker set.
  assert.equal(controller.isAerialPathClear(from, to, { radius: 0.2, verticalRadius: 0.2 }), true);

  controller.aerialBoundaryZones.push({
    id: 'wall', obstacleKind: 'boundaryWall', position: new THREE.Vector3(0, 2, 0),
    halfWidth: 0.15, halfDepth: 2, verticalHalfHeight: 2, allowFlyOver: false,
  });
  assert.equal(controller.isAerialPathClear(from, to, { radius: 0.2, verticalRadius: 0.2 }), false,
    'an enclosed district wall must block a flyer');

  controller.aerialBoundaryZones.length = 0;
  controller._getAerialCeilingHeight = () => 2.1;
  assert.equal(controller.isAerialPositionClear(new THREE.Vector3(0, 2, 0), {
    radius: 0.2, verticalRadius: 0.2,
  }), false, 'the authored ceiling must block a flyer');

  controller._getAerialCeilingHeight = () => 8;
  controller.doors.push({
    id: 'Door_Test', closed: true, alongX: true,
    collisionPosition: new THREE.Vector3(0, 0, 0),
    collisionHalfWidth: 0.2, collisionHalfDepth: 2,
    collisionHeight: 5,
  });
  assert.equal(controller.isAerialPathClear(from, to, { radius: 0.2, verticalRadius: 0.2 }), false,
    'a closed plan-owned gate must block a flyer');
  controller.doors[0].closed = false;
  assert.equal(controller.isAerialPathClear(from, to, { radius: 0.2, verticalRadius: 0.2 }), true,
    'opening the gate restores the otherwise safe aerial route');
});
