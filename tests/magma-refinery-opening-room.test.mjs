import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  assembleMagmaRefineryOpeningRoom,
  createMagmaRefineryOpeningPlan,
  MAGMA_REFINERY_OPENING_MODULE_ID,
} from '../src/magma/MagmaRefineryOpeningRoom.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../src/TraversalCapabilities.js';

class StubTextureLoader {
  load(url) {
    const texture = new THREE.Texture();
    texture.name = url;
    return texture;
  }
}

function pointInsideSolidZone(point, zone) {
  const padding = Number(zone.playerCollisionPadding ?? 0);
  return Math.abs(point.x - zone.position.x) <= zone.halfWidth + padding
    && Math.abs(point.z - zone.position.z) <= zone.halfDepth + padding
    && (!Number.isFinite(zone.verticalHalfHeight)
      || Math.abs(point.y - zone.position.y) <= zone.verticalHalfHeight);
}

test('approved Magma opening plan is deterministic and seed-varied only in authored dressing', () => {
  const first = createMagmaRefineryOpeningPlan({ seed: 'opening-seed-a' });
  const repeated = createMagmaRefineryOpeningPlan({ seed: 'opening-seed-a' });
  const alternate = createMagmaRefineryOpeningPlan({ seed: 'opening-seed-b' });

  assert.deepEqual(first, repeated);
  assert.notEqual(first.planHash, alternate.planHash);
  assert.deepEqual(first.floorTiles, alternate.floorTiles);
  assert.deepEqual(first.sockets, alternate.sockets);
  assert.notDeepEqual(first.rubble, alternate.rubble);
});

