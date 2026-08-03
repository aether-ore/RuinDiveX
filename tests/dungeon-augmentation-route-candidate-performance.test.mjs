import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  appendRouteNetworkRecoveryScheduleEntry,
  cachedCorrelatedEdgeCandidateOrder,
  cachedCorrelatedCheapPairStageOutcome,
  cachedOrderedCandidatePairScalar,
  cachedTranslationInvariantRouteShapeBoolean,
  createDungeonSelectionBag,
  createDirectFutureEndpointBitsetEvaluator,
  createLandmarkEndpointTupleDirectionalGuidance,
  createLandmarkEndpointRecoveryWarmStart,
  createPlanningVolumeSpatialLookup,
  createRouteNetworkParentAttachmentSpineAttemptMemo,
  createSegment,
  consumeRouteNetworkCandidateEvaluationBudget,
  dungeonSelectionBagCandidates,
  facingAwareSocketRouteCandidates,
  indexedNodePlanningCollisionScore,
  interleaveLandmarkEndpointTuplesByExactEndpointAxes,
  landmarkPairPreselectorRouteCollisionVolumes,
  landmarkEndpointTupleWarmStartMatchOrdinal,
  measureRawPlanarRouteLengthMeters,
  nextLandmarkParentAttachmentPathOrdinals,
  nodePlanningCollisionScore,
  normalizedRoutePath,
  objectiveCoverageExternalPlacement,
  objectiveCoverageRouteApproachMeters,
  planningRouteVolumesCollisionScore,
  promoteLandmarkEndpointTupleWarmStart,
  prioritizeLandmarkEndpointTuplesByDirectionalGuidance,
  rawPlanarRouteExceedsLengthLimit,
  reserveOrderedCandidateTree,
  orderLandmarkEndpointsByPreflightDomain,
  orderedLandmarkDecisionSockets,
  routeNetworkEndpointDomainForParentSocket,
  routeNetworkConnectorRoomFootprint,
  routeNetworkLiftPlanningContract,
  routeNetworkPlanningOverlapIsGranted,
  routeNetworkSlopeSwitchbackPlanningReservation,
  routeEndpointSeamSolidFeatureConflicts,
  routeNetworkNodeSocketApproachConflicts,
  routeNetworkParentAttachmentPrefixReservation,
  routeNetworkParentAttachmentPathCombinations,
  routeNetworkParentAttachmentSharedSeamGrants,
  routeNetworkParentAttachmentSpineBehaviorSignature,
  selectPreferredRouteNetworkPartialSolution,
  selectRouteNetworkFutureEndpointReservationWitness,
  routePlanningEndpointNodeMaskConflicts,
  routeNetworkTopologySelectionCandidates,
  routeNetworkViableTopologyIds,
  routePathFinalOccupiedSpans,
  routePlanningVolumesRespectEndpointNodeMask,
  routeSegmentPlanningCollisionVolumes,
  routeShapeNodeGeometrySignature,
  sampleBoundedCorrelatedSuffixCandidates,
  shouldQueueFinalLandmarkLocalRecovery,
  translationInvariantRouteShapeCacheKey,
} from '../src/dungeon-augmentation/planner.js';
import {
  createDungeonSelectionBagWitness,
  validateDungeonSelectionBagWitness,
} from '../src/dungeon-augmentation/selectionBagWitness.js';
import {
  createDungeonAugmentationProfile,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
} from '../src/dungeon-augmentation/catalog.js';
import {
  createDungeonRouteEndpointSeam,
  rotationQuarterTurnsForFacing,
  transformDungeonLocalFacing,
  transformDungeonLocalPoint,
  transformDungeonVolume,
} from '../src/dungeon-augmentation/geometry.js';

test('landmark preflight resolves reordered endpoints by socket identity before ordinal', () => {
  const endpointDomains = [{
    endpointId: 'fixture:north',
    endpointOrdinal: 0,
    candidates: [{ grammarId: 'fixture-junction' }],
  }, {
    endpointId: 'fixture:east',
    endpointOrdinal: 1,
    candidates: [{ grammarId: 'fixture-room' }],
  }];
  const canonicalEndpoints = [{ id: 'fixture:east' }, { id: 'fixture:north' }];
  const grammars = {
    'fixture-junction': {
      selectionConstraints: {
        routeNetworkModuleKind: 'connector-module',
        supportsJunctionPromotion: true,
      },
    },
    'fixture-room': {
      selectionConstraints: { routeNetworkModuleKind: 'room' },
    },
  };

  assert.equal(
    routeNetworkEndpointDomainForParentSocket(
      endpointDomains,
      canonicalEndpoints[0],
      0,
    ).endpointId,
    'fixture:east',
  );
  assert.deepEqual(
    orderLandmarkEndpointsByPreflightDomain(
      canonicalEndpoints,
      endpointDomains,
      grammars,
    ).map(({ id }) => id),
    ['fixture:north', 'fixture:east'],
  );
});

test('landmark preflight never aliases a missing explicit socket ID by ordinal', () => {
  const endpointDomains = [{
    endpointId: 'fixture:north',
    endpointOrdinal: 0,
    candidates: [],
  }];

  assert.equal(
    routeNetworkEndpointDomainForParentSocket(
      endpointDomains,
      { id: 'fixture:missing' },
      0,
    ),
    null,
  );
  assert.equal(
    routeNetworkEndpointDomainForParentSocket(endpointDomains, {}, 0),
    endpointDomains[0],
    'ID-less legacy endpoints retain ordinal compatibility',
  );
});

test('partial landmark candidate configuration cannot exceed the original 24 attempts', () => {
  const profile = createDungeonAugmentationProfile({
    id: 'fixture-landmark-candidate-limit',
    routeNetworkPlanning: {
      enabled: true,
      allowPartialRouteNetworkRealization: true,
      partialLandmarkCandidateLimit: 10_000,
    },
  });

  assert.equal(profile.routeNetworkPlanning.partialLandmarkCandidateLimit, 24);
});

test('partial solution scoring lets a later two-required branch beat an early one-required branch', () => {
  const earlyOneRetained = {
    operations: [{ id: 'network-a' }],
    acceptedGrantOrdinals: [0],
    acceptedNetworkCount: 1,
  };
  const laterTwoRetained = {
    operations: [{ id: 'network-b' }, { id: 'network-c' }],
    acceptedGrantOrdinals: [1, 2],
    acceptedNetworkCount: 2,
  };

  assert.equal(
    selectPreferredRouteNetworkPartialSolution(
      earlyOneRetained,
      laterTwoRetained,
      new Set([0, 1, 2]),
    ),
    laterTwoRetained,
  );
});

test('partial solution scoring rejects an explicitly empty realized state', () => {
  assert.equal(
    selectPreferredRouteNetworkPartialSolution(null, {
      operations: [],
      acceptedGrantOrdinals: [],
      acceptedNetworkCount: 0,
      prunedRouteNetworkGrants: [{ operationOrdinal: 0 }],
    }, new Set([0])),
    null,
  );
});

test('partial scoring prunes current A when keeping it would prune required B and C', () => {
  const keepAAndPruneFuture = {
    operations: [{ id: 'network-a' }],
    acceptedGrantOrdinals: [0],
    acceptedNetworkCount: 1,
    prunedRouteNetworkGrants: [{ operationOrdinal: 1 }, { operationOrdinal: 2 }],
  };
  const pruneAAndKeepFuture = {
    operations: [{ id: 'network-b' }, { id: 'network-c' }],
    acceptedGrantOrdinals: [1, 2],
    acceptedNetworkCount: 2,
    prunedRouteNetworkGrants: [{ operationOrdinal: 0 }],
  };

  const selected = selectPreferredRouteNetworkPartialSolution(
    keepAAndPruneFuture,
    pruneAAndKeepFuture,
    new Set([0, 1, 2]),
  );
  assert.equal(selected, pruneAAndKeepFuture);
  assert.deepEqual(
    selected.prunedRouteNetworkGrants.map(({ operationOrdinal }) => operationOrdinal),
    [0],
  );
});

test('capacity fallback scoring preserves the first future-prune branch on an exact tie', () => {
  const pruneFutureAndKeepCurrent = {
    operations: [{ id: 'network-a' }, { id: 'network-c' }],
    acceptedGrantOrdinals: [0, 2],
    acceptedNetworkCount: 2,
    prunedRouteNetworkGrants: [{ operationOrdinal: 1 }],
  };
  const greedilyPruneCurrent = {
    operations: [{ id: 'network-b' }, { id: 'network-c' }],
    acceptedGrantOrdinals: [1, 2],
    acceptedNetworkCount: 2,
    prunedRouteNetworkGrants: [{ operationOrdinal: 0 }],
  };

  assert.equal(
    selectPreferredRouteNetworkPartialSolution(
      pruneFutureAndKeepCurrent,
      greedilyPruneCurrent,
      new Set([0, 1, 2]),
    ),
    pruneFutureAndKeepCurrent,
  );
});

test('equal route-network retention prefers the solution with fewer entity omissions', () => {
  const omission = (operationId, entityId, ordinal) => ({
    grantId: `grant:${operationId}`,
    operationId,
    entityKind: 'node',
    entityId,
    ordinal,
    signature: `${entityId}:signature`,
    disposition: ordinal === 0 ? 'conflict-root' : 'dependency',
    reason: 'fixture-conflict',
    rootSignature: `${operationId}:node:0:signature`,
  });
  const earlierForest = {
    operations: [{ id: 'operation:a' }, { id: 'operation:b' }],
    acceptedGrantOrdinals: [0, 1],
    acceptedNetworkCount: 2,
    routeNetworkEntityOmissions: [
      omission('operation:a', 'operation:a:node:0', 0),
      omission('operation:a', 'operation:a:node:1', 1),
    ],
  };
  const laterForest = {
    operations: [{ id: 'operation:c' }, { id: 'operation:d' }],
    acceptedGrantOrdinals: [0, 1],
    acceptedNetworkCount: 2,
    routeNetworkEntityOmissions: [
      omission('operation:c', 'operation:c:node:0', 0),
    ],
  };
  assert.equal(
    selectPreferredRouteNetworkPartialSolution(
      earlierForest,
      laterForest,
      new Set([0, 1]),
    ),
    laterForest,
  );
});

test('landmark wing decisions retain a free entry socket when the parent owns exit', () => {
  const decisionSockets = orderedLandmarkDecisionSockets({
    sockets: [{
      localSocketId: 'entry',
      state: 'capped',
      facing: { x: 0, y: 0, z: -1 },
    }, {
      localSocketId: 'exit',
      state: 'connected',
      facing: { x: 0, y: 0, z: 1 },
    }, {
      localSocketId: 'right',
      state: 'capped',
      facing: { x: 1, y: 0, z: 0 },
    }],
  }, { x: 0, y: 0, z: -1 });

  assert.deepEqual(
    decisionSockets.map(({ localSocketId }) => localSocketId),
    ['entry', 'right'],
  );
});

test('endpoint seam candidate preflight uses committed floor-grid solid positions', () => {
  const node = {
    id: 'fixture-dispatch-vault',
    placement: {
      center: { x: 119, y: -14, z: 68.6 },
      rotationQuarterTurns: 2,
    },
    blueprintCanonicalRotationQuarterTurns: 2,
    structure: {
      floors: [{
        id: 'base',
        elevation: 0,
        floorMask: ['###', '###', '###'],
        maskOriginTile: { x: 1, z: 0 },
      }],
      features: [{
        id: 'dv-partition-e',
        type: 'cover',
        x: 2,
        z: 1.5,
        w: 1,
        d: 3,
        tier: 'base',
        solid: true,
      }],
    },
  };
  const seam = {
    id: 'fixture-dispatch-vault:entry-seam',
    tileSize: 2.8,
    position: { x: 120.4, y: -14, z: 81.2 },
    orderedCells: [{
      id: 'fixture-dispatch-vault:entry-seam:cell:-2:-1',
      gridX: 44,
      gridZ: 27,
      position: { x: 123.2, y: -14, z: 75.6 },
      lane: -1,
      signedDepthTiles: -2,
    }],
  };

  assert.deepEqual(routeEndpointSeamSolidFeatureConflicts(node, seam), []);

  node.structure.features[0].x = 1;
  assert.deepEqual(
    routeEndpointSeamSolidFeatureConflicts(node, seam).map(({ featureId, cellId }) => ({
      featureId,
      cellId,
    })),
    [{
      featureId: 'dv-partition-e',
      cellId: 'fixture-dispatch-vault:entry-seam:cell:-2:-1',
    }],
    'a genuinely colliding floor-aligned solid is still rejected',
  );
});

