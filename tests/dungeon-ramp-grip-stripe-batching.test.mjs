import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

function createMaterials() {
  const material = (name) => new THREE.MeshBasicMaterial({ name });
  return {
    industrialRamp: material('industrial-ramp'),
    wallTrim: material('wall-trim'),
    factoryRail: material('factory-rail'),
    hazardStripe: material('hazard-stripe'),
    supportMetal: material('support-metal'),
    raisedDeckFloor: material('raised-deck-floor'),
    wallMacroTiles: { mm: material('macro-mm') },
  };
}

function createRampTiles() {
  return Array.from({ length: 10 }, (_, index) => ({
    x: index,
    z: 0,
    type: 'floor',
    surface: 'industrialRamp',
    roomId: 'room-a',
    connectionId: 'connection-a',
    connectorId: 'connector-a',
    rampRunId: 'run-a',
    rampRouteId: 'route-a',
    rampDirectionX: 1,
    rampDirectionZ: 0,
    rampStartElevation: index * 0.2,
    rampEndElevation: (index + 1) * 0.2,
    elevation: index * 0.2,
    roomBaseElevation: -2,
    supportBaseElevation: -2,
    augmentationOwnerId: 'supplement:ramp-a',
    augmentationOperationId: 'supplement:operation-a',
    dungeonSupplement: true,
    sharedConnectorFloorOwnerIds: ['shared-b', 'shared-a'],
  }));
}

function collectBatches(root) {
  const batches = [];
  root.traverse((object) => {
    if (object.userData.contiguousRampGripStripeBatch === true) batches.push(object);
  });
  return batches;
}

function instanceWorldPosition(mesh, instanceId) {
  mesh.updateWorldMatrix(true, false);
  const instanceMatrix = new THREE.Matrix4();
  mesh.getMatrixAt(instanceId, instanceMatrix);
  return new THREE.Vector3().setFromMatrixPosition(
    new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, instanceMatrix),
  );
}

function deterministicBatchSummary(batches) {
  return batches.map((mesh) => ({
    key: mesh.userData.renderBatchKey,
    count: mesh.count,
    metadata: mesh.userData.rampGripStripeInstanceMetadata,
  }));
}

test('contiguous ramp grip stripes batch by material, chunk, elevation, and exact ownership', () => {
  const generator = new DungeonGenerator({ random: () => 0.5 });
  const materials = createMaterials();
  const tiles = createRampTiles();
  const serializedTiles = JSON.stringify(tiles);
  const group = new THREE.Group();

  generator._addSolidTraversalVolumes(group, tiles, [], materials);

  assert.equal(JSON.stringify(tiles), serializedTiles, 'logical floor data must stay immutable');
  const [rampRun] = group.getObjectsByProperty('name', 'contiguousIndustrialRampRun');
  assert.ok(rampRun);
  assert.equal(rampRun.userData.rampTileCount, tiles.length);
  const wedge = rampRun.children.find((object) => object.userData.contiguousRampSurface);
  assert.ok(wedge?.isMesh && !wedge.isInstancedMesh, 'the solid/pickable ramp wedge stays intact');

  const batches = collectBatches(group);
  assert.equal(batches.length, 4, 'two materials across two 8-tile render chunks');
  assert.equal(batches.reduce((sum, mesh) => sum + mesh.count, 0), tiles.length);
  assert.ok(batches.every((mesh) => mesh.isInstancedMesh));
  assert.equal(new Set(batches.map(({ geometry }) => geometry)).size, 1);
  assert.equal(batches[0].geometry.userData.sharedRampGripStripeBatchGeometry, true);

  group.updateMatrixWorld(true);
  for (const mesh of batches) {
    const records = mesh.userData.rampGripStripeInstanceMetadata;
    assert.equal(mesh.count, records.length);
    assert.equal(mesh.userData.rampGripStripeCount, records.length);
    assert.equal(Object.isFrozen(records), true);
    assert.ok(records.every((record) => Object.isFrozen(record)));
    assert.ok(records.every((record, instanceId) => record.instanceId === instanceId));
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
    assert.equal(mesh.userData.nonBlockingPresentation, true);
    assert.equal(mesh.userData.roomId, 'room-a');
    assert.equal(mesh.userData.connectionId, 'connection-a');
    assert.equal(mesh.userData.connectorId, 'connector-a');
    assert.equal(mesh.userData.augmentationOwnerId, 'supplement:ramp-a');
    assert.equal(mesh.userData.augmentationOperationId, 'supplement:operation-a');
    assert.deepEqual(mesh.userData.sharedConnectorFloorOwnerIds, ['shared-a', 'shared-b']);
    for (const record of records) {
      assert.equal(
        Math.floor(record.tileX / 8),
        mesh.userData.renderBatchChunkX,
      );
      assert.equal(
        Math.floor(record.tileZ / 8),
        mesh.userData.renderBatchChunkZ,
      );
      assert.equal(record.materialRole, mesh.userData.rampGripStripeMaterialRole);
      assert.deepEqual(record.dimensions, mesh.userData.rampGripStripeGeometryDimensions);
      const position = instanceWorldPosition(mesh, record.instanceId);
      assert.ok(position.distanceTo(new THREE.Vector3(
        record.worldPosition.x,
        record.worldPosition.y,
        record.worldPosition.z,
      )) <= 1e-6);
    }
  }

  const pickBatch = batches.find((mesh) => mesh.count > 1);
  const pickRecord = pickBatch.userData.rampGripStripeInstanceMetadata[0];
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(
      pickRecord.worldPosition.x,
      pickRecord.worldPosition.y + 4,
      pickRecord.worldPosition.z,
    ),
    new THREE.Vector3(0, -1, 0),
    0,
    8,
  );
  const picked = raycaster.intersectObject(pickBatch, false);
  assert.ok(picked.some(({ instanceId }) => instanceId === pickRecord.instanceId));

  const replayGroup = new THREE.Group();
  generator._addSolidTraversalVolumes(replayGroup, createRampTiles(), [], materials);
  assert.deepEqual(
    deterministicBatchSummary(collectBatches(replayGroup)),
    deterministicBatchSummary(batches),
    'batch keys and logical instance records must be deterministic',
  );

  const geometries = new Set();
  for (const root of [group, replayGroup]) {
    root.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
    });
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of new Set([
    materials.industrialRamp,
    materials.wallTrim,
    materials.factoryRail,
    materials.hazardStripe,
    materials.supportMetal,
    materials.raisedDeckFloor,
    materials.wallMacroTiles.mm,
  ])) material.dispose();
});
