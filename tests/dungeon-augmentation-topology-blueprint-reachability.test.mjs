import assert from 'node:assert/strict';
import test from 'node:test';
import {
  balanceObjectiveRouteGrammarIntervals,
  composeStackedInterchangeSupportCompound,
  coveragePayoffGrammarIdsForStationBay,
  coverageTraversalBranchBindings,
  coverageTraversalSocketContractForGrammar,
  createRouteNetworkEndpointDomain,
  createDungeonRouteEndpointSeam,
  closestPlacementCandidate,
  closestPlacementCandidatesPerFacing,
  DENSE_OBJECTIVE_COVERAGE_SEARCH_VARIANTS,
  DUNGEON_AUGMENTATION_PROFILES,
  exactLandmarkEndpointNodeCenter,
  filterDenseObjectiveCoverageElevationModes,
  filterRouteNetworkEndpointDomains,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  interleavedCartesianIndexPairs,
  interleavedRouteNetworkCandidateSignatures,
  LANDMARK_SHARED_THRESHOLD_ATTACHMENT_GAP_METERS,
  landmarkEndpointPlacementVariantIndex,
  mergeReservedPlacementCandidates,
  minimumVerticalRouteFeaturelessSpanMeters,
  nodePlanningCollisionScore,
  objectiveCoverageEndpointGrammarIsSelectable,
  objectiveCoverageEndpointOrderAlternatives,
  orderDenseObjectiveCoverageFamilyChoices,
  orderRouteNetworkGrantOrdinalsByEndpointDomain,
  orderCoverageRoomIndicesForArc,
  orientOrderedCandidateChainAtFailure,
  orientOrderedCandidateTreeAtFailure,
  ordinaryRouteNetworkSocketGapMeters,
  reserveOrderedCandidateChain,
  reserveOrderedCandidateTree,
  routeNetworkGrammarHasPurposefulAuthoredVerticalTraversal,
  routeNetworkGrammarPairAlternativeOrdinals,
  routeNetworkPlanningOverlapIsGranted,
  routeNetworkSpineSocketIds,
  resolveRouteNetworkGrammarAssignments,
  resolveStackedInterchangeSupportAllocation,
  routeNetworkNodeResetsFeaturelessDistance,
  routeNetworkEndpointDomainCandidatesForGrammar,
  routeNetworkTopologyIsLegalForGrant,
  routeNetworkTopologySupportsModuleCount,
  rotationQuarterTurnsForFacing,
  selectCoverageTraversalConnectorIndices,
  shouldAttemptCorrelatedPlacementRepair,
  transformDungeonLocalPoint,
  transformDungeonVolume,
} from '../src/dungeon-augmentation/index.js';

const profile = DUNGEON_AUGMENTATION_PROFILES['industrial-supplement-preview-v4'];

test('objective coverage retries are canonical-first exact endpoint permutations', () => {
  const west = { id: 'west', distanceMeters: 0 };
  const eastLow = { id: 'east-low', distanceMeters: 10 };
  const eastHigh = { id: 'east-high', distanceMeters: 20 };
  const sourceEndpoints = [eastHigh, west, eastLow];
  const alternatives = objectiveCoverageEndpointOrderAlternatives(sourceEndpoints);
  const endpointIdOrders = alternatives.map((order) => order.map(({ id }) => id));

  assert.deepEqual(endpointIdOrders, [
    ['west', 'east-low', 'east-high'],
    ['east-low', 'east-high', 'west'],
    ['east-high', 'west', 'east-low'],
    ['east-high', 'east-low', 'west'],
    ['east-low', 'west', 'east-high'],
    ['west', 'east-high', 'east-low'],
  ]);
  assert.equal(new Set(endpointIdOrders.map((ids) => ids.join(':'))).size, 6);
  for (const order of alternatives) {
    assert.deepEqual(
      [...order].map(({ id }) => id).sort(),
      ['east-high', 'east-low', 'west'],
      'every retry preserves the exact granted attachment set',
    );
    assert.ok(order.every((endpoint) => sourceEndpoints.includes(endpoint)));
  }
  assert.deepEqual(
    objectiveCoverageEndpointOrderAlternatives([...sourceEndpoints].reverse())
      .map((order) => order.map(({ id }) => id)),
    endpointIdOrders,
    'input enumeration does not perturb canonical retry serialization',
  );
});

test('dense V4 branch coverage filters elevation families without a level authored transfer', () => {
  const elevationModes = ['lift', 'slope', 'ladder', 'split-level-platform'];
  const denseGrant = {
    kind: 'objective-route-coverage',
    endpointSockets: [{ id: 'first' }, { id: 'second' }, { id: 'third' }],
  };
  const filtered = filterDenseObjectiveCoverageElevationModes({
    profile,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    grant: denseGrant,
    elevationModes,
  });

  assert.deepEqual(filtered, ['slope', 'split-level-platform']);
  assert.deepEqual(
    elevationModes,
    ['lift', 'slope', 'ladder', 'split-level-platform'],
    'compatibility filtering must not mutate the elevation bag domain',
  );
  assert.deepEqual(filterDenseObjectiveCoverageElevationModes({
    profile,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    grant: { ...denseGrant, endpointSockets: denseGrant.endpointSockets.slice(0, 2) },
    elevationModes,
  }), elevationModes, 'ordinary two-station coverage retains its exact domain');
  assert.deepEqual(filterDenseObjectiveCoverageElevationModes({
    profile: DUNGEON_AUGMENTATION_PROFILES['industrial-supplement-preview-v3'],
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    grant: denseGrant,
    elevationModes,
  }), elevationModes, 'legacy profile domains remain byte-for-byte compatible');
  assert.deepEqual(filterDenseObjectiveCoverageElevationModes({
    profile,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    grant: { ...denseGrant, kind: 'landmark-perimeter-loop' },
    elevationModes,
  }), elevationModes, 'non-coverage grants retain their exact domain');
});

test('purposeful authored elevation requires one floor-supported 2.8 m transfer component', () => {
  const observation = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
    'supplement-blueprint-ind-room-observation-break-01-v1'
  ];
  const foundry = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
    'supplement-blueprint-ind-room-reaverbot-foundry-01-v1'
  ];
  const switchback = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
    'supplement-blueprint-ind-rise-switchback-ramp-01-v1'
  ];
  const forkMerge = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
    'supplement-route-connector-fork-merge-v1'
  ];

  assert.deepEqual(observation.selectionConstraints.authoredTransferKinds, ['step']);
  assert.deepEqual(
    observation.structure.physicalTransfers.map(({ endpoints }) => [
      endpoints.from.elevation,
      endpoints.to.elevation,
    ]),
    [[0, 0.7]],
    'the optional observation spur advertises transfer metadata but spans less than one tier',
  );
  assert.equal(
    routeNetworkGrammarHasPurposefulAuthoredVerticalTraversal(observation, 'slope'),
    false,
  );
  assert.equal(
    routeNetworkGrammarHasPurposefulAuthoredVerticalTraversal(forkMerge, 'slope'),
    false,
    'the paired-T topology room owns no authored upper floor or transfer',
  );
  assert.equal(
    routeNetworkGrammarHasPurposefulAuthoredVerticalTraversal(foundry, 'slope'),
    true,
    'a direct 0-to-2.8 m ramp remains eligible',
  );
  assert.equal(
    routeNetworkGrammarHasPurposefulAuthoredVerticalTraversal(switchback, 'slope'),
    true,
    'support-linked 1.4 m flights remain one purposeful 2.8 m transfer chain',
  );
  assert.equal(
    routeNetworkGrammarHasPurposefulAuthoredVerticalTraversal(foundry, 'lift'),
    false,
    'a full-tier transfer from the wrong requested family is not interchangeable',
  );

  const floorEndpoint = (elevation) => ({
    elevation,
    localSupportRef: { kind: 'floor-cell', floorTierId: elevation === 0 ? 'base' : 'upper' },
  });
  const transferEndpoint = (elevation, transferId) => ({
    elevation,
    localSupportRef: { kind: 'transfer-cell', transferId },
  });
  const grammarWithTransfers = (physicalTransfers) => ({
    structure: { physicalTransfers },
  });
  const linkedLift = grammarWithTransfers([
    {
      id: 'lower-lift',
      form: 'lift',
      endpoints: {
        from: floorEndpoint(0),
        to: transferEndpoint(1.4, 'mid-landing'),
      },
    },
    {
      id: 'mid-landing',
      form: 'landing',
      endpoints: {
        from: transferEndpoint(1.4, 'lower-lift'),
        to: transferEndpoint(1.4, 'upper-lift'),
      },
    },
    {
      id: 'upper-lift',
      form: 'lift',
      endpoints: {
        from: transferEndpoint(1.4, 'mid-landing'),
        to: floorEndpoint(2.8),
      },
    },
  ]);
  assert.equal(
    routeNetworkGrammarHasPurposefulAuthoredVerticalTraversal(linkedLift, 'lift'),
    true,
    'a level landing may join requested-family legs into one full-tier component',
  );
  assert.equal(
    routeNetworkGrammarHasPurposefulAuthoredVerticalTraversal(grammarWithTransfers([{
      id: 'ladder',
      form: 'ladder',
      endpoints: { from: floorEndpoint(0), to: floorEndpoint(2.8) },
    }]), 'ladder'),
    true,
  );
  assert.equal(
    routeNetworkGrammarHasPurposefulAuthoredVerticalTraversal(grammarWithTransfers([
      {
        id: 'partial-lift',
        form: 'lift',
        endpoints: {
          from: floorEndpoint(0),
          to: transferEndpoint(1.4, 'rising-ramp'),
        },
      },
      {
        id: 'rising-ramp',
        form: 'ramp',
        endpoints: {
          from: transferEndpoint(1.4, 'partial-lift'),
          to: floorEndpoint(2.8),
        },
      },
    ]), 'lift'),
    false,
    'a wrong-family rising leg cannot complete the requested transfer component',
  );
  assert.equal(
    routeNetworkGrammarHasPurposefulAuthoredVerticalTraversal(grammarWithTransfers([{
      id: 'rising-landing',
      form: 'landing',
      endpoints: { from: floorEndpoint(0), to: floorEndpoint(2.8) },
    }]), 'slope'),
    false,
    'a landing is neutral support and cannot prove a tier change by itself',
  );
});

test('fork-merge coverage cannot satisfy slope with its payoff observation step', () => {
  const contentRoles = ['junction', 'challenge', 'reward', 'junction'];
  const moduleKinds = ['connector-module', 'room', 'room', 'connector-module'];
  const endpointNodeIndices = [0, 3];
  const assignment = resolveRouteNetworkGrammarAssignments({
    profile,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    routeNetworkKind: 'objective-route-coverage',
    topologyTemplateId: 'fork-merge-h-loop',
    junctionKinds: Array(4).fill('through-t'),
    contentRoles,
    moduleKinds,
    junctionModuleIndex: 0,
    operationOrdinal: 0,
    searchVariant: 0,
    elevationMode: 'slope',
  });

  assert.deepEqual(contentRoles, ['junction', 'challenge', 'reward', 'junction']);
  assert.deepEqual(moduleKinds, ['connector-module', 'room', 'room', 'connector-module']);
  assert.equal(assignment.topologyKitModuleIndex, 1);
  assert.deepEqual(endpointNodeIndices, [0, 3]);
  assert.deepEqual(
    assignment.selectedGrammars.map(({ id }) => id),
    [
      'supplement-route-connector-through-t-v1',
      'supplement-route-connector-fork-merge-v1',
      'supplement-blueprint-ind-room-dispatch-vault-01-v1',
      'supplement-route-connector-through-t-v1',
    ],
  );

  const result = balanceObjectiveRouteGrammarIntervals({
    profile,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    selectedGrammars: assignment.selectedGrammars,
    contentRoles,
    moduleKinds,
    endpointNodeIndices,
    topologyKitModuleIndex: assignment.topologyKitModuleIndex,
    elevationMode: 'slope',
  });

  assert.deepEqual(result, {
    balanced: false,
    reason: 'authored-rise-return-pair-unavailable',
    intervals: [{ first: 0, second: 3, roomIndices: [2] }],
    excludedNodeIndices: [],
  });
  assert.equal(
    assignment.selectedGrammars[2].id,
    'supplement-blueprint-ind-room-dispatch-vault-01-v1',
    'the only level reward with transfer metadata is the non-purposeful observation step',
  );
});

