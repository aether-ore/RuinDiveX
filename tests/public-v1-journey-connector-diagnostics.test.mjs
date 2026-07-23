import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Game } from '../src/Game.js';
import {
  followPublicFloorRoute,
  planPublicFinalEnemyPursuitRoute,
  planPublicFloorRoute,
  shouldRepositionPublicCombatTarget,
} from './helpers/public-v1-journey.js';

const CONNECTION_ID = 'entrance_enemyNest_ground';

function createDiagnosticHarness() {
  const floorTiles = [
    {
      x: 0,
      z: 0,
      elevation: 0,
      level: 0,
      surface: 'industrialRamp',
      roomId: null,
      connectionId: CONNECTION_ID,
      floorKey: '0,0@y0.000',
      rampStartElevation: 0,
      rampEndElevation: 7 / 13,
      rampDirectionX: 1,
      rampDirectionZ: 0,
    },
    {
      x: 1,
      z: 0,
      elevation: 7 / 13,
      level: 7 / 182,
      surface: 'industrialRamp',
      roomId: null,
      connectionId: CONNECTION_ID,
      floorKey: '1,0@y0.538',
      rampStartElevation: 7 / 13,
      rampEndElevation: 14 / 13,
      rampDirectionX: 1,
      rampDirectionZ: 0,
      traversalLinks: [{
        id: 'signed-ladder:forward',
        action: 'ladder',
        targetId: 'signed-ladder',
        toFloorKey: '1,2@y14.538',
      }],
    },
    {
      x: 1,
      z: 2,
      elevation: 14 + (7 / 13),
      level: 1,
      surface: 'connectorLanding',
      roomId: null,
      connectionId: CONNECTION_ID,
      floorKey: '1,2@y14.538',
      traversalLinks: [{
        id: 'signed-ladder:reverse',
        action: 'ladder',
        targetId: 'signed-ladder',
        toFloorKey: '1,0@y0.538',
      }],
    },
  ];
  const dungeon = {
    tileSize: 2.8,
    floorTiles,
    solidZones: [],
    platforms: [],
    doors: [],
    encounters: [],
    ladders: [],
    connectorLifts: [],
    connectionPlans: [{
      id: CONNECTION_ID,
      logicalConnectionId: 'entrance_enemyNest',
      fromRoomId: 'entrance',
      toRoomId: 'enemyNest',
      connectorType: 'ground_corridor',
      connectorVariantId: 'crested_slope_v1',
      connectorVariant: { traversalKind: 'slope' },
      direction: 'ascending',
      sourceElevation: 0,
      destinationElevation: 14,
      elevationDelta: 14,
      fromSocket: {
        id: `${CONNECTION_ID}_exit`,
        roomId: 'entrance',
        role: 'exit',
        x: 0,
        z: 0,
        elevation: 0,
        facingX: 1,
        facingZ: 0,
      },
      toSocket: {
        id: `${CONNECTION_ID}_entrance`,
        roomId: 'enemyNest',
        role: 'entrance',
        x: 1,
        z: 2,
        elevation: 14,
        facingX: -1,
        facingZ: 0,
      },
      higherEndpoint: {
        role: 'destination',
        socketId: `${CONNECTION_ID}_entrance`,
        roomId: 'enemyNest',
        elevation: 14,
        position: { x: 1, y: 14, z: 2 },
      },
      lowerEndpoint: {
        role: 'source',
        socketId: `${CONNECTION_ID}_exit`,
        roomId: 'entrance',
        elevation: 0,
        position: { x: 0, y: 0, z: 0 },
      },
      bridgePath: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 2 }],
    }],
  };
  const controller = {
    encounters: [],
    keycards: [],
    chests: [],
    mechanisms: [],
    traps: [],
    progressionManager: { collectedKeycardIds: new Set() },
    getNearestInteractable: () => null,
  };
  const playerPosition = new THREE.Vector3(0, 0, 0);
  return {
    worldKind: 'dungeon',
    transitionState: 'dungeon',
    dungeon,
    dungeonController: controller,
    player: {
      root: { position: playerPosition, rotation: { y: 0 } },
      health: 100,
      stats: { maxHealth: 100 },
      barrier: { capacity: 0, current: 0, broken: false, recharging: false },
      jumpState: 'Grounded',
      dead: false,
      isLedgeClinging: () => false,
      getLadderTraversalDiagnostics: () => null,
      getActiveArmWeapon: () => null,
    },
    camera: null,
    combat: null,
    enemies: [],
    platformingPlatforms: [],
    dynamicPlatformingPlatforms: [],
    ruinCompleted: false,
  };
}

