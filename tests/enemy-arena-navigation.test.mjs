import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonController } from '../src/DungeonController.js';
import { Enemy, ENEMY_TYPES } from '../src/Enemy.js';
import { EnemySpawner } from '../src/EnemySpawner.js';

function createFloor(width = 9, tileSize = 2) {
  const tiles = new Map();
  const floorTiles = [];
  const half = Math.floor(width / 2);
  for (let x = -half; x <= half; x += 1) {
    for (let z = -half; z <= half; z += 1) {
      const tile = { x, z, elevation: 0, level: 0 };
      tiles.set(`${x},${z}`, tile);
      floorTiles.push(tile);
    }
  }
  return { tiles, floorTiles, tileSize };
}

function createFloorFromTiles(floorTiles, tileSize = 2) {
  const tiles = new Map();
  for (const tile of floorTiles) {
    const key = `${tile.x},${tile.z}`;
    const current = tiles.get(key);
    if (!current || (tile.elevation ?? 0) < (current.elevation ?? 0)) {
      tiles.set(key, tile);
    }
  }
  return { tiles, floorTiles, tileSize };
}

function createController({
  solidZones = [],
  doors = [],
  aerialBoundaryZones = [],
  floor = createFloor(),
} = {}) {
  const game = {
    enemies: [],
    player: { radius: 0.42, root: { position: new THREE.Vector3() } },
    getPlatformFloorElevation: () => null,
    isPositionInsidePlatformBlock: () => false,
  };
  const dungeon = {
    ...floor,
    solidZones,
    doors,
    aerialBoundaryZones,
    encounters: [],
    playerStart: new THREE.Vector3(),
  };
  const controller = new DungeonController(game, dungeon);
  game.dungeonController = controller;
  return { controller, game };
}

function createEnemy(position = new THREE.Vector3()) {
  const enemy = {
    id: 'arena-test-enemy',
    dead: false,
    radius: 0.58,
    collisionHeight: 1.4,
    navigationMode: 'ground',
    stats: { moveSpeed: 3.2 },
    root: { position: position.clone() },
    encounterArena: null,
    navigationRecoveryTarget: null,
    navigationRecoveryTimer: 0,
    wallContactCount: 0,
    shouldIgnoreGroundConstraint: () => false,
  };
  enemy.setEncounterArena = Enemy.prototype.setEncounterArena.bind(enemy);
  enemy.setNavigationRecoveryTarget = Enemy.prototype.setNavigationRecoveryTarget.bind(enemy);
  enemy.clearNavigationRecoveryTarget = Enemy.prototype.clearNavigationRecoveryTarget.bind(enemy);
  return enemy;
}

function createRailingTraversalFixture({
  doors = [],
  aerialBoundaryZones = [],
} = {}) {
  const floorTiles = [];
  for (let x = -1; x <= 3; x += 1) {
    for (let z = -1; z <= 1; z += 1) {
      floorTiles.push({
        x,
        z,
        elevation: x <= 0 ? 2 : 0,
        level: x <= 0 ? 1 : 0,
        surface: x <= 0 ? 'secondFloor' : 'floor',
        roomId: 'railing-traversal-room',
      });
    }
  }
  const { controller } = createController({
    floor: createFloorFromTiles(floorTiles),
    doors,
    aerialBoundaryZones,
  });
  controller.playerRailTopSurfaces = [{
    id: 'enemy-railing-traversal-rail',
    center: new THREE.Vector3(1, 2.68, 0),
    halfWidth: 0.04,
    halfDepth: 3,
    topY: 2.715,
    horizontal: false,
  }];
  const enemy = createEnemy(new THREE.Vector3(0.5, 2, 0));
  const blockedPosition = new THREE.Vector3(0.9, 2, 0);
  const desiredTarget = new THREE.Vector3(4, 0, 0);
  return { controller, enemy, blockedPosition, desiredTarget };
}

test('legacy enemies receive the faster shared movement baseline', () => {
  assert.ok(ENEMY_TYPES.basic.moveSpeed >= 2.4);
  assert.ok(ENEMY_TYPES.fast.moveSpeed >= 3.65);
  assert.ok(ENEMY_TYPES.tank.moveSpeed >= 1.75);
  assert.ok(ENEMY_TYPES.ranged.moveSpeed >= 2.2);
  assert.ok(ENEMY_TYPES.horokko.moveSpeed >= 2.55);
  assert.ok(ENEMY_TYPES.gorubesshu.moveSpeed >= 1.6);
});

