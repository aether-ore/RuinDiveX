import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { Game } from '../src/Game.js';

function createSpatialQueryGame(root) {
  const wallProxyBins = new Map();
  const game = Object.create(Game.prototype);
  game.activeWorldBundle = { root };
  game.dungeon = { group: root };
  game.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
  game.camera.position.set(0, 2, 10);
  game.camera.lookAt(0, 1.25, 0);
  game.camera.updateMatrixWorld(true);
  game.player = { root: new THREE.Object3D() };
  game.player.root.position.set(0, 0, 0);
  game.cameraOcclusionRaycaster = new THREE.Raycaster();
  game.targetScannerRaycaster = new THREE.Raycaster();
  game.cameraOcclusionEntries = [];
  game.cameraOcclusionWallProxyBins = wallProxyBins;
  game.cameraOcclusionBins = wallProxyBins;
  game.cameraOcclusionWallProximityBins = wallProxyBins;
  game.cameraOcclusionRecoveryBins = new Map();
  game.cameraOcclusionProximityRecordByKey = new Map();
  game.cameraOcclusionWallProximityCandidateKeys = new Set();
  game.cameraOcclusionExpandedVerticalRecordKeys = new Set();
  game.cameraOcclusionExpandedSurfaceRecordKeys = new Set();
  game.cameraOcclusionForwardVerticalHits = [];
  game.cameraOcclusionCandidateSet = new Set();
  game.cameraOcclusionCandidateObjectSet = new Set();
  game.cameraOcclusionCandidateObjects = [];
  game.cameraOcclusionOriginalMaterialSides = new Map();
  game.cameraOcclusionHits = [];
  game.cameraOcclusionOwnerByObject = new WeakMap();
  game.cameraOcclusionHiddenOwners = new Set();
  game.cameraOcclusionHiddenInstances = [];
  game.cameraOcclusionHiddenInstanceKeys = new Set();
  game.cameraOcclusionOwnerBaseVisibility = new WeakMap();
  game.occlusionCandidateSamples = [];
  game.dungeonPerformanceTelemetry = {
    recordOcclusionCandidateCount(value) {
      game.occlusionCandidateSamples.push(value);
    },
  };
  return game;
}

function uniqueSpatialRecords(bins) {
  const byKey = new Map();
  for (const records of bins.values()) {
    for (const record of records) byKey.set(record.key, record);
  }
  return [...byKey.values()];
}

function addBox(root, name, size, position, userData = {}) {
  const object = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshBasicMaterial(),
  );
  object.name = name;
  object.position.copy(position);
  Object.assign(object.userData, userData);
  root.add(object);
  return object;
}

test('LOS and camera-ray indexes contain only exact wall proxies', () => {
  const root = new THREE.Group();
  const wall = addBox(
    root,
    'spatialIndexWall',
    new THREE.Vector3(4, 4, 0.3),
    new THREE.Vector3(0, 2, 5),
    { cameraOcclusionWall: true },
  );
  const floor = addBox(
    root,
    'spatialIndexFloor',
    new THREE.Vector3(12, 0.4, 12),
    new THREE.Vector3(0, -0.2, 5),
    { cameraOcclusionSurface: true, surfaceRole: 'floor' },
  );
  const ceiling = addBox(
    root,
    'spatialIndexCeiling',
    new THREE.Vector3(12, 0.4, 12),
    new THREE.Vector3(0, 4.2, 5),
    { cameraOcclusionSurface: true, surfaceRole: 'ceiling' },
  );
  const game = createSpatialQueryGame(root);

  game._collectCameraOcclusionWalls();

  const wallProxies = uniqueSpatialRecords(game.cameraOcclusionWallProxyBins);
  const recoveryRecords = uniqueSpatialRecords(game.cameraOcclusionRecoveryBins);
  assert.deepEqual(wallProxies.map(({ entry }) => entry.object), [wall]);
  assert.equal(wallProxies.every(({ entry }) => entry.wallSurface === true), true);
  assert.equal(wallProxies.some(({ entry }) => entry.object === floor), false);
  assert.equal(wallProxies.some(({ entry }) => entry.object === ceiling), false);
  assert.equal(recoveryRecords.some(({ entry }) => entry.object === floor), true);
  assert.equal(recoveryRecords.some(({ entry }) => entry.object === ceiling), true);

  assert.equal(game._hasTargetScannerLineOfSight(new THREE.Vector3(0, 1, 9)), false);
  assert.deepEqual(game.targetScannerOcclusionCandidateObjects, [wall]);
  assert.equal(
    game.targetScannerOcclusionCandidateRecords.every(({ entry }) => entry.wallSurface),
    true,
  );

  game._updateCameraWallOcclusion();
  assert.equal(
    [...game.cameraOcclusionCandidateSet].every((record) => record.entry.wallSurface),
    true,
  );
  assert.equal(game.cameraOcclusionCandidateObjects.includes(floor), false);
  assert.equal(game.cameraOcclusionCandidateObjects.includes(ceiling), false);
});

test('local wall-proxy queries remain bounded as distant scene density grows', () => {
  const root = new THREE.Group();
  const sharedWallGeometry = new THREE.BoxGeometry(3, 4, 0.3);
  const sharedWallMaterial = new THREE.MeshBasicMaterial();
  const localWall = new THREE.Mesh(sharedWallGeometry, sharedWallMaterial);
  localWall.name = 'localBoundedQueryWall';
  localWall.userData.cameraOcclusionWall = true;
  localWall.position.set(0, 2, 5);
  root.add(localWall);

  const distantWallCount = 1024;
  for (let index = 0; index < distantWallCount; index += 1) {
    const wall = new THREE.Mesh(sharedWallGeometry, sharedWallMaterial);
    wall.name = `distantBoundedQueryWall${index}`;
    wall.userData.cameraOcclusionWall = true;
    wall.position.set(
      200 + (index % 32) * 14,
      2,
      200 + Math.floor(index / 32) * 14,
    );
    root.add(wall);
  }
  addBox(
    root,
    'localQueryFloor',
    new THREE.Vector3(20, 0.4, 20),
    new THREE.Vector3(0, -0.2, 5),
    { cameraOcclusionSurface: true, surfaceRole: 'floor' },
  );
  addBox(
    root,
    'localQueryCeiling',
    new THREE.Vector3(20, 0.4, 20),
    new THREE.Vector3(0, 5, 5),
    { cameraOcclusionSurface: true, surfaceRole: 'ceiling' },
  );
  const game = createSpatialQueryGame(root);

  game._collectCameraOcclusionWalls();
  const allWallProxies = uniqueSpatialRecords(game.cameraOcclusionWallProxyBins);
  assert.equal(allWallProxies.length, distantWallCount + 1);

  assert.equal(game._hasTargetScannerLineOfSight(new THREE.Vector3(0, 1, 9)), false);
  assert.equal(game.targetScannerOcclusionCandidateRecords.length, 1);
  assert.deepEqual(game.targetScannerOcclusionCandidateObjects, [localWall]);
  assert.equal(game.occlusionCandidateSamples.at(-1), 1);

  game._updateCameraWallOcclusion();
  assert.ok(game.cameraOcclusionCandidateSet.size <= 1);
  assert.ok(Math.max(...game.occlusionCandidateSamples) <= 1);
});
