import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUNGEON_CONNECTOR_CLEARANCE,
  DUNGEON_CONNECTOR_VARIANT_IDS,
  DUNGEON_CONNECTOR_VARIANT_ORDER,
  assignDungeonConnectorVariants,
  computeDungeonConnectorStableHash,
  createDungeonConnectorVariantContract,
  deriveDungeonConnectorSafeSpan,
  findLongestConnectorStraightRun,
  isDungeonConnectorVariantEligible,
  validateDungeonConnectorVariantAssignments,
} from '../src/DungeonConnectorVariants.js';

const makePath = (offsetZ = 0, length = 13) => Array.from(
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

test('connector assignment is deterministic, balanced, and does not consume a supplied RNG', () => {
  const plans = Array.from({ length: 12 }, (_, index) => makePlan(`route-${index}`, index * 3));
  const snapshot = structuredClone(plans);
  let randomCalls = 0;
  const options = { random: () => { randomCalls += 1; return 0.25; } };
  const first = assignDungeonConnectorVariants(plans, options);
  const second = assignDungeonConnectorVariants(structuredClone(plans), options);

  assert.deepEqual(first, second);
  assert.deepEqual(plans, snapshot, 'input plans must not be mutated');
  assert.equal(randomCalls, 0, 'variant assignment must not read the generator random stream');
  assert.deepEqual(
    new Set(first.map((plan) => plan.connectorVariantId)),
    new Set(DUNGEON_CONNECTOR_VARIANT_ORDER),
  );
  assert.equal(validateDungeonConnectorVariantAssignments(plans, first).ok, true);
});

test('scarce real-layout spans always produce distinct elevation-changing connectors', () => {
  for (const count of [1, 2, 3]) {
    const plans = Array.from({ length: count }, (_, index) => (
      makePlan(`scarce-${count}-${index}`, index * 3)
    ));
    const assigned = assignDungeonConnectorVariants(plans);
    const variants = assigned.map((plan) => plan.connectorVariantId);
    assert.equal(variants.length, count);
    assert.equal(new Set(variants).size, count);
    assert.equal(
      variants.includes(DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY),
      false,
      'a scarce safe span must add traversal variety rather than another flat hall',
    );
    assert.equal(validateDungeonConnectorVariantAssignments(plans, assigned).ok, true);
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
    assert.deepEqual(assigned[index].fromSocket, plans[index].fromSocket);
    assert.deepEqual(assigned[index].toSocket, plans[index].toSocket);
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

test('only long, ground-level, interior V1 corridors receive variants', () => {
  const eligible = makePlan('eligible', 0);
  const cases = [
    eligible,
    makePlan('short', 1, { bridgePath: makePath(1, 6) }),
    makePlan('upper', 2, { connectorType: 'upper_catwalk_bridge', level: 1, elevation: 4.05 }),
    makePlan('camp', 3, { fromRoomId: 'expeditionCamp' }),
    makePlan('disabled', 4, { allowConnectorVariant: false }),
  ];
  assert.equal(isDungeonConnectorVariantEligible(eligible), true);
  assert.deepEqual(cases.map((plan) => isDungeonConnectorVariantEligible(plan)), [true, false, false, false, false]);
  const assigned = assignDungeonConnectorVariants(cases);
  assert.ok(assigned[0].connectorVariant);
  for (const plan of assigned.slice(1)) assert.equal(plan.connectorVariant, null);
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

test('ladder contract owns aligned mounting, two unobstructed apertures, and clear landings', () => {
  const contract = createDungeonConnectorVariantContract(
    makePlan('ladder-route', 0),
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
  );
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(contract.traversalKind, 'ladder');
  assert.equal(contract.mechanisms.length, 2);
  assert.equal(contract.apertures.length, 2);
  assert.ok(contract.landings.length >= 6);
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
  assert.equal(lift.carrySupportedPlayer, true);
  assert.equal(contract.sweptVolumes.length, 1);
  assert.equal(contract.construction.removeCeilingAcrossSweptVolume, false);
  assert.equal(contract.construction.shaftCeilingMode, 'enclosed_above_rider_clearance');
  assert.ok(contract.construction.minimumShaftCeilingClearanceMeters >= 3.6);
  assert.ok(contract.apertures[0].widthMeters > lift.platformWidthMeters);
  assert.ok(contract.apertures[0].depthMeters > lift.platformDepthMeters);
  assert.ok(lift.pathIndex >= contract.pathContract.selectedStraightRun.startIndex);
  assert.ok(lift.pathIndex <= contract.pathContract.selectedStraightRun.endIndex);
  assert.ok(
    lift.topElevation - lift.bottomElevation
      <= contract.construction.slopedReturn.minimumRunTiles
        * contract.construction.slopedReturn.maximumRisePerTileMeters,
  );
});

test('slope and service contracts require V1 structures and safe continuous surfaces', () => {
  const plan = makePlan('surface-route', 0);
  const slope = createDungeonConnectorVariantContract(plan, DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE);
  const service = createDungeonConnectorVariantContract(plan, DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY);
  assert.equal(slope.traversalKind, 'slope');
  assert.equal(slope.construction.surfaceStyle, 'v1_tiled_industrial_ramp');
  assert.equal(slope.construction.noFloatingSlabs, true);
  assert.equal(slope.construction.continuousWithLandings, true);
  assert.ok(slope.construction.ascent.maximumRisePerTileMeters <= 0.5);
  assert.ok((slope.construction.ascent.minimumRunTiles * 2) + 1 <= findLongestConnectorStraightRun(plan.bridgePath).lengthTiles);
  assert.equal(service.traversalKind, 'walk');
  assert.equal(service.construction.supportStyle, 'v1_catwalk_posts_and_cross_braces');
  assert.equal(service.construction.railingStyle, 'v1_industrial_railing');
  assert.ok(service.construction.overheadPipeClearanceMeters >= 3.6);
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
