import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  assembleMagmaRefractorAssayLabRoom,
  createMagmaRefractorAssayLabPlan,
  MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID,
  SMELTER_BULKHEAD_DOOR_ID,
  SMELTER_SEAL_ID,
} from '../src/magma/MagmaRefractorAssayLabRoom.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../src/TraversalCapabilities.js';

const TILE_SIZE = 2.8;
const PICKUP_RADIUS = 1.45;

class StubTextureLoader {
  load(url) {
    const texture = new THREE.Texture();
    texture.name = url;
    return texture;
  }
}

function safeFloorTiles(plan) {
  return plan.floorTiles.filter((tile) => tile.surface !== 'deepMagma');
}

function nodeKey(tile) {
  return `${tile.x},${tile.z}@${Number(tile.elevation).toFixed(3)}`;
}

function hasSafeRoute(plan, start, destination) {
  const floors = safeFloorTiles(plan);
  const byColumn = new Map();
  for (const tile of floors) {
    const key = `${tile.x},${tile.z}`;
    const column = byColumn.get(key) ?? [];
    column.push(tile);
    byColumn.set(key, column);
  }
  const startTile = floors.find((tile) => (
    tile.x === start.x
      && tile.z === start.z
      && Math.abs(tile.elevation - start.elevation) < 0.01
  ));
  const destinationKey = `${destination.x},${destination.z}@${destination.elevation.toFixed(3)}`;
  assert.ok(startTile, `missing route start ${JSON.stringify(start)}`);

  const queue = [startTile];
  const visited = new Set([nodeKey(startTile)]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (nodeKey(current) === destinationKey) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const candidate of byColumn.get(`${current.x + dx},${current.z + dz}`) ?? []) {
        if (Math.abs(candidate.elevation - current.elevation)
          > PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.02) continue;
        const key = nodeKey(candidate);
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push(candidate);
      }
    }
  }
  return false;
}

function zoneBlocksPlayerAt(zone, position) {
  const padding = Number(zone.playerCollisionPadding ?? 0);
  return Math.abs(position.x - zone.position.x) <= zone.halfWidth + padding
    && Math.abs(position.z - zone.position.z) <= zone.halfDepth + padding
    && position.y >= zone.position.y - zone.verticalHalfHeight - 0.01
    && position.y <= zone.position.y + zone.verticalHalfHeight + 0.01;
}

function doorBlocksPlayerAt(door, position) {
  const collisionPadding = PLAYER_TRAVERSAL_ENVELOPE.collisionRadius;
  const baseY = Number(door.baseY ?? door.position.y);
  return Math.abs(position.x - door.position.x) <= door.collisionHalfWidth + collisionPadding
    && Math.abs(position.z - door.position.z) <= door.collisionHalfDepth + collisionPadding
    && position.y >= baseY - 0.01
    && position.y <= baseY + door.collisionHeight + 0.01;
}

function hasCollisionClearRoute(dungeon, start, destination, { blockingDoor = null } = {}) {
  const floors = dungeon.floorTiles.filter((tile) => tile.surface !== 'deepMagma');
  const pointFor = (tile) => new THREE.Vector3(
    tile.x * dungeon.tileSize,
    tile.elevation,
    tile.z * dungeon.tileSize,
  );
  const isBlocked = (point) => (
    dungeon.solidZones.some((zone) => zoneBlocksPlayerAt(zone, point))
      || (blockingDoor ? doorBlocksPlayerAt(blockingDoor, point) : false)
  );
  const byColumn = new Map();
  for (const tile of floors) {
    if (isBlocked(pointFor(tile))) continue;
    const key = `${tile.x},${tile.z}`;
    const column = byColumn.get(key) ?? [];
    column.push(tile);
    byColumn.set(key, column);
  }
  const startTile = (byColumn.get(`${start.x},${start.z}`) ?? []).find((tile) => (
    Math.abs(tile.elevation - start.elevation) < 0.01
  ));
  assert.ok(startTile, `missing collision-clear route start ${JSON.stringify(start)}`);
  const destinationKey = `${destination.x},${destination.z}@${destination.elevation.toFixed(3)}`;
  const queue = [startTile];
  const visited = new Set([nodeKey(startTile)]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (nodeKey(current) === destinationKey) return true;
    const currentPoint = pointFor(current);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const candidate of byColumn.get(`${current.x + dx},${current.z + dz}`) ?? []) {
        if (Math.abs(candidate.elevation - current.elevation)
          > PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.02) continue;
        const key = nodeKey(candidate);
        if (visited.has(key)) continue;
        const candidatePoint = pointFor(candidate);
        let edgeBlocked = false;
        for (let sample = 1; sample < 8; sample += 1) {
          const point = currentPoint.clone().lerp(candidatePoint, sample / 8);
          if (isBlocked(point)) {
            edgeBlocked = true;
            break;
          }
        }
        if (edgeBlocked) continue;
        visited.add(key);
        queue.push(candidate);
      }
    }
  }
  return false;
}

