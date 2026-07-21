import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import Game from '../../../src/Game.js';
import { DungeonGeneratorV2 } from '../../../src/dungeon-v2/DungeonGeneratorV2.js';

const FULL_RUNNING_CAMERA_RANGE = 7.52;
const NATIVE_SECURITY_PLACEMENT_ID = 'placement.security';
const NATIVE_ASSEMBLY_PLACEMENT_ID = 'placement.assembly';

function createOcclusionGame(facade) {
  const game = Object.create(Game.prototype);
  game.dungeon = facade;
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

function aimAtPlayer(game) {
  game.camera.lookAt(
    game.player.root.position.x,
    game.player.root.position.y + 1.25,
    game.player.root.position.z,
  );
  game.camera.updateMatrixWorld(true);
  game.dungeon.group.updateMatrixWorld(true);
}

function placementAncestor(object) {
  for (let current = object; current; current = current.parent) {
    if (current.userData?.v2PlacementId) return current;
  }
  return null;
}

function findEntryForPlanRecord(game, facade, record, expectedClass) {
  const visual = facade.structuralRegistry.getVisual(record.id);
  assert.ok(visual, `${record.id} lacks its registered visual`);
  const entry = game.cameraOcclusionEntries.find(({ object }) => object === visual);
  assert.ok(entry, `${record.id} visual is absent from camera occlusion entries`);
  assert.equal(entry.object.userData.v2CameraOcclusionClass, expectedClass);
  assert.notEqual(entry.owner, facade.group, `${record.id} would hide the entire dungeon`);
  assert.equal(Boolean(entry.owner.isGroup && entry.owner.userData?.v2PlacementId), false,
    `${record.id} would hide its entire native V1 room placement`);
  const contractIds = entry.object.userData.v2CameraOcclusionContractIds;
  const instanceIds = entry.object.userData.v2CameraOcclusionInstanceIds;
  const contractIndex = entry.object.userData.v2CameraOcclusionInstanceMode === 'per-instance'
    ? contractIds?.indexOf(record.localId)
    : null;
  const instanceId = contractIndex;
  if (entry.object.userData.v2CameraOcclusionInstanceMode === 'per-instance') {
    assert.ok(Number.isInteger(instanceId) && instanceId >= 0,
      `${record.id} has no aligned native instance contract`);
    assert.equal(instanceIds?.[instanceId], record.localId,
      `${record.id} instance metadata is not aligned to its InstancedMesh slot`);
  }
  return { entry, instanceId };
}

function captureInstanceMatrices(entry) {
  if (entry.object.userData.v2CameraOcclusionInstanceMode !== 'per-instance') return null;
  return Array.from({ length: entry.object.count }, (_, instanceId) => {
    const matrix = new THREE.Matrix4();
    entry.object.getMatrixAt(instanceId, matrix);
    return matrix;
  });
}

function assertOnlyExpectedInstanceHidden(game, entry, expectedInstanceId, matricesBefore) {
  if (entry.object.userData.v2CameraOcclusionInstanceMode !== 'per-instance') {
    assert.equal(entry.owner.visible, false, 'the opaque owner did not hide');
    return null;
  }
  assert.equal(entry.object.visible, true, 'native occlusion hid its entire batch');
  const hidden = game.cameraOcclusionHiddenInstances.get(entry.object);
  assert.ok(hidden?.has(expectedInstanceId), `native instance ${expectedInstanceId} was not hidden`);
  const siblingId = Array.from({ length: entry.object.count }, (_, index) => index)
    .find((index) => !hidden.has(index));
  assert.ok(Number.isInteger(siblingId), 'native batch has no independently visible sibling instance');
  const siblingAfter = new THREE.Matrix4();
  entry.object.getMatrixAt(siblingId, siblingAfter);
  assert.deepEqual(siblingAfter.elements, matricesBefore[siblingId].elements,
    'hiding one native instance perturbed a sibling matrix');
  return hidden;
}

function probeVerticalWallAtFullRange(game, entry, bounds, expectedInstanceId) {
  const center = new THREE.Vector3(
    (bounds.min.x + bounds.max.x) * 0.5,
    (bounds.min.y + bounds.max.y) * 0.5,
    (bounds.min.z + bounds.max.z) * 0.5,
  );
  const sizeX = bounds.max.x - bounds.min.x;
  const sizeZ = bounds.max.z - bounds.min.z;
  const normal = sizeX <= sizeZ
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 0, 1);
  const targetY = THREE.MathUtils.clamp(center.y, bounds.min.y + 0.35, bounds.max.y - 0.35);
  game.player.root.position.copy(center).addScaledVector(normal, -0.75);
  game.player.root.position.y = targetY - 1.25;
  game.camera.position.copy(game.player.root.position).addScaledVector(normal, FULL_RUNNING_CAMERA_RANGE);
  game.camera.position.y = game.player.root.position.y + 3.25;
  aimAtPlayer(game);
  const desired = game.camera.position.clone();
  assert.equal(game._usesAcceptedV2OpaqueCameraOcclusion(), true);
  assert.equal(game._applyThirdPersonCameraContainmentPolicy(), false,
    'accepted V2 opaque walls must preserve the full desired camera orbit');
  assert.ok(game.camera.position.distanceTo(desired) <= 1e-9,
    'V2 containment shortened the desired camera distance before occlusion');
  const matricesBefore = captureInstanceMatrices(entry);
  game._updateCameraWallOcclusion();
  assertOnlyExpectedInstanceHidden(game, entry, expectedInstanceId, matricesBefore);

  game.camera.position.copy(game.player.root.position).addScaledVector(normal, -2);
  game.camera.position.y = game.player.root.position.y + 3.25;
  aimAtPlayer(game);
  game._updateCameraWallOcclusion();
  assert.equal(entry.owner.visible, true, 'the wall did not restore off ray');
  assert.equal(game.cameraOcclusionHiddenInstances.has(entry.object), false,
    'the native wall instance did not restore off ray');
}