test('authored rise/descent alternatives replace one modular room before both', () => {
  assert.deepEqual(routeNetworkGrammarPairAlternativeOrdinals(2, 2), [
    { riseCandidateOrdinal: 0, descentCandidateOrdinal: 0 },
    { riseCandidateOrdinal: 1, descentCandidateOrdinal: 0 },
    { riseCandidateOrdinal: 0, descentCandidateOrdinal: 1 },
    { riseCandidateOrdinal: 1, descentCandidateOrdinal: 1 },
  ]);
  assert.deepEqual(routeNetworkGrammarPairAlternativeOrdinals(0, 2), []);
  assert.deepEqual(routeNetworkGrammarPairAlternativeOrdinals(2, 0), []);
});

test('a later coverage candidate can replace only its conflicting rise module', () => {
  const contentRoles = ['junction', 'challenge', 'elevation', 'reward', 'junction'];
  const moduleKinds = ['connector-module', 'room', 'room', 'room', 'connector-module'];
  const assignment = resolveRouteNetworkGrammarAssignments({
    profile,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    routeNetworkKind: 'objective-route-coverage',
    topologyTemplateId: 'split-level-ring',
    junctionKinds: Array(5).fill('through-t'),
    contentRoles,
    moduleKinds,
    junctionModuleIndex: 0,
    operationOrdinal: 1,
    searchVariant: 3,
    elevationMode: 'slope',
  });
  const balanceAt = (selectionAlternativeOrdinal) => {
    const selectedGrammars = [...assignment.selectedGrammars];
    const result = balanceObjectiveRouteGrammarIntervals({
      profile,
      grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
      selectedGrammars,
      contentRoles,
      moduleKinds,
      endpointNodeIndices: [0, 4],
      topologyKitModuleIndex: assignment.topologyKitModuleIndex,
      operationOrdinal: 1,
      searchVariant: 3,
      elevationMode: 'slope',
      selectionAlternativeOrdinal,
    });
    return { result, grammarIds: selectedGrammars.map(({ id }) => id) };
  };
  const canonical = balanceAt(0);
  const replacement = balanceAt(3);

  assert.equal(assignment.topologyKitModuleIndex, null);
  assert.deepEqual(canonical.result, {
    balanced: true,
    intervalDeltas: [{ first: 0, second: 4, delta: 0 }],
    riseIndex: 1,
    descentIndex: 2,
    selectionAlternativeOrdinal: 0,
    selectedGrammarAlternativeOrdinal: 0,
    grammarAlternativeCount: 23,
  });
  assert.deepEqual(replacement.result, {
    ...canonical.result,
    selectionAlternativeOrdinal: 3,
    selectedGrammarAlternativeOrdinal: 3,
  });
  assert.deepEqual(canonical.grammarIds, [
    'supplement-route-connector-through-t-v1',
    'supplement-blueprint-ind-room-inclined-sorter-01-v1',
    'supplement-blueprint-ind-room-switchgear-cache-descent-01-v1',
    'supplement-blueprint-ind-room-dispatch-vault-01-v1',
    'supplement-route-connector-through-t-v1',
  ]);
  assert.deepEqual(replacement.grammarIds, [
    'supplement-route-connector-through-t-v1',
    'supplement-route-room-compact-ramp-defense-rise-v1',
    ...canonical.grammarIds.slice(2),
  ]);
});

test('dense objective coverage spends four slots across endpoint and socket alternatives', () => {
  assert.deepEqual(
    [...DENSE_OBJECTIVE_COVERAGE_SEARCH_VARIANTS],
    [0, 15, 3, 9],
  );
  assert.deepEqual(
    DENSE_OBJECTIVE_COVERAGE_SEARCH_VARIANTS.map((variant) => ({
      endpointOrderVariant: variant % 6,
      traversalSocketAlternative: Math.floor(variant / 6),
    })),
    [
      { endpointOrderVariant: 0, traversalSocketAlternative: 0 },
      { endpointOrderVariant: 3, traversalSocketAlternative: 2 },
      { endpointOrderVariant: 3, traversalSocketAlternative: 0 },
      { endpointOrderVariant: 3, traversalSocketAlternative: 1 },
    ],
  );
  const physicalSignatures = DENSE_OBJECTIVE_COVERAGE_SEARCH_VARIANTS.map(
    (placementVariant) => ({
      moduleCount: 6,
      elevationMode: 'split-level-platform',
      placementVariant,
    }),
  );
  const familyChoices = Array.from({ length: 8 }, (_, familyOrdinal) => ({
    familyOrdinal,
  }));
  const candidates = interleavedRouteNetworkCandidateSignatures({
    physicalSignatures,
    familyChoices: orderDenseObjectiveCoverageFamilyChoices(familyChoices),
  });
  assert.deepEqual(
    candidates.slice(0, 8).map(({ placementVariant }) => placementVariant),
    [0, 15, 3, 9, 0, 15, 3, 9],
    'the real family interleaver exposes all four physical variants twice in its first eight slots',
  );
  assert.deepEqual(
    candidates.slice(0, 8).map(({ familyOrdinal }) => familyOrdinal),
    [0, 3, 1, 2, 4, 5, 6, 7],
    'the same bounded window advances the independent topology/junction family axis',
  );
});

test('authored topology sockets are excluded from the ordinary spine domain', () => {
  const crossover = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
    'supplement-route-connector-over-under-v1'
  ];
  assert.deepEqual(routeNetworkSpineSocketIds(crossover), ['entry', 'exit']);
  assert.deepEqual(
    crossover.selectionConstraints.routeNetworkTopologySocketIds,
    ['left', 'right'],
  );
});

test('mandatory route-network MRV pins the pyramid and preserves canonical ties', () => {
  const grants = [
    { grant: { id: 'coverage-roomy', kind: 'objective-route-coverage', required: true } },
    { grant: { id: 'pyramid', kind: 'landmark-perimeter-loop', required: true } },
    { grant: { id: 'optional', kind: 'cross-band-shortcut', required: false } },
    { grant: { id: 'coverage-tight', kind: 'objective-route-coverage', required: true } },
    { grant: { id: 'coverage-tie', kind: 'objective-route-coverage', required: true } },
  ];
  const summaries = new Map([
    ['coverage-roomy', {
      minimumEndpointCandidateCount: 12,
      viableCombinationCount: 144,
    }],
    ['coverage-tight', {
      minimumEndpointCandidateCount: 2,
      viableCombinationCount: 8,
    }],
    ['coverage-tie', {
      minimumEndpointCandidateCount: 2,
      viableCombinationCount: 8,
    }],
  ]);

  assert.deepEqual(orderRouteNetworkGrantOrdinalsByEndpointDomain(
    grants,
    [0, 1, 2, 3, 4],
    summaries,
  ), [1, 3, 4, 0, 2]);
  assert.deepEqual(orderRouteNetworkGrantOrdinalsByEndpointDomain(
    grants,
    [0, 2, 3, 4],
    summaries,
  ), [3, 4, 0, 2]);
});

test('dynamic endpoint filtering lazily widens a consumed domain and preserves AC support', () => {
  const volume = (id, x) => ({
    id,
    ownerId: id,
    center: { x, y: 0, z: 0 },
    size: { x: 2, y: 2, z: 2 },
  });
  let fallbackFactoryCalls = 0;
  const endpointDomains = [
    {
      endpointOrdinal: 0,
      endpointId: 'first',
      candidates: [{
        id: 'first-near',
        reservationVolume: volume('first-near-volume', 0),
      }],
      fallbackCandidateFactory: () => {
        fallbackFactoryCalls += 1;
        return [{
          id: 'first-far',
          reservationVolume: volume('first-far-volume', 10),
        }];
      },
    },
    {
      endpointOrdinal: 1,
      endpointId: 'second',
      candidates: [
        {
          id: 'second-overlapping',
          reservationVolume: volume('second-overlapping-volume', 10),
        },
        {
          id: 'second-compatible',
          reservationVolume: volume('second-compatible-volume', 14),
        },
      ],
    },
  ];
  const staticSummary = filterRouteNetworkEndpointDomains(
    endpointDomains,
    [volume('authored-static-obstacle', 100)],
  );
  assert.equal(fallbackFactoryCalls, 0);
  assert.deepEqual(
    staticSummary.endpointDomains.map(({ candidates }) => (
      candidates.map(({ id }) => id)
    )),
    [['first-near'], ['second-overlapping', 'second-compatible']],
  );

  const dynamicSummary = filterRouteNetworkEndpointDomains(
    staticSummary.endpointDomains,
    [volume('accepted-network-near-obstacle', 0)],
  );
  assert.equal(fallbackFactoryCalls, 1);
  assert.deepEqual(
    dynamicSummary.endpointDomains.map(({ candidates }) => (
      candidates.map(({ id }) => id)
    )),
    [['first-far'], ['second-compatible']],
  );
  assert.deepEqual(dynamicSummary.endpointCandidateCounts, [1, 1]);
  assert.equal(dynamicSummary.minimumEndpointCandidateCount, 1);
  assert.equal(dynamicSummary.viableCombinationCount, 1);
});

test('objective coverage endpoint preflight mirrors the exact entry-only outward ray', () => {
  const grammar = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
    'supplement-route-connector-through-t-v1'
  ];
  const endpoint = {
    id: 'coverage-station-a',
    position: { x: 0, y: -14, z: 0 },
    facing: { x: 1, y: 0, z: 0 },
    widthMeters: 8.4,
    coordinateSpace: 'parent-plan',
  };
  const grant = {
    id: 'coverage-grant',
    kind: 'objective-route-coverage',
    endpointSockets: [endpoint, {
      ...endpoint,
      id: 'coverage-station-b',
      position: { x: 0, y: -14, z: 50.4 },
    }],
  };
  const domain = createRouteNetworkEndpointDomain(
    grant,
    endpoint,
    0,
    [],
    [grammar],
  );

  assert.equal(domain.candidates.length, 12 * 4);
  assert.equal(Object.hasOwn(domain, 'fallbackCandidateFactory'), false);
  assert.deepEqual(
    [...new Set(domain.candidates.map(({ outwardStep }) => outwardStep))],
    Array.from({ length: 12 }, (_, ordinal) => ordinal),
  );
  assert.equal(domain.candidates.every((candidate) => (
    candidate.parentLocalSocketId === 'entry'
      && candidate.tangentOffsetTiles === 0
      && Number(candidate.center.y) === -14
  )), true);
  for (let outwardStep = 0; outwardStep < 12; outwardStep += 1) {
    const centers = new Set(domain.candidates
      .filter((candidate) => candidate.outwardStep === outwardStep)
      .map(({ center }) => `${center.x}:${center.y}:${center.z}`));
    assert.equal(
      centers.size,
      1,
      'orientation candidates must share the same exact endpoint-ray center',
    );
  }

  const reservationVolumes = domain.candidates.flatMap(({ reservationVolumes }) => (
    reservationVolumes
  ));
  const bounds = Object.fromEntries(['x', 'y', 'z'].map((axis) => {
    const minimum = Math.min(...reservationVolumes.map((volume) => (
      Number(volume.center[axis]) - Number(volume.size[axis]) * 0.5
    )));
    const maximum = Math.max(...reservationVolumes.map((volume) => (
      Number(volume.center[axis]) + Number(volume.size[axis]) * 0.5
    )));
    return [axis, { minimum, maximum }];
  }));
  const rayObstacle = {
    id: 'accepted-network-consumes-complete-endpoint-ray',
    center: Object.fromEntries(['x', 'y', 'z'].map((axis) => (
      [axis, (bounds[axis].minimum + bounds[axis].maximum) * 0.5]
    ))),
    size: Object.fromEntries(['x', 'y', 'z'].map((axis) => (
      [axis, bounds[axis].maximum - bounds[axis].minimum + 0.2]
    ))),
  };
  const blocked = filterRouteNetworkEndpointDomains([domain], [rayObstacle]);
  assert.deepEqual(blocked.endpointCandidateCounts, [0]);
  assert.equal(blocked.minimumEndpointCandidateCount, 0);
});