test('Refractor Assay Lab plan is deterministic, seed-varied, and signed-elevation safe', () => {
  const first = createMagmaRefractorAssayLabPlan({ seed: 'assay-deterministic' });
  const repeated = createMagmaRefractorAssayLabPlan({ seed: 'assay-deterministic' });
  const variants = Array.from({ length: 24 }, (_, index) => (
    createMagmaRefractorAssayLabPlan({ seed: `assay-variant-${index}` })
  ));
  assert.deepEqual(first, repeated);
  assert.equal(first.moduleId, MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID);
  assert.equal(first.dimensions.widthTiles, 37);
  assert.equal(first.dimensions.depthTiles, 41);
  assert.equal(first.tileSize, TILE_SIZE);
  assert.equal(variants.some((plan) => plan.furnacePattern !== first.furnacePattern), true);
  assert.equal(variants.some((plan) => plan.sampleBaySide !== first.sampleBaySide), true);

  const signed = createMagmaRefractorAssayLabPlan({
    seed: 'assay-signed',
    baseElevation: -14,
  });
  assert.equal(signed.baseElevation, -14);
  assert.equal(signed.room.baseElevation, -14);
  assert.equal(signed.room.minY, -22.4);
  assert.deepEqual(signed.room.verticalPlan.localWalkableTiers, [-19.6, -16.8, -14, -11.2]);
  assert.deepEqual(signed.room.verticalPlan.requiredRouteElevationSequence, [
    -14, -19.6, -16.8, -19.6, -14,
  ]);
  assert.equal(signed.smelterSeal.position.y, -16.8);
  assert.equal(signed.bulkhead.position.y, -14);

  const sockets = new Map(signed.sockets.map((socket) => [socket.id, socket]));
  assert.equal(sockets.size, 4);
  assert.deepEqual(
    [...sockets.values()].filter((socket) => socket.kind === 'player').map((socket) => socket.id),
    ['assay-lab-entry-socket', 'assay-lab-ember-crown-socket'],
  );
  assert.equal(sockets.get('assay-lab-entry-socket').elevation, -14);
  assert.equal(sockets.get('assay-lab-ember-crown-socket').elevation, -14);
  assert.equal(sockets.get('assay-lab-lava-inlet').elevation, -16.8);
  assert.equal(sockets.get('assay-lab-lava-outlet').elevation, -22.4);
  assert.equal(sockets.get('assay-lab-lava-inlet').continuityTag, 'magma-refinery-lava-spine');
  assert.equal(sockets.get('assay-lab-lava-outlet').continuityTag, 'magma-refinery-lava-spine');
  assert.equal([...sockets.values()].every((socket) => socket.widthMeters >= 4.2), true);
  assert.equal(signed.socketFrames.length, 2);
  assert.equal(signed.socketFrames.every((frame) => (
    frame.openingWidthMeters === 8.4
      && frame.openingHeightMeters === 5.6
      && frame.thresholdAlignmentToleranceMeters === 0.05
  )), true);
});

