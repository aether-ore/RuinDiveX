import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  assembleMagmaLinearDiggerExcavationRoom,
  CRITICAL_CATWALK_RISE,
  createMagmaLinearDiggerExcavationPlan,
  MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID,
  OLD_DRILL_CHEST_ID,
  OLD_DRILL_ITEM_ID,
} from '../src/magma/MagmaLinearDiggerExcavationRoom.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../src/TraversalCapabilities.js';
import { REAVERBOT_SALVAGE_MATERIALS } from '../src/reaverbots/ReaverbotSalvageCatalog.js';
import { getEquipmentRecipeDefinition } from '../src/equipment/EquipmentRecipeCatalog.js';
import { RollSalvageStorage } from '../src/RollSalvageStorage.js';
import { Game } from '../src/Game.js';

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
    tile.x === start.x && tile.z === start.z && Math.abs(tile.elevation - start.elevation) < 0.01
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
          > Math.max(PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile, CRITICAL_CATWALK_RISE) + 0.02) continue;
        const key = nodeKey(candidate);
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push(candidate);
      }
    }
  }
  return false;
}

function hasCriticalCatwalkRoute(plan, start, destination) {
  const floors = safeFloorTiles(plan).filter((tile) => (
    tile.criticalCatwalk === true || tile.surfaceRole === 'ramp'
  ));
  const byColumn = new Map();
  for (const tile of floors) {
    const key = `${tile.x},${tile.z}`;
    const column = byColumn.get(key) ?? [];
    column.push(tile);
    byColumn.set(key, column);
  }
  const startTile = floors.find((tile) => (
    tile.x === start.x && tile.z === start.z && Math.abs(tile.elevation - start.elevation) < 0.01
  ));
  const destinationKey = `${destination.x},${destination.z}@${destination.elevation.toFixed(3)}`;
  assert.ok(startTile, `missing critical catwalk start ${JSON.stringify(start)}`);
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

test('Linear Digger Excavation keeps the approved topology while varying authored branches', () => {
  const first = createMagmaLinearDiggerExcavationPlan({ seed: 'linear-a' });
  const repeated = createMagmaLinearDiggerExcavationPlan({ seed: 'linear-a' });
  const variants = Array.from({ length: 20 }, (_, index) => (
    createMagmaLinearDiggerExcavationPlan({ seed: `linear-${index}` })
  ));

  assert.deepEqual(first, repeated);
  assert.equal(first.moduleId, MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID);
  assert.equal(first.dimensions.widthTiles, 43);
  assert.equal(first.dimensions.depthTiles, 41);
  assert.equal(first.chambers.length, 8);
  assert.equal(first.activeOptionalChamberIds.length, 2);
  assert.equal(new Set(first.activeOptionalChamberIds).size, 2);
  assert.equal(variants.some((plan) => plan.upperBridgeZ !== first.upperBridgeZ), true);
  assert.equal(variants.some((plan) => plan.upperLoopOrientation !== first.upperLoopOrientation), true);
  assert.equal(variants.some((plan) => (
    plan.activeOptionalChamberIds.join('|') !== first.activeOptionalChamberIds.join('|')
  )), true);

  for (const plan of variants) {
    assert.deepEqual(plan.room.verticalPlan.requiredRouteElevationSequence, [0.84, -6.16, -13.16]);
    assert.equal(plan.activeOptionalChamberIds.length, 2);
    assert.equal(plan.reward.chestId, OLD_DRILL_CHEST_ID);
    assert.equal(plan.reward.itemId, OLD_DRILL_ITEM_ID);
    assert.equal(plan.reward.encounterLocked, false);
    assert.equal(plan.stackedWalkableColumns.length, 0);
    assert.equal(plan.clearanceContract.minimumTunnelHeadroomMeters, 8.4);
    assert.equal(plan.clearanceContract.minimumChamberHeadroomMeters, 11.2);
    assert.equal(plan.sockets.filter((socket) => socket.kind === 'player').length, 2);
    assert.equal(plan.sockets.filter((socket) => socket.kind === 'environmental-spine').length, 2);
    assert.equal(plan.criticalCatwalk.length, 11);
    assert.equal(plan.criticalCatwalk.every((segment) => (
      Math.min(segment.widthTiles, segment.depthTiles) >= 3
        && segment.supported === true
        && segment.collisionBacked === true
        && segment.propFree === true
        && segment.catwalkRiseMeters === CRITICAL_CATWALK_RISE
        && Math.abs(segment.elevation - segment.structuralBaseElevation - CRITICAL_CATWALK_RISE) < 0.001
    )), true);
    assert.equal(plan.criticalCatwalkRailRuns.length, 5);
    assert.equal(plan.criticalCatwalkRailRuns.every((run) => (
      Math.abs(run.clearWidthMeters - 8.4) < 0.001
        && run.catwalkRiseMeters === CRITICAL_CATWALK_RISE
        && run.landingClearancePreserved === true
        && run.junctionClearancePreserved === true
    )), true);
    const criticalCatwalkTiles = plan.floorTiles.filter((tile) => tile.criticalCatwalk === true);
    assert.equal(criticalCatwalkTiles.length > 200, true);
    assert.equal(criticalCatwalkTiles.every((tile) => (
      tile.groundedStepTransitionHeight >= CRITICAL_CATWALK_RISE
        && tile.groundedCatwalkTransition === true
        && tile.ledgeSafetyExempt === true
    )), true);
    assert.equal(plan.dressing.cavernFormations.length, 12);
    assert.equal(plan.dressing.cavernFormations.filter((item) => item.kind === 'stalagmite').length, 6);
    assert.equal(plan.dressing.cavernFormations.filter((item) => item.kind === 'stalactite').length, 6);
    assert.equal(plan.dressing.boulders.length, 7);
    assert.equal(plan.dressing.workVehicles.filter((item) => item.kind === 'minecart').length, 2);
    assert.equal(plan.dressing.workVehicles.filter((item) => item.kind === 'trolley').length, 2);
    assert.equal(plan.dressing.pickaxes.length, 5);
  }
});

test('Linear Digger Excavation has a safe broad route through both signed descents', () => {
  for (let index = 0; index < 30; index += 1) {
    const plan = createMagmaLinearDiggerExcavationPlan({ seed: `route-${index}` });
    const ramps = plan.floorTiles.filter((tile) => tile.surfaceRole === 'ramp');
    const rampColumns = new Set(ramps.map((tile) => `${tile.x},${tile.z}`));
    const flatRampOverlaps = plan.floorTiles.filter((tile) => (
      tile.surfaceRole !== 'ramp'
        && tile.surface !== 'deepMagma'
        && rampColumns.has(`${tile.x},${tile.z}`)
    ));
    assert.equal(flatRampOverlaps.length, 0, 'a flat floor may not overlap either descent flight');

    for (const routeId of ['digger-descent-flight-a', 'digger-descent-flight-b']) {
      const routeTiles = ramps.filter((tile) => tile.rampRouteId === routeId);
      assert.equal(routeTiles.length, 13 * 3);
      assert.equal(new Set(routeTiles.map((tile) => tile.rampSegmentIndex)).size, 13);
      for (const tile of routeTiles) {
        assert.equal(
          Math.abs(tile.rampEndElevation - tile.rampStartElevation)
            <= PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile + 0.001,
          true,
        );
      }
    }

    for (const landing of plan.rampLandings) {
      assert.equal(landing.widthTiles, 3);
      assert.equal(landing.depthTiles, 3);
      assert.equal(landing.propFree, true);
      for (let x = landing.minX; x <= landing.maxX; x += 1) {
        for (let z = landing.minZ; z <= landing.maxZ; z += 1) {
          assert.ok(plan.floorTiles.find((tile) => (
            tile.x === x && tile.z === z
              && tile.surfaceRole !== 'ramp'
              && tile.surface !== 'deepMagma'
              && Math.abs(tile.elevation - landing.elevation) < 0.001
          )), `${landing.id} lacks flat tile ${x},${z}`);
        }
      }
    }

    for (const routeId of ['digger-descent-flight-a', 'digger-descent-flight-b']) {
      const source = plan.rampLandings.find((landing) => (
        landing.routeId === routeId
          && landing.elevation === (routeId.endsWith('-a') ? 0.84 : -6.16)
      ));
      const destination = plan.rampLandings.find((landing) => (
        landing.routeId === routeId
          && landing.elevation === (routeId.endsWith('-a') ? -6.16 : -13.16)
      ));
      assert.ok(source && destination);
      for (const landing of [source, destination]) {
        const approachTiles = plan.floorTiles.filter((tile) => (
          tile.surface !== 'deepMagma'
            && tile.surfaceRole !== 'ramp'
            && Math.abs(tile.elevation - landing.elevation) < 0.001
            && (
              (tile.x >= landing.minX && tile.x <= landing.maxX
                && (tile.z === landing.minZ - 1 || tile.z === landing.maxZ + 1))
              || (tile.z >= landing.minZ && tile.z <= landing.maxZ
                && (tile.x === landing.minX - 1 || tile.x === landing.maxX + 1))
            )
        ));
        assert.equal(
          approachTiles.length >= 3,
          true,
          `${landing.id} must join a three-wide raised catwalk approach`,
        );
      }
    }

    const rampTiles = plan.floorTiles.filter((tile) => tile.surfaceRole === 'ramp');
    for (const rubble of plan.dressing.rubble) {
      const rubbleX = rubble.x / plan.tileSize;
      const rubbleZ = rubble.z / plan.tileSize;
      assert.equal(rampTiles.some((tile) => (
        Math.abs(tile.x - rubbleX) <= 1
          && Math.abs(tile.z - rubbleZ) <= 1
      )), false, `${rubble.id} intrudes on a ramp travel lane`);
      assert.equal(plan.rampLandings.some((landing) => (
        rubbleX >= landing.minX - 1 && rubbleX <= landing.maxX + 1
          && rubbleZ >= landing.minZ - 1 && rubbleZ <= landing.maxZ + 1
      )), false, `${rubble.id} intrudes on a required 3x3 landing buffer`);
    }

    const groundedClutter = [
      ...plan.dressing.cavernFormations.filter((item) => item.kind === 'stalagmite'),
      ...plan.dressing.boulders,
      ...plan.dressing.workVehicles,
    ];
    for (const prop of groundedClutter) {
      const propX = prop.x / plan.tileSize;
      const propZ = prop.z / plan.tileSize;
      assert.equal(rampTiles.some((tile) => (
        Math.abs(tile.x - propX) <= 1.25
          && Math.abs(tile.z - propZ) <= 1.25
      )), false, `${prop.id} intrudes on a ramp travel lane`);
      assert.equal(plan.rampLandings.some((landing) => (
        propX >= landing.minX - 1.25 && propX <= landing.maxX + 1.25
          && propZ >= landing.minZ - 1.25 && propZ <= landing.maxZ + 1.25
      )), false, `${prop.id} intrudes on a required landing buffer`);
      assert.equal(plan.floorTiles.some((tile) => (
        tile.criticalCatwalk === true
          && Math.abs(tile.x - propX) <= 1.25
          && Math.abs(tile.z - propZ) <= 1.25
      )), false, `${prop.id} intrudes on the raised critical catwalk`);
    }

    assert.equal(hasSafeRoute(
      plan,
      { x: 0, z: 15, elevation: 0.84 },
      { x: -8, z: -15, elevation: -13.16 },
    ), true, `seed ${index} lacks a safe entrance-to-Assay route`);
    assert.equal(hasSafeRoute(
      plan,
      { x: 0, z: 15, elevation: 0.84 },
      { x: 13, z: 4, elevation: 0 },
    ), true, `seed ${index} cannot reach the Old Drill cache`);
    assert.equal(hasCriticalCatwalkRoute(
      plan,
      { x: 0, z: 15, elevation: 0.84 },
      { x: -8, z: -15, elevation: -13.16 },
    ), true, `seed ${index} lacks a continuous critical catwalk through both ramps`);
    assert.equal(plan.rampLandings.every((landing) => (
      plan.criticalCatwalkCells.some((cell) => (
        cell.elevation === landing.elevation
          && cell.x >= landing.minX && cell.x <= landing.maxX
          && cell.z >= landing.minZ && cell.z <= landing.maxZ
      ))
    )), true, `seed ${index} has a ramp landing outside the critical catwalk`);
  }
});

test('lava is continuous, dangerous, and never replaces the safe required route', () => {
  const plan = createMagmaLinearDiggerExcavationPlan({ seed: 'lava-spine' });
  const lava = plan.floorTiles.filter((tile) => tile.surface === 'deepMagma');
  const byZ = new Map();
  for (const tile of lava) {
    const xs = byZ.get(tile.z) ?? [];
    xs.push(tile.x);
    byZ.set(tile.z, xs);
    assert.equal(tile.hazardPathCost, 18);
    assert.equal(tile.heatCompatibleOnly, true);
  }
  assert.equal(byZ.size, 41);
  for (let z = -22; z <= 17; z += 1) {
    const previous = byZ.get(z - 1);
    const current = byZ.get(z);
    assert.ok(previous && current);
    assert.equal(Math.min(...current) - Math.min(...previous) <= 1, true);
    assert.equal(Math.min(...previous) - Math.min(...current) <= 1, true);
  }
  const lavaSockets = plan.sockets.filter((socket) => socket.kind === 'environmental-spine');
  assert.equal(lavaSockets.every((socket) => socket.widthMeters === 4.2), true);
  assert.equal(lavaSockets.every((socket) => socket.continuityTag === 'magma-refinery-lava-spine'), true);
});

test('assembly is enclosed, collision-backed, locally occludable, supported, and world-tiled', () => {
  const plan = createMagmaLinearDiggerExcavationPlan({ seed: 'assembly' });
  const dungeon = assembleMagmaLinearDiggerExcavationRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  const meshes = [];
  const owners = [];
  dungeon.group.traverse((object) => {
    if (object.isMesh) meshes.push(object);
    if (object.userData?.cameraOcclusionOwner === true) owners.push(object);
  });

  assert.equal(dungeon.developmentFixture, true);
  assert.deepEqual(dungeon.roomModuleIds, [MAGMA_LINEAR_DIGGER_EXCAVATION_MODULE_ID]);
  assert.equal(dungeon.moduleManifestDiagnostics.accepted, true);
  assert.equal(dungeon.moduleManifestDiagnostics.safeRequiredRoute, true);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalPathEncounterLocked, false);
  assert.equal(dungeon.moduleManifestDiagnostics.totalDescentMeters, 14);
  assert.equal(dungeon.moduleManifestDiagnostics.stackedWalkableColumnCount, 0);
  assert.equal(dungeon.moduleManifestDiagnostics.minimumTunnelHeadroomMeters, 8.4);
  assert.equal(dungeon.moduleManifestDiagnostics.minimumChamberHeadroomMeters, 11.2);
  assert.equal(dungeon.moduleManifestDiagnostics.untexturedVoidCellCount, 0);
  assert.equal(dungeon.moduleManifestDiagnostics.exteriorVoidVisible, false);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalCatwalkSegmentCount, 11);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalCatwalkMinimumWidthTiles, 3);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalCatwalkConnectsEveryRamp, true);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalCatwalkRailRunCount, 5);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalCatwalkRaisedSurface, true);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalCatwalkRiseMeters, CRITICAL_CATWALK_RISE);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalCatwalkSocketTransitionRampCount, 2);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalCatwalkGroundedTransitionHeight, 0.89);
  assert.equal(dungeon.moduleManifestDiagnostics.criticalCatwalkLedgeSafetyExempt, true);
  assert.deepEqual(dungeon.moduleManifestDiagnostics.excavationClutter, {
    cavernFormationCount: 12,
    stalagmiteCount: 6,
    stalactiteCount: 6,
    boulderCount: 7,
    minecartCount: 2,
    trolleyCount: 2,
    pickaxeCount: 5,
    requiredRouteClear: true,
  });
  assert.equal(dungeon.solidZones.length > 300, true);
  assert.equal(dungeon.moduleManifestDiagnostics.collisionParity.accepted, true);
  assert.equal(dungeon.solidZones.every((zone) => zone.playerCollisionPadding >= 0.42), true);
  assert.equal(dungeon.aerialBoundaryZones.length > 400, true);
  assert.equal(dungeon.traps.length, 82);
  assert.equal(dungeon.traps.every((trap) => trap.damagePerSecond === 24), true);
  assert.equal(dungeon.traps.every((trap) => trap.movementMultiplier === 0.55), true);
  assert.equal(dungeon.traps.every((trap) => trap.heatResistantMovementMultiplier === 0.8), true);
  assert.equal(dungeon.traps.every((trap) => trap.hazardImmunityDamageMultiplier === 0.4), true);
  assert.equal(dungeon.traps.every((trap) => trap.interactive === false), true);
  assert.equal(dungeon.encounters.length, 2);
  assert.equal(dungeon.encounters.every((encounter) => encounter.requiredForTraversal === false), true);
  assert.equal(dungeon.supportDiagnostics.structuralSupportCount > 30, true);
  assert.equal(dungeon.supportDiagnostics.supportDatumViolationCount, 0);
  assert.equal(dungeon.supportDiagnostics.unresolvedElevatedFootprintCount, 0);
  assert.equal(meshes.filter((mesh) => mesh.userData.cavernFormation === true).reduce(
    (count, mesh) => count + mesh.count,
    0,
  ), 12);
  assert.equal(meshes.filter((mesh) => mesh.userData.proceduralShape === 'excavated-boulder').reduce(
    (count, mesh) => count + mesh.count,
    0,
  ), 7);
  assert.equal(dungeon.solidZones.filter((zone) => (
    /(?:stalagmite|stalactite|excavationBoulder|diggerMinecart|diggerToolTrolley)/.test(zone.obstacleKind)
  )).length, 23);

  assert.equal(meshes.some((mesh) => (
    /CavernBackdrop|cavernBackdrop/i.test(mesh.name)
      || mesh.userData.exteriorBackdrop === true
  )), false, 'the retired encompassing shell must not be rendered');
  assert.equal(dungeon.solidZones.some((zone) => (
    /cavernBackdrop/i.test(zone.id)
      || /cavernBackdrop/i.test(zone.obstacleKind)
  )), false, 'the retired encompassing shell must not retain collision');
  assert.equal(dungeon.aerialBoundaryZones.some((zone) => (
    /cavernBackdrop/i.test(zone.id)
      || /cavernBackdrop/i.test(zone.obstacleKind)
  )), false, 'the retired shell floor and ceiling collision must be removed');

  assert.equal(owners.length > 8, true);
  assert.equal(owners.every((owner) => owner.userData.maximumBaySpan <= 3), true);
  assert.equal(dungeon.moduleManifestDiagnostics.cameraOcclusion.oversizedOwnerCount, 0);
  assert.equal(dungeon.moduleManifestDiagnostics.cameraOcclusion.surfaceCount >= owners.length, true);
  const perInstanceOccluders = meshes.filter((mesh) => mesh.userData.cameraOcclusionPerInstance === true);
  assert.equal(perInstanceOccluders.length > 15, true);
  assert.equal(perInstanceOccluders.every((mesh) => mesh.userData.cameraOcclusionSurface === true), true);
  const authoredWalls = meshes.filter((mesh) => (
    mesh.userData.cameraOcclusionWall === true
      || /(?:wall|backdrop|retaining|partition|bulkhead|barrier)/i.test(mesh.name)
      || /(?:wall|backdrop|retaining|partition|bulkhead|barrier)/i.test(
        mesh.userData.architectureRole ?? '',
      )
  ));
  assert.equal(authoredWalls.length > 5, true);
  assert.equal(authoredWalls.every((wall) => (
    wall.userData.cameraOcclusionSurface === true
      && wall.userData.cameraOcclusionWall === true
      && wall.userData.cameraOcclusionExcluded !== true
  )), true, 'every authored excavation wall must carry the universal camera label');
  const raisedFloorOccluders = meshes.filter((mesh) => mesh.name.endsWith('Floors'));
  assert.equal(raisedFloorOccluders.length, 4);
  assert.equal(raisedFloorOccluders.every((mesh) => (
    mesh.isInstancedMesh
      && mesh.userData.cameraOcclusionPerInstance === true
      && mesh.userData.cameraOcclusionSurface === true
      && mesh.userData.maximumBaySpan === 1
  )), true, 'raised floor bays must disappear individually when they block the camera');
  const criticalCatwalkMesh = meshes.find((mesh) => (
    mesh.name === 'linearExcavationCriticalCatwalkFloors'
  ));
  assert.ok(criticalCatwalkMesh);
  assert.equal(criticalCatwalkMesh.userData.architectureRole, 'raised-critical-catwalk');
  assert.equal(criticalCatwalkMesh.userData.criticalCatwalkRouteId, 'linear-excavation-critical-route');
  assert.equal(criticalCatwalkMesh.userData.collisionBacked, true);
  assert.equal(meshes.length < 200, true, 'local batching should keep the fixture below the draw-call regression ceiling');
  assert.equal(meshes.every((mesh) => mesh.userData.worldUvTiled === true), true);
  for (const mesh of meshes) {
    assert.equal(mesh.geometry.userData.worldUvTiled, true, `${mesh.name} lacks tiled UV metadata`);
    assert.equal(mesh.geometry.userData.worldUvMetersPerRepeat > 0, true);
  }
  for (const material of dungeon.group.userData.authoredOwnedMaterials) {
    if (!material.map) continue;
    assert.equal(material.userData.stretchedUvsAllowed, false);
    assert.equal(material.map.wrapS, THREE.RepeatWrapping);
    assert.equal(material.map.wrapT, THREE.RepeatWrapping);
  }
  const basaltSpoil = meshes.filter((mesh) => mesh.name.startsWith('digger-spoil-'));
  assert.equal(basaltSpoil.length > 0, true);
  assert.equal(basaltSpoil.every((mesh) => (
    mesh.geometry.type === 'CylinderGeometry'
      && mesh.geometry.parameters.radialSegments === 6
      && mesh.userData.proceduralShape === 'hexagonal-basalt-column'
  )), true);

  const rampGeometry = meshes.filter((mesh) => mesh.name.startsWith('digger-descent-flight-'));
  assert.equal(rampGeometry.length > 8, true);
  assert.equal(rampGeometry.every((mesh) => mesh.userData.collisionBacked === true), true);
});

