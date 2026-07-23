import assert from 'node:assert/strict';
import test from 'node:test';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  DUNGEON_CONNECTOR_VARIANT_IDS,
  createDungeonConnectorVariantContract,
} from '../src/DungeonConnectorVariants.js';

const TILE_SIZE = 2.8;
const PATH_TILE_COUNT = 33;

function createSignedPlan(variantId, direction = 'level', constraints = {}) {
  const sourceElevation = direction === 'descending' ? 14 : 0;
  const destinationElevation = direction === 'ascending'
    ? sourceElevation + 14
    : direction === 'descending'
      ? sourceElevation - 14
      : sourceElevation;
  const bridgePath = Array.from({ length: PATH_TILE_COUNT }, (_, x) => ({ x, z: 0 }));
  const plan = {
    id: `${variantId}-${direction}`,
    logicalConnectionId: `room-a_room-b_${direction}`,
    fromRoomId: 'room-a',
    toRoomId: 'room-b',
    connectorType: 'ground_corridor',
    level: 0,
    elevation: sourceElevation,
    sourceElevation,
    destinationElevation,
    elevationDelta: destinationElevation - sourceElevation,
    direction,
    fullPath: bridgePath.map((point) => ({ ...point })),
    bridgePath: bridgePath.map((point) => ({ ...point })),
    connectorVariantConstraints: {
      roomFootprints: [],
      endpointFlatBufferTiles: 2,
      ...constraints,
    },
    fromSocket: {
      id: 'room-a-exit',
      roomId: 'room-a',
      x: 0,
      z: 0,
      elevation: sourceElevation,
    },
    toSocket: {
      id: 'room-b-entrance',
      roomId: 'room-b',
      x: PATH_TILE_COUNT - 1,
      z: 0,
      elevation: destinationElevation,
    },
  };
  plan.connectorVariant = createDungeonConnectorVariantContract(plan, variantId, {
    tileSize: TILE_SIZE,
    sourceElevation,
    destinationElevation,
    direction,
  });
  plan.connectorVariantId = variantId;
  return plan;
}

function realizePlan(plan) {
  const tiles = new Map(plan.bridgePath.map((point) => [
    `${point.x},${point.z}`,
    {
      ...point,
      type: 'hallway',
      elevation: plan.sourceElevation,
      level: plan.sourceElevation / 14,
    },
  ]));
  const generator = new DungeonGenerator({ tileSize: TILE_SIZE, random: () => 0.5 });
  generator._addConnectorExplorationSpaces(tiles, [], [plan]);
  const floorTiles = [...tiles.values()];
  const realizedFloorTiles = generator._applyConnectorTraversalSurfaces(
    tiles,
    [plan],
    floorTiles,
  );
  return { generator, tiles, floorTiles: realizedFloorTiles };
}

function floorAt(floorTiles, point, elevation) {
  return floorTiles.find((floor) => (
    floor.x === point.x
    && floor.z === point.z
    && Math.abs(Number(floor.elevation) - elevation) <= 0.05
  ));
}

function assertAcceptedAssembly(plan, realized) {
  assert.ok(floorAt(realized.floorTiles, plan.fromSocket, plan.sourceElevation));
  assert.ok(floorAt(realized.floorTiles, plan.toSocket, plan.destinationElevation));
  const validation = realized.generator._validateConnectorTraversalAssembly({
    floorTiles: realized.floorTiles,
    tiles: realized.tiles,
    rooms: [],
    connectionPlans: [plan],
  });
  assert.equal(validation.accepted, true, validation.errors.join('\n'));
  assert.ok(
    validation.details.checks.every(({ minimumGalleryWidthTiles }) => (
      minimumGalleryWidthTiles >= 3
    )),
  );
}

test('ordinary V1 service gallery remains level, three-wide, and arch-decorated', () => {
  const plan = createSignedPlan(DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY, 'level');
  const realized = realizePlan(plan);

  assert.equal(plan.elevationDelta, 0);
  assert.equal(plan.connectorVariant.elevationDelta, 0);
  assert.equal(plan.connectorVariant.direction, 'level');
  assert.equal(plan.sourceElevation, plan.destinationElevation);
  assert.equal(plan.ladderContracts.length, 0);
  assert.equal(plan.liftContracts.length, 0);
  assert.equal(plan.slopeTraversalContract, undefined);
  assert.ok(plan.decorativeArchBeats.length >= 2);
  assert.ok(plan.decorativeArchBeats.every((arch) => arch.internalClearWidthMeters >= 5.6));
  assertAcceptedAssembly(plan, realized);
});

test('signed assembly rejects missing gallery sections and decorative V1 arches', () => {
  const plan = createSignedPlan(DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY, 'level');
  const realized = realizePlan(plan);
  const sections = plan.galleryCrossSections;
  plan.galleryCrossSections = [];
  let validation = realized.generator._validateConnectorTraversalAssembly({
    floorTiles: realized.floorTiles,
    tiles: realized.tiles,
    rooms: [],
    connectionPlans: [plan],
  });
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some((error) => error.includes('no measurable exterior gallery')));

  plan.galleryCrossSections = sections;
  plan.decorativeArchBeats = [];
  validation = realized.generator._validateConnectorTraversalAssembly({
    floorTiles: realized.floorTiles,
    tiles: realized.tiles,
    rooms: [
      { id: plan.fromRoomId, type: 'normal' },
      { id: plan.toRoomId, type: 'normal' },
    ],
    connectionPlans: [plan],
  });
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some((error) => error.includes('decorative V1 arches')));
});