test('objective endpoint grammar eligibility excludes impossible generic junction support', () => {
  const grant = {
    kind: 'objective-route-coverage',
    endpointSockets: [{ id: 'a' }, { id: 'b' }],
  };
  const grammar = (selectionConstraints) => ({ selectionConstraints });
  const connector = { routeNetworkModuleKind: 'connector-module' };

  assert.equal(objectiveCoverageEndpointGrammarIsSelectable(grammar({
    ...connector,
    routeNetworkJunctionKind: 'through-t',
  }), grant), true);
  assert.equal(objectiveCoverageEndpointGrammarIsSelectable(grammar({
    ...connector,
    routeNetworkJunctionKind: 'crossroads',
  }), grant), false);
  assert.equal(objectiveCoverageEndpointGrammarIsSelectable(grammar({
    ...connector,
    routeNetworkTopologyTemplateId: 'stacked-interchange',
  }), grant), true);
  assert.equal(objectiveCoverageEndpointGrammarIsSelectable(grammar({
    routeNetworkModuleKind: 'room',
    routeNetworkTopologyTemplateId: 'stacked-interchange',
  }), grant), false);
  assert.equal(objectiveCoverageEndpointGrammarIsSelectable(grammar({
    ...connector,
    routeNetworkTopologyTemplateId: 'stacked-interchange',
  }), {
    ...grant,
    endpointSockets: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  }), false);
});

test('landmark endpoint preflight retains its tangent widening domain', () => {
  const grammar = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
    'supplement-route-connector-through-t-v1'
  ];
  const endpoint = {
    id: 'landmark-station',
    position: { x: 0, y: 0, z: 0 },
    facing: { x: 1, y: 0, z: 0 },
    coordinateSpace: 'parent-plan',
  };
  const domain = createRouteNetworkEndpointDomain({
    id: 'landmark-grant',
    kind: 'landmark-perimeter-loop',
  }, endpoint, 0, [], [grammar]);

  assert.equal(domain.candidates.some(({ tangentOffsetTiles }) => (
    Math.abs(tangentOffsetTiles) === 1
  )), true);
  assert.equal(typeof domain.fallbackCandidateFactory, 'function');
  assert.equal(domain.fallbackCandidateFactory().some(({ tangentOffsetTiles }) => (
    Math.abs(tangentOffsetTiles) >= 2
  )), true);
});

test('selected endpoint grammar widens independently when another grammar owns the near witness', () => {
  let fallbackFactoryCalls = 0;
  const domain = {
    candidates: [{ id: 'near-through-t', grammarId: 'through-t' }],
    fallbackCandidateFactory: () => {
      fallbackFactoryCalls += 1;
      return [
        { id: 'far-through-t', grammarId: 'through-t' },
        { id: 'far-crossroads', grammarId: 'crossroads' },
      ];
    },
  };

  assert.deepEqual(
    routeNetworkEndpointDomainCandidatesForGrammar(domain, 'through-t')
      .map(({ id }) => id),
    ['near-through-t'],
  );
  assert.equal(fallbackFactoryCalls, 0, 'a primary witness does not eagerly widen its grammar');
  assert.deepEqual(
    routeNetworkEndpointDomainCandidatesForGrammar(domain, 'crossroads')
      .map(({ id }) => id),
    ['far-crossroads'],
  );
  assert.equal(fallbackFactoryCalls, 1);
});

test('landmark endpoint retries preserve canonical zero and diversify small domains', () => {
  assert.equal(landmarkEndpointPlacementVariantIndex(0, 0, 4), 0);
  assert.equal(landmarkEndpointPlacementVariantIndex(0, 1, 7), 0);
  assert.equal(landmarkEndpointPlacementVariantIndex(5, 0, 4), 3);
  assert.equal(landmarkEndpointPlacementVariantIndex(17, 0, 4), 1);
  assert.notEqual(
    landmarkEndpointPlacementVariantIndex(5, 1, 7),
    landmarkEndpointPlacementVariantIndex(17, 1, 7),
  );
});

test('parent Through-T pruning recognizes exact physical-owner seams only', () => {
  const seam = createDungeonRouteEndpointSeam({
    id: 'authored-route:station',
    nodeId: 'authored-destination',
    position: { x: 0, y: 0, z: 0 },
    facing: { x: 1, y: 0, z: 0 },
  }, {
    id: 'planning-through-t-seam',
    segmentId: 'planning-through-t-segment',
    operationId: 'planning-through-t-operation',
    parentOwnerId: 'authored-route-ground',
  });
  const corridor = {
    center: { x: 2.8, y: 1.8, z: 0 },
    size: { x: 5.6, y: 3.6, z: 8.4 },
  };
  const ownedProjectedColumn = {
    id: 'base:connection:authored-route-ground:family-reserved:0:industrial-projected-column',
    ownerId: 'authored-route',
    center: { x: 2.8, y: 1.8, z: 0 },
    size: { x: 2.8, y: 3.6, z: 2.8 },
  };
  assert.equal(routeNetworkPlanningOverlapIsGranted(
    corridor,
    ownedProjectedColumn,
    [seam.overlapEnvelope],
  ), true);

  const foreignProjectedColumn = {
    ...ownedProjectedColumn,
    id: 'base:connection:foreign-route-ground:family-reserved:0:industrial-projected-column',
  };
  assert.equal(routeNetworkPlanningOverlapIsGranted(
    corridor,
    foreignProjectedColumn,
    [seam.overlapEnvelope],
  ), false);

  const outsideSeamCorridor = {
    center: { x: 8.4, y: 1.8, z: 0 },
    size: { x: 5.6, y: 3.6, z: 8.4 },
  };
  const outsideOwnedColumn = {
    ...ownedProjectedColumn,
    center: { x: 8.4, y: 1.8, z: 0 },
  };
  assert.equal(routeNetworkPlanningOverlapIsGranted(
    outsideSeamCorridor,
    outsideOwnedColumn,
    [seam.overlapEnvelope],
  ), false);
});

test('ownerless internal endpoint seams never waive immutable base connection volumes', () => {
  const supplementalSegment = {
    id: 'supplement:coverage:segment:3:occupied:0',
    ownerId: 'supplement:coverage:segment:3',
    center: { x: -48.7, y: -8.4, z: 323.4 },
    size: { x: 13.4, y: 5.6, z: 8.4 },
    purpose: 'supplement-connector-occupied',
  };
  const authoredConnectionVolume = {
    id: 'base:connection:conveyorRoom_bossRoom_ground:base-connection-occupied:56',
    ownerId: 'conveyorRoom_bossRoom',
    center: { x: -50.4, y: -12.2, z: 322 },
    size: { x: 2.632, y: 3.6, z: 2.632 },
    purpose: 'base-connection-occupied',
  };
  const internalEndpointSeam = {
    id: 'supplement:coverage:segment:3:to-endpoint-seam:overlap-envelope',
    center: { x: -55.38, y: -8.4, z: 323.4 },
    size: { x: 14, y: 5.6, z: 8.4 },
    purpose: 'route-network-endpoint-seam-overlap-envelope',
  };

  assert.equal(routeNetworkPlanningOverlapIsGranted(
    supplementalSegment,
    authoredConnectionVolume,
    [internalEndpointSeam],
  ), false);
  assert.equal(routeNetworkPlanningOverlapIsGranted(
    supplementalSegment,
    authoredConnectionVolume,
    [{
      ...internalEndpointSeam,
      parentOwnerId: 'conveyorRoom_bossRoom_ground',
    }],
  ), true, 'an exact authored-parent landing grant remains valid');
});

test('a blueprint shell grants only its own declared socket seam', () => {
  const endpointNodeId = 'supplement:endpoint-room';
  const seam = createDungeonRouteEndpointSeam({
    id: `${endpointNodeId}:socket:exit`,
    nodeId: endpointNodeId,
    position: { x: 9.8, y: 0, z: 0 },
    facing: { x: 1, y: 0, z: 0 },
  }, {
    id: `${endpointNodeId}:exit-seam`,
    segmentId: 'supplement:test-segment',
    operationId: 'supplement:test-operation',
    nodeId: endpointNodeId,
    parentOwnerId: endpointNodeId,
  });
  const ownShell = {
    id: `${endpointNodeId}:blueprint-structural-shell-east-clearance`,
    center: { x: 9.8, y: 2.8, z: 0 },
    size: { x: 0.22, y: 5.6, z: 19.6 },
  };
  const declaredExitApproach = {
    center: { x: 12.6, y: 2.8, z: 0 },
    size: { x: 5.6, y: 5.6, z: 8.4 },
  };

  assert.equal(routeNetworkPlanningOverlapIsGranted(
    declaredExitApproach,
    ownShell,
    [seam.overlapEnvelope],
  ), true);

  const wrongFaceApproach = {
    center: { x: 9.8, y: 2.8, z: 8.4 },
    size: { x: 5.6, y: 5.6, z: 5.6 },
  };
  assert.equal(routeNetworkPlanningOverlapIsGranted(
    wrongFaceApproach,
    ownShell,
    [seam.overlapEnvelope],
  ), false);
  assert.equal(routeNetworkPlanningOverlapIsGranted(
    declaredExitApproach,
    { ...ownShell, id: 'supplement:other-room:blueprint-structural-shell-clearance' },
    [seam.overlapEnvelope],
  ), false);
  assert.equal(routeNetworkPlanningOverlapIsGranted(
    declaredExitApproach,
    { ...ownShell, id: 'base:room:bonus-vault:body', ownerId: 'bonusVault' },
    [seam.overlapEnvelope],
  ), false);
});