test('unary socket preflight rejects the floodgate hazard before route-pair search', () => {
  const grammar = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[
    'supplement-blueprint-ind-room-floodgate-descent-01-v1'
  ];
  const placement = {
    center: { x: 0, y: -14, z: 0 },
    rotationQuarterTurns: 0,
  };
  const node = {
    id: 'fixture-floodgate-node',
    operationId: 'fixture-floodgate-operation',
    grammarId: grammar.id,
    blueprintCanonicalRotationQuarterTurns:
      grammar.blueprintCanonicalRotationQuarterTurns,
    placement,
    structure: grammar.structure,
    sockets: grammar.sockets.map((socket) => ({
      id: `fixture-floodgate-node:${socket.id}`,
      localSocketId: socket.id,
      position: transformDungeonLocalPoint(socket.localPosition, placement),
      facing: transformDungeonLocalFacing(socket.localFacing, placement),
      state: 'capped',
    })),
  };

  const conflicts = routeNetworkNodeSocketApproachConflicts(node, ['exit']);
  assert.ok(conflicts.some((conflict) => (
    conflict.localSocketId === 'exit'
      && conflict.blockerKind === 'hazard'
      && conflict.featureId === 'fd-flooded-sump'
      && conflict.lane === 1
      && conflict.signedDepthTiles === -2
  )), JSON.stringify(conflicts));
  assert.deepEqual(
    routeNetworkNodeSocketApproachConflicts(node, ['entry'])
      .filter(({ blockerKind }) => blockerKind === 'hazard'),
    [],
    'the opposite dry authored socket remains in the unary domain',
  );

  node.structure = {
    ...node.structure,
    zones: [],
    features: [],
    voids: [{ id: 'fixture-exit-void', x: 3, z: 1, w: 3, d: 3 }],
  };
  assert.ok(routeNetworkNodeSocketApproachConflicts(node, ['exit']).some((conflict) => (
    conflict.blockerKind === 'void' && conflict.featureId === 'fixture-exit-void'
  )));
});

test('landmark recovery continuations use a deterministic FIFO round robin', () => {
  const scheduledCandidateAttempts = [];
  [1, 9, 23].forEach((candidateOrdinal, candidateIndex) => {
    appendRouteNetworkRecoveryScheduleEntry(scheduledCandidateAttempts, {
      candidateIndex,
      candidateOrdinal,
      recoveryTargetOrdinal: 4,
    });
  });
  const candidateOneContinuation = {
    endpointTupleOrdinal: 1,
    rejectedPlacementPairSignatures: ['candidate1:tuple0'],
  };
  const observedRecoverySequence = [];
  let candidateEvaluations = 24;
  let plannerInvocationCount = 0;

  for (let scheduleIndex = 0;
    scheduleIndex < scheduledCandidateAttempts.length
      && observedRecoverySequence.length < 4;
    scheduleIndex += 1) {
    const scheduledAttempt = scheduledCandidateAttempts[scheduleIndex];
    const budget = consumeRouteNetworkCandidateEvaluationBudget({
      candidateEvaluations,
      maximumCandidateEvaluations: 28,
    });
    assert.equal(budget.accepted, true);
    candidateEvaluations = budget.candidateEvaluations;
    plannerInvocationCount += 1;
    const endpointTupleOrdinal = Number(
      scheduledAttempt.landmarkBacktracking?.endpointTupleOrdinal ?? 0,
    );
    observedRecoverySequence.push(
      `c${scheduledAttempt.candidateOrdinal}:${endpointTupleOrdinal}`,
    );
    if (scheduledAttempt.candidateOrdinal === 1 && endpointTupleOrdinal === 0) {
      const appended = appendRouteNetworkRecoveryScheduleEntry(
        scheduledCandidateAttempts,
        {
          candidateIndex: scheduledAttempt.candidateIndex,
          candidateOrdinal: scheduledAttempt.candidateOrdinal,
          recoveryTargetOrdinal: scheduledAttempt.recoveryTargetOrdinal,
          landmarkBacktracking: candidateOneContinuation,
        },
      );
      assert.equal(appended, scheduledCandidateAttempts.at(-1));
      assert.equal(appended.landmarkBacktracking, candidateOneContinuation);
    }
  }

  assert.deepEqual(observedRecoverySequence, ['c1:0', 'c9:0', 'c23:0', 'c1:1']);
  assert.equal(
    scheduledCandidateAttempts.every(({ recoveryReplay }) => recoveryReplay === true),
    true,
  );
  assert.equal(plannerInvocationCount, 4);
  assert.equal(candidateEvaluations, 28);
  assert.deepEqual(
    consumeRouteNetworkCandidateEvaluationBudget({
      candidateEvaluations,
      maximumCandidateEvaluations: 28,
    }),
    {
      accepted: false,
      candidateEvaluations: 28,
      maximumCandidateEvaluations: 28,
      reservedCandidateEvaluations: 0,
      currentNetworkCandidateEvaluationLimit: 28,
    },
    'the next replay is rejected by the same global budget',
  );
});

test('a failed final landmark reuses only its existing bounded candidate identity', () => {
  const scheduledCandidateAttempts = Array.from({ length: 24 }, (_, candidateIndex) => ({
    candidateIndex,
    recoveryReplay: false,
  }));
  assert.equal(shouldQueueFinalLandmarkLocalRecovery({
    routeNetworkKind: 'landmark-perimeter-loop',
    futureRequiredNetworkCount: 0,
    error: 'route-network-spine-segment-unrealizable',
  }), true);
  appendRouteNetworkRecoveryScheduleEntry(scheduledCandidateAttempts, {
    candidateIndex: 7,
    candidateOrdinal: 7,
  });
  assert.deepEqual(scheduledCandidateAttempts.at(-1), {
    candidateIndex: 7,
    candidateOrdinal: 7,
    recoveryReplay: true,
    recoveryTargetOrdinal: null,
    landmarkBacktracking: null,
    futureEndpointReservationWitness: null,
  });
  assert.equal(
    new Set(scheduledCandidateAttempts.map(({ candidateIndex }) => candidateIndex)).size,
    24,
    'local recovery replays an existing identity instead of extending the candidate domain',
  );
  assert.equal(shouldQueueFinalLandmarkLocalRecovery({
    recoveryReplay: true,
    routeNetworkKind: 'landmark-perimeter-loop',
    error: 'route-network-spine-segment-unrealizable',
  }), false);
  assert.equal(shouldQueueFinalLandmarkLocalRecovery({
    routeNetworkKind: 'landmark-perimeter-loop',
    futureRequiredNetworkCount: 1,
    error: 'route-network-spine-segment-unrealizable',
  }), false);
  assert.equal(shouldQueueFinalLandmarkLocalRecovery({
    routeNetworkKind: 'objective-route-coverage',
    futureRequiredNetworkCount: 0,
    error: 'route-network-spine-segment-unrealizable',
  }), false);
});

test('candidate budget keeps the established reserve for future required networks', () => {
  const result = consumeRouteNetworkCandidateEvaluationBudget({
    candidateEvaluations: 79,
    maximumCandidateEvaluations: 96,
    futureRequiredNetworkCount: 2,
    reservedCandidateEvaluationsPerFutureRequiredNetwork: 8,
  });

  assert.deepEqual(result, {
    accepted: true,
    candidateEvaluations: 80,
    maximumCandidateEvaluations: 96,
    reservedCandidateEvaluations: 16,
    currentNetworkCandidateEvaluationLimit: 80,
  });
  assert.equal(consumeRouteNetworkCandidateEvaluationBudget({
    candidateEvaluations: result.candidateEvaluations,
    maximumCandidateEvaluations: 96,
    futureRequiredNetworkCount: 2,
    reservedCandidateEvaluationsPerFutureRequiredNetwork: 8,
  }).accepted, false);
});

test('future endpoint recovery witnesses are exact, deterministic, and non-authoritative', () => {
  const candidate = (id, endpointOrdinal, outwardStep, x, z, size = 2) => ({
    endpointOrdinal,
    grammarId: `grammar-${id}`,
    parentLocalSocketId: 'entry',
    outwardStep,
    tangentOffsetTiles: 0,
    orientationOrdinal: 0,
    center: { x, y: 0, z },
    facing: { x: 1, y: 0, z: 0 },
    reservationVolumes: [{
      id: `${id}:reservation`,
      ownerId: 'future-grant',
      center: { x, y: 2, z },
      size: { x: size, y: 4, z: size },
    }],
  });
  const blockedFar = candidate('blocked-far', 0, 11, 30, 0);
  const selectedFirst = candidate('selected-first', 0, 10, 20, 0);
  const overlappingSecond = candidate('overlapping-second', 1, 11, 20, 0);
  const selectedSecond = candidate('selected-second', 1, 9, 20, 8);
  const nearFirst = candidate('near-first', 0, 0, 0, 0);
  const nearSecond = candidate('near-second', 1, 0, 0, 8);
  const endpointDomains = [
    {
      endpointOrdinal: 0,
      endpointId: 'first',
      candidates: [nearFirst, selectedFirst, blockedFar],
    },
    {
      endpointOrdinal: 1,
      endpointId: 'second',
      candidates: [nearSecond, selectedSecond, overlappingSecond],
    },
  ];
  const sourceSnapshot = structuredClone(endpointDomains);
  const options = {
    avoidanceVolumes: [{
      id: 'prior-network',
      center: { x: 30, y: 2, z: 0 },
      size: { x: 2, y: 4, z: 2 },
    }],
  };

  const first = selectRouteNetworkFutureEndpointReservationWitness(
    endpointDomains,
    options,
  );
  const replay = selectRouteNetworkFutureEndpointReservationWitness(
    endpointDomains,
    options,
  );

  assert.ok(first);
  assert.equal(first.signature, replay.signature);
  assert.deepEqual(
    first.candidates.map(({ grammarId }) => grammarId),
    ['grammar-selected-first', 'grammar-selected-second'],
  );
  assert.deepEqual(first.candidateIdentities, replay.candidateIdentities);
  const minimumRepairFrontier = selectRouteNetworkFutureEndpointReservationWitness(
    endpointDomains,
    {
      ...options,
      guidanceNodeVolumes: [{
        id: 'ordinary-landmark-node',
        ownerId: 'ordinary-landmark-node',
        center: { x: 20, y: 2, z: 0 },
        size: { x: 2, y: 4, z: 2 },
      }],
    },
  );
  assert.deepEqual(
    minimumRepairFrontier.candidates.map(({ grammarId }) => grammarId),
    ['grammar-near-first', 'grammar-selected-second'],
    'ordinary-plan conflicts outrank the farthest-outward tie breaker',
  );
  assert.deepEqual(
    minimumRepairFrontier.candidateSummaries[0].rankingMetrics,
    {
      parentAttachmentSegmentOwnerCount: 0,
      parentAttachmentOverlapCount: 0,
      distinctNodeOwnerCount: 0,
      nodeOverlapCount: 0,
      capOverlapCount: 0,
      distinctSegmentOwnerCount: 0,
      segmentOverlapCount: 0,
      conflictingSegmentOwners: [],
    },
  );
  const roleAwareRepairFrontier = selectRouteNetworkFutureEndpointReservationWitness(
    endpointDomains,
    {
      ...options,
      guidanceSegmentVolumes: [
        {
          id: 'parent-attachment-volume',
          ownerId: 'parent-attachment',
          guidanceSegmentId: 'parent-attachment',
          guidanceSegmentRouteRole: 'parent-station-attachment',
          guidanceSegmentFromKind: 'parentSocket',
          guidanceSegmentToKind: 'supplementSocket',
          center: { x: 20, y: 2, z: 0 },
          size: { x: 2, y: 4, z: 2 },
        },
        {
          id: 'internal-spine-volume',
          ownerId: 'internal-spine',
          guidanceSegmentId: 'internal-spine',
          guidanceSegmentRouteRole: 'route-network-spine',
          guidanceSegmentFromKind: 'supplementSocket',
          guidanceSegmentToKind: 'supplementSocket',
          center: { x: 0, y: 2, z: 0 },
          size: { x: 2, y: 4, z: 2 },
        },
      ],
    },
  );
  assert.equal(
    roleAwareRepairFrontier.candidates[0].grammarId,
    'grammar-near-first',
    'an internal-spine repair is ordered before disturbing a parent attachment',
  );
  assert.deepEqual(
    roleAwareRepairFrontier.candidateSummaries[0]
      .rankingMetrics.conflictingSegmentOwners,
    [{
      segmentId: 'internal-spine',
      routeRole: 'route-network-spine',
      fromKind: 'supplementSocket',
      toKind: 'supplementSocket',
    }],
  );
  assert.deepEqual(endpointDomains, sourceSnapshot);
  assert.equal(
    first.reservationVolumes.some(({ id }) => id === 'prior-network'),
    false,
    'the witness returns only future candidate volumes and is not serialized as accepted geometry',
  );
});

test('witness-guided recovery entries retain an explicit unguided fallback identity', () => {
  const scheduledCandidateAttempts = [];
  const witness = {
    signature: 'witness-signature',
    planningVolumes: [{ id: 'local-only-witness' }],
  };
  appendRouteNetworkRecoveryScheduleEntry(scheduledCandidateAttempts, {
    candidateIndex: 4,
    candidateOrdinal: 9,
    recoveryTargetOrdinal: 3,
    futureEndpointReservationWitness: witness,
  });
  appendRouteNetworkRecoveryScheduleEntry(scheduledCandidateAttempts, {
    candidateIndex: 4,
    candidateOrdinal: 9,
    recoveryTargetOrdinal: 3,
    futureEndpointReservationWitness: null,
  });

  assert.equal(scheduledCandidateAttempts[0].futureEndpointReservationWitness, witness);
  assert.equal(scheduledCandidateAttempts[1].futureEndpointReservationWitness, null);
  assert.deepEqual(
    scheduledCandidateAttempts.map(({ candidateIndex, candidateOrdinal, recoveryReplay }) => ({
      candidateIndex,
      candidateOrdinal,
      recoveryReplay,
    })),
    [
      { candidateIndex: 4, candidateOrdinal: 9, recoveryReplay: true },
      { candidateIndex: 4, candidateOrdinal: 9, recoveryReplay: true },
    ],
  );
});