test('approved Magma opening plan preserves traversal and texture contracts', () => {
  const plan = createMagmaRefineryOpeningPlan({ seed: 'opening-contract' });
  const room = plan.room;
  const rampTiles = plan.floorTiles.filter((tile) => tile.surfaceRole === 'ramp');
  const rampRouteIds = new Set(rampTiles.map((tile) => tile.rampRouteId));
  const walkableElevations = new Set(plan.floorTiles.map((tile) => Number(tile.elevation.toFixed(3))));

  assert.equal(plan.moduleId, MAGMA_REFINERY_OPENING_MODULE_ID);
  assert.equal(room.width % 2, 1);
  assert.equal(room.depth % 2, 1);
  assert.equal(room.width >= 13, true);
  assert.equal(room.depth >= 13, true);
  assert.equal(room.verticalPlan.highestTierReachableWithoutJump, true);
  assert.equal(walkableElevations.has(-2.8), true);
  assert.equal(walkableElevations.has(5.6), true);

  assert.equal(plan.jump.streamWidthMeters, 4.2);
  assert.equal(plan.jump.airGapMeters, 2.4);
  assert.equal(plan.jump.airGapMeters < PLAYER_TRAVERSAL_ENVELOPE.maximumHorizontalJumpDistance, true);
  const jumpBendLava = plan.floorTiles.find((tile) => tile.x === 2 && tile.z === 1);
  assert.equal(jumpBendLava?.surface, 'deepMagma');
  assert.equal(
    plan.rockInfill.some((rock) => rock.id === 'cavern-infill-2-1'),
    false,
    'the required jump launch must not overlap a basalt infill collider',
  );
  assert.deepEqual(plan.jump.recoveryRouteIds, ['lava-west-ramp-out', 'lava-east-ramp-out']);
  assert.equal(rampRouteIds.has('lava-west-ramp-out'), true);
  assert.equal(rampRouteIds.has('lava-east-ramp-out'), true);
  assert.equal(rampRouteIds.has('digger-catwalk-flight-1'), true);
  assert.equal(rampRouteIds.has('digger-catwalk-flight-2'), true);
  assert.equal(rampRouteIds.has('ancient-terrace-descent'), true);

  assert.equal(plan.rampLandings.length, 10);
  for (const landing of plan.rampLandings) {
    assert.equal(landing.widthTiles >= 3, true, `${landing.id} is narrower than three tiles`);
    assert.equal(landing.depthTiles >= 3, true, `${landing.id} is shallower than three tiles`);
    assert.equal(landing.clearWidthMeters >= 8.4, true);
    assert.equal(landing.clearDepthMeters >= 8.4, true);
    assert.equal(landing.propFree, true);
    assert.equal(plan.rubble.some((prop) => (
      prop.x >= (landing.minX - 0.5) * plan.tileSize
        && prop.x <= (landing.maxX + 0.5) * plan.tileSize
        && prop.z >= (landing.minZ - 0.5) * plan.tileSize
        && prop.z <= (landing.maxZ + 0.5) * plan.tileSize
    )), false, `${landing.id} contains rubble`);
    for (let x = landing.minX; x <= landing.maxX; x += 1) {
      for (let z = landing.minZ; z <= landing.maxZ; z += 1) {
        const landingTile = plan.floorTiles.find((tile) => (
          tile.x === x
          && tile.z === z
          && tile.surfaceRole !== 'ramp'
          && Math.abs(tile.elevation - landing.elevation) < 0.001
        ));
        assert.ok(landingTile, `${landing.id} is missing flat tile ${x},${z}`);
      }
    }
  }

  const rampFootprints = new Set(rampTiles.map((tile) => `${tile.x},${tile.z}`));
  assert.equal(plan.floorTiles.some((tile) => (
    tile.surfaceRole !== 'ramp'
      && rampFootprints.has(`${tile.x},${tile.z}`)
      && tile.supportsElevatedRoute !== true
  )), false, 'unrelated flat floor may not cover a ramp');

  const supportedElevatedTiles = plan.floorTiles.filter((tile) => (
    tile.surfaceRole === 'catwalk'
      || (tile.surfaceRole === 'ramp' && tile.rampRouteId?.startsWith('digger-catwalk'))
  ));
  for (const tile of supportedElevatedTiles) {
    const lowerFloor = plan.floorTiles.find((candidate) => (
      candidate.x === tile.x
        && candidate.z === tile.z
        && candidate.surfaceRole !== 'ramp'
        && candidate.elevation < tile.elevation - 0.05
    ));
    assert.ok(lowerFloor, `elevated footprint ${tile.x},${tile.z} has no registered lower floor`);
  }

  const visuallyResolvedCells = new Set(plan.floorTiles.map((tile) => `${tile.x},${tile.z}`));
  for (const rock of plan.rockInfill) {
    assert.equal(rock.shape, 'hexagonal-basalt-column');
    assert.equal(rock.radialSegments, 6);
    assert.equal(rock.radius > 0, true);
    visuallyResolvedCells.add(`${Math.round(rock.x / plan.tileSize)},${Math.round(rock.z / plan.tileSize)}`);
  }
  const halfWidth = Math.floor(plan.dimensions.widthTiles / 2);
  const halfDepth = Math.floor(plan.dimensions.depthTiles / 2);
  for (let x = -halfWidth; x <= halfWidth; x += 1) {
    for (let z = -halfDepth; z <= halfDepth; z += 1) {
      assert.equal(visuallyResolvedCells.has(`${x},${z}`), true, `unresolved cavern cell ${x},${z}`);
    }
  }

  for (const tile of rampTiles) {
    assert.equal(
      Math.abs(tile.rampEndElevation - tile.rampStartElevation)
        <= PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.001,
      true,
      `${tile.rampRouteId} exceeds the player ramp envelope at ${tile.x},${tile.z}`,
    );
  }

  const playerSockets = plan.sockets.filter((socket) => socket.kind === 'player');
  assert.equal(playerSockets.length, 2);
  assert.equal(playerSockets.every((socket) => socket.widthMeters >= 8.4), true);
  assert.equal(plan.sockets.some((socket) => (
    socket.continuityTag === 'magma-refinery-lava-spine'
  )), true);

  const deeperSocket = plan.sockets.find((socket) => socket.id === 'opening-deeper-socket');
  const freightFrame = plan.socketFrames.find((frame) => frame.socketId === deeperSocket.id);
  assert.equal(freightFrame.x, deeperSocket.x);
  assert.equal(freightFrame.z, deeperSocket.z);
  assert.equal(freightFrame.elevation, deeperSocket.elevation);
  assert.equal(freightFrame.openingWidthMeters, deeperSocket.widthMeters);
  assert.equal(freightFrame.openingHeightMeters, deeperSocket.heightMeters);

  const descentRampTiles = rampTiles.filter((tile) => tile.rampRouteId === 'ancient-terrace-descent');
  const northWalls = plan.boundaryWalls.filter((wall) => wall.id.startsWith('north-cavern-'));
  for (const wall of northWalls) {
    for (const tile of descentRampTiles) {
      const overlapsX = Math.abs(wall.x - tile.x * plan.tileSize)
        < wall.halfWidth + plan.tileSize * 0.5;
      const overlapsZ = Math.abs(wall.z - tile.z * plan.tileSize)
        < wall.halfDepth + plan.tileSize * 0.5;
      assert.equal(overlapsX && overlapsZ, false, `${wall.id} intrudes into the descent ramp`);
    }
  }

  assert.equal(plan.textureContract.metersPerRepeat, 2.8);
  assert.equal(plan.textureContract.wrapS, 'RepeatWrapping');
  assert.equal(plan.textureContract.wrapT, 'RepeatWrapping');
  assert.equal(plan.textureContract.stretchedSurfacesAllowed, false);
});

