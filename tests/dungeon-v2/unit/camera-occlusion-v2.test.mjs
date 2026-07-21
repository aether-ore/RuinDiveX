import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import Game from '../../../src/Game.js';

const FULL_RUNNING_CAMERA_RANGE = 7.52;

function createOcclusionGame(group = new THREE.Group()) {
  group.name = group.name || 'cameraOcclusionFixtureDungeon';
  const game = Object.create(Game.prototype);
  game.dungeon = { group };
  game.player = { root: new THREE.Group() };
  game.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 120);
  game.cameraOcclusionRaycaster = new THREE.Raycaster();
  game.cameraOcclusionEntries = [];
  game.cameraOcclusionBins = new Map();
  game.cameraOcclusionCandidateSet = new Set();
  game.cameraOcclusionCandidateObjects = [];
  game.cameraOcclusionHits = [];
  game.cameraOcclusionOwnerByObject = new WeakMap();
  game.cameraOcclusionHiddenOwners = new Set();
  game.cameraOcclusionHiddenInstances = new Map();
  game.cameraOcclusionOwnerBaseVisibility = new WeakMap();
  return game;
}

function opaqueMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x56616b });
}

function aimCameraAtPlayer(game) {
  game.camera.lookAt(
    game.player.root.position.x,
    game.player.root.position.y + 1.25,
    game.player.root.position.z,
  );
  game.camera.updateMatrixWorld(true);
  game.dungeon.group.updateMatrixWorld(true);
}

function assertMatrixEqual(actual, expected, message) {
  assert.equal(actual.elements.length, expected.elements.length);
  for (let index = 0; index < actual.elements.length; index += 1) {
    assert.ok(Math.abs(actual.elements[index] - expected.elements[index]) <= 1e-6,
      `${message} matrix[${index}]`);
  }
}

test('opaque V2 wall hides at the full running camera range and restores off ray', () => {
  const game = createOcclusionGame();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(5.6, 5.2, 0.24), opaqueMaterial());
  wall.name = 'v2FixtureOpaqueWall';
  wall.position.set(0, 2.2, 3.4);
  wall.userData.cameraOcclusionSurface = true;
  wall.userData.cameraOcclusionOwner = true;
  wall.userData.v2StructuralRole = 'opaque-enclosure-wall';
  wall.userData.v2CameraOcclusionClass = 'opaque-enclosure';
  game.dungeon.group.add(wall);
  game.player.root.position.set(0, 0, 0);
  game.camera.position.set(0, 3.25, FULL_RUNNING_CAMERA_RANGE);
  aimCameraAtPlayer(game);

  game._collectCameraOcclusionWalls();
  assert.equal(game.cameraOcclusionEntries.length, 1);
  assert.equal(game.cameraOcclusionEntries[0].owner, wall);
  assert.equal(wall.material.side, THREE.FrontSide);
  game._updateCameraWallOcclusion();
  assert.equal(wall.visible, false, 'an opaque wall between the full-range camera and player must hide');
  assert.equal(wall.material.side, THREE.FrontSide, 'temporary double-sided raycasting must restore material state');

  game.camera.position.set(0, 3.25, 1.6);
  aimCameraAtPlayer(game);
  game._updateCameraWallOcclusion();
  assert.equal(wall.visible, true, 'the wall must restore as soon as camera and player share its side');

  wall.geometry.dispose();
  wall.material.dispose();
});

test('opaque elevated catwalk hides only while it crosses the camera-to-player ray', () => {
  const game = createOcclusionGame();
  const catwalk = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.2, 5.6), opaqueMaterial());
  catwalk.name = 'v2FixtureOpaqueCatwalk';
  catwalk.position.set(0, 3.2, 0.4);
  catwalk.userData.cameraOcclusionSurface = true;
  catwalk.userData.cameraOcclusionOwner = true;
  catwalk.userData.v2StructuralRole = 'supported-walkable-catwalk';
  catwalk.userData.v2CameraOcclusionClass = 'elevated-catwalk';
  game.dungeon.group.add(catwalk);
  game.player.root.position.set(0, 0, 0);
  game.camera.position.set(0, 6.25, 5.6);
  aimCameraAtPlayer(game);

  game._collectCameraOcclusionWalls();
  assert.equal(game.cameraOcclusionEntries.length, 1);
  game._updateCameraWallOcclusion();
  assert.equal(catwalk.visible, false, 'a catwalk between the camera and lower player must hide');

  game.camera.position.set(0, 2.5, 2.2);
  aimCameraAtPlayer(game);
  game._updateCameraWallOcclusion();
  assert.equal(catwalk.visible, true, 'the catwalk must restore when it is no longer between camera and player');

  catwalk.geometry.dispose();
  catwalk.material.dispose();
});