function probeHorizontalCatwalk(game, entry, bounds, expectedInstanceId) {
  const center = new THREE.Vector3(
    (bounds.min.x + bounds.max.x) * 0.5,
    (bounds.min.y + bounds.max.y) * 0.5,
    (bounds.min.z + bounds.max.z) * 0.5,
  );
  game.player.root.position.set(center.x, bounds.min.y - 1.45, center.z);
  game.camera.position.set(
    center.x + FULL_RUNNING_CAMERA_RANGE,
    game.player.root.position.y + 3.25,
    center.z,
  );
  aimAtPlayer(game);
  const desired = game.camera.position.clone();
  assert.equal(game._applyThirdPersonCameraContainmentPolicy(), false);
  assert.ok(game.camera.position.distanceTo(desired) <= 1e-9);
  const matricesBefore = captureInstanceMatrices(entry);
  game._updateCameraWallOcclusion();
  assertOnlyExpectedInstanceHidden(game, entry, expectedInstanceId, matricesBefore);

  game.camera.position.set(center.x + 2, bounds.min.y - 0.5, center.z);
  aimAtPlayer(game);
  game._updateCameraWallOcclusion();
  assert.equal(entry.owner.visible, true, 'the elevated catwalk did not restore below its deck');
  assert.equal(game.cameraOcclusionHiddenInstances.has(entry.object), false,
    'the native catwalk instance did not restore below its deck');
}