test('laterally offset landmark sockets pin a straight outside attachment in every facing', () => {
  const grammar = {
    size: { width: 19.6, height: 8.4, depth: 19.6 },
    sockets: [{
      id: 'entry',
      localPosition: { x: 5.6, y: 0, z: -9.8 },
    }],
  };
  const endpointPosition = { x: 70, y: 14, z: -35 };
  const facings = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 },
  ];

  for (const [ordinal, facing] of facings.entries()) {
    const endpoint = {
      id: `landmark-endpoint-${ordinal}`,
      position: endpointPosition,
      facing,
    };
    const center = exactLandmarkEndpointNodeCenter({
      endpoint,
      grammar,
      localSocketId: 'entry',
      nodeFacing: facing,
      connectorGapMeters: LANDMARK_SHARED_THRESHOLD_ATTACHMENT_GAP_METERS,
    });
    const realizedSocket = transformDungeonLocalPoint(
      grammar.sockets[0].localPosition,
      {
        center,
        rotationQuarterTurns: rotationQuarterTurnsForFacing(facing),
      },
    );
    const expectedSocket = {
      x: endpointPosition.x
        + facing.x * LANDMARK_SHARED_THRESHOLD_ATTACHMENT_GAP_METERS,
      y: endpointPosition.y,
      z: endpointPosition.z
        + facing.z * LANDMARK_SHARED_THRESHOLD_ATTACHMENT_GAP_METERS,
    };
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(Math.abs(Number(realizedSocket[axis]) - Number(expectedSocket[axis])) <= 1e-9);
    }

    const attachmentDelta = {
      x: realizedSocket.x - endpointPosition.x,
      z: realizedSocket.z - endpointPosition.z,
    };
    assert.ok(Math.abs(attachmentDelta.x * facing.z
      - attachmentDelta.z * facing.x) <= 1e-9);
    assert.ok(Math.abs(attachmentDelta.x * facing.x
      + attachmentDelta.z * facing.z
      - LANDMARK_SHARED_THRESHOLD_ATTACHMENT_GAP_METERS) <= 1e-9);

    const tangent = { x: -facing.z, z: facing.x };
    const centerDelta = {
      x: center.x - endpointPosition.x,
      z: center.z - endpointPosition.z,
    };
    assert.ok(Math.abs(Math.abs(centerDelta.x * tangent.x
      + centerDelta.z * tangent.z) - 5.6) <= 1e-9);
    const nearestNodeFaceAlongOutward = centerDelta.x * facing.x
      + centerDelta.z * facing.z
      - grammar.size.depth * 0.5;
    assert.ok(nearestNodeFaceAlongOutward
      >= LANDMARK_SHARED_THRESHOLD_ATTACHMENT_GAP_METERS - 1e-9);

    const seam = createDungeonRouteEndpointSeam(endpoint, {
      id: `landmark-endpoint-seam-${ordinal}`,
      segmentId: `landmark-endpoint-segment-${ordinal}`,
      operationId: 'landmark-endpoint-operation',
    });
    for (const axis of ['x', 'y', 'z']) {
      const halfSize = Number(seam.overlapEnvelope.size[axis]) * 0.5;
      assert.ok(Number(realizedSocket[axis])
        >= Number(seam.overlapEnvelope.center[axis]) - halfSize - 1e-9);
      assert.ok(Number(realizedSocket[axis])
        <= Number(seam.overlapEnvelope.center[axis]) + halfSize + 1e-9);
    }
  }
});

test('the seed0 south landmark uses the exit binding when entry faces the trap gallery', () => {
  const grammar = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
    'supplement-route-connector-through-t-v1'
  ];
  const endpoint = {
    id: 'industrial-v1:main-region:socket:keycardRoom:south',
    position: { x: -50.4, y: 14, z: 127.4 },
    facing: { x: 0, y: 0, z: 1 },
  };
  const trapGalleryColumns = [
    ['66', -42, 145.6, 16.3, 5.8],
    ['67', -42, 148.4, 16.3, 5.8],
    ['68', -42, 151.2, 16.3, 5.8],
    ['69', -42, 154, 16.3, 5.8],
    ['70', -42, 156.8, 15.5, 4.2],
    ['71', -42, 156.8, 16.3, 5.8],
  ].map(([ordinal, x, z, y, height]) => ({
    id: `base:connection:trapRoom_conveyorRoom_ground:family-reserved:${ordinal}:industrial-projected-column`,
    center: { x, y, z },
    size: { x: 3.304, y: height, z: 3.304 },
    protectedReason: 'industrial-renderer-connector-reserved-vertical-interval',
  }));
  const candidateNode = (localSocketId, nodeFacing, tangentOffset = 0) => {
    const baseCenter = exactLandmarkEndpointNodeCenter({
      endpoint,
      grammar,
      localSocketId,
      nodeFacing,
      connectorGapMeters: LANDMARK_SHARED_THRESHOLD_ATTACHMENT_GAP_METERS,
    });
    const center = { ...baseCenter, x: baseCenter.x + tangentOffset };
    const placement = {
      center,
      rotationQuarterTurns: rotationQuarterTurnsForFacing(nodeFacing),
    };
    const transform = (volume) => transformDungeonVolume(volume, placement);
    const socket = grammar.sockets.find(({ id }) => id === localSocketId);
    return {
      center,
      placement,
      node: {
        occupiedVolumes: grammar.occupiedVolumes.map(transform),
        clearanceVolumes: grammar.clearanceVolumes.map(transform),
      },
      realizedSocket: transformDungeonLocalPoint(socket.localPosition, placement),
    };
  };

  const blockedEntry = candidateNode('entry', endpoint.facing);
  assert.ok(nodePlanningCollisionScore(blockedEntry.node, trapGalleryColumns) > 0);

  const mirroredExit = candidateNode(
    'exit',
    { x: 0, y: 0, z: -1 },
    -2.8,
  );
  assert.equal(nodePlanningCollisionScore(mirroredExit.node, trapGalleryColumns), 0);
  const physicalParentPosition = endpoint.position;
  assert.ok(Math.abs(
    mirroredExit.realizedSocket.z - physicalParentPosition.z
      - LANDMARK_SHARED_THRESHOLD_ATTACHMENT_GAP_METERS,
  ) <= 1e-9, 'the authored wall remains the start of the complete parent attachment');
  assert.ok(Math.abs(
    Math.abs(mirroredExit.realizedSocket.x - physicalParentPosition.x) - 2.8,
  ) <= 1e-9, 'the attachment path preserves the selected one-tile tangent displacement');

  const remainingSpineSocketIds = routeNetworkSpineSocketIds(grammar)
    .filter((localSocketId) => localSocketId !== 'exit');
  assert.deepEqual(remainingSpineSocketIds, ['entry', 'right']);
  assert.equal(new Set(remainingSpineSocketIds).size, remainingSpineSocketIds.length);
});

test('closest placement selection preserves stable distance and displacement ordering', () => {
  const firstStableTie = {
    id: 'first-stable-tie',
    center: { x: 3, z: 4 },
    displacement: 7,
  };
  const candidates = [
    firstStableTie,
    { id: 'farther-displacement', center: { x: -3, z: -4 }, displacement: 9 },
    { id: 'preferred-displacement', center: { x: 0, z: 5 }, displacement: 2 },
    { id: 'same-preferred-stable-tie', center: { x: 5, z: 0 }, displacement: 2 },
  ];

  assert.equal(
    closestPlacementCandidate(candidates, { x: 0, z: 0 }).id,
    'preferred-displacement',
  );
  assert.equal(
    closestPlacementCandidate([firstStableTie, { ...firstStableTie, id: 'second' }], {
      x: 0,
      z: 0,
    }),
    firstStableTie,
  );
});

test('dense coverage directs its semantic arc toward the roomiest station interval', () => {
  assert.deepEqual(
    orderCoverageRoomIndicesForArc([1, 3, 4], [0, 2, 5]),
    [3, 4, 1],
  );
  assert.deepEqual(
    orderCoverageRoomIndicesForArc([1, 2, 4], [0, 3, 5]),
    [1, 2, 4],
  );
  assert.deepEqual(orderCoverageRoomIndicesForArc([1, 2], [0, 3]), [1, 2]);
});

test('candidate product covers both independent family axes before filling diagonals', () => {
  const pairs = interleavedCartesianIndexPairs(3, 5);
  assert.deepEqual(pairs.slice(0, 5), [
    { firstIndex: 0, secondIndex: 0 },
    { firstIndex: 1, secondIndex: 1 },
    { firstIndex: 2, secondIndex: 2 },
    { firstIndex: 0, secondIndex: 3 },
    { firstIndex: 1, secondIndex: 4 },
  ]);
  assert.equal(pairs.length, 15);
  assert.equal(new Set(pairs.map(({ firstIndex, secondIndex }) => (
    `${firstIndex}:${secondIndex}`
  ))).size, 15);
});

test('stacked interchange prunes the missing-support composition before geometry', () => {
  const coverageGrant = {
    kind: 'objective-route-coverage',
    endpointSockets: [{ id: 'first' }, { id: 'second' }],
  };
  assert.equal(
    routeNetworkTopologySupportsModuleCount('stacked-interchange', coverageGrant, 4),
    false,
  );
  assert.equal(
    routeNetworkTopologySupportsModuleCount('stacked-interchange', coverageGrant, 5),
    true,
  );
  assert.equal(
    routeNetworkTopologySupportsModuleCount('fork-merge-h-loop', coverageGrant, 4),
    true,
  );
});

test('candidate support filtering preserves pre-filter ordinal and search identity', () => {
  const coverageGrant = {
    kind: 'objective-route-coverage',
    endpointSockets: [{ id: 'first' }, { id: 'second' }],
  };
  const candidates = interleavedRouteNetworkCandidateSignatures({
    // The deterministic 2x2 product is generic-5, stacked-4, stacked-5,
    // generic-4. Removing its unsupported middle member must leave a gap.
    physicalSignatures: [{ moduleCount: 5 }, { moduleCount: 4 }],
    familyChoices: [
      { topologyTemplateId: 'parallel-gallery-loop' },
      { topologyTemplateId: 'stacked-interchange' },
    ],
    supportsModuleCount: ({ topologyTemplateId }, moduleCount) => (
      routeNetworkTopologySupportsModuleCount(
        topologyTemplateId,
        coverageGrant,
        moduleCount,
      )
    ),
  });
  const bounded = candidates.slice(0, 3);

  assert.deepEqual(
    bounded.map(({ candidateOrdinal }) => candidateOrdinal),
    [0, 2, 3],
  );
  assert.deepEqual(
    bounded.map(({ searchVariant }) => searchVariant),
    [0, 2, 3],
  );
  assert.deepEqual(
    bounded.map(({ candidateOrdinal }) => (
      candidateOrdinal === 0
        ? 'network:grant'
        : `network:grant:global-solver:${candidateOrdinal}`
    )),
    [
      'network:grant',
      'network:grant:global-solver:2',
      'network:grant:global-solver:3',
    ],
  );
  assert.equal(bounded.length, 3, 'the same retained-candidate cap is respected');
});

test('dense constrained bays become a three-arm payoff branch without losing reconnect', () => {
  assert.deepEqual(selectCoverageTraversalConnectorIndices({
    nodeCount: 6,
    endpointNodeIndices: [0, 2, 5],
  }), [1]);
  assert.deepEqual(selectCoverageTraversalConnectorIndices({
    nodeCount: 5,
    endpointNodeIndices: [0, 2, 4],
  }), [], 'two curated rooms cannot be reclassified as infrastructure');
  const result = coverageTraversalBranchBindings({
    nodeCount: 6,
    endpointNodeIndices: [0, 2, 5],
    traversalConnectorIndices: [1],
  });
  assert.deepEqual(result, {
    traversalIndex: 1,
    branchRoomIndex: 4,
    bindings: [
      { fromIndex: 0, toIndex: 1, fromLocalSocketId: null, toLocalSocketId: 'entry' },
      { fromIndex: 1, toIndex: 2, fromLocalSocketId: 'exit', toLocalSocketId: null },
      { fromIndex: 2, toIndex: 3, fromLocalSocketId: null, toLocalSocketId: 'entry' },
      { fromIndex: 3, toIndex: 5, fromLocalSocketId: 'exit', toLocalSocketId: null },
      {
        fromIndex: 1,
        toIndex: 4,
        fromLocalSocketId: 'right',
        toLocalSocketId: 'entry',
        routeRole: 'route-network-payoff-branch',
      },
    ],
  });
});

