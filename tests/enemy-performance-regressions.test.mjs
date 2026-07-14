import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonController } from '../src/DungeonController.js';
import { Enemy } from '../src/Enemy.js';
import { Game } from '../src/Game.js';
import { ReaverbotEnemy } from '../src/reaverbots/ReaverbotEnemy.js';

function createController(floorTiles, { tileSize = 2 } = {}) {
  const tiles = new Map();
  for (const tile of floorTiles) {
    const key = `${tile.x},${tile.z}`;
    if (!tiles.has(key) || (tile.elevation ?? 0) < (tiles.get(key).elevation ?? 0)) {
      tiles.set(key, tile);
    }
  }

  const game = {
    elapsedTime: 0,
    enemies: [],
    player: {
      radius: 0.42,
      root: { position: new THREE.Vector3() },
      takeDamage: () => 0,
    },
    getPlatformFloorElevation: () => null,
    isPositionInsidePlatformBlock: () => false,
  };
  const dungeon = {
    tileSize,
    tiles,
    floorTiles,
    doors: [],
    encounters: [],
    playerStart: new THREE.Vector3(),
  };
  const controller = new DungeonController(game, dungeon);
  game.dungeonController = controller;
  return { controller, game };
}

function createLayeredFloor(width = 15, elevationGap = 8) {
  const half = Math.floor(width / 2);
  const floorTiles = [];
  for (let x = -half; x <= half; x += 1) {
    for (let z = -half; z <= half; z += 1) {
      floorTiles.push({ x, z, elevation: 0, level: 0, surface: 'floor' });
      floorTiles.push({ x, z, elevation: elevationGap, level: 1, surface: 'upperDeck' });
    }
  }
  return floorTiles;
}

function instrumentFloorSearch(controller) {
  const originalFind = controller._findFloorTilePath.bind(controller);
  const originalWalkable = controller._isFloorTileRuntimeWalkable.bind(controller);
  const samples = [];
  let searchActive = false;
  let visits = 0;

  controller._isFloorTileRuntimeWalkable = (...args) => {
    if (searchActive) visits += 1;
    return originalWalkable(...args);
  };
  controller._findFloorTilePath = (...args) => {
    const before = visits;
    searchActive = true;
    try {
      return originalFind(...args);
    } finally {
      searchActive = false;
      samples.push(visits - before);
    }
  };

  return samples;
}

test('unreachable layered pursuit caches its exhaustive miss across controller frames', () => {
  const width = 15;
  const elevationGap = 8;
  const { controller, game } = createController(createLayeredFloor(width, elevationGap));
  const searchVisits = instrumentFloorSearch(controller);
  const from = new THREE.Vector3(-14, 0, -14);
  const target = new THREE.Vector3(14, elevationGap, 14);

  assert.equal(controller.getNavigationDirection(from, target), null);
  assert.equal(searchVisits.length, 1);
  assert.ok(searchVisits[0] >= width * width, 'fixture must exercise a full disconnected layer search');
  assert.ok(
    searchVisits[0] <= width * width * 10,
    `one bounded search should not revisit the ${width * width} lower nodes without limit`,
  );

  for (let frame = 0; frame < 12; frame += 1) {
    game.elapsedTime += 1 / 60;
    controller.update(1 / 60);
    assert.equal(controller.getNavigationDirection(from, target), null);
  }

  assert.equal(
    searchVisits.length,
    1,
    'an unchanged unreachable route must not rerun its full floor search every frame',
  );

  controller.invalidateNavigationTopology();
  assert.equal(controller.getNavigationDirection(from, target), null);
  assert.equal(searchVisits.length, 2, 'topology invalidation must allow one fresh route proof');
});