test('ordinary landmark endpoints deterministically warm-start a complete tuple domain', () => {
  const placement = (x, z, parentLocalSocketId) => ({
    center: { x, y: 7, z },
    facing: { x: x < 0 ? 1 : -1, y: 0, z: 0 },
    parentLocalSocketId,
  });
  const tuple = (id, first, second, phase) => ({
    id,
    phase,
    candidates: [first, second],
  });
  const endpointTuples = [
    tuple('ranked-0', placement(-28, 0, 'entry'), placement(28, 0, 'exit'),
      'primary/primary'),
    tuple('ranked-1', placement(-28, 8.4, 'entry'), placement(28, 0, 'exit'),
      'primary/fallback'),
    tuple('ordinary-match', placement(-19.6, 0, 'entry'), placement(19.6, 8.4, 'exit'),
      'primary/primary'),
    tuple('ranked-3', placement(-28, -8.4, 'entry'), placement(28, -8.4, 'exit'),
      'fallback/fallback'),
  ];
  const diagnostics = [
    {
      endpointOrdinal: 1,
      selectedCenter: { x: 19.6, y: 7, z: 8.4 },
      selectedFacing: { x: -1, y: 0, z: 0 },
      selectedParentLocalSocketId: 'exit',
    },
    {
      endpointOrdinal: 0,
      selectedCenter: { x: -19.6, y: 7, z: 0 },
      selectedFacing: { x: 1, y: 0, z: 0 },
      selectedParentLocalSocketId: 'entry',
    },
  ];
  const diagnosticsSnapshot = structuredClone(diagnostics);
  const warmStart = createLandmarkEndpointRecoveryWarmStart(diagnostics);

  assert.deepEqual(warmStart, {
    endpointPlacements: [
      placement(-19.6, 0, 'entry'),
      placement(19.6, 8.4, 'exit'),
    ],
  });
  assert.deepEqual(diagnostics, diagnosticsSnapshot);
  assert.equal(
    landmarkEndpointTupleWarmStartMatchOrdinal(endpointTuples, warmStart),
    2,
  );

  const promoted = promoteLandmarkEndpointTupleWarmStart(endpointTuples, warmStart);
  const repeated = promoteLandmarkEndpointTupleWarmStart(endpointTuples, structuredClone(warmStart));
  assert.deepEqual(promoted.map(({ id }) => id), [
    'ordinary-match',
    'ranked-0',
    'ranked-1',
    'ranked-3',
  ]);
  assert.deepEqual(repeated.map(({ id }) => id), promoted.map(({ id }) => id));
  assert.equal(promoted.length, endpointTuples.length);
  assert.deepEqual(new Set(promoted), new Set(endpointTuples));
  assert.deepEqual(endpointTuples.map(({ id }) => id), [
    'ranked-0',
    'ranked-1',
    'ordinary-match',
    'ranked-3',
  ]);

  const noMatch = structuredClone(warmStart);
  noMatch.endpointPlacements[0].center.x += 2.8;
  assert.equal(landmarkEndpointTupleWarmStartMatchOrdinal(endpointTuples, noMatch), -1);
  assert.equal(promoteLandmarkEndpointTupleWarmStart(endpointTuples, noMatch), endpointTuples);
});

test('landmark endpoint tuples interleave both exact endpoint centers without loss', () => {
  const tuple = (id, x, y, z) => ({
    id,
    candidates: [{ center: { x: -1, y: 0, z: 0 } }, { center: { x, y, z } }],
  });
  const endpointTuples = [
    tuple('a0-promoted', 10, 0, 10),
    tuple('a1', 10, 0, 10),
    tuple('b0', 20, 0, 20),
    tuple('b1', 20, 0, 20),
    tuple('d0-y-distinct', 20, 7, 20),
    tuple('d1-y-distinct', 20, 7, 20),
    tuple('c0', 30, 0, 30),
    tuple('c1', 30, 0, 30),
    tuple('a2', 10, 0, 10),
  ];
  const inputSnapshot = structuredClone(endpointTuples);

  const interleaved = interleaveLandmarkEndpointTuplesByExactEndpointAxes(
    endpointTuples,
  );
  const replay = interleaveLandmarkEndpointTuplesByExactEndpointAxes(
    structuredClone(endpointTuples),
  );

  assert.deepEqual(interleaved.map(({ id }) => id), [
    'a0-promoted',
    'b0',
    'd0-y-distinct',
    'c0',
    'a1',
    'b1',
    'd1-y-distinct',
    'c1',
    'a2',
  ]);
  assert.deepEqual(replay.map(({ id }) => id), interleaved.map(({ id }) => id));
  assert.equal(interleaved.length, endpointTuples.length);
  assert.deepEqual(new Set(interleaved.map(({ id }) => id)), new Set(
    endpointTuples.map(({ id }) => id),
  ));
  assert.deepEqual(endpointTuples, inputSnapshot);
});

test('landmark endpoint tuple interleave exposes endpoint-zero diversity early', () => {
  const tuple = (id, firstX, secondX) => ({
    id,
    candidates: [
      { center: { x: firstX, y: 0, z: 0 } },
      { center: { x: secondX, y: 0, z: 10 } },
    ],
  });
  const endpointTuples = [
    tuple('a0-promoted', 10, 100),
    tuple('a0-orientation', 10, 100),
    tuple('a1', 10, 200),
    tuple('b0', 20, 100),
    tuple('b0-orientation', 20, 100),
    tuple('b1', 20, 200),
    tuple('c0', 30, 100),
    tuple('c1', 30, 200),
    tuple('a2', 10, 100),
  ];

  const interleaved = interleaveLandmarkEndpointTuplesByExactEndpointAxes(
    endpointTuples,
  );

  assert.deepEqual(interleaved.map(({ id }) => id), [
    'a0-promoted',
    'b1',
    'c1',
    'a1',
    'b0',
    'c0',
    'a0-orientation',
    'b0-orientation',
    'a2',
  ]);
  assert.deepEqual(interleaved.slice(0, 3).map(({ candidates }) => (
    candidates[0].center.x
  )), [10, 20, 30]);
  assert.equal(interleaved.length, endpointTuples.length);
  assert.deepEqual(new Set(interleaved.map(({ id }) => id)), new Set(
    endpointTuples.map(({ id }) => id),
  ));
});

test('landmark endpoint tuple interleave exposes socket orientations early', () => {
  const tuple = (id, firstX, parentLocalSocketId, facing) => ({
    id,
    candidates: [
      { center: { x: firstX, y: 0, z: 0 }, parentLocalSocketId, facing },
      {
        center: { x: 100, y: 0, z: 10 },
        parentLocalSocketId: 'entry',
        facing: { x: 0, y: 0, z: 1 },
      },
    ],
  });
  const endpointTuples = [
    tuple('exit-a-promoted', 10, 'exit', { x: -1, y: 0, z: 0 }),
    tuple('exit-b', 20, 'exit', { x: -1, y: 0, z: 0 }),
    tuple('entry-a', 10, 'entry', { x: 1, y: 0, z: 0 }),
    tuple('entry-b', 20, 'entry', { x: 1, y: 0, z: 0 }),
    tuple('left-a', 10, 'left', { x: 0, y: 0, z: 1 }),
    tuple('left-b', 20, 'left', { x: 0, y: 0, z: 1 }),
  ];

  const interleaved = interleaveLandmarkEndpointTuplesByExactEndpointAxes(
    endpointTuples,
  );

  assert.deepEqual(interleaved.map(({ id }) => id), [
    'exit-a-promoted',
    'entry-a',
    'left-a',
    'exit-b',
    'entry-b',
    'left-b',
  ]);
  assert.deepEqual(interleaved.slice(0, 3).map(({ candidates }) => (
    candidates[0].parentLocalSocketId
  )), ['exit', 'entry', 'left']);
  assert.equal(interleaved.length, endpointTuples.length);
});

test('landmark endpoint tuple interleave exposes primary and fallback phases early', () => {
  const tuple = (id, phase) => ({
    id,
    phase,
    candidates: [
      {
        center: { x: 0, y: 0, z: 0 },
        parentLocalSocketId: 'exit',
        facing: { x: -1, y: 0, z: 0 },
      },
      {
        center: { x: 10, y: 0, z: 10 },
        parentLocalSocketId: 'entry',
        facing: { x: 0, y: 0, z: 1 },
      },
    ],
  });
  const endpointTuples = [
    tuple('pp0-promoted', 'primary/primary'),
    tuple('pp1', 'primary/primary'),
    tuple('fp0', 'fallback/primary'),
    tuple('fp1', 'fallback/primary'),
    tuple('pf0', 'primary/fallback'),
    tuple('pf1', 'primary/fallback'),
    tuple('ff0', 'fallback/fallback'),
    tuple('ff1', 'fallback/fallback'),
  ];

  const interleaved = interleaveLandmarkEndpointTuplesByExactEndpointAxes(
    endpointTuples,
  );

  assert.deepEqual(interleaved.map(({ id }) => id), [
    'pp0-promoted',
    'fp0',
    'pf0',
    'ff0',
    'pp1',
    'fp1',
    'pf1',
    'ff1',
  ]);
  assert.deepEqual(interleaved.slice(0, 4).map(({ phase }) => phase), [
    'primary/primary',
    'fallback/primary',
    'primary/fallback',
    'fallback/fallback',
  ]);
  assert.equal(interleaved.length, endpointTuples.length);
});

test('landmark endpoint tuple guidance prioritizes the interior side without loss', () => {
  const tuple = (id, x) => ({
    id,
    candidates: [
      { center: { x: -20, y: 0, z: 0 } },
      { center: { x, y: 0, z: 0 } },
    ],
  });
  const endpointTuples = [
    tuple('ordinary-promoted', 0),
    tuple('opposite-side', -5),
    tuple('interior-side-far', 10),
    tuple('interior-side-near', 4),
  ];
  const inputSnapshot = structuredClone(endpointTuples);

  const prioritized = prioritizeLandmarkEndpointTuplesByDirectionalGuidance(
    endpointTuples,
    {
      endpointOrdinal: 1,
      origin: { x: 0, y: 0, z: 0 },
      toward: { x: 20, y: 0, z: 0 },
    },
  );

  assert.deepEqual(prioritized.map(({ id }) => id), [
    'ordinary-promoted',
    'interior-side-far',
    'interior-side-near',
    'opposite-side',
  ]);
  assert.deepEqual(endpointTuples, inputSnapshot);
});

test('single internal-spine conflict derives reconnect directional guidance', () => {
  const warmStart = {
    endpointPlacements: [
      { center: { x: 0, y: 0, z: 0 } },
      { center: { x: 10, y: 0, z: 0 } },
    ],
  };
  const planned = {
    nodes: [
      { id: 'endpoint-0', placement: { center: { x: 0, y: 0, z: 0 } } },
      { id: 'interior', placement: { center: { x: 30, y: 0, z: 0 } } },
      { id: 'endpoint-1', placement: { center: { x: 10, y: 0, z: 0 } } },
    ],
    segments: [{
      id: 'internal-spine',
      routeRole: 'route-network-spine',
      fromNodeId: 'interior',
      toNodeId: 'endpoint-1',
    }],
  };
  const witness = {
    candidateSummaries: [{
      center: { x: 12, y: 0, z: 0 },
      rankingMetrics: {
        conflictingSegmentOwners: [{ segmentId: 'internal-spine' }],
      },
    }],
  };

  assert.deepEqual(
    createLandmarkEndpointTupleDirectionalGuidance(planned, witness, warmStart),
    {
      endpointOrdinal: 1,
      origin: { x: 12, y: 0, z: 0 },
      toward: { x: 30, y: 0, z: 0 },
      conflictSegmentId: 'internal-spine',
    },
  );
});

test('landmark parent attachment paths advance as a finite pair odometer', () => {
  assert.deepEqual(
    nextLandmarkParentAttachmentPathOrdinals([0, 0], [2, 3]),
    [0, 1],
  );
  assert.deepEqual(
    nextLandmarkParentAttachmentPathOrdinals([0, 2], [2, 3]),
    [1, 0],
  );
  assert.deepEqual(
    nextLandmarkParentAttachmentPathOrdinals([0, 0], [2, 0]),
    [1, 0],
  );
  assert.equal(
    nextLandmarkParentAttachmentPathOrdinals([1, 2], [2, 3]),
    null,
  );
});

test('coverage parent attachment paths retain a finite alternate-path axis', () => {
  const volume = (id, x, z) => ({
    id,
    center: { x, y: 1.8, z },
    size: { x: 2.8, y: 3.6, z: 2.8 },
  });
  const domains = [[{
    id: 'endpoint-0-shortest',
    collisionVolumes: [volume('endpoint-0-shortest-volume', 0, 0)],
  }, {
    id: 'endpoint-0-dogleg',
    collisionVolumes: [volume('endpoint-0-dogleg-volume', 8.4, 0)],
  }], [{
    id: 'endpoint-1-only',
    collisionVolumes: [volume('endpoint-1-only-volume', 0, 0)],
  }]];
  const snapshot = structuredClone(domains);

  assert.deepEqual(
    [...routeNetworkParentAttachmentPathCombinations(domains)].map((combination) => (
      combination.map(({ id }) => id)
    )),
    [['endpoint-0-dogleg', 'endpoint-1-only']],
    'the shortest conflicting attachment is skipped without deleting its endpoint placement',
  );
  assert.deepEqual(domains, snapshot, 'finite path enumeration does not mutate candidate domains');
  assert.deepEqual(
    [...routeNetworkParentAttachmentPathCombinations([
      domains[0].slice(0, 1),
      domains[1],
    ])],
    [],
    'an actually exhausted attachment product remains rejected',
  );
});

