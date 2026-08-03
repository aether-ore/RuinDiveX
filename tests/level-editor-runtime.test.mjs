import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DungeonController } from '../src/DungeonController.js';
import {
  ROOM_MODULE_SCHEMA,
  compileEditorProject,
  createDefaultLevelEditorProject,
  validateAuthoredDungeon,
} from '../src/level-editor/core/index.js';
import {
  AuthoredRoomRegistry,
  assembleAuthoredRoom,
  createDungeonFacade,
  generateRegistryDungeon,
} from '../src/level-editor/runtime/index.js';

const transform = (x = 0, y = 0, z = 0, rotationY = 0) => ({
  position: { x, y, z },
  rotationY,
  scale: { x: 1, y: 1, z: 1 },
});

const socket = (id, z, facingZ) => ({
  id,
  actorKind: 'player',
  position: { x: 0, y: 0, z },
  facing: { x: 0, y: 0, z: facingZ },
  widthMeters: 8.4,
  heightMeters: 5.6,
  landingRequirements: {
    minWidthMeters: 8.4,
    minDepthMeters: 8.4,
  },
  clearanceRequirements: {
    widthMeters: 8.4,
    heightMeters: 3.2,
    depthMeters: 2.8,
  },
  compatibleFamilies: ['service-gallery'],
  optional: true,
  capPreset: 'sealed-wall',
});

function authoredRoomModule(moduleId, socketDefinition) {
  return {
    schema: ROOM_MODULE_SCHEMA,
    moduleId,
    topologyRevision: 1,
    themePackId: 'runtime-test',
    tileSize: 2.8,
    dimensions: {
      widthMeters: 11.2,
      depthMeters: 11.2,
      heightMeters: 5.6,
    },
    room: {
      id: moduleId,
      name: moduleId,
      baseElevation: 0,
    },
    geometry: {
      surfaces: [{
        id: `${moduleId}-floor`,
        surfaceRole: 'floor',
        thickness: 0.2,
        elevation: 0,
        grid: { columns: 4, rows: 4, tileSize: 2.8 },
        materialId: 'floor',
      }],
      primitives: [{
        id: `${moduleId}-wall`,
        shape: 'box',
        size: { x: 11.2, y: 3, z: 0.2 },
        position: { x: 0, y: 1.5, z: -5.6 },
        materialId: 'wall',
        collider: true,
      }],
    },
    colliders: [{
      id: `${moduleId}-explicit-collider`,
      position: { x: 4, y: 1, z: 0 },
      size: { x: 1, y: 2, z: 1 },
    }],
    sockets: socketDefinition ? [socketDefinition] : [],
  };
}

function playableProject() {
  const project = createDefaultLevelEditorProject({
    projectId: 'runtime-authored-dungeon',
    name: 'Runtime Authored Dungeon',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  });
  project.roomModules = [
    authoredRoomModule('room-module-a', socket('south', 5.6, 1)),
    authoredRoomModule('room-module-b', socket('north', -5.6, -1)),
  ];
  project.rooms = [
    { id: 'room-a', moduleId: 'room-module-a', transform: transform() },
    { id: 'room-b', moduleId: 'room-module-b', transform: transform(0, 0, 16.8) },
  ];
  project.connections = [{
    id: 'gallery-a-b',
    from: { roomId: 'room-a', socketId: 'south' },
    to: { roomId: 'room-b', socketId: 'north' },
    family: 'service-gallery',
    kind: 'service-gallery',
    bidirectional: true,
  }];
  project.entities = [
    {
      id: 'player-start',
      kind: 'player-spawn',
      type: 'player-spawn',
      roomId: 'room-a',
      transform: transform(0, 0, 0),
      properties: {},
    },
    {
      id: 'extract',
      kind: 'extraction',
      type: 'extraction',
      roomId: 'room-b',
      transform: transform(0, 0, 0),
      properties: { required: true },
    },
  ];
  project.settings.spawnId = 'player-start';
  return project;
}