test('public V1 diagnostics serialize connector routes and stamp floor/link connection ids', () => {
  const game = createDiagnosticHarness();
  const snapshot = Game.prototype.getPublicDungeonJourneyDiagnostics.call(game);

  assert.deepEqual(snapshot.connectorRoutes, [{
    connectionId: CONNECTION_ID,
    logicalConnectionId: 'entrance_enemyNest',
    fromRoomId: 'entrance',
    toRoomId: 'enemyNest',
    connectorType: 'ground_corridor',
    connectorVariantId: 'crested_slope_v1',
    traversalKind: 'slope',
    direction: 'ascending',
    sourceElevation: 0,
    destinationElevation: 14,
    elevationDelta: 14,
    sourceSocket: {
      id: `${CONNECTION_ID}_exit`,
      roomId: 'entrance',
      role: 'exit',
      x: 0,
      y: 0,
      z: 0,
      elevation: 0,
      facingX: 1,
      facingZ: 0,
      floorKey: null,
    },
    destinationSocket: {
      id: `${CONNECTION_ID}_entrance`,
      roomId: 'enemyNest',
      role: 'entrance',
      x: 1,
      y: 14,
      z: 2,
      elevation: 14,
      facingX: -1,
      facingZ: 0,
      floorKey: null,
    },
    higherEndpoint: {
      role: 'destination',
      socketId: `${CONNECTION_ID}_entrance`,
      roomId: 'enemyNest',
      elevation: 14,
      position: { x: 1, y: 14, z: 2 },
    },
    lowerEndpoint: {
      role: 'source',
      socketId: `${CONNECTION_ID}_exit`,
      roomId: 'entrance',
      elevation: 0,
      position: { x: 0, y: 0, z: 0 },
    },
    path: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 2 }],
  }]);
  assert.equal(snapshot.floorTiles[0].connectionId, CONNECTION_ID);
  assert.equal(snapshot.floorTiles[1].traversalLinks[0].connectionId, CONNECTION_ID);

  snapshot.connectorRoutes[0].direction = 'mutated';
  snapshot.floorTiles[0].connectionId = 'mutated';
  assert.equal(game.dungeon.connectionPlans[0].direction, 'ascending');
  assert.equal(game.dungeon.floorTiles[0].connectionId, CONNECTION_ID);

  const metadataOnly = Game.prototype.getPublicDungeonJourneyDiagnostics.call(
    game,
    { includeGeometry: false },
  );
  assert.deepEqual(metadataOnly.connectorRoutes[0].path, []);
  assert.deepEqual(metadataOnly.floorTiles, []);
});

test('public route steps retain connector identity for ramps and explicit mechanisms', () => {
  const snapshot = Game.prototype.getPublicDungeonJourneyDiagnostics.call(
    createDiagnosticHarness(),
  );
  const rampRoute = planPublicFloorRoute(
    snapshot,
    { x: 2.8, y: 7 / 13, z: 0 },
    { targetRadius: 0.2, maximumTargetVerticalDifference: 0.1 },
  );
  assert.equal(rampRoute.at(-1).action, 'ramp');
  assert.equal(rampRoute.at(-1).connectionId, CONNECTION_ID);
  assert.equal(rampRoute.at(-1).tile.connectionId, CONNECTION_ID);

  snapshot.player.position = { x: 2.8, y: 7 / 13, z: 0 };
  const ladderRoute = planPublicFloorRoute(
    snapshot,
    { x: 2.8, y: 14 + (7 / 13), z: 5.6 },
    { targetRadius: 0.2, maximumTargetVerticalDifference: 0.1 },
  );
  assert.equal(ladderRoute.at(-1).action, 'ladder');
  assert.equal(ladderRoute.at(-1).connectionId, CONNECTION_ID);
  assert.equal(ladderRoute.at(-1).targetId, 'signed-ladder');
});