test('every exposed floor boundary and ramp edge has capsule-safe authored collision', () => {
  const plan = createMagmaLinearDiggerExcavationPlan({ seed: 'wall-collision-sweep' });
  const dungeon = assembleMagmaLinearDiggerExcavationRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  const safeTiles = plan.floorTiles.filter((tile) => (
    tile.surface !== 'deepMagma' && tile.surfaceRole !== 'ramp'
  ));
  const safeKeysByElevation = new Set(safeTiles.map((tile) => (
    `${tile.x},${tile.z}@${tile.elevation.toFixed(3)}`
  )));
  const safeTilesByColumn = new Map();
  for (const tile of safeTiles) {
    const key = `${tile.x},${tile.z}`;
    const column = safeTilesByColumn.get(key) ?? [];
    column.push(tile);
    safeTilesByColumn.set(key, column);
  }
  const rampColumns = new Set(plan.floorTiles
    .filter((tile) => tile.surfaceRole === 'ramp')
    .map((tile) => `${tile.x},${tile.z}`));
  const magmaColumns = new Set(plan.floorTiles
    .filter((tile) => tile.surface === 'deepMagma')
    .map((tile) => `${tile.x},${tile.z}`));
  const socketBoundary = (tile, dx, dz) => plan.sockets.some((socket) => (
    Math.abs(socket.elevation - tile.elevation) < 0.01
      && tile.z === socket.z
      && dz === Math.sign(socket.facingZ)
      && Math.abs(tile.x - socket.x) <= 1.01
  ));
  const zoneContains = (zone, x, y, z) => (
    Math.abs(x - zone.position.x) <= zone.halfWidth + 0.02
      && Math.abs(z - zone.position.z) <= zone.halfDepth + 0.02
      && Math.abs(y - zone.position.y) <= zone.verticalHalfHeight + 0.02
  );

  for (const tile of safeTiles) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (safeKeysByElevation.has(`${tile.x + dx},${tile.z + dz}@${tile.elevation.toFixed(3)}`)) continue;
      if ((safeTilesByColumn.get(`${tile.x + dx},${tile.z + dz}`) ?? []).some((neighbor) => (
        Math.abs(neighbor.elevation - tile.elevation) <= CRITICAL_CATWALK_RISE + 0.001
      ))) continue;
      if (rampColumns.has(`${tile.x + dx},${tile.z + dz}`)) continue;
      if (magmaColumns.has(`${tile.x + dx},${tile.z + dz}`)) continue;
      if (socketBoundary(tile, dx, dz)) continue;
      const sampleX = (tile.x + dx * 0.5) * plan.tileSize;
      const sampleZ = (tile.z + dz * 0.5) * plan.tileSize;
      const sampleY = tile.elevation + 1;
      assert.ok(dungeon.solidZones.some((zone) => (
        zoneContains(zone, sampleX, sampleY, sampleZ)
      )), `missing wall or railing collision at ${tile.x},${tile.z}@${tile.elevation} toward ${dx},${dz}`);
    }
  }

  for (const routeId of ['digger-descent-flight-a', 'digger-descent-flight-b']) {
    const routeTiles = plan.floorTiles.filter((tile) => tile.rampRouteId === routeId);
    const startLanding = plan.rampLandings.find((landing) => (
      landing.routeId === routeId
        && landing.elevation === Math.max(...routeTiles.flatMap((tile) => [
          tile.rampStartElevation,
          tile.rampEndElevation,
        ]))
    ));
    const endLanding = plan.rampLandings.find((landing) => (
      landing.routeId === routeId
        && landing.elevation === Math.min(...routeTiles.flatMap((tile) => [
          tile.rampStartElevation,
          tile.rampEndElevation,
        ]))
    ));
    assert.ok(startLanding && endLanding);
    const seamSamples = [
      {
        x: (Math.max(...routeTiles.map((tile) => tile.x)) + 0.5) * plan.tileSize,
        y: startLanding.elevation + 1,
      },
      {
        x: (Math.min(...routeTiles.map((tile) => tile.x)) - 0.5) * plan.tileSize,
        y: endLanding.elevation + 1,
      },
    ];
    for (const seam of seamSamples) {
      for (let z = startLanding.minZ; z <= startLanding.maxZ; z += 1) {
        assert.equal(dungeon.solidZones.some((zone) => (
          zone.obstacleKind === 'excavationRockWall'
            && zoneContains(zone, seam.x, seam.y, z * plan.tileSize)
        )), false, `${routeId} has an impassable wall across a ramp seam`);
      }
    }
    for (let segment = 1; segment <= 13; segment += 1) {
      assert.equal(dungeon.solidZones.filter((zone) => (
        zone.id.startsWith(`${routeId}SideWall${segment}_`)
      )).length, 2);
      assert.equal(dungeon.solidZones.filter((zone) => (
        zone.id.startsWith(`${routeId}Rail${segment}_`)
      )).length, 2);
    }
  }
});