function connectorTraversalHarness(facade) {
  const player = {
    radius: 0.35,
    root: { position: new THREE.Vector3() },
    velocity: new THREE.Vector3(),
    isJumping: () => false,
    isJumpAirborne: () => false,
    isClimbingLadder: () => false,
  };
  const game = {
    player,
    getPlatformFloorElevation(position) {
      let support = null;
      for (const platform of facade.platforms) {
        if (platform?.enabled === false || !Number.isFinite(platform?.topY)) continue;
        const inside = typeof platform.containsTop === 'function'
          ? platform.containsTop(position, -0.08)
          : Math.abs(position.x - platform.center.x) <= platform.halfWidth + 0.08
            && Math.abs(position.z - platform.center.z) <= platform.halfDepth + 0.08;
        if (!inside || position.y < platform.topY - 0.5) continue;
        if (!support || Math.abs(position.y - platform.topY) < Math.abs(position.y - support.topY)) support = platform;
      }
      return support?.topY ?? null;
    },
    isPositionInsidePlatformBlock: () => false,
  };
  return { game, player, controller: new DungeonController(game, facade) };
}

test('authored room assembly creates geometry, traversal records, socket caps, and disposable ownership', async () => {
  const module = authoredRoomModule('standalone-room', socket('unused', 5.6, 1));
  module.geometry.primitives.push({
    id: 'collision-only-alias',
    type: 'collision-box',
    size: { x: 2, y: 2, z: 2 },
    position: { x: 0, y: 1, z: 2 },
    collision: true,
    properties: { visual: false },
  });
  const result = await assembleAuthoredRoom(module, { capUnusedSockets: true });
  const parent = new THREE.Group();
  parent.add(result.group);

  assert.equal(result.group.userData.authoredRoom, true);
  assert.equal(result.floorTiles.length, 16);
  assert.equal(result.socketFrames.length, 1);
  assert.equal(result.socketCaps.length, 1);
  assert.ok(result.meshes.some((mesh) => mesh.name === 'standalone-room-wall'));
  assert.ok(result.solidZones.some(({ id }) => id === 'standalone-room-explicit-collider'));
  assert.ok(result.solidZones.some(({ id }) => id === 'standalone-room-wall-collider'));
  assert.ok(result.solidZones.some(({ id }) => id === 'collision-only-alias-collider'));
  assert.ok(!result.meshes.some((mesh) => mesh.name === 'collision-only-alias'));
  assert.ok(result.disposableResources.size > 0);

  result.dispose();
  result.dispose();
  assert.equal(result.disposed, true);
  assert.equal(parent.children.length, 0);
  assert.equal(result.disposableResources.size, 0);
});

test('editor primitive floors provide grounded support without becoming blocking solids', async () => {
  const floorId = 'editor-floor';
  const result = await assembleAuthoredRoom({
    schema: ROOM_MODULE_SCHEMA,
    moduleId: 'editor-primitive-room',
    tileSize: 2.8,
    primitives: [
      {
        id: floorId,
        kind: 'primitive',
        type: 'floor',
        shape: 'box',
        size: { x: 16.8, y: 0.2, z: 16.8 },
        transform: transform(0, -0.1, 0),
        collision: true,
        enabled: true,
      },
      {
        id: 'editor-wall',
        kind: 'primitive',
        type: 'wall',
        shape: 'box',
        size: { x: 16.8, y: 5.6, z: 0.2 },
        transform: transform(0, 2.8, -8.4),
        collision: true,
        enabled: true,
      },
    ],
  });

  assert.equal(result.floorTiles.length, 36);
  assert.ok(result.floorTiles.every(({ x, z }) => Number.isInteger(x) && Number.isInteger(z)));
  assert.ok(result.floorTiles.some(({ x, z, elevation }) => x === 0 && z === 0 && elevation === 0));
  assert.ok(!result.solidZones.some(({ id }) => id === `${floorId}-collider`));
  assert.ok(result.solidZones.some(({ id }) => id === 'editor-wall-collider'));
  assert.equal(result.platforms.length, 1);
  assert.equal(result.platforms[0].topY, 0);
  assert.equal(result.platforms[0].blocksBelow, false);
  assert.equal(result.platforms[0].containsTop(new THREE.Vector3(4, 0, 4)), true);
  assert.equal(result.platforms[0].containsTop(new THREE.Vector3(9, 0, 0)), false);

  result.dispose();
});

test('explicit connector waypoints reject diagonal routes before materialization', async () => {
  const compiled = compileEditorProject(playableProject());
  compiled.dungeon.connections[0].route = {
    waypoints: [{ x: 2.8, y: 0, z: 8.4 }],
  };
  await assert.rejects(
    () => createDungeonFacade(compiled, { strict: true }),
    (error) => error instanceof AggregateError
      && error.errors.some((entry) => /diagonal route segment|orthogonal grid route/i.test(entry.message)),
  );
});