test('dense boss-shrine bays can branch the challenge and keep payoff on reconnect', () => {
  const branchEntryGrammar = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
    'supplement-route-connector-through-t-branch-entry-v1'
  ];
  const traversalSocketContract = coverageTraversalSocketContractForGrammar(
    branchEntryGrammar,
  );
  assert.deepEqual(traversalSocketContract, {
    incomingMainLocalSocketId: 'exit',
    outgoingMainLocalSocketId: 'right',
    branchLocalSocketId: 'entry',
  }, 'the branch-entry T keeps its opposed sockets on the ordered main chain');
  const socketById = new Map(branchEntryGrammar.sockets.map((socket) => [socket.id, socket]));
  const incomingMainFacing = socketById.get(
    traversalSocketContract.incomingMainLocalSocketId,
  ).localFacing;
  const outgoingMainFacing = socketById.get(
    traversalSocketContract.outgoingMainLocalSocketId,
  ).localFacing;
  assert.equal(
    incomingMainFacing.x * outgoingMainFacing.x
      + incomingMainFacing.z * outgoingMainFacing.z,
    -1,
    'the selected main-chain sockets must be geometrically opposed',
  );
  assert.deepEqual(Array.from({ length: 6 }, (_, alternativeOrdinal) => (
    coverageTraversalSocketContractForGrammar(branchEntryGrammar, {
      alternativeOrdinal,
    })
  )), [
    {
      incomingMainLocalSocketId: 'exit',
      outgoingMainLocalSocketId: 'right',
      branchLocalSocketId: 'entry',
    },
    {
      incomingMainLocalSocketId: 'entry',
      outgoingMainLocalSocketId: 'exit',
      branchLocalSocketId: 'right',
    },
    {
      incomingMainLocalSocketId: 'entry',
      outgoingMainLocalSocketId: 'right',
      branchLocalSocketId: 'exit',
    },
    {
      incomingMainLocalSocketId: 'right',
      outgoingMainLocalSocketId: 'exit',
      branchLocalSocketId: 'entry',
    },
    {
      incomingMainLocalSocketId: 'exit',
      outgoingMainLocalSocketId: 'entry',
      branchLocalSocketId: 'right',
    },
    {
      incomingMainLocalSocketId: 'right',
      outgoingMainLocalSocketId: 'entry',
      branchLocalSocketId: 'exit',
    },
  ], 'bounded alternatives cover every main-arm pair in both directions');
  const result = coverageTraversalBranchBindings({
    nodeCount: 6,
    endpointNodeIndices: [0, 2, 5],
    traversalConnectorIndices: [1],
    traversalSocketContract,
    preferredBranchRoomIndex: 3,
    requirePreferredBranchRoom: true,
    branchRouteRole: 'route-network-challenge-branch',
  });
  assert.deepEqual(result, {
    traversalIndex: 1,
    branchRoomIndex: 3,
    bindings: [
      { fromIndex: 0, toIndex: 1, fromLocalSocketId: null, toLocalSocketId: 'exit' },
      { fromIndex: 1, toIndex: 2, fromLocalSocketId: 'right', toLocalSocketId: null },
      { fromIndex: 2, toIndex: 4, fromLocalSocketId: null, toLocalSocketId: 'entry' },
      { fromIndex: 4, toIndex: 5, fromLocalSocketId: 'exit', toLocalSocketId: null },
      {
        fromIndex: 1,
        toIndex: 3,
        fromLocalSocketId: 'entry',
        toLocalSocketId: 'entry',
        routeRole: 'route-network-challenge-branch',
      },
    ],
  });
  assert.equal(coverageTraversalBranchBindings({
    nodeCount: 6,
    endpointNodeIndices: [0, 2, 5],
    traversalConnectorIndices: [1],
    traversalSocketContract,
    preferredBranchRoomIndex: -1,
    requirePreferredBranchRoom: true,
    branchRouteRole: 'route-network-challenge-branch',
  }), null, 'a missing challenge cannot silently relabel the payoff branch');
  assert.deepEqual(coverageTraversalBranchBindings({
    nodeCount: 6,
    endpointNodeIndices: [0, 3, 5],
    traversalConnectorIndices: [4],
    traversalSocketContract,
    preferredBranchRoomIndex: 1,
    requirePreferredBranchRoom: true,
    branchRouteRole: 'route-network-challenge-branch',
  }), {
    traversalIndex: 4,
    branchRoomIndex: 1,
    bindings: [
      { fromIndex: 0, toIndex: 2, fromLocalSocketId: null, toLocalSocketId: 'entry' },
      { fromIndex: 2, toIndex: 3, fromLocalSocketId: 'exit', toLocalSocketId: null },
      { fromIndex: 3, toIndex: 4, fromLocalSocketId: null, toLocalSocketId: 'exit' },
      { fromIndex: 4, toIndex: 5, fromLocalSocketId: 'right', toLocalSocketId: null },
      {
        fromIndex: 4,
        toIndex: 1,
        fromLocalSocketId: 'entry',
        toLocalSocketId: 'entry',
        routeRole: 'route-network-challenge-branch',
      },
    ],
  }, 'endpoint-order retries may branch to an earlier semantic-room ordinal');
});

test('boss-shrine payoff domain uses socket traversal while reserving both seam leads', () => {
  const grammarIds = coveragePayoffGrammarIdsForStationBay({
    grammarPool: profile.grammarPool,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    stationSeparationMeters: 28,
    connectorEndpointGapMeters: ordinaryRouteNetworkSocketGapMeters(
      profile.connectorGapMeters,
    ),
  });
  assert.deepEqual(grammarIds, [
    'supplement-blueprint-ind-room-survey-relay-cache-01-v1',
  ]);
  assert.deepEqual(coveragePayoffGrammarIdsForStationBay({
    grammarPool: profile.grammarPool,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    stationSeparationMeters: 27.9,
    connectorEndpointGapMeters: ordinaryRouteNetworkSocketGapMeters(
      profile.connectorGapMeters,
    ),
  }), []);
  assert.deepEqual(coveragePayoffGrammarIdsForStationBay({
    grammarPool: profile.grammarPool,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    stationSeparationMeters: 19.6,
    stationRouteLengthMeters: 28,
    connectorEndpointGapMeters: ordinaryRouteNetworkSocketGapMeters(
      profile.connectorGapMeters,
    ),
  }), [
    'supplement-blueprint-ind-room-survey-relay-cache-01-v1',
  ], 'a proved external dogleg, rather than its short station chord, owns bay capacity');
});

test('dense constrained bays can keep challenge and payoff on one ordered main chain', () => {
  const result = coverageTraversalBranchBindings({
    nodeCount: 6,
    endpointNodeIndices: [0, 2, 5],
    traversalConnectorIndices: [1],
    keepPayoffOnMainChain: true,
  });
  assert.deepEqual(result, {
    traversalIndex: 1,
    branchRoomIndex: null,
    bindings: [
      { fromIndex: 0, toIndex: 1, fromLocalSocketId: null, toLocalSocketId: 'entry' },
      { fromIndex: 1, toIndex: 2, fromLocalSocketId: 'exit', toLocalSocketId: null },
      { fromIndex: 2, toIndex: 3, fromLocalSocketId: null, toLocalSocketId: 'entry' },
      { fromIndex: 3, toIndex: 4, fromLocalSocketId: 'exit', toLocalSocketId: 'entry' },
      { fromIndex: 4, toIndex: 5, fromLocalSocketId: 'exit', toLocalSocketId: null },
    ],
  });
});

test('dense station intervals use a net-zero authored transfer room when no rise-return pair fits', () => {
  const grammars = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS;
  const connector = grammars['supplement-route-connector-through-t-v1'];
  const challenge = Object.values(grammars).find((grammar) => (
    grammar.selectionConstraints?.routeNetworkModuleKind === 'room'
      && grammar.selectionConstraints?.routeNetworkContentRoles?.includes('challenge')
      && Number(grammar.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0) === 0
  ));
  const reward = Object.values(grammars).find((grammar) => (
    grammar.selectionConstraints?.routeNetworkModuleKind === 'room'
      && grammar.selectionConstraints?.routeNetworkContentRoles?.includes('reward')
      && Number(grammar.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0) === 0
  ));
  const selectedGrammars = [
    connector, challenge, connector, connector, reward, connector,
  ];
  const result = balanceObjectiveRouteGrammarIntervals({
    profile,
    grammars,
    selectedGrammars,
    contentRoles: ['junction', 'challenge', 'junction', 'junction', 'reward', 'junction'],
    moduleKinds: [
      'connector-module', 'room', 'connector-module',
      'connector-module', 'room', 'connector-module',
    ],
    endpointNodeIndices: [0, 3, 5],
    elevationMode: 'split-level-platform',
  });

  assert.equal(result.balanced, true);
  assert.equal(result.selfContainedTransferIndex, 1);
  assert.ok(selectedGrammars[1].selectionConstraints.authoredTransferKinds.length > 0);
  assert.equal(
    selectedGrammars[1].selectionConstraints.authoredExitElevationDeltaMeters,
    0,
  );
  assert.ok(result.intervalDeltas.every(({ delta }) => delta === 0));
});

test('boss-shrine balancing keeps the bag-constrained payoff and moves transfer to challenge branch', () => {
  const grammars = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS;
  const connector = grammars['supplement-route-connector-through-t-v1'];
  const provisionalChallenge = Object.values(grammars).find((grammar) => (
    grammar.selectionConstraints?.routeNetworkModuleKind === 'room'
      && grammar.selectionConstraints?.routeNetworkContentRoles?.includes('challenge')
      && Number(grammar.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0) === 2.8
  ));
  const provisionalReward = grammars[
    'supplement-blueprint-ind-room-observation-break-01-v1'
  ];
  const compactPayoffId = 'supplement-blueprint-ind-room-survey-relay-cache-01-v1';
  const selectedGrammars = [
    connector, connector, connector, provisionalChallenge, provisionalReward, connector,
  ];
  const result = balanceObjectiveRouteGrammarIntervals({
    profile,
    grammars,
    selectedGrammars,
    contentRoles: ['junction', 'junction', 'junction', 'challenge', 'reward', 'junction'],
    moduleKinds: [
      'connector-module', 'connector-module', 'connector-module',
      'room', 'room', 'connector-module',
    ],
    endpointNodeIndices: [0, 2, 5],
    excludedNodeIndices: [3],
    legalGrammarIdsByIndex: new Map([[4, [compactPayoffId]]]),
    elevationMode: 'slope',
    preferCompactRise: true,
  });

  assert.equal(result.balanced, true);
  assert.equal(result.branchTransferIndex, 3);
  assert.equal(selectedGrammars[4].id, compactPayoffId);
  assert.equal(
    selectedGrammars[3].selectionConstraints.authoredExitElevationDeltaMeters,
    0,
  );
  assert.ok(selectedGrammars[3].selectionConstraints.authoredTransferKinds.length > 0);
});

test('a payoff branch cannot balance a rise on the mandatory three-station spine', () => {
  const grammars = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS;
  const connector = grammars['supplement-route-connector-through-t-v1'];
  const rise = Object.values(grammars).find((grammar) => (
    grammar.selectionConstraints?.routeNetworkModuleKind === 'room'
      && grammar.selectionConstraints?.routeNetworkContentRoles?.includes('challenge')
      && Number(grammar.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0) === 2.8
  ));
  const descent = Object.values(grammars).find((grammar) => (
    grammar.selectionConstraints?.routeNetworkModuleKind === 'room'
      && grammar.selectionConstraints?.routeNetworkContentRoles?.includes('reward')
      && Number(grammar.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0) === -2.8
  ));
  const discovery = Object.values(grammars).find((grammar) => (
    grammar.selectionConstraints?.routeNetworkModuleKind === 'room'
      && grammar.selectionConstraints?.routeNetworkContentRoles?.includes('discovery')
      && Number(grammar.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0) === 0
  ));
  const selectedGrammars = [
    connector, discovery, connector, rise, descent, connector,
  ];
  const result = balanceObjectiveRouteGrammarIntervals({
    profile,
    grammars,
    selectedGrammars,
    contentRoles: ['connector', 'discovery', 'junction', 'challenge', 'reward', 'connector'],
    moduleKinds: [
      'connector-module', 'room', 'connector-module',
      'room', 'room', 'connector-module',
    ],
    endpointNodeIndices: [0, 2, 5],
    excludedNodeIndices: [4],
    elevationMode: 'slope',
    preferCompactRise: true,
  });

  assert.equal(result.balanced, true);
  assert.equal(result.selfContainedTransferIndex, 3);
  assert.equal(
    selectedGrammars[3].selectionConstraints.authoredExitElevationDeltaMeters,
    0,
  );
  assert.ok(selectedGrammars[3].selectionConstraints.authoredTransferKinds.length > 0);
  assert.equal(
    selectedGrammars[4].selectionConstraints.authoredExitElevationDeltaMeters,
    0,
  );
  assert.ok(result.intervalDeltas.every(({ delta }) => delta === 0));
});