test('all Assay Lab slopes have safe steps, full landings, no flat overlap, and a dry critical route', () => {
  for (let index = 0; index < 32; index += 1) {
    const plan = createMagmaRefractorAssayLabPlan({ seed: `assay-route-${index}` });
    const ramps = plan.floorTiles.filter((tile) => tile.surfaceRole === 'ramp');
    const rampColumns = new Set(ramps.map((tile) => `${tile.x},${tile.z}`));
    const flatRampOverlaps = plan.floorTiles.filter((tile) => (
      tile.surfaceRole !== 'ramp'
        && tile.surface !== 'deepMagma'
        && rampColumns.has(`${tile.x},${tile.z}`)
    ));
    assert.deepEqual(flatRampOverlaps, [], 'a flat floor may not occupy a ramp column');

    const expectedSegments = new Map([
      ['assay-entry-descent', 11],
      ['east-dais-rise', 6],
      ['west-dais-return', 6],
      ['assay-rear-rise', 11],
      ['assayer-gallery-rise', 6],
      ['assayer-gallery-return', 6],
    ]);
    for (const [routeId, segmentCount] of expectedSegments) {
      const routeTiles = ramps.filter((tile) => tile.rampRouteId === routeId);
      assert.equal(routeTiles.length, segmentCount * 3, `${routeId} is not three tiles wide`);
      assert.equal(new Set(routeTiles.map((tile) => tile.rampSegmentIndex)).size, segmentCount);
      assert.equal(routeTiles.every((tile) => (
        Math.abs(tile.rampEndElevation - tile.rampStartElevation)
          <= PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.001
      )), true, `${routeId} exceeds the supported rise per tile`);
    }

    assert.equal(plan.rampLandings.length, expectedSegments.size * 2);
    for (const landing of plan.rampLandings) {
      assert.equal(landing.widthTiles >= 3, true, `${landing.id} is too narrow`);
      assert.equal(landing.depthTiles >= 3, true, `${landing.id} is too shallow`);
      assert.equal(landing.clearWidthMeters >= 8.4 - 0.001, true);
      assert.equal(landing.clearDepthMeters >= 8.4 - 0.001, true);
      assert.equal(landing.propFree, true);
      for (let x = landing.minX; x <= landing.maxX; x += 1) {
        for (let z = landing.minZ; z <= landing.maxZ; z += 1) {
          assert.ok(plan.floorTiles.find((tile) => (
            tile.x === x
              && tile.z === z
              && tile.surfaceRole !== 'ramp'
              && tile.surface !== 'deepMagma'
              && Math.abs(tile.elevation - landing.elevation) < 0.001
          )), `${landing.id} lacks flat landing tile ${x},${z}`);
        }
      }
    }

    assert.equal(hasSafeRoute(
      plan,
      { x: 12, z: 18, elevation: 0 },
      { x: 0, z: 1, elevation: -2.8 },
    ), true, `seed ${index} cannot reach the Smelter Seal without magma`);
    assert.equal(hasSafeRoute(
      plan,
      { x: 0, z: 1, elevation: -2.8 },
      { x: 12, z: -19, elevation: 0 },
    ), true, `seed ${index} cannot reach the bulkhead from the Seal without magma`);
    const upperGalleryOnly = {
      ...plan,
      floorTiles: plan.floorTiles.filter((tile) => (
        tile.surface !== 'deepMagma' && Math.abs(tile.elevation - 2.8) < 0.01
      )),
    };
    assert.equal(hasSafeRoute(
      upperGalleryOnly,
      { x: -15, z: 0, elevation: 2.8 },
      { x: 6, z: -10, elevation: 2.8 },
    ), true, `seed ${index} has a disconnected Assayer's Gallery return loop`);
    assert.equal(plan.clearanceContract.requiredRouteUsesMagma, false);
    assert.equal(plan.smelterSeal.encounterLocked, false);
  }
});

