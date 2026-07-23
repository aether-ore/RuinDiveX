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

function createLiftPlan(direction) {
  const sourceElevation = direction === 'ascending' ? 0 : 14;
  const destinationElevation = direction === 'ascending' ? 14 : 0;
  const bridgePath = Array.from({ length: PATH_TILE_COUNT }, (_, x) => ({ x, z: 0 }));
  const plan = {
    id: `lift-${direction}`,
    logicalConnectionId: `room-a_room-b_lift_${direction}`,
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
    DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
    { tileSize: TILE_SIZE, sourceElevation, destinationElevation, direction },
  );
  plan.connectorVariantId = DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT;
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

function floorByKey(generator, floorTiles, floorKey) {
  return floorTiles.find((floor) => generator._getFloorTileGraphKey(floor) === floorKey);
}

function projectXZ(position, direction) {
  return position.x * direction.x + position.z * direction.z;
}

for (const direction of ['ascending', 'descending']) {
  test(`${direction} automatic lift spans 14m and initializes at the progression source`, () => {
    const plan = createLiftPlan(direction);
    const { generator, tiles, floorTiles } = realizePlan(plan);

    assert.equal(plan.elevationDelta, direction === 'ascending' ? 14 : -14);
    assert.equal(plan.liftContracts.length, 1);
    const lift = plan.liftContracts[0];
    assert.equal(lift.direction, direction);
    assert.equal(lift.topElevation - lift.bottomElevation, 14);
    assert.equal(lift.initialElevation, plan.sourceElevation);
    assert.equal(lift.initialDirection, direction === 'ascending' ? 'up' : 'down');
    assert.equal(lift.automatic, true);
    assert.equal(lift.operation, 'automatic_continuous_shuttle');
    assert.equal(lift.requiresRecallControls, true);
    assert.equal(lift.platformWidthMeters, 8.4);
    assert.equal(lift.platformDepthMeters, 8.4);
    assert.equal(lift.shaftWidthMeters, 11.2);
    assert.equal(lift.shaftDepthMeters, 11.2);
    assert.equal(lift.riderClearanceMeters, 3.6);
    assert.ok(lift.shaftHeadroomMeters >= lift.riderClearanceMeters);
    assert.equal(lift.landingWidthTiles, 3);
    assert.equal(lift.landingDepthTiles, 3);
    assert.equal(lift.bottomLandingTiles.length, 9);
    assert.equal(lift.topLandingTiles.length, 9);
    assert.equal(lift.landingSills.length, 2);
    assert.equal(lift.liftShaft, plan.connectorVariant.liftShaft);
    assert.equal(Object.isFrozen(lift.liftShaft), true);
    assert.deepEqual(
      [lift.center.x, lift.center.z],
      [plan.connectorVariant.liftShaft.center.x, plan.connectorVariant.liftShaft.center.z],
    );
    assert.deepEqual(
      [plan.connectorVariant.apertures[0].center.x, plan.connectorVariant.apertures[0].center.z],
      [lift.center.x, lift.center.z],
    );
    assert.deepEqual(
      [plan.connectorVariant.sweptVolumes[0].center.x, plan.connectorVariant.sweptVolumes[0].center.z],
      [lift.center.x, lift.center.z],
    );
    const realizedSweepClearance = plan.clearanceVolumes.find((volume) => (
      volume.sourceContractVolumeId === plan.connectorVariant.liftShaft.sweptVolumeId
    ));
    assert.ok(realizedSweepClearance);
    assert.deepEqual(
      [realizedSweepClearance.center.x, realizedSweepClearance.center.z],
      [lift.center.x, lift.center.z],
    );
    const contractStructuralVolumes = plan.connectorVariant.structuralVolumes;
    const realizedContractVolumes = plan.occupiedStructuralVolumes.filter((volume) => (
      volume.sourceContractVolumeId
    ));
    assert.equal(realizedContractVolumes.length, contractStructuralVolumes.length);
    assert.deepEqual(
      new Set(realizedContractVolumes.map((volume) => volume.sourceContractVolumeId)),
      new Set(contractStructuralVolumes.map((volume) => volume.id)),
    );

    const facing = lift.facing.clone().setY(0).normalize();
    const carProjection = projectXZ(lift.center, facing);
    const carHalfAlong = Math.abs(facing.x) * lift.platformWidthMeters * 0.5
      + Math.abs(facing.z) * lift.platformDepthMeters * 0.5;

    for (const [endpoint, landingTiles] of [
      ['bottom', lift.bottomLandingTiles],
      ['top', lift.topLandingTiles],
    ]) {
      assert.equal(new Set(landingTiles.map(({ floorKey }) => floorKey)).size, 9);
      for (const landing of landingTiles) {
        assert.ok(floorByKey(generator, floorTiles, landing.floorKey));
        assert.ok(tiles.has(`${landing.x},${landing.z}`));
      }

      const control = lift.controlAnchors[endpoint];
      assert.ok(control?.position);
      assert.equal(
        landingTiles.some(({ floorKey }) => floorKey === control.floorKey),
        false,
        `${endpoint} recall control must be beside, not inside, the landing`,
      );
      const controlFloor = floorByKey(generator, floorTiles, control.floorKey);
      assert.ok(controlFloor);
      assert.match(controlFloor.connectorZone, /control_alcove/);

      const sill = lift.landingSills.find((candidate) => candidate.endpoint === endpoint);
      assert.ok(sill, `${endpoint} landing must have a plan-owned sill`);
      assert.equal(sill.purpose, 'automatic_connector_lift_flush_landing_sill');
      assert.equal(sill.sourceContractSillId, sill.id);
      assert.equal(sill.blocksBelow, false);
      assert.equal(sill.thicknessMeters, 0.28);
      assert.equal(sill.supportPosts.length, 2);
      assert.equal(sill.spanMeters, 8.4);
      assert.ok(Math.abs(sill.bridgeDepthMeters - 1.4) <= 0.001);
      assert.ok(Math.abs(sill.topY - (endpoint === 'top' ? lift.topElevation : lift.bottomElevation)) <= 0.001);

      const sillProjection = projectXZ(sill.center, facing);
      const sillHalfAlong = Math.abs(facing.x) * sill.halfWidth
        + Math.abs(facing.z) * sill.halfDepth;
      const landingProjections = landingTiles.map((tile) => projectXZ({
        x: tile.x * TILE_SIZE,
        z: tile.z * TILE_SIZE,
      }, facing));
      const sillIsBeforeCar = sillProjection < carProjection;
      const physicalLandingEdge = sillIsBeforeCar
        ? Math.max(...landingProjections) + TILE_SIZE * 0.5
        : Math.min(...landingProjections) - TILE_SIZE * 0.5;
      const physicalCarEdge = carProjection + (sillIsBeforeCar ? -carHalfAlong : carHalfAlong);
      const sillLandingEdge = sillProjection + (sillIsBeforeCar ? -sillHalfAlong : sillHalfAlong);
      const sillCarEdge = sillProjection + (sillIsBeforeCar ? sillHalfAlong : -sillHalfAlong);
      assert.ok(Math.abs(sillLandingEdge - physicalLandingEdge) <= 0.05);
      assert.ok(Math.abs(sillCarEdge - physicalCarEdge) <= 0.05);

      const landingFloors = landingTiles.map(({ floorKey }) => (
        floorByKey(generator, floorTiles, floorKey)
      ));
      assert.equal(
        landingFloors.reduce((count, floor) => (
          count + (floor.openRetainingWallEdges?.length ?? 0)
        ), 0),
        3,
        `${endpoint} landing must keep its full three-tile lift boarding edge open`,
      );
      assert.equal(
        landingFloors.some((floor) => floor.forcedRetainingWallEdges?.length),
        false,
      );
    }

    const platformX = lift.center.x / TILE_SIZE;
    const platformZ = lift.center.z / TILE_SIZE;
    const shaftFloors = floorTiles.filter((floor) => (
      floor.connectionId === plan.id
      && Math.abs(floor.x - platformX) <= 1.5
      && Math.abs(floor.z - platformZ) <= 1.5
    ));
    assert.deepEqual(shaftFloors, [], 'the full 4x4 lift shaft must remain uncapped');

    const validation = generator._validateConnectorTraversalAssembly({
      floorTiles,
      tiles,
      rooms: [],
      connectionPlans: [plan],
    });
    assert.equal(validation.accepted, true, validation.errors.join('\n'));
    assert.ok(validation.details.checks[0].minimumGalleryWidthTiles >= 3);

    const cappedColumn = lift.liftShaft.gridColumns[0];
    const capTile = {
      x: cappedColumn.x,
      z: cappedColumn.z,
      elevation: lift.topElevation,
      connectionId: plan.id,
    };
    floorTiles.push(capTile);
    const capValidation = generator._validateConnectorTraversalAssembly({
      floorTiles,
      tiles,
      rooms: [],
      connectionPlans: [plan],
    });
    assert.equal(capValidation.accepted, false);
    assert.ok(capValidation.errors.some((error) => error.includes('swept shaft aperture')));
    floorTiles.pop();

    const sharedMaterial = new THREE.MeshBasicMaterial();
    const railGroup = new THREE.Group();
    generator._addFactoryRailRuns(
      railGroup,
      floorTiles,
      generator._createFloorTileLookup(floorTiles),
      { factoryRail: sharedMaterial },
    );
    const railRuns = railGroup.children.filter((object) => object.name === 'factoryCatwalkRailRun');
    for (const landing of [...lift.bottomLandingTiles, ...lift.topLandingTiles]) {
      const floor = floorByKey(generator, floorTiles, landing.floorKey);
      for (const edge of floor.openRetainingWallEdges ?? []) {
        const [dx, dz] = edge.split(',').map(Number);
        const midpoint = new THREE.Vector3(
          (floor.x + dx * 0.5) * TILE_SIZE,
          floor.elevation + 0.68,
          (floor.z + dz * 0.5) * TILE_SIZE,
        );
        assert.equal(
          railRuns.some((rail) => new THREE.Box3().setFromObject(rail).distanceToPoint(midpoint) <= 0.01),
          false,
          'no generated railing may cross a lift boarding edge',
        );
      }
    }
    railGroup.traverse((object) => object.geometry?.dispose?.());
    const solidZones = [];
    const fixtures = generator._addConnectorTraversalPrefabs(
      new THREE.Group(),
      [plan],
      {
        supportMetal: sharedMaterial,
        raisedDeckFloor: sharedMaterial,
        factoryRail: sharedMaterial,
        glowBlue: sharedMaterial,
        terminal: sharedMaterial,
      },
      solidZones,
    );
    const assembledLift = fixtures.lifts[0];
    assert.equal(assembledLift.landingSillSurfaces.length, 2);
    assert.equal(
      fixtures.platforms.filter((surface) => (
        surface.purpose === 'automatic_connector_lift_flush_landing_sill'
      )).length,
      2,
    );
    assert.ok(assembledLift.landingSillSurfaces.every((surface) => (
      surface.blocksBelow === false
      && Math.abs(surface.topY - surface.baseY - 0.28) <= 0.001
      && surface.collisionThicknessMeters === 0.28
    )));
    assert.equal(
      assembledLift.object.children.filter((object) => (
        object.name.startsWith('automaticConnectorLiftLandingSill_')
      )).length,
      2,
    );
    assert.equal(
      assembledLift.object.children.filter((object) => (
        object.name === 'automaticConnectorLiftLandingSillSupport'
      )).length,
      4,
    );
    const supportCollisionZones = solidZones.filter((zone) => (
      zone.sourceContractSupportId
    ));
    assert.equal(supportCollisionZones.length, 4);
    assert.deepEqual(
      new Set(supportCollisionZones.map((zone) => zone.sourceContractSupportId)),
      new Set(plan.connectorVariant.landingSills.flatMap((sill) => (
        sill.supportPosts.map((post) => post.id)
      ))),
    );
    assert.ok(supportCollisionZones.every((zone) => (
      zone.halfWidth === 0.12
      && zone.halfDepth === 0.12
      && zone.verticalHalfHeight > 0
    )));
    sharedMaterial.dispose();
  });
}
