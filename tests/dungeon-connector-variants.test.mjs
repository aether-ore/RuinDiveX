import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUNGEON_CONNECTOR_CLEARANCE,
  DUNGEON_CONNECTOR_ELEVATION_POLICY,
  DUNGEON_CONNECTOR_VARIANT_IDS,
  DUNGEON_CONNECTOR_VARIANT_ORDER,
  assignDungeonConnectorVariants,
  computeDungeonConnectorStableHash,
  createDungeonConnectorVariantContract,
  deriveDungeonConnectorSafeSpan,
  findLongestConnectorStraightRun,
  isDungeonConnectorVariantEligible,
  planDungeonConnectorVariantAssignments,
  reserveDungeonConnectorFamilyFootprints,
  validateDungeonConnectorVariantAssignments,
} from '../src/DungeonConnectorVariants.js';

const makePath = (offsetZ = 0, length = 25) => Array.from(
  { length },
  (_, x) => ({ x, z: offsetZ }),
);

const makePlan = (id, offsetZ, overrides = {}) => {
  const fullPath = makePath(offsetZ);
  return {
    id,
    logicalConnectionId: `${id}_rooms`,
    fromRoomId: `${id}_from`,
    toRoomId: `${id}_to`,
    connectorType: 'ground_corridor',
    level: 0,
    elevation: 0,
    fullPath,
    bridgePath: fullPath.slice(1, -1),
    fromSocket: { id: `${id}_exit`, x: 1, z: offsetZ, facingX: 1, facingZ: 0 },
    toSocket: { id: `${id}_entrance`, x: 11, z: offsetZ, facingX: -1, facingZ: 0 },
    ...overrides,
  };
};

function makeExplicitAssignedPlan(plan, variantId, sourceElevation, destinationElevation) {
  const direction = destinationElevation > sourceElevation ? 'ascending' : 'descending';
  const assigned = {
    ...structuredClone(plan),
    elevation: sourceElevation,
    sourceElevation,
    destinationElevation,
    elevationDelta: destinationElevation - sourceElevation,
    direction,
    fromSocket: { ...plan.fromSocket, elevation: sourceElevation, y: sourceElevation },
    toSocket: { ...plan.toSocket, elevation: destinationElevation, y: destinationElevation },
  };
  assigned.connectorVariant = createDungeonConnectorVariantContract(assigned, variantId, {
    sourceElevation,
    destinationElevation,
    direction,
  });
  assigned.connectorVariantId = variantId;
  assigned.higherEndpoint = assigned.connectorVariant.higherEndpoint;
  assigned.lowerEndpoint = assigned.connectorVariant.lowerEndpoint;
  return assigned;
}

test('connector assignment is deterministic, bounded, and does not consume a supplied RNG', () => {
  const plans = Array.from({ length: 12 }, (_, index) => makePlan(`route-${index}`, index * 3));
  const snapshot = structuredClone(plans);
  let randomCalls = 0;
  const options = { random: () => { randomCalls += 1; return 0.25; } };
  const first = assignDungeonConnectorVariants(plans, options);
  const second = assignDungeonConnectorVariants(structuredClone(plans), options);

  assert.deepEqual(first, second);
  assert.deepEqual(plans, snapshot, 'input plans must not be mutated');
  assert.equal(randomCalls, 0, 'variant assignment must not read the generator random stream');
  const elevationPlans = first.filter((plan) => plan.connectorVariant?.elevationChange);
  assert.ok(elevationPlans.length >= 3 && elevationPlans.length <= 5);
  assert.deepEqual(new Set(elevationPlans.map((plan) => plan.connectorVariantId)), new Set([
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  ]));
  assert.deepEqual(new Set(elevationPlans.map((plan) => plan.direction)), new Set([
    'ascending',
    'descending',
  ]));
  assert.ok(first.some((plan) => (
    plan.connectorVariantId === DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY
  )));
  assert.equal(validateDungeonConnectorVariantAssignments(plans, first).ok, true);
});