test('gallery return rejoins on the approach side and cannot bypass the sealed bulkhead', () => {
  const plan = createMagmaRefractorAssayLabPlan({ seed: 'assay-closed-bulkhead-topology' });
  const dungeon = assembleMagmaRefractorAssayLabRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  const bulkhead = dungeon.doors.find((door) => door.id === SMELTER_BULKHEAD_DOOR_ID);
  assert.ok(bulkhead);
  const galleryStart = { x: 6, z: -10, elevation: 2.8 };
  const farSide = { x: 12, z: -20, elevation: 0 };

  assert.equal(
    hasCollisionClearRoute(dungeon, galleryStart, farSide),
    true,
    'the open bulkhead must connect the gallery return to the exit side',
  );
  assert.equal(
    hasCollisionClearRoute(dungeon, galleryStart, farSide, { blockingDoor: bulkhead }),
    false,
    'the closed bulkhead may not be bypassed through the gallery landing',
  );
  assert.equal(plan.floorTiles.some((tile) => (
    tile.surface !== 'deepMagma'
      && Math.abs(tile.elevation) < 0.01
      && tile.x >= 5
      && tile.x <= 10
      && tile.z <= -20
  )), false, 'gallery-side floor extends behind the closed bulkhead');
  for (const [x, z] of [[-1, -10], [0, -10], [1, -10], [0, -11]]) {
    assert.ok(plan.floorTiles.find((tile) => (
      tile.x === x && tile.z === z && tile.surface === 'deepMagma'
    )), `recombined lava leaves an unreachable dry islet at ${x},${z}`);
  }
});

test('rendered Assay ramps follow their authored direction and join without gaps', () => {
  const plan = createMagmaRefractorAssayLabPlan({ seed: 'assay-rendered-ramp-parity' });
  const dungeon = assembleMagmaRefractorAssayLabRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  const rampMeshes = [];
  dungeon.group.traverse((object) => {
    if (object.isInstancedMesh && Array.isArray(object.userData?.rampSegments)) {
      rampMeshes.push(object);
    }
  });
  const instanceMatrix = new THREE.Matrix4();
  const localStart = new THREE.Vector3();
  const localEnd = new THREE.Vector3();
  let checked = 0;
  for (const mesh of rampMeshes) {
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    const depth = bounds.max.z - bounds.min.z;
    mesh.userData.rampSegments.forEach((segment, index) => {
      mesh.getMatrixAt(index, instanceMatrix);
      const alongX = Math.abs(segment.directionX) > 0.5;
      const travelLength = alongX ? width : depth;
      const expectedLength = Math.hypot(
        TILE_SIZE,
        segment.endElevation - segment.startElevation,
      );
      assert.equal(Math.abs(travelLength - expectedLength) < 0.05, true);
      localStart.set(
        alongX ? -segment.directionX * travelLength * 0.5 : 0,
        height * 0.5,
        alongX ? 0 : -segment.directionZ * travelLength * 0.5,
      ).applyMatrix4(instanceMatrix);
      localEnd.set(
        alongX ? segment.directionX * travelLength * 0.5 : 0,
        height * 0.5,
        alongX ? 0 : segment.directionZ * travelLength * 0.5,
      ).applyMatrix4(instanceMatrix);
      assert.equal(
        Math.abs(localStart.y - segment.startElevation) < 0.03,
        true,
        `${segment.routeId} segment ${segment.segmentIndex} rendered start is reversed`,
      );
      assert.equal(
        Math.abs(localEnd.y - segment.endElevation) < 0.03,
        true,
        `${segment.routeId} segment ${segment.segmentIndex} rendered end is reversed`,
      );
      checked += 1;
    });
  }
  assert.equal(checked, 46);
});

