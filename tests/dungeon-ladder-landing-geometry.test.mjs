import assert from 'node:assert/strict';
import test from 'node:test';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  DUNGEON_CONNECTOR_VARIANT_IDS,
  createDungeonConnectorVariantContract,
} from '../src/DungeonConnectorVariants.js';

const TILE_SIZE = 2.8;

function createMinimumLadderPlan() {
  const bridgePath = Array.from({ length: 11 }, (_, x) => ({ x, z: 0 }));
  const plan = {
    id: 'minimum-safe-ladder-gallery',
    logicalConnectionId: 'room-a_room-b',
    fromRoomId: 'room-a',
    toRoomId: 'room-b',
    connectorType: 'ground_corridor',
    level: 0,
    elevation: 0,
    fullPath: bridgePath.map((point) => ({ ...point })),
    bridgePath: bridgePath.map((point) => ({ ...point })),
    connectorVariantConstraints: {
      roomFootprints: [],
      endpointFlatBufferTiles: 2,
    },
    fromSocket: { id: 'room-a-exit', x: 0, z: 0 },
    toSocket: { id: 'room-b-entrance', x: 10, z: 0 },
  };
  plan.connectorVariant = createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    { tileSize: TILE_SIZE },
  );
  plan.connectorVariantId = DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY;
  return plan;
}

function uniqueProjectionCount(tiles, direction) {
  return new Set(tiles.map((tile) => (
    tile.x * direction.x + tile.z * direction.z
  ))).size;
}

test('minimum safe ladder span realizes clear 2x2 landings and uncovered apertures', () => {
  const plan = createMinimumLadderPlan();
  const mechanismIndexes = plan.connectorVariant.mechanisms.map(({ pathIndex }) => pathIndex);
  assert.deepEqual(mechanismIndexes, [3, 7]);
  assert.equal(mechanismIndexes[1] - mechanismIndexes[0], 4);

  const tiles = new Map(plan.bridgePath.map((point) => [
    `${point.x},${point.z}`,
    { ...point, type: 'hallway', elevation: 0, level: 0 },
  ]));
  // A room-owned column on one side proves widening selects the free side
  // instead of mutating an authored room footprint.
  const authoredRoomTile = {
    x: 3,
    z: 1,
    type: 'floor',
    elevation: 0,
    level: 0,
    roomId: 'authored-room-sentinel',
  };
  tiles.set('3,1', authoredRoomTile);
  const floorTiles = [...tiles.values()];
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });

  generator._applyConnectorTraversalSurfaces(tiles, [plan], floorTiles);

  assert.equal(plan.ladderContracts.length, 2);
  for (const ladder of plan.ladderContracts) {
    assert.equal(ladder.caged, true);
    assert.equal(ladder.landingWidthTiles, 2);
    assert.equal(ladder.landingDepthTiles, 2);
    assert.equal(ladder.landingWidthMeters, TILE_SIZE * 2);
    assert.equal(ladder.landingDepthMeters, TILE_SIZE * 2);
    assert.equal(ladder.bottomMountPosition.distanceTo(ladder.bottomExit), 0);
    assert.equal(ladder.topMountPosition.distanceTo(ladder.topExit), 0);

    const facing = { x: ladder.facing.x, z: ladder.facing.z };
    const tangent = { x: -facing.z, z: facing.x };
    for (const [endpoint, landingTiles] of [
      ['bottom', ladder.bottomLandingTiles],
      ['top', ladder.topLandingTiles],
    ]) {
      assert.equal(landingTiles.length, 4, `${endpoint} landing must own four physical tiles`);
      assert.equal(new Set(landingTiles.map(({ floorKey }) => floorKey)).size, 4);
      assert.equal(uniqueProjectionCount(landingTiles, facing), 2);
      assert.equal(uniqueProjectionCount(landingTiles, tangent), 2);
      for (const landingTile of landingTiles) {
        const physicalTile = floorTiles.find((candidate) => (
          candidate.x === landingTile.x
          && candidate.z === landingTile.z
          && Math.abs((candidate.elevation ?? 0) - landingTile.elevation) <= 0.05
        ));
        assert.ok(physicalTile, `${endpoint} landing tile must exist in the collision/render floor list`);
        assert.ok(
          tiles.has(`${landingTile.x},${landingTile.z}`),
          `${endpoint} landing tile must also extend the enclosed structural shell`,
        );
        assert.equal(physicalTile.connectorId, plan.id);
        assert.equal(physicalTile.noEnemySpawn, true);
        assert.equal(physicalTile.roomId ?? null, null);
      }
    }

    const coveringTiles = floorTiles.filter((candidate) => (
      candidate.x === ladder.apertureGridPoint.x
      && candidate.z === ladder.apertureGridPoint.z
      && (candidate.elevation ?? 0) > ladder.bottomY + 0.05
    ));
    assert.deepEqual(coveringTiles, [], 'no elevated floor tile may cover a ladder aperture');
  }

  assert.equal(tiles.get('3,1'), authoredRoomTile);
  assert.equal(authoredRoomTile.roomId, 'authored-room-sentinel');
  assert.equal(authoredRoomTile.connectorId, undefined);
});
