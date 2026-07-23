import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonController } from '../src/DungeonController.js';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { Game } from '../src/Game.js';

function makeTile(x, z, elevation, overrides = {}) {
  return {
    x,
    z,
    elevation,
    // Deliberately identical across physical floors. The runtime must not use
    // this planning/display label as a support identity.
    level: 0,
    ...overrides,
  };
}

function createHarness({
  floorTiles,
  position = new THREE.Vector3(),
  tileSize = 1,
  platformElevation = null,
  solidZones = [],
} = {}) {
  const player = {
    radius: 0.42,
    root: { position: position.clone() },
    modelRoot: { position: new THREE.Vector3() },
    velocity: new THREE.Vector3(),
    jumpState: 'Grounded',
    animation: {
      actionState: null,
      isFullBodyActionActive: () => false,
    },
    isPhysicalJumpActive() {
      return this.jumpState === 'Rising' || this.jumpState === 'Falling';
    },
    isJumpAirborne() {
      return this.jumpState === 'Rising' || this.jumpState === 'Falling';
    },
    isDodgeRollAirborne: () => false,
    isPowerKnockbackAirborne: () => false,
    isPowerKnockbackActive: () => false,
    isJumpVerticalMotionActive() {
      return this.isJumpAirborne();
    },
    isLedgeClinging: () => false,
    isClimbingLadder: () => false,
    shouldIgnoreGroundConstraint: () => false,
    consumeLadderDismountConstraintHandoff: () => null,
    jetSkateState: { active: false },
  };
  const game = {
    player,
    enemies: [],
    getPlatformFloorElevation: () => platformElevation,
    isPositionInsidePlatformBlock: () => false,
  };
  const tiles = new Map();
  for (const tile of floorTiles) {
    tiles.set(`${tile.x},${tile.z}`, tile);
  }
  const dungeon = {
    tileSize,
    tiles,
    floorTiles,
    group: new THREE.Group(),
    doors: [],
    solidZones,
    aerialBoundaryZones: [],
    encounters: [],
    playerStart: position.clone(),
  };
  const controller = new DungeonController(game, dungeon);
  return { controller, game, player };
}

test('floor topology keys stacked supports by absolute elevation, not metadata level', () => {
  const lower = makeTile(0, 0, 0);
  const upper = makeTile(0, 0, 14);
  const { controller } = createHarness({
    floorTiles: [lower, upper],
    position: new THREE.Vector3(0, 14, 0),
  });

  assert.equal(controller._getFloorGraphKey(lower), '0,0@y0.000');
  assert.equal(controller._getFloorGraphKey(upper), '0,0@y14.000');
  assert.notEqual(controller._getFloorGraphKey(lower), controller._getFloorGraphKey(upper));
  assert.equal(controller._ensureFloorNavigationGraph().tilesByKey.size, 2);
});

test('capsule edge support cannot ratchet its safe anchor over a lower room', () => {
  const upper = makeTile(0, 0, 14, { roomId: 'upperHall' });
  const lower = makeTile(1, 0, 0, { roomId: 'lowerRoom' });
  const { controller, player } = createHarness({
    floorTiles: [upper, lower],
    position: new THREE.Vector3(0.35, 14, 0),
  });

  const originalSafe = controller.lastSafePlayerPosition.clone();
  player.root.position.set(0.82, 14, 0);
  controller._constrainPlayerToWalkable();

  assert.equal(player.root.position.y, 14);
  assert.equal(player.root.position.x, 0.82, 'capsule overlap should retain edge support');
  assert.deepEqual(
    controller.lastSafePlayerPosition.toArray(),
    originalSafe.toArray(),
    'edge overlap must not advance the recovery anchor into empty space',
  );

  player.root.position.set(0.95, 14, 0);
  controller._constrainPlayerToWalkable();
  assert.deepEqual(player.root.position.toArray(), originalSafe.toArray());
});

