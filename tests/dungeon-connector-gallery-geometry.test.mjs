import assert from 'node:assert/strict';
import test from 'node:test';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  DUNGEON_CONNECTOR_VARIANT_IDS,
  createDungeonConnectorVariantContract,
} from '../src/DungeonConnectorVariants.js';

const TILE_SIZE = 2.8;
const INTERIOR_ROOMS = [
  { id: 'room-a', type: 'entrance', x: -40, z: 0, width: 3, depth: 3 },
  { id: 'room-b', type: 'boss', x: 40, z: 0, width: 3, depth: 3 },
];

function createStraightPlan(variantId) {
  const bridgePath = Array.from({ length: 11 }, (_, x) => ({ x, z: 0 }));
  const plan = {
    id: `wide-${variantId}`,
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
    fromSocket: { id: 'room-a-exit', x: 0, z: 0, elevation: 0 },
    toSocket: { id: 'room-b-entrance', x: 10, z: 0, elevation: 0 },
  };
  plan.connectorVariant = createDungeonConnectorVariantContract(plan, variantId, { tileSize: TILE_SIZE });
  plan.connectorVariantId = variantId;
  return plan;
}

function realizePlan(plan) {
  const tiles = new Map(plan.bridgePath.map((point) => [
    `${point.x},${point.z}`,
    { ...point, type: 'hallway', elevation: 0, level: 0 },
  ]));
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  generator._addConnectorExplorationSpaces(tiles, INTERIOR_ROOMS, [plan]);
  const floorTiles = [...tiles.values()];
  generator._applyConnectorTraversalSurfaces(tiles, [plan], floorTiles);
  return { generator, tiles, floorTiles };
}

function commonCrossSectionWidth(section, floorTiles) {
  const points = [section.center, ...(section.lateralPoints ?? [])];
  const centerFloors = floorTiles.filter((floor) => (
    floor.x === section.center.x && floor.z === section.center.z
  ));
  return centerFloors.some((centerFloor) => points.every((point) => (
    floorTiles.some((floor) => (
      floor.x === point.x
      && floor.z === point.z
      && Math.abs((floor.elevation ?? 0) - (centerFloor.elevation ?? 0)) <= 0.05
    ))
  ))) ? points.length : 0;
}

for (const variantId of Object.values(DUNGEON_CONNECTOR_VARIANT_IDS)) {
  test(`${variantId} realizes a continuous three-tile gallery with V1 arches`, () => {
    const plan = createStraightPlan(variantId);
    const { generator, tiles, floorTiles } = realizePlan(plan);
    const widths = plan.galleryCrossSections.flatMap((crossSection) => (
      crossSection.sections.map((section) => commonCrossSectionWidth(section, floorTiles))
    ));
    assert.ok(widths.length > 0);
    assert.ok(widths.every((width) => width >= 3), `widths=${widths.join(',')}`);
    assert.ok(plan.decorativeArchBeats.length >= 2);
    assert.ok(plan.decorativeArchBeats.every((arch) => arch.internalClearWidthMeters >= 5.6));
    assert.ok(plan.decorativeArchBeats.slice(1).every((arch, index) => (
      arch.pathIndex - plan.decorativeArchBeats[index].pathIndex <= 3
    )));

    const validation = generator._validateConnectorTraversalAssembly({
      floorTiles,
      tiles,
      rooms: INTERIOR_ROOMS,
      connectionPlans: [plan],
    });
    assert.equal(validation.accepted, true, validation.errors.join('\n'));

    if (variantId === DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE) {
      const rampColumns = new Map();
      for (const tile of floorTiles.filter((floor) => floor.surface === 'industrialRamp')) {
        const key = `${tile.rampPointIndex}:${tile.elevation.toFixed(3)}`;
        rampColumns.set(key, (rampColumns.get(key) ?? 0) + 1);
      }
      assert.ok([...rampColumns.values()].every((count) => count >= 3));
    }
    if (variantId === DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY) {
      const [firstLadder, secondLadder] = plan.connectorVariant.mechanisms;
      const upperElevation = firstLadder.topElevation;
      for (let x = firstLadder.pathIndex + 1; x < secondLadder.pathIndex; x += 1) {
        const laneCount = floorTiles.filter((floor) => (
          floor.x === x && Math.abs((floor.elevation ?? 0) - upperElevation) <= 0.05
        )).length;
        assert.ok(laneCount >= 3, `upper gantry x=${x} has ${laneCount} lanes`);
      }
    }
    if (variantId === DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT) {
      const returnRampByX = new Map();
      for (const tile of floorTiles.filter((floor) => (
        floor.surface === 'industrialRamp' && floor.connectionId === plan.id
      ))) {
        returnRampByX.set(tile.x, (returnRampByX.get(tile.x) ?? 0) + 1);
      }
      assert.ok([...returnRampByX.values()].every((count) => count >= 3));
    }
  });
}

test('orthogonal connector turns fill a complete 3x3 elbow', () => {
  const bridgePath = [
    { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 },
    { x: 2, z: 1 }, { x: 2, z: 2 }, { x: 2, z: 3 },
  ];
  const plan = {
    id: 'wide-turn-gallery',
    fromRoomId: 'room-a',
    toRoomId: 'room-b',
    connectorType: 'ground_corridor',
    level: 0,
    elevation: 0,
    fullPath: bridgePath.map((point) => ({ ...point })),
    bridgePath: bridgePath.map((point) => ({ ...point })),
    fromSocket: { id: 'turn-a', x: 0, z: 0, elevation: 0 },
    toSocket: { id: 'turn-b', x: 2, z: 3, elevation: 0 },
  };
  const { generator, tiles, floorTiles } = realizePlan(plan);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      assert.ok(tiles.has(`${2 + dx},${dz}`), `missing turn cell ${2 + dx},${dz}`);
    }
  }
  const validation = generator._validateConnectorTraversalAssembly({
    floorTiles,
    tiles,
    rooms: INTERIOR_ROOMS,
    connectionPlans: [plan],
  });
  assert.equal(validation.accepted, true, validation.errors.join('\n'));
});