test('encounter arenas preserve free pursuit centrally and pull edge campers inward', () => {
  const { controller } = createController();
  const enemy = createEnemy(new THREE.Vector3(0, 0, 0));
  enemy.setEncounterArena({
    id: 'test-arena',
    zone: {
      position: new THREE.Vector3(0, 0, 0),
      halfWidth: 8,
      halfDepth: 7,
    },
  });

  const desired = new THREE.Vector3(5, 0, 1);
  const centralTarget = controller.getEnemyArenaTarget(enemy, desired);
  assert.ok(centralTarget.distanceTo(desired) < 0.001);

  enemy.root.position.set(enemy.encounterArena.softHalfWidth * 0.97, 0, 0);
  assert.equal(controller.shouldEnemyRecenter(enemy), true);
  const edgeTarget = controller.getEnemyArenaTarget(enemy, new THREE.Vector3(20, 0, 0));
  assert.ok(edgeTarget.x < enemy.encounterArena.softHalfWidth * 0.45);
  assert.ok(enemy.lastArenaSteeringStrength > 0.65);
});

test('enemy footprint checks reject wall-adjacent centers and constraint recovery points inward', () => {
  const wall = {
    id: 'test-wall',
    position: new THREE.Vector3(2, 1, 0),
    halfWidth: 0.22,
    halfDepth: 3,
    verticalHalfHeight: 2,
  };
  const { controller, game } = createController({ solidZones: [wall] });
  const enemy = createEnemy(new THREE.Vector3(1.42, 0, 0));
  enemy.setEncounterArena({
    id: 'test-arena',
    zone: {
      position: new THREE.Vector3(-1, 0, 0),
      halfWidth: 7,
      halfDepth: 6,
    },
  });
  game.enemies.push(enemy);

  assert.equal(controller.isPositionWalkable(enemy.root.position), true);
  assert.equal(controller.isEnemyPositionClear(enemy, enemy.root.position), false);

  controller.lastSafeEnemyPositions.set(enemy.id, new THREE.Vector3(0, 0, 0));
  controller.constrainEnemies();
  assert.ok(enemy.root.position.distanceTo(new THREE.Vector3(0, 0, 0)) < 0.001);
  assert.ok(enemy.navigationRecoveryTarget);
  assert.equal(controller.isEnemyPositionClear(enemy, enemy.navigationRecoveryTarget), true);
  assert.ok(enemy.navigationRecoveryTarget.x < 1.42);

  const direction = controller.getEnemyNavigationDirection(enemy, new THREE.Vector3(5, 0, 0));
  assert.ok(direction);
  assert.ok(direction.x < 0.25, 'recovery navigation must not immediately drive back into the wall');
});

test('ground navigation side-steps partial-tile obstacles before contact', () => {
  const wall = {
    id: 'partial-tile-pillar',
    position: new THREE.Vector3(1.2, 1, 0),
    halfWidth: 0.2,
    halfDepth: 2.5,
    verticalHalfHeight: 2,
  };
  const { controller } = createController({ solidZones: [wall] });
  const enemy = createEnemy(new THREE.Vector3(0, 0, 0));
  enemy.stats = { moveSpeed: 3.2 };
  enemy.setEncounterArena({
    id: 'test-arena',
    zone: {
      position: new THREE.Vector3(0, 0, 0),
      halfWidth: 7,
      halfDepth: 6,
    },
  });

  const direction = controller.getEnemyNavigationDirection(enemy, new THREE.Vector3(5, 0, 0));
  assert.ok(direction);
  assert.ok(direction.x < 0.9);
  assert.ok(Math.abs(direction.z) > 0.3);
  assert.ok(enemy.navigationRecoveryTarget);
  assert.equal(controller.isEnemyPositionClear(enemy, enemy.navigationRecoveryTarget), true);
});

test('ground traversal hops a catwalk railing to a clear lower floor', () => {
  const { controller, enemy, blockedPosition, desiredTarget } = createRailingTraversalFixture();

  assert.equal(controller.isEnemyPositionClear(enemy, blockedPosition), false);
  const traversal = controller.resolveEnemyGroundTraversal(
    enemy,
    blockedPosition,
    desiredTarget,
  );

  assert.ok(traversal);
  assert.equal(traversal.kind, 'railing');
  assert.equal(controller.isEnemyPositionClear(enemy, traversal.targetPosition), true);
  assert.ok(traversal.targetPosition.x > 1.4, 'landing must clear the far side of the rail');
  assert.ok(Math.abs(traversal.targetPosition.y) < 0.001);
  assert.ok(traversal.arcHeight > 0.68, 'the hop arc must visibly clear the rail');
  assert.ok(Number.isFinite(traversal.duration) && traversal.duration > 0);
});