test('every ramp lane and prop-free landing is clear of authored solid collision', () => {
  const plan = createMagmaRefractorAssayLabPlan({ seed: 'assay-ramp-collision-sweep' });
  const dungeon = assembleMagmaRefractorAssayLabRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  const blockingZonesAt = (point) => dungeon.solidZones.filter((zone) => (
    zoneBlocksPlayerAt(zone, point)
  ));
  const rampTiles = plan.floorTiles.filter((tile) => tile.surfaceRole === 'ramp');
  for (const tile of rampTiles) {
    for (let sample = 0; sample <= 14; sample += 1) {
      const progress = sample / 14;
      const point = new THREE.Vector3(
        (tile.x + tile.rampDirectionX * (progress - 0.5)) * TILE_SIZE,
        THREE.MathUtils.lerp(tile.rampStartElevation, tile.rampEndElevation, progress),
        (tile.z + tile.rampDirectionZ * (progress - 0.5)) * TILE_SIZE,
      );
      assert.deepEqual(
        blockingZonesAt(point).map((zone) => zone.id),
        [],
        `${tile.rampRouteId} lane ${tile.x},${tile.z} is obstructed at ${progress.toFixed(2)}`,
      );
    }
  }
  for (const landing of plan.rampLandings) {
    for (let x = landing.minX; x <= landing.maxX; x += 1) {
      for (let z = landing.minZ; z <= landing.maxZ; z += 1) {
        const point = new THREE.Vector3(x * TILE_SIZE, landing.elevation, z * TILE_SIZE);
        assert.deepEqual(
          blockingZonesAt(point).map((zone) => zone.id),
          [],
          `${landing.id} is not a prop-free 3x3 landing at ${x},${z}`,
        );
      }
    }
  }
  for (const zone of dungeon.solidZones.filter((candidate) => (
    candidate.obstacleKind === 'structuralSupport'
      && Number.isFinite(candidate.supportTopY)
  ))) {
    assert.equal(
      zone.position.y + zone.verticalHalfHeight <= zone.supportTopY - 0.05,
      true,
      `${zone.id} collision reaches the supported walkable surface`,
    );
  }
});

test('Assay Lab assembly tiles every surface and labels only literal walls for camera occlusion', () => {
  const plan = createMagmaRefractorAssayLabPlan({ seed: 'assay-assembly' });
  const dungeon = assembleMagmaRefractorAssayLabRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  const meshes = [];
  dungeon.group.traverse((object) => {
    if (object.isMesh || object.isInstancedMesh) meshes.push(object);
  });

  assert.equal(dungeon.developmentFixture, true);
  assert.deepEqual(dungeon.roomModuleIds, [MAGMA_REFRACTOR_ASSAY_LAB_MODULE_ID]);
  assert.equal(dungeon.moduleManifestDiagnostics.untexturedVoidCellCount, 0);
  assert.equal(dungeon.moduleManifestDiagnostics.exteriorVoidVisible, false);
  assert.equal(dungeon.moduleManifestDiagnostics.giantShellPresent, false);
  assert.equal(meshes.length > 0, true);
  assert.equal(meshes.every((mesh) => mesh.geometry?.userData?.worldUvTiled === true), true);
  assert.equal(meshes.every((mesh) => mesh.geometry?.userData?.worldUvMetersPerRepeat > 0), true);

  for (const material of dungeon.group.userData.authoredOwnedMaterials) {
    if (!material.map) continue;
    assert.equal(material.userData.stretchedUvsAllowed, false, material.name);
    assert.equal(material.userData.worldUvMetersPerRepeat, TILE_SIZE, material.name);
    assert.equal(material.map.wrapS, THREE.RepeatWrapping, material.name);
    assert.equal(material.map.wrapT, THREE.RepeatWrapping, material.name);
  }

  const occlusionTagged = meshes.filter((mesh) => (
    mesh.userData.cameraOcclusionSurface === true
      || mesh.userData.cameraOcclusionOwner === true
      || mesh.userData.cameraOcclusionWall === true
  ));
  assert.equal(occlusionTagged.length > 0, true);
  assert.equal(occlusionTagged.every((mesh) => (
    mesh.userData.cameraOcclusionSurface === true
      && mesh.userData.cameraOcclusionOwner === true
      && mesh.userData.cameraOcclusionWall === true
      && mesh.userData.literalWall === true
      && mesh.userData.cameraOcclusionPerInstance === true
      && mesh.userData.maximumBaySpan === 1
  )), true, 'non-wall architecture may not participate in camera invisibility');
  assert.equal(dungeon.moduleManifestDiagnostics.cameraOcclusion.nonWallOwnerCount, 0);
});

