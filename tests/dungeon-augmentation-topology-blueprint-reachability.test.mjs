import assert from 'node:assert/strict';
import test from 'node:test';
import {
  balanceObjectiveRouteGrammarIntervals,
  composeStackedInterchangeSupportCompound,
  coveragePayoffGrammarIdsForStationBay,
  coverageTraversalBranchBindings,
  createDungeonRouteEndpointSeam,
  closestPlacementCandidate,
  closestPlacementCandidatesPerFacing,
  DUNGEON_AUGMENTATION_PROFILES,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  interleavedCartesianIndexPairs,
  mergeReservedPlacementCandidates,
  minimumVerticalRouteFeaturelessSpanMeters,
  orderCoverageRoomIndicesForArc,
  orientOrderedCandidateChainAtFailure,
  orientOrderedCandidateTreeAtFailure,
  ordinaryRouteNetworkSocketGapMeters,
  reserveOrderedCandidateChain,
  reserveOrderedCandidateTree,
  routeNetworkPlanningOverlapIsGranted,
  resolveRouteNetworkGrammarAssignments,
  resolveStackedInterchangeSupportAllocation,
  routeNetworkNodeResetsFeaturelessDistance,
  routeNetworkTopologyIsLegalForGrant,
  routeNetworkTopologySupportsModuleCount,
  selectCoverageTraversalConnectorIndices,
  shouldAttemptCorrelatedPlacementRepair,
} from '../src/dungeon-augmentation/index.js';

const profile = DUNGEON_AUGMENTATION_PROFILES['industrial-supplement-preview-v4'];

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
  const result = coverageTraversalBranchBindings({
    nodeCount: 6,
    endpointNodeIndices: [0, 2, 5],
    traversalConnectorIndices: [1],
    preferredBranchRoomIndex: 3,
    requirePreferredBranchRoom: true,
    branchRouteRole: 'route-network-challenge-branch',
  });
  assert.deepEqual(result, {
    traversalIndex: 1,
    branchRoomIndex: 3,
    bindings: [
      { fromIndex: 0, toIndex: 1, fromLocalSocketId: null, toLocalSocketId: 'entry' },
      { fromIndex: 1, toIndex: 2, fromLocalSocketId: 'exit', toLocalSocketId: null },
      { fromIndex: 2, toIndex: 4, fromLocalSocketId: null, toLocalSocketId: 'entry' },
      { fromIndex: 4, toIndex: 5, fromLocalSocketId: 'exit', toLocalSocketId: null },
      {
        fromIndex: 1,
        toIndex: 3,
        fromLocalSocketId: 'right',
        toLocalSocketId: 'entry',
        routeRole: 'route-network-challenge-branch',
      },
    ],
  });
  assert.equal(coverageTraversalBranchBindings({
    nodeCount: 6,
    endpointNodeIndices: [0, 2, 5],
    traversalConnectorIndices: [1],
    preferredBranchRoomIndex: -1,
    requirePreferredBranchRoom: true,
    branchRouteRole: 'route-network-challenge-branch',
  }), null, 'a missing challenge cannot silently relabel the payoff branch');
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

test('correlated reservation filters the full pool before applying its legal window', () => {
  const start = { id: 'start' };
  const finish = { id: 'finish' };
  const deadCandidates = Array.from({ length: 120 }, (_, ordinal) => ({
    id: `dead-${String(ordinal).padStart(3, '0')}`,
  }));
  const viable = { id: 'viable' };
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
    pairPassesCheapBounds: (first, firstIndex, second, secondIndex) => (
      firstIndex === 0 && secondIndex === 1 ? second.id === 'viable' : true
    ),
    pairIsCompatible: () => true,
  });

  assert.equal(reservation.status, 'reserved');
  assert.equal(reservation.reservedByIndex.get(1), viable);
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