test('parent attachment seam grants remain bound to their owning endpoint', () => {
  const envelope = (x) => ({
    center: { x, y: 2.8, z: 0 },
    size: { x: 4, y: 5.6, z: 4 },
  });
  const parentSeams = new Map([
    [0, { overlapEnvelope: envelope(0) }],
    [1, { overlapEnvelope: envelope(10) }],
    [2, { overlapEnvelope: envelope(20) }],
  ]);
  const routeOption = {
    endpointSeams: [
      { overlapEnvelope: envelope(0) },
      { overlapEnvelope: envelope(10) },
    ],
  };
  const edgeAB = { fromIndex: 0, toIndex: 1 };
  const attachmentAGrants = routeNetworkParentAttachmentSharedSeamGrants(
    edgeAB,
    routeOption,
    0,
    parentSeams,
  );

  assert.equal(attachmentAGrants.length, 1);
  assert.equal(attachmentAGrants[0].center.x, 0);
  assert.deepEqual(
    routeNetworkParentAttachmentSharedSeamGrants(
      edgeAB,
      routeOption,
      2,
      parentSeams,
    ),
    [],
    'an attachment outside the edge receives neither endpoint seam',
  );
  assert.deepEqual(
    routeNetworkParentAttachmentSharedSeamGrants(
      { fromIndex: 1, toIndex: 2 },
      {
        endpointSeams: [
          { overlapEnvelope: envelope(10) },
          { overlapEnvelope: envelope(20) },
        ],
      },
      0,
      parentSeams,
    ),
    [],
    'attachment A receives no grant on a B-C edge',
  );
  assert.equal(
    routeNetworkParentAttachmentSharedSeamGrants(
      { fromIndex: 0, toIndex: 0 },
      {
        endpointSeams: [
          { overlapEnvelope: envelope(0) },
          { overlapEnvelope: envelope(0) },
        ],
      },
      0,
      parentSeams,
    ).length,
    2,
    'a topology self-edge retains both endpoint seam ordinals for its owner',
  );

  const supplementalVolume = (x) => ({
    center: { x, y: 2.8, z: 0 },
    size: { x: 2, y: 3.6, z: 2 },
    purpose: 'supplement-connector-occupied',
  });
  assert.equal(
    routeNetworkPlanningOverlapIsGranted(
      supplementalVolume(0),
      supplementalVolume(0),
      attachmentAGrants,
    ),
    true,
    'the owning A handoff remains legal',
  );
  assert.equal(
    routeNetworkPlanningOverlapIsGranted(
      supplementalVolume(10),
      supplementalVolume(10),
      attachmentAGrants,
    ),
    false,
    'A cannot borrow B seam permission for a foreign collision',
  );
});

test('equivalent parent attachment behaviors consume every logical visit but one DFS each', () => {
  const memo = createRouteNetworkParentAttachmentSpineAttemptMemo();
  const signatures = [
    routeNetworkParentAttachmentSpineBehaviorSignature(
      new Uint32Array([0x00000005, 0x80000000]),
      [8.4, 11.2],
    ),
    routeNetworkParentAttachmentSpineBehaviorSignature(
      new Uint32Array([0x0000000a, 0x00000001]),
      [8.4, 11.2],
    ),
  ];
  let observedDfsExecutions = 0;
  let observedDomainMaterializations = 0;
  for (let logicalVisit = 0; logicalVisit < 20000; logicalVisit += 1) {
    const signature = signatures[logicalVisit % signatures.length];
    if (!memo.begin(signature)) continue;
    observedDomainMaterializations += 1;
    observedDfsExecutions += 1;
    memo.recordFailure(signature);
  }

  assert.equal(observedDfsExecutions, 2);
  assert.equal(observedDomainMaterializations, 2);
  assert.deepEqual(memo.snapshot(), {
    logicalAttempts: 20000,
    exactDfsExecutions: 2,
    cacheHits: 19998,
    cachedFailureCount: 2,
    cachedCoverageFailureCount: 2,
    cachedCompleteFailureCount: 0,
  });
});

test('parent attachment behavior signatures preserve option bits beyond one word', () => {
  const option31 = routeNetworkParentAttachmentSpineBehaviorSignature(
    new Uint32Array([0x80000000, 0x00000000]),
    [8.4, 11.2],
  );
  const option63 = routeNetworkParentAttachmentSpineBehaviorSignature(
    new Uint32Array([0x00000000, 0x80000000]),
    [8.4, 11.2],
  );
  assert.notEqual(option31, option63);
  assert.match(option63, /^00000000\.80000000:/);
});

test('parent attachment behavior memo separates distance and complete-leaf failures', () => {
  const memo = createRouteNetworkParentAttachmentSpineAttemptMemo();
  const sharedMask = new Uint32Array([0x00000001]);
  const shortSignature = routeNetworkParentAttachmentSpineBehaviorSignature(
    sharedMask,
    [5.6, 8.4],
  );
  const longSignature = routeNetworkParentAttachmentSpineBehaviorSignature(
    sharedMask,
    [8.4, 8.4],
  );
  assert.notEqual(shortSignature, longSignature);

  assert.equal(memo.begin(shortSignature), true);
  memo.recordFailure(shortSignature);
  assert.equal(memo.begin(shortSignature), false);
  assert.equal(memo.begin(longSignature), true);
  const completeSignature = routeNetworkParentAttachmentSpineBehaviorSignature(
    sharedMask,
    [8.4, 8.4],
    {
      blockedTopologyOptionMask: new Uint32Array([0x00000004]),
      conflictingInactiveCapMask: new Uint32Array([0x00000002]),
    },
  );
  memo.recordFailure(longSignature, {
    reachedCompleteCoverageLeaf: true,
    completeBehaviorSignature: completeSignature,
  });
  assert.equal(memo.requiresCompleteBehaviorSignature(longSignature), true);
  assert.equal(
    memo.begin(longSignature, { completeBehaviorSignature: completeSignature }),
    false,
    'an equivalent topology/cap-stage failure reuses the complete influence vector',
  );
  const alternateCompleteSignature = routeNetworkParentAttachmentSpineBehaviorSignature(
    sharedMask,
    [8.4, 8.4],
    {
      blockedTopologyOptionMask: new Uint32Array([0x00000008]),
      conflictingInactiveCapMask: new Uint32Array([0x00000002]),
    },
  );
  assert.equal(memo.begin(longSignature, {
    completeBehaviorSignature: alternateCompleteSignature,
  }), true, 'topology-only differences do not share a failed complete-leaf result');
  const alternateCapSignature = routeNetworkParentAttachmentSpineBehaviorSignature(
    sharedMask,
    [8.4, 8.4],
    {
      blockedTopologyOptionMask: new Uint32Array([0x00000004]),
      conflictingInactiveCapMask: new Uint32Array([0x00000008]),
    },
  );
  assert.notEqual(
    alternateCapSignature,
    completeSignature,
    'inactive-cap-only differences remain distinct semantic classes',
  );
  assert.deepEqual(memo.snapshot(), {
    logicalAttempts: 5,
    exactDfsExecutions: 3,
    cacheHits: 2,
    cachedFailureCount: 2,
    cachedCoverageFailureCount: 1,
    cachedCompleteFailureCount: 1,
  });
});

test('correlated prefixes reserve only singleton parent attachment paths', () => {
  const shortest = {
    id: 'shortest',
    collisionVolumes: [{ id: 'shortest-volume' }],
  };
  const dogleg = {
    id: 'dogleg',
    collisionVolumes: [{ id: 'dogleg-volume' }],
  };
  const multiPathDomain = { candidates: [shortest, dogleg] };
  const snapshot = structuredClone(multiPathDomain);

  assert.deepEqual(routeNetworkParentAttachmentPrefixReservation(multiPathDomain), {
    compatible: true,
    candidateCount: 2,
    collisionVolumes: [],
  }, 'a cheap prefix cannot pin the shortest member of an unresolved path domain');
  assert.deepEqual(routeNetworkParentAttachmentPrefixReservation({
    candidates: [dogleg],
  }), {
    compatible: true,
    candidateCount: 1,
    collisionVolumes: dogleg.collisionVolumes,
  }, 'a singleton attachment body is immutable and safe to reserve');
  assert.deepEqual(routeNetworkParentAttachmentPrefixReservation({ candidates: [] }), {
    compatible: false,
    candidateCount: 0,
    collisionVolumes: [],
  });
  assert.deepEqual(multiPathDomain, snapshot, 'prefix reservation does not mutate the domain');
});

test('complete viable topology domains never expose consumed singleton fallbacks', () => {
  const legalIds = ['parallel', 'multi-door', 'split-level'];
  const initial = createDungeonSelectionBag({ shuffle: () => legalIds }, legalIds);
  const afterParallel = dungeonSelectionBagCandidates(initial, legalIds)
    .find(({ id }) => id === 'parallel').state;
  const afterMultiDoor = dungeonSelectionBagCandidates(afterParallel, legalIds)
    .find(({ id }) => id === 'multi-door').state;
  const parentSnapshot = structuredClone(afterMultiDoor);

  const selections = routeNetworkTopologySelectionCandidates(
    afterMultiDoor,
    legalIds,
    {
      grant: { kind: 'cross-band-shortcut', endpointSockets: [] },
      physicalSignatures: [{ moduleCount: 4 }],
    },
  );

  assert.deepEqual(selections.map(({ id }) => id), ['split-level']);
  assert.deepEqual(selections[0].legalIds, legalIds);
  assert.deepEqual(afterMultiDoor, parentSnapshot);
});

test('an independently exhausted viable topology domain refills as one domain', () => {
  const topologyIds = ['parallel', 'multi-door', 'stacked-interchange'];
  const initial = createDungeonSelectionBag({ shuffle: () => topologyIds }, topologyIds);
  const afterParallel = dungeonSelectionBagCandidates(initial, topologyIds)
    .find(({ id }) => id === 'parallel').state;
  const afterMultiDoor = dungeonSelectionBagCandidates(afterParallel, topologyIds)
    .find(({ id }) => id === 'multi-door').state;
  const parentSnapshot = structuredClone(afterMultiDoor);
  const grant = {
    kind: 'objective-route-coverage',
    endpointSockets: [{ id: 'first' }, { id: 'second' }],
  };

  const selections = routeNetworkTopologySelectionCandidates(
    afterMultiDoor,
    topologyIds,
    { grant, physicalSignatures: [{ moduleCount: 4 }] },
  );

  assert.deepEqual(selections.map(({ id }) => id), ['parallel', 'multi-door']);
  assert.equal(selections.every(({ refilled }) => refilled === true), true);
  assert.equal(selections[0].domainKey, selections[1].domainKey);
  assert.deepEqual(selections.map(({ legalIds }) => legalIds), [
    ['parallel', 'multi-door'],
    ['parallel', 'multi-door'],
  ]);
  assert.deepEqual(afterMultiDoor, parentSnapshot);

  for (const selection of selections) {
    const witness = createDungeonSelectionBagWitness({
      family: 'topology',
      bag: afterMultiDoor,
      legalIds: selection.legalIds,
      selection,
    });
    assert.deepEqual(witness.legalIds, ['parallel', 'multi-door']);
    assert.deepEqual(validateDungeonSelectionBagWitness(witness), {
      accepted: true,
      errors: [],
    });
  }
});

test('viable topology domains quantify support over every pre-cap physical signature', () => {
  const topologyIds = Object.freeze([
    'stacked-interchange',
    'parallel-gallery-loop',
    'fork-merge-h-loop',
  ]);
  const fourModuleSignatures = Object.freeze([
    Object.freeze({ moduleCount: 4, elevationMode: 'slope' }),
    Object.freeze({ moduleCount: 4, elevationMode: 'lift' }),
  ]);
  const twoEndpointGrant = {
    kind: 'objective-route-coverage',
    endpointSockets: [{ id: 'first' }, { id: 'second' }],
  };
  const threeEndpointGrant = {
    ...twoEndpointGrant,
    endpointSockets: [
      ...twoEndpointGrant.endpointSockets,
      { id: 'third' },
    ],
  };

  assert.deepEqual(routeNetworkViableTopologyIds({
    topologyIds,
    grant: twoEndpointGrant,
    physicalSignatures: fourModuleSignatures,
  }), ['parallel-gallery-loop', 'fork-merge-h-loop']);
  assert.deepEqual(routeNetworkViableTopologyIds({
    topologyIds,
    grant: twoEndpointGrant,
    physicalSignatures: [
      ...fourModuleSignatures,
      { moduleCount: 5, elevationMode: 'split-level-platform' },
    ],
  }), [...topologyIds]);
  assert.deepEqual(routeNetworkViableTopologyIds({
    topologyIds,
    grant: threeEndpointGrant,
    physicalSignatures: [{ moduleCount: 5 }],
  }), ['parallel-gallery-loop', 'fork-merge-h-loop']);
  assert.deepEqual(topologyIds, [
    'stacked-interchange',
    'parallel-gallery-loop',
    'fork-merge-h-loop',
  ]);
  assert.deepEqual(fourModuleSignatures, [
    { moduleCount: 4, elevationMode: 'slope' },
    { moduleCount: 4, elevationMode: 'lift' },
  ]);
});

