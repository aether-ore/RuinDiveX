import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

const TILE_SIZE = 2.8;

function worldInstancePosition(mesh, instanceId) {
  mesh.updateWorldMatrix(true, false);
  const instanceMatrix = new THREE.Matrix4();
  mesh.getMatrixAt(instanceId, instanceMatrix);
  return new THREE.Vector3().setFromMatrixPosition(
    new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, instanceMatrix),
  );
}

function hasAncestor(object, ancestor) {
  for (let current = object; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

test('repeated factory catwalk presentation batches preserve logical transforms and ownership', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const group = new THREE.Group();
  const supportMetal = new THREE.MeshStandardMaterial({ name: 'support-metal' });
  const factoryRail = new THREE.MeshStandardMaterial({ name: 'factory-rail' });
  const materials = { supportMetal, factoryRail };
  const floorTiles = [
    { x: 0, z: 0, elevation: 4, roomBaseElevation: 0, surface: 'catwalk', roomId: 'base-room' },
    { x: 2, z: 0, elevation: 4, roomBaseElevation: 0, surface: 'catwalk', roomId: 'base-room' },
    { x: 8, z: 0, elevation: 4, roomBaseElevation: 0, surface: 'catwalk', roomId: 'base-room' },
    { x: 4, z: 0, elevation: 4, roomBaseElevation: 0, surface: 'catwalk', roomId: 'other-room' },
    {
      x: 6,
      z: 0,
      elevation: 4,
      roomBaseElevation: 0,
      surface: 'catwalk',
      roomId: 'supplement-room',
      augmentationOwnerId: 'supplement:catwalk-a',
      augmentationOperationId: 'supplement:operation',
      dungeonSupplement: true,
    },
    {
      x: 0,
      z: 2,
      elevation: 4,
      roomBaseElevation: 0,
      surface: 'catwalk',
      roomId: 'supplement-room',
      augmentationOwnerId: 'supplement:catwalk-b',
      augmentationOperationId: 'supplement:operation',
      dungeonSupplement: true,
    },
    { x: 2, z: 2, elevation: 6, roomBaseElevation: 0, surface: 'catwalk', roomId: 'base-room' },
  ];
  const serializedFloorTiles = JSON.stringify(floorTiles);

  generator._addIndustrialFactoryFeatures(
    group,
    floorTiles,
    materials,
    new Set(),
    generator._createFloorTileLookup(floorTiles),
  );

  assert.equal(JSON.stringify(floorTiles), serializedFloorTiles);
  const batches = group.children.filter((object) => (
    object.userData.factoryCatwalkPresentationBatch === true
  ));
  const byKind = (kind) => batches.filter((mesh) => (
    mesh.userData.factoryCatwalkPresentationKind === kind
  ));
  const logicalCount = (kind) => byKind(kind).reduce((total, mesh) => (
    total + mesh.count
  ), 0);
  assert.equal(logicalCount('support'), floorTiles.length * 4);
  assert.equal(logicalCount('underBeam'), floorTiles.length * 2);
  assert.equal(logicalCount('railPost'), floorTiles.length * 4);
  assert.ok(batches.length < (
    logicalCount('support') + logicalCount('underBeam') + logicalCount('railPost')
  ));

  for (const mesh of batches) {
    const records = mesh.userData.factoryCatwalkInstanceMetadata;
    assert.equal(mesh.isInstancedMesh, true);
    assert.equal(mesh.count, records.length);
    assert.equal(mesh.userData.factoryCatwalkInstanceCount, records.length);
    assert.equal(Object.isFrozen(records), true);
    assert.ok(records.every((record) => Object.isFrozen(record)));
    assert.ok(records.every((record, instanceId) => record.instanceId === instanceId));
    assert.equal(new Set(records.map(({ roomId }) => roomId)).size, 1);
    assert.equal(new Set(records.map(({ connectorId }) => connectorId)).size, 1);
    assert.equal(new Set(records.map(({ augmentationOwnerId }) => augmentationOwnerId)).size, 1);
    assert.equal(new Set(records.map(({ elevation }) => elevation)).size, 1);
    assert.equal(new Set(records.map(({ orientation }) => orientation)).size, 1);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, true);
    assert.equal(mesh.userData.cameraOcclusionPerInstance, true);
    assert.equal(mesh.geometry.userData.sharedFactoryCatwalkBatchGeometry, true);
    for (const record of records) {
      const position = worldInstancePosition(mesh, record.instanceId);
      assert.ok(Math.abs(position.x - record.worldPosition.x) <= 1e-6);
      assert.ok(Math.abs(position.y - record.worldPosition.y) <= 1e-6);
      assert.ok(Math.abs(position.z - record.worldPosition.z) <= 1e-6);
      assert.deepEqual(record.dimensions, mesh.userData.factoryCatwalkGeometryDimensions);
    }
  }

  const commonHeightSupports = byKind('support').filter((mesh) => (
    Math.abs(mesh.userData.factoryCatwalkGeometryDimensions.height - 3.9) <= 1e-6
  ));
  assert.ok(commonHeightSupports.length > 1);
  assert.equal(new Set(commonHeightSupports.map(({ geometry }) => geometry)).size, 1);
  assert.equal(new Set(byKind('railPost').map(({ geometry }) => geometry)).size, 1);

  const railRuns = group.children.filter((object) => object.name === 'factoryCatwalkRailRun');
  assert.equal(railRuns.length, floorTiles.length * 4);
  assert.ok(railRuns.every((rail) => !rail.isInstancedMesh));
  assert.ok(railRuns.every((rail) => rail.castShadow === false && rail.receiveShadow === true));
  assert.ok(railRuns.every((rail) => rail.userData.renderBatchOwnership));

  const supplementRoot = generator._createDungeonSupplementRoot(group, {
    roomIds: ['supplement-room'],
  });
  const supplementalBatches = batches.filter((mesh) => (
    mesh.userData.roomId === 'supplement-room'
  ));
  assert.ok(supplementalBatches.length > 0);
  assert.ok(supplementalBatches.every((mesh) => mesh.parent === supplementRoot));
  assert.ok(railRuns
    .filter((rail) => rail.userData.roomId === 'supplement-room')
    .every((rail) => rail.parent === supplementRoot));
  assert.ok(batches
    .filter((mesh) => mesh.userData.roomId === 'base-room')
    .every((mesh) => mesh.parent === group));

  const cullGroups = generator._createStaticRenderCullGroups(group);
  assert.ok(cullGroups.length > 0);
  assert.ok(batches.every((mesh) => (
    cullGroups.some(({ group: cullGroup }) => hasAncestor(mesh, cullGroup))
  )));

  supportMetal.dispose();
  factoryRail.dispose();
  for (const geometry of new Set(batches.map(({ geometry }) => geometry))) geometry.dispose();
  for (const rail of railRuns) rail.geometry.dispose();
});