test('elevated conveyor pursuit reuses topology while deriving direction from the live position', () => {
  const floorTiles = [
    { x: 0, z: 0, elevation: 0, level: 0, surface: 'conveyor' },
    {
      x: 1,
      z: 0,
      elevation: 0.6,
      level: 0.5,
      surface: 'industrialRamp',
      rampStartElevation: 0,
      rampEndElevation: 1.2,
      rampDirectionX: 1,
      rampDirectionZ: 0,
    },
    { x: 2, z: 0, elevation: 1.2, level: 1, surface: 'secondFloorConveyor' },
    { x: 3, z: 0, elevation: 1.2, level: 1, surface: 'conveyorCrossBridge' },
    { x: 4, z: 0, elevation: 1.2, level: 1, surface: 'thirdFloorGantry' },
  ];
  const { controller, game } = createController(floorTiles);
  const searchVisits = instrumentFloorSearch(controller);
  const target = new THREE.Vector3(8, 1.2, 0);
  const centered = new THREE.Vector3(0, 0, 0);
  const beltShifted = new THREE.Vector3(0.35, 0, 0.45);

  const first = controller.getNavigationDirection(centered, target);
  assert.ok(first?.x > 0.95);
  assert.ok(Math.abs(first.z) < 0.001);

  game.elapsedTime += 1 / 60;
  controller.update(1 / 60);
  const second = controller.getNavigationDirection(beltShifted, target);

  assert.equal(searchVisits.length, 1, 'conveyor movement inside the same tile must reuse the route');
  assert.ok(second?.x > 0.8);
  assert.ok(second?.z < -0.15, 'the cached waypoint must still steer from the enemy\'s live position');
  assert.notDeepEqual(second.toArray(), first.toArray(), 'cache must not replay a stale world-space direction');
});

test('door state changes invalidate cached navigation without a manual cache clear', () => {
  const floorTiles = Array.from({ length: 5 }, (_, x) => ({
    x,
    z: 0,
    elevation: 0,
    level: 0,
    surface: 'floor',
  }));
  const { controller } = createController(floorTiles);
  const door = {
    id: 'performance-cache-door',
    position: new THREE.Vector3(4, 0, 0),
    alongX: false,
    closed: true,
    collisionHalfWidth: 0.3,
    collisionHalfDepth: 0.3,
  };
  controller.doors = [door];
  const searchVisits = instrumentFloorSearch(controller);
  const from = new THREE.Vector3(0, 0, 0);
  const target = new THREE.Vector3(8, 0, 0);

  assert.equal(controller.getNavigationDirection(from, target), null);
  assert.equal(searchVisits.length, 1);

  door.closed = false;
  const openedDirection = controller.getNavigationDirection(from, target);
  assert.ok(openedDirection?.x > 0.99, 'opening the door must expose the corridor route');
  assert.equal(searchVisits.length, 2, 'external door mutation must trigger exactly one fresh route search');

  door.closed = true;
  assert.equal(controller.getNavigationDirection(from, target), null);
  assert.equal(searchVisits.length, 3, 'closing the door must invalidate the now-stale reachable route');
});

function createFlamethrowerGameShell() {
  const game = Object.create(Game.prototype);
  game.scene = new THREE.Scene();
  game.flamethrowerEffects = new Map();
  game.activeParticles = [];
  return game;
}

function countRenderObjects(root) {
  let count = 0;
  root.traverse((object) => {
    if (object.isMesh) count += 1;
  });
  return count;
}