test('mandatory families stay on main-route edges while extra transfers prefer optional branches', () => {
  const mainPlans = Array.from({ length: 5 }, (_, index) => makePlan(`main-${index}`, index * 4, {
    fromRoomId: `main-room-${index}`,
    toRoomId: `main-room-${index + 1}`,
    requiredForProgression: true,
    purpose: 'critical_route',
  }));
  const optionalPlans = [
    makePlan('optional-a', 28, {
      fromRoomId: 'main-room-1',
      toRoomId: 'optional-room-a',
      // V1 keeps this true as a physical-route invariant. Classification is
      // the authoritative main/branch distinction for connector planning.
      requiredForProgression: true,
      purpose: 'optional_branch',
      routeClassification: 'optional_branch',
    }),
    makePlan('optional-b', 32, {
      fromRoomId: 'main-room-3',
      toRoomId: 'optional-room-b',
      requiredForProgression: true,
      purpose: 'optional_branch',
      routeClassification: 'optional_branch',
    }),
  ];
  const plans = [...mainPlans, ...optionalPlans];
  const result = planDungeonConnectorVariantAssignments(plans, {
    elevationConnectorCount: 5,
    initialRoomElevations: { 'main-room-0': 0 },
  });
  assert.equal(result.diagnostics.accepted, true, result.diagnostics.errors.join('\n'));
  assert.equal(result.diagnostics.selectedElevationConnectorCount, 5);
  assert.deepEqual(
    new Set(result.diagnostics.optionalBranchElevationConnectorIds),
    new Set(['optional-a', 'optional-b']),
  );
  assert.equal(result.diagnostics.mainRouteElevationConnectorIds.length, 3);

  const elevationPlans = result.connectionPlans.filter((plan) => (
    plan.connectorVariant?.elevationChange === true
  ));
  for (const variantId of [
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  ]) {
    assert.ok(elevationPlans.some((plan) => (
      plan.connectorVariantId === variantId && plan.routeClassification !== 'optional_branch'
    )), `${variantId} must be represented on the main route`);
  }
  assert.equal(validateDungeonConnectorVariantAssignments(plans, result.connectionPlans).ok, true);

  const invalid = structuredClone(result.connectionPlans);
  const slope = invalid.find((plan) => (
    plan.connectorVariantId === DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE
  ));
  slope.requiredForProgression = false;
  slope.purpose = 'optional_branch';
  slope.routeClassification = 'optional_branch';
  const invalidResult = validateDungeonConnectorVariantAssignments(plans, invalid);
  assert.equal(invalidResult.ok, false);
  assert.ok(invalidResult.errors.some((error) => (
    error.includes('crested_slope_v1') && error.includes('main-route edge')
  )));
});

test('scarce layouts are rejected rather than pretending to satisfy elevation coverage', () => {
  for (const count of [1, 2, 3]) {
    const plans = Array.from({ length: count }, (_, index) => (
      makePlan(`scarce-${count}-${index}`, index * 3)
    ));
    const result = planDungeonConnectorVariantAssignments(plans);
    if (count < 3) {
      assert.equal(result.diagnostics.accepted, false);
      assert.ok(result.diagnostics.errors.some((error) => error.includes('at least 3')));
      assert.equal(validateDungeonConnectorVariantAssignments(plans, result.connectionPlans).ok, false);
    } else {
      assert.equal(result.diagnostics.accepted, true, result.diagnostics.errors.join('\n'));
      assert.equal(result.diagnostics.selectedElevationConnectorCount, 3);
      assert.equal(validateDungeonConnectorVariantAssignments(plans, result.connectionPlans).ok, true);
    }
  }
});

test('stable selection changes only when stable connection identity or geometry changes', () => {
  const plan = makePlan('stable-route', 4);
  const moved = structuredClone(plan);
  moved.bridgePath[4].z += 1;
  assert.equal(computeDungeonConnectorStableHash(plan), computeDungeonConnectorStableHash(structuredClone(plan)));
  assert.notEqual(computeDungeonConnectorStableHash(plan), computeDungeonConnectorStableHash(moved));
});

test('assignment preserves every room endpoint and both authored paths', () => {
  const plans = Array.from({ length: 4 }, (_, index) => makePlan(`endpoint-${index}`, index));
  const assigned = assignDungeonConnectorVariants(plans);
  for (let index = 0; index < plans.length; index += 1) {
    assert.deepEqual(assigned[index].fullPath, plans[index].fullPath);
    assert.deepEqual(assigned[index].bridgePath, plans[index].bridgePath);
    for (const [resolved, original] of [
      [assigned[index].fromSocket, plans[index].fromSocket],
      [assigned[index].toSocket, plans[index].toSocket],
    ]) {
      assert.equal(resolved.id, original.id);
      assert.equal(resolved.x, original.x);
      assert.equal(resolved.z, original.z);
      assert.equal(resolved.facingX, original.facingX);
      assert.equal(resolved.facingZ, original.facingZ);
      assert.equal(resolved.y, resolved.elevation);
    }
    assert.notStrictEqual(assigned[index].fullPath, plans[index].fullPath);
    assert.notStrictEqual(assigned[index].fromSocket, plans[index].fromSocket);
    assert.equal(assigned[index].connectorVariant.preservesRoomGeometry, true);
    assert.equal(assigned[index].connectorVariant.preservesConnectionEndpoints, true);
  }
});