test('camera occlusion hides and restores only the obstructing instanced panel', () => {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    2,
  );
  mesh.userData.cameraOcclusionPerInstance = true;
  const first = new THREE.Matrix4().makeTranslation(2, 3, 4);
  const second = new THREE.Matrix4().makeTranslation(8, 9, 10);
  mesh.setMatrixAt(0, first);
  mesh.setMatrixAt(1, second);

  const game = Object.create(Game.prototype);
  game.cameraOcclusionHiddenInstances = [];
  game.cameraOcclusionHiddenInstanceKeys = new Set();
  assert.equal(game._hideCameraOcclusionInstance({ object: mesh, instanceId: 0 }), true);

  const hidden = new THREE.Matrix4();
  const untouched = new THREE.Matrix4();
  mesh.getMatrixAt(0, hidden);
  mesh.getMatrixAt(1, untouched);
  assert.equal(hidden.determinant(), 0);
  assert.deepEqual(untouched.elements, second.elements);
  assert.equal(game.cameraOcclusionHiddenInstances.length, 1);

  game._restoreCameraOcclusionHiddenInstances();
  const restored = new THREE.Matrix4();
  mesh.getMatrixAt(0, restored);
  assert.deepEqual(restored.elements, first.elements);
  assert.equal(game.cameraOcclusionHiddenInstances.length, 0);
});

