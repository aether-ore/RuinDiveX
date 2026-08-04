import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';

const TILE_SIZE = 2.8;

function worldInstancePosition(mesh, instanceId) {
  mesh.updateWorldMatrix(true, false);
  const localMatrix = new THREE.Matrix4();
  mesh.getMatrixAt(instanceId, localMatrix);
  const worldMatrix = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, localMatrix);
  return new THREE.Vector3().setFromMatrixPosition(worldMatrix);
}

function isDescendantOf(object, ancestor) {
  for (let current = object; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function floorMaterials() {
  const primary = new THREE.MeshStandardMaterial({ name: 'floor-primary' });
  const alternate = new THREE.MeshStandardMaterial({ name: 'floor-alternate' });
  return {
    primary,
    alternate,
    materials: {
      floor: primary,
      hallway: primary,
      supportMetal: primary,
      glowBlue: alternate,
      glowRed: alternate,
      floorByType: {
        floor: primary,
        bonus: alternate,
        conveyor: primary,
        trap: primary,
      },
    },
  };
}

test('flat industrial floors batch by chunk, material, elevation, and exact ownership', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const root = new THREE.Group();
  const { primary, alternate, materials } = floorMaterials();
  const flatTiles = [
    { x: 0, z: 0, type: 'floor', surface: 'floor', roomId: 'base-room', elevation: 0 },
    { x: 1, z: 0, type: 'floor', surface: 'floor', roomId: 'base-room', elevation: 0 },
    { x: 8, z: 0, type: 'floor', surface: 'floor', roomId: 'base-room', elevation: 0 },
    { x: 2, z: 0, type: 'floor', surface: 'floor', roomId: 'base-room', elevation: 2.8 },
    { x: 3, z: 0, type: 'floor', surface: 'floor', roomId: 'other-room', elevation: 0 },
    { x: 4, z: 0, type: 'floor', surface: 'floor', connectorId: 'connector-a', elevation: 0 },
    {
      x: 5,
      z: 0,
      type: 'floor',
      surface: 'floor',
      roomId: 'supplement-room',
      augmentationOwnerId: 'supplement:owner-a',
      augmentationOperationId: 'supplement:operation',
      dungeonSupplement: true,
      elevation: 0,
    },
    {
      x: 6,
      z: 0,
      type: 'floor',
      surface: 'floor',
      roomId: 'supplement-room',
      augmentationOwnerId: 'supplement:owner-b',
      augmentationOperationId: 'supplement:operation',
      dungeonSupplement: true,
      elevation: 0,
    },
    { x: 7, z: 0, type: 'bonus', surface: 'floor', roomId: 'base-room', elevation: 0 },
  ];
  const detailTiles = [
    { x: 0, z: 1, type: 'floor', surface: 'dropSpaceOverpass', roomId: 'base-room', elevation: 0 },
    { x: 1, z: 1, type: 'conveyor', surface: 'floor', roomId: 'base-room', elevation: 0 },
    { x: 2, z: 1, type: 'trap', surface: 'floor', roomId: 'base-room', elevation: 0 },
  ];
  const rampTile = {
    x: 3,
    z: 1,
    type: 'floor',
    surface: 'industrialRamp',
    roomId: 'base-room',
    elevation: 1.4,
  };

  const result = generator._addIndustrialFloorTileVisuals(
    root,
    [...flatTiles, ...detailTiles, rampTile],
    materials,
  );

  assert.equal(result.batchMeshes.length, 8);
  assert.equal(result.independentVisuals.length, detailTiles.length);
  assert.equal(
    result.batchMeshes.reduce((total, mesh) => total + mesh.count, 0),
    flatTiles.length,
  );
  assert.ok(result.batchMeshes.every((mesh) => mesh.isInstancedMesh));
  assert.ok(result.batchMeshes.every((mesh) => mesh.name === 'dungeonFloorTileVisual'));
  assert.ok(result.batchMeshes.every((mesh) => mesh.geometry === result.sharedGeometry));
  assert.equal(result.sharedGeometry.userData.sharedIndustrialFloorBatchGeometry, true);

  const metadata = result.batchMeshes.flatMap((mesh) => (
    mesh.userData.floorInstanceMetadata
  ));
  assert.deepEqual(
    metadata.map(({ x, z }) => `${x},${z}`).sort(),
    flatTiles.map(({ x, z }) => `${x},${z}`).sort(),
  );
  assert.equal(metadata.some(({ surface }) => surface === 'industrialRamp'), false);

  for (const mesh of result.batchMeshes) {
    const records = mesh.userData.floorInstanceMetadata;
    assert.equal(mesh.count, records.length);
    assert.equal(mesh.userData.floorTileCount, records.length);
    assert.equal(Object.isFrozen(records), true);
    assert.ok(records.every((record) => Object.isFrozen(record)));
    assert.ok(records.every((record, instanceId) => record.instanceId === instanceId));
    assert.equal(new Set(records.map(({ roomId }) => roomId)).size, 1);
    assert.equal(new Set(records.map(({ connectorId }) => connectorId)).size, 1);
    assert.equal(new Set(records.map(({ augmentationOwnerId }) => augmentationOwnerId)).size, 1);
    assert.equal(new Set(records.map(({ elevation }) => Number(elevation).toFixed(3))).size, 1);
    assert.equal(new Set(records.map(({ x }) => Math.floor(x / 8))).size, 1);
    assert.equal(new Set(records.map(({ z }) => Math.floor(z / 8))).size, 1);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, true);
    assert.equal(mesh.userData.cameraOcclusionSurface, false);
    assert.equal(mesh.userData.cameraOcclusionExcluded, true);
    assert.equal(mesh.userData.cameraOcclusionPerInstance, false);
    for (const record of records) {
      const position = worldInstancePosition(mesh, record.instanceId);
      assert.ok(Math.abs(position.x - record.x * TILE_SIZE) <= 1e-6);
      assert.ok(Math.abs(position.y - (record.elevation - 0.06)) <= 1e-6);
      assert.ok(Math.abs(position.z - record.z * TILE_SIZE) <= 1e-6);
    }
  }

  assert.ok(result.batchMeshes.some((mesh) => mesh.material === alternate));
  assert.ok(result.batchMeshes.some((mesh) => mesh.material === primary));
  assert.ok(result.independentVisuals.every((visual) => visual.isGroup));
  assert.ok(result.independentVisuals.every((visual) => (
    visual.userData.floorTile == null
  )));
  assert.ok(result.independentVisuals.every((visual) => (
    visual.children.some((child) => child.userData?.floorTile)
  )));
  assert.ok(root.getObjectByName('minorDropOverpassUnderbeam'));
  assert.ok(root.getObjectByName('conveyorDirectionArrow'));
  assert.ok(root.getObjectByName('trapWarningRing'));

  const supplementRoot = generator._createDungeonSupplementRoot(root, {
    roomIds: ['supplement-room'],
  });
  const supplementalBatches = result.batchMeshes.filter((mesh) => (
    mesh.userData.roomId === 'supplement-room'
  ));
  assert.equal(supplementalBatches.length, 2);
  assert.ok(supplementalBatches.every((mesh) => mesh.parent === supplementRoot));
  assert.ok(result.batchMeshes
    .filter((mesh) => mesh.userData.roomId === 'base-room')
    .every((mesh) => mesh.parent === root));

  primary.dispose();
  alternate.dispose();
  result.sharedGeometry.dispose();
});