test('variant spans exclude every authored room footprint and reserve two flat socket tiles', () => {
  const path = makePath(0, 31);
  const roomFootprints = [
    { roomId: 'source', minX: 0, maxX: 4, minZ: -2, maxZ: 2 },
    { roomId: 'unrelated-side-room', minX: 14, maxX: 16, minZ: -1, maxZ: 1 },
    { roomId: 'destination', minX: 26, maxX: 30, minZ: -2, maxZ: 2 },
  ];
  const plan = makePlan('room-safe-route', 0, {
    fullPath: path,
    bridgePath: path,
    fromSocket: { id: 'room-safe-exit', x: 4, z: 0, facingX: 1, facingZ: 0 },
    toSocket: { id: 'room-safe-entrance', x: 26, z: 0, facingX: -1, facingZ: 0 },
    connectorVariantConstraints: {
      roomFootprints,
      endpointFlatBufferTiles: 2,
    },
  });
  const safeSpan = deriveDungeonConnectorSafeSpan(plan);
  assert.ok(safeSpan);
  assert.equal(safeSpan.endpointFlatBufferTiles, 2);
  assert.deepEqual(safeSpan.sourceFlatBufferPath, [{ x: 5, z: 0 }, { x: 6, z: 0 }]);
  assert.deepEqual(safeSpan.destinationFlatBufferPath, [{ x: 24, z: 0 }, { x: 25, z: 0 }]);
  assert.deepEqual(safeSpan.selectedSafePath, makePath(0, 7).map((point) => ({
    x: point.x + 7,
    z: point.z,
  })));

  const insideAnyRoom = (point) => roomFootprints.some((footprint) => (
    point.x >= footprint.minX && point.x <= footprint.maxX
    && point.z >= footprint.minZ && point.z <= footprint.maxZ
  ));
  const bufferKeys = new Set([
    ...safeSpan.sourceFlatBufferPath,
    ...safeSpan.destinationFlatBufferPath,
  ].map((point) => `${point.x},${point.z}`));
  for (const point of safeSpan.selectedSafePath) {
    assert.equal(insideAnyRoom(point), false, `safe variant point ${point.x},${point.z} overlaps a room`);
    assert.equal(bufferKeys.has(`${point.x},${point.z}`), false, 'flat socket buffer entered variant span');
  }

  for (const variantId of DUNGEON_CONNECTOR_VARIANT_ORDER) {
    if (variantId === DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE) {
      assert.throws(
        () => createDungeonConnectorVariantContract(plan, variantId),
        /needs 13 exterior straight tiles/,
      );
      continue;
    }
    if (variantId === DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT) {
      assert.throws(
        () => createDungeonConnectorVariantContract(plan, variantId),
        /needs 10 exterior straight tiles/,
      );
      continue;
    }
    const contract = createDungeonConnectorVariantContract(plan, variantId);
    assert.deepEqual(contract.pathContract.selectedSafePath, safeSpan.selectedSafePath);
    assert.deepEqual(contract.pathContract.sourceFlatBufferPath, safeSpan.sourceFlatBufferPath);
    assert.deepEqual(contract.pathContract.destinationFlatBufferPath, safeSpan.destinationFlatBufferPath);
    const run = contract.pathContract.selectedStraightRun;
    for (let index = run.startIndex; index <= run.endIndex; index += 1) {
      const point = plan.bridgePath[index];
      assert.equal(insideAnyRoom(point), false, `${variantId} would alter an authored room tile`);
      assert.equal(bufferKeys.has(`${point.x},${point.z}`), false, `${variantId} would alter a flat socket buffer`);
    }
  }
});

test('variant spans reserve one complete three-lane route around other connector centerlines', () => {
  const plan = makePlan('blocked-side-route', 0);
  plan.connectorVariantConstraints = {
    roomFootprints: [],
    endpointFlatBufferTiles: 2,
    blockedLanePoints: plan.bridgePath.map((point) => ({ x: point.x, z: point.z + 1 })),
  };
  const safeSpan = deriveDungeonConnectorSafeSpan(plan);
  assert.ok(safeSpan);
  assert.deepEqual(safeSpan.selectedLaneOffsets, [-2, -1, 0]);
  for (let index = safeSpan.selectedStraightRun.startIndex;
    index <= safeSpan.selectedStraightRun.endIndex;
    index += 1) {
    const center = plan.bridgePath[index];
    assert.equal(
      safeSpan.blockedLanePoints.some((point) => (
        safeSpan.selectedLaneOffsets.some((offset) => (
          point.x === center.x && point.z === center.z + offset
        ))
      )),
      false,
    );
  }
});

test('elevation variants reserve a flat 3x3 elbow before a straight transfer begins', () => {
  const fullPath = [
    ...Array.from({ length: 7 }, (_, x) => ({ x, z: 0 })),
    ...Array.from({ length: 12 }, (_, index) => ({ x: 6, z: index + 1 })),
  ];
  const plan = makePlan('turned-route', 0, {
    fullPath,
    bridgePath: fullPath,
    fromSocket: { id: 'turned-exit', x: 0, z: 0, facingX: 1, facingZ: 0 },
    toSocket: { id: 'turned-entrance', x: 6, z: 12, facingX: 0, facingZ: -1 },
    connectorVariantConstraints: {
      roomFootprints: [],
      endpointFlatBufferTiles: 2,
      blockedLanePoints: [],
    },
  });
  const safeSpan = deriveDungeonConnectorSafeSpan(plan);
  assert.ok(safeSpan);
  assert.equal(safeSpan.selectedStraightRun.axis, 'z');
  assert.ok(
    safeSpan.selectedStraightRun.startIndex >= 8,
    'the corner plus its first shoulder row must remain flat',
  );
});