test('camera occlusion affects only walls crossing the camera-to-player silhouette', () => {
  const root = new THREE.Group();
  const makeWall = (name, x, z) => {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(2, 6, 0.3),
      new THREE.MeshBasicMaterial(),
    );
    wall.name = name;
    wall.userData.cameraOcclusionWall = true;
    wall.position.set(x, 3, z);
    root.add(wall);
    return wall;
  };
  const frontWall = makeWall('frontSightlineWall', 0, 4);
  const rearWall = makeWall('rearSightlineWall', 0, -2);
  const nearbyOffAxisWall = makeWall('nearbyOffAxisWall', 4, 3);
  const support = new THREE.Mesh(
    new THREE.BoxGeometry(2, 6, 0.3),
    new THREE.MeshBasicMaterial(),
  );
  support.name = 'nearbyCatwalkSupport';
  support.userData.cameraOcclusionSurface = true;
  support.userData.architectureRole = 'catwalk support';
  support.position.set(0, 3, 1);
  root.add(support);

  const game = Object.create(Game.prototype);
  game.activeWorldBundle = { root };
  game.dungeon = { group: root };
  game.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  game.camera.position.set(0, 2.5, 10);
  game.camera.lookAt(0, 1.25, -10);
  game.camera.updateMatrixWorld(true);
  game.player = { root: new THREE.Object3D() };
  game.player.root.position.set(0, 0, -10);
  game.cameraOcclusionRaycaster = new THREE.Raycaster();
  game.cameraOcclusionEntries = [];
  game.cameraOcclusionBins = new Map();
  game.cameraOcclusionWallProximityBins = new Map();
  game.cameraOcclusionProximityRecordByKey = new Map();
  game.cameraOcclusionWallProximityCandidateKeys = new Set();
  game.cameraOcclusionExpandedVerticalRecordKeys = new Set();
  game.cameraOcclusionExpandedSurfaceRecordKeys = new Set();
  game.cameraOcclusionForwardVerticalHits = [];
  game.cameraOcclusionCandidateSet = new Set();
  game.cameraOcclusionCandidateObjects = [];
  game.cameraOcclusionHits = [];
  game.cameraOcclusionOwnerByObject = new WeakMap();
  game.cameraOcclusionHiddenOwners = new Set();
  game.cameraOcclusionHiddenInstances = [];
  game.cameraOcclusionHiddenInstanceKeys = new Set();
  game.cameraOcclusionOwnerBaseVisibility = new WeakMap();

  game._collectCameraOcclusionWalls();
  game._updateCameraWallOcclusion();

  assert.equal(frontWall.visible, false);
  assert.equal(rearWall.visible, false);
  assert.equal(nearbyOffAxisWall.visible, true);
  assert.equal(support.visible, true);
  assert.equal(game.cameraOcclusionHiddenOwners.has(support), false);
});