test('an upper-catwalk jump keeps its full rising arc without promoting an airborne safe anchor', () => {
  const upper = makeTile(0, 0, 14, { roomId: 'upperCatwalk' });
  const { controller, player } = createHarness({
    floorTiles: [upper],
    position: new THREE.Vector3(0, 14, 0),
  });
  const groundedSafe = controller.lastSafePlayerPosition.clone();

  // The configured 1.65 m jump intentionally rises beyond the ordinary
  // 1.45 m grounded-support lookup tolerance. That must not invoke recovery.
  player.jumpState = 'Rising';
  player.velocity.y = 1.2;
  player.root.position.set(0, 15.6, 0);
  controller._constrainPlayerToWalkable();

  assert.deepEqual(player.root.position.toArray(), [0, 15.6, 0]);
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), groundedSafe.toArray());
  assert.equal(controller.pendingPlayerJumpOffLanding, null);

  player.jumpState = 'Falling';
  player.velocity.y = -1.2;
  player.root.position.set(0, 15.2, 0);
  controller._constrainPlayerToWalkable();

  assert.deepEqual(player.root.position.toArray(), [0, 15.2, 0]);
  assert.equal(controller.pendingPlayerJumpOffLanding?.y, 14);
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), groundedSafe.toArray());
});

test('catwalk wall recovery preserves airborne height and a grounded safe anchor', () => {
  const upper = [
    makeTile(0, 0, 14, { roomId: 'upperCatwalk' }),
    makeTile(1, 0, 14, { roomId: 'upperCatwalk' }),
  ];
  const wall = {
    id: 'catwalk-wall',
    // The rail blocks the airborne root but leaves the floor beneath it valid,
    // so landing validity alone cannot bypass the horizontal collision.
    position: new THREE.Vector3(0.62, 15.2, 0),
    halfWidth: 0.22,
    halfDepth: 0.8,
    verticalHalfHeight: 0.6,
  };
  const { controller, player } = createHarness({
    floorTiles: upper,
    position: new THREE.Vector3(0, 14, 0),
    solidZones: [wall],
  });
  const groundedSafe = controller.lastSafePlayerPosition.clone();

  // Below the support-capture limit, axis recovery may slide the player out of
  // the wall, but it must not record the airborne Y as a recovery anchor.
  player.jumpState = 'Rising';
  player.velocity.y = 2;
  player.root.position.set(0.62, 14.9, 0);
  controller._constrainPlayerToWalkable();
  assert.equal(player.root.position.y, 14.9);
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), groundedSafe.toArray());

  // Above the 1.45 m grounded lookup tolerance, fallback recovery likewise
  // corrects only X/Z and leaves the configured 1.65 m jump arc intact.
  player.root.position.set(0.62, 15.6, 0);
  controller._constrainPlayerToWalkable();
  assert.deepEqual(player.root.position.toArray(), [0, 15.6, 0]);
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), groundedSafe.toArray());
  assert.equal(player.jumpState, 'Rising');
  assert.equal(player.velocity.y, 2);
});

test('a nearby but disconnected lower layer is not accepted as grounded support', () => {
  const upper = makeTile(0, 0, 14, { roomId: 'upperHall' });
  const lower = makeTile(1, 0, 13, { roomId: 'unrelatedLowerHall' });
  const { controller, player } = createHarness({
    floorTiles: [upper, lower],
    position: new THREE.Vector3(0.35, 14, 0),
  });
  const originalSafe = controller.lastSafePlayerPosition.clone();

  player.root.position.set(1, 14, 0);
  controller._constrainPlayerToWalkable();

  assert.deepEqual(player.root.position.toArray(), originalSafe.toArray());
  assert.equal(controller.getFloorElevationAt(player.root.position), 14);
});

test('dynamic platform support remains authoritative over a lower floor column', () => {
  const lower = makeTile(0, 0, 0, { roomId: 'shaftBottom' });
  const { controller, player } = createHarness({
    floorTiles: [lower],
    position: new THREE.Vector3(0, 6, 0),
    platformElevation: 6,
  });

  controller._constrainPlayerToWalkable();

  assert.deepEqual(player.root.position.toArray(), [0, 6, 0]);
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), [0, 6, 0]);
});

test('a descending dynamic lift remains the nearest support beside its upper landing sill', () => {
  const upperSill = {
    id: 'upper-lift-sill',
    center: new THREE.Vector3(0, 14, 0),
    halfWidth: 4.2,
    halfDepth: 0.7,
    topY: 14,
    baseY: 13.72,
    blocksBelow: false,
    dynamic: false,
  };
  const descendingLift = {
    id: 'descending-lift-car',
    center: new THREE.Vector3(0, 13.82, 1.42),
    halfWidth: 4.2,
    halfDepth: 4.2,
    topY: 13.82,
    baseY: 13.54,
    blocksBelow: true,
    dynamic: true,
  };
  const game = Object.create(Game.prototype);
  game.platformingPlatforms = [upperSill];
  game.dynamicPlatformingPlatforms = [descendingLift];
  game.debugSpawnedPlatforms = [];
  game.debugLedgePlatform = null;

  const support = game.getPlatformSupport(new THREE.Vector3(0, 13.82, 0.68));
  assert.equal(support?.surface, descendingLift);
  assert.equal(support?.elevation, 13.82);
  assert.equal(support?.dynamic, true);

  const sillSupport = game.getPlatformSupport(new THREE.Vector3(0, 14, -0.68));
  assert.equal(sillSupport?.surface, upperSill);
  assert.equal(sillSupport?.elevation, 14);
});