test('only long interior V1 ground corridors receive variants regardless of absolute room elevation', () => {
  const eligible = makePlan('eligible', 0);
  const cases = [
    eligible,
    makePlan('short', 1, { bridgePath: makePath(1, 6) }),
    makePlan('upper', 2, { connectorType: 'upper_catwalk_bridge', level: 1, elevation: 4.05 }),
    makePlan('elevated-ground', 5, { elevation: 14 }),
    makePlan('camp', 3, { fromRoomId: 'expeditionCamp' }),
    makePlan('disabled', 4, { allowConnectorVariant: false }),
  ];
  assert.equal(isDungeonConnectorVariantEligible(eligible), true);
  assert.deepEqual(cases.map((plan) => isDungeonConnectorVariantEligible(plan)), [true, false, false, true, false, false]);
  const assigned = assignDungeonConnectorVariants(cases);
  assert.ok(assigned[0].connectorVariant);
  assert.equal(assigned[1].connectorVariant, null);
  assert.equal(assigned[2].connectorVariant, null);
  assert.ok(assigned[3].connectorVariant);
  assert.equal(assigned[4].connectorVariant, null);
  assert.equal(assigned[5].connectorVariant, null);
});

test('longest-run detection handles an authored cardinal turn', () => {
  const path = [
    { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 },
    { x: 2, z: 1 }, { x: 2, z: 2 }, { x: 2, z: 3 }, { x: 2, z: 4 },
  ];
  assert.deepEqual(findLongestConnectorStraightRun(path), {
    startIndex: 2,
    endIndex: 6,
    lengthTiles: 5,
    axis: 'z',
    direction: 1,
  });
});

test('ladder contract owns one signed 14 metre transfer with unobstructed landings', () => {
  const contract = createDungeonConnectorVariantContract(
    makePlan('ladder-route', 0),
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
  );
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(contract.traversalKind, 'ladder');
  assert.equal(contract.mechanisms.length, 1);
  assert.equal(contract.apertures.length, 1);
  assert.ok(contract.landings.length >= 4);
  assert.equal(contract.elevationDelta, 14);
  for (const ladder of contract.mechanisms) {
    assert.equal(ladder.animationId, 'climbingLadder');
    assert.equal(ladder.snapPlayerToLadderPlane, true);
    assert.equal(ladder.alignPlayerFacingOnMount, true);
    assert.ok(ladder.clearDismountDistanceMeters >= 2);
  }
  for (const aperture of contract.apertures) {
    assert.equal(aperture.prohibitCoveringTile, true);
    assert.ok(aperture.widthMeters >= DUNGEON_CONNECTOR_CLEARANCE.minimumApertureWidthMeters);
    assert.ok(aperture.depthMeters >= DUNGEON_CONNECTOR_CLEARANCE.minimumApertureDepthMeters);
  }
  for (const landing of contract.landings) {
    assert.equal(landing.mustRemainFreeOfProps, true);
    assert.ok(landing.widthMeters >= DUNGEON_CONNECTOR_CLEARANCE.minimumLandingWidthMeters);
    assert.ok(landing.clearHeightMeters >= DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters);
  }
});