test('camera occlusion opens a bounded multi-panel cutout around any architectural hit', () => {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    4,
  );
  mesh.userData.cameraOcclusionPerInstance = true;
  const matrices = [0, 2.8, 5.6, 10].map((x) => new THREE.Matrix4().makeTranslation(x, 0, 0));
  matrices.forEach((matrix, instanceId) => mesh.setMatrixAt(instanceId, matrix));

  // This deliberately models a ceiling/floor batch whose vertical side reads
  // as a wall from outside the enclosure without carrying a wall-specific tag.
  const entry = {
    object: mesh,
    owner: mesh,
    wallSurface: false,
    surfaceClass: 'walkable',
  };
  const records = [0, 2.8, 5.6, 10].map((x, instanceId) => ({
    entry,
    instanceId,
    bounds: new THREE.Box3(
      new THREE.Vector3(x - 0.5, -0.5, -0.5),
      new THREE.Vector3(x + 0.5, 0.5, 0.5),
    ),
    key: `${mesh.uuid}:${instanceId}`,
  }));
  const game = Object.create(Game.prototype);
  game.cameraOcclusionHiddenInstances = [];
  game.cameraOcclusionHiddenInstanceKeys = new Set();
  game.cameraOcclusionHiddenOwners = new Set();
  game.cameraOcclusionWallProximityBins = new Map([['0,0', records]]);
  game.cameraOcclusionWallProximityCandidateKeys = new Set();

  game._hideCameraOcclusionArchitectureNeighborhood(new THREE.Vector3(2.8, 0, 0), {
    seedEntry: entry,
  });

  assert.deepEqual(
    game.cameraOcclusionHiddenInstances.map((hidden) => hidden.instanceId).sort((a, b) => a - b),
    [0, 1, 2],
  );
  const outsideCutout = new THREE.Matrix4();
  mesh.getMatrixAt(3, outsideCutout);
  assert.ok(outsideCutout.elements.every((value, index) => (
    Math.abs(value - matrices[3].elements[index]) < 0.00001
  )));

  game._restoreCameraOcclusionHiddenInstances();
  for (let instanceId = 0; instanceId < matrices.length; instanceId += 1) {
    const restoredMatrix = new THREE.Matrix4();
    mesh.getMatrixAt(instanceId, restoredMatrix);
    assert.ok(restoredMatrix.elements.every((value, index) => (
      Math.abs(value - matrices[instanceId].elements[index]) < 0.00001
    )));
  }
});