test('native instanced occlusion suppresses only the hit wall and restores its exact matrix', () => {
  const game = createOcclusionGame();
  const geometry = new THREE.BoxGeometry(5.6, 5.2, 0.24);
  const material = opaqueMaterial();
  const batch = new THREE.InstancedMesh(geometry, material, 2);
  batch.name = 'nativeV1WallBatch';
  const hitMatrix = new THREE.Matrix4().makeTranslation(0, 2.2, 3.4);
  const siblingMatrix = new THREE.Matrix4().makeTranslation(8, 2.2, 3.4);
  batch.setMatrixAt(0, hitMatrix);
  batch.setMatrixAt(1, siblingMatrix);
  batch.computeBoundingBox();
  batch.computeBoundingSphere();
  batch.userData.cameraOcclusionSurface = true;
  batch.userData.cameraOcclusionOwner = true;
  batch.userData.v2CameraOcclusionClass = 'opaque-enclosure';
  batch.userData.v2CameraOcclusionInstanceMode = 'per-instance';
  batch.userData.v2LegacyFixedRoomPresentation = true;
  game.dungeon.group.add(batch);
  game.player.root.position.set(0, 0, 0);
  game.camera.position.set(0, 3.25, FULL_RUNNING_CAMERA_RANGE);
  aimCameraAtPlayer(game);

  game._collectCameraOcclusionWalls();
  game._updateCameraWallOcclusion();
  assert.equal(batch.visible, true, 'a native batch must never be hidden as one whole room-scale object');
  const hiddenInstances = game.cameraOcclusionHiddenInstances.get(batch);
  assert.deepEqual([...hiddenInstances.keys()], [0]);
  const hiddenMatrix = new THREE.Matrix4();
  const untouchedSibling = new THREE.Matrix4();
  batch.getMatrixAt(0, hiddenMatrix);
  batch.getMatrixAt(1, untouchedSibling);
  assert.equal(new THREE.Vector3().setFromMatrixScale(hiddenMatrix).length(), 0,
    'the ray-hit native wall instance must be temporarily suppressed');
  assertMatrixEqual(untouchedSibling, siblingMatrix,
    'a sibling wall in the same 503-instance-style batch must remain rendered');

  game.camera.position.set(0, 3.25, 1.6);
  aimCameraAtPlayer(game);
  game._updateCameraWallOcclusion();
  const restoredMatrix = new THREE.Matrix4();
  batch.getMatrixAt(0, restoredMatrix);
  assertMatrixEqual(restoredMatrix, hitMatrix, 'the hidden native wall must restore exactly off ray');
  assert.equal(game.cameraOcclusionHiddenInstances.size, 0);

  geometry.dispose();
  material.dispose();
});

test('transparent water and telegraphs cannot enter the V2 camera occlusion ray set', () => {
  const game = createOcclusionGame();
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(5, 2, 0.2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.34, depthWrite: false }),
  );
  water.userData.cameraOcclusionSurface = true;
  water.userData.cameraOcclusionOwner = true;
  water.userData.v2WaterVolumePresentation = true;
  water.position.set(0, 1.5, 3);
  const telegraph = new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 2), opaqueMaterial());
  telegraph.userData.cameraOcclusionSurface = true;
  telegraph.userData.cameraOcclusionOwner = true;
  telegraph.userData.v2StructuralRole = 'hazard-phase-telegraph';
  telegraph.position.set(0, 1.5, 2);
  game.dungeon.group.add(water, telegraph);

  game._collectCameraOcclusionWalls();
  assert.equal(game.cameraOcclusionEntries.length, 0);

  water.geometry.dispose();
  water.material.dispose();
  telegraph.geometry.dispose();
  telegraph.material.dispose();
});