test('Assay Lab finish floors have no coplanar foundation or neighboring deck overlap', () => {
  const plan = createMagmaRefractorAssayLabPlan({ seed: 'assay-no-z-fighting' });
  const dungeon = assembleMagmaRefractorAssayLabRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  dungeon.group.updateWorldMatrix(true, true);

  const collectInstanceBounds = (mesh) => {
    mesh.geometry.computeBoundingBox();
    const instanceMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    const bounds = [];
    const count = mesh.isInstancedMesh ? mesh.count : 1;
    for (let index = 0; index < count; index += 1) {
      if (mesh.isInstancedMesh) mesh.getMatrixAt(index, instanceMatrix);
      else instanceMatrix.identity();
      worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
      bounds.push(mesh.geometry.boundingBox.clone().applyMatrix4(worldMatrix));
    }
    return bounds;
  };
  const flatFloorBounds = [];
  const foundationBounds = [];
  dungeon.group.traverse((object) => {
    if (!object.isMesh && !object.isInstancedMesh) return;
    if (/^assayLab(?:BoredFloors|CeramicFloors|ServiceFloors)/.test(object.name)) {
      flatFloorBounds.push(...collectInstanceBounds(object));
    }
    if (object.name.startsWith('assayLabSupportedRockMass')) {
      foundationBounds.push(...collectInstanceBounds(object));
    }
  });
  assert.ok(flatFloorBounds.length > 0);
  assert.ok(foundationBounds.length > 0);

  const hasPositiveAreaOverlap = (left, right) => (
    Math.min(left.max.x, right.max.x) - Math.max(left.min.x, right.min.x) > 0.0001
      && Math.min(left.max.z, right.max.z) - Math.max(left.min.z, right.min.z) > 0.0001
  );
  const coplanarFoundationPairs = foundationBounds.flatMap((foundation) => (
    flatFloorBounds.filter((floor) => (
      hasPositiveAreaOverlap(foundation, floor)
        && Math.abs(foundation.max.y - floor.max.y) <= 0.0001
    ))
  ));
  assert.equal(
    coplanarFoundationPairs.length,
    0,
    'a basalt foundation top overlaps a visible finish-floor top',
  );

  let coplanarNeighborPairs = 0;
  for (let leftIndex = 0; leftIndex < flatFloorBounds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < flatFloorBounds.length; rightIndex += 1) {
      const left = flatFloorBounds[leftIndex];
      const right = flatFloorBounds[rightIndex];
      if (
        Math.abs(left.max.y - right.max.y) <= 0.0001
        && hasPositiveAreaOverlap(left, right)
      ) {
        coplanarNeighborPairs += 1;
      }
    }
  }
  assert.equal(
    coplanarNeighborPairs,
    0,
    'neighboring finish-floor decks overlap instead of meeting at exact tile edges',
  );
});