test('service galleries reject elevated endpoints instead of materializing an untraversable implicit slope', async () => {
  const compiled = compileEditorProject(playableProject());
  compiled.dungeon.rooms.find(({ id }) => id === 'room-b').transform.position.y = 14;
  await assert.rejects(
    () => createDungeonFacade(compiled, { strict: true }),
    (error) => error instanceof AggregateError
      && error.errors.some((entry) => /service galleries require level endpoints/i.test(entry.message)),
  );
});

test('signed slopes require level endpoint buffers', async () => {
  const compiled = compileEditorProject(playableProject());
  compiled.dungeon.rooms.find(({ id }) => id === 'room-b').transform.position.y = 14;
  compiled.dungeon.connections[0].kind = 'slope';
  await assert.rejects(
    () => createDungeonFacade(compiled, { strict: true }),
    (error) => error instanceof AggregateError
      && error.errors.some((entry) => /flat endpoint buffers/i.test(entry.message)),
  );
});

test('signed slopes reject vertical route segments', async () => {
  const compiled = compileEditorProject(playableProject());
  compiled.dungeon.rooms.find(({ id }) => id === 'room-b').transform.position.y = 14;
  const connection = compiled.dungeon.connections[0];
  connection.kind = 'slope';
  connection.route = {
    waypoints: [
      { x: 0, y: 0, z: 11.2 },
      { x: 0, y: 14, z: 11.2 },
      { x: 0, y: 14, z: 5.6 },
    ],
  };
  await assert.rejects(
    () => createDungeonFacade(compiled, { strict: true }),
    (error) => error instanceof AggregateError
      && error.errors.some((entry) => /vertical or over-steep slope segment/i.test(entry.message)),
  );
});

test('signed slopes reject over-steep horizontal route segments', async () => {
  const compiled = compileEditorProject(playableProject());
  const destination = compiled.dungeon.rooms.find(({ id }) => id === 'room-b');
  destination.transform.position.y = 14;
  destination.transform.position.z = 30.8;
  const connection = compiled.dungeon.connections[0];
  connection.kind = 'slope';
  connection.route = {
    waypoints: [
      { x: 0, y: 0, z: 11.2 },
      { x: 0, y: 14, z: 19.6 },
    ],
  };
  await assert.rejects(
    () => createDungeonFacade(compiled, { strict: true }),
    (error) => error instanceof AggregateError
      && error.errors.some((entry) => /vertical or over-steep slope segment/i.test(entry.message)),
  );
});

test('lifts require one vertically aligned shaft and publish their live support surface', async () => {
  const misaligned = compileEditorProject(playableProject());
  misaligned.dungeon.rooms.find(({ id }) => id === 'room-b').transform.position.y = 14;
  misaligned.dungeon.connections[0].kind = 'lift';
  await assert.rejects(
    () => createDungeonFacade(misaligned, { strict: true }),
    (error) => error instanceof AggregateError
      && error.errors.some((entry) => /must share one vertical shaft/i.test(entry.message)),
  );

  const aligned = compileEditorProject(playableProject());
  const destination = aligned.dungeon.rooms.find(({ id }) => id === 'room-b');
  destination.transform.position.y = 14;
  destination.transform.position.z = 11.2;
  aligned.dungeon.connections[0].kind = 'lift';
  const facade = await createDungeonFacade(aligned, { strict: true });
  assert.equal(facade.connectorDiagnostics[0].liftShaftAligned, true);
  assert.equal(facade.connectorLifts.length, 1);
  assert.ok(facade.platforms.includes(facade.connectorLifts[0].surface));
  facade.dispose();
});