test('a misplaced native placement-root owner marker falls back to the hit batch', () => {
  const dungeonGroup = new THREE.Group();
  const placementGroup = new THREE.Group();
  placementGroup.userData.v2PlacementId = 'placement.fixture-native-room';
  placementGroup.userData.cameraOcclusionOwner = true;
  const unrelatedRoomBatch = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), opaqueMaterial());
  unrelatedRoomBatch.position.set(8, 1, 0);
  const wallBatch = new THREE.Mesh(new THREE.BoxGeometry(5.6, 5.2, 0.24), opaqueMaterial());
  wallBatch.position.set(0, 2.2, 3.4);
  wallBatch.userData.cameraOcclusionSurface = true;
  placementGroup.add(unrelatedRoomBatch, wallBatch);
  dungeonGroup.add(placementGroup);
  const game = createOcclusionGame(dungeonGroup);
  game.player.root.position.set(0, 0, 0);
  game.camera.position.set(0, 3.25, FULL_RUNNING_CAMERA_RANGE);
  aimCameraAtPlayer(game);

  game._collectCameraOcclusionWalls();
  assert.equal(game.cameraOcclusionEntries.length, 1);
  assert.equal(game.cameraOcclusionEntries[0].owner, wallBatch,
    'camera occlusion must not select an entire native placement as its hide owner');
  game._updateCameraWallOcclusion();
  assert.equal(wallBatch.visible, false);
  assert.equal(placementGroup.visible, true);
  assert.equal(unrelatedRoomBatch.visible, true);

  wallBatch.geometry.dispose();
  wallBatch.material.dispose();
  unrelatedRoomBatch.geometry.dispose();
  unrelatedRoomBatch.material.dispose();
});

test('only an accepted error-free V2 opaque enclosure enables the full-orbit policy', () => {
  const group = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 0.2), opaqueMaterial());
  wall.userData.cameraOcclusionSurface = true;
  wall.userData.cameraOcclusionOwner = true;
  wall.userData.v2CameraOcclusionClass = 'opaque-enclosure';
  group.add(wall);
  const game = createOcclusionGame(group);
  game.dungeon.generationMode = 'v2';
  game.dungeon.validation = { accepted: true };
  game.dungeon.runtimeValidationErrors = [];
  let containmentCalls = 0;
  game.dungeon.environmentRuntime = {
    constrainThirdPersonCamera() {
      containmentCalls += 1;
      return true;
    },
  };
  game._collectCameraOcclusionWalls();
  assert.equal(game._usesAcceptedV2OpaqueCameraOcclusion(), true,
    'an accepted opaque V2 shell preserves the desired V1-compatible camera orbit');
  assert.equal(game._applyThirdPersonCameraContainmentPolicy(), false);
  assert.equal(containmentCalls, 0, 'accepted opaque V2 walls must not shorten the desired camera orbit');

  game.dungeon.runtimeValidationErrors.push({ code: 'negative-fixture' });
  assert.equal(game._usesAcceptedV2OpaqueCameraOcclusion(), false,
    'runtime validation errors must restore camera containment');
  assert.equal(game._applyThirdPersonCameraContainmentPolicy(), true);
  assert.equal(containmentCalls, 1);
  game.dungeon.runtimeValidationErrors.length = 0;
  game.dungeon.validation.accepted = false;
  assert.equal(game._usesAcceptedV2OpaqueCameraOcclusion(), false,
    'a rejected plan must retain camera containment');
  game.dungeon.validation.accepted = true;
  delete game.dungeon.runtimeValidationErrors;
  assert.equal(game._usesAcceptedV2OpaqueCameraOcclusion(), false,
    'missing runtime validation accounting must fail closed to containment');
  game.dungeon.runtimeValidationErrors = [];
  wall.userData.v2CameraOcclusionClass = 'elevated-catwalk';
  assert.equal(game._usesAcceptedV2OpaqueCameraOcclusion(), false,
    'catwalk metadata alone cannot authorize leaving the accepted cell union');

  wall.geometry.dispose();
  wall.material.dispose();
});