function resolveTopology(topologyTemplateId, {
  routeNetworkKind = 'objective-route-coverage',
  junctionKinds = ['through-t', 'crossroads', 'through-t'],
  contentRoles = ['junction', 'challenge', 'connector'],
  moduleKinds = ['connector-module', 'room', 'connector-module'],
  junctionModuleIndex = 0,
  topologySupportConnectorIndex = null,
} = {}) {
  return resolveRouteNetworkGrammarAssignments({
    profile,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    routeNetworkKind,
    topologyTemplateId,
    junctionKinds,
    contentRoles,
    moduleKinds,
    junctionModuleIndex,
    topologySupportConnectorIndex,
    operationOrdinal: 0,
    searchVariant: 0,
    elevationMode: 'split-level-platform',
  });
}

test('fork-merge topology selects the authored paired-T H loop through the planner assignment path', () => {
  const assignment = resolveTopology('fork-merge-h-loop');

  assert.equal(assignment.topologyKitDeferred, false);
  assert.equal(assignment.topologyKitModuleIndex, 1);
  assert.equal(
    assignment.selectedGrammars[1].blueprintId,
    'ind-loop-paired-t-h-01',
  );
  assert.equal(assignment.junctionKinds[1], 'fork-merge');
  assert.deepEqual(
    assignment.selectedGrammars[1].selectionConstraints.routeNetworkSpineSocketIds,
    ['entry', 'exit'],
  );
});

test('stacked-interchange topology replaces the qualifying junction with its authored four-socket kit', () => {
  const assignment = resolveTopology('stacked-interchange');

  assert.equal(assignment.topologyKitDeferred, false);
  assert.equal(assignment.topologyKitModuleIndex, 0);
  assert.equal(
    assignment.selectedGrammars[0].blueprintId,
    'ind-interchange-stacked-01',
  );
  assert.equal(assignment.junctionKinds[0], 'stacked-interchange');
  assert.deepEqual(
    assignment.selectedGrammars[0].selectionConstraints.routeNetworkTopologySocketIds,
    ['left', 'right'],
  );
});

test('stacked-interchange coverage reserves an interior Through-T without consuming challenge or payoff', () => {
  const allocation = resolveStackedInterchangeSupportAllocation({
    routeNetworkKind: 'objective-route-coverage',
    topologyTemplateId: 'stacked-interchange',
    physicalModuleCount: 5,
    endpointNodeIndices: [0, 4],
  });

  assert.deepEqual(allocation, {
    supportConnectorIndex: 2,
    supportMinimumGraphDegree: 3,
    connectorNodeIndices: [0, 2, 4],
    roomNodeIndices: [1, 3],
  });

  const assignment = resolveTopology('stacked-interchange', {
    junctionKinds: Array(5).fill('through-t'),
    contentRoles: ['junction', 'challenge', 'junction', 'reward', 'junction'],
    moduleKinds: [
      'connector-module',
      'room',
      'connector-module',
      'room',
      'connector-module',
    ],
    junctionModuleIndex: 4,
    topologySupportConnectorIndex: 2,
  });
  assert.equal(assignment.topologyKitModuleIndex, 4);
  assert.equal(assignment.selectedGrammars[2].blueprintId, 'ind-junction-through-t-01');
  assert.equal(assignment.selectedGrammars[4].blueprintId, 'ind-interchange-stacked-01');

  const activeDegreeByIndex = new Map([[0, 3], [2, 3], [4, 3]]);
  const substantiveModuleCount = allocation.roomNodeIndices.length
    + allocation.connectorNodeIndices.filter((index) => (
      Number(activeDegreeByIndex.get(index) ?? 0) >= 3
    )).length;
  assert.equal(substantiveModuleCount, 5);
  assert.ok(substantiveModuleCount >= 3 && substantiveModuleCount <= 6);
});

test('stacked-interchange support survives objective grammar balancing', () => {
  const assignment = resolveTopology('stacked-interchange', {
    junctionKinds: [
      'through-t',
      'crossroads',
      'stacked-interchange',
      'staggered-cross',
      'through-t',
    ],
    contentRoles: ['junction', 'challenge', 'junction', 'reward', 'junction'],
    moduleKinds: [
      'connector-module', 'room', 'connector-module', 'room', 'connector-module',
    ],
    junctionModuleIndex: 4,
    topologySupportConnectorIndex: 2,
  });

  assert.equal(assignment.topologyKitModuleIndex, 4);
  assert.equal(assignment.selectedGrammars[2].blueprintId, 'ind-junction-through-t-01');
  assert.equal(assignment.junctionKinds[2], 'through-t');
  assert.equal(assignment.selectedGrammars[4].blueprintId, 'ind-interchange-stacked-01');
});

test('a promoted endpoint Through-T resets featureless distance', () => {
  assert.equal(routeNetworkNodeResetsFeaturelessDistance({
    connectorOwned: true,
    plannedMinimumGraphDegree: 3,
    grammarId: 'industrial-v1-main-region-route-network-junction-through-t',
    exactParentEndpoint: true,
  }), true);
  assert.equal(routeNetworkNodeResetsFeaturelessDistance({
    connectorOwned: true,
    plannedMinimumGraphDegree: 2,
    grammarId: 'industrial-v1-main-region-route-network-junction-through-t',
    exactParentEndpoint: true,
  }), false, 'an unused third socket must not create a reset');
  assert.equal(routeNetworkNodeResetsFeaturelessDistance({
    connectorOwned: false,
    plannedMinimumGraphDegree: 2,
  }), true, 'substantive content rooms remain meaningful stations');
});

test('clearance-tight endpoint targets preserve the closest candidate per facing', () => {
  const target = { x: 28, z: -14 };
  const facings = [
    { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 },
  ];
  const candidates = facings.flatMap((facing, orientationOrdinal) => ([
    {
      center: { x: target.x + 2.8, z: target.z },
      facing,
      orientationOrdinal,
      displacement: 5.6,
    },
    {
      center: { x: target.x, z: target.z },
      facing,
      orientationOrdinal,
      displacement: 2.8,
    },
  ]));

  const selected = closestPlacementCandidatesPerFacing(candidates, target);
  assert.equal(selected.length, 4);
  assert.deepEqual(selected.map(({ center }) => center), Array(4).fill(target));
  assert.deepEqual(new Set(selected.map(({ facing }) => `${facing.x}:${facing.z}`)).size, 4);
});

test('ordinary module seams reserve two complete exterior leads', () => {
  assert.equal(ordinaryRouteNetworkSocketGapMeters(5.6, 5.6), 11.2);
  assert.equal(ordinaryRouteNetworkSocketGapMeters(14, 5.6), 14);
});

test('vertical route pruning accounts for the longest side of the transfer reset', () => {
  assert.equal(minimumVerticalRouteFeaturelessSpanMeters(88.2, 2.8), 45.5);
  assert.equal(minimumVerticalRouteFeaturelessSpanMeters(40, 0), 20);
});

test('a feasible correlated chain witness survives the existing domain limit', () => {
  const start = { id: 'start' };
  const dead = { id: 'dead' };
  const bridge = { id: 'bridge' };
  const finish = { id: 'finish' };
  const reservation = reserveOrderedCandidateChain({
    candidateGroups: [
      { index: 0, candidates: [start], candidatePool: [start] },
      { index: 1, candidates: [dead], candidatePool: [dead, bridge] },
      { index: 2, candidates: [finish], candidatePool: [finish] },
    ],
    orderedEdges: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
    ],
    candidateKey: ({ id }) => id,
    pairIsCompatible: (first, _firstIndex, second) => (
      !new Set([first.id, second.id]).has('dead')
        || !new Set([first.id, second.id]).has('finish')
    ),
    maxPairEvaluations: 8,
  });

  assert.equal(reservation.status, 'reserved');
  assert.equal(reservation.reservedByIndex.get(1), bridge);
  assert.ok(reservation.pairEvaluations <= 8);
  assert.deepEqual(
    mergeReservedPlacementCandidates([dead], [reservation.reservedByIndex.get(1)], 1),
    [bridge],
    'the witness replaces one bounded candidate instead of increasing the cap',
  );
});

const projectedSaturationBeamLimits = Object.freeze({
  candidateWindowSize: 64,
  maximumLayerCandidates: 32,
  maxCheapPairEvaluations: 16384,
  maxPairEvaluations: 32,
});

function createProjectedSaturationBeamFixture() {
  const roots = Array.from({ length: 20 }, (_, ordinal) => ({
    id: `root-${String(ordinal).padStart(2, '0')}`,
  }));
  const continuations = Array.from({ length: 40 }, (_, ordinal) => ({
    id: `continuation-${String(ordinal).padStart(2, '0')}`,
    ordinal,
  }));
  const finish = { id: 'finish' };
  return {
    candidateGroups: [
      { index: 0, candidates: roots, candidatePool: roots },
      { index: 1, candidates: continuations, candidatePool: continuations },
      { index: 2, candidates: [finish], candidatePool: [finish] },
    ],
    orderedEdges: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
    ],
    candidateKey: ({ id }) => id,
    pairPassesCheapBounds: (first, firstIndex, _second, secondIndex) => (
      firstIndex !== 1 || secondIndex !== 2 || first.ordinal === 8
    ),
    pairIsCompatible: () => true,
    ...projectedSaturationBeamLimits,
  };
}

test('correlated chain rotates a projected-saturated fixed beam to retain ordinal eight', () => {
  const reservation = reserveOrderedCandidateChain(
    createProjectedSaturationBeamFixture(),
  );

  assert.equal(reservation.status, 'reserved');
  assert.equal(reservation.reservedByIndex.get(1)?.ordinal, 8);
  assert.ok(
    reservation.cheapPairEvaluations
      <= projectedSaturationBeamLimits.maxCheapPairEvaluations,
  );
  assert.ok(
    reservation.exactPairEvaluations <= projectedSaturationBeamLimits.maxPairEvaluations,
  );
});

test('correlated tree rotates a projected-saturated fixed beam to retain ordinal eight', () => {
  const reservation = reserveOrderedCandidateTree(
    createProjectedSaturationBeamFixture(),
  );

  assert.equal(reservation.status, 'reserved');
  assert.equal(reservation.reservedByIndex.get(1)?.ordinal, 8);
  assert.ok(
    reservation.cheapPairEvaluations
      <= projectedSaturationBeamLimits.maxCheapPairEvaluations,
  );
  assert.ok(
    reservation.exactPairEvaluations <= projectedSaturationBeamLimits.maxPairEvaluations,
  );
});