test('automatic lift contract cannot strand a player waiting for a console', () => {
  const contract = createDungeonConnectorVariantContract(
    makePlan('lift-route', 0),
    DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  );
  const lift = contract.mechanisms[0];
  assert.equal(contract.traversalKind, 'automatic_lift');
  assert.equal(lift.operation, 'automatic_continuous_shuttle');
  assert.equal(lift.automatic, true);
  assert.equal(lift.requiresConsole, false);
  assert.equal(lift.recallMode, 'automatic_return_after_dwell');
  assert.equal(lift.requiresRecallControls, true);
  assert.equal(lift.carrySupportedPlayer, true);
  assert.equal(contract.sweptVolumes.length, 1);
  assert.equal(contract.construction.removeCeilingAcrossSweptVolume, true);
  assert.equal(contract.construction.shaftCeilingMode, 'enclosed_above_upper_landing');
  assert.ok(contract.construction.minimumShaftCeilingClearanceMeters >= 3.6);
  assert.equal(lift.topElevation - lift.bottomElevation, 14);
  assert.equal(lift.platformWidthMeters, 8.4);
  assert.equal(lift.platformDepthMeters, 8.4);
  assert.equal(lift.shaftWidthMeters, 11.2);
  assert.equal(lift.shaftDepthMeters, 11.2);
  assert.equal(contract.apertures[0].widthMeters, 11.2);
  assert.equal(contract.apertures[0].depthMeters, 11.2);
  assert.equal(Object.isFrozen(contract.liftShaft), true);
  assert.equal(Object.isFrozen(contract.liftShaft.center), true);
  assert.equal(Object.isFrozen(contract.liftShaft.gridColumns), true);
  assert.equal(Object.isFrozen(contract.landingSills), true);
  assert.equal(contract.liftShaft.gridColumns.length, 16);
  assert.equal(contract.liftShaft.endPathIndex - contract.liftShaft.startPathIndex, 3);
  assert.deepEqual(
    {
      x: contract.apertures[0].center.x,
      z: contract.apertures[0].center.z,
    },
    {
      x: contract.liftShaft.center.x,
      z: contract.liftShaft.center.z,
    },
  );
  assert.deepEqual(
    {
      x: contract.sweptVolumes[0].center.x,
      z: contract.sweptVolumes[0].center.z,
    },
    {
      x: contract.liftShaft.center.x,
      z: contract.liftShaft.center.z,
    },
  );
  assert.equal(contract.landingSills.length, 2);
  assert.deepEqual(new Set(contract.landingSills.map(({ endpoint }) => endpoint)), new Set([
    'bottom',
    'top',
  ]));
  for (const sill of contract.landingSills) {
    assert.equal(Object.isFrozen(sill), true);
    assert.equal(Object.isFrozen(sill.center), true);
    assert.equal(Object.isFrozen(sill.supportPosts), true);
    assert.equal(sill.blocksBelow, false);
    assert.equal(sill.thicknessMeters, 0.28);
    assert.equal(sill.supportPosts.length, 2);
    assert.ok(sill.supportPosts.every((post) => (
      Object.isFrozen(post)
      && Object.isFrozen(post.center)
      && Object.isFrozen(post.size)
      && post.blocksPlayer === true
    )));
  }
  assert.doesNotThrow(() => JSON.stringify(contract));
  assert.ok(lift.pathIndex >= contract.pathContract.selectedStraightRun.startIndex);
  assert.ok(lift.pathIndex <= contract.pathContract.selectedStraightRun.endIndex);
  assert.equal(contract.construction.provideSlopedReturnToBaseElevation, false);
});

test('slope and service contracts require V1 structures and safe continuous surfaces', () => {
  const plan = makePlan('surface-route', 0);
  const slope = createDungeonConnectorVariantContract(plan, DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE);
  const service = createDungeonConnectorVariantContract(plan, DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY);
  assert.equal(slope.traversalKind, 'slope');
  assert.equal(slope.construction.surfaceStyle, 'v1_tiled_industrial_ramp');
  assert.equal(slope.construction.noFloatingSlabs, true);
  assert.equal(slope.construction.continuousWithLandings, true);
  assert.equal(slope.construction.switchback, true);
  assert.equal(slope.construction.flights.length, 2);
  assert.equal(slope.construction.returnsToSourceElevation, false);
  for (const flight of slope.construction.flights) {
    assert.equal(flight.segmentCount, 13);
    assert.equal(flight.widthTiles, 3);
    assert.equal(flight.riseMeters, 7);
    assert.equal(flight.risePerSegmentMeters, DUNGEON_CONNECTOR_CLEARANCE.maximumSlopeRisePerTileMeters);
  }
  assert.equal(service.traversalKind, 'walk');
  assert.equal(service.construction.supportStyle, 'v1_catwalk_posts_and_cross_braces');
  assert.equal(service.construction.railingStyle, 'v1_industrial_railing');
  assert.ok(service.construction.overheadPipeClearanceMeters >= 3.6);
});

test('legacy slope assignments defer a blocked side choice while explicit V4 sides fail fast', () => {
  const plan = makePlan('blocked-switchback', 0, {
    connectorVariantConstraints: {
      roomFootprints: [
        { roomId: 'positive-blocker', minX: 10, maxX: 10, minZ: 7, maxZ: 7 },
        { roomId: 'negative-blocker', minX: 10, maxX: 10, minZ: -7, maxZ: -7 },
      ],
    },
  });

  const legacyContract = createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
  );
  assert.equal(legacyContract.construction.switchbackSideSign, null);
  const reservation = reserveDungeonConnectorFamilyFootprints([{
    ...plan,
    connectorVariantId: DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
    connectorVariant: legacyContract,
  }]);
  assert.equal(reservation.diagnostics.accepted, false);
  assert.ok(reservation.diagnostics.errors.some((error) => (
    error.includes('no collision-free switchback side reservation')
  )));

  for (const switchbackSideSign of [1, -1]) {
    assert.throws(() => createDungeonConnectorVariantContract(
      plan,
      DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
      { switchbackSideSign },
    ), /no collision-free switchback side/);
  }
});