test('every visible Assay Lab boundary wall instance has capsule-safe matching collision', () => {
  const plan = createMagmaRefractorAssayLabPlan({ seed: 'assay-wall-collision' });
  const dungeon = assembleMagmaRefractorAssayLabRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  const wallMeshes = [];
  dungeon.group.traverse((object) => {
    if (object.userData?.cameraOcclusionWall === true) wallMeshes.push(object);
  });
  const visibleWallInstances = wallMeshes.reduce((sum, mesh) => (
    sum + (mesh.isInstancedMesh ? mesh.count : 1)
  ), 0);
  const wallZones = dungeon.solidZones.filter((zone) => zone.obstacleKind === 'boundaryWall');
  const wallZoneSignatures = wallZones.map((zone) => [
    zone.position.x,
    zone.position.y,
    zone.position.z,
    zone.halfWidth,
    zone.halfDepth,
    zone.verticalHalfHeight,
  ].map((value) => Number(value).toFixed(4)).join('|'));

  assert.equal(visibleWallInstances > 0, true);
  assert.equal(wallZones.length, visibleWallInstances);
  assert.equal(new Set(wallZoneSignatures).size, wallZoneSignatures.length);
  assert.equal(wallMeshes.every((mesh) => mesh.userData.collisionBacked === true), true);
  assert.equal(wallZones.every((zone) => (
    zone.playerCollisionPadding >= PLAYER_TRAVERSAL_ENVELOPE.collisionRadius
      && zone.verticalHalfHeight > 0
      && zone.halfWidth > 0
      && zone.halfDepth > 0
  )), true);
  assert.equal(dungeon.moduleManifestDiagnostics.collisionParity.visibleWallCount, wallMeshes.length);
  assert.equal(dungeon.moduleManifestDiagnostics.collisionParity.wallCollisionCount, wallZones.length);
  assert.equal(dungeon.moduleManifestDiagnostics.collisionParity.accepted, true);
});

test('Assay Lab supports resolve to their signed world datum', () => {
  for (const baseElevation of [0, -14]) {
    const plan = createMagmaRefractorAssayLabPlan({
      seed: `assay-support-${baseElevation}`,
      baseElevation,
    });
    const dungeon = assembleMagmaRefractorAssayLabRoom(plan, {
      textureLoader: new StubTextureLoader(),
    });
    dungeon.group.updateWorldMatrix(true, true);
    const supports = [];
    dungeon.group.traverse((object) => {
      if (object.userData?.structuralSupport === true) supports.push(object);
    });
    assert.equal(supports.length > 0, true);
    for (const support of supports) {
      const height = support.geometry?.parameters?.height;
      assert.equal(Number.isFinite(height), true, `${support.name} lacks measurable support geometry`);
      const worldPosition = support.getWorldPosition(new THREE.Vector3());
      assert.equal(
        Math.abs(worldPosition.y - height * 0.5 - support.userData.supportBaseY) <= 0.001,
        true,
        `${support.name} does not reach its signed support datum`,
      );
    }
    const supportInstanceCount = supports.reduce((count, support) => (
      count + (support.isInstancedMesh ? support.count : 1)
    ), 0);
    assert.equal(dungeon.supportDiagnostics.structuralSupportCount, supportInstanceCount);
    assert.equal(
      dungeon.supportDiagnostics.supportDatumViolationCount,
      0,
      `signed base ${baseElevation} reports support datum violations`,
    );
    assert.equal(dungeon.supportDiagnostics.unresolvedElevatedFootprintCount, 0);
    assert.equal(dungeon.moduleManifestDiagnostics.accepted, true);
  }
});

