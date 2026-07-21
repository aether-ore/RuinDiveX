import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../../../src/DungeonController.js';

function zone(id, x, z, halfWidth, halfDepth, options = {}) {
  return {
    id,
    position: new THREE.Vector3(x, options.y ?? 2, z),
    halfWidth,
    halfDepth,
    verticalHalfHeight: options.verticalHalfHeight ?? 3,
    rotationY: options.rotationY ?? 0,
    active: options.active ?? true,
    enabled: options.enabled ?? true,
    obstacleKind: options.obstacleKind ?? 'boundaryWall',
    blocksPowerKnockback: true,
    ...(options.collisionShape ? {
      shape: options.collisionShape,
      collisionShape: options.collisionShape,
      collisionRadius: options.collisionRadius,
      radius: options.collisionRadius,
    } : {}),
  };
}

function makeController() {
  const farZones = Array.from({ length: 96 }, (_, index) => (
    zone(`far.${index}`, 180 + (index % 12) * 14, 180 + Math.floor(index / 12) * 14, 2, 2)
  ));
  const rotated = zone('rotated.near', 0, 0, 5, 1, { rotationY: Math.PI / 4 });
  const disabled = zone('disabled.near', 0, 0, 7, 7, { enabled: false });
  const aerial = zone('aerial.rotated', 12, 0, 4, 1.2, { rotationY: Math.PI / 3 });
  const door = {
    id: 'indexed-gate',
    closed: true,
    collisionPosition: new THREE.Vector3(24, 2, 0),
    collisionHalfWidth: 2,
    collisionHalfDepth: 0.3,
    collisionHeight: 4,
  };
  const dungeon = {
    generationMode: 'v2',
    tileSize: 2.8,
    tiles: new Map(),
    floorTiles: [],
    doors: [door],
    solidZones: [rotated, disabled, ...farZones],
    aerialBoundaryZones: [aerial, ...farZones],
    progression: null,
    plan: { actions: [] },
  };
  const game = {
    player: { radius: 0.45 },
    platformingPlatforms: [],
    debugSpawnedPlatforms: [],
    isPositionInsidePlatformBlock: () => false,
    getPlatformFloorElevation: () => null,
    _getPlatformingSurfaces: () => [],
  };
  return { controller: new DungeonController(game, dungeon), dungeon, door };
}

function compareIndexedWithBruteForce(controller, callback) {
  const indexed = callback();
  const saved = controller._v2CollisionSpatialIndex;
  controller._v2CollisionSpatialIndex = null;
  try {
    const brute = callback();
    assert.equal(indexed?.kind ?? indexed, brute?.kind ?? brute);
    assert.equal(indexed?.zone?.id ?? indexed?.source?.id ?? null,
      brute?.zone?.id ?? brute?.source?.id ?? null);
  } finally {
    controller._v2CollisionSpatialIndex = saved;
  }
  return indexed;
}

test('V2 spatial bins preserve rotated-zone, disabled-zone, and gate collision outcomes', () => {
  const { controller, door } = makeController();
  const rotatedPoint = new THREE.Vector3(2.4, 2, 2.4);
  assert.equal(compareIndexedWithBruteForce(
    controller,
    () => controller._isPositionInsideSolidZone(rotatedPoint),
  ), true);

  const aerialPoint = new THREE.Vector3(12, 2, 0);
  const aerialBlocker = compareIndexedWithBruteForce(
    controller,
    () => controller._getAerialBlockingObstacle(aerialPoint, { ignoreAirspace: true, radius: 0.2 }),
  );
  assert.equal(aerialBlocker.zone.id, 'aerial.rotated');

  const gatePoint = new THREE.Vector3(24, 2, 0);
  assert.equal(compareIndexedWithBruteForce(
    controller,
    () => controller._getAerialBlockingObstacle(gatePoint, { ignoreAirspace: true }),
  ).kind, 'closedDoor');
  door.closed = false;
  assert.equal(compareIndexedWithBruteForce(
    controller,
    () => controller._getAerialBlockingObstacle(gatePoint, { ignoreAirspace: true }),
  ), null);

  const stats = controller.getSpatialQueryDiagnostics();
  assert.ok(stats.queryCount > 0);
  assert.ok(stats.candidateTests < stats.bruteForceEquivalentTests * 0.35,
    `indexed candidates ${stats.candidateTests} did not materially reduce ${stats.bruteForceEquivalentTests} brute-force tests`);
});

test('V2 spatial bins rebuild when collision source counts change', () => {
  const { controller } = makeController();
  const added = zone('new.near', -18, 0, 2, 2);
  controller.solidZones.push(added);
  controller._refreshNavigationTopology();
  const stats = controller.getSpatialQueryDiagnostics();
  assert.equal(stats.totalSolidZoneCount, controller.solidZones.length);
  const candidates = controller._queryCollisionZones('solid', added.position, 0.1);
  assert.ok(candidates.includes(added));
  assert.equal(controller._isPositionInsideSolidZone(added.position), true);
});

test('manifest cylinders keep diagonal AABB corners clear for grounded, aerial, and knockback collision', () => {
  const { controller } = makeController();
  const cylinder = zone('manifest-cylinder', -30, 0, 2, 2, {
    collisionShape: 'cylinder',
    collisionRadius: 2,
  });
  controller.solidZones.push(cylinder);
  controller.aerialBoundaryZones.push(cylinder);
  controller._rebuildV2CollisionSpatialIndex();

  const diagonalCorner = new THREE.Vector3(-28.35, 2, 1.65);
  const axialContact = new THREE.Vector3(-28.1, 2, 0);
  assert.ok(
    Math.abs(diagonalCorner.x - cylinder.position.x) < cylinder.halfWidth
      && Math.abs(diagonalCorner.z - cylinder.position.z) < cylinder.halfDepth,
    'regression sample remains inside the cylinder broad-phase square',
  );
  assert.equal(controller._isPositionInsideSolidZone(diagonalCorner), false,
    'empty diagonal corner is not a grounded invisible blocker');
  assert.equal(controller._isPositionInsideSolidZone(axialContact), true,
    'the authored cylinder radius still blocks axial contact');

  assert.equal(compareIndexedWithBruteForce(
    controller,
    () => controller._getAerialBlockingObstacle(diagonalCorner, {
      ignoreAirspace: true,
      radius: 0.2,
    }),
  ), null, 'flyers retain diagonal clearance around the exact circular footprint');
  assert.equal(compareIndexedWithBruteForce(
    controller,
    () => controller._getAerialBlockingObstacle(axialContact, {
      ignoreAirspace: true,
      radius: 0.2,
    }),
  ).zone.id, cylinder.id);

  assert.equal(controller._getPowerKnockbackBarrierAt(diagonalCorner, 0.2), null,
    'power-knockback narrow phase also ignores the empty AABB corner');
  assert.equal(controller._getPowerKnockbackBarrierAt(axialContact, 0.2).source.id, cylinder.id);
});
