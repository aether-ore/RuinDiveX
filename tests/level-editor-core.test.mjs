import test from 'node:test';
import assert from 'node:assert/strict';
import * as fflate from 'fflate';
import {
  AUTHORED_DUNGEON_SCHEMA,
  LEVEL_EDITOR_PROJECT_SCHEMA,
  ROOM_MODULE_SCHEMA,
  ROOM_REGISTRY_SCHEMA,
  canonicalStringify,
  compileEditorProject,
  createDefaultLevelEditorProject,
  exportProjectZip,
  hashBlobSha256,
  importProjectZip,
  migrateDraftDocument,
  migrateLevelEditorProjectWithReport,
  normalizeLevelEditorProject,
  parseProjectDataModule,
  parsePureDataModule,
  serializeProjectDataModule,
  sha256Text,
  validateAuthoredDungeon,
  validateRoomModule,
} from '../src/level-editor/core/index.js';

const transform = (x = 0, y = 0, z = 0) => ({
  position: { x, y, z },
  rotationY: 0,
  scale: { x: 1, y: 1, z: 1 },
});

const socket = (id, z, facingZ) => ({
  id,
  kind: 'player',
  x: 0,
  z,
  elevation: 0,
  facingX: 0,
  facingZ,
  widthMeters: 4,
  heightMeters: 4,
});

function roomModule(moduleId, socketDefinition) {
  return {
    schema: ROOM_MODULE_SCHEMA,
    moduleId,
    topologyRevision: 1,
    themePackId: 'test-theme',
    tileSize: 2.8,
    dimensions: { widthTiles: 4, depthTiles: 4 },
    room: { id: moduleId, baseElevation: 0 },
    sockets: [socketDefinition],
  };
}

function playableProject() {
  const project = createDefaultLevelEditorProject({
    projectId: 'core-test',
    name: 'Core Test',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  });
  project.roomModules = [
    roomModule('entrance', socket('east', 5, 1)),
    roomModule('exit-room', socket('west', -5, -1)),
  ];
  project.rooms = [
    { id: 'room-a', moduleId: 'entrance', transform: transform() },
    { id: 'room-b', moduleId: 'exit-room', transform: transform(0, 0, 20) },
  ];
  project.connections = [{
    id: 'connection-a-b',
    from: { roomId: 'room-a', socketId: 'east' },
    to: { roomId: 'room-b', socketId: 'west' },
    bidirectional: true,
  }];
  project.entities = [
    { id: 'spawn', kind: 'spawn', type: 'player-spawn', roomId: 'room-a', transform: transform(), properties: {} },
    { id: 'exit', kind: 'extraction', type: 'level-exit', roomId: 'room-b', transform: transform(), properties: {} },
  ];
  project.settings.spawnId = 'spawn';
  return project;
}

