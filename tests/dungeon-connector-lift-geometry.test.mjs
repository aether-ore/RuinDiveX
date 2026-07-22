import assert from 'node:assert/strict';
import test from 'node:test';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  DUNGEON_CONNECTOR_VARIANT_IDS,
  createDungeonConnectorVariantContract,
} from '../src/DungeonConnectorVariants.js';

const TILE_SIZE = 2.8;

function createMinimumLiftPlan() {
  const bridgePath = Array.from({ length: 11 }, (_, x) => ({ x, z: 0 }));
  const plan = {
    id: 'minimum-safe-lift-gallery',
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
    DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
    { tileSize: TILE_SIZE },
  );
  plan.connectorVariantId = DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT;
  return plan;
}

test('automatic lift realizes enclosed side landings, recall anchors, and a clear shaft', () => {
  const plan = createMinimumLiftPlan();
  const tiles = new Map(plan.bridgePath.map((point) => [
    `${point.x},${point.z}`,
    { ...point, type: 'hallway', elevation: 0, level: 0 },
  ]));
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  generator._addConnectorExplorationSpaces(tiles, [], [plan]);
  const floorTiles = [...tiles.values()];

  generator._applyConnectorTraversalSurfaces(tiles, [plan], floorTiles);

  assert.equal(plan.liftContracts.length, 1);
  const lift = plan.liftContracts[0];
  assert.equal(lift.automatic, true);
  assert.equal(lift.requiresConsole, false);
  assert.equal(lift.landingWidthTiles, 2);
  assert.equal(lift.landingDepthTiles, 2);
  assert.equal(lift.bottomLandingTiles.length, 4);
  assert.equal(lift.topLandingTiles.length, 4);
  assert.ok(lift.shaftHeadroomMeters >= lift.riderClearanceMeters);
  assert.ok(
    lift.platformWidthMeters * 0.5 + 0.13 < lift.shaftWidthMeters * 0.5,
    'guide posts must remain inside the physical shaft',
  );
  const travelColumns = new Set((plan.galleryCrossSections ?? []).flatMap((crossSection) => (
    (crossSection.sections ?? []).flatMap((section) => (
      [section.center, ...(section.lateralPoints ?? [])]
        .map((point) => `${point.x},${point.z}`)
    ))
  )));

  for (const [endpoint, landingTiles] of [
    ['bottom', lift.bottomLandingTiles],
    ['top', lift.topLandingTiles],
  ]) {
    assert.equal(new Set(landingTiles.map(({ floorKey }) => floorKey)).size, 4);
    for (const landing of landingTiles) {
      assert.ok(tiles.has(`${landing.x},${landing.z}`), `${endpoint} landing must extend the shell`);
      assert.ok(floorTiles.some((tile) => (
        tile.x === landing.x
        && tile.z === landing.z
        && Math.abs((tile.elevation ?? 0) - landing.elevation) <= 0.05
      )), `${endpoint} landing must have matching render/collision floor geometry`);
    }
    const control = lift.controlAnchors[endpoint];
    assert.ok(control?.position);
    assert.equal(
      landingTiles.some(({ floorKey }) => floorKey === control.floorKey),
      false,
      `${endpoint} control must sit beside, not on, the lift landing`,
    );
    const controlTile = floorTiles.find((tile) => (
      generator._getFloorTileGraphKey(tile) === control.floorKey
    ));
    assert.ok(controlTile, `${endpoint} control needs its own physical alcove floor`);
    assert.equal(
      travelColumns.has(`${controlTile.x},${controlTile.z}`),
      false,
      `${endpoint} control alcove must not block any three-lane gallery column`,
    );
  }

  assert.equal(floorTiles.some((tile) => (
    tile.x === lift.gridPoint.x
    && tile.z === lift.gridPoint.z
    && (tile.elevation ?? 0) > lift.bottomElevation + 0.05
  )), false, 'the moving platform shaft must not be capped by an upper floor');

  const validation = generator._validateConnectorTraversalAssembly({
    floorTiles,
    tiles,
    rooms: [],
    connectionPlans: [plan],
  });
  assert.equal(validation.accepted, true, validation.errors.join('\n'));
});