test('an equal-height moving lift wins a seam tie over its static sill', () => {
  const sill = {
    id: 'static-sill',
    center: new THREE.Vector3(0, 14, 0),
    halfWidth: 4.2,
    halfDepth: 0.7,
    topY: 14,
    baseY: 13.72,
    blocksBelow: false,
    dynamic: false,
  };
  const lift = {
    id: 'lift-car',
    center: new THREE.Vector3(0, 14, 1.4),
    halfWidth: 4.2,
    halfDepth: 4.2,
    topY: 14,
    baseY: 13.72,
    blocksBelow: true,
    dynamic: true,
  };
  const game = Object.create(Game.prototype);
  game.platformingPlatforms = [sill];
  game.dynamicPlatformingPlatforms = [lift];
  game.debugSpawnedPlatforms = [];
  game.debugLedgePlatform = null;

  assert.equal(
    game.getPlatformSupport(new THREE.Vector3(0, 14, 0.68))?.surface,
    lift,
  );
});

test('a lift landing sill blocks only its thin physical slab, never the shaft below it', () => {
  const sill = {
    id: 'thin-lift-sill',
    center: new THREE.Vector3(0, 14, 0),
    halfWidth: 4.2,
    halfDepth: 0.7,
    topY: 14,
    baseY: 13.72,
    collisionThicknessMeters: 0.28,
    blocksBelow: false,
  };
  const game = Object.create(Game.prototype);

  assert.equal(
    game._isPositionInsidePlatformBlock(sill, new THREE.Vector3(0, 13.86, 0)),
    true,
  );
  assert.equal(
    game._isPositionInsidePlatformBlock(sill, new THREE.Vector3(0, 8, 0)),
    false,
  );
  assert.equal(
    game._isPositionInsidePlatformBlock(sill, new THREE.Vector3(0, 14, 0)),
    false,
  );
});

test('an authored lower landing commits only after a real falling state', () => {
  const upper = makeTile(0, 0, 14, { roomId: 'upperHall' });
  const lower = makeTile(1, 0, 11.5, {
    roomId: 'authoredCatchment',
    allowsGroundedDropLanding: true,
    dropSpaceId: 'drop-a',
  });
  const { controller, player } = createHarness({
    floorTiles: [upper, lower],
    position: new THREE.Vector3(0.35, 14, 0),
  });
  const upperSafe = controller.lastSafePlayerPosition.clone();

  player.root.position.set(1, 14, 0);
  controller._constrainPlayerToWalkable();
  assert.deepEqual(player.root.position.toArray(), [1, 14, 0]);
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), upperSafe.toArray());
  assert.equal(controller.getFloorElevationAt(player.root.position), 11.5);

  player.jumpState = 'Falling';
  player.velocity.y = -2;
  player.root.position.y = 12.2;
  controller._constrainPlayerToWalkable();
  assert.equal(controller.pendingPlayerJumpOffLanding?.y, 11.5);
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), upperSafe.toArray());

  player.jumpState = 'LandRecovery';
  player.velocity.y = 0;
  player.root.position.y = 11.5;
  controller._constrainPlayerToWalkable();
  assert.deepEqual(player.root.position.toArray(), [1, 11.5, 0]);
  assert.deepEqual(controller.lastSafePlayerPosition.toArray(), [1, 11.5, 0]);
  assert.equal(controller.pendingPlayerJumpOffLanding, null);
});

test('a supported upper catwalk does not invalidate a lower hallway with full headroom', () => {
  const generator = new DungeonGenerator();
  const lower = { x: 4, z: 9, elevation: -14 };
  const blockingTops = new Map([['4,9', -9.95]]);

  assert.equal(generator._isFloorTileBlockedByGeneratedPlatform(lower, blockingTops), false);
  blockingTops.set('4,9', -11.2);
  assert.equal(generator._isFloorTileBlockedByGeneratedPlatform(lower, blockingTops), true);
});