test('new compatibility domains seed consumed IDs in immutable bag order', () => {
  const bag = {
    order: ['slope', 'split-level-platform', 'lift'],
    cycle: 0,
    consumedIds: [],
    globalConsumedIds: ['split-level-platform', 'slope'],
    domains: {
      '["lift"]': { cycle: 0, consumedIds: [] },
    },
  };
  const [selection] = dungeonSelectionBagCandidates(
    bag,
    ['slope', 'split-level-platform', 'lift'],
  );
  assert.equal(selection.id, 'lift');
  assert.deepEqual(selection.beforeDomainState.consumedIds, [
    'slope',
    'split-level-platform',
  ]);
  const witness = createDungeonSelectionBagWitness({
    family: 'elevation',
    bag,
    legalIds: ['slope', 'split-level-platform', 'lift'],
    selection,
  });
  assert.deepEqual(validateDungeonSelectionBagWitness(witness), {
    accepted: true,
    errors: [],
  });

  const exhausted = {
    ...bag,
    globalConsumedIds: [...bag.order],
  };
  const [refilledGlobalSelection] = dungeonSelectionBagCandidates(
    exhausted,
    ['slope', 'split-level-platform', 'lift'],
  );
  assert.deepEqual(refilledGlobalSelection.beforeGlobalConsumedIds, []);
  assert.deepEqual(refilledGlobalSelection.beforeDomainState.consumedIds, []);
  assert.equal(refilledGlobalSelection.globalRefilled, true);
});

test('endpoint seams never waive a future required-network staging reservation', () => {
  const corridor = {
    id: 'current-network:corridor',
    center: { x: 0, y: 2.8, z: 0 },
    size: { x: 8.4, y: 5.6, z: 8.4 },
  };
  const futureReservation = {
    id: 'future-grant:staging:0:flat-approach',
    ownerId: 'future-grant',
    center: { ...corridor.center },
    size: { ...corridor.size },
    purpose: 'future-route-network-flat-approach-reservation',
  };
  const unscopedSeam = {
    id: 'current-network:endpoint-seam',
    center: { ...corridor.center },
    size: { x: 14, y: 5.6, z: 14 },
    parentOwnerId: null,
  };
  assert.equal(
    routeNetworkPlanningOverlapIsGranted(
      corridor,
      futureReservation,
      [unscopedSeam],
    ),
    false,
  );
});

test('planning-volume spatial lookup preserves full-scan node collision semantics', () => {
  const node = {
    grammarId: 'fixture-module',
    occupiedVolumes: [{
      id: 'node:occupied',
      center: { x: 8.35, y: 2, z: -8.35 },
      size: { x: 0.4, y: 4, z: 0.4 },
    }],
    clearanceVolumes: [{
      id: 'node:clearance',
      center: { x: -8.35, y: 2, z: 8.35 },
      size: { x: 0.4, y: 4, z: 0.4 },
    }],
  };
  const avoidanceVolumes = [
    {
      id: 'positive-boundary-overlap',
      center: { x: 8.55, y: 2, z: -8.35 },
      size: { x: 0.2, y: 1, z: 0.2 },
    },
    {
      id: 'negative-boundary-overlap',
      center: { x: -8.55, y: 2, z: 8.35 },
      size: { x: 0.2, y: 1, z: 0.2 },
    },
    {
      id: 'vertically-separated',
      center: { x: 8.35, y: 8.01, z: -8.35 },
      size: { x: 0.2, y: 4, z: 0.2 },
    },
    {
      id: 'distant',
      center: { x: 840, y: 2, z: -840 },
      size: { x: 1, y: 1, z: 1 },
    },
  ];
  const nearbyAvoidanceVolumes = createPlanningVolumeSpatialLookup(avoidanceVolumes);

  assert.equal(nodePlanningCollisionScore(node, avoidanceVolumes), 2);
  assert.equal(
    indexedNodePlanningCollisionScore(node, nearbyAvoidanceVolumes),
    nodePlanningCollisionScore(node, avoidanceVolumes),
  );
});

test('planning-volume spatial lookup preserves scoped overlap grants', () => {
  const node = {
    grammarId: 'fixture-module',
    occupiedVolumes: [{
      id: 'node:occupied',
      center: { x: 8.4, y: 2, z: 0 },
      size: { x: 2, y: 4, z: 2 },
    }],
  };
  const avoidanceVolumes = [{
    id: 'host:threshold',
    ownerId: 'host',
    center: { x: 9.1, y: 2, z: 0 },
    size: { x: 2, y: 4, z: 2 },
  }];
  const matchingGrant = {
    id: 'grant:matching',
    parentOwnerId: 'host',
    moduleTemplateId: 'fixture-module',
    center: { x: 8.75, y: 2, z: 0 },
    size: { x: 1.4, y: 4, z: 2 },
  };
  const wrongModuleGrant = {
    ...matchingGrant,
    id: 'grant:wrong-module',
    moduleTemplateId: 'other-module',
  };
  const nearbyAvoidanceVolumes = createPlanningVolumeSpatialLookup(avoidanceVolumes);

  for (const grants of [[], [matchingGrant], [wrongModuleGrant]]) {
    assert.equal(
      indexedNodePlanningCollisionScore(node, nearbyAvoidanceVolumes, grants),
      nodePlanningCollisionScore(node, avoidanceVolumes, grants),
    );
  }
  assert.equal(nodePlanningCollisionScore(node, avoidanceVolumes), 1);
  assert.equal(nodePlanningCollisionScore(node, avoidanceVolumes, [matchingGrant]), 0);
  assert.equal(nodePlanningCollisionScore(node, avoidanceVolumes, [wrongModuleGrant]), 1);
});

test('inverted future endpoint bitsets preserve brute-force mixed phase masks', () => {
  const candidateAt = (id, x, z = 0) => ({
    id,
    reservationVolumes: [{
      id: `${id}:reservation`,
      center: { x, y: 2, z },
      size: { x: 2, y: 4, z: 2 },
    }],
  });
  const domains = [
    {
      primaryCandidates: Array.from(
        { length: 70 },
        (_, ordinal) => candidateAt(`domain0:primary:${ordinal}`, ordinal * 20),
      ),
      fallbackCandidates: [
        candidateAt('domain0:fallback:0', 0, 100),
        candidateAt('domain0:fallback:1', 20, 100),
        candidateAt('domain0:fallback:2', 40, 100),
        { id: 'domain0:fallback:3:no-reservation' },
      ],
    },
    {
      primaryCandidates: [
        candidateAt('domain1:primary:0', 2000),
        candidateAt('domain1:primary:1', 2020),
      ],
      fallbackCandidates: Array.from(
        { length: 66 },
        (_, ordinal) => candidateAt(`domain1:fallback:${ordinal}`, 3000 + ordinal * 20),
      ),
    },
  ];
  domains[0].primaryCandidates[5].reservationVolumes.push({
    id: 'domain0:primary:5:secondary-reservation',
    center: { x: 1500, y: 2, z: 0 },
    size: { x: 2, y: 4, z: 2 },
  });
  const avoidanceVolumes = [
    candidateAt('obstacle:domain0:0', 0).reservationVolumes[0],
    candidateAt('obstacle:domain0:5:secondary', 1500).reservationVolumes[0],
    candidateAt('obstacle:domain0:64', 64 * 20).reservationVolumes[0],
    candidateAt('obstacle:domain0:69', 69 * 20).reservationVolumes[0],
    candidateAt('obstacle:domain1:primary:0', 2000).reservationVolumes[0],
    candidateAt('obstacle:domain1:primary:1', 2020).reservationVolumes[0],
    candidateAt('obstacle:domain1:fallback:0', 3000).reservationVolumes[0],
    candidateAt('obstacle:domain1:fallback:65', 3000 + 65 * 20).reservationVolumes[0],
    // Strict boundary contact is not an overlap and must preserve this bit.
    {
      id: 'obstacle:boundary-contact-only',
      center: { x: 22, y: 2, z: 0 },
      size: { x: 2, y: 4, z: 2 },
    },
  ];
  const bruteMask = (candidates) => candidates.reduce((mask, candidate, ordinal) => {
    const reservationVolumes = candidate.reservationVolumes
      ?? [candidate.reservationVolume].filter(Boolean);
    const blocked = nodePlanningCollisionScore({
      grammarId: candidate.id,
      occupiedVolumes: reservationVolumes,
      clearanceVolumes: [],
    }, avoidanceVolumes) > 0;
    return blocked ? mask : mask | (1n << BigInt(ordinal));
  }, 0n);
  const expected = domains.map((domain) => ({
    primary: bruteMask(domain.primaryCandidates),
    fallback: bruteMask(domain.fallbackCandidates),
  }));

  const evaluate = createDirectFutureEndpointBitsetEvaluator(domains);
  const actual = evaluate(avoidanceVolumes);
  const baselineAvoidanceVolumes = avoidanceVolumes.slice(0, 4);
  const prospectiveAvoidanceVolumes = avoidanceVolumes.slice(4);
  const baselineBitsets = evaluate(baselineAvoidanceVolumes);
  const baselineSnapshot = baselineBitsets.map(({ primary, fallback }) => ({
    primary,
    fallback,
  }));
  const stagedActual = evaluate(prospectiveAvoidanceVolumes, baselineBitsets);

  assert.deepEqual(actual, expected);
  assert.deepEqual(stagedActual, expected);
  assert.deepEqual(
    baselineBitsets,
    baselineSnapshot,
    'staged evaluation must not mutate the reusable accepted-volume baseline',
  );
  const populationCount = (mask) => {
    let remaining = mask;
    let count = 0;
    while (remaining > 0n) {
      remaining &= remaining - 1n;
      count += 1;
    }
    return count;
  };
  assert.deepEqual(actual.map(({ primary, fallback }) => {
    const primaryCount = populationCount(primary);
    return primaryCount > 0 ? primaryCount : populationCount(fallback);
  }), [66, 64]);
  assert.equal((actual[0].primary & (1n << 69n)) === 0n, true);
  assert.equal((actual[1].fallback & (1n << 65n)) === 0n, true);
});

function routeSignatures(paths) {
  return paths.map((path) => path.map((point) => (
    `${Number(point.x).toFixed(4)},${Number(point.y).toFixed(4)},${Number(point.z).toFixed(4)}`
  )).join('|'));
}

function routeSignatureHash(paths) {
  return createHash('sha256')
    .update(JSON.stringify(routeSignatures(paths)))
    .digest('hex');
}

test('raw planar length is invariant under duplicate and collinear route normalization', () => {
  const rawPath = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 2.8, y: 0, z: 0 },
    { x: 5.6, y: 0, z: 0 },
    { x: 5.6, y: 0, z: 2.8 },
  ];
  const normalized = normalizedRoutePath(rawPath);

  assert.deepEqual(normalized, [
    { x: 0, y: 0, z: 0 },
    { x: 5.6, y: 0, z: 0 },
    { x: 5.6, y: 0, z: 2.8 },
  ]);
  assert.ok(Math.abs(
    measureRawPlanarRouteLengthMeters(rawPath)
      - measureRawPlanarRouteLengthMeters(normalized),
  ) <= 1e-12);
});

test('raw planar precheck is conservative immediately around the featureless bound', () => {
  const pathOfLength = (lengthMeters) => [
    { x: 0, y: 0, z: 0 },
    { x: lengthMeters, y: 0, z: 0 },
  ];

  assert.equal(rawPlanarRouteExceedsLengthLimit(pathOfLength(33.5999), 33.6), false);
  assert.equal(rawPlanarRouteExceedsLengthLimit(pathOfLength(33.6), 33.6), false);
  // The wider precheck tolerance deliberately hands a numerical boundary case
  // to the unchanged authoritative normalized-path comparison.
  assert.equal(rawPlanarRouteExceedsLengthLimit(pathOfLength(33.60005), 33.6), false);
  assert.equal(rawPlanarRouteExceedsLengthLimit(pathOfLength(33.6002), 33.6), true);
  assert.equal(rawPlanarRouteExceedsLengthLimit(pathOfLength(67.1999), 67.2), false);
  assert.equal(rawPlanarRouteExceedsLengthLimit(pathOfLength(67.2002), 67.2), true);
});