test('slope contracts preserve an explicitly selected clear switchback side', () => {
  const plan = makePlan('selected-switchback', 0, {
    connectorVariantConstraints: {
      roomFootprints: [
        { roomId: 'positive-blocker', minX: 10, maxX: 10, minZ: 7, maxZ: 7 },
        {
          roomId: 'selected-switchback_from',
          minX: 10,
          maxX: 10,
          minZ: -7,
          maxZ: -7,
        },
      ],
    },
  });
  const contract = createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
    { switchbackSideSign: -1 },
  );

  assert.equal(contract.construction.switchbackSideSign, -1);
  assert.throws(() => createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
    { switchbackSideSign: 1 },
  ), /no collision-free switchback side/);
});

test('every connector family declares a continuous three-tile gallery and V1 decorative arches', () => {
  for (const variantId of DUNGEON_CONNECTOR_VARIANT_ORDER) {
    const contract = createDungeonConnectorVariantContract(makePlan(`wide-gallery-${variantId}`, 0), variantId);
    assert.equal(contract.galleryEnvelope.minimumContinuousWidthTiles, 3);
    assert.equal(contract.galleryEnvelope.minimumContinuousWidthMeters, 8.4);
    assert.equal(contract.galleryEnvelope.appliesAcrossEntireTraversableLength, true);
    assert.equal(contract.galleryEnvelope.singleTileChokePointsPermitted, false);
    assert.equal(contract.decoration.required, true);
    assert.equal(contract.decoration.archFamily, 'v1_connector_cylinder_arch');
    assert.ok(contract.decoration.archSpacingTiles >= 1);
    assert.equal(contract.decoration.continueAcrossElevationTransitions, true);
  }
  const scaled = createDungeonConnectorVariantContract(
    makePlan('scaled-gallery', 0),
    DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
    { tileSize: 3.2 },
  );
  assert.equal(scaled.galleryEnvelope.minimumContinuousWidthMeters, 9.6);
});

test('assignment validation rejects narrow galleries and missing decorative arches', () => {
  const plans = Array.from({ length: 4 }, (_, index) => makePlan(`gallery-validation-${index}`, index * 3));
  const assigned = assignDungeonConnectorVariants(plans);

  const narrowed = structuredClone(assigned);
  narrowed[0].connectorVariant.galleryEnvelope.minimumContinuousWidthTiles = 1;
  narrowed[0].connectorVariant.galleryEnvelope.minimumContinuousWidthMeters = 2.8;
  const narrowResult = validateDungeonConnectorVariantAssignments(plans, narrowed);
  assert.equal(narrowResult.ok, false);
  assert.ok(narrowResult.errors.some((error) => error.includes('minimum continuous gallery width')));

  const undecorated = structuredClone(assigned);
  undecorated[0].connectorVariant.decoration.required = false;
  undecorated[0].connectorVariant.decoration.archFamily = null;
  const decorationResult = validateDungeonConnectorVariantAssignments(plans, undecorated);
  assert.equal(decorationResult.ok, false);
  assert.ok(decorationResult.errors.some((error) => error.includes('V1 decorative arch treatment')));
});

test('all elevation families expose mirrored ascending and descending endpoint contracts', () => {
  for (const variantId of [
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  ]) {
    for (const [direction, destinationElevation] of [
      ['ascending', 21],
      ['descending', -7],
    ]) {
      const contract = createDungeonConnectorVariantContract(
        makePlan(`${variantId}-${direction}`, 0),
        variantId,
        { sourceElevation: 7, destinationElevation, direction },
      );
      const expectedDelta = direction === 'ascending' ? 14 : -14;
      assert.equal(contract.sourceElevation, 7);
      assert.equal(contract.destinationElevation, destinationElevation);
      assert.equal(contract.elevationDelta, expectedDelta);
      assert.equal(contract.direction, direction);
      assert.equal(contract.sourceEndpoint.y, 7);
      assert.equal(contract.destinationEndpoint.y, destinationElevation);
      assert.equal(contract.higherEndpoint.elevation, Math.max(7, destinationElevation));
      assert.equal(contract.lowerEndpoint.elevation, Math.min(7, destinationElevation));
      assert.deepEqual(
        contract.pathContract.orderedSourceToDestinationPath,
        makePlan('unused', 0).bridgePath,
      );
    }
  }
});