test('industrial ceilings batch with exact logical metadata and remain one cull draw each', () => {
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  const root = new THREE.Group();
  const ceilingMaterial = new THREE.MeshStandardMaterial({ name: 'ceiling' });
  const rooms = [
    { id: 'base-room', baseElevation: 0, ceilingHeight: 8.4 },
    { id: 'other-room', baseElevation: 0, ceilingHeight: 8.4 },
    { id: 'supplement-room', baseElevation: 0, ceilingHeight: 8.4 },
    { id: 'special-room', baseElevation: 0, ceilingHeight: 8.4, specialEnvironmentId: 'special' },
  ];
  const layers = [
    { x: 0, z: 0, roomId: 'base-room', elevation: 0 },
    { x: 1, z: 0, roomId: 'base-room', elevation: 0 },
    { x: 0, z: 0, roomId: 'base-room', elevation: 0 },
    { x: 8, z: 0, roomId: 'base-room', elevation: 0 },
    { x: 2, z: 0, roomId: 'other-room', elevation: 0 },
    { x: 3, z: 0, roomId: 'base-room', connectorId: 'connector-a', elevation: 0 },
    {
      x: 4,
      z: 0,
      roomId: 'supplement-room',
      elevation: 2.8,
      dungeonSupplement: true,
      augmentationOwnerId: 'supplement:owner-a',
      augmentationOperationId: 'supplement:operation',
    },
    {
      x: 5,
      z: 0,
      roomId: 'supplement-room',
      elevation: 2.8,
      dungeonSupplement: true,
      augmentationOwnerId: 'supplement:owner-b',
      augmentationOperationId: 'supplement:operation',
    },
    { x: 6, z: 0, roomId: 'base-room', elevation: 0 },
    { x: 7, z: 0, roomId: 'special-room', elevation: 0 },
  ];

  const result = generator._addCeilings(
    root,
    new Map(),
    { ceiling: ceilingMaterial },
    new Set(['6,0']),
    rooms,
    layers,
  );
  const expectedLogicalCount = 7;
  assert.equal(
    result.batchMeshes.reduce((total, mesh) => total + mesh.count, 0),
    expectedLogicalCount,
  );
  assert.equal(result.batchMeshes.length, 6);
  assert.ok(result.batchMeshes.every((mesh) => mesh.isInstancedMesh));
  assert.ok(result.batchMeshes.every((mesh) => mesh.name === 'dungeonRoomCeiling'));
  assert.ok(result.batchMeshes.every((mesh) => mesh.geometry === result.sharedGeometry));
  assert.equal(result.sharedGeometry.userData.sharedIndustrialCeilingBatchGeometry, true);

  for (const mesh of result.batchMeshes) {
    const records = mesh.userData.ceilingInstanceMetadata;
    assert.equal(mesh.count, records.length);
    assert.equal(mesh.userData.ceilingCount, records.length);
    assert.equal(Object.isFrozen(records), true);
    assert.ok(records.every((record) => Object.isFrozen(record)));
    assert.ok(records.every((record, instanceId) => record.instanceId === instanceId));
    assert.equal(new Set(records.map(({ roomId }) => roomId)).size, 1);
    assert.equal(new Set(records.map(({ connectorId }) => connectorId)).size, 1);
    assert.equal(new Set(records.map(({ augmentationOwnerId }) => augmentationOwnerId)).size, 1);
    assert.equal(new Set(records.map(({ ceilingHeight }) => ceilingHeight)).size, 1);
    assert.equal(new Set(records.map(({ floorElevation }) => floorElevation)).size, 1);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, true);
    assert.equal(mesh.userData.cameraOcclusionSurface, false);
    assert.equal(mesh.userData.cameraOcclusionExcluded, true);
    assert.equal(mesh.userData.cameraOcclusionPerInstance, false);
    for (const record of records) {
      const position = worldInstancePosition(mesh, record.instanceId);
      assert.ok(Math.abs(position.x - record.x * TILE_SIZE) <= 1e-6);
      assert.ok(Math.abs(position.y - (record.ceilingHeight + 0.06)) <= 1e-6);
      assert.ok(Math.abs(position.z - record.z * TILE_SIZE) <= 1e-6);
    }
  }

  const logicalKeys = result.batchMeshes.flatMap((mesh) => (
    mesh.userData.ceilingInstanceMetadata.map(({ x, z, ceilingHeight }) => (
      `${x}:${z}:${ceilingHeight.toFixed(3)}`
    ))
  ));
  assert.equal(new Set(logicalKeys).size, expectedLogicalCount);
  assert.equal(logicalKeys.some((key) => key.startsWith('6:0:')), false);
  assert.equal(logicalKeys.some((key) => key.startsWith('7:0:')), false);

  const cullGroups = generator._createStaticRenderCullGroups(root);
  assert.ok(cullGroups.length > 0);
  assert.ok(result.batchMeshes.every((mesh) => (
    cullGroups.some(({ group }) => isDescendantOf(mesh, group))
  )));
  assert.ok(cullGroups.every(({ maxMemberSpan, maxBucketSpan }) => (
    maxMemberSpan <= maxBucketSpan + 1e-6
  )));
  assert.ok(cullGroups.every(({ drawObjectCount }) => drawObjectCount >= 1));

  ceilingMaterial.dispose();
  result.sharedGeometry.dispose();
});