test('compiled editor project assembles through the public facade with connected sockets and gameplay arrays', async () => {
  const compiled = compileEditorProject(playableProject());
  assert.equal(compiled.ok, true, compiled.diagnostics.map(({ code }) => code).join(', '));
  assert.equal(validateAuthoredDungeon(compiled.dungeon, { roomRegistry: compiled.registry }).ok, true);

  const facade = await createDungeonFacade(compiled, { strict: true });
  assert.equal(facade.dungeonKind, 'authoredDungeon');
  assert.equal(facade.rooms.length, 2);
  assert.equal(facade.connections.length, 1);
  assert.equal(facade.serviceGalleries.length, 1);
  const connectorDiagnostic = facade.connectorDiagnostics[0];
  assert.equal(connectorDiagnostic.accepted, true);
  assert.equal(connectorDiagnostic.minimumHeadroomMeters, 3.6);
  assert.equal(connectorDiagnostic.headroomAccepted, true);
  assert.equal(connectorDiagnostic.elevationAccepted, true);
  assert.equal(connectorDiagnostic.facingAccepted, true);
  assert.equal(connectorDiagnostic.familiesAccepted, true);
  assert.deepEqual(connectorDiagnostic.compatibleFamilies, ['service-gallery']);
  assert.equal(facade.serviceGalleries[0].width, 8.4);
  facade.connections[0].waypoints.slice(1).forEach((point, index) => {
    const previous = facade.connections[0].waypoints[index];
    const dx = Math.abs(point.x - previous.x);
    const dz = Math.abs(point.z - previous.z);
    assert.ok(dx < 1e-6 || dz < 1e-6, 'automatically routed segments must be orthogonal');
  });
  assert.equal(facade.socketFrames.length, 2);
  assert.equal(facade.socketCaps.length, 0);
  assert.ok(facade.floorTiles.length > 32, 'connector floor samples should extend the two room floors');
  assert.ok(facade.playerStart instanceof THREE.Vector3);
  assert.equal(facade.playerStart.x, 0);
  assert.equal(facade.playerStart.z, 0);
  assert.equal(facade.exits.length, 1);
  assert.equal(facade.progression.validation.accepted, true);
  assert.ok(facade.progression.minimap.bounds.width > 0);
  assert.equal(facade.progression.minimap.rooms[0].roomId, 'room-a');
  assert.ok(facade.progression.minimap.rooms.every(({ roomId, roomCenter2D }) => roomId && roomCenter2D));
  assert.ok(Array.isArray(facade.progression.minimap.hallways));
  assert.ok(facade.disposableResources.size > 0);

  facade.dispose();
  facade.dispose();
  assert.equal(facade.disposed, true);
  assert.equal(facade.disposableResources.size, 0);
});