test('schema constants and canonical SHA-256 are stable', () => {
  assert.equal(LEVEL_EDITOR_PROJECT_SCHEMA, 'ruindivex-level-editor-project/v1');
  assert.equal(ROOM_MODULE_SCHEMA, 'ruindivex-room-module/v1');
  assert.equal(AUTHORED_DUNGEON_SCHEMA, 'ruindivex-authored-dungeon/v1');
  assert.equal(ROOM_REGISTRY_SCHEMA, 'ruindivex-room-registry/v1');
  assert.equal(canonicalStringify({ z: 1, a: [true, null] }), '{"a":[true,null],"z":1}');
  assert.equal(sha256Text('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('room module validation returns path-addressed reference diagnostics', () => {
  const module = roomModule('module-a', socket('door', 5, 1));
  module.socketFrames = [{ id: 'bad-frame', socketId: 'missing' }];
  const validation = validateRoomModule(module);
  assert.equal(validation.ok, false);
  assert.equal(validation.errors[0].code, 'socket-frame-reference-missing');
  assert.equal(validation.errors[0].path, '$.socketFrames[0].socketId');
});

test('compiler emits a deterministic authored dungeon and validated registry', () => {
  const project = playableProject();
  const first = compileEditorProject(project);
  assert.equal(first.ok, true, first.diagnostics.map(({ code }) => code).join(', '));
  assert.equal(first.value.schema, AUTHORED_DUNGEON_SCHEMA);
  assert.equal(first.registry.schema, ROOM_REGISTRY_SCHEMA);
  assert.match(first.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(validateAuthoredDungeon(first.value, { roomRegistry: first.registry }).ok, true);

  const reordered = structuredClone(project);
  reordered.rooms.reverse();
  reordered.entities.reverse();
  reordered.roomModules.reverse();
  assert.equal(compileEditorProject(reordered).hash, first.hash);
});

test('compiler rejects missing room/socket gameplay references', () => {
  const project = playableProject();
  project.connections[0].to.socketId = 'not-a-socket';
  const result = compileEditorProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(({ code }) => code === 'connection-socket-reference-missing'));
  assert.equal(result.value, null);
  assert.equal(result.candidate.schema, AUTHORED_DUNGEON_SCHEMA);
});

test('pure-data ES modules round-trip without execution', () => {
  const project = playableProject();
  const text = serializeProjectDataModule(project);
  assert.deepEqual(parseProjectDataModule(text), project);
  assert.throws(
    () => parsePureDataModule('globalThis.pwned = true; export default {};'),
    /Only .* data modules are accepted/,
  );
});

test('draft migration upgrades unversioned project data', () => {
  const report = migrateDraftDocument({
    id: 'old-project',
    title: 'Old Project',
    roomInstances: [],
    links: [],
    objects: [],
  }, {
    kind: 'project',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  });
  assert.equal(report.migrated, true);
  assert.equal(report.value.schema, LEVEL_EDITOR_PROJECT_SCHEMA);
  assert.equal(report.value.projectId, 'old-project');
});

test('project normalization migrates legacy generated door sockets to floor thresholds', () => {
  const project = playableProject();
  project.roomModules[0].topologyRevision = 4;
  project.roomModules[0].metadata = { authoredBy: 'RuinDiver Level Forge' };
  project.roomModules[0].sockets = [{
    id: 'east',
    name: 'North Door',
    type: 'door',
    kind: 'door',
    actorKind: 'player',
    facing: { x: 0, y: 0, z: -1 },
    transform: { position: { x: 0, y: 1.2, z: -5.6 }, rotationY: Math.PI },
    widthMeters: 8.4,
    heightMeters: 5.6,
    compatibleFamilies: ['door', 'corridor'],
    capPreset: 'sealed-wall',
    properties: {},
  }];
  project.roomModules[1].metadata = { authoredBy: 'RuinDiver Level Forge' };
  project.roomModules[1].sockets = [{
    ...structuredClone(project.roomModules[0].sockets[0]),
    id: 'west',
    name: 'South Door',
    transform: { position: { x: 0, y: 1.2, z: 5.6 }, rotationY: 0 },
    facing: { x: 0, y: 0, z: 1 },
  }];
  for (const room of project.rooms) {
    room.transform.position.y = 14;
    room.transform.scale.y = 2;
  }
  project.connections[0].properties = {
    authoredWith: 'connection-interface',
    route: { waypoints: [{ x: 0, y: 16.4, z: 8.4 }, { x: 0, y: 16.4, z: 11.2 }] },
  };

  const migration = migrateLevelEditorProjectWithReport(project);
  assert.equal(migration.migrated, true);
  assert.ok(migration.diagnostics.some(({ code }) => code === 'legacy-door-thresholds-migrated'));
  const normalized = migration.project;
  const module = normalized.roomModules.find(({ moduleId }) => moduleId === 'entrance');
  const migratedSocket = module.sockets[0];
  assert.equal(migratedSocket.position.y, 0);
  assert.equal(migratedSocket.transform.position.y, 0);
  assert.equal(migratedSocket.properties.positionAnchor, 'threshold-floor');
  assert.equal(module.topologyRevision, 5);
  assert.deepEqual(normalized.connections[0].properties.route.waypoints.map(({ y }) => y), [14, 14]);

  const normalizedAgain = normalizeLevelEditorProject(normalized);
  assert.equal(normalizedAgain.roomModules.find(({ moduleId }) => moduleId === 'entrance').topologyRevision, 5);

  const intentional = playableProject();
  intentional.roomModules[0].metadata = { authoredBy: 'RuinDiver Level Forge' };
  intentional.roomModules[0].sockets = [{
    ...structuredClone(project.roomModules[0].sockets[0]),
    position: { x: 0, y: 1.2, z: -5.6 },
    properties: { positionAnchor: 'aperture-center' },
  }];
  const preserved = normalizeLevelEditorProject(intentional).roomModules[0].sockets[0];
  assert.equal(preserved.position.y, 1.2);
  assert.equal(preserved.transform.position.y, 1.2);
  assert.equal(preserved.properties.positionAnchor, 'aperture-center');
});

test('ZIP bundle and SHA-256 Blob assets round-trip through injected fflate', async () => {
  const project = playableProject();
  const blob = new Blob([new Uint8Array([0, 1, 2, 255])], { type: 'application/octet-stream' });
  const hash = await hashBlobSha256(blob);
  assert.equal(hash, 'sha256:3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56');
  const archive = await exportProjectZip(project, {
    fflate,
    assets: [{ hash, blob, name: 'sample.bin' }],
    document: project.roomModules[0],
    documentKind: 'room',
  });
  const imported = await importProjectZip(archive, { fflate });
  assert.equal(imported.ok, true, imported.diagnostics.map(({ code }) => code).join(', '));
  assert.equal(imported.project.projectId, project.projectId);
  assert.equal(imported.assets[0].hash, hash);
  assert.equal(imported.document.schema, ROOM_MODULE_SCHEMA);
  assert.equal(imported.document.moduleId, 'entrance');
  assert.deepEqual([...imported.assets[0].bytes], [0, 1, 2, 255]);
});
