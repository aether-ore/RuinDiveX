import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonController } from '../src/DungeonController.js';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { Enemy } from '../src/Enemy.js';
import { EnemySpawner } from '../src/EnemySpawner.js';

function createFloor(width = 13, depth = 11, tileSize = 2) {
  const tiles = new Map();
  const floorTiles = [];
  const halfWidth = Math.floor(width / 2);
  const halfDepth = Math.floor(depth / 2);

  for (let x = -halfWidth; x <= halfWidth; x += 1) {
    for (let z = -halfDepth; z <= halfDepth; z += 1) {
      const tile = { x, z, elevation: 0, level: 0 };
      tiles.set(`${x},${z}`, tile);
      floorTiles.push(tile);
    }
  }

  return { tiles, floorTiles, tileSize };
}

function createRuntime() {
  const centerObstacle = {
    id: 'spawn-test-center-obstacle',
    position: new THREE.Vector3(0, 1, 0),
    halfWidth: 0.9,
    halfDepth: 0.9,
    verticalHalfHeight: 2,
  };
  const game = {
    enemies: [],
    player: { radius: 0.42, root: { position: new THREE.Vector3(0, 0, 8) } },
    reaverbotBaseSeed: 0x51a9,
    reaverbotGeneration: 0,
    ruinFloor: 1,
    getPlatformFloorElevation: () => null,
    isPositionInsidePlatformBlock: () => false,
  };
  const dungeon = {
    ...createFloor(),
    solidZones: [centerObstacle],
    doors: [],
    encounters: [],
    playerStart: new THREE.Vector3(),
  };
  const controller = new DungeonController(game, dungeon);
  game.dungeon = dungeon;
  game.dungeonController = controller;
  game.addEnemy = (enemy) => game.enemies.push(enemy);
  return { controller, game };
}

function createEnemy(position, id) {
  const enemy = {
    id,
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

function isInsideCornerZone(position, zone, cornerBand = 2) {
  const localX = Math.abs(position.x - zone.position.x);
  const localZ = Math.abs(position.z - zone.position.z);
  const xWallClearance = zone.halfWidth - localX;
  const zWallClearance = zone.halfDepth - localZ;
  return xWallClearance <= cornerBand && zWallClearance <= cornerBand;
}

test('generated room spawn points use a spaced interior ring instead of corner tiles', () => {
  const tileSize = 2;
  const generator = new DungeonGenerator({ tileSize, random: () => 0.5 });
  const room = {
    id: 'spawn-layout-room',
    type: 'enemy',
    x: 0,
    z: 0,
    width: 9,
    depth: 9,
  };
  const floorTiles = [];
  for (let x = -4; x <= 4; x += 1) {
    for (let z = -4; z <= 4; z += 1) {
      floorTiles.push({
        x,
        z,
        elevation: 0,
        level: 0,
        roomId: room.id,
        type: room.type,
        surface: 'enemy',
      });
    }
  }

  const points = generator._roomSpawnPoints(room, floorTiles, []);
  assert.equal(points.length, 6);
  for (const point of points) {
    const tileX = Math.round(point.x / tileSize);
    const tileZ = Math.round(point.z / tileSize);
    const xEdgeInset = 4 - Math.abs(tileX);
    const zEdgeInset = 4 - Math.abs(tileZ);
    assert.equal(
      xEdgeInset <= 1 && zEdgeInset <= 1,
      false,
      `generated corner tile ${tileX}, ${tileZ}`,
    );
  }

  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      assert.ok(
        points[left].distanceTo(points[right]) >= tileSize * 1.7,
        'interior correction must not replace corner spawning with a center pile',
      );
    }
  }
});

test('encounter spawning sanitizes corner-biased points into clear non-corner positions', () => {
  const { controller, game } = createRuntime();
  const encounter = {
    id: 'corner-spawn-regression',
    label: 'Corner Spawn Regression',
    roomArchetypeId: 'industrial',
    roomFlavorId: 'machine',
    roster: ['basic', 'fast', 'ranged', 'basic'],
    zone: {
      position: new THREE.Vector3(0, 0, 0),
      halfWidth: 10,
      halfDepth: 8,
    },
    spawnPoints: [
      new THREE.Vector3(-9, 0, -7),
      new THREE.Vector3(9, 0, -7),
      new THREE.Vector3(-9, 0, 7),
      new THREE.Vector3(9, 0, 7),
    ],
    spawned: false,
    cleared: false,
    enemyIds: [],
  };
  controller.encounters.push(encounter);

  const spawner = new EnemySpawner(game);
  let serial = 0;
  spawner.spawnEnemy = (_type, _elite, position) => {
    const enemy = createEnemy(position, `corner-regression-enemy-${serial++}`);
    game.addEnemy(enemy);
    return enemy;
  };

  const enemies = spawner.spawnEncounter(encounter);

  assert.equal(enemies.length, encounter.roster.length);
  for (const enemy of enemies) {
    const localX = Math.abs(enemy.root.position.x - encounter.zone.position.x);
    const localZ = Math.abs(enemy.root.position.z - encounter.zone.position.z);
    assert.equal(
      isInsideCornerZone(enemy.root.position, encounter.zone),
      false,
      `spawn ${enemy.root.position.toArray().map((value) => value.toFixed(2)).join(', ')} remained in a room corner`,
    );
    assert.ok(localX <= encounter.zone.halfWidth - enemy.radius);
    assert.ok(localZ <= encounter.zone.halfDepth - enemy.radius);
    assert.equal(controller.isPositionWalkable(enemy.root.position), true);
    assert.equal(controller.isEnemyPositionClear(enemy, enemy.root.position), true);
  }
});
