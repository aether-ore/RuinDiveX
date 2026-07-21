import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPECTED_PACK_ID,
  EXPECTED_PACK_INVENTORY,
  EXPECTED_ROOM_REPORTS,
  SEMANTIC_NODE_PREFIX,
  khronosReportByRoomId,
  loadPackAssetFixture,
  recursivePackInventory,
  roomReportById,
  sha256,
  sourceSemanticNodeNames,
} from './authored-room-pack-test-support.mjs';

const fixture = loadPackAssetFixture();
const expectedRoomIds = Object.keys(EXPECTED_ROOM_REPORTS);

function finiteTuple(value, length, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.equal(value.length, length, `${label} must contain ${length} values`);
  assert.ok(value.every(Number.isFinite), `${label} must contain only finite values`);
}

test('authored room pack inventory is exact and every indexed artifact is unique', () => {
  assert.deepEqual(recursivePackInventory(), [...EXPECTED_PACK_INVENTORY].sort());
  assert.equal(fixture.pack.schemaVersion, 1);
  assert.equal(fixture.pack.packId, EXPECTED_PACK_ID);
  assert.deepEqual(fixture.pack.rooms.map(({ roomId }) => roomId), expectedRoomIds);
  assert.equal(new Set(fixture.pack.rooms.map(({ roomId }) => roomId)).size, 4);

  for (const field of ['glb', 'manifest', 'preview']) {
    const values = fixture.pack.rooms.map((room) => room[field]);
    assert.equal(new Set(values).size, values.length, `${field} paths must not be reused`);
    assert.ok(values.every((value) => EXPECTED_PACK_INVENTORY.includes(value)),
      `every ${field} path must resolve inside the audited pack inventory`);
  }
});

test('GLB bytes, hashes, structure counts, and semantic report are independently reproducible', () => {
  assert.equal(fixture.semanticValidationReport.packId, EXPECTED_PACK_ID);
  assert.equal(fixture.semanticValidationReport.status, 'passed');
  assert.equal(fixture.semanticValidationReport.reports.length, 4);

  for (const room of fixture.pack.rooms) {
    const expected = EXPECTED_ROOM_REPORTS[room.roomId];
    const report = roomReportById(fixture.semanticValidationReport, room.roomId);
    const manifest = fixture.manifests[room.roomId];
    const gltf = fixture.gltfs[room.roomId];
    const glb = fixture.glbBuffers[room.roomId];
    assert.ok(report, `${room.roomId} requires a semantic report`);
    assert.deepEqual(report, { roomId: room.roomId, ...expected });
    assert.equal(glb.byteLength, expected.bytes);
    assert.equal(sha256(glb), expected.sha256);
    assert.equal(gltf.nodes.length, expected.nodes);
    assert.equal(gltf.meshes.length, expected.meshes);
    assert.equal(gltf.materials.length, expected.materials);
    assert.equal(gltf.images.length, expected.embeddedImages);
    assert.equal(manifest.sockets.length, expected.sockets);
    assert.equal(manifest.collisionVolumes.length, expected.collisionVolumes);
    assert.equal(manifest.traversalEdges.length, expected.traversalEdges);
    assert.deepEqual(manifest.bounds, expected.bounds);
  }
});

test('the checked-in Khronos report covers every and only indexed GLB with zero findings', () => {
  assert.equal(fixture.khronosValidationReport.validator, 'Khronos glTF Validator');
  assert.equal(fixture.khronosValidationReport.reports.length, 4);
  assert.deepEqual(
    fixture.khronosValidationReport.reports.map(({ file }) => file).sort(),
    expectedRoomIds.map((roomId) => `${roomId}.glb`).sort(),
  );
  for (const roomId of expectedRoomIds) {
    const report = khronosReportByRoomId(fixture.khronosValidationReport, roomId);
    assert.ok(report, `${roomId} requires a Khronos glTF report`);
    assert.deepEqual(
      {
        bytes: report.bytes,
        errors: report.errors,
        warnings: report.warnings,
        infos: report.infos,
        hints: report.hints,
        messages: report.messages,
      },
      {
        bytes: EXPECTED_ROOM_REPORTS[roomId].bytes,
        errors: 0,
        warnings: 0,
        infos: 0,
        hints: 0,
        messages: [],
      },
    );
  }
});