test('generated and Gorubesshu flames reuse a bounded pair of render objects per enemy', () => {
  const game = createFlamethrowerGameShell();
  const generated = { root: { position: new THREE.Vector3(0, 0, 0) } };
  const gorubesshu = { root: { position: new THREE.Vector3(4, 0, 0) } };
  const direction = new THREE.Vector3(0, 0, 1);
  const generatedOrigin = new THREE.Vector3(0, 0.7, 0);
  const gorubesshuOrigin = new THREE.Vector3(4, 0.6, 0);

  const generatedEffect = game.updateFlamethrowerEffect(
    generated,
    1 / 60,
    generatedOrigin,
    direction,
    {
      range: 4.5,
      particleCount: 100,
      name: 'generatedReaverbotFlamethrowerCone',
    },
  );
  const gorubesshuEffect = game.updateFlamethrowerEffect(
    gorubesshu,
    1 / 60,
    gorubesshuOrigin,
    direction,
    {
      range: 5,
      particleCount: 19,
      name: 'gorubesshuFlamethrowerCone',
    },
  );
  const generatedRoot = generatedEffect.root;
  const generatedConeGeometry = generatedEffect.cone.geometry;
  const generatedParticleGeometry = generatedEffect.particles.geometry;

  for (let frame = 0; frame < 360; frame += 1) {
    generatedOrigin.x += 0.001;
    direction.set(Math.sin(frame * 0.01), 0, Math.cos(frame * 0.01));
    const next = game.updateFlamethrowerEffect(
      generated,
      1 / 60,
      generatedOrigin,
      direction,
      {
        range: 4.5,
        particleCount: 100,
        name: 'generatedReaverbotFlamethrowerCone',
      },
    );
    assert.equal(next, generatedEffect);
  }

  assert.equal(game.flamethrowerEffects.size, 2);
  assert.equal(generatedEffect.root, generatedRoot);
  assert.equal(generatedEffect.cone.geometry, generatedConeGeometry);
  assert.equal(generatedEffect.particles.geometry, generatedParticleGeometry);
  assert.equal(generatedEffect.particles.isInstancedMesh, true);
  assert.equal(gorubesshuEffect.particles.isInstancedMesh, true);
  assert.equal(generatedEffect.particles.count, 48, 'per-enemy particle instances must be hard capped');
  assert.equal(gorubesshuEffect.particles.count, 19);
  assert.equal(countRenderObjects(generatedEffect.root), 2);
  assert.equal(countRenderObjects(gorubesshuEffect.root), 2);
  assert.equal(game.activeParticles.length, 0, 'flame instances must not consume the generic mesh-per-particle pool');
  assert.equal(game.scene.getObjectsByProperty('name', 'generatedReaverbotFlamethrowerCone').length, 1);
  assert.equal(game.scene.getObjectsByProperty('name', 'gorubesshuFlamethrowerCone').length, 1);

  let coneGeometryDisposed = 0;
  let particleGeometryDisposed = 0;
  generatedConeGeometry.addEventListener('dispose', () => { coneGeometryDisposed += 1; });
  generatedParticleGeometry.addEventListener('dispose', () => { particleGeometryDisposed += 1; });
  assert.equal(game.endFlamethrowerEffect(generated), true);
  assert.equal(game.flamethrowerEffects.size, 1);
  assert.equal(generatedRoot.parent, null);
  assert.equal(coneGeometryDisposed, 1);
  assert.equal(particleGeometryDisposed, 1);
  assert.equal(game.scene.getObjectsByProperty('name', 'generatedReaverbotFlamethrowerCone').length, 0);

  gorubesshu.dead = true;
  game._updateFlamethrowerEffects(1 / 60);
  assert.equal(game.flamethrowerEffects.size, 0, 'dead flame sources must be torn down by the world heartbeat');
  assert.equal(gorubesshuEffect.root.parent, null);
});

test('both enemy flamethrower callers use the bounded effect pipeline', () => {
  const game = createFlamethrowerGameShell();
  game.player = {
    dead: true,
    radius: 0.42,
    root: { position: new THREE.Vector3(100, 0, 100) },
    takeDamage: () => 0,
  };
  game.completeEnemyAttack = () => {};

  const generated = Object.create(ReaverbotEnemy.prototype);
  generated.root = new THREE.Group();
  generated.root.position.set(0, 0, 0);
  generated.brain = {
    tickTimer: 1,
    attackDirection: new THREE.Vector3(0, 0, 1),
  };
  generated.visual = {
    weapon: {
      muzzle: {
        getWorldPosition(target) {
          return target.set(0, 0.7, 0);
        },
      },
    },
  };
  generated.stats = { attackRange: 4.5, damage: 1 };
  generated._updateFlamethrower(1 / 60, game);

  const gorubesshu = Object.create(Enemy.prototype);
  gorubesshu.root = new THREE.Group();
  gorubesshu.root.position.set(4, 0, 0);
  gorubesshu.type = { modelAsset: 'gorubesshu' };
  gorubesshu.stats = { attackRange: 4.8, damage: 1 };
  gorubesshu.gorubesshuRig = null;
  gorubesshu.gorubesshuAttack = {
    active: true,
    timer: 0.5,
    duration: 1.75,
    flameStart: 0.34,
    flameEnd: 1.36,
    tickTimer: 1,
    particleTimer: 0,
    telegraphTimer: 0,
    direction: new THREE.Vector3(0, 0, 1),
  };
  gorubesshu._updateGorubesshuAttack(1 / 60, game, new THREE.Vector3(0, 0, 1));

  const generatedEffect = game.flamethrowerEffects.get(generated);
  const gorubesshuEffect = game.flamethrowerEffects.get(gorubesshu);
  assert.ok(generatedEffect);
  assert.ok(gorubesshuEffect);
  assert.equal(generatedEffect.cone.name, 'generatedReaverbotFlamethrowerCone');
  assert.equal(generatedEffect.particles.count, 36);
  assert.equal(gorubesshuEffect.cone.name, 'gorubesshuFlamethrowerCone');
  assert.equal(gorubesshuEffect.particles.count, 48);
  assert.equal(game.activeParticles.length, 0);

  game._clearFlamethrowerEffects();
  assert.equal(game.flamethrowerEffects.size, 0);
  assert.equal(game.scene.children.length, 0);
});