test('raw length pruning preserves retained route candidates and canonical order', () => {
  const from = {
    position: { x: 0, y: 0, z: 0 },
    facing: { x: 1, y: 0, z: 0 },
  };
  const fixtures = [
    {
      id: 'opposing-level',
      to: {
        position: { x: 22.4, y: 0, z: 0 },
        facing: { x: -1, y: 0, z: 0 },
      },
      connectorFamily: 'service-gallery',
      expectedCount: 1,
      expectedHash: '8b587c59f52c1cd00b620d1fed0489faa9884585de9e65764d4929385c7dbebb',
    },
    {
      id: 'same-facing-level',
      to: {
        position: { x: 0, y: 0, z: 11.2 },
        facing: { x: 1, y: 0, z: 0 },
      },
      connectorFamily: 'service-gallery',
      expectedCount: 1,
      expectedHash: '9de90dbf81f540bc0fd3cab8baad1f923808e8470390062a891d4b61a1467f66',
    },
    {
      id: 'offset-level-order',
      to: {
        position: { x: 22.4, y: 0, z: 11.2 },
        facing: { x: -1, y: 0, z: 0 },
      },
      connectorFamily: 'service-gallery',
      expectedCount: 2,
      expectedHash: 'e559a73630ffb624d274a6c4c3aaf560560703a0eb2984d6856ea3ee9a647b83',
    },
    {
      id: 'vertical-transfer-order',
      to: {
        position: { x: 50.4, y: 2.8, z: 0 },
        facing: { x: -1, y: 0, z: 0 },
      },
      connectorFamily: 'ladder',
      expectedCount: 5,
      expectedHash: '7614b5409d85c9e0ccb3efdd65c850603862ed0923ef2ab668aceedd7af18143',
    },
  ];

  for (const fixture of fixtures) {
    const paths = facingAwareSocketRouteCandidates(from, fixture.to, {
      preferXFirst: true,
      connectorFamily: fixture.connectorFamily,
      sourceApproachMeters: [5.6],
      destinationApproachMeters: [5.6],
      minimumApproachMeters: 5.6,
    });
    assert.equal(paths.length, fixture.expectedCount, fixture.id);
    assert.equal(routeSignatureHash(paths), fixture.expectedHash, fixture.id);
  }
});

test('objective external composition may span room resets while every connector stays bounded', () => {
  const diagnostics = {};
  const placement = objectiveCoverageExternalPlacement(
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 22.4 },
    ],
    [
      { facing: { x: 1, y: 0, z: 0 } },
      { facing: { x: 1, y: 0, z: 0 } },
    ],
    {
      stationSizes: [
        { width: 14, depth: 19.6 },
        { width: 14, depth: 19.6 },
      ],
      contentRoomDepthMeters: [30.8, 19.6],
      contentRoomSizes: [
        { width: 25.2, height: 8.4, depth: 30.8 },
        { width: 19.6, height: 8.4, depth: 19.6 },
      ],
      diagnostics,
    },
  );
  const pathLength = (path) => path.slice(1).reduce((sum, point, index) => (
    sum + Math.hypot(
      Number(point.x) - Number(path[index].x),
      Number(point.y) - Number(path[index].y),
      Number(point.z) - Number(path[index].z),
    )
  ), 0);

  assert.equal(diagnostics.stage, 'composed');
  assert.ok(placement);
  assert.equal(placement.externalSpinePaths.length, 3);
  assert.ok(pathLength(placement.externalRoutePaths[0]) > 33.6);
  assert.ok(placement.externalSpinePaths.every(({ path }) => (
    pathLength(path) <= 33.6 + 1e-6
  )));
});

test('objective external terminal diagnostics replace stale refinement fields', () => {
  const diagnostics = {
    stage: 'composed',
    stateCount: 8,
    selectedStateIndex: 0,
    bestStateSocketPairs: ['stale-pair'],
  };

  const placement = objectiveCoverageExternalPlacement([], [], { diagnostics });

  assert.equal(placement, null);
  assert.equal(diagnostics.stage, 'insufficient-input');
  assert.equal(diagnostics.outerPointCount, 0);
  assert.equal(diagnostics.contentRoomCount, 2);
  assert.equal('stateCount' in diagnostics, false);
  assert.equal('selectedStateIndex' in diagnostics, false);
  assert.equal('bestStateSocketPairs' in diagnostics, false);
  assert.ok(diagnostics.planningPhaseTimings);
});

test('objective composition preselects only exact shell-clear tiered connector slices', () => {
  const grammar = (id) => GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[id];
  const stationGrammar = grammar('supplement-route-connector-through-t-v1');
  const roomGrammars = [
    grammar('supplement-blueprint-ind-room-lift-defense-rise-01-v1'),
    grammar('supplement-blueprint-ind-room-switchgear-cache-descent-01-v1'),
    grammar('supplement-blueprint-ind-room-dispatch-vault-01-v1'),
  ];
  const traversalMeters = (roomGrammar) => {
    const entry = roomGrammar.sockets.find(({ id }) => id === 'entry');
    const exit = roomGrammar.sockets.find(({ id }) => id === 'exit');
    return Math.abs(Number(exit.localPosition.x) - Number(entry.localPosition.x))
      + Math.abs(Number(exit.localPosition.z) - Number(entry.localPosition.z));
  };
  const diagnostics = {};
  const placement = objectiveCoverageExternalPlacement(
    [
      { x: -26.6, y: 14, z: 201.6 },
      { x: -26.6, y: 14, z: 179.2 },
    ],
    [
      { facing: { x: 1, y: 0, z: 0 } },
      { facing: { x: 1, y: 0, z: 0 } },
    ],
    {
      stationSizes: [stationGrammar.size, stationGrammar.size],
      stationGrammars: [stationGrammar, stationGrammar],
      contentRoomGrammars: roomGrammars,
      contentRoomDepthMeters: roomGrammars.map(traversalMeters),
      contentRoomEntryElevationMeters: roomGrammars.map((roomGrammar) => (
        Number(roomGrammar.sockets.find(({ id }) => id === 'entry').localPosition.y)
      )),
      contentRoomExitElevationMeters: roomGrammars.map((roomGrammar) => (
        Number(roomGrammar.sockets.find(({ id }) => id === 'exit').localPosition.y)
      )),
      contentRoomEntryLocalPositions: roomGrammars.map((roomGrammar) => (
        roomGrammar.sockets.find(({ id }) => id === 'entry').localPosition
      )),
      contentRoomSizes: roomGrammars.map(({ size }) => size),
      contentRoomPlanningVolumes: roomGrammars.map((roomGrammar) => ([
        ...roomGrammar.occupiedVolumes,
        ...roomGrammar.clearanceVolumes,
      ])),
      minimumApproachMeters: 5.6,
      minimumRoomApproachMeters: 5.6,
      maximumFeaturelessSpanMeters: 33.6,
      diagnostics,
    },
  );

  assert.equal(diagnostics.stage, 'composed');
  assert.ok(placement);
  assert.equal(placement.externalSpinePaths.length, 4);
  const nodeGrammars = [stationGrammar, ...roomGrammars, stationGrammar];
  const nodes = placement.centers.map((center, nodeIndex) => {
    const nodeGrammar = nodeGrammars[nodeIndex];
    const facing = placement.nodeFacings[nodeIndex];
    const transform = {
      center,
      facing,
      rotationQuarterTurns: rotationQuarterTurnsForFacing(facing),
    };
    return {
      id: `fixture-node:${nodeIndex}`,
      grammar: nodeGrammar,
      transform,
      occupiedVolumes: nodeGrammar.occupiedVolumes.map((volume, volumeOrdinal) => (
        transformDungeonVolume(volume, transform, `fixture:${nodeIndex}:occupied:${volumeOrdinal}:`)
      )),
      clearanceVolumes: nodeGrammar.clearanceVolumes.map((volume, volumeOrdinal) => (
        transformDungeonVolume(volume, transform, `fixture:${nodeIndex}:clearance:${volumeOrdinal}:`)
      )),
    };
  });
  const pointDistance = (first, second) => Math.hypot(
    Number(first.x) - Number(second.x),
    Number(first.y) - Number(second.y),
    Number(first.z) - Number(second.z),
  );
  const nodeSocket = (node, localSocketId) => {
    const socket = node.grammar.sockets.find(({ id }) => id === localSocketId);
    return {
      id: `${node.id}:socket:${localSocketId}`,
      nodeId: node.id,
      localSocketId,
      position: transformDungeonLocalPoint(socket.localPosition, node.transform),
      facing: transformDungeonLocalFacing(socket.localFacing, node.transform),
    };
  };

  for (const record of placement.externalSpinePaths) {
    const fromNode = nodes[record.fromIndex];
    const toNode = nodes[record.toIndex];
    const fromSocket = nodeSocket(fromNode, record.fromLocalSocketId);
    const toSocket = nodeSocket(toNode, record.toLocalSocketId);
    assert.ok(pointDistance(record.path[0], fromSocket.position) <= 1e-6);
    assert.ok(pointDistance(record.path.at(-1), toSocket.position) <= 1e-6);
    assert.ok(record.path.every(({ y }) => (
      Math.abs(Number(y) - Number(fromSocket.position.y)) <= 1e-6
    )));
    assert.ok(Math.abs(
      Number(fromSocket.position.y) - Number(toSocket.position.y),
    ) <= 1e-6);
    const firstLeadMeters = pointDistance(record.path[0], record.path[1]);
    const finalLeadMeters = pointDistance(record.path.at(-2), record.path.at(-1));
    assert.ok(firstLeadMeters >= 5.6 - 1e-6);
    assert.ok(finalLeadMeters >= 5.6 - 1e-6);
    const planarDirection = (from, to) => {
      const deltaX = Number(to.x) - Number(from.x);
      const deltaZ = Number(to.z) - Number(from.z);
      const length = Math.hypot(deltaX, deltaZ);
      return { x: deltaX / length, z: deltaZ / length };
    };
    if (record.path.length > 2) {
      const firstDirection = planarDirection(record.path[0], record.path[1]);
      const secondDirection = planarDirection(record.path[1], record.path[2]);
      const firstTurns = Math.abs(firstDirection.x - secondDirection.x) > 1e-6
        || Math.abs(firstDirection.z - secondDirection.z) > 1e-6;
      if (firstTurns) assert.ok(firstLeadMeters >= 8.4 - 1e-6);
      const penultimateDirection = planarDirection(
        record.path.at(-3),
        record.path.at(-2),
      );
      const finalDirection = planarDirection(
        record.path.at(-2),
        record.path.at(-1),
      );
      const finalTurns = Math.abs(penultimateDirection.x - finalDirection.x) > 1e-6
        || Math.abs(penultimateDirection.z - finalDirection.z) > 1e-6;
      if (finalTurns) assert.ok(finalLeadMeters >= 8.4 - 1e-6);
    }
    const seams = [
      createDungeonRouteEndpointSeam(fromSocket, { role: 'from' }),
      createDungeonRouteEndpointSeam(toSocket, { role: 'to' }),
    ];
    const collisionVolumes = routeSegmentPlanningCollisionVolumes(
      record.path,
      fromSocket,
      toSocket,
      5.6,
      5.6,
    );
    assert.equal(
      routePlanningVolumesRespectEndpointNodeMask(
        collisionVolumes,
        fromNode,
        seams[0],
      ),
      true,
    );
    assert.equal(
      routePlanningVolumesRespectEndpointNodeMask(
        collisionVolumes,
        toNode,
        seams[1],
      ),
      true,
    );
  }
  const upperTierPath = placement.externalSpinePaths.find(({ fromIndex, toIndex }) => (
    fromIndex === 1 && toIndex === 2
  ));
  assert.ok(upperTierPath.path.every(({ y }) => Math.abs(Number(y) - 16.8) <= 1e-6));
});

test('objective exact routing rejects widened outer turn cells beside an authored shell', () => {
  const grammar = (id) => GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS[id];
  const throughGrammar = grammar('supplement-route-connector-through-t-v1');
  const sorterGrammar = grammar(
    'supplement-blueprint-ind-room-inclined-sorter-01-v1',
  );
  const createPlanningNode = (id, nodeGrammar, transform) => ({
    id,
    grammar: nodeGrammar,
    occupiedVolumes: nodeGrammar.occupiedVolumes.map((volume, volumeOrdinal) => (
      transformDungeonVolume(volume, transform, `${id}:occupied:${volumeOrdinal}:`)
    )),
    clearanceVolumes: nodeGrammar.clearanceVolumes.map((volume, volumeOrdinal) => (
      transformDungeonVolume(volume, transform, `${id}:clearance:${volumeOrdinal}:`)
    )),
  });
  const socketFor = (node, localSocketId, transform) => {
    const source = node.grammar.sockets.find(({ id }) => id === localSocketId);
    return {
      id: `${node.id}:socket:${localSocketId}`,
      nodeId: node.id,
      localSocketId,
      position: transformDungeonLocalPoint(source.localPosition, transform),
      facing: transformDungeonLocalFacing(source.localFacing, transform),
    };
  };
  const throughTransform = {
    center: { x: 0, y: 0, z: 0 },
    rotationQuarterTurns: 0,
  };
  const sorterTransform = {
    center: { x: -25.2, y: 0, z: 28 },
    rotationQuarterTurns: 3,
  };
  const throughNode = createPlanningNode(
    'fixture-through-t',
    throughGrammar,
    throughTransform,
  );
  const sorterNode = createPlanningNode(
    'fixture-inclined-sorter',
    sorterGrammar,
    sorterTransform,
  );
  const fromSocket = socketFor(throughNode, 'exit', throughTransform);
  const toSocket = socketFor(sorterNode, 'entry', sorterTransform);
  const endpointSeams = [
    createDungeonRouteEndpointSeam(fromSocket, { role: 'from' }),
    createDungeonRouteEndpointSeam(toSocket, { role: 'to' }),
  ];
  const maskConflicts = (path, node, seam) => (
    routePlanningEndpointNodeMaskConflicts(
      routeSegmentPlanningCollisionVolumes(
        path,
        fromSocket,
        toSocket,
        5.6,
        5.6,
      ),
      node,
      seam,
    )
  );
  const shortOnly = facingAwareSocketRouteCandidates(fromSocket, toSocket, {
    sourceApproachMeters: [5.6],
    destinationApproachMeters: [5.6],
    minimumApproachMeters: 5.6,
    maximumPlanarLengthMeters: 33.6,
  });
  assert.equal(shortOnly.length, 1);
  assert.equal(maskConflicts(shortOnly[0], throughNode, endpointSeams[0]).length, 0);
  assert.ok(maskConflicts(shortOnly[0], sorterNode, endpointSeams[1]).some((conflict) => (
    String(conflict.nodeVolumeId).includes(
      'blueprint-structural-shell-north-panel-0-clearance',
    )
  )));

  const approachMeters = objectiveCoverageRouteApproachMeters();
  assert.deepEqual(approachMeters, [5.6, 8.4]);
  const exactCandidates = facingAwareSocketRouteCandidates(fromSocket, toSocket, {
    sourceApproachMeters: approachMeters,
    destinationApproachMeters: approachMeters,
    minimumApproachMeters: 5.6,
    maximumPlanarLengthMeters: 33.6,
  });
  const accepted = exactCandidates.find((path) => (
    maskConflicts(path, throughNode, endpointSeams[0]).length === 0
      && maskConflicts(path, sorterNode, endpointSeams[1]).length === 0
  ));
  assert.equal(accepted, undefined);
  const extendedApproach = exactCandidates.find((path) => Math.abs(
    Math.hypot(
      Number(path.at(-2).x) - Number(path.at(-1).x),
      Number(path.at(-2).z) - Number(path.at(-1).z),
    ) - 8.4
  ) <= 1e-6);
  assert.ok(extendedApproach);
  const extendedVolumes = routeSegmentPlanningCollisionVolumes(
    extendedApproach,
    fromSocket,
    toSocket,
    5.6,
    5.6,
  );
  const endpointConflicts = [
    ...maskConflicts(extendedApproach, throughNode, endpointSeams[0]),
    ...maskConflicts(extendedApproach, sorterNode, endpointSeams[1]),
  ];
  assert.ok(endpointConflicts.some(({ pathVolumeOrdinal }) => (
    extendedVolumes[pathVolumeOrdinal]?.purpose
      === 'supplement-connector-turn-landing'
  )));
});