test('Magma opening assembly uses tiled texture UVs, matching collision, and functional hazards', () => {
  const plan = createMagmaRefineryOpeningPlan({ seed: 'opening-assembly' });
  const dungeon = assembleMagmaRefineryOpeningRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  const meshes = [];
  dungeon.group.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });

  assert.equal(dungeon.developmentFixture, true);
  assert.deepEqual(dungeon.roomModuleIds, [MAGMA_REFINERY_OPENING_MODULE_ID]);
  assert.equal(dungeon.moduleManifestDiagnostics.accepted, true);
  assert.equal(dungeon.moduleManifestDiagnostics.authoredRoomAssetDependency, false);
  assert.equal(dungeon.moduleManifestDiagnostics.textureTiling.stretchedSurfacesAllowed, false);
  assert.equal(dungeon.moduleManifestDiagnostics.highestTierReachableFromGround, true);
  assert.equal(dungeon.moduleManifestDiagnostics.rampLandingCount, 10);
  assert.equal(dungeon.moduleManifestDiagnostics.minimumRampLandingTiles, 3);
  assert.equal(dungeon.moduleManifestDiagnostics.untexturedVoidCellCount, 0);
  assert.equal(dungeon.moduleManifestDiagnostics.rockInfillCellCount > 0, true);
  assert.equal(dungeon.rampLandings.every((landing) => (
    landing.widthTiles >= 3 && landing.depthTiles >= 3
  )), true);
  assert.equal(dungeon.solidZones.length > 70, true);
  assert.equal(dungeon.platforms.length, 2);
  assert.equal(dungeon.traps.length > 20, true);
  assert.equal(dungeon.traps.every((trap) => trap.interactive === false), true);
  assert.equal(dungeon.traps.every((trap) => trap.damagePerSecond === 24), true);
  assert.equal(dungeon.environmentalHazards[0].continuitySocketId, 'opening-lava-continuity-socket');

  const structuralSupports = meshes.filter((mesh) => mesh.userData.structuralSupport === true);
  const structuralFoundations = meshes.filter((mesh) => mesh.userData.structuralFoundation === true);
  const basaltColumns = meshes.filter((mesh) => mesh.name.startsWith('cavern-infill-'));
  const authoredWalls = meshes.filter((mesh) => (
    mesh.userData.architectureRole?.includes('wall')
      || /SideWall|PreviewCap|^(?:north|south|east|west)-cavern-/.test(mesh.name)
  ));
  assert.equal(structuralSupports.length > 20, true);
  for (const landing of dungeon.rampLandings) {
    for (let x = landing.minX; x <= landing.maxX; x += 1) {
      for (let z = landing.minZ; z <= landing.maxZ; z += 1) {
        const floorPoint = new THREE.Vector3(
          x * dungeon.tileSize,
          landing.elevation + 0.08,
          z * dungeon.tileSize,
        );
        const supportBlockers = dungeon.solidZones.filter((zone) => (
          zone.obstacleKind === 'magmaOpeningCatwalkSupport'
            && pointInsideSolidZone(floorPoint, zone)
        ));
        assert.deepEqual(
          supportBlockers.map((zone) => zone.id),
          [],
          `${landing.id} contains structural support collision at ${x},${z}`,
        );
      }
    }
  }
  assert.equal(structuralFoundations.length > 40, true);
  assert.equal(basaltColumns.length, plan.rockInfill.length);
  assert.equal(basaltColumns.every((column) => (
    column.geometry.type === 'CylinderGeometry'
      && column.geometry.parameters.radialSegments === 6
      && column.userData.proceduralShape === 'hexagonal-basalt-column'
  )), true);
  assert.equal(authoredWalls.length > 50, true);
  assert.equal(authoredWalls.every((wall) => (
    wall.userData.cameraOcclusionSurface === true
      && wall.userData.cameraOcclusionWall === true
      && wall.userData.cameraOcclusionExcluded !== true
  )), true, 'every authored opening wall must carry the universal camera label');
  for (const support of structuralSupports) {
    const renderedBottom = support.position.y - support.geometry.parameters.height * 0.5;
    assert.equal(
      Math.abs(renderedBottom - support.userData.supportBaseY) < 0.001,
      true,
      `${support.name} stops above its support floor`,
    );
  }

  assert.equal(meshes.length > 250, true);
  assert.equal(meshes.every((mesh) => mesh.userData.worldUvTiled === true), true);
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    assert.equal(geometry.userData.worldUvTiled, true, `${mesh.name} lacks tiled UV metadata`);
    assert.equal(geometry.userData.worldUvMetersPerRepeat > 0, true);
    const uv = geometry.attributes.uv;
    assert.ok(uv, `${mesh.name} lacks UVs`);
    for (let index = 0; index < uv.count; index += 1) {
      assert.equal(Number.isFinite(uv.getX(index)), true);
      assert.equal(Number.isFinite(uv.getY(index)), true);
    }
  }

  const materialSet = dungeon.group.userData.authoredOwnedMaterials;
  for (const material of materialSet) {
    if (!material.map) continue;
    assert.equal(material.userData.stretchedUvsAllowed, false);
    assert.equal(material.map.wrapS, THREE.RepeatWrapping);
    assert.equal(material.map.wrapT, THREE.RepeatWrapping);
  }

  assert.ok(dungeon.group.getObjectByName('diggerBoreRigBase'));
  assert.ok(dungeon.group.getObjectByName('ancientFreightGateLintel'));
  assert.equal(dungeon.group.getObjectByName('ancientReceiverHeader'), undefined);
  assert.equal(dungeon.group.getObjectByName('ancientReceiverPier-1'), undefined);
  assert.equal(dungeon.group.getObjectByName('ancientReceiverPier1'), undefined);
  assert.equal(dungeon.solidZones.some((zone) => zone.id.startsWith('ancientReceiver')), false);
  assert.ok(dungeon.group.getObjectByName('lavaJumpLaunch'));
  assert.ok(dungeon.group.getObjectByName('lavaJumpLanding'));
  assert.ok(dungeon.group.getObjectByName('diggerFlightOneRail_7_-9.5UpperRail'));

  const deeperSocket = plan.sockets.find((socket) => socket.id === 'opening-deeper-socket');
  const leftColumn = dungeon.group.getObjectByName('ancientFreightGateColumn-1');
  const rightColumn = dungeon.group.getObjectByName('ancientFreightGateColumn1');
  const lintel = dungeon.group.getObjectByName('ancientFreightGateLintel');
  const columnWidth = leftColumn.geometry.parameters.width;
  assert.equal(Number((rightColumn.position.x - leftColumn.position.x - columnWidth).toFixed(3)), deeperSocket.widthMeters);
  assert.equal(Number((lintel.position.y - lintel.geometry.parameters.height * 0.5).toFixed(3)), deeperSocket.heightMeters);
  assert.equal(lintel.position.x, deeperSocket.x * plan.tileSize);
  assert.equal(lintel.position.z, deeperSocket.z * plan.tileSize);
  assert.deepEqual(dungeon.moduleManifestDiagnostics.socketFrameAlignment, {
    accepted: true,
    frameId: 'ancient-freight-gate-frame',
    socketId: 'opening-deeper-socket',
    centerOffsetMeters: 0,
    widthOffsetMeters: 0,
    heightOffsetMeters: 0,
    toleranceMeters: 0.05,
  });
});