test('gallery connectors provide full-width physical traversal across bends and fractional placements', async () => {
  const project = playableProject();
  project.rooms[0].transform = transform(0.05, 0, 0);
  project.rooms[1].transform = transform(14.05, 0, 22.4);
  const compiled = compileEditorProject(project);
  assert.equal(compiled.ok, true, compiled.diagnostics.map(({ code }) => code).join(', '));
  compiled.dungeon.connections[0].route = {
    waypoints: [
      { x: 0.05, y: 0, z: 11.2 },
      { x: 14.05, y: 0, z: 11.2 },
    ],
  };

  const facade = await createDungeonFacade(compiled, { strict: true });
  const connectorTiles = facade.floorTiles.filter(({ connectorId }) => connectorId === 'gallery-a-b');
  const connectorPlatforms = facade.platforms.filter(({ connectorId }) => connectorId === 'gallery-a-b');
  const deckPlatforms = connectorPlatforms.filter(({ surfaceRole }) => surfaceRole === 'walkway');
  const destinationAssembly = facade.roomAssemblies.find(({ roomId }) => roomId === 'room-b')?.assembly;

  assert.equal(facade.connectorDiagnostics[0].accepted, true);
  assert.ok(connectorTiles.length >= 9, 'connector traversal should cover more than a centerline');
  assert.ok(connectorTiles.every(({ x, z }) => Number.isInteger(x) && Number.isInteger(z)));
  assert.equal(new Set(connectorTiles.map(({ id }) => id)).size, connectorTiles.length);
  assert.equal(deckPlatforms.length, 3, 'each visible route segment needs a continuous support surface');
  assert.ok(deckPlatforms.some(({ halfWidth, halfDepth, rotationY }) => (
    rotationY === 0 && halfWidth > halfDepth
  )), 'X-running decks must publish world-axis platform bounds');
  assert.equal(new Set(connectorPlatforms.map(({ id }) => id)).size, connectorPlatforms.length);
  assert.ok(connectorPlatforms.every(({ blocksBelow }) => blocksBelow === false));
  assert.ok(
    destinationAssembly.meshes.some(({ name }) => name.includes('wall portal segment')),
    destinationAssembly.meshes.map(({ name }) => name).join(', '),
  );
  assert.ok(!destinationAssembly.meshes.some(({ name }) => name === 'room-module-b-wall'));
  assert.ok(!facade.solidZones.some(({ id }) => id === 'room-module-b-wall-collider'));
  assert.ok(!facade.solidZones.some(({ connectorId, obstacleKind }) => (
    connectorId === 'gallery-a-b' && obstacleKind !== 'connectorRail'
  )), 'the deck must support the player without becoming a blocking solid');

  const { controller, player } = connectorTraversalHarness(facade);
  const route = facade.connections[0].waypoints;
  for (let segmentIndex = 0; segmentIndex < route.length - 1; segmentIndex += 1) {
    const start = route[segmentIndex];
    const end = route[segmentIndex + 1];
    const direction = end.clone().sub(start).setY(0).normalize();
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    for (const alpha of [0, 0.08, 0.25, 0.5, 0.75, 0.92, 1]) {
      for (const lateral of [-3.6, 0, 3.6]) {
        const sample = start.clone().lerp(end, alpha).addScaledVector(side, lateral);
        assert.equal(controller.game.getPlatformFloorElevation(sample), 0, `missing platform support on segment ${segmentIndex}`);
        assert.equal(
          controller.isPositionWalkable(sample),
          true,
          `connector sample is not walkable on segment ${segmentIndex} at alpha ${alpha}, lateral ${lateral}: ${sample.toArray().join(',')}`,
        );
      }
    }
  }

  const bend = route[1];
  for (const offset of [-0.04, 0.04]) {
    const sample = bend.clone().add(new THREE.Vector3(offset, 0, offset));
    assert.equal(controller.game.getPlatformFloorElevation(sample), 0, 'support must overlap through connector bends');
    assert.equal(controller.isPositionWalkable(sample), true);
  }
  const outside = route[1].clone().lerp(route[2], 0.5).add(new THREE.Vector3(0, 0, 4.4));
  assert.equal(controller.game.getPlatformFloorElevation(outside), null);
  assert.equal(controller.isPositionWalkable(outside), false);

  const groundedProbe = route[1].clone().lerp(route[2], 0.5).add(new THREE.Vector3(0, 0, 3.6));
  player.root.position.copy(groundedProbe);
  controller.lastSafePlayerPosition.copy(route[1]);
  controller._constrainPlayerToWalkable();
  assert.ok(player.root.position.distanceTo(groundedProbe) < 1e-8, 'ground correction must not pin the player off the walkway');

  facade.dispose();
});

test('connector collision support exists when connector render geometry is disabled', async () => {
  const compiled = compileEditorProject(playableProject());
  const facade = await createDungeonFacade(compiled, {
    strict: true,
    createConnectorGeometry: false,
  });
  const connectorTiles = facade.floorTiles.filter(({ connectorId }) => connectorId === 'gallery-a-b');
  const connectorPlatforms = facade.platforms.filter(({ connectorId }) => connectorId === 'gallery-a-b');

  assert.ok(connectorTiles.length > 0);
  assert.ok(connectorPlatforms.some(({ surfaceRole }) => surfaceRole === 'walkway'));
  assert.equal(facade.connections[0].group.children.length, 0);
  const { controller } = connectorTraversalHarness(facade);
  assert.equal(controller.isPositionWalkable(new THREE.Vector3(0, 0, 8.4)), true);

  facade.dispose();
});

test('room registry resolves declarative modules and rejects duplicate registrations', async () => {
  const module = authoredRoomModule('registry-room', socket('socket-a', 5.6, 1));
  const registry = await AuthoredRoomRegistry.load({
    schema: 'ruindivex-room-registry/v1',
    registryId: 'runtime-registry',
    revision: 1,
    modules: [module],
  });
  assert.equal(registry.has('registry-room'), true);
  assert.equal((await registry.resolve('registry-room')).moduleId, 'registry-room');
  assert.throws(() => registry.register('registry-room', module), /already registered/i);
});

test('legacy facade dispatch remains injected and receives normalized facade fields', async () => {
  let invocation = null;
  const facade = await createDungeonFacade({ family: 'industrial' }, {
    mode: 'legacy',
    legacyFactory(source, options) {
      invocation = { source, options };
      return { group: new THREE.Group(), rooms: [{ id: 'legacy-start' }] };
    },
  });

  assert.equal(invocation.source.family, 'industrial');
  assert.equal(facade.dungeonKind, 'legacyDungeon');
  assert.equal(facade.rooms[0].id, 'legacy-start');
  assert.ok(facade.playerStart instanceof THREE.Vector3);
  assert.ok(Array.isArray(facade.floorTiles));
  assert.ok(facade.tiles instanceof Map);
});