test('ground traversal drops laterally from an industrial ramp', () => {
  const floorTiles = [{
    x: 0,
    z: 0,
    elevation: 1,
    level: 0.5,
    surface: 'industrialRamp',
    rampStartElevation: 0,
    rampEndElevation: 2,
    rampDirectionX: 1,
    rampDirectionZ: 0,
    roomId: 'ramp-side-traversal-room',
  }];
  for (let x = -1; x <= 1; x += 1) {
    for (let z = 1; z <= 3; z += 1) {
      floorTiles.push({
        x,
        z,
        elevation: 0,
        level: 0,
        surface: 'floor',
        roomId: 'ramp-side-traversal-room',
      });
    }
  }
  const { controller } = createController({
    floor: createFloorFromTiles(floorTiles),
  });
  const enemy = createEnemy(new THREE.Vector3(0.4, 1.4, 0.5));
  const blockedPosition = new THREE.Vector3(0.4, 1.4, 0.9);
  const desiredTarget = new THREE.Vector3(0.4, 0, 4);

  assert.equal(controller.isEnemyPositionClear(enemy, blockedPosition), false);
  const traversal = controller.resolveEnemyGroundTraversal(
    enemy,
    blockedPosition,
    desiredTarget,
  );

  assert.ok(traversal);
  assert.equal(traversal.kind, 'rampSide');
  assert.equal(controller.isEnemyPositionClear(enemy, traversal.targetPosition), true);
  assert.ok(traversal.targetPosition.z > 1.4, 'landing must clear the side edge of the ramp');
  assert.ok(Math.abs(traversal.targetPosition.y) < 0.001);
  assert.ok(traversal.arcHeight > 0);
  assert.ok(Number.isFinite(traversal.duration) && traversal.duration > 0);
});

test('ground traversal cannot hop a railing through a boundary wall', () => {
  const boundaryWall = {
    id: 'enemy-railing-boundary-wall',
    label: 'Dungeon boundary wall',
    obstacleKind: 'boundaryWall',
    position: new THREE.Vector3(1, 2, 0),
    halfWidth: 0.08,
    halfDepth: 3.5,
    verticalHalfHeight: 2.5,
    allowFlyOver: false,
  };
  const { controller, enemy, blockedPosition, desiredTarget } = createRailingTraversalFixture({
    aerialBoundaryZones: [boundaryWall],
  });

  assert.equal(
    controller.resolveEnemyGroundTraversal(enemy, blockedPosition, desiredTarget),
    null,
  );
});

test('ground traversal cannot hop a railing through a closed door', () => {
  const closedDoor = {
    id: 'enemy-railing-closed-door',
    position: new THREE.Vector3(1, 0, 0),
    alongX: true,
    collisionHalfWidth: 0.08,
    collisionHalfDepth: 3.5,
    collisionHeight: 4.8,
    closed: true,
  };
  const { controller, enemy, blockedPosition, desiredTarget } = createRailingTraversalFixture({
    doors: [closedDoor],
  });

  assert.equal(
    controller.resolveEnemyGroundTraversal(enemy, blockedPosition, desiredTarget),
    null,
  );
});

test('encounter spawning gives every generated enemy the same resolved arena envelope', () => {
  const { controller, game } = createController();
  game.reaverbotBaseSeed = 1701;
  game.reaverbotGeneration = 0;
  game.ruinFloor = 1;
  game.addEnemy = (enemy) => game.enemies.push(enemy);
  const encounter = {
    id: 'arena-metadata-test',
    label: 'Arena Metadata Test',
    roomArchetypeId: 'industrial',
    roomFlavorId: 'machine',
    roster: ['basic', 'fast', 'ranged'],
    zone: {
      position: new THREE.Vector3(0, 0, 0),
      halfWidth: 7,
      halfDepth: 6,
    },
    spawnPoints: [
      new THREE.Vector3(-2, 0, 0),
      new THREE.Vector3(0, 0, 2),
      new THREE.Vector3(2, 0, 0),
    ],
    spawned: false,
    cleared: false,
    enemyIds: [],
  };
  controller.encounters.push(encounter);

  const spawner = new EnemySpawner(game);
  let serial = 0;
  spawner.spawnEnemy = (_type, _elite, position) => {
    const enemy = createEnemy(position);
    enemy.id = `spawn-arena-enemy-${serial++}`;
    game.addEnemy(enemy);
    return enemy;
  };
  const enemies = spawner.spawnEncounter(encounter);
  assert.equal(enemies.length, 3);
  for (const enemy of enemies) {
    assert.equal(enemy.encounterId, encounter.id);
    assert.equal(enemy.encounterArena.encounterId, encounter.id);
    assert.equal(enemy.encounterArena.halfWidth, encounter.zone.halfWidth);
    assert.equal(enemy.encounterArena.halfDepth, encounter.zone.halfDepth);
    assert.equal(controller.isEnemyPositionClear(enemy, enemy.encounterArena.center), true);
  }
});