test('strict V4 connector contracts honor exact 2.8m-quantized elevation deltas', () => {
  for (const variantId of [
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  ]) {
    for (const [direction, sourceElevation, destinationElevation] of [
      ['ascending', 0, 2.8],
      ['descending', 5.6, 2.8],
    ]) {
      const contract = createDungeonConnectorVariantContract(
        makePlan(`strict-v4-${variantId}-${direction}`, 0),
        variantId,
        {
          sourceElevation,
          destinationElevation,
          direction,
          allowExactQuantizedElevationDelta: true,
        },
      );
      assert.equal(contract.sourceElevation, sourceElevation);
      assert.equal(contract.destinationElevation, destinationElevation);
      assert.ok(Math.abs(
        contract.elevationDelta - (destinationElevation - sourceElevation),
      ) < 1e-9);
      assert.equal(contract.direction, direction);
      if (contract.traversalKind === 'slope') {
        assert.ok(contract.construction.flights.every((flight) => (
          Math.abs(Math.abs(flight.riseMeters) - 1.4) < 1e-9
            && Math.abs(Math.abs(flight.risePerSegmentMeters)
              - (1.4 / DUNGEON_CONNECTOR_CLEARANCE.slopeSegmentsPerFlight)) < 1e-6
        )));
      } else {
        assert.ok(Math.abs(
          contract.sweptVolumes[0].size.y
            - (2.8 + DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters),
        ) < 1e-9);
      }
    }
  }

  const plan = makePlan('strict-v4-invalid-delta', 0);
  assert.throws(() => createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    { sourceElevation: 0, destinationElevation: 2.8, direction: 'ascending' },
  ), /exactly 14 metres/);
  assert.throws(() => createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    {
      sourceElevation: 0,
      destinationElevation: 1.4,
      direction: 'ascending',
      allowExactQuantizedElevationDelta: true,
    },
  ), /2.8 metre-quantized/);
  assert.throws(() => createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    {
      sourceElevation: 0,
      destinationElevation: 16.8,
      direction: 'ascending',
      allowExactQuantizedElevationDelta: true,
    },
  ), /no greater than 14 metres/);
  assert.throws(() => createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    {
      sourceElevation: 0,
      destinationElevation: 2.8,
      direction: 'descending',
      allowExactQuantizedElevationDelta: true,
    },
  ), /disagrees with its exact elevation delta/);
});

test('service galleries are explicitly level and reject a nonzero destination delta', () => {
  const plan = makePlan('level-service', 0);
  const contract = createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
    { sourceElevation: -14, direction: 'level' },
  );
  assert.equal(contract.sourceElevation, -14);
  assert.equal(contract.destinationElevation, -14);
  assert.equal(contract.elevationDelta, 0);
  assert.equal(contract.direction, 'level');
  assert.equal(contract.higherEndpoint, null);
  assert.equal(contract.lowerEndpoint, null);
  assert.throws(() => createDungeonConnectorVariantContract(
    plan,
    DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
    { sourceElevation: 0, destinationElevation: 14 },
  ), /zero elevation delta/);
});

test('planner returns immutable room elevations without mutating rooms or plans', () => {
  const plans = Array.from({ length: 9 }, (_, index) => makePlan(`chain-${index}`, index * 3, {
    fromRoomId: `room-${index}`,
    toRoomId: `room-${index + 1}`,
    requiredForProgression: true,
  }));
  const snapshot = structuredClone(plans);
  const result = planDungeonConnectorVariantAssignments(plans, {
    elevationConnectorCount: 5,
    initialRoomElevations: { 'room-0': 0 },
  });
  assert.equal(result.diagnostics.accepted, true, result.diagnostics.errors.join('\n'));
  assert.ok(result.diagnostics.selectedElevationConnectorCount >= 3);
  assert.ok(result.diagnostics.selectedElevationConnectorCount <= 5);
  assert.ok(result.diagnostics.verticalSpanMeters <= 56);
  assert.equal(Object.isFrozen(result.roomElevations), true);
  assert.deepEqual(plans, snapshot);

  for (const plan of result.connectionPlans) {
    assert.equal(plan.fromSocket.elevation, result.roomElevations[plan.fromRoomId]);
    assert.equal(plan.toSocket.elevation, result.roomElevations[plan.toRoomId]);
    if (plan.connectorVariantId === DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY) {
      assert.equal(plan.elevationDelta, 0);
      assert.equal(plan.sourceElevation, plan.destinationElevation);
    } else {
      assert.equal(Math.abs(plan.elevationDelta), DUNGEON_CONNECTOR_ELEVATION_POLICY.transferElevationMeters);
    }
  }
});

test('planner rejects an impossible vertical span and root-path transfer budget', () => {
  const plans = Array.from({ length: 6 }, (_, index) => makePlan(`bounded-${index}`, index * 3, {
    fromRoomId: `bounded-room-${index}`,
    toRoomId: `bounded-room-${index + 1}`,
    requiredForProgression: true,
  }));
  const spanRejected = planDungeonConnectorVariantAssignments(plans, {
    elevationConnectorCount: 3,
    initialRoomElevations: { 'bounded-room-0': 0 },
    maximumDungeonVerticalSpanMeters: 13,
  });
  assert.equal(spanRejected.diagnostics.accepted, false);
  assert.ok(spanRejected.diagnostics.errors.some((error) => (
    error.includes('vertical-span limits')
  )));

  const pathRejected = planDungeonConnectorVariantAssignments(plans, {
    elevationConnectorCount: 3,
    initialRoomElevations: { 'bounded-room-0': 0 },
    maximumElevationTransfersPerRootPath: 2,
  });
  assert.equal(pathRejected.diagnostics.accepted, false);
  assert.ok(pathRejected.diagnostics.errors.some((error) => (
    error.includes('vertical-span limits')
  )));
});