test('incomplete registry generation falls back to the injected Industrial facade with diagnostics', async () => {
  let receivedDiagnostics = null;
  const facade = await createDungeonFacade({
    schema: 'ruindivex-room-registry/v1',
    registryId: 'empty-registry',
    revision: 1,
    modules: [],
  }, {
    mode: 'registry',
    legacyFactory: async (_source, options) => {
      receivedDiagnostics = options.registryGenerationDiagnostics;
      return { group: new THREE.Group(), playerStart: new THREE.Vector3() };
    },
  });

  assert.equal(facade.dungeonKind, 'legacyDungeon');
  assert.equal(facade.generationDiagnostics.accepted, false);
  assert.equal(facade.generationDiagnostics.fallback.used, true);
  assert.equal(facade.generationDiagnostics.fallback.family, 'industrial');
  assert.ok(receivedDiagnostics.errors.length > 0);
});

test('registry generation rejects incompatible socket families before authored assembly', async () => {
  const entrance = authoredRoomModule('family-entrance', {
    ...socket('out', 5.6, 1),
    compatibleFamilies: ['service-gallery'],
  });
  entrance.role = 'entrance';
  const exit = authoredRoomModule('family-exit', {
    ...socket('in', -5.6, -1),
    compatibleFamilies: ['automatic-lift'],
  });
  exit.role = 'exit';
  const generation = await generateRegistryDungeon({
    schema: 'ruindivex-room-registry/v1',
    registryId: 'family-registry',
    revision: 1,
    modules: [entrance, exit],
  }, { seed: 'family-test', roles: ['entrance', 'exit'] });

  assert.equal(generation.ok, false);
  assert.match(generation.diagnostics.errors.join(' '), /compatible sockets/i);
  assert.equal(generation.connections.length, 0);
});

test('registry generation is deterministic, role-complete, grid-aligned, and socket-connected', async () => {
  const entrance = authoredRoomModule('registry-entrance');
  entrance.tags = ['entrance'];
  entrance.sockets = [socket('entrance-out', 5.6, 1)];
  const combat = authoredRoomModule('registry-combat');
  combat.tags = ['combat'];
  combat.sockets = [socket('combat-in', -5.6, -1), socket('combat-out', 5.6, 1)];
  const exit = authoredRoomModule('registry-exit');
  exit.tags = ['exit'];
  exit.sockets = [socket('exit-in', -5.6, -1)];
  const registry = {
    schema: 'ruindivex-room-registry/v1',
    registryId: 'deterministic-runtime-registry',
    revision: 1,
    modules: [entrance, combat, exit],
  };
  const options = {
    seed: 'stable-registry-seed',
    roles: ['entrance', 'combat', 'exit'],
    tileSize: 2.8,
  };

  const first = await generateRegistryDungeon(registry, options);
  const second = await generateRegistryDungeon(registry, options);
  assert.equal(first.ok, true, first.diagnostics.errors.join(', '));
  assert.equal(first.diagnostics.fallbacks.length, 0);
  assert.deepEqual(
    first.dungeon.rooms.map(({ id, moduleId, transform: value }) => ({ id, moduleId, transform: value })),
    second.dungeon.rooms.map(({ id, moduleId, transform: value }) => ({ id, moduleId, transform: value })),
  );
  assert.deepEqual(first.dungeon.connections, second.dungeon.connections);
  assert.deepEqual(first.dungeon.rooms.map(({ moduleId }) => moduleId), [
    'registry-entrance',
    'registry-combat',
    'registry-exit',
  ]);
  assert.equal(first.dungeon.connections.length, 2);
  for (const room of first.dungeon.rooms) {
    assert.ok(Math.abs(room.transform.position.x / 2.8 - Math.round(room.transform.position.x / 2.8)) < 1e-8);
    assert.ok(Math.abs(room.transform.position.z / 2.8 - Math.round(room.transform.position.z / 2.8)) < 1e-8);
    assert.equal(room.transform.rotationDegrees.y % 90, 0);
  }
});
