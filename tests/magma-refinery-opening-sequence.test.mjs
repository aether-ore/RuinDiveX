import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  generateMagmaRefineryOpeningSequence,
  MAGMA_REFINERY_OPENING_SEQUENCE_ID,
} from '../src/magma/MagmaRefineryOpeningSequence.js';
import { CRITICAL_CATWALK_RISE } from '../src/magma/MagmaLinearDiggerExcavationRoom.js';
import { PLAYER_TRAVERSAL_ENVELOPE } from '../src/TraversalCapabilities.js';

class StubTextureLoader {
  load(url) {
    const texture = new THREE.Texture();
    texture.name = url;
    return texture;
  }
}

function pointInsideSolidZone(point, zone) {
  let localX = point.x - zone.position.x;
  let localZ = point.z - zone.position.z;
  if (Number.isFinite(zone.rotationY) && Math.abs(zone.rotationY) > 0.0001) {
    const cos = Math.cos(zone.rotationY);
    const sin = Math.sin(zone.rotationY);
    [localX, localZ] = [localX * cos + localZ * sin, -localX * sin + localZ * cos];
  }
  const padding = Number(zone.playerCollisionPadding ?? 0);
  return Math.abs(localX) <= zone.halfWidth + padding
    && Math.abs(localZ) <= zone.halfDepth + padding
    && (!Number.isFinite(zone.verticalHalfHeight)
      || Math.abs(point.y - zone.position.y) <= zone.verticalHalfHeight);
}

function floorTileKey(tile) {
  return `${tile.x},${tile.z}@${Number(tile.elevation).toFixed(6)}`;
}

function collectSafeFloorsReachableFromPlayerStart(dungeon) {
  const safeFloors = dungeon.floorTiles.filter((tile) => tile.surface !== 'deepMagma');
  const byColumn = new Map();
  for (const tile of safeFloors) {
    const key = `${tile.x},${tile.z}`;
    const column = byColumn.get(key) ?? [];
    column.push(tile);
    byColumn.set(key, column);
  }
  const startX = Math.round(dungeon.playerStart.x / dungeon.tileSize);
  const startZ = Math.round(dungeon.playerStart.z / dungeon.tileSize);
  const start = (byColumn.get(`${startX},${startZ}`) ?? []).find((tile) => (
    Math.abs(tile.elevation - dungeon.playerStart.y) < 0.01
  ));
  assert.ok(start, 'combined sequence player start has no safe floor tile');

  const queue = [start];
  const reachable = new Set([floorTileKey(start)]);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const candidate of byColumn.get(`${current.x + dx},${current.z + dz}`) ?? []) {
        if (Math.abs(candidate.elevation - current.elevation)
          > Math.max(PLAYER_TRAVERSAL_ENVELOPE.maximumRampRisePerTile, CRITICAL_CATWALK_RISE) + 0.02) continue;
        const key = floorTileKey(candidate);
        if (reachable.has(key)) continue;
        reachable.add(key);
        queue.push(candidate);
      }
    }
  }
  return { safeFloors, reachable };
}