test('correlated chain bounds full-pool scans while retaining a late legal witness', () => {
  const start = { id: 'start' };
  const finish = { id: 'finish' };
  const deadCandidates = Array.from({ length: 120 }, (_, ordinal) => ({
    id: `dead-${String(ordinal).padStart(3, '0')}`,
  }));
  const viable = { id: 'viable' };
  let firstLayerScanCalls = 0;
  const reservation = reserveOrderedCandidateChain({
    candidateGroups: [
      { index: 0, candidates: [start], candidatePool: [start] },
      {
        index: 1,
        candidates: deadCandidates.slice(0, 8),
        candidatePool: [...deadCandidates, viable],
      },
      { index: 2, candidates: [finish], candidatePool: [finish] },
    ],
    orderedEdges: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
    ],
    candidateKey: ({ id }) => id,
    candidateWindowSize: 8,
    maxCheapPairEvaluations: 512,
    maxPairEvaluations: 8,
    compareEdgeCandidates: (first, second) => first.id.localeCompare(second.id),
    pairPassesCheapBounds: (first, firstIndex, second, secondIndex) => {
      if (firstIndex === 0 && secondIndex === 1) {
        firstLayerScanCalls += 1;
        return second.id === 'viable';
      }
      return true;
    },
    pairIsCompatible: () => true,
  });

  assert.equal(reservation.status, 'reserved');
  assert.equal(reservation.reservedByIndex.get(1), viable);
  assert.equal(firstLayerScanCalls, 8);
  assert.equal(reservation.layerDiagnostics[0].scannedCandidateCount, 8);
  assert.ok(reservation.cheapPairEvaluations <= 512);
  assert.ok(reservation.exactPairEvaluations <= 8);
});

test('correlated placement repair remains dormant until an ordered edge exhausts AC', () => {
  const orderedEdges = [
    { fromIndex: 0, toIndex: 2 },
    { fromIndex: 2, toIndex: 1 },
  ];
  let reservationInvocations = 0;
  const attemptIfEligible = (failure) => {
    if (!shouldAttemptCorrelatedPlacementRepair({
      orderedEdges,
      failedFirstIndex: failure?.firstIndex,
      failedSecondIndex: failure?.secondIndex,
      alreadyAttempted: reservationInvocations > 0,
    })) return null;
    reservationInvocations += 1;
    return reserveOrderedCandidateChain({
      candidateGroups: [
        { index: 0, candidates: [{ id: 'start' }] },
        { index: 1, candidates: [{ id: 'finish' }] },
        {
          index: 2,
          candidates: [{ id: 'dead' }],
          candidatePool: [{ id: 'dead' }, { id: 'bridge' }],
        },
      ],
      orderedEdges,
      candidateKey: ({ id }) => id,
      pairIsCompatible: (first, _firstIndex, second) => (
        ![first.id, second.id].includes('dead')
          || ![first.id, second.id].includes('finish')
      ),
      maxPairEvaluations: 32,
    });
  };

  assert.equal(attemptIfEligible(null), null);
  assert.equal(reservationInvocations, 0, 'candidate pools stay untouched before AC fails');
  const reservation = attemptIfEligible({ firstIndex: 2, secondIndex: 1 });
  assert.equal(reservationInvocations, 1);
  assert.equal(reservation.status, 'reserved');
  assert.ok(reservation.exactPairEvaluations <= 32);
  assert.equal(
    shouldAttemptCorrelatedPlacementRepair({
      orderedEdges,
      failedFirstIndex: 2,
      failedSecondIndex: 1,
      alreadyAttempted: true,
    }),
    false,
    'one failed AC pass can trigger at most one repair attempt',
  );
  assert.equal(shouldAttemptCorrelatedPlacementRepair({
    orderedEdges: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
    ],
    failedFirstIndex: 1,
    failedSecondIndex: 2,
  }), true, 'ordinary numeric chains use the same global correlation repair');
});

test('correlated tree repair preserves a payoff branch without consuming another endpoint', () => {
  const edges = [
    { fromIndex: 0, toIndex: 1 },
    { fromIndex: 1, toIndex: 2 },
    { fromIndex: 2, toIndex: 3 },
    { fromIndex: 3, toIndex: 5 },
    { fromIndex: 1, toIndex: 4 },
  ];
  const oriented = orientOrderedCandidateTreeAtFailure(edges, 4, 5);
  assert.deepEqual(oriented, [
    { fromIndex: 5, toIndex: 3 },
    { fromIndex: 3, toIndex: 2 },
    { fromIndex: 2, toIndex: 1 },
    { fromIndex: 1, toIndex: 0 },
    { fromIndex: 1, toIndex: 4 },
  ]);
  const endpoint = { id: 'endpoint' };
  const blockedPayoff = { id: 'blocked-payoff' };
  const viablePayoff = { id: 'viable-payoff' };
  const reservation = reserveOrderedCandidateTree({
    candidateGroups: [
      { index: 0, candidates: [{ id: 'start' }] },
      { index: 1, candidates: [{ id: 'junction' }] },
      { index: 2, candidates: [{ id: 'station' }] },
      { index: 3, candidates: [{ id: 'challenge' }] },
      {
        index: 4,
        candidates: [blockedPayoff],
        candidatePool: [blockedPayoff, viablePayoff],
      },
      { index: 5, candidates: [endpoint] },
    ],
    orderedEdges: oriented,
    candidateKey: ({ id }) => id,
    pairPassesCheapBounds: (first, _firstIndex, second) => !(
      [first.id, second.id].includes(endpoint.id)
        && [first.id, second.id].includes(blockedPayoff.id)
    ),
    pairIsCompatible: () => true,
    maxPairEvaluations: 32,
    maxCheapPairEvaluations: 256,
    candidateWindowSize: 16,
    maximumLayerCandidates: 8,
  });
  assert.equal(reservation.status, 'reserved');
  assert.equal(reservation.reservedByIndex.get(4), viablePayoff);
  assert.ok(reservation.exactPairEvaluations <= 32);
  assert.equal(shouldAttemptCorrelatedPlacementRepair({
    orderedEdges: edges,
    failedFirstIndex: 4,
    failedSecondIndex: 5,
  }), true, 'a non-edge endpoint conflict is still a correlated tree failure');
});

test('correlated tree prefixes cannot reuse one junction socket for two required edges', () => {
  const incoming = { id: 'incoming' };
  const junction = { id: 'junction' };
  const firstContinuation = { id: 'first-continuation', junctionSocketId: 'right' };
  const conflictingContinuation = {
    id: 'conflicting-continuation',
    junctionSocketId: 'right',
  };
  const injectiveContinuation = {
    id: 'injective-continuation',
    junctionSocketId: 'exit',
  };
  const reservation = reserveOrderedCandidateTree({
    candidateGroups: [
      { index: 0, candidates: [incoming] },
      { index: 1, candidates: [junction] },
      { index: 2, candidates: [firstContinuation] },
      {
        index: 3,
        candidates: [conflictingContinuation],
        candidatePool: [conflictingContinuation, injectiveContinuation],
      },
    ],
    orderedEdges: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
      { fromIndex: 1, toIndex: 3 },
    ],
    candidateKey: ({ id }) => id,
    pairIsCompatible: () => true,
    prefixIsCompatible: (prefix) => {
      const claimedSocketIds = [prefix.get(2), prefix.get(3)]
        .filter(Boolean)
        .map(({ junctionSocketId }) => junctionSocketId);
      return new Set(claimedSocketIds).size === claimedSocketIds.length;
    },
    maxPairEvaluations: 16,
    maxCheapPairEvaluations: 128,
    candidateWindowSize: 8,
    maximumLayerCandidates: 8,
  });

  assert.equal(reservation.status, 'reserved');
  assert.equal(reservation.reservedByIndex.get(3), injectiveContinuation);
});

test('correlated tree preserves a complete joint suffix witness across bounded layers', () => {
  const start = { id: 'start' };
  const junction = { id: 'junction' };
  const deadFirst = Array.from({ length: 24 }, (_, ordinal) => ({
    id: `dead-first-${ordinal}`,
  }));
  const deadSecond = Array.from({ length: 24 }, (_, ordinal) => ({
    id: `dead-second-${ordinal}`,
  }));
  const firstWitness = { id: 'first-witness' };
  const secondWitness = { id: 'second-witness' };
  const reservation = reserveOrderedCandidateTree({
    candidateGroups: [
      { index: 0, candidates: [start], candidatePool: [start] },
      { index: 1, candidates: [junction], candidatePool: [junction] },
      {
        index: 2,
        candidates: deadFirst.slice(0, 4),
        candidatePool: [...deadFirst, firstWitness],
      },
      {
        index: 3,
        candidates: deadSecond.slice(0, 4),
        candidatePool: [...deadSecond, secondWitness],
      },
    ],
    orderedEdges: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
      { fromIndex: 1, toIndex: 3 },
    ],
    candidateKey: ({ id }) => id,
    pairIsCompatible: () => true,
    prefixIsCompatible: (prefix) => (
      prefix.size < 4
        || (prefix.get(2) === firstWitness && prefix.get(3) === secondWitness)
    ),
    prefixHasNextEdgeSupport: (prefix) => prefix.size === 2
      ? {
        plan: [
          { fromIndex: 1, toIndex: 2, candidate: firstWitness },
          { fromIndex: 1, toIndex: 3, candidate: secondWitness },
        ],
      }
      : null,
    maxPairEvaluations: 8,
    maxCheapPairEvaluations: 128,
    candidateWindowSize: 4,
    maximumLayerCandidates: 2,
  });

  assert.equal(reservation.status, 'reserved');
  assert.equal(reservation.reservedByIndex.get(2), firstWitness);
  assert.equal(reservation.reservedByIndex.get(3), secondWitness);
  assert.ok(reservation.cheapPairEvaluations <= 128);
  assert.ok(reservation.exactPairEvaluations <= 8);
});

test('correlated tree reserves enough cheap budget to replay a proved suffix', () => {
  const start = { id: 'start' };
  const junction = { id: 'junction' };
  const firstWitness = { id: 'first-witness' };
  const secondWitness = { id: 'second-witness' };
  let scalarBoundCalls = 0;
  let assignedRouteCalls = 0;
  let prefixCompatibilityCalls = 0;
  let supportConsumptionCount = 0;
  const cheapLimit = 24;
  const reservation = reserveOrderedCandidateTree({
    candidateGroups: [
      { index: 0, candidates: [start] },
      { index: 1, candidates: [junction] },
      { index: 2, candidates: [firstWitness] },
      { index: 3, candidates: [secondWitness] },
    ],
    orderedEdges: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
      { fromIndex: 1, toIndex: 3 },
    ],
    candidateKey: ({ id }) => id,
    pairPassesCheapBounds: () => {
      scalarBoundCalls += 1;
      return true;
    },
    pairClearsAssignedCandidates: () => {
      assignedRouteCalls += 1;
      return true;
    },
    prefixIsCompatible: () => {
      prefixCompatibilityCalls += 1;
      return true;
    },
    prefixHasNextEdgeSupport: (
      prefix,
      _nextEdge,
      { consumeCheapPairEvaluation },
    ) => {
      if (prefix.size !== 2) return null;
      // Deliberately spend every evaluation made available to the lookahead.
      // The tree must withhold enough of the same global budget to replay the
      // two returned candidates through its ordinary predicates.
      while (consumeCheapPairEvaluation()) supportConsumptionCount += 1;
      return {
        plan: [
          { fromIndex: 1, toIndex: 2, candidate: firstWitness },
          { fromIndex: 1, toIndex: 3, candidate: secondWitness },
        ],
      };
    },
    pairIsCompatible: () => true,
    maxPairEvaluations: 8,
    maxCheapPairEvaluations: cheapLimit,
    candidateWindowSize: 4,
    maximumLayerCandidates: 2,
  });

  assert.equal(reservation.status, 'reserved');
  assert.equal(reservation.reservedByIndex.get(2), firstWitness);
  assert.equal(reservation.reservedByIndex.get(3), secondWitness);
  assert.equal(reservation.cheapPairEvaluations, cheapLimit);
  assert.equal(
    scalarBoundCalls
      + assignedRouteCalls
      + prefixCompatibilityCalls
      + supportConsumptionCount,
    reservation.cheapPairEvaluations,
    'route and prefix predicates are included in the advertised cheap-work counter',
  );
});