for (const direction of ['ascending', 'descending']) {
  test(`${direction} slope realizes an exact signed 14m two-flight switchback`, () => {
    const plan = createSignedPlan(DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE, direction);
    const realized = realizePlan(plan);
    const expectedDelta = direction === 'ascending' ? 14 : -14;

    assert.equal(plan.destinationElevation - plan.sourceElevation, expectedDelta);
    assert.equal(plan.connectorVariant.elevationDelta, expectedDelta);
    assert.equal(plan.connectorVariant.direction, direction);
    assert.equal(plan.connectorVariant.construction.flights.length, 2);
    assert.equal(plan.connectorVariant.construction.lateralCenterlineSeparationTiles, 3);
    assert.ok([1, -1].includes(plan.connectorVariant.construction.switchbackSideSign));
    assert.deepEqual(
      plan.connectorVariant.construction.returnFlightDirection,
      {
        x: -plan.connectorVariant.construction.sourceFlightDirection.x,
        z: -plan.connectorVariant.construction.sourceFlightDirection.z,
      },
    );
    assert.ok(plan.connectorVariant.construction.flights.every((flight) => (
      flight.segmentCount === 13
      && Math.abs(flight.risePerSegmentMeters) === Number((7 / 13).toFixed(6))
      && Math.sign(flight.riseMeters) === Math.sign(expectedDelta)
    )));

    const ramps = realized.floorTiles.filter((floor) => (
      floor.connectionId === plan.id && floor.surface === 'industrialRamp'
    ));
    assert.equal(ramps.length, 2 * 13 * 3);
    const flights = new Map();
    for (const floor of ramps) {
      const flightId = String(floor.rampRunId).split(':lane:')[0];
      const floors = flights.get(flightId) ?? [];
      floors.push(floor);
      flights.set(flightId, floors);
      assert.ok(
        Math.abs(Math.abs(floor.rampEndElevation - floor.rampStartElevation) - (7 / 13))
          <= 0.001,
      );
    }
    assert.equal(flights.size, 2);
    assert.ok([...flights.values()].every((floors) => floors.length === 13 * 3));

    for (const flightContract of plan.connectorVariant.construction.flights) {
      const centerLane = ramps
        .filter((floor) => floor.rampRunId === `${flightContract.id}:lane:0`)
        .sort((first, second) => first.rampPointIndex - second.rampPointIndex);
      assert.equal(centerLane.length, 13);
      assert.deepEqual(
        { x: centerLane[0].x, z: centerLane[0].z },
        flightContract.startGridPoint,
      );
      assert.deepEqual(
        { x: centerLane.at(-1).x, z: centerLane.at(-1).z },
        flightContract.endGridPoint,
      );
      assert.equal(centerLane[0].rampStartElevation, flightContract.startElevation);
      assert.equal(centerLane.at(-1).rampEndElevation, flightContract.endElevation);
    }

    const [firstFlight, secondFlight] = [...flights.values()];
    const firstColumns = new Set(firstFlight.map(({ x, z }) => `${x},${z}`));
    assert.equal(
      secondFlight.some(({ x, z }) => firstColumns.has(`${x},${z}`)),
      false,
      'switchback flights must not occupy the same X/Z columns',
    );
    assert.ok(plan.slopeTraversalContract.switchbackLandingTiles.length >= 9);
    assert.ok(plan.slopeTraversalContract.destinationLandingTiles.length >= 9);
    assert.equal(
      plan.slopeTraversalContract.switchbackSideSign,
      plan.connectorVariant.construction.switchbackSideSign,
    );
    assert.equal(
      plan.slopeTraversalContract.firstFlightContractId,
      plan.connectorVariant.construction.flights[0].id,
    );
    assert.equal(
      plan.slopeTraversalContract.secondFlightContractId,
      plan.connectorVariant.construction.flights[1].id,
    );
    assertAcceptedAssembly(plan, realized);
  });
}

test('switchback side selection is contract-owned and avoids an authored positive-side footprint', () => {
  const plan = createSignedPlan(
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
    'ascending',
    {
      roomFootprints: [{ minX: 10, maxX: 10, minZ: 5, maxZ: 5 }],
      endpointFlatBufferTiles: 2,
    },
  );
  assert.equal(plan.connectorVariant.construction.switchbackSideSign, -1);
  assert.equal(Object.isFrozen(plan.connectorVariant.construction.flights), true);

  const realized = realizePlan(plan);
  const secondFlight = plan.connectorVariant.construction.flights[1];
  assert.ok(secondFlight.startGridPoint.z < 0);
  assert.ok(secondFlight.endGridPoint.z < 0);
  assertAcceptedAssembly(plan, realized);
});