test('approved Magma opening, excavation, and Assay Lab share exact player and lava seams', () => {
  const dungeon = generateMagmaRefineryOpeningSequence({
    seed: 'combined-seam',
    textureLoader: new StubTextureLoader(),
  });

  assert.equal(dungeon.dungeonKind, 'magmaRefineryOpeningSequenceDevelopmentFixture');
  assert.deepEqual(dungeon.roomModuleIds, [
    'magma-breached-freight-adit',
    'magma-linear-digger-excavation',
    'magma-refractor-assay-lab',
  ]);
  assert.equal(dungeon.moduleManifestDiagnostics.moduleId, MAGMA_REFINERY_OPENING_SEQUENCE_ID);
  assert.equal(dungeon.moduleManifestDiagnostics.sequenceSocketAlignment.accepted, true);
  assert.deepEqual(dungeon.moduleManifestDiagnostics.sequenceSocketAlignment.player, {
    sourceSocketId: 'opening-deeper-socket',
    destinationSocketId: 'linear-excavation-entry-socket',
    centerOffsetMeters: 0,
    elevationOffsetMeters: 0,
    widthOffsetMeters: 0,
    facingDot: -1,
    accepted: true,
  });
  assert.equal(dungeon.moduleManifestDiagnostics.sequenceSocketAlignment.lava.accepted, true);
  assert.deepEqual(dungeon.moduleManifestDiagnostics.sequenceSocketAlignment.assayPlayer, {
    sourceSocketId: 'linear-excavation-assay-socket',
    destinationSocketId: 'assay-lab-entry-socket',
    centerOffsetMeters: 0,
    elevationOffsetMeters: 0,
    widthOffsetMeters: 0,
    facingDot: -1,
    accepted: true,
  });
  assert.equal(dungeon.moduleManifestDiagnostics.sequenceSocketAlignment.assayLava.accepted, true);
  assert.equal(dungeon.connectionPlans.length, 2);
  assert.equal(dungeon.connectionPlans[0].clearWidthMeters, 8.4);
  assert.equal(dungeon.connectionPlans[1].clearWidthMeters, 8.4);
  assert.equal(dungeon.connectionPlans[1].sourceElevation, -14);
  assert.equal(dungeon.criticalCatwalk.length, 11);
  assert.equal(dungeon.criticalCatwalk.every((segment) => (
    Math.min(segment.widthTiles, segment.depthTiles) >= 3
  )), true);
  assert.equal(dungeon.criticalCatwalkCells.length > 200, true);
  for (const cell of dungeon.criticalCatwalkCells) {
    const center = new THREE.Vector3(
      cell.x * dungeon.tileSize,
      cell.elevation + 0.9,
      cell.z * dungeon.tileSize,
    );
    assert.deepEqual(
      dungeon.solidZones.filter((zone) => pointInsideSolidZone(center, zone)).map((zone) => zone.id),
      [],
      `combined critical catwalk cell ${cell.x},${cell.z}@${cell.elevation} is obstructed`,
    );
  }

  const floorKeys = dungeon.floorTiles.map((tile) => `${tile.x},${tile.z}@${tile.elevation}`);
  assert.equal(new Set(floorKeys).size, floorKeys.length, 'the joined threshold contains stacked floor tiles');
  const safeFloorConnectivity = collectSafeFloorsReachableFromPlayerStart(dungeon);
  assert.equal(
    safeFloorConnectivity.reachable.size,
    safeFloorConnectivity.safeFloors.length,
    'every non-magma floor tile must belong to the player-start component',
  );
  for (const x of [8, 9, 10]) {
    assert.ok(dungeon.floorTiles.find((tile) => (
      tile.x === x && tile.z === -12
        && Math.abs(tile.elevation - CRITICAL_CATWALK_RISE * 0.25) < 0.001
        && tile.rampRouteId === 'critical-catwalk-entry-rise'
    )));
    assert.ok(dungeon.floorTiles.find((tile) => (
      tile.x === x && tile.z === -13
        && Math.abs(tile.elevation - CRITICAL_CATWALK_RISE * 0.75) < 0.001
        && tile.rampRouteId === 'critical-catwalk-entry-rise'
    )));
  }

  assert.equal(dungeon.group.getObjectByName('ancientFreightTunnelPreviewCap'), undefined);
  const retiredShellObjects = [];
  dungeon.group.traverse((object) => {
    if (/CavernBackdrop|cavernBackdrop/i.test(object.name)) retiredShellObjects.push(object.name);
  });
  assert.deepEqual(retiredShellObjects, []);
  assert.equal(
    dungeon.group.getObjectByName('linear-excavation-entry-socket-frameOcclusionOwner'),
    undefined,
  );
  assert.equal(
    dungeon.solidZones.some((zone) => /ancientFreightTunnelPreviewCap|linear-excavation-entry-socket-frame/.test(zone.id)),
    false,
  );
  assert.equal(dungeon.solidZones.some((zone) => (
    /cavernBackdrop/i.test(zone.id)
      || /cavernBackdrop/i.test(zone.obstacleKind)
  )), false, 'no retired shell collision may survive map assembly');
  assert.equal(dungeon.aerialBoundaryZones.some((zone) => (
    /cavernBackdrop/i.test(zone.id)
      || /cavernBackdrop/i.test(zone.obstacleKind)
  )), false, 'no retired shell aerial collision may survive map assembly');

  const thresholdX = 9 * dungeon.tileSize;
  const thresholdZ = -12.5 * dungeon.tileSize;
  const thresholdBlockers = dungeon.solidZones.filter((zone) => (
    Math.abs(thresholdX - zone.position.x) <= zone.halfWidth
      && Math.abs(thresholdZ - zone.position.z) <= zone.halfDepth
      && zone.position.y - zone.verticalHalfHeight < 1.2
      && zone.position.y + zone.verticalHalfHeight > 0
  ));
  assert.deepEqual(thresholdBlockers, []);

  const openingRoom = dungeon.rooms.find((room) => room.id === 'magma-breached-freight-adit');
  const linearRoom = dungeon.rooms.find((room) => room.id === 'magma-linear-digger-excavation');
  const assayRoom = dungeon.rooms.find((room) => room.id === 'magma-refractor-assay-lab');
  assert.deepEqual(openingRoom.previewAnchors.excavationThreshold, {
    x: 9,
    y: 0,
    z: -11,
    facingX: 0,
    facingZ: -1,
  });
  assert.deepEqual(openingRoom.previewAnchors.linearFlightBDescent, {
    x: 11,
    y: -12.352308,
    z: -51,
    facingX: 1,
    facingZ: 0,
  });
  assert.deepEqual(openingRoom.previewAnchors.linearFlightBEndLanding, {
    x: 14,
    y: -13.16,
    z: -51,
    facingX: 1,
    facingZ: 0,
  });
  assert.deepEqual(openingRoom.previewAnchors.assaySmelterSeal, {
    x: 9,
    y: -16.8,
    z: -65,
    facingX: -1,
    facingZ: 0,
  });
  assert.deepEqual(openingRoom.previewAnchors.assayBulkhead, {
    x: 17,
    y: -14,
    z: -84,
    facingX: 0,
    facingZ: -1,
  });
  assert.deepEqual(openingRoom.previewAnchors.assayEntryDescentStart, {
    x: 22,
    y: -14,
    z: -57,
    facingX: 0,
    facingZ: -1,
  });
  assert.deepEqual(openingRoom.previewAnchors.assayGalleryReturnStart, {
    x: 11,
    y: -11.2,
    z: -76,
    facingX: 0,
    facingZ: -1,
  });
  assert.deepEqual({ x: linearRoom.x, z: linearRoom.z }, { x: 9, z: -29 });
  assert.deepEqual({ x: assayRoom.x, z: assayRoom.z }, { x: 5, z: -66 });

  const assayThresholdX = 17 * dungeon.tileSize;
  const assayThresholdZ = -46.5 * dungeon.tileSize;
  const assayThresholdBlockers = dungeon.solidZones.filter((zone) => (
    Math.abs(assayThresholdX - zone.position.x) <= zone.halfWidth
      && Math.abs(assayThresholdZ - zone.position.z) <= zone.halfDepth
      && zone.position.y - zone.verticalHalfHeight < -12.8
      && zone.position.y + zone.verticalHalfHeight > -14
  ));
  assert.deepEqual(assayThresholdBlockers, [], 'Linear-to-Assay player socket is obstructed');

  // The Assay approach overlaps the final three-wide Digger landing. The
  // standalone Assay west wall must be omitted across all three ramp lanes so
  // both its visible panels and matching collision leave a full-width opening.
  for (const z of [-52, -51, -50]) {
    const rampExitBlockers = new Set();
    for (let x = 11.5; x <= 13.5; x += 0.035) {
      const point = new THREE.Vector3(x * dungeon.tileSize, -13.16, z * dungeon.tileSize);
      for (const zone of dungeon.solidZones) {
        if (pointInsideSolidZone(point, zone)) rampExitBlockers.add(zone.id);
      }
    }
    assert.deepEqual(
      [...rampExitBlockers],
      [],
      `Linear flight B lane z=${z} is obstructed before its end landing`,
    );
  }
  for (const z of [-52, -51, -50]) {
    const endLandingBlockers = new Set();
    for (let x = 13.5; x <= 18.25; x += 0.035) {
      const point = new THREE.Vector3(x * dungeon.tileSize, -13.16, z * dungeon.tileSize);
      for (const zone of dungeon.solidZones) {
        if (pointInsideSolidZone(point, zone)) endLandingBlockers.add(zone.id);
      }
    }
    assert.deepEqual(
      [...endLandingBlockers],
      [],
      `Linear flight B end landing lane z=${z} is obstructed before the Assay threshold`,
    );
  }

  // Sweep the complete combined Linear descent, not only its end landing.
  // The Assay lava-inlet shell overlaps the middle of this transformed ramp,
  // so a standalone-room or end-anchor check cannot detect this regression.
  const transformedLinearRamps = dungeon.floorTiles.filter((tile) => (
    tile.roomId === 'magma-linear-digger-excavation' && tile.surfaceRole === 'ramp'
  ));
  for (const tile of transformedLinearRamps) {
    for (let sample = 0; sample <= 14; sample += 1) {
      const progress = sample / 14;
      const point = new THREE.Vector3(
        (tile.x + tile.rampDirectionX * (progress - 0.5)) * dungeon.tileSize,
        THREE.MathUtils.lerp(tile.rampStartElevation, tile.rampEndElevation, progress),
        (tile.z + tile.rampDirectionZ * (progress - 0.5)) * dungeon.tileSize,
      );
      const blockers = dungeon.solidZones.filter((zone) => pointInsideSolidZone(point, zone));
      assert.deepEqual(
        blockers.map((zone) => zone.id),
        [],
        `combined ${tile.rampRouteId} lane ${tile.x},${tile.z} is obstructed`,
      );
    }
  }

  const transformedAssayRamps = dungeon.floorTiles.filter((tile) => (
    tile.roomId === 'magma-refractor-assay-lab' && tile.surfaceRole === 'ramp'
  ));
  for (const tile of transformedAssayRamps) {
    for (let sample = 0; sample <= 14; sample += 1) {
      const progress = sample / 14;
      const point = new THREE.Vector3(
        (tile.x + tile.rampDirectionX * (progress - 0.5)) * dungeon.tileSize,
        THREE.MathUtils.lerp(tile.rampStartElevation, tile.rampEndElevation, progress),
        (tile.z + tile.rampDirectionZ * (progress - 0.5)) * dungeon.tileSize,
      );
      const blockers = dungeon.solidZones.filter((zone) => pointInsideSolidZone(point, zone));
      assert.deepEqual(
        blockers.map((zone) => zone.id),
        [],
        `combined ${tile.rampRouteId} lane ${tile.x},${tile.z} is obstructed`,
      );
    }
  }

  dungeon.group.updateMatrixWorld(true);
  const oldDrillChest = dungeon.chests.find((chest) => (
    chest.id === 'magma-linear-excavation-old-drill-chest'
  ));
  const chestWorldPosition = oldDrillChest.object.getWorldPosition(new THREE.Vector3());
  assert.equal(chestWorldPosition.distanceTo(oldDrillChest.position) < 0.001, true);
  const smelterSeal = dungeon.keycards.find((keycard) => keycard.keycardId === 'Smelter_Seal');
  const bulkhead = dungeon.doors.find((door) => door.id === 'Door_Smelter_Bulkhead');
  assert.ok(smelterSeal);
  assert.ok(bulkhead);
  assert.equal(smelterSeal.protectedByEncounterId, null);
  assert.deepEqual(smelterSeal.opensDoorIdsOnCollect, ['Door_Smelter_Bulkhead']);
  assert.equal(bulkhead.requiredKeycardId, 'Smelter_Seal');
  const sealWorldPosition = smelterSeal.object.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(sealWorldPosition.x - smelterSeal.position.x) < 0.001);
  assert.ok(Math.abs(sealWorldPosition.z - smelterSeal.position.z) < 0.001);
  const bulkheadWorldPosition = bulkhead.object.getWorldPosition(new THREE.Vector3());
  assert.equal(bulkheadWorldPosition.distanceTo(bulkhead.position) < 0.001, true);
  assert.equal(dungeon.environmentalHazards.length, 1);
  assert.equal(dungeon.environmentalHazards[0].continuityTag, 'magma-refinery-lava-spine');
  assert.equal(dungeon.environmentalHazards[0].heatResistantMovementMultiplier, 0.8);
  assert.equal('heatResistMovementMultiplier' in dungeon.environmentalHazards[0], false);
  assert.equal(dungeon.supportDiagnostics.supportDatumViolationCount, 0);
  assert.equal(dungeon.moduleManifestDiagnostics.untexturedVoidCellCount, 0);
  assert.equal(dungeon.spatialGenerationDiagnostics.roomCount, 3);
});