test('vertical camera cutouts never remove nearby walkable floor panels', () => {
  const wallMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 6, 0.3),
    new THREE.MeshBasicMaterial(),
    2,
  );
  const floorMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.8, 0.38, 2.8),
    new THREE.MeshBasicMaterial(),
    1,
  );
  wallMesh.userData.cameraOcclusionPerInstance = true;
  floorMesh.userData.cameraOcclusionPerInstance = true;
  wallMesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 3, 0));
  wallMesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2.8, 3, 0));
  const floorMatrix = new THREE.Matrix4().makeTranslation(1.4, -0.19, 0);
  floorMesh.setMatrixAt(0, floorMatrix);

  const wallEntry = {
    object: wallMesh,
    owner: wallMesh,
    wallSurface: true,
    surfaceClass: 'wall',
  };
  const floorEntry = {
    object: floorMesh,
    owner: floorMesh,
    wallSurface: false,
    surfaceClass: 'walkable',
  };
  const records = [{
    entry: wallEntry,
    instanceId: 0,
    bounds: new THREE.Box3(
      new THREE.Vector3(-0.5, 0, -0.15),
      new THREE.Vector3(0.5, 6, 0.15),
    ),
    key: `${wallMesh.uuid}:0`,
  }, {
    entry: wallEntry,
    instanceId: 1,
    bounds: new THREE.Box3(
      new THREE.Vector3(2.3, 0, -0.15),
      new THREE.Vector3(3.3, 6, 0.15),
    ),
    key: `${wallMesh.uuid}:1`,
  }, {
    entry: floorEntry,
    instanceId: 0,
    bounds: new THREE.Box3(
      new THREE.Vector3(0, -0.38, -1.4),
      new THREE.Vector3(2.8, 0, 1.4),
    ),
    key: `${floorMesh.uuid}:0`,
  }];
  const game = Object.create(Game.prototype);
  game.cameraOcclusionHiddenInstances = [];
  game.cameraOcclusionHiddenInstanceKeys = new Set();
  game.cameraOcclusionHiddenOwners = new Set();
  game.cameraOcclusionWallProximityBins = new Map([['0,0', records]]);
  game.cameraOcclusionWallProximityCandidateKeys = new Set();

  game._hideCameraOcclusionArchitectureNeighborhood(new THREE.Vector3(0, 2, 0), {
    seedEntry: wallEntry,
    verticalOnly: true,
  });

  assert.deepEqual(
    game.cameraOcclusionHiddenInstances
      .filter((hidden) => hidden.object === wallMesh)
      .map((hidden) => hidden.instanceId)
      .sort((a, b) => a - b),
    [0, 1],
  );
  assert.equal(
    game.cameraOcclusionHiddenInstances.some((hidden) => hidden.object === floorMesh),
    false,
  );
  const untouchedFloor = new THREE.Matrix4();
  floorMesh.getMatrixAt(0, untouchedFloor);
  assert.ok(untouchedFloor.elements.every((value, index) => (
    Math.abs(value - floorMatrix.elements[index]) < 0.00001
  )));
});