test('Smelter Seal is an accessible unguarded pedestal credential paired to the bulkhead', () => {
  const plan = createMagmaRefractorAssayLabPlan({ seed: 'assay-seal-contract' });
  const dungeon = assembleMagmaRefractorAssayLabRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  const keycard = dungeon.keycards.find((candidate) => candidate.keycardId === SMELTER_SEAL_ID);
  const definition = dungeon.progression.keycards.find((candidate) => (
    candidate.keycardId === SMELTER_SEAL_ID
  ));
  const door = dungeon.doors.find((candidate) => candidate.id === SMELTER_BULKHEAD_DOOR_ID);
  const progressionDoor = dungeon.progression.doors.find((candidate) => (
    candidate.doorId === SMELTER_BULKHEAD_DOOR_ID
  ));

  assert.ok(keycard);
  assert.ok(definition);
  assert.ok(door);
  assert.ok(progressionDoor);
  assert.equal(keycard.displayName, 'Smelter Seal');
  assert.equal(keycard.spawnMode, 'Pedestal');
  assert.equal(keycard.protectedByEncounterId, null);
  assert.equal(keycard.credentialKind, 'facility-seal');
  assert.deepEqual(keycard.opensDoorIdsOnCollect, [SMELTER_BULKHEAD_DOOR_ID]);
  assert.equal(definition.pairedDoorId, SMELTER_BULKHEAD_DOOR_ID);
  assert.equal(door.requiresKeycard, true);
  assert.equal(door.requiredKeycardId, SMELTER_SEAL_ID);
  assert.equal(door.locked, true);
  assert.equal(door.closed, true);
  assert.equal(progressionDoor.requiredKeycardId, SMELTER_SEAL_ID);
  assert.equal(plan.smelterSeal.encounterLocked, false);
  assert.equal(dungeon.encounters.every((encounter) => encounter.requiredForTraversal === false), true);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalPathEncounterLocked, false);
  assert.equal(dungeon.group.getObjectByName('smelterSealGrandPedestal')?.visible, true);
  assert.equal(dungeon.group.getObjectByName('smelterSealEmptyCradle')?.userData.remainsAfterSealPickup, true);
  assert.equal(keycard.object.userData.separateFromPedestal, true);

  // The runtime collects pedestal credentials within 1.45 m. At least one
  // point in that circle must remain outside every authored solid volume.
  const approachSamples = [];
  for (let radius = 0; radius <= PICKUP_RADIUS + 0.001; radius += 0.1) {
    for (let step = 0; step < 48; step += 1) {
      const angle = (step / 48) * Math.PI * 2;
      approachSamples.push(new THREE.Vector3(
        keycard.position.x + Math.cos(angle) * radius,
        keycard.position.y,
        keycard.position.z + Math.sin(angle) * radius,
      ));
    }
  }
  assert.equal(approachSamples.some((sample) => (
    !dungeon.solidZones.some((zone) => zoneBlocksPlayerAt(zone, sample))
  )), true, 'the pedestal collision blocks the entire Smelter Seal pickup radius');
  assert.equal(hasCollisionClearRoute(
    dungeon,
    { x: 12, z: 18, elevation: 0 },
    { x: 2, z: 1, elevation: -2.8 },
  ), true, 'solid collision blocks the authored entrance-to-Seal route');
  assert.equal(hasCollisionClearRoute(
    dungeon,
    { x: 2, z: 1, elevation: -2.8 },
    { x: 12, z: -19, elevation: 0 },
  ), true, 'solid collision blocks the authored Seal-to-bulkhead route');

  const lavaTiles = plan.floorTiles.filter((tile) => tile.surface === 'deepMagma');
  assert.equal(dungeon.traps.length, lavaTiles.length);
  assert.equal(dungeon.traps.every((trap) => (
    trap.interactive === false
      && trap.damagePerSecond === 24
      && trap.movementMultiplier === 0.55
      && trap.verticalHalfHeight === 0.85
      && trap.heatResistantMovementMultiplier === 0.8
      && trap.hazardImmunityDamageMultiplier === 0.4
      && trap.hazardPathCost === 18
      && trap.heatCompatibleOnly === true
  )), true);
  const dryCausewayTiles = plan.floorTiles.filter((tile) => tile.surfaceRole === 'bridge');
  assert.ok(dryCausewayTiles.length > 0, 'expected authored dry causeway tiles above the lava stream');
  for (const tile of dryCausewayTiles) {
    const position = new THREE.Vector3(tile.x * TILE_SIZE, tile.elevation, tile.z * TILE_SIZE);
    const activeLavaVolumes = dungeon.traps.filter((trap) => (
      Math.abs(position.x - trap.position.x) <= trap.halfWidth
        && Math.abs(position.z - trap.position.z) <= trap.halfDepth
        && Math.abs(position.y - trap.position.y) <= trap.verticalHalfHeight
    ));
    assert.deepEqual(
      activeLavaVolumes.map((trap) => trap.id),
      [],
      `dry causeway ${nodeKey(tile)} intersects a deep-magma volume`,
    );
  }
  assert.equal(dungeon.moduleManifestDiagnostics.dryRequiredRoute, true);
});
