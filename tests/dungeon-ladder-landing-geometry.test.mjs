import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DungeonGenerator } from '../src/DungeonGenerator.js';
import {
  DUNGEON_CONNECTOR_VARIANT_IDS,
  createDungeonConnectorVariantContract,
} from '../src/DungeonConnectorVariants.js';

const TILE_SIZE = 2.8;
const PATH_TILE_COUNT = 33;

function createLadderPlan(direction) {
  const sourceElevation = direction === 'ascending' ? 0 : 14;
  const destinationElevation = direction === 'ascending' ? 14 : 0;
  const bridgePath = Array.from({ length: PATH_TILE_COUNT }, (_, x) => ({ x, z: 0 }));
  const plan = {
    id: `ladder-${direction}`,
    logicalConnectionId: `room-a_room-b_ladder_${direction}`,
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
  plan.connectorVariant = createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    { tileSize: TILE_SIZE, sourceElevation, destinationElevation, direction },
  );
  plan.connectorVariantId = DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY;
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
  const floorTiles = generator._applyConnectorTraversalSurfaces(
    tiles,
    [plan],
    [...tiles.values()],
  );
  return { generator, tiles, floorTiles };
}

function uniqueProjectionCount(tiles, direction) {
  return new Set(tiles.map((tile) => tile.x * direction.x + tile.z * direction.z)).size;
}

for (const direction of ['ascending', 'descending']) {
  test(`${direction} ladder uses one clear 14m shaft with visible 3x3 landings`, () => {
    const plan = createLadderPlan(direction);
    const { generator, tiles, floorTiles } = realizePlan(plan);

    assert.equal(plan.elevationDelta, direction === 'ascending' ? 14 : -14);
    assert.equal(plan.ladderContracts.length, 1);
    const ladder = plan.ladderContracts[0];
    assert.equal(ladder.direction, direction);
    assert.equal(ladder.topY - ladder.bottomY, 14);
    assert.equal(ladder.caged, true);
    assert.equal(ladder.landingWidthTiles, 3);
    assert.equal(ladder.landingDepthTiles, 3);
    assert.equal(ladder.landingWidthMeters, TILE_SIZE * 3);
    assert.equal(ladder.landingDepthMeters, TILE_SIZE * 3);
    assert.equal(ladder.bottomLandingTiles.length, 9);
    assert.equal(ladder.topLandingTiles.length, 9);
    assert.equal(ladder.bottomMountPosition.distanceTo(ladder.bottomExit), 0);
    assert.equal(ladder.topMountPosition.distanceTo(ladder.topExit), 0);

    const facing = { x: ladder.planeNormal.x, z: ladder.planeNormal.z };
    const tangent = { x: -facing.z, z: facing.x };
    for (const [endpoint, landingTiles] of [
      ['bottom', ladder.bottomLandingTiles],
      ['top', ladder.topLandingTiles],
    ]) {
      assert.equal(new Set(landingTiles.map(({ floorKey }) => floorKey)).size, 9);
      assert.equal(uniqueProjectionCount(landingTiles, facing), 3);
      assert.equal(uniqueProjectionCount(landingTiles, tangent), 3);
      for (const landing of landingTiles) {
        assert.ok(tiles.has(`${landing.x},${landing.z}`), `${endpoint} shell tile is missing`);
        assert.ok(floorTiles.some((floor) => (
          generator._getFloorTileGraphKey(floor) === landing.floorKey
          && floor.connectionId === plan.id
          && floor.noEnemySpawn === true
        )), `${endpoint} landing has no matching physical floor`);
      }
    }

    assert.equal(
      floorTiles.some((floor) => (
        floor.x === ladder.apertureGridPoint.x
        && floor.z === ladder.apertureGridPoint.z
        && floor.connectionId === plan.id
      )),
      false,
      'no tile at any elevation may cover the ladder aperture',
    );
    assert.equal(tiles.get(`${ladder.apertureGridPoint.x},${ladder.apertureGridPoint.z}`)?.structuralEnvelopeOnly, true);

    const floorByKey = new Map(floorTiles.map((floor) => [
      generator._getFloorTileGraphKey(floor),
      floor,
    ]));
    const bottomLandingFloors = ladder.bottomLandingTiles.map(({ floorKey }) => floorByKey.get(floorKey));
    const topLandingFloors = ladder.topLandingTiles.map(({ floorKey }) => floorByKey.get(floorKey));
    assert.equal(
      bottomLandingFloors.reduce((count, floor) => count + (floor.openRetainingWallEdges?.length ?? 0), 0),
      1,
      'the lower landing keeps one unobstructed ladder access lane',
    );
    assert.equal(
      topLandingFloors.reduce((count, floor) => count + (floor.openRetainingWallEdges?.length ?? 0), 0),
      1,
      'the upper landing keeps one unobstructed ladder access lane',
    );
    assert.equal(
      topLandingFloors.reduce((count, floor) => count + (floor.forcedRetainingWallEdges?.length ?? 0), 0),
      2,
      'the two upper-aperture flanks are explicitly guard-railed',
    );

    const railMaterial = new THREE.MeshBasicMaterial();
    const railGroup = new THREE.Group();
    generator._addFactoryRailRuns(
      railGroup,
      floorTiles,
      generator._createFloorTileLookup(floorTiles),
      { factoryRail: railMaterial },
    );
    const railRuns = railGroup.children.filter((object) => object.name === 'factoryCatwalkRailRun');
    const edgeMidpoint = (floor, edge) => {
      const [dx, dz] = edge.split(',').map(Number);
      return new THREE.Vector3(
        (floor.x + dx * 0.5) * TILE_SIZE,
        floor.elevation + 0.68,
        (floor.z + dz * 0.5) * TILE_SIZE,
      );
    };
    const railAt = (point) => railRuns.some((rail) => (
      new THREE.Box3().setFromObject(rail).distanceToPoint(point) <= 0.01
    ));
    const openFloor = topLandingFloors.find((floor) => floor.openRetainingWallEdges?.length);
    assert.equal(railAt(edgeMidpoint(openFloor, openFloor.openRetainingWallEdges[0])), false);
    for (const guardedFloor of topLandingFloors.filter((floor) => (
      floor.forcedRetainingWallEdges?.length
    ))) {
      assert.equal(
        railAt(edgeMidpoint(guardedFloor, guardedFloor.forcedRetainingWallEdges[0])),
        true,
      );
    }
    railGroup.traverse((object) => object.geometry?.dispose?.());
    railMaterial.dispose();

    if (direction === 'ascending') {
      assert.equal(ladder.bottomMountPosition.y, plan.sourceElevation);
      assert.equal(ladder.topMountPosition.y, plan.destinationElevation);
    } else {
      assert.equal(ladder.topMountPosition.y, plan.sourceElevation);
      assert.equal(ladder.bottomMountPosition.y, plan.destinationElevation);
    }

    const validation = generator._validateConnectorTraversalAssembly({
      floorTiles,
      tiles,
      rooms: [],
      connectionPlans: [plan],
    });
    assert.equal(validation.accepted, true, validation.errors.join('\n'));
    assert.ok(validation.details.checks[0].minimumGalleryWidthTiles >= 3);
  });
}
