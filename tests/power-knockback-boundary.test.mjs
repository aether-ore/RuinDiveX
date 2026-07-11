import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonController } from '../src/DungeonController.js';

function createFloor(xs, zs = [0], tileSize = 1) {
  const tiles = new Map();
  const floorTiles = [];
  for (const x of xs) {
    for (const z of zs) {
      const tile = { x, z, elevation: 0, level: 0 };
      tiles.set(`${x},${z}`, tile);
      floorTiles.push(tile);
    }
  }
  return { tiles, floorTiles, tileSize };
}

function createController({
  xs = [-3, -2, -1, 0, 1, 2, 3],
  doors = [],
  solidZones = [],
  aerialBoundaryZones = [],
} = {}) {
  const game = {
    player: {
      radius: 0.42,
      root: { position: new THREE.Vector3(-1.2, 0, 0) },
    },
    enemies: [],
    getPlatformFloorElevation: () => null,
    isPositionInsidePlatformBlock: () => false,
  };
  const dungeon = {
    ...createFloor(xs),
    doors,
    solidZones,
    aerialBoundaryZones,
    encounters: [],
    playerStart: new THREE.Vector3(-1.2, 0, 0),
  };
  return new DungeonController(game, dungeon);
}

function makeWall(id = 'boundary-room-separator') {
  return {
    id,
    label: 'Dungeon boundary wall',
    obstacleKind: 'boundaryWall',
    position: new THREE.Vector3(0, 2, 0),
    halfWidth: 0.1,
    halfDepth: 1.5,
    verticalHalfHeight: 2,
    allowFlyOver: false,
  };
}

test('landing recovery never chooses the valid room floor past a boundary wall', () => {
  const wall = makeWall();
  const controller = createController({
    xs: [-3, -2, -1, 1, 2, 3],
    aerialBoundaryZones: [wall],
  });
  const origin = new THREE.Vector3(-1.2, 0, 0);

  const landing = controller.resolvePowerKnockbackLanding(
    new THREE.Vector3(-0.1, 0.1, 0),
    new THREE.Vector3(1, 0, 0),
    origin,
  );

  assert.ok(landing);
  assert.equal(landing.mode, 'beforeObstacle');
  assert.ok(landing.position.x < -0.52, 'landing must remain on the launch side of the wall');
});

test('airborne knockback is clamped before crossing a boundary wall', () => {
  const controller = createController({ aerialBoundaryZones: [makeWall()] });
  const result = controller.resolvePowerKnockbackTravel(
    new THREE.Vector3(-1, 1, 0),
    new THREE.Vector3(1, 1, 0),
  );

  assert.equal(result?.blocked, true);
  assert.equal(result?.barrierKind, 'boundaryWall');
  assert.ok(result.position.x < -0.5);
});

test('closed doors cannot be bypassed by the forward-first landing scan', () => {
  const door = {
    id: 'sealed-test-door',
    position: new THREE.Vector3(0, 0, 0),
    alongX: true,
    collisionHalfWidth: 0.1,
    collisionHalfDepth: 1.4,
    collisionHeight: 4.8,
    closed: true,
  };
  const controller = createController({ doors: [door] });
  const origin = new THREE.Vector3(-1.2, 0, 0);

  const landing = controller.resolvePowerKnockbackLanding(
    new THREE.Vector3(-0.1, 0.1, 0),
    new THREE.Vector3(1, 0, 0),
    origin,
  );

  assert.ok(landing);
  assert.equal(landing.mode, 'beforeObstacle');
  assert.ok(landing.position.x < -0.52);
});

test('small fixtures retain forward past-obstacle recovery', () => {
  const crate = {
    id: 'small-crate',
    label: 'Small machinery crate',
    position: new THREE.Vector3(0, 0.6, 0),
    halfWidth: 0.3,
    halfDepth: 0.6,
    verticalHalfHeight: 0.6,
  };
  const controller = createController({ solidZones: [crate] });
  const origin = new THREE.Vector3(-1.2, 0, 0);

  const landing = controller.resolvePowerKnockbackLanding(
    new THREE.Vector3(0, 0.1, 0),
    new THREE.Vector3(1, 0, 0),
    origin,
  );

  assert.ok(landing);
  assert.equal(landing.mode, 'pastObstacle');
  assert.ok(landing.position.x > crate.halfWidth);
  assert.equal(
    controller.resolvePowerKnockbackTravel(origin, new THREE.Vector3(1.2, 1, 0)),
    null,
    'ordinary fixtures must not become hard room-separating barriers',
  );
});