test('planning collision volumes match final segments and reject a turn through a shell panel', () => {
  const from = {
    position: { x: -26.6, y: 14, z: 207.2 },
    facing: { x: 0, y: 0, z: 1 },
  };
  const to = {
    position: { x: -11.2, y: 14, z: 207.2 },
    facing: { x: -1, y: 0, z: 0 },
  };
  const paths = facingAwareSocketRouteCandidates(from, to, {
    sourceApproachMeters: [5.6],
    destinationApproachMeters: [5.6],
    minimumApproachMeters: 5.6,
  });
  assert.equal(paths.length, 1);

  const wallPanel = {
    id: 'node:blueprint-structural-shell-east-panel-0-clearance',
    center: { x: -19.6, y: 18.2, z: 208.6 },
    size: { x: 5.6, y: 8.4, z: 0.22 },
    purpose: 'supplement-connector-module-structural-shell-wall-clearance',
  };
  const overlaps = (first, second) => ['x', 'y', 'z'].every((axis) => (
    Math.abs(Number(first.center[axis]) - Number(second.center[axis]))
      < (Number(first.size[axis]) + Number(second.size[axis])) * 0.5 - 1e-6
  ));
  const planningVolumes = routeSegmentPlanningCollisionVolumes(
    paths[0],
    from,
    to,
    5.6,
    5.6,
  );
  const segment = createSegment({
    id: 'segment',
    operationId: 'operation',
    parentRegionId: 'region',
    physicalOrdinal: 0,
    from,
    to,
    connectorFamily: 'service-gallery',
    themeBinding: {},
    coordinateSpace: 'world',
    path: paths[0],
    heightMeters: 5.6,
    landingDepthMeters: 5.6,
  });
  const finalCollisionVolumes = [
    ...segment.occupiedVolumes,
    ...segment.landingVolumes,
  ];
  const shape = ({ center, size }) => ({ center, size });
  assert.deepEqual(planningVolumes.map(shape), finalCollisionVolumes.map(shape));
  assert.ok(segment.occupiedVolumes.some((volume) => overlaps(volume, wallPanel)));

  const nodeSeam = {
    overlapEnvelope: {
      id: 'node:right:seam',
      center: { x: -26.6, y: 16.8, z: 207.2 },
      size: { x: 8.4, y: 5.6, z: 14 },
    },
  };
  const endpointNode = {
    occupiedVolumes: [],
    clearanceVolumes: [wallPanel],
  };
  assert.equal(
    routePlanningVolumesRespectEndpointNodeMask(planningVolumes, endpointNode, nodeSeam),
    false,
  );
});

test('planning reserves the outer floor-cell quadrant of a widened connector bend', () => {
  const path = [
    { x: -8.4, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 8.4 },
  ];
  const volumes = routePathFinalOccupiedSpans(path, {
    widthMeters: 8.4,
    heightMeters: 5.6,
  });
  const outerTurnFloorCell = {
    center: { x: 2.8, y: 1.4, z: -2.8 },
    size: { x: 2.8, y: 2.8, z: 2.8 },
  };

  assert.equal(volumes.length, 3);
  assert.deepEqual(volumes[2], {
    center: { x: 0, y: 2.8, z: 0 },
    size: { x: 8.4, y: 5.6, z: 8.4 },
    purpose: 'supplement-connector-turn-landing',
  });
  assert.ok(
    planningRouteVolumesCollisionScore([outerTurnFloorCell], volumes) > 0,
    'the runtime 3x3 turn landing must be reserved before a sibling route is accepted',
  );
});

test('landmark prospective segment scoring rejects a landing-only conflict before commit', () => {
  const from = {
    id: 'fixture-landmark-from-socket',
    nodeId: 'fixture-landmark-from-node',
    position: { x: 0, y: 0, z: 0 },
    facing: { x: -1, y: 0, z: 0 },
  };
  const to = {
    id: 'fixture-landmark-to-socket',
    nodeId: 'fixture-landmark-to-node',
    position: { x: 16.8, y: 0, z: 0 },
    facing: { x: 1, y: 0, z: 0 },
  };
  const path = [from.position, to.position];
  const landingOnlyObstacle = {
    id: 'fixture-landing-only-obstacle',
    center: { x: -2.1, y: 1.4, z: 0 },
    size: { x: 1.2, y: 2.8, z: 1.2 },
  };
  const bodyOnlyVolumes = routePathFinalOccupiedSpans(path, {
    widthMeters: 8.4,
    heightMeters: 5.6,
  });
  const prospectiveVolumes = landmarkPairPreselectorRouteCollisionVolumes(
    path,
    from,
    to,
    {
      operationId: 'fixture-operation',
      fromIndex: 1,
      toIndex: 2,
      pathOrdinal: 3,
    },
  );
  const prospectiveOwnerId = [
    'fixture-operation',
    'landmark-pair-preselector',
    1,
    from.id,
    2,
    to.id,
    3,
  ].join(':');

  assert.equal(
    planningRouteVolumesCollisionScore(bodyOnlyVolumes, [landingOnlyObstacle]),
    0,
  );
  assert.ok(
    planningRouteVolumesCollisionScore(prospectiveVolumes, [landingOnlyObstacle]) > 0,
  );
  assert.deepEqual(
    prospectiveVolumes.map(({ id }) => id),
    [
      `${prospectiveOwnerId}:occupied:0`,
      `${prospectiveOwnerId}:from-landing-volume`,
      `${prospectiveOwnerId}:to-landing-volume`,
    ],
  );
  assert.equal(prospectiveVolumes.every(({ ownerId }) => ownerId === prospectiveOwnerId), true);
});

function routeShapeFixture(translation = { x: 0, y: 0, z: 0 }) {
  const translatedPoint = (point) => ({
    x: point.x + translation.x,
    y: point.y + translation.y,
    z: point.z + translation.z,
  });
  const candidate = ({
    index,
    grammarId,
    center,
    facing,
    socketLocalId,
    socketOffset,
  }) => {
    const translatedCenter = translatedPoint(center);
    const socket = {
      id: `${grammarId}:${socketLocalId}`,
      localSocketId: socketLocalId,
      state: 'capped',
      position: translatedPoint({
        x: center.x + socketOffset.x,
        y: center.y + socketOffset.y,
        z: center.z + socketOffset.z,
      }),
      facing: { ...facing },
    };
    return {
      index,
      center: translatedCenter,
      facing: { ...facing },
      parentLocalSocketId: 'entry',
      node: {
        grammarId,
        grammarRevision: 4,
        blueprintId: `${grammarId}:blueprint`,
        placement: {
          center: translatedCenter,
          facing: { ...facing },
          rotationQuarterTurns: facing.x > 0 ? 0 : 2,
        },
        connectorOwned: true,
        exactParentEndpoint: false,
        sockets: [socket],
        occupiedVolumes: [{
          center: translatedCenter,
          size: { x: 8.4, y: 5.6, z: 11.2 },
        }],
      },
      availableSockets: [socket],
    };
  };
  const first = candidate({
    index: 1,
    grammarId: 'route-room-a',
    center: { x: 5.6, y: 0, z: 8.4 },
    facing: { x: 1, y: 0, z: 0 },
    socketLocalId: 'exit',
    socketOffset: { x: 5.6, y: 0, z: 0 },
  });
  const second = candidate({
    index: 2,
    grammarId: 'route-room-b',
    center: { x: 28, y: 0, z: 19.6 },
    facing: { x: -1, y: 0, z: 0 },
    socketLocalId: 'entry',
    socketOffset: { x: -5.6, y: 0, z: 0 },
  });
  const firstNodeSignature = routeShapeNodeGeometrySignature({
    candidate: first,
    nodeIndex: first.index,
    adjacentNodeIndex: second.index,
    availableSockets: first.availableSockets,
  });
  const secondNodeSignature = routeShapeNodeGeometrySignature({
    candidate: second,
    nodeIndex: second.index,
    adjacentNodeIndex: first.index,
    availableSockets: second.availableSockets,
  });
  const contextSignature = 'objective-route-coverage:fork-merge:33.6';
  const matchingExternalPaths = [{
    fromLocalSocketId: 'exit',
    toLocalSocketId: 'entry',
    path: [
      first.availableSockets[0].position,
      translatedPoint({ x: 16.8, y: 0, z: 19.6 }),
      second.availableSockets[0].position,
    ],
  }];
  return {
    first,
    second,
    contextSignature,
    firstNodeSignature,
    secondNodeSignature,
    matchingExternalPaths,
    key: translationInvariantRouteShapeCacheKey({
      contextSignature,
      firstNodeSignature,
      secondNodeSignature,
      firstCenter: first.center,
      secondCenter: second.center,
      matchingExternalPaths,
    }),
  };
}

test('route-shape cache key is invariant only to a common world translation', () => {
  const base = routeShapeFixture();
  const shifted = routeShapeFixture({ x: 173.6, y: 28, z: -95.2 });
  assert.equal(shifted.key, base.key);

  const movedSecondKey = translationInvariantRouteShapeCacheKey({
    contextSignature: base.contextSignature,
    firstNodeSignature: base.firstNodeSignature,
    secondNodeSignature: base.secondNodeSignature,
    firstCenter: base.first.center,
    secondCenter: { ...base.second.center, x: base.second.center.x + 2.8 },
    matchingExternalPaths: base.matchingExternalPaths,
  });
  assert.notEqual(movedSecondKey, base.key);

  const changedSocketFacing = routeShapeFixture();
  changedSocketFacing.second.availableSockets[0].facing = { x: 0, y: 0, z: -1 };
  const changedSocketSignature = routeShapeNodeGeometrySignature({
    candidate: changedSocketFacing.second,
    nodeIndex: 2,
    adjacentNodeIndex: 1,
    availableSockets: changedSocketFacing.second.availableSockets,
  });
  const baseSecondSignature = routeShapeNodeGeometrySignature({
    candidate: base.second,
    nodeIndex: 2,
    adjacentNodeIndex: 1,
    availableSockets: base.second.availableSockets,
  });
  assert.notEqual(changedSocketSignature, baseSecondSignature);

  const changedGrammar = routeShapeFixture();
  changedGrammar.second.node.grammarRevision += 1;
  assert.notEqual(routeShapeNodeGeometrySignature({
    candidate: changedGrammar.second,
    nodeIndex: 2,
    adjacentNodeIndex: 1,
    availableSockets: changedGrammar.second.availableSockets,
  }), baseSecondSignature);

  const changedRotation = routeShapeFixture();
  changedRotation.second.node.placement.rotationQuarterTurns = 1;
  assert.notEqual(routeShapeNodeGeometrySignature({
    candidate: changedRotation.second,
    nodeIndex: 2,
    adjacentNodeIndex: 1,
    availableSockets: changedRotation.second.availableSockets,
  }), baseSecondSignature);

  const changedMask = routeShapeFixture();
  changedMask.second.node.occupiedVolumes[0].size.z += 2.8;
  assert.notEqual(routeShapeNodeGeometrySignature({
    candidate: changedMask.second,
    nodeIndex: 2,
    adjacentNodeIndex: 1,
    availableSockets: changedMask.second.availableSockets,
  }), baseSecondSignature);
});