test('correlated chain caps route and prefix predicates with the cheap budget', () => {
  const secondCandidates = Array.from({ length: 10 }, (_, ordinal) => ({
    id: `second-${ordinal}`,
  }));
  let scalarBoundCalls = 0;
  let assignedRouteCalls = 0;
  let prefixCompatibilityCalls = 0;
  const reservation = reserveOrderedCandidateChain({
    candidateGroups: [
      { index: 0, candidates: [{ id: 'first' }] },
      { index: 1, candidates: secondCandidates },
    ],
    orderedEdges: [{ fromIndex: 0, toIndex: 1 }],
    candidateKey: ({ id }) => id,
    pairPassesCheapBounds: () => {
      scalarBoundCalls += 1;
      return true;
    },
    pairClearsAssignedCandidates: () => {
      assignedRouteCalls += 1;
      return true;
    },
    prefixIsCompatible: () => {
      prefixCompatibilityCalls += 1;
      return true;
    },
    pairIsCompatible: () => true,
    maxPairEvaluations: 8,
    maxCheapPairEvaluations: 5,
    candidateWindowSize: 10,
    maximumLayerCandidates: 10,
  });

  assert.equal(reservation.status, 'cheap-budget-exhausted');
  assert.equal(reservation.cheapPairEvaluations, 5);
  assert.equal(
    scalarBoundCalls + assignedRouteCalls + prefixCompatibilityCalls,
    reservation.cheapPairEvaluations,
  );
});

test('correlated chain prefixes preserve an injective socket continuation', () => {
  const incoming = { id: 'incoming', junctionSocketId: 'right' };
  const junction = { id: 'junction' };
  const conflicting = { id: 'conflicting', junctionSocketId: 'right' };
  const injective = { id: 'injective', junctionSocketId: 'exit' };
  const reservation = reserveOrderedCandidateChain({
    candidateGroups: [
      { index: 0, candidates: [incoming] },
      { index: 1, candidates: [junction] },
      {
        index: 2,
        candidates: [conflicting],
        candidatePool: [conflicting, injective],
      },
    ],
    orderedEdges: [
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
    ],
    candidateKey: ({ id }) => id,
    pairIsCompatible: () => true,
    prefixIsCompatible: (prefix) => {
      const claimedSocketIds = [prefix.get(0), prefix.get(2)]
        .filter(Boolean)
        .map(({ junctionSocketId }) => junctionSocketId);
      return new Set(claimedSocketIds).size === claimedSocketIds.length;
    },
    maxPairEvaluations: 16,
    maxCheapPairEvaluations: 64,
  });

  assert.equal(reservation.status, 'reserved');
  assert.equal(reservation.reservedByIndex.get(2), injective);
});

test('correlated chain search reverses toward the nearer endpoint after a suffix failure', () => {
  const edges = [
    { fromIndex: 0, toIndex: 1 },
    { fromIndex: 1, toIndex: 3 },
    { fromIndex: 3, toIndex: 2 },
    { fromIndex: 2, toIndex: 4 },
  ];
  assert.deepEqual(
    orientOrderedCandidateChainAtFailure(edges, 3, 2),
    [
      { fromIndex: 4, toIndex: 2 },
      { fromIndex: 2, toIndex: 3 },
      { fromIndex: 3, toIndex: 1 },
      { fromIndex: 1, toIndex: 0 },
    ],
  );
  assert.deepEqual(
    orientOrderedCandidateChainAtFailure(edges, 0, 1),
    edges,
  );
  assert.deepEqual(
    orientOrderedCandidateChainAtFailure([
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
      { fromIndex: 2, toIndex: 3 },
      { fromIndex: 3, toIndex: 4 },
    ], 3, 4),
    [
      { fromIndex: 4, toIndex: 3 },
      { fromIndex: 3, toIndex: 2 },
      { fromIndex: 2, toIndex: 1 },
      { fromIndex: 1, toIndex: 0 },
    ],
  );
});

test('stacked-interchange compound places its support at two exact seam leads and rewires the spine', () => {
  const assignment = resolveTopology('stacked-interchange', {
    junctionKinds: Array(5).fill('through-t'),
    contentRoles: ['junction', 'challenge', 'junction', 'reward', 'junction'],
    moduleKinds: [
      'connector-module', 'room', 'connector-module', 'room', 'connector-module',
    ],
    junctionModuleIndex: 4,
    topologySupportConnectorIndex: 2,
  });
  const compound = composeStackedInterchangeSupportCompound({
    placement: {
      centers: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 16.8 },
        { x: 0, y: 0, z: 33.6 },
        { x: 0, y: 0, z: 50.4 },
      ],
      endpointNodeIndices: [0, 3],
      anchorEndpointOrdinals: [0, null, null, 1],
      nodeFacings: Array(4).fill({ x: 0, y: 0, z: 1 }),
      placementOutwardFacings: Array(4).fill({ x: 0, y: 0, z: 1 }),
      requiredSocketBindings: [
        { fromIndex: 0, toIndex: 1, fromLocalSocketId: null, toLocalSocketId: 'entry' },
        { fromIndex: 1, toIndex: 2, fromLocalSocketId: 'exit', toLocalSocketId: 'entry' },
        { fromIndex: 2, toIndex: 3, fromLocalSocketId: 'exit', toLocalSocketId: null },
      ],
      externalSpinePaths: [],
    },
    selectedGrammars: assignment.selectedGrammars,
    physicalModuleCount: 5,
    endpointNodeIndices: [0, 4],
    topologyKitModuleIndex: 4,
    supportConnectorIndex: 2,
    endpoints: [
      { facing: { x: 0, y: 0, z: 1 } },
      { facing: { x: 0, y: 0, z: 1 } },
    ],
  });

  assert.ok(compound);
  assert.equal(compound.centers.length, 5);
  assert.deepEqual(compound.endpointNodeIndices, [0, 4]);
  assert.deepEqual(compound.requiredSocketBindings.map(({ fromIndex, toIndex }) => (
    [fromIndex, toIndex]
  )), [[0, 1], [1, 3], [3, 2], [2, 4]]);
  assert.deepEqual(compound.requiredSocketBindings.at(-1), {
    fromIndex: 2,
    toIndex: 4,
    fromLocalSocketId: compound.stackedInterchangeCompound.supportLocalSocketId,
    toLocalSocketId: compound.stackedInterchangeCompound.kitLocalSocketId,
  });
  assert.equal(compound.stackedInterchangeCompound.seamLeadMeters, 5.6);
  const [from, to] = compound.stackedInterchangeCompound.routePath;
  assert.equal(Math.hypot(to.x - from.x, to.z - from.z), 11.2);
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(compound.centers[2][axis] / 2.8
      - Math.round(compound.centers[2][axis] / 2.8)) < 1e-9);
  }
});

test('stacked-interchange support allocation refuses to consume the only content room', () => {
  const allocation = resolveStackedInterchangeSupportAllocation({
    routeNetworkKind: 'objective-route-coverage',
    topologyTemplateId: 'stacked-interchange',
    physicalModuleCount: 3,
    endpointNodeIndices: [0, 2],
  });

  assert.equal(allocation.supportConnectorIndex, null);
  assert.equal(allocation.supportMinimumGraphDegree, null);
  assert.deepEqual(allocation.connectorNodeIndices, [0, 2]);
  assert.deepEqual(allocation.roomNodeIndices, [1]);
});

test('stacked-interchange is legal only for its authored two-endpoint compound', () => {
  assert.equal(routeNetworkTopologyIsLegalForGrant('stacked-interchange', {
    endpointSockets: [{ id: 'a' }, { id: 'b' }],
  }), true);
  assert.equal(routeNetworkTopologyIsLegalForGrant('stacked-interchange', {
    endpointSockets: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  }), false);
  assert.equal(routeNetworkTopologyIsLegalForGrant('fork-merge-h-loop', {
    endpointSockets: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  }), true);
  assert.equal(routeNetworkTopologyIsLegalForGrant('over-under-loop', {
    kind: 'objective-route-coverage',
    endpointSockets: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  }), true, 'crossover legality depends on physical support matching, not endpoint count');
});

test('stacked-interchange compound normalizes the five-center fallback placement', () => {
  const assignment = resolveTopology('stacked-interchange', {
    junctionKinds: Array(5).fill('through-t'),
    contentRoles: ['junction', 'challenge', 'junction', 'reward', 'junction'],
    moduleKinds: [
      'connector-module', 'room', 'connector-module', 'room', 'connector-module',
    ],
    junctionModuleIndex: 4,
  });
  const diagnostics = {};
  const compound = composeStackedInterchangeSupportCompound({
    placement: {
      centers: Array.from({ length: 5 }, (_, index) => ({
        x: 0, y: 0, z: index * 14,
      })),
      endpointNodeIndices: [0, 4],
      anchorEndpointOrdinals: [0, null, null, null, 1],
      nodeFacings: Array(5).fill({ x: 0, y: 0, z: 1 }),
      placementOutwardFacings: Array(5).fill({ x: 0, y: 0, z: 1 }),
      requiredSocketBindings: Array.from({ length: 4 }, (_, fromIndex) => ({
        fromIndex,
        toIndex: fromIndex + 1,
      })),
    },
    selectedGrammars: assignment.selectedGrammars,
    physicalModuleCount: 5,
    endpointNodeIndices: [0, 4],
    topologyKitModuleIndex: 4,
    supportConnectorIndex: 2,
    endpoints: [
      { facing: { x: 0, y: 0, z: 1 } },
      { facing: { x: 0, y: 0, z: 1 } },
    ],
    diagnostics,
  });

  assert.ok(compound);
  assert.equal(diagnostics.accepted, true);
  assert.equal(diagnostics.inputShape, 'support-present');
  assert.deepEqual(compound.requiredSocketBindings.map(({ fromIndex, toIndex }) => (
    [fromIndex, toIndex]
  )), [[0, 1], [1, 3], [3, 2], [2, 4]]);
});

test('over-under topology uses a separate infrastructure slot and preserves a promotable junction', () => {
  const assignment = resolveTopology('over-under-loop');

  assert.equal(assignment.topologyKitDeferred, false);
  assert.equal(assignment.topologyKitModuleIndex, 2);
  assert.equal(
    assignment.selectedGrammars[2].blueprintId,
    'ind-crossover-over-under-01',
  );
  assert.equal(assignment.junctionKinds[2], 'over-under-crossover');
  assert.equal(
    assignment.selectedGrammars[2].selectionConstraints.supportsJunctionPromotion,
    false,
  );
  assert.equal(
    assignment.selectedGrammars[0].blueprintId,
    'ind-junction-through-t-01',
    'the crossover must not consume the qualifying physical junction',
  );
  assert.equal(
    assignment.selectedGrammars[0].selectionConstraints.supportsJunctionPromotion,
    true,
  );
});

test('topology kit selection defers when a grant has no legal dedicated slot', () => {
  const crossover = resolveTopology('over-under-loop', {
    moduleKinds: ['connector-module', 'room', 'room'],
    contentRoles: ['junction', 'challenge', 'reward'],
    junctionKinds: ['through-t', 'crossroads', 'staggered-cross'],
  });
  assert.equal(crossover.topologyKitDeferred, true);
  assert.equal(crossover.topologyKitModuleIndex, null);
  assert.equal(crossover.selectedGrammars[0].blueprintId, 'ind-junction-through-t-01');

  const pyramid = resolveTopology('fork-merge-h-loop', {
    routeNetworkKind: 'landmark-perimeter-loop',
    moduleKinds: ['connector-module', 'room', 'room'],
    contentRoles: ['junction', 'challenge', 'reward'],
    junctionKinds: ['through-t', 'crossroads', 'staggered-cross'],
  });
  assert.equal(pyramid.topologyKitDeferred, true);
  assert.equal(pyramid.topologyKitModuleIndex, null);
  assert.notEqual(pyramid.selectedGrammars[1].blueprintId, 'ind-loop-paired-t-h-01');
});