test('planner rejects a merged room whose level shortcut conflicts with three signed transfers', () => {
  const plans = Array.from({ length: 3 }, (_, index) => makePlan(`merge-chain-${index}`, index * 3, {
    fromRoomId: `merge-room-${index}`,
    toRoomId: `merge-room-${index + 1}`,
    requiredForProgression: true,
  }));
  const shortPath = makePath(18, 6);
  plans.push(makePlan('merge-level-shortcut', 18, {
    fromRoomId: 'merge-room-0',
    toRoomId: 'merge-room-3',
    fullPath: shortPath,
    bridgePath: shortPath,
    requiredForProgression: true,
  }));

  const result = planDungeonConnectorVariantAssignments(plans, {
    elevationConnectorCount: 3,
    initialRoomElevations: { 'merge-room-0': 0 },
  });
  assert.equal(result.diagnostics.accepted, false);
  assert.ok(result.diagnostics.errors.some((error) => (
    error.includes('No signed connector assignment')
  )));
});

test('assignment validation independently enforces the 56m span and four-transfer path limits', () => {
  const independent = Array.from({ length: 5 }, (_, index) => makePlan(`span-${index}`, index * 3, {
    fromRoomId: `span-source-${index}`,
    toRoomId: `span-destination-${index}`,
  }));
  const spanningAssignments = [
    makeExplicitAssignedPlan(independent[0], DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE, 0, 14),
    makeExplicitAssignedPlan(independent[1], DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY, 0, -14),
    makeExplicitAssignedPlan(independent[2], DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT, 70, 84),
    makeExplicitAssignedPlan(independent[3], DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY, 28, 42),
    makeExplicitAssignedPlan(independent[4], DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY, 56, 42),
  ];
  const spanValidation = validateDungeonConnectorVariantAssignments(
    independent,
    spanningAssignments,
  );
  assert.equal(spanValidation.ok, false);
  assert.ok(spanValidation.errors.some((error) => error.includes('56 metre')));
  assert.equal(spanValidation.errors.some((error) => error.includes('root-to-leaf')), false);

  const chain = Array.from({ length: 5 }, (_, index) => makePlan(`path-${index}`, index * 3, {
    fromRoomId: `path-room-${index}`,
    toRoomId: `path-room-${index + 1}`,
  }));
  const pathElevations = [0, 14, 28, 42, 56, 42];
  const pathVariants = [
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
    DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
  ];
  const pathAssignments = chain.map((plan, index) => makeExplicitAssignedPlan(
    plan,
    pathVariants[index],
    pathElevations[index],
    pathElevations[index + 1],
  ));
  const pathValidation = validateDungeonConnectorVariantAssignments(chain, pathAssignments);
  assert.equal(pathValidation.ok, false);
  assert.ok(pathValidation.errors.some((error) => error.includes('root-to-leaf')));
  assert.equal(pathValidation.errors.some((error) => error.includes('56 metre')), false);
});

test('parallel upper V1 routes keep their paired ground connection level', () => {
  const plans = Array.from({ length: 6 }, (_, index) => makePlan(`parallel-${index}`, index * 3, {
    fromRoomId: `parallel-room-${index}`,
    toRoomId: `parallel-room-${index + 1}`,
  }));
  plans.push(makePlan('parallel-upper', 30, {
    fromRoomId: 'parallel-room-2',
    toRoomId: 'parallel-room-3',
    connectorType: 'upper_catwalk_bridge',
    level: 1,
    elevation: 4.05,
  }));
  const result = planDungeonConnectorVariantAssignments(plans, { elevationConnectorCount: 3 });
  const pairedGround = result.connectionPlans.find((plan) => plan.id === 'parallel-2');
  const upper = result.connectionPlans.find((plan) => plan.id === 'parallel-upper');
  assert.equal(pairedGround.connectorVariantId, DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY);
  assert.equal(pairedGround.elevationDelta, 0);
  assert.equal(upper.connectorVariant, null);
  assert.equal(upper.elevationDelta, 0);
});

test('contracts remain serializable and contain no renderer objects or predicates', () => {
  for (const variantId of DUNGEON_CONNECTOR_VARIANT_ORDER) {
    const contract = createDungeonConnectorVariantContract(makePlan(`serial-${variantId}`, 0), variantId);
    const serialized = JSON.stringify(contract);
    assert.ok(serialized.includes(variantId));
    assert.equal(serialized.includes('THREE'), false);
    const visit = (value) => {
      assert.notEqual(typeof value, 'function');
      if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(contract);
  }
});