test('translation-invariant route-shape cache hits reuse booleans only', () => {
  const cache = new Map();
  const baseKey = routeShapeFixture().key;
  const shiftedKey = routeShapeFixture({ x: -224, y: 14, z: 117.6 }).key;
  let evaluations = 0;
  const firstValue = cachedTranslationInvariantRouteShapeBoolean(
    cache,
    baseKey,
    () => {
      evaluations += 1;
      return { routable: true };
    },
  );
  const shiftedValue = cachedTranslationInvariantRouteShapeBoolean(
    cache,
    shiftedKey,
    () => {
      evaluations += 1;
      return false;
    },
  );

  assert.equal(firstValue, true);
  assert.equal(shiftedValue, true);
  assert.equal(evaluations, 1);
  assert.equal(cache.size, 1);
  assert.deepEqual([...cache.values()], [true]);

  const falseCache = new Map();
  let falseEvaluations = 0;
  assert.equal(cachedTranslationInvariantRouteShapeBoolean(
    falseCache,
    baseKey,
    () => {
      falseEvaluations += 1;
      return false;
    },
  ), false);
  assert.equal(cachedTranslationInvariantRouteShapeBoolean(
    falseCache,
    shiftedKey,
    () => {
      falseEvaluations += 1;
      return true;
    },
  ), false);
  assert.equal(falseEvaluations, 1);
});

test('repeated correlated cheap pairs reuse boolean stages while replaying diagnostics', () => {
  const cache = new Map();
  let evaluations = 0;
  const evaluate = () => {
    evaluations += 1;
    return {
      nodeCollisionPass: true,
      parentAttachmentPass: true,
      compoundShapePass: false,
      adjacentShapePass: true,
      candidate: { id: 'must-not-escape' },
      path: [{ x: 0, y: 0, z: 0 }],
    };
  };
  const diagnostics = {
    evaluatedCount: 0,
    nodeCollisionPassCount: 0,
    parentAttachmentPassCount: 0,
    compoundShapePassCount: 0,
    adjacentShapePassCount: 0,
  };
  const replay = (outcome) => {
    diagnostics.evaluatedCount += 1;
    if (outcome.nodeCollisionPass) diagnostics.nodeCollisionPassCount += 1;
    if (outcome.parentAttachmentPass) diagnostics.parentAttachmentPassCount += 1;
    if (outcome.compoundShapePass) diagnostics.compoundShapePassCount += 1;
    if (outcome.adjacentShapePass) diagnostics.adjacentShapePassCount += 1;
  };

  const first = cachedCorrelatedCheapPairStageOutcome(cache, '0:a>1:b', evaluate);
  replay(first);
  const repeated = cachedCorrelatedCheapPairStageOutcome(cache, '0:a>1:b', () => {
    throw new Error('a repeated physical pair must hit the stage cache');
  });
  replay(repeated);

  assert.equal(repeated, first);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(first, {
    nodeCollisionPass: true,
    parentAttachmentPass: true,
    compoundShapePass: false,
    adjacentShapePass: false,
    accepted: false,
  });
  assert.deepEqual(Object.keys(first).sort(), [
    'accepted',
    'adjacentShapePass',
    'compoundShapePass',
    'nodeCollisionPass',
    'parentAttachmentPass',
  ]);
  assert.deepEqual(diagnostics, {
    evaluatedCount: 2,
    nodeCollisionPassCount: 2,
    parentAttachmentPassCount: 2,
    compoundShapePassCount: 0,
    adjacentShapePassCount: 0,
  });
  assert.equal(evaluations, 1);
  assert.equal(cache.size, 1);
});

test('correlated edge-order memo preserves reservation order and budget evidence', () => {
  const root = { id: 'root' };
  const firstCandidates = [{ id: 'first-a' }, { id: 'first-b' }];
  const secondCandidates = [{ id: 'second-a' }, { id: 'second-b' }];
  const candidateGroups = [
    { index: 0, candidates: [root], candidatePool: [root] },
    { index: 1, candidates: firstCandidates, candidatePool: firstCandidates },
    { index: 2, candidates: secondCandidates, candidatePool: secondCandidates },
  ];
  const orderedEdges = [
    { fromIndex: 0, toIndex: 1 },
    { fromIndex: 0, toIndex: 2 },
  ];
  const runReservation = ({ memoized }) => {
    let prefilterEvaluations = 0;
    const cacheByPool = new WeakMap();
    const prefilterEdgeCandidates = (
      candidates,
      fromCandidate,
      fromIndex,
      toIndex,
      edgeOrdinal,
    ) => {
      const evaluate = () => {
        prefilterEvaluations += 1;
        return [...candidates].reverse();
      };
      if (!memoized) return evaluate();
      let cache = cacheByPool.get(candidates);
      if (!cache) {
        cache = new Map();
        cacheByPool.set(candidates, cache);
      }
      return cachedCorrelatedEdgeCandidateOrder(
        cache,
        `${edgeOrdinal}:${fromIndex}>${toIndex}:${fromCandidate.id}`,
        evaluate,
      );
    };
    const result = reserveOrderedCandidateTree({
      candidateGroups,
      orderedEdges,
      candidateKey: (candidate) => candidate.id,
      prefilterEdgeCandidates,
      pairPassesCheapBounds: () => true,
      pairClearsAssignedCandidates: () => true,
      prefixIsCompatible: () => true,
      pairIsCompatible: () => true,
      pairCompatibilityIsKnown: () => true,
      maxPairEvaluations: 16,
      maxCheapPairEvaluations: 128,
      candidateWindowSize: 8,
      maximumLayerCandidates: 8,
    });
    return { result, prefilterEvaluations };
  };

  const uncached = runReservation({ memoized: false });
  const memoized = runReservation({ memoized: true });
  const evidence = ({ result }) => ({
    status: result.status,
    pairEvaluations: result.pairEvaluations,
    exactPairEvaluations: result.exactPairEvaluations,
    cheapPairEvaluations: result.cheapPairEvaluations,
    cheapPairCount: result.cheapPairCount,
    prunedCandidateCount: result.prunedCandidateCount,
    layerDiagnostics: result.layerDiagnostics,
    reservedIds: [...result.reservedByIndex].map(([index, candidate]) => (
      [index, candidate.id]
    )),
  });

  assert.deepEqual(evidence(memoized), evidence(uncached));
  assert.equal(uncached.prefilterEvaluations, 3);
  assert.equal(memoized.prefilterEvaluations, 2);

  const directCache = new Map();
  const candidates = [{ id: 'a' }, { id: 'b' }];
  const frozenOrder = cachedCorrelatedEdgeCandidateOrder(
    directCache,
    'edge:0',
    () => candidates,
  );
  candidates.reverse();
  assert.equal(Object.isFrozen(frozenOrder), true);
  assert.deepEqual(frozenOrder.map(({ id }) => id), ['a', 'b']);
});

test('suffix sampling applies endpoint-forward filtering before its fixed window', () => {
  const candidatePool = Array.from({ length: 192 }, (_, ordinal) => ({ ordinal }));
  const options = {
    limit: 64,
    headCount: 4,
    tailCount: 24,
    phase: 17,
  };
  const rawSample = sampleBoundedCorrelatedSuffixCandidates(candidatePool, options);
  const jointSuffixWitness = candidatePool.find((candidate) => (
    !rawSample.includes(candidate)
  ));
  assert.ok(jointSuffixWitness);

  const endpointForwardSample = sampleBoundedCorrelatedSuffixCandidates(
    candidatePool,
    {
      ...options,
      prefilterCandidates: (candidates) => candidates.filter((candidate) => (
        candidate === jointSuffixWitness
      )),
    },
  );

  assert.equal(rawSample.length, 64);
  assert.equal(endpointForwardSample.length, 1);
  assert.equal(endpointForwardSample[0], jointSuffixWitness);
});

test('ordered candidate-pair scalar cache keys exact identities, indices, and context', () => {
  const cache = new WeakMap();
  const first = { id: 'first' };
  const second = { id: 'second' };
  let evaluations = 0;
  const evaluate = (value) => () => {
    evaluations += 1;
    return value;
  };

  assert.equal(cachedOrderedCandidatePairScalar(
    cache,
    'context-a',
    first,
    2,
    second,
    5,
    evaluate(17),
  ), 17);
  assert.equal(cachedOrderedCandidatePairScalar(
    cache,
    'context-a',
    second,
    5,
    first,
    2,
    () => {
      throw new Error('the reversed ordered pair must hit the scalar cache');
    },
  ), 17);
  assert.equal(evaluations, 1);

  assert.equal(cachedOrderedCandidatePairScalar(
    cache,
    'context-a',
    first,
    3,
    second,
    5,
    evaluate(23),
  ), 23);
  assert.equal(cachedOrderedCandidatePairScalar(
    cache,
    'context-b',
    first,
    2,
    second,
    5,
    evaluate(29),
  ), 29);
  assert.equal(evaluations, 3);

  assert.throws(() => cachedOrderedCandidatePairScalar(
    new WeakMap(),
    'context-a',
    first,
    2,
    second,
    5,
    () => ({ path: [] }),
  ), /scalar values only/);
});

const slopeReservationFixture = Object.freeze({
  path: Object.freeze([
    Object.freeze({ x: 0, y: 0, z: 0 }),
    Object.freeze({ x: 56, y: 0, z: 0 }),
    Object.freeze({ x: 56, y: 14, z: 0 }),
  ]),
  from: Object.freeze({
    id: 'slope-source',
    nodeId: 'slope-source-node',
    position: Object.freeze({ x: 0, y: 0, z: 0 }),
  }),
  to: Object.freeze({
    id: 'slope-destination',
    nodeId: 'slope-destination-node',
    position: Object.freeze({ x: 56, y: 14, z: 0 }),
  }),
});

function slopeSideObstacle(sideSign, id) {
  return {
    id,
    center: { x: 22.4, y: 7, z: sideSign * 19.6 },
    size: { x: 2.8, y: 28, z: 2.8 },
    purpose: 'fixture-switchback-side-blocker',
  };
}

test('slope planning rejects a candidate when both complete switchback footprints are blocked', () => {
  const reservation = routeNetworkSlopeSwitchbackPlanningReservation(
    slopeReservationFixture.path,
    slopeReservationFixture.from,
    slopeReservationFixture.to,
    [slopeSideObstacle(1, 'positive-blocker'), slopeSideObstacle(-1, 'negative-blocker')],
    [],
    'both-sides-blocked',
  );

  assert.equal(reservation, null);
});

test('slope planning deterministically realizes the sole clear switchback side', () => {
  const args = [
    slopeReservationFixture.path,
    slopeReservationFixture.from,
    slopeReservationFixture.to,
    [slopeSideObstacle(1, 'positive-blocker')],
    [],
    'one-side-clear',
  ];
  const first = routeNetworkSlopeSwitchbackPlanningReservation(...args);
  const second = routeNetworkSlopeSwitchbackPlanningReservation(...args);

  assert.equal(first?.switchbackSideSign, -1);
  assert.deepEqual(second, first);
  assert.ok(first.collisionVolumes.some((volume) => (
    volume.center.z < -8.4
      && volume.purpose.includes('switchback-slope')
  )));
});

test('lift planning rejects only the path whose exact exterior run is consumed by rooms', () => {
  const from = {
    id: 'from-lift-socket',
    nodeId: 'from-room',
    position: { x: -103.6, y: -14, z: 282.8 },
  };
  const to = {
    id: 'to-lift-socket',
    nodeId: 'to-room',
    position: { x: -79.8, y: 0, z: 291.2 },
  };
  const roomFootprints = [
    { roomId: 'from-room', minX: -40, maxX: -36, minZ: 99, maxZ: 103 },
    { roomId: 'to-room', minX: -31, maxX: -25, minZ: 101, maxZ: 107 },
  ];
  const rejectedPath = [
    { x: -103.6, y: -14, z: 282.8 },
    { x: -120.4, y: -14, z: 282.8 },
    { x: -120.4, y: -14, z: 291.2 },
    { x: -112, y: -14, z: 291.2 },
    { x: -112, y: 0, z: 291.2 },
    { x: -79.8, y: 0, z: 291.2 },
  ];
  const alternatePath = [
    { x: -103.6, y: -14, z: 282.8 },
    { x: -131.6, y: -14, z: 282.8 },
    { x: -131.6, y: -14, z: 291.2 },
    { x: -131.6, y: 0, z: 291.2 },
    { x: -79.8, y: 0, z: 291.2 },
  ];

  assert.equal(routeNetworkLiftPlanningContract(
    rejectedPath,
    from,
    to,
    roomFootprints,
    'seed-001-rejected-lift-path',
  ), null);
  const alternateContract = routeNetworkLiftPlanningContract(
    alternatePath,
    from,
    to,
    roomFootprints,
    'seed-001-alternate-lift-path',
  );
  assert.equal(alternateContract?.traversalKind, 'automatic_lift');
  assert.ok(alternateContract.pathContract.selectedStraightRun.lengthTiles >= 10);
});

test('lift planning room footprints match substantive materialization and omit connectors', () => {
  const substantive = {
    id: 'substantive-room',
    kind: 'supplementRoom',
    placement: {
      center: { x: -67.2, y: -14, z: 341.6 },
      rotationQuarterTurns: 1,
    },
    size: { x: 14, y: 8.4, z: 19.6 },
  };
  assert.deepEqual(routeNetworkConnectorRoomFootprint(substantive), {
    roomId: 'substantive-room',
    minX: -27,
    maxX: -21,
    minZ: 120,
    maxZ: 124,
  });
  assert.equal(routeNetworkConnectorRoomFootprint({
    ...substantive,
    id: 'connector-module',
    kind: 'supplementConnectorModule',
    connectorOwned: true,
  }), null);
});