test('camera forward recovery clears every vertical layer without hiding floors', () => {
  const wallRecords = [6, 0, -6].map((z, index) => {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(2, 6, 0.3),
      new THREE.MeshBasicMaterial(),
    );
    wall.name = `cameraOcclusionLayer${index}`;
    wall.position.set(0, 2, z);
    wall.updateMatrixWorld(true);
    const entry = {
      object: wall,
      owner: wall,
      wallSurface: true,
      surfaceClass: 'wall',
    };
    return {
      entry,
      instanceId: null,
      bounds: new THREE.Box3().setFromObject(wall),
      key: wall.uuid,
    };
  });
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.38, 24),
    new THREE.MeshBasicMaterial(),
  );
  floor.position.set(0, -0.19, 0);
  floor.updateMatrixWorld(true);
  const floorEntry = {
    object: floor,
    owner: floor,
    wallSurface: false,
    surfaceClass: 'walkable',
  };
  const floorRecord = {
    entry: floorEntry,
    instanceId: null,
    bounds: new THREE.Box3().setFromObject(floor),
    key: floor.uuid,
  };
  const records = [...wallRecords, floorRecord];
  const bins = new Map();
  for (let binX = -1; binX <= 0; binX += 1) {
    for (let binZ = -2; binZ <= 1; binZ += 1) {
      bins.set(`${binX},${binZ}`, records);
    }
  }

  const game = Object.create(Game.prototype);
  game.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  game.camera.position.set(0, 2, 10);
  game.camera.lookAt(0, 1.25, -12);
  game.camera.updateMatrixWorld(true);
  game.player = { root: new THREE.Object3D() };
  game.player.root.position.set(0, 0, -12);
  game.cameraOcclusionRaycaster = new THREE.Raycaster();
  game.cameraOcclusionWallProximityBins = bins;
  game.cameraOcclusionWallProximityCandidateKeys = new Set();
  game.cameraOcclusionExpandedVerticalRecordKeys = new Set();
  game.cameraOcclusionForwardVerticalHits = [];
  game.cameraOcclusionHiddenInstances = [];
  game.cameraOcclusionHiddenInstanceKeys = new Set();
  game.cameraOcclusionHiddenOwners = new Set();

  game._hideCameraForwardArchitecture();

  assert.deepEqual(wallRecords.map(({ entry }) => entry.owner.visible), [false, false, false]);
  assert.equal(game.cameraOcclusionExpandedVerticalRecordKeys.size, 3);
  assert.equal(floor.visible, true);
  assert.equal(game.cameraOcclusionHiddenOwners.has(floor), false);
});

test('camera visibility corridor clears all vertical panels across the viewport', () => {
  const wallRecords = [-8, 0, 8].map((x, index) => {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(2, 6, 0.3),
      new THREE.MeshBasicMaterial(),
    );
    wall.name = `wideCameraOcclusionPanel${index}`;
    wall.position.set(x, 2, 0);
    wall.updateMatrixWorld(true);
    const entry = {
      object: wall,
      owner: wall,
      wallSurface: true,
      surfaceClass: 'wall',
    };
    return {
      entry,
      instanceId: null,
      bounds: new THREE.Box3().setFromObject(wall),
      key: wall.uuid,
    };
  });
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(24, 0.38, 24),
    new THREE.MeshBasicMaterial(),
  );
  floor.position.set(0, -0.19, 0);
  floor.updateMatrixWorld(true);
  const floorEntry = {
    object: floor,
    owner: floor,
    wallSurface: false,
    surfaceClass: 'walkable',
  };
  const floorRecord = {
    entry: floorEntry,
    instanceId: null,
    bounds: new THREE.Box3().setFromObject(floor),
    key: floor.uuid,
  };
  const records = [...wallRecords, floorRecord];
  const bins = new Map();
  for (let binX = -2; binX <= 1; binX += 1) {
    for (let binZ = -2; binZ <= 1; binZ += 1) {
      bins.set(`${binX},${binZ}`, records);
    }
  }

  const game = Object.create(Game.prototype);
  game.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  game.camera.position.set(0, 2, 10);
  game.camera.lookAt(0, 1.25, -12);
  game.camera.updateProjectionMatrix();
  game.camera.updateMatrixWorld(true);
  game.player = { root: new THREE.Object3D() };
  game.player.root.position.set(0, 0, -12);
  game.cameraOcclusionWallProximityBins = bins;
  game.cameraOcclusionWallProximityCandidateKeys = new Set();
  game.cameraOcclusionHiddenInstances = [];
  game.cameraOcclusionHiddenInstanceKeys = new Set();
  game.cameraOcclusionHiddenOwners = new Set();

  game._hideCameraInterveningVerticalArchitecture();

  assert.deepEqual(wallRecords.map(({ entry }) => entry.owner.visible), [false, false, false]);
  assert.equal(floor.visible, true);
  assert.equal(game.cameraOcclusionHiddenOwners.has(floor), false);
});