for (const undercroftType of ['magma', 'electrical']) {
  test(`${undercroftType} actual seed preserves full camera orbit through fine V2/native occluders`, () => {
    const facade = new DungeonGeneratorV2({
      seed: `m1-golden-${undercroftType}`,
      undercroftType,
    }).generate();
    const validation = facade.validation;
    assert.equal(validation.accepted, true, JSON.stringify(validation.errors, null, 2));
    assert.equal(facade.progression?.validation?.accepted, true,
      'the actual assembler compatibility summary is missing');
    assert.ok(Array.isArray(facade.runtimeValidationErrors),
      'the actual assembler must expose authoritative runtime validation errors');
    // The direct facade result belongs to DungeonGeneratorV2 and is the live
    // authority. A stale compatibility copy under progression must not send
    // the real camera back to the old containment/clipping behavior.
    facade.progression.validation.accepted = false;
    try {
      const game = createOcclusionGame(facade);
      game._collectCameraOcclusionWalls();
      const opaqueEntries = game.cameraOcclusionEntries.filter(({ object }) => (
        object.userData.v2CameraOcclusionClass === 'opaque-enclosure'
      ));
      const catwalkEntries = game.cameraOcclusionEntries.filter(({ object }) => (
        object.userData.v2CameraOcclusionClass === 'elevated-catwalk'
      ));
      assert.ok(opaqueEntries.length > 0, 'actual V2 seed exposes no opaque enclosure occluders');
      assert.ok(catwalkEntries.length > 0, 'actual V2 seed exposes no elevated catwalk occluders');
      assert.equal(game._usesAcceptedV2OpaqueCameraOcclusion(), true);

      const entryObjects = new Set(game.cameraOcclusionEntries.map(({ object }) => object));
      const excludedPresentation = [];
      facade.group.traverse((object) => {
        const role = String(object.userData?.v2StructuralRole ?? '');
        if (object.userData?.v2WaterVolumePresentation === true || /telegraph|signal|halo/i.test(role)) {
          excludedPresentation.push(object);
        }
      });
      assert.ok(excludedPresentation.some(({ userData }) => userData.v2WaterVolumePresentation === true),
        'actual seed must exercise a transparent Waterworks volume');
      assert.equal(excludedPresentation.some((object) => entryObjects.has(object)), false,
        'transparent water or telegraph presentation entered the wall occlusion ray set');

      const nativeWall = validation.plan.structuralBoundaries.find((boundary) => (
        boundary.presentationOwnerId === NATIVE_SECURITY_PLACEMENT_ID
        && ['west', 'east', 'north', 'south'].includes(boundary.side)
        && boundary.bounds.max.y - boundary.bounds.min.y >= 1
        && Math.max(
          boundary.bounds.max.x - boundary.bounds.min.x,
          boundary.bounds.max.z - boundary.bounds.min.z,
        ) >= 2.5
      ));
      assert.ok(nativeWall, 'actual seed lacks a native Security enclosure wall');
      const nativeWallProbe = findEntryForPlanRecord(
        game,
        facade,
        nativeWall,
        'opaque-enclosure',
      );
      const nativeWallEntry = nativeWallProbe.entry;
      assert.equal(nativeWallEntry.object.userData.v2LegacyFixedRoomPresentation, true,
        'Security wall must use the native V1 presentation batch');
      const securityPlacementRoot = placementAncestor(nativeWallEntry.object);
      assert.ok(securityPlacementRoot, 'native Security wall lost its placement ancestry');
      probeVerticalWallAtFullRange(
        game,
        nativeWallEntry,
        nativeWall.bounds,
        nativeWallProbe.instanceId,
      );
      assert.equal(securityPlacementRoot.visible, true,
        'hiding one Security wall batch hid the entire native room placement');

      const nativeCatwalk = validation.plan.walkableSurfaces.find((surface) => (
        surface.presentationOwnerId === NATIVE_ASSEMBLY_PLACEMENT_ID
        && surface.sourceSurface === 'machineUpperCatwalk'
        && surface.shape !== 'ramp-tile'
      ));
      assert.ok(nativeCatwalk, 'actual seed lacks a native Machine Factory catwalk surface');
      const nativeCatwalkProbe = findEntryForPlanRecord(
        game,
        facade,
        nativeCatwalk,
        'elevated-catwalk',
      );
      const nativeCatwalkEntry = nativeCatwalkProbe.entry;
      assert.equal(nativeCatwalkEntry.object.userData.v2LegacyFixedRoomPresentation, true,
        'Machine Factory catwalk must use the native V1 presentation batch');
      const assemblyPlacementRoot = placementAncestor(nativeCatwalkEntry.object);
      assert.ok(assemblyPlacementRoot, 'native Assembly catwalk lost its placement ancestry');
      probeHorizontalCatwalk(
        game,
        nativeCatwalkEntry,
        nativeCatwalk.bounds,
        nativeCatwalkProbe.instanceId,
      );
      assert.equal(assemblyPlacementRoot.visible, true,
        'hiding one catwalk batch hid the entire native room placement');
    } finally {
      facade.dispose();
    }
  });
}
