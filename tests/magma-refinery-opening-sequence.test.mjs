import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  generateMagmaRefineryOpeningSequence,
  MAGMA_REFINERY_OPENING_SEQUENCE_ID,
} from '../src/magma/MagmaRefineryOpeningSequence.js';

class StubTextureLoader {
  load(url) {
    const texture = new THREE.Texture();
    texture.name = url;
    return texture;
  }
}

test('approved Magma opening and excavation maps share one exact player and lava seam', () => {
  const dungeon = generateMagmaRefineryOpeningSequence({
    seed: 'combined-seam',
    textureLoader: new StubTextureLoader(),
  });

  assert.equal(dungeon.dungeonKind, 'magmaRefineryOpeningSequenceDevelopmentFixture');
  assert.deepEqual(dungeon.roomModuleIds, [
    'magma-breached-freight-adit',
    'magma-linear-digger-excavation',
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
  assert.equal(dungeon.connectionPlans.length, 1);
  assert.equal(dungeon.connectionPlans[0].clearWidthMeters, 8.4);

  const floorKeys = dungeon.floorTiles.map((tile) => `${tile.x},${tile.z}@${tile.elevation}`);
  assert.equal(new Set(floorKeys).size, floorKeys.length, 'the joined threshold contains stacked floor tiles');
  for (const x of [8, 9, 10]) {
    assert.ok(dungeon.floorTiles.find((tile) => (
      tile.x === x && tile.z === -12 && tile.elevation === 0 && tile.surface !== 'deepMagma'
    )));
    assert.ok(dungeon.floorTiles.find((tile) => (
      tile.x === x && tile.z === -13 && tile.elevation === 0 && tile.surface !== 'deepMagma'
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
  assert.deepEqual(openingRoom.previewAnchors.excavationThreshold, {
    x: 9,
    y: 0,
    z: -11,
    facingX: 0,
    facingZ: -1,
  });
  assert.deepEqual({ x: linearRoom.x, z: linearRoom.z }, { x: 9, z: -29 });

  dungeon.group.updateMatrixWorld(true);
  const oldDrillChest = dungeon.chests.find((chest) => (
    chest.id === 'magma-linear-excavation-old-drill-chest'
  ));
  const chestWorldPosition = oldDrillChest.object.getWorldPosition(new THREE.Vector3());
  assert.equal(chestWorldPosition.distanceTo(oldDrillChest.position) < 0.001, true);
  assert.equal(dungeon.environmentalHazards.length, 1);
  assert.equal(dungeon.environmentalHazards[0].continuityTag, 'magma-refinery-lava-spine');
  assert.equal(dungeon.supportDiagnostics.supportDatumViolationCount, 0);
  assert.equal(dungeon.moduleManifestDiagnostics.untexturedVoidCellCount, 0);
});
