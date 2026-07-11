import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonController } from '../src/DungeonController.js';

function createController({ boundaryZones = [] } = {}) {
  const tiles = new Map();
  const floorTiles = [];
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -2; z <= 2; z += 1) {
      const tile = { x, z, elevation: 0, level: 0 };
      tiles.set(`${x},${z}`, tile);
      floorTiles.push(tile);
    }
  }

  const group = new THREE.Group();
  const rail = new THREE.Mesh(new THREE.BoxGeometry(3, 0.07, 0.07));
  rail.name = 'factoryCatwalkRailRun';
  rail.position.set(0, 0.68, 0);
  rail.userData.factoryRailRun = true;
  group.add(rail);

  const player = {
    radius: 0.42,
    root: { position: new THREE.Vector3(0, 0.8, 0) },
    modelRoot: { position: new THREE.Vector3() },
    velocity: new THREE.Vector3(0, -2, 0),
    isJumpAirborne: () => true,
    resumeAirborneFall(recovery) {
      this.root.position.x = recovery.x;
      this.root.position.z = recovery.z;
      this.velocity.y = Math.min(this.velocity.y, -1.1);
      this.lastRecovery = recovery;
      return true;
    },
  };
  const game = {
    player,
    enemies: [],
    getPlatformFloorElevation: () => null,
    isPositionInsidePlatformBlock: () => false,
  };
  const dungeon = {
    tileSize: 1,
    tiles,
    floorTiles,
    group,
    doors: [],
    solidZones: [],
    aerialBoundaryZones: boundaryZones,
    encounters: [],
  };
  return { controller: new DungeonController(game, dungeon), player };
}

test('a centered descending player can land and balance on a thin railing', () => {
  const { controller, player } = createController();
  player.root.position.y = 0.7;
  const landed = controller.tryResolvePlayerRailLanding({
    player,
    root: player.root,
    previousRootY: 0.76,
  });

  assert.equal(controller.playerRailTopSurfaces.length, 1);
  assert.equal(landed, true);
  assert.ok(Math.abs(player.root.position.y - 0.715) < 0.0001);
  player.isJumpAirborne = () => false;
  assert.ok(Math.abs(controller.getPlayerRailSupportElevation(player.root.position) - 0.715) < 0.0001);
});

test('an off-center railing crossing is not converted into a landing', () => {
  const { controller, player } = createController();
  player.root.position.z = 0.14;

  assert.equal(controller.tryResolvePlayerRailLanding({
    player,
    root: player.root,
    previousRootY: 0.76,
  }), false);
});

test('a stalled fall near a railing is nudged sideways and resumes descending', () => {
  const { controller, player } = createController();

  controller._updatePlayerAirborneRailRecovery(0.1);
  controller._updatePlayerAirborneRailRecovery(0.1);
  controller._updatePlayerAirborneRailRecovery(0.1);

  assert.ok(player.lastRecovery);
  assert.ok(Math.abs(player.lastRecovery.z) >= 0.16);
  assert.equal(player.lastRecovery.groundY, 0);
  assert.ok(player.velocity.y < 0);
  assert.equal(controller.playerRailRecoveryState.lastResult.mode, 'stalledFallNudge');
});

test('rail recovery stays on the near side of a boundary wall', () => {
  const boundary = {
    id: 'test-boundary-wall',
    label: 'Dungeon boundary wall',
    obstacleKind: 'boundaryWall',
    position: new THREE.Vector3(0, 1, 0.5),
    halfWidth: 2,
    halfDepth: 0.05,
    verticalHalfHeight: 2,
    allowFlyOver: false,
  };
  const { controller, player } = createController({ boundaryZones: [boundary] });
  player.velocity.set(0, -2, 1);
  const rail = controller.playerRailTopSurfaces[0];
  const recovery = controller._resolvePlayerAirborneRailRecovery(
    player.root.position,
    rail,
    player.velocity,
  );

  assert.ok(recovery);
  assert.ok(recovery.z < 0, 'the preferred far side must be rejected when a boundary wall blocks it');
  const grounded = new THREE.Vector3(recovery.x, recovery.groundY, recovery.z);
  assert.equal(controller._findPowerKnockbackBarrier(
    player.root.position,
    grounded,
    { ignoreVertical: true },
  ), null);
});