test('camera visibility corridor clears thick floor support faces without hiding lower floors', () => {
  const supportRecords = [-4, 0, 4].map((x, index) => {
    const support = new THREE.Mesh(
      new THREE.BoxGeometry(2.83, 3.2, 2.83),
      new THREE.MeshBasicMaterial(),
    );
    support.name = `magmaOpeningFloorSupport${index}`;
    support.position.set(x, -1.6, 0);
    support.updateMatrixWorld(true);
    const entry = {
      object: support,
      owner: support,
      wallSurface: false,
      surfaceClass: 'walkable',
    };
    return {
      entry,
      instanceId: null,
      bounds: new THREE.Box3().setFromObject(support),
      key: support.uuid,
    };
  });
  const lowerFloor = new THREE.Mesh(
    new THREE.BoxGeometry(24, 0.38, 24),
    new THREE.MeshBasicMaterial(),
  );
  lowerFloor.position.set(0, -4.99, 0);
  lowerFloor.updateMatrixWorld(true);
  const lowerFloorEntry = {
    object: lowerFloor,
    owner: lowerFloor,
    wallSurface: false,
    surfaceClass: 'walkable',
  };
  const lowerFloorRecord = {
    entry: lowerFloorEntry,
    instanceId: null,
    bounds: new THREE.Box3().setFromObject(lowerFloor),
    key: lowerFloor.uuid,
  };
  const sidewaysMass = new THREE.Mesh(
    new THREE.BoxGeometry(14, 3.2, 2.8),
    new THREE.MeshBasicMaterial(),
  );
  sidewaysMass.position.set(-16, -1.6, 0);
  sidewaysMass.updateMatrixWorld(true);
  const sidewaysEntry = {
    object: sidewaysMass,
    owner: sidewaysMass,
    wallSurface: false,
    surfaceClass: 'architecture',
  };
  const sidewaysRecord = {
    entry: sidewaysEntry,
    instanceId: null,
    bounds: new THREE.Box3().setFromObject(sidewaysMass),
    key: sidewaysMass.uuid,
  };
  const records = [...supportRecords, lowerFloorRecord, sidewaysRecord];
  const bins = new Map();
  for (let binX = -2; binX <= 1; binX += 1) {
    for (let binZ = -2; binZ <= 1; binZ += 1) {
      bins.set(`${binX},${binZ}`, records);
    }
  }

  const game = Object.create(Game.prototype);
  game.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  game.camera.position.set(0, -1.2, 10);
  game.camera.lookAt(0, -1.55, -12);
  game.camera.updateProjectionMatrix();
  game.camera.updateMatrixWorld(true);
  game.player = { root: new THREE.Object3D() };
  game.player.root.position.set(0, -2.8, -12);
  game.cameraOcclusionWallProximityBins = bins;
  game.cameraOcclusionWallProximityCandidateKeys = new Set();
  game.cameraOcclusionHiddenInstances = [];
  game.cameraOcclusionHiddenInstanceKeys = new Set();
  game.cameraOcclusionHiddenOwners = new Set();

  game._hideCameraInterveningVerticalArchitecture();

  assert.deepEqual(
    supportRecords.map(({ entry }) => entry.owner.visible),
    [false, false, false],
  );
  assert.equal(lowerFloor.visible, true);
  assert.equal(game.cameraOcclusionHiddenOwners.has(lowerFloor), false);
  assert.equal(sidewaysMass.visible, true);
  assert.equal(game.cameraOcclusionHiddenOwners.has(sidewaysMass), false);
});

test('Old Drill is a persistent unique physical part required by the Drill Arm recipe', () => {
  const material = REAVERBOT_SALVAGE_MATERIALS[OLD_DRILL_ITEM_ID];
  const recipe = getEquipmentRecipeDefinition('drillArm');
  assert.equal(material.name, 'Old Drill');
  assert.equal(material.tier, 'unique');
  assert.equal(recipe.requiredPartIds.includes(OLD_DRILL_ITEM_ID), true);

  const storage = new RollSalvageStorage();
  storage.addPart(material, 1, {
    chestId: OLD_DRILL_CHEST_ID,
    persistenceKey: 'oldDrillClaimed',
  });
  const serialized = storage.serialize();
  const restored = new RollSalvageStorage(serialized);
  assert.equal(restored.getPartCount(OLD_DRILL_ITEM_ID), 1);
  assert.equal(restored.hasDiscoveredPart(OLD_DRILL_ITEM_ID), true);
  assert.equal(restored.getDiscoveryHistory().at(-1).source.persistenceKey, 'oldDrillClaimed');

  const plan = createMagmaLinearDiggerExcavationPlan({ seed: 'old-drill' });
  const dungeon = assembleMagmaLinearDiggerExcavationRoom(plan, {
    textureLoader: new StubTextureLoader(),
  });
  const chest = dungeon.chests.find((candidate) => candidate.id === OLD_DRILL_CHEST_ID);
  assert.ok(chest);
  assert.equal(chest.rewardPartId, OLD_DRILL_ITEM_ID);
  assert.equal(chest.rewardPersistenceKey, 'oldDrillClaimed');
  assert.equal(chest.encounterLocked, false);
  assert.equal(chest.position.y, 0);
});