test('public route execution reports traversed ramp actions and connector ids', async () => {
  const game = createDiagnosticHarness();
  game.getPublicDungeonJourneyDiagnostics = Game.prototype.getPublicDungeonJourneyDiagnostics;
  const page = {
    async evaluate(callback, options) {
      globalThis.window = { game };
      try {
        return callback(options);
      } finally {
        delete globalThis.window;
      }
    },
    async waitForTimeout() {},
    keyboard: {
      async down(key) {
        if (key === 'KeyA') game.player.root.rotation.y = Math.PI / 2;
        if (key === 'KeyD') game.player.root.rotation.y = -Math.PI / 2;
        if (key === 'KeyW') game.player.root.position.set(2.8, 7 / 13, 0);
      },
      async up() {},
      async press() {},
    },
  };

  const result = await followPublicFloorRoute(
    page,
    { x: 2.8, y: 7 / 13, z: 0 },
    {
      targetRadius: 0.2,
      maximumTargetVerticalDifference: 0.1,
      stopDistance: 0.2,
      timeout: 2_000,
      maximumReplans: 0,
    },
  );

  assert.ok(result.traversedActions.includes('ramp'));
  assert.deepEqual(result.traversedConnectorIds, [CONNECTION_ID]);
});

test('final live Enemy Nest flyer gets a clear authored firing-lane pursuit route', () => {
  const tileSize = 2.8;
  const floorTiles = [];
  for (let x = 0; x <= 5; x += 1) {
    for (let z = 0; z <= 2; z += 1) {
      floorTiles.push({
        x,
        z,
        elevation: 0,
        level: 0,
        surface: 'roomFloor',
        roomId: 'enemyNest',
        connectionId: null,
        floorKey: `${x},${z}@y0.000`,
      });
    }
  }
  const state = {
    tileSize,
    floorTiles,
    solidZones: [{
      id: 'nest-machine-blocker',
      active: true,
      position: { x: 5.6, y: 1.2, z: 0 },
      halfWidth: 1.15,
      halfDepth: 1.7,
      verticalHalfHeight: 2.4,
    }],
    platforms: [],
    doors: [],
    encounters: [{
      id: 'enemyNest',
      roomId: 'enemyNest',
      enemyIds: ['enemy-6'],
      cleared: false,
    }],
    enemies: [{
      id: 'enemy-6',
      encounterId: 'enemyNest',
      dead: false,
      health: 34.72,
      position: { x: 14, y: 1.6486, z: 0 },
    }],
    player: {
      position: { x: 0, y: 0, z: 0 },
    },
  };

  const pursuit = planPublicFinalEnemyPursuitRoute(state, 'enemyNest');
  assert.equal(pursuit.enemyId, 'enemy-6');
  assert.ok(pursuit.maximumTargetVerticalDifference >= 2.1);
  assert.ok(pursuit.route.some(({ point }) => point.z >= tileSize));
  assert.ok(
    Math.hypot(
      pursuit.route.at(-1).point.x - pursuit.targetPosition.x,
      pursuit.route.at(-1).point.z - pursuit.targetPosition.z,
    ) <= 6.15,
  );
  assert.equal(pursuit.route.at(-1).tile.roomId, 'enemyNest');

  state.encounters[0].enemyIds.push('enemy-7');
  state.enemies.push({
    id: 'enemy-7',
    encounterId: 'enemyNest',
    dead: false,
    health: 10,
    position: { x: 11.2, y: 0, z: 5.6 },
  });
  assert.equal(planPublicFinalEnemyPursuitRoute(state, 'enemyNest'), null);
});

test('retained in-range aerial Buster lock attacks instead of routing on a stalled watchdog', () => {
  const observedFinalFlyer = {
    hasLockedEnemy: true,
    movementLocked: true,
    targetDistance: Math.hypot(-12.51 - -8.32, 35.59 - 35.83),
    targetHeight: 3.38,
    useBeamBlade: false,
    hasDamageStalled: true,
    forceBeamBladeFallback: false,
  };
  assert.equal(
    shouldRepositionPublicCombatTarget(observedFinalFlyer),
    false,
    'the retained final flyer is already a valid Buster shot',
  );
  assert.equal(
    shouldRepositionPublicCombatTarget({
      ...observedFinalFlyer,
      hasLockedEnemy: false,
      movementLocked: false,
    }),
    true,
    'an unlocked flyer still requires physical pursuit/reacquisition',
  );
  assert.equal(
    shouldRepositionPublicCombatTarget({
      ...observedFinalFlyer,
      targetDistance: 6.5,
      targetHeight: 4,
    }),
    true,
    'a retained flyer outside three-dimensional Buster range must be approached',
  );
});
