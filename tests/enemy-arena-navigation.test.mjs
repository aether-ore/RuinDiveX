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

function createController({ solidZones = [] } = {}) {
  const floor = createFloor();
  const game = {
    enemies: [],
    player: { radius: 0.42, root: { position: new THREE.Vector3() } },
    getPlatformFloorElevation: () => null,
    isPositionInsidePlatformBlock: () => false,
  };
  const dungeon = {
    ...floor,
    solidZones,
    doors: [],
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
    navigationMode: 'ground',
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
