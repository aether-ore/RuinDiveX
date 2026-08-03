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

function realizePlan(plan, { roomOwnedPathIndices = [] } = {}) {
  const roomOwnedPathIndexSet = new Set(roomOwnedPathIndices);
  const tiles = new Map(plan.bridgePath.map((point) => [
    `${point.x},${point.z}`,
    {
      ...point,
      type: 'hallway',
      elevation: plan.sourceElevation,
      level: plan.sourceElevation / 14,
      ...(roomOwnedPathIndexSet.has(point.x) ? { roomId: plan.fromRoomId } : {}),
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

test('a lift approach under a room footprint keeps its signed cross-section elevation', () => {
  const underpassPlan = createLiftPlan('ascending');
  underpassPlan.connectorVariantConstraints.roomFootprints = [{
    roomId: underpassPlan.fromRoomId,
    minX: -1,
    maxX: 1,
    minZ: -1,
    maxZ: 1,
  }];
  realizePlan(underpassPlan, { roomOwnedPathIndices: [0] });

  const underpassSection = underpassPlan.galleryCrossSections.find(({ pathIndex }) => (
    pathIndex === 1
  ));
  assert.ok(underpassSection, 'the vertically separate approach must retain a physical section');
  assert.deepEqual(
    underpassSection.sections.map(({ elevation }) => elevation),
    [underpassPlan.sourceElevation],
  );

  const roomInteriorPlan = createLiftPlan('ascending');
  roomInteriorPlan.connectorVariantConstraints.roomFootprints = [{
    roomId: roomInteriorPlan.fromRoomId,
    minX: -1,
    maxX: 1,
    minZ: -1,
    maxZ: 1,
  }];
  realizePlan(roomInteriorPlan, { roomOwnedPathIndices: [0, 1] });
  assert.equal(
    roomInteriorPlan.galleryCrossSections.some(({ pathIndex }) => pathIndex === 1),
    false,
    'a same-elevation authored room floor must still suppress connector shell sections',
  );
});

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

      const boundaryWallRuns = generator._collectBoundaryWallRuns(
        tiles,
        new Set(),
        [],
        new Map(),
        floorTiles,
      );
      const legacyBoundaryWallRuns = generator._collectBoundaryWallRuns(
        tiles,
        new Set(),
        [],
        new Map(),
      );
      const runCoversEdge = (run, floor, dx, dz) => {
        const horizontal = dz !== 0;
        const line = horizontal ? floor.z + dz * 0.5 : floor.x + dx * 0.5;
        const axis = horizontal ? floor.x : floor.z;
        return run.horizontal === horizontal
          && run.dx === dx
          && run.dz === dz
          && Math.abs(run.line - line) <= 0.001
          && run.start <= axis
          && run.end >= axis
          && run.wallBottomY <= floor.elevation + 0.001
          && run.wallTopY >= floor.elevation + 0.001;
      };
      for (const floor of landingFloors) {
        for (const edge of floor.openRetainingWallEdges ?? []) {
          const [dx, dz] = edge.split(',').map(Number);
          assert.ok(
            floor.connectorLiftBoardingOpenRetainingWallEdges?.includes(edge),
            `${endpoint} boarding lane must carry its exact lift-shell contract`,
          );
          assert.equal(
            boundaryWallRuns.some((run) => runCoversEdge(run, floor, dx, dz)),
            false,
            `${endpoint} authoritative lift boarding lane must be wall-free`,
          );
          assert.equal(
            legacyBoundaryWallRuns.some((run) => runCoversEdge(run, floor, dx, dz)),
            false,
            `${endpoint} frozen V1 envelope behavior must remain unchanged`,
          );

          const foreignFloor = {
            ...floor,
            roomId: 'foreign-room',
            augmentationOwnerId: 'foreign-room',
            openRetainingWallEdges: [edge],
            v4SupplementalOpenRetainingWallEdges: undefined,
            connectorLiftBoardingOpenRetainingWallEdges: undefined,
          };
          const foreignRuns = generator._collectBoundaryWallRuns(
            new Map(),
            new Set(),
            [],
            new Map(),
            [foreignFloor],
          );
          assert.equal(
            foreignRuns.some((run) => runCoversEdge(run, foreignFloor, dx, dz)),
            true,
            'an unrelated generic retaining-wall hint must remain walled',
          );
        }
      }

      const incompleteContractFloors = floorTiles.map((floor) => ({
        ...floor,
        openRetainingWallEdges: [...(floor.openRetainingWallEdges ?? [])],
        connectorLiftBoardingOpenRetainingWallEdges: [
          ...(floor.connectorLiftBoardingOpenRetainingWallEdges ?? []),
        ],
        traversalLinks: (floor.traversalLinks ?? []).map((link) => ({ ...link })),
      }));
      const firstBoardingFloor = landingFloors.find((floor) => (
        (floor.connectorLiftBoardingOpenRetainingWallEdges?.length ?? 0) > 0
      ));
      const firstBoardingFloorKey = generator._getFloorTileGraphKey(firstBoardingFloor);
      const incompleteBoardingFloor = incompleteContractFloors.find((floor) => (
        generator._getFloorTileGraphKey(floor) === firstBoardingFloorKey
      ));
      incompleteBoardingFloor.connectorLiftBoardingOpenRetainingWallEdges = [];
      const incompleteContractRuns = generator._collectBoundaryWallRuns(
        new Map(),
        new Set(),
        [],
        new Map(),
        incompleteContractFloors,
      );
      for (const floor of landingFloors) {
        for (const edge of floor.openRetainingWallEdges ?? []) {
          const [dx, dz] = edge.split(',').map(Number);
          assert.equal(
            incompleteContractRuns.some((run) => runCoversEdge(run, floor, dx, dz)),
            true,
            'an incomplete three-lane lift contract must fail closed',
          );
        }
      }
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

    const aboveShaftTile = {
      ...capTile,
      elevation: lift.topElevation + lift.shaftHeadroomMeters + 0.1,
    };
    floorTiles.push(aboveShaftTile);
    const aboveShaftValidation = generator._validateConnectorTraversalAssembly({
      floorTiles,
      tiles,
      rooms: [],
      connectionPlans: [plan],
    });
    assert.equal(
      aboveShaftValidation.accepted,
      true,
      'a floor genuinely above the declared lift shaft sweep must remain out of scope',
    );
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

test('V4 supplemental automatic lift owns and opens only its declared boarding edges', () => {
  const plan = createLiftPlan('ascending');
  Object.assign(plan, {
    isDungeonSupplement: true,
    isRouteNetworkConnection: true,
    augmentationOperationType: 'routeNetwork',
    augmentationOperationId: 'supplement:test:v4-lift:operation',
    routeNetworkGrantId: 'supplement:test:v4-lift:grant',
    routeNetworkKind: 'objective-route-coverage',
  });
  const { generator, tiles, floorTiles } = realizePlan(plan);
  const lift = plan.liftContracts[0];
  const boundaryWallRuns = generator._collectBoundaryWallRuns(
    tiles,
    new Set(),
    [],
    new Map(),
    floorTiles,
  );
  const runCoversEdge = (run, floor, dx, dz) => {
    const horizontal = dz !== 0;
    const line = horizontal ? floor.z + dz * 0.5 : floor.x + dx * 0.5;
    const axis = horizontal ? floor.x : floor.z;
    return run.horizontal === horizontal
      && run.dx === dx
      && run.dz === dz
      && Math.abs(run.line - line) <= 0.001
      && run.start <= axis
      && run.end >= axis
      && run.wallBottomY <= floor.elevation + 0.001
      && run.wallTopY >= floor.elevation + 0.001;
  };

  const boardingEdges = [...lift.bottomLandingTiles, ...lift.topLandingTiles]
    .flatMap((landing) => {
      const floor = floorByKey(generator, floorTiles, landing.floorKey);
      return (floor.connectorLiftBoardingOpenRetainingWallEdges ?? [])
        .map((edge) => ({ floor, edge }));
    });
  assert.equal(boardingEdges.length, 6, 'a V4 lift owns exactly three lanes per endpoint');
  assert.deepEqual(
    Object.fromEntries(['source', 'destination'].map((endpoint) => [
      endpoint,
      boardingEdges.filter(({ floor }) => (
        floor.connectorZone === `lift_${endpoint}_landing`
      )).length,
    ])),
    { source: 3, destination: 3 },
  );
  assert.equal(
    generator._collectConnectorLiftBoardingWallOpeningKeys(floorTiles).size,
    6,
    'the V4 lift must satisfy the complete paired shell proof',
  );
  const lowerCenterLane = boardingEdges.find(({ floor }) => (
    (floor.traversalLinks ?? []).some(({ action }) => action === 'automatic_lift')
      && Math.abs(floor.elevation - lift.bottomElevation) <= 0.05
  ));
  assert.ok(lowerCenterLane);
  const [shaftDx, shaftDz] = lowerCenterLane.edge.split(',').map(Number);
  const lowerShaftFloor = floorTiles.find((floor) => (
    floor.x === lowerCenterLane.floor.x + shaftDx
      && floor.z === lowerCenterLane.floor.z + shaftDz
      && Math.abs(floor.elevation - lift.bottomElevation) <= 0.05
  ));
  assert.ok(lowerShaftFloor, 'the lower lift stop may retain its static sill/support floor');
  assert.equal(
    generator._collectConnectorLiftBoardingWallOpeningKeys([
      ...floorTiles,
      {
        ...lowerShaftFloor,
        elevation: (lift.bottomElevation + lift.topElevation) * 0.5,
        floorKey: 'synthetic-mid-shaft-cap',
      },
    ]).size,
    0,
    'an intermediate static cap must invalidate all six lift boarding openings',
  );

  for (const { floor, edge } of boardingEdges) {
      assert.deepEqual(floor.v4SupplementalRouteOwnerIds, [plan.id]);
      assert.ok(
        floor.v4SupplementalOpenRetainingWallEdges?.includes(edge),
        'a V4 boarding opening must retain edge-specific ownership',
      );
      assert.ok(
        floor.connectorLiftBoardingOpenRetainingWallEdges?.includes(edge),
        'a V4 automatic lift must retain the same exact multi-lane shell contract',
      );
      const [dx, dz] = edge.split(',').map(Number);
      assert.equal(
        boundaryWallRuns.some((run) => runCoversEdge(run, floor, dx, dz)),
        false,
        'a V4 route-owned lift boarding edge must remain open in the boundary shell',
      );
  }

  const incompleteFloors = floorTiles.map((floor) => ({
    ...floor,
    openRetainingWallEdges: [...(floor.openRetainingWallEdges ?? [])],
    v4SupplementalOpenRetainingWallEdges: [
      ...(floor.v4SupplementalOpenRetainingWallEdges ?? []),
    ],
    connectorLiftBoardingOpenRetainingWallEdges: [
      ...(floor.connectorLiftBoardingOpenRetainingWallEdges ?? []),
    ],
    traversalLinks: (floor.traversalLinks ?? []).map((link) => ({ ...link })),
  }));
  const removedLane = incompleteFloors.find((floor) => {
    if (floor.connectorZone !== 'lift_source_landing'
      || floor.connectorLiftBoardingOpenRetainingWallEdges.length === 0) return false;
    const [dx, dz] = floor.connectorLiftBoardingOpenRetainingWallEdges[0]
      .split(',').map(Number);
    return !incompleteFloors.some((candidate) => (
      candidate.x === floor.x + dx
        && candidate.z === floor.z + dz
        && Math.abs(candidate.elevation - floor.elevation) <= 0.05
    ));
  });
  assert.ok(removedLane);
  removedLane.connectorLiftBoardingOpenRetainingWallEdges = [];
  const mergedZoneLane = incompleteFloors.find((floor) => {
    if (floor === removedLane
      || floor.connectorLiftBoardingOpenRetainingWallEdges.length === 0) return false;
    const [dx, dz] = floor.connectorLiftBoardingOpenRetainingWallEdges[0]
      .split(',').map(Number);
    return !incompleteFloors.some((candidate) => (
      candidate.x === floor.x + dx
        && candidate.z === floor.z + dz
        && Math.abs(candidate.elevation - floor.elevation) <= 0.05
    ));
  });
  assert.ok(mergedZoneLane);
  mergedZoneLane.connectorZone = 'merged-authoritative-floor';
  assert.equal(
    removedLane.v4SupplementalOpenRetainingWallEdges.length,
    1,
    'the generic V4 ownership marker remains present for the bypass regression',
  );
  const incompleteRuns = generator._collectBoundaryWallRuns(
    new Map(),
    new Set(),
    [],
    new Map(),
    incompleteFloors,
  );
  const incompleteByKey = new Map(incompleteFloors.map((floor) => [
    generator._getFloorTileGraphKey(floor),
    floor,
  ]));
  assert.equal(
    generator._collectConnectorLiftBoardingWallOpeningKeys(incompleteFloors).size,
    0,
    'one missing lane must invalidate the complete paired V4 lift proof',
  );
  const removedEdge = removedLane.openRetainingWallEdges[0];
  const incompleteRemovedLane = incompleteByKey.get(
    generator._getFloorTileGraphKey(removedLane),
  );
  const [removedDx, removedDz] = removedEdge.split(',').map(Number);
  assert.equal(
    incompleteRuns.some((run) => runCoversEdge(
      run,
      incompleteRemovedLane,
      removedDx,
      removedDz,
    )),
    true,
    'the missing V4 lane must not be reopened by its generic ownership marker',
  );
  const mergedZoneEdge = mergedZoneLane.openRetainingWallEdges[0];
  const [mergedDx, mergedDz] = mergedZoneEdge.split(',').map(Number);
  assert.equal(
    incompleteRuns.some((run) => runCoversEdge(
      run,
      mergedZoneLane,
      mergedDx,
      mergedDz,
    )),
    true,
    'exact lift metadata must suppress the generic bypass if scalar zone identity was merged',
  );
});