test('manifest sockets and collision volumes exactly own real GLB semantic nodes', () => {
  for (const room of fixture.pack.rooms) {
    const manifest = fixture.manifests[room.roomId];
    const gltf = fixture.gltfs[room.roomId];
    const nodeNames = gltf.nodes.map(({ name }) => name).filter(Boolean);
    const nodesByName = new Map(gltf.nodes.map((node) => [node.name, node]));
    assert.equal(nodesByName.size, gltf.nodes.length, `${room.roomId} GLB node names must be unique`);
    assert.equal(manifest.roomId, room.roomId);
    assert.equal(manifest.glb, `../${room.glb}`);
    assert.equal(manifest.units, 'meters');
    assert.equal(manifest.upAxis, 'Y');
    assert.equal(manifest.forwardAxis, '-Z');
    assert.equal(manifest.originPolicy, 'entry-tier origin; do not recenter from aggregate bounds');
    assert.equal(
      manifest.collisionPolicy,
      'Use manifest collision volumes and node extras; do not derive traversal collision from every visible mesh AABB.',
    );

    const semanticNames = nodeNames.filter((name) => SEMANTIC_NODE_PREFIX.test(name));
    assert.ok(semanticNames.length > 0, `${room.roomId} must expose named semantic nodes`);
    for (const nodeName of sourceSemanticNodeNames(manifest)) {
      assert.ok(nodesByName.has(nodeName), `${room.roomId} is missing referenced semantic node ${nodeName}`);
      assert.ok(SEMANTIC_NODE_PREFIX.test(nodeName) || /^FIXTURE_/u.test(nodeName),
        `${nodeName} must use an authored semantic or collidable fixture prefix`);
    }

    const socketIds = new Set();
    for (const socket of manifest.sockets) {
      assert.ok(!socketIds.has(socket.id), `${room.roomId} repeats socket ${socket.id}`);
      socketIds.add(socket.id);
      finiteTuple(socket.position, 3, `${room.roomId}:${socket.id}.position`);
      finiteTuple(socket.forward, 3, `${room.roomId}:${socket.id}.forward`);
      finiteTuple(socket.aperture, 2, `${room.roomId}:${socket.id}.aperture`);
      assert.ok(socket.aperture.every((value) => value > 0));
      assert.equal(socket.elevation, socket.position[1]);
      assert.equal(Math.hypot(...socket.forward), 1);
      assert.equal(socket.forward[1], 0);
      assert.equal(Math.abs(socket.forward[0]) + Math.abs(socket.forward[2]), 1);
      const node = nodesByName.get(socket.nodeName);
      assert.deepEqual(node.translation ?? [0, 0, 0], socket.position);
      assert.deepEqual(node.extras, {
        semantic: 'socket',
        socketId: socket.id,
        socketType: socket.type,
        elevation: socket.elevation,
        forward: socket.forward,
        aperture: socket.aperture,
      });
    }

    const collisionNodes = new Set();
    for (const volume of manifest.collisionVolumes) {
      assert.ok(!collisionNodes.has(volume.nodeName),
        `${room.roomId} repeats collision ownership for ${volume.nodeName}`);
      collisionNodes.add(volume.nodeName);
      assert.ok(['box', 'cylinder'].includes(volume.shape));
      finiteTuple(volume.center, 3, `${room.roomId}:${volume.nodeName}.center`);
      assert.ok(volume.rotationY == null || Number.isFinite(volume.rotationY));
      if (volume.shape === 'box') {
        finiteTuple(volume.size, 3, `${room.roomId}:${volume.nodeName}.size`);
        assert.ok(volume.size.every((value) => value > 0));
      } else {
        assert.ok(Number.isFinite(volume.radius) && volume.radius > 0);
        assert.ok(Number.isFinite(volume.height) && volume.height > 0);
      }
      const node = nodesByName.get(volume.nodeName);
      assert.ok(node, `${room.roomId} collision ${volume.nodeName} must name a GLB node`);
      assert.deepEqual(node.translation ?? [0, 0, 0], volume.center);
      assert.equal(node.extras?.semantic, volume.semantic);
      assert.equal(node.extras?.collidable, true);
    }
  }
});

test('Factory, Waterworks, Magma, and Electrical gameplay semantics remain exact', () => {
  const factory = fixture.manifests.rdx_factory_corkscrew_exchange;
  const water = fixture.manifests.rdx_waterworks_freight_sump;
  const magma = fixture.manifests.rdx_magma_foundry_undercroft;
  const electrical = fixture.manifests.rdx_electric_transformer_undercroft;

  assert.equal(factory.mechanisms[0].controller, 'discrete_corkscrew_platform_v1');
  assert.deepEqual(factory.mechanisms[0].stableStops.map(({ id }) => id), [
    'south_entry', 'east_mid', 'north_high', 'west_top',
  ]);
  assert.equal(factory.fallCatchments[0].damageFreeExit, true);

  assert.equal(water.fluidNetwork.profile, 'factory_water_v1');
  assert.equal(water.fluidNetwork.basinBottomY, -4.82);
  assert.equal(water.fluidNetwork.conservedVolumeUnits, 1);
  assert.deepEqual(water.fluidNetwork.stableStates, {
    FreightSumpFilled: { freightLevelY: -1.55, storedLevelY: null, gantryLevelY: null },
    StoredInReservoir: { freightLevelY: null, storedLevelY: 3.2, gantryLevelY: null },
    GantrySumpFilled: { freightLevelY: null, storedLevelY: null, gantryLevelY: 2.1 },
  });
  assert.deepEqual(new Set(water.discoveries.map(({ availableWhen }) => availableWhen)), new Set([
    'FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled',
  ]));

  assert.deepEqual(magma.hazard, {
    profile: 'magma_floor_v1',
    damagePerSecond: 12,
    pulseSeconds: 0.25,
    entryGraceSeconds: 0.5,
    node: 'HAZARD_MAGMA_BASIN',
  });
  assert.equal(magma.criticalRouteDamageFree, true);
  assert.equal(magma.fallCatchments[0].nominalPadWidth, 4.4);

  assert.deepEqual(electrical.hazard, {
    profile: 'electric_floor_cycle_v1',
    damagePerSecond: 9,
    cycleSeconds: 3.5,
    safeSeconds: 1.25,
    chargingSeconds: 0.75,
    energizedSeconds: 1.5,
    panelPrefix: 'HAZARD_ELECTRIC_PANEL_',
  });
  assert.equal(electrical.criticalRouteDamageFree, true);
  assert.deepEqual(electrical.controller.stableStates, ['cycling', 'grounded']);
  assert.equal(electrical.fallCatchments[0].nominalPadWidth, 3.15);
});
