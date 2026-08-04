import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  classifyRouteNetworkExhaustivePhysicalEdgeConflict,
  classifyRouteNetworkStructuralSpanOnlyFailure,
  classifyRouteNetworkFutureEndpointSingleSegmentConflict,
  collectCompleteRouteNetworkFutureEndpointSurvivorVector,
  consumeRouteNetworkCandidateEvaluationBudget,
  createValidatedRouteNetworkProvisionalConflictRoots,
  deriveRouteNetworkIsolatedRootDependencyNodeIndices,
  createRouteNetworkCompleteSalvageWitnessCacheKey,
  createRouteNetworkCompleteSalvageWitnessPhysicalSignature,
  createRouteNetworkCompletedPlanCacheKey,
  createRouteNetworkPartialFirstCandidateSchedule,
  createRouteNetworkPlanningCacheContextSignatures,
  ensureRouteNetworkTerminalSalvageCheckpoint,
  evaluateRouteNetworkPartialPreRecoveryAcceptance,
  invalidateRouteNetworkCorrelatedDomainCaches,
  isRouteNetworkConflictExclusionReusablePhysicalBan,
  routeNetworkPartialBranchRetentionUpperBound,
  routeNetworkCandidateContinuationMayReturnPartial,
  routeNetworkFutureSegmentCutOutranksNodeAlternatives,
  routeNetworkSolutionRetainsAllRequiredGrants,
  restoreRouteNetworkArcConsistencyEpochDomains,
  mergeRouteNetworkCompleteSalvageWitnessCollection,
  selectDeferredRouteNetworkCoverageSuffixIndex,
  selectRouteNetworkClosestRejectedPairRecords,
  selectPreferredParentAnchoredRouteNetworkSalvageProposal,
  selectRouteNetworkStructuralSpanSocketPair,
  selectRouteNetworkStructuralSpanSocketPairAssignment,
  stageRouteNetworkCandidateConflictExclusions,
  validateRouteNetworkIsolatedDependencySalvage,
  validateRouteNetworkConflictSalvageProposal,
  validateDeferredProvisionalRouteNetworkSalvage,
  validateRouteNetworkFutureCutCapDerivation,
} from '../src/dungeon-augmentation/planner.js';
import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';
import {
  routeNetworkInactiveSocketCapPlanningVolumes,
} from '../src/dungeon-augmentation/routeNetworkCapPlanning.js';
import {
  createParentAnchoredRouteNetworkSalvage,
  createRouteNetworkConflictEntitySignature,
  normalizeRouteNetworkEntityOmissions,
  normalizeRouteNetworkConflictExclusions,
} from '../src/dungeon-augmentation/routeNetworkModulePruning.js';

const REQUIRED_ORDINALS = new Set([0, 1, 2, 3, 4, 5]);
const COVERAGE_ORDINALS = new Set([1, 2, 3, 4, 5]);
const LANDMARK_ORDINALS = new Set([0]);

function createCandidateLocalProvisionalSalvageFixture() {
  const grantId = 'grant:fixture';
  const operationId = 'operation:fixture';
  const selectionBags = Object.freeze({
    topology: Object.freeze({ cursor: 3 }),
    grammar: Object.freeze({ cursor: 7 }),
  });
  let randomCallCount = 0;
  const random = () => {
    randomCallCount += 1;
    return 0.5;
  };
  const rootNode = {
    id: 'node:root',
    operationId,
    ordinal: 0,
    kind: 'supplementRoom',
    grammarId: 'grammar:root',
    contentRole: 'challenge',
    placement: { center: { x: 0, y: 0, z: 0 }, rotationQuarterTurns: 0 },
    size: { x: 8.4, y: 5.6, z: 8.4 },
    sockets: [{
      id: 'node:root:socket:parent',
      localSocketId: 'parent',
      position: { x: -4.2, y: 0, z: 0 },
      facing: { x: -1, y: 0, z: 0 },
      state: 'connected',
      segmentId: 'segment:parent',
    }, {
      id: 'node:root:socket:conflict',
      localSocketId: 'conflict',
      position: { x: 4.2, y: 0, z: 0 },
      facing: { x: 1, y: 0, z: 0 },
      state: 'connected',
      segmentId: 'segment:conflict',
    }],
  };
  const isolatedNode = {
    id: 'node:isolated',
    operationId,
    ordinal: 1,
    kind: 'supplementRoom',
    grammarId: 'grammar:isolated',
    contentRole: 'challenge',
    planningOnly: true,
    provisionalUnanchoredDependency: true,
    placement: { center: { x: 11.2, y: 0, z: 0 }, rotationQuarterTurns: 0 },
    size: { x: 8.4, y: 5.6, z: 8.4 },
    sockets: [{
      id: 'node:isolated:socket:conflict',
      localSocketId: 'conflict',
      position: { x: 7, y: 0, z: 0 },
      facing: { x: -1, y: 0, z: 0 },
      state: 'connected',
      segmentId: 'segment:conflict',
    }],
  };
  const parentSegment = {
    id: 'segment:parent',
    operationId,
    physicalOrdinal: 0,
    kind: 'route-network-segment',
    routeRole: 'route-network-spine',
    connectorFamily: 'service-gallery',
    from: {
      kind: 'parentSocket',
      nodeId: 'authored:fixture',
      socketId: 'socket:parent',
      position: { x: -11.2, y: 0, z: 0 },
      facing: { x: 1, y: 0, z: 0 },
    },
    to: {
      kind: 'supplementSocket',
      nodeId: rootNode.id,
      socketId: rootNode.sockets[0].id,
      position: { ...rootNode.sockets[0].position },
      facing: { ...rootNode.sockets[0].facing },
    },
    path: [{ x: -11.2, y: 0, z: 0 }, { x: -4.2, y: 0, z: 0 }],
    bidirectional: true,
    returnRouteGuaranteed: true,
  };
  const conflictSegment = {
    id: 'segment:conflict',
    operationId,
    physicalOrdinal: 1,
    kind: 'route-network-segment',
    routeRole: 'route-network-spine',
    connectorFamily: 'service-gallery',
    from: {
      kind: 'supplementSocket',
      nodeId: rootNode.id,
      socketId: rootNode.sockets[1].id,
      position: { ...rootNode.sockets[1].position },
      facing: { ...rootNode.sockets[1].facing },
    },
    to: {
      kind: 'supplementSocket',
      nodeId: isolatedNode.id,
      socketId: isolatedNode.sockets[0].id,
      position: { ...isolatedNode.sockets[0].position },
      facing: { ...isolatedNode.sockets[0].facing },
    },
    path: [{ x: 4.2, y: 0, z: 0 }, { x: 7, y: 0, z: 0 }],
    bidirectional: true,
    returnRouteGuaranteed: true,
    planningOnly: true,
    provisionalUnanchoredDependency: true,
    connectorVariant: 'structural-span-conflict-root-v1',
  };
  const planned = {
    operation: {
      id: operationId,
      type: 'routeNetwork',
      grantId,
      routeNetworkKind: 'objective-route-coverage',
      endpointSocketIds: ['socket:parent'],
      nodeIds: [rootNode.id, isolatedNode.id],
      roomNodeIds: [rootNode.id, isolatedNode.id],
      connectorModuleNodeIds: [],
      connectorJunctionNodeIds: [],
      connectorInfrastructureNodeIds: [],
      moduleCount: 2,
      substantiveModuleCount: 2,
      physicalNodeCount: 2,
      roomCount: 2,
      connectorModuleCount: 0,
      connectorJunctionCount: 0,
      connectorInfrastructureCount: 0,
      segmentIds: [parentSegment.id, conflictSegment.id],
      contentRoles: ['challenge', 'challenge'],
      junctionKinds: [],
      featurelessSpans: [],
      cycleRankDelta: 0,
      bidirectional: true,
      returnRouteGuaranteed: true,
    },
    nodes: [rootNode, isolatedNode],
    segments: [parentSegment, conflictSegment],
    normalizedSemanticSignature: 'fixture:semantic-signature',
    selectionBags,
    random,
    provisionalWitnessOnly: true,
  };
  const exactFailureRoot = {
    grantId,
    entityKind: 'segment',
    entityId: conflictSegment.id,
    signature: createRouteNetworkConflictEntitySignature(
      conflictSegment,
      'segment',
    ),
    reason: 'fixture-exact-segment-conflict',
  };
  const isolatedRootDependencyWitness = {
    sourceNodeIds: planned.nodes.map(({ id }) => id),
    sourceSegmentIds: planned.segments.map(({ id }) => id),
    dependencies: [{
      nodeId: isolatedNode.id,
      incidentRootSignatures: [exactFailureRoot.signature],
    }],
  };
  return {
    grantId,
    planned,
    selectionBags,
    exactFailureRoot,
    isolatedRootDependencyWitness,
    randomCallCount: () => randomCallCount,
    completePlanned: {
      error: 'route-network-required-edge-unbuildable',
      context: { grantId },
      provisionalParentAnchoredSalvageWitness: {
        planned,
        exactFailureRoots: [exactFailureRoot],
        isolatedRootDependencyWitness,
        sourceFailure: 'route-network-required-edge-unbuildable',
      },
    },
  };
}

function validateDeferredProvisionalSalvageFixture(
  fixture,
  { candidateIndex = 4, candidateOrdinal = 73 } = {},
) {
  return validateDeferredProvisionalRouteNetworkSalvage({
    completePlanned: fixture.completePlanned,
    candidateIndex,
    candidateOrdinal,
    grantId: fixture.grantId,
  });
}

test('complete required retention is terminal without an optional network', () => {
  const requiredOrdinals = new Set([0, 1]);
  assert.equal(routeNetworkSolutionRetainsAllRequiredGrants({
    operations: [{ id: 'landmark' }, { id: 'coverage' }],
    acceptedGrantOrdinals: [0, 1],
    acceptedNetworkCount: 2,
  }, requiredOrdinals), true);
  assert.equal(routeNetworkSolutionRetainsAllRequiredGrants({
    operations: [{ id: 'landmark' }, { id: 'optional' }],
    acceptedGrantOrdinals: [0, 2],
    acceptedNetworkCount: 2,
  }, requiredOrdinals), false, 'an optional grant cannot compensate for missing required coverage');
  assert.equal(routeNetworkSolutionRetainsAllRequiredGrants({
    operations: [{ id: 'optional' }],
    acceptedGrantOrdinals: [2],
    acceptedNetworkCount: 1,
  }, []), false, 'optional-only profiles retain their existing maximization path');
});

test('partial branch upper bounds exclude every explicitly pruned grant', () => {
  assert.deepEqual(routeNetworkPartialBranchRetentionUpperBound({
    acceptedGrantOrdinals: [0, 1],
    remainingOperationOrdinals: [1, 2, 3, 4, 5],
    explicitlyPrunedOperationOrdinals: [1, 4],
    requiredOperationOrdinals: REQUIRED_ORDINALS,
    requiredCoverageOperationOrdinals: COVERAGE_ORDINALS,
  }), {
    maximumRequiredNetworkCount: 4,
    maximumCoverageNetworkCount: 3,
    retainableRequiredOperationOrdinals: [0, 2, 3, 5],
    retainableCoverageOperationOrdinals: [2, 3, 5],
  });
});

test('partial-first acceptance requires the two-network landmark and coverage floor', () => {
  const retentionUpperBound = routeNetworkPartialBranchRetentionUpperBound({
    acceptedGrantOrdinals: [0],
    remainingOperationOrdinals: [1, 2, 3, 4, 5],
    requiredOperationOrdinals: REQUIRED_ORDINALS,
    requiredCoverageOperationOrdinals: COVERAGE_ORDINALS,
  });
  const landmarkOnly = evaluateRouteNetworkPartialPreRecoveryAcceptance({
    operations: [{ id: 'landmark' }],
    acceptedGrantOrdinals: [0],
    acceptedNetworkCount: 1,
    prunedRouteNetworkGrants: [{ operationOrdinal: 1 }],
  }, {
    requiredOperationOrdinals: REQUIRED_ORDINALS,
    requiredCoverageOperationOrdinals: COVERAGE_ORDINALS,
    requiredLandmarkOperationOrdinals: LANDMARK_ORDINALS,
    preferredRequiredNetworkCount: 2,
    requireCoverage: true,
    requireLandmark: true,
    retentionUpperBound,
  });
  assert.deepEqual({
    accepted: landmarkOnly.accepted,
    requiredNetworkTarget: landmarkOnly.requiredNetworkTarget,
    coverageNetworkTarget: landmarkOnly.coverageNetworkTarget,
  }, {
    accepted: false,
    requiredNetworkTarget: 2,
    coverageNetworkTarget: 1,
  });

  const usefulPartial = evaluateRouteNetworkPartialPreRecoveryAcceptance({
    operations: [{ id: 'landmark' }, { id: 'coverage' }],
    acceptedGrantOrdinals: [0, 4],
    acceptedNetworkCount: 2,
    prunedRouteNetworkGrants: [{ operationOrdinal: 1 }],
  }, {
    requiredOperationOrdinals: REQUIRED_ORDINALS,
    requiredCoverageOperationOrdinals: COVERAGE_ORDINALS,
    requiredLandmarkOperationOrdinals: LANDMARK_ORDINALS,
    preferredRequiredNetworkCount: 2,
    requireCoverage: true,
    requireLandmark: true,
    retentionUpperBound,
  });
  assert.equal(usefulPartial.accepted, true);
  assert.deepEqual(usefulPartial.retainedRequiredOperationOrdinals, [0, 4]);
  assert.deepEqual(usefulPartial.retainedCoverageOperationOrdinals, [4]);

  const coverageOnly = evaluateRouteNetworkPartialPreRecoveryAcceptance({
    operations: [{ id: 'coverage-a' }, { id: 'coverage-b' }],
    acceptedGrantOrdinals: [1, 2],
    acceptedNetworkCount: 2,
    prunedRouteNetworkGrants: [{ operationOrdinal: 0 }],
  }, {
    requiredOperationOrdinals: REQUIRED_ORDINALS,
    requiredCoverageOperationOrdinals: COVERAGE_ORDINALS,
    requiredLandmarkOperationOrdinals: LANDMARK_ORDINALS,
    preferredRequiredNetworkCount: 2,
    requireCoverage: true,
    requireLandmark: true,
    retentionUpperBound,
  });
  assert.equal(coverageOnly.accepted, false);
  assert.equal(coverageOnly.landmarkNetworkTarget, 1);
});

test('partial-first target shrinks only when the pre-prune subtree cannot reach two', () => {
  const oneNetworkFrontier = routeNetworkPartialBranchRetentionUpperBound({
    remainingOperationOrdinals: [1],
    requiredOperationOrdinals: [1],
    requiredCoverageOperationOrdinals: [1],
  });
  const evidence = evaluateRouteNetworkPartialPreRecoveryAcceptance({
    operations: [{ id: 'coverage' }],
    acceptedGrantOrdinals: [1],
    acceptedNetworkCount: 1,
    prunedRouteNetworkGrants: [{ operationOrdinal: 0 }],
  }, {
    requiredOperationOrdinals: [1],
    requiredCoverageOperationOrdinals: [1],
    preferredRequiredNetworkCount: 2,
    requireCoverage: true,
    retentionUpperBound: oneNetworkFrontier,
  });

  assert.equal(evidence.requiredNetworkTarget, 1);
  assert.equal(evidence.coverageNetworkTarget, 1);
  assert.equal(evidence.accepted, true);
});

test('industrial V4 profile declares the measured two-network useful floor', () => {
  assert.equal(
    DUNGEON_AUGMENTATION_PROFILES['industrial-supplement-preview-v4']
      .routeNetworkPlanning.partialUsefulRequiredNetworkCount,
    2,
  );
});

test('partial schedules checkpoint coverage after its complete modular replacement window', () => {
  const ordinary = [0, 1, 2, 3, 4].map((candidateIndex) => ({ candidateIndex }));
  assert.deepEqual(
    createRouteNetworkPartialFirstCandidateSchedule(ordinary, {
      allowPartialRouteNetworkRealization: true,
      routeNetworkKind: 'landmark-perimeter-loop',
      required: true,
    }).map((entry) => entry.partialFirstCheckpoint ?? `candidate:${entry.candidateIndex}`),
    [
      'candidate:0',
      'candidate:1',
      'candidate:2',
      'candidate:3',
      'candidate:4',
      'deferred-blocked-future',
    ],
  );
  assert.deepEqual(
    createRouteNetworkPartialFirstCandidateSchedule(ordinary, {
      allowPartialRouteNetworkRealization: true,
      routeNetworkKind: 'objective-route-coverage',
      required: true,
    }).map((entry) => entry.partialFirstCheckpoint ?? `candidate:${entry.candidateIndex}`),
    [
      'candidate:0',
      'candidate:1',
      'candidate:2',
      'candidate:3',
      'candidate:4',
      'prune-current-required-coverage',
    ],
  );
});

test('exact-conflict replacement windows end in a zero-evaluation salvage checkpoint', () => {
  const ordinary = [0, 1, 2].map((candidateIndex) => ({ candidateIndex }));
  assert.deepEqual(
    createRouteNetworkPartialFirstCandidateSchedule(ordinary, {
      allowPartialRouteNetworkRealization: true,
      routeNetworkKind: 'objective-route-coverage',
      required: true,
      hasConflictExclusions: true,
    }).map((entry) => entry.partialFirstCheckpoint ?? `candidate:${entry.candidateIndex}`),
    [
      'candidate:0',
      'candidate:1',
      'candidate:2',
      'terminal-exact-conflict-salvage',
    ],
  );
  assert.deepEqual(
    createRouteNetworkPartialFirstCandidateSchedule(ordinary, {
      allowPartialRouteNetworkRealization: true,
      routeNetworkKind: 'landmark-perimeter-loop',
      required: true,
      hasConflictExclusions: true,
    }).map((entry) => entry.partialFirstCheckpoint ?? `candidate:${entry.candidateIndex}`),
    [
      'candidate:0',
      'candidate:1',
      'candidate:2',
      'terminal-exact-conflict-salvage',
      'deferred-blocked-future',
    ],
  );
  assert.deepEqual(
    createRouteNetworkPartialFirstCandidateSchedule(ordinary, {
      allowPartialRouteNetworkRealization: false,
      routeNetworkKind: 'objective-route-coverage',
      required: true,
      hasConflictExclusions: true,
    }),
    ordinary,
  );
});

test('structural span salvage qualifies only a pure required objective-edge span failure', () => {
  const rejectionSummary = {
    candidatePairCount: 264,
    compatibleCount: 0,
    nodeCollisionRejectedCount: 0,
    parentAttachmentRejectedCount: 0,
    stackedCompoundRejectedCount: 0,
    minimumSpineDistanceRejectedCount: 264,
    minimumSpineDistanceRejectedMeters: 84,
    exactPhysicalRouteRejectedCount: 0,
    exactPhysicalRouteNotEvaluatedCount: 0,
  };
  const requiredEdge = {
    edgeOrdinal: 4,
    fromIndex: 3,
    toIndex: 4,
    routeRole: 'route-network-spine',
  };
  assert.deepEqual(classifyRouteNetworkStructuralSpanOnlyFailure({
    routeNetworkKind: 'objective-route-coverage',
    required: true,
    requiredEdge,
    rejectionSummary,
    minimumRequiredSpanMeters: 84,
    maximumFeaturelessSpanMeters: 33.6,
  }), {
    edgeOrdinal: 4,
    fromIndex: 3,
    toIndex: 4,
    routeRole: 'route-network-spine',
    candidatePairCount: 264,
    nodeCollisionRejectedCount: 0,
    minimumSpineDistanceRejectedCount: 264,
    exactPhysicalRouteRejectedCount: 0,
    minimumRequiredSpanMeters: 84,
    maximumFeaturelessSpanMeters: 33.6,
    rootReason: 'route-network-required-edge-span-exceeded',
  });

  assert.deepEqual(classifyRouteNetworkStructuralSpanOnlyFailure({
    routeNetworkKind: 'objective-route-coverage',
    required: true,
    requiredEdge: { ...requiredEdge, edgeOrdinal: 5, toIndex: 6 },
    rejectionSummary: {
      ...rejectionSummary,
      candidatePairCount: 704,
      nodeCollisionRejectedCount: 146,
      minimumSpineDistanceRejectedCount: 558,
      minimumSpineDistanceRejectedMeters: 36.4,
    },
    maximumFeaturelessSpanMeters: 33.6,
  }), {
    edgeOrdinal: 5,
    fromIndex: 3,
    toIndex: 6,
    routeRole: 'route-network-spine',
    candidatePairCount: 704,
    nodeCollisionRejectedCount: 146,
    minimumSpineDistanceRejectedCount: 558,
    exactPhysicalRouteRejectedCount: 0,
    minimumRequiredSpanMeters: 36.4,
    maximumFeaturelessSpanMeters: 33.6,
    rootReason: 'route-network-required-edge-span-exceeded',
  }, 'node-overlapping pairs remain forbidden while non-overlapping over-span pairs root the edge');

  assert.deepEqual(classifyRouteNetworkStructuralSpanOnlyFailure({
    routeNetworkKind: 'objective-route-coverage',
    required: true,
    requiredEdge: { ...requiredEdge, edgeOrdinal: 3, fromIndex: 4, toIndex: 5 },
    rejectionSummary: {
      ...rejectionSummary,
      candidatePairCount: 352,
      nodeCollisionRejectedCount: 200,
      minimumSpineDistanceRejectedCount: 79,
      minimumSpineDistanceRejectedMeters: 35,
      exactPhysicalRouteRejectedCount: 73,
    },
    maximumFeaturelessSpanMeters: 33.6,
  }), {
    edgeOrdinal: 3,
    fromIndex: 4,
    toIndex: 5,
    routeRole: 'route-network-spine',
    candidatePairCount: 352,
    nodeCollisionRejectedCount: 200,
    minimumSpineDistanceRejectedCount: 79,
    exactPhysicalRouteRejectedCount: 73,
    minimumRequiredSpanMeters: 35,
    maximumFeaturelessSpanMeters: 33.6,
    rootReason: 'route-network-required-edge-static-route-conflict',
  }, 'a fully evaluated static route-domain exhaustion is an exact local edge root');

  const mixedFailureCounts = [
    'compatibleCount',
    'nodeCollisionRejectedCount',
    'parentAttachmentRejectedCount',
    'stackedCompoundRejectedCount',
    'exactPhysicalRouteRejectedCount',
    'exactPhysicalRouteNotEvaluatedCount',
  ];
  for (const field of mixedFailureCounts) {
    assert.equal(classifyRouteNetworkStructuralSpanOnlyFailure({
      routeNetworkKind: 'objective-route-coverage',
      required: true,
      requiredEdge,
      rejectionSummary: { ...rejectionSummary, [field]: 1 },
      minimumRequiredSpanMeters: 84,
      maximumFeaturelessSpanMeters: 33.6,
    }), null, `${field} makes the failure mixed rather than span-only`);
  }
  for (const override of [{
    routeNetworkKind: 'landmark-perimeter-loop',
  }, {
    required: false,
  }, {
    requiredEdge: null,
  }, {
    rejectionSummary: {
      ...rejectionSummary,
      minimumSpineDistanceRejectedCount: 263,
    },
  }, {
    rejectionSummary: {
      ...rejectionSummary,
      nodeCollisionRejectedCount: 264,
      minimumSpineDistanceRejectedCount: 0,
      minimumSpineDistanceRejectedMeters: null,
    },
  }, {
    rejectionSummary: {
      ...rejectionSummary,
      minimumSpineDistanceRejectedMeters: 33.6,
    },
  }]) {
    assert.equal(classifyRouteNetworkStructuralSpanOnlyFailure({
      routeNetworkKind: 'objective-route-coverage',
      required: true,
      requiredEdge,
      rejectionSummary,
      minimumRequiredSpanMeters: 84,
      maximumFeaturelessSpanMeters: 33.6,
      ...override,
    }), null);
  }
});

test('exhaustive physical-edge conflict retains an exact static collision proof', () => {
  const bestBlockedPath = [
    { x: 0, y: 0, z: 0 },
    { x: 2.8, y: 0, z: 0 },
    { x: 5.6, y: 0, z: 0 },
  ];
  const diagnostics = {
    visits: 12,
    deadEnds: 12,
    maximumRawCandidateCount: 7,
    maximumCollisionFreeCandidateCount: 0,
    maximumWithinSpanCandidateCount: 7,
    maximumFeasibleCandidateCount: 0,
    minimumCollisionScore: 3,
    bestBlockedPath,
    bestBlockedCollisionIds: ['solid:z', 'solid:a', 'solid:z'],
  };

  const classified = classifyRouteNetworkExhaustivePhysicalEdgeConflict({
    routeNetworkKind: 'objective-route-coverage',
    required: true,
    requiredEdge: {
      edgeOrdinal: 2,
      fromIndex: 1,
      toIndex: 4,
      routeRole: 'route-network-spine',
    },
    diagnostics,
  });

  assert.deepEqual(classified, {
    edgeOrdinal: 2,
    fromIndex: 1,
    toIndex: 4,
    routeRole: 'route-network-spine',
    visits: 12,
    deadEnds: 12,
    maximumRawCandidateCount: 7,
    maximumWithinSpanCandidateCount: 7,
    minimumCollisionScore: 3,
    bestBlockedPath,
    bestBlockedCollisionIds: ['solid:a', 'solid:z'],
    rootReason: 'route-network-required-edge-static-route-conflict',
  });
  assert.notEqual(classified.bestBlockedPath, bestBlockedPath);
  assert.deepEqual(diagnostics.bestBlockedCollisionIds, ['solid:z', 'solid:a', 'solid:z']);
});

test('exhaustive physical-edge conflict rejects incomplete or non-static searches', () => {
  const base = {
    routeNetworkKind: 'objective-route-coverage',
    required: true,
    requiredEdge: {
      edgeOrdinal: 2,
      fromIndex: 1,
      toIndex: 4,
      routeRole: 'route-network-spine',
    },
    diagnostics: {
      visits: 12,
      deadEnds: 12,
      maximumRawCandidateCount: 7,
      maximumCollisionFreeCandidateCount: 0,
      maximumWithinSpanCandidateCount: 7,
      maximumFeasibleCandidateCount: 0,
      minimumCollisionScore: 3,
      bestBlockedPath: [
        { x: 0, y: 0, z: 0 },
        { x: 2.8, y: 0, z: 0 },
      ],
      bestBlockedCollisionIds: ['solid:a'],
    },
  };
  const withDiagnostics = (overrides) => ({
    ...base,
    diagnostics: { ...base.diagnostics, ...overrides },
  });
  const rejected = [
    ['budget exhaustion', { ...base, placementSearchBudgetExhausted: true }],
    ['collision-free option', withDiagnostics({ maximumCollisionFreeCandidateCount: 1 })],
    ['feasible option', withDiagnostics({ maximumFeasibleCandidateCount: 1 })],
    ['zero visits', withDiagnostics({ visits: 0, deadEnds: 0 })],
    ['incomplete dead ends', withDiagnostics({ deadEnds: 11 })],
    ['missing path', withDiagnostics({ bestBlockedPath: null })],
    ['path without an edge', withDiagnostics({
      bestBlockedPath: [{ x: 0, y: 0, z: 0 }],
    })],
    ['missing collision IDs', withDiagnostics({ bestBlockedCollisionIds: [] })],
    ['blank collision ID', withDiagnostics({
      bestBlockedCollisionIds: ['solid:a', ''],
    })],
  ];

  for (const [label, input] of rejected) {
    assert.equal(classifyRouteNetworkExhaustivePhysicalEdgeConflict(input), null, label);
  }
});

test('structural span socket selection is deterministic and does not mutate its domain', () => {
  const pair = (fromId, toId, distance) => ({
    fromSocket: {
      localSocketId: fromId,
      position: { x: 0, y: 0, z: 0 },
    },
    toSocket: {
      localSocketId: toId,
      position: { x: distance, y: 0, z: 0 },
    },
    routeOptions: [{ structuralSpanConflictRoot: true }],
  });
  const farther = pair('a', 'a', 12);
  const lexicalSecond = pair('b', 'a', 8);
  const lexicalFirst = pair('a', 'z', 8);
  const finalTieWinner = pair('a', 'b', 8);
  const socketPairs = [farther, lexicalSecond, lexicalFirst, finalTieWinner];
  const originalOrder = [...socketPairs];

  assert.equal(
    selectRouteNetworkStructuralSpanSocketPair(socketPairs),
    finalTieWinner,
  );
  assert.deepEqual(socketPairs, originalOrder);
  assert.equal(selectRouteNetworkStructuralSpanSocketPair([]), null);
});

test('multiple structural roots backtrack to an injective deterministic socket assignment', () => {
  const pair = (fromId, toId, distance) => ({
    fromSocket: {
      localSocketId: fromId,
      position: { x: 0, y: 0, z: 0 },
    },
    toSocket: {
      localSocketId: toId,
      position: { x: distance, y: 0, z: 0 },
    },
    routeOptions: [{ structuralSpanConflictRoot: true }],
  });
  const greedyDeadEnd = pair('node0:a', 'shared:x', 4);
  const viableAlternative = pair('node0:b', 'shared:y', 6);
  const forcedSharedSocket = pair('shared:x', 'node2:a', 5);
  const assignment = selectRouteNetworkStructuralSpanSocketPairAssignment([
    { edgeOrdinal: 0, fromIndex: 0, toIndex: 1 },
    { edgeOrdinal: 1, fromIndex: 1, toIndex: 2 },
  ], new Map([
    [0, [greedyDeadEnd, viableAlternative]],
    [1, [forcedSharedSocket]],
  ]), new Map([
    [0, new Set()],
    [1, new Set()],
    [2, new Set()],
  ]));

  assert.equal(assignment.get(0), viableAlternative);
  assert.equal(assignment.get(1), forcedSharedSocket);
  assert.equal(selectRouteNetworkStructuralSpanSocketPairAssignment([
    { edgeOrdinal: 0, fromIndex: 0, toIndex: 1 },
  ], new Map([[0, [greedyDeadEnd]]]), new Map([[1, new Set(['shared:x'])]])), null);

  const retainedRouteAttempts = [];
  const retainedCompatibleAssignment =
    selectRouteNetworkStructuralSpanSocketPairAssignment([
      { edgeOrdinal: 0, fromIndex: 0, toIndex: 1 },
    ], new Map([[0, [greedyDeadEnd, viableAlternative]]]), new Map(), (candidate) => {
      retainedRouteAttempts.push(candidate.get(0));
      return candidate.get(0) === viableAlternative;
    });
  assert.deepEqual(retainedRouteAttempts, [greedyDeadEnd, viableAlternative]);
  assert.equal(retainedCompatibleAssignment.get(0), viableAlternative);
});

test('reduced arc consistency restores every group from one checked epoch', () => {
  const firstEpochCandidates = [{ id: 'first:a' }, { id: 'first:b' }];
  const secondEpochCandidates = [{ id: 'second:a' }, { id: 'second:b' }];
  const groups = [{ index: 0, candidates: [] }, { index: 1, candidates: [] }];
  const epoch = new Map([
    [0, firstEpochCandidates],
    [1, secondEpochCandidates],
  ]);
  assert.equal(restoreRouteNetworkArcConsistencyEpochDomains(groups, epoch), true);
  assert.deepEqual(groups.map(({ candidates }) => candidates), [
    firstEpochCandidates,
    secondEpochCandidates,
  ]);
  assert.notEqual(groups[0].candidates, firstEpochCandidates);

  groups[0].candidates = [{ id: 'unchanged-on-corruption' }];
  assert.equal(restoreRouteNetworkArcConsistencyEpochDomains(
    groups,
    new Map([[0, firstEpochCandidates]]),
  ), false);
  assert.deepEqual(groups[0].candidates, [{ id: 'unchanged-on-corruption' }]);
});

test('correlated domain caches cannot replay stale support across shrink or restore', () => {
  const prefixCache = new Map([['prefix', true]]);
  const futureSupportCache = new Map();
  const supportKey = 'candidate:0>future:1';
  const cachedSupport = (futureCandidates) => {
    if (futureSupportCache.has(supportKey)) return futureSupportCache.get(supportKey);
    const supported = futureCandidates.some(({ viable }) => viable === true);
    futureSupportCache.set(supportKey, supported);
    return supported;
  };
  const fullDomain = [{ id: 'future:viable', viable: true }];
  const shrunkDomain = [{ id: 'future:blocked', viable: false }];

  assert.equal(cachedSupport(fullDomain), true);
  assert.equal(cachedSupport(shrunkDomain), true, 'the unpartitioned key is stale');
  assert.equal(invalidateRouteNetworkCorrelatedDomainCaches(
    prefixCache,
    futureSupportCache,
  ), 2);
  assert.equal(cachedSupport(shrunkDomain), false);
  prefixCache.set('prefix', false);
  assert.equal(cachedSupport(fullDomain), false, 'restore also needs a fresh domain result');
  assert.equal(invalidateRouteNetworkCorrelatedDomainCaches(
    prefixCache,
    futureSupportCache,
  ), 2);
  assert.equal(cachedSupport(fullDomain), true);

  const plannerSource = readFileSync(
    new URL('../src/dungeon-augmentation/planner.js', import.meta.url),
    'utf8',
  );
  const correlatedDomainBlock = plannerSource.slice(
    plannerSource.indexOf('const correlatedPrefixSocketAssignmentCache = new Map();'),
    plannerSource.indexOf('const candidateCompatibleWithSelection =', plannerSource.indexOf(
      'const correlatedPrefixSocketAssignmentCache = new Map();',
    )),
  );
  assert.equal(
    correlatedDomainBlock.match(/(?:firstGroup|secondGroup|group)\.candidates\s*=/g)?.length,
    6,
    'every correlated candidate-domain write stays inside the audited block',
  );
  assert.equal(
    correlatedDomainBlock.match(/invalidateCorrelatedCandidateDomainCaches\(\);/g)?.length,
    6,
    'every shrink, repair reset, merge, failed restore, and epoch restore invalidates both caches',
  );
  assert.match(
    correlatedDomainBlock,
    /const restored = restoreRouteNetworkArcConsistencyEpochDomains\([\s\S]*?if \(restored\) invalidateCorrelatedCandidateDomainCaches\(\);/,
  );
});

test('terminal rejected-pair diagnostics preserve legacy top-eight ordering', () => {
  const records = Array.from({ length: 14 }, (_, ordinal) => ({
    id: `pair:${ordinal}`,
    nodeCollisionScore: ordinal % 4,
    parentAttachmentClear: ordinal % 3 !== 0,
    minimumSpineDistanceMeters: (ordinal * 7) % 11,
  }));
  const original = structuredClone(records);
  const legacy = [...records].sort((first, second) => (
    first.nodeCollisionScore - second.nodeCollisionScore
      || Number(second.parentAttachmentClear) - Number(first.parentAttachmentClear)
      || first.minimumSpineDistanceMeters - second.minimumSpineDistanceMeters
  )).slice(0, 8);
  assert.deepEqual(
    selectRouteNetworkClosestRejectedPairRecords(records).map(({ id }) => id),
    legacy.map(({ id }) => id),
  );
  assert.deepEqual(records, original, 'ranking never mutates the complete pair domain');
  const tied = Array.from({ length: 10 }, (_, ordinal) => ({
    id: `tie:${ordinal}`,
    nodeCollisionScore: 0,
    parentAttachmentClear: true,
    minimumSpineDistanceMeters: 5,
  }));
  assert.deepEqual(
    selectRouteNetworkClosestRejectedPairRecords(tied).map(({ id }) => id),
    tied.slice(0, 8).map(({ id }) => id),
    'stable all-scalar ties retain the original Cartesian pair order',
  );
});

test('structural reductions classify before bounded rejected-pair hydration', () => {
  const plannerSource = readFileSync(
    new URL('../src/dungeon-augmentation/planner.js', import.meta.url),
    'utf8',
  );
  assert.match(
    plannerSource,
    /const failedPairRejectionSummary = summarizePlacementPairRejections\([\s\S]*?const spanOnlyQualification =[\s\S]*?if \(spanOnlyQualification\) \{[\s\S]*?continue arcConsistencyPass;\s*\}\s*const rejectedPairHydrationStartedAt/,
  );
  assert.match(
    plannerSource,
    /selectRouteNetworkClosestRejectedPairRecords\([\s\S]*?,\s*8,\s*\)\.map\(\(\{[\s\S]*?firstAvailableSockets: availableSpineSockets/,
    'only the retained top eight records hydrate socket arrays',
  );
  assert.match(
    plannerSource,
    /if \(adjacent\) \{[\s\S]*?adjacentPairHasPhysicalRoute\([\s\S]*?const failedPairRejectionSummary/,
    'the exact physical-pair cache is primed before classification',
  );
});

test('provisional conflict roots fail closed when missing or physically ambiguous', () => {
  const segment = (id, x) => ({
    id,
    kind: 'provisional-required-edge',
    connectorVariant: 'structural-span-conflict-root-v1',
    routeRole: 'route-network-spine',
    from: { nodeId: 'node:a', position: { x: 0, y: 0, z: 0 } },
    to: { nodeId: 'node:b', position: { x, y: 0, z: 0 } },
    path: [{ x: 0, y: 0, z: 0 }, { x, y: 0, z: 0 }],
    occupiedVolumes: [],
    clearanceVolumes: [],
    landingVolumes: [],
    planningOnly: true,
  });
  const first = segment('segment:first', 40);
  const second = segment('segment:second', 60);
  const duplicateFirst = segment('segment:duplicate-first', 40);
  assert.equal(createValidatedRouteNetworkProvisionalConflictRoots({
    grantId: 'grant:fixture',
    expectedRootCount: 2,
    provisionalSegments: [first],
    plannedSegments: [first],
  }).error, 'route-network-provisional-conflict-root-incomplete');
  assert.equal(createValidatedRouteNetworkProvisionalConflictRoots({
    grantId: 'grant:fixture',
    expectedRootCount: 2,
    provisionalSegments: [first, duplicateFirst],
    plannedSegments: [first, duplicateFirst],
  }).error, 'route-network-provisional-conflict-root-ambiguous');
  assert.equal(createValidatedRouteNetworkProvisionalConflictRoots({
    grantId: 'grant:fixture',
    expectedRootCount: 2,
    provisionalSegments: [first, second],
    plannedSegments: [first, second, duplicateFirst],
  }).error, 'route-network-provisional-conflict-root-ambiguous');
  const validRoots = createValidatedRouteNetworkProvisionalConflictRoots({
    grantId: 'grant:fixture',
    expectedRootCount: 2,
    provisionalSegments: [first, second],
    plannedSegments: [first, second],
    reasonByEntityId: new Map([[second.id,
      'route-network-required-edge-static-route-conflict']]),
  }).exactFailureRoots;
  assert.equal(validRoots.length, 2);
  assert.deepEqual(new Set(validRoots.map(({ reason }) => reason)), new Set([
    'route-network-required-edge-span-exceeded',
    'route-network-required-edge-static-route-conflict',
  ]));
});

test('isolated root dependencies require every complete-graph incident edge to be a root', () => {
  const classify = (overrides = {}) => deriveRouteNetworkIsolatedRootDependencyNodeIndices({
    nodeCount: 3,
    requiredEdges: [
      { edgeOrdinal: 0, fromIndex: 0, toIndex: 1 },
      { edgeOrdinal: 1, fromIndex: 1, toIndex: 2 },
    ],
    rootEdgeOrdinals: [0, 1],
    endpointNodeIndices: [0, 2],
    exactParentAttachmentNodeIndices: [0, 2],
    additionalGraphComplete: true,
    ...overrides,
  });
  assert.deepEqual(classify().dependencies, [{
    nodeIndex: 1,
    incidentRootEdgeOrdinals: [0, 1],
  }]);
  assert.deepEqual(classify({ rootEdgeOrdinals: [0] }).disposableNodeIndices, []);
  assert.deepEqual(classify({
    guaranteedAdditionalEdges: [{ fromIndex: 1, toIndex: 2 }],
  }).disposableNodeIndices, [], 'a deterministic topology edge keeps the node solved');
  assert.deepEqual(classify({
    exactParentAttachmentNodeIndices: [0, 1, 2],
  }).disposableNodeIndices, []);
  assert.deepEqual(classify({
    protectedTopologyNodeIndices: [1],
  }).disposableNodeIndices, []);
  assert.equal(classify({ additionalGraphComplete: false }).accepted, false);
});

test('isolated dependency salvage partitions its source and removes every marker', () => {
  const root = {
    grantId: 'grant:fixture',
    entityKind: 'segment',
    entityId: 'segment:root',
    signature: 'signature:root',
    reason: 'route-network-required-edge-span-exceeded',
  };
  const salvaged = {
    operation: {
      id: 'operation:fixture',
      nodeIds: ['node:left', 'node:right'],
      segmentIds: ['segment:keep'],
    },
    nodes: [{ id: 'node:left' }, { id: 'node:right' }],
    segments: [{
      id: 'segment:keep',
      from: { nodeId: 'node:left' },
      to: { nodeId: 'node:right' },
    }],
    routeNetworkEntityOmissions: [{
      grantId: 'grant:fixture',
      operationId: 'operation:fixture',
      entityKind: 'node',
      entityId: 'node:isolated',
      ordinal: 1,
      signature: 'signature:isolated',
      disposition: 'dependency',
      reason: 'isolated-node',
      rootSignature: root.signature,
    }, {
      grantId: 'grant:fixture',
      operationId: 'operation:fixture',
      entityKind: 'segment',
      entityId: root.entityId,
      ordinal: 1,
      signature: root.signature,
      disposition: 'conflict-root',
      reason: root.reason,
      rootSignature: root.signature,
    }],
  };
  const input = {
    salvaged,
    sourceNodeIds: ['node:left', 'node:isolated', 'node:right'],
    sourceSegmentIds: ['segment:keep', 'segment:root'],
    dependencies: [{
      nodeId: 'node:isolated',
      incidentRootSignatures: [root.signature],
    }],
    exactFailureRoots: [root],
  };
  assert.equal(validateRouteNetworkIsolatedDependencySalvage(input).accepted, true);
  assert.equal(validateRouteNetworkIsolatedDependencySalvage({
    ...input,
    salvaged: {
      ...salvaged,
      nodes: [...salvaged.nodes, {
        id: 'node:isolated',
        planningOnly: true,
        provisionalUnanchoredDependency: true,
      }],
    },
  }).error, 'route-network-isolated-dependency-marker-retained');
});

test('future endpoint cuts require one uniquely owned internal spine segment', () => {
  const segment = {
    id: 'segment:blocker',
    operationId: 'operation:landmark',
    grantId: 'grant:landmark',
    parentRegionId: 'region:main',
    physicalOrdinal: 0,
    routeRole: 'route-network-spine',
    from: { nodeId: 'node:left', socketId: 'exit' },
    to: { nodeId: 'node:right', socketId: 'entry' },
    occupiedVolumes: [{
      id: 'segment:blocker:occupied:0',
      ownerId: 'segment:blocker',
      center: { x: 0, y: 0, z: 0 },
      size: { x: 2, y: 2, z: 2 },
    }],
    clearanceVolumes: [],
    landingVolumes: [],
  };
  const restVolume = {
    id: 'node:left:occupied:0',
    ownerId: 'node:left',
    center: { x: 4, y: 0, z: 0 },
    size: { x: 2, y: 2, z: 2 },
  };
  const planned = {
    operation: {
      id: 'operation:landmark',
      grantId: 'grant:landmark',
      parentRegionId: 'region:main',
    },
    nodes: [{
      id: 'node:left',
      occupiedVolumes: [restVolume],
      clearanceVolumes: [],
    }, {
      id: 'node:right',
      occupiedVolumes: [],
      clearanceVolumes: [],
    }],
    segments: [segment],
  };
  const contextualDirectSurvivorBitsets = (volumes) => {
    const hasSegment = volumes.some(({ id }) => id === 'segment:blocker:occupied:0');
    const hasRest = volumes.some(({ id }) => id === restVolume.id);
    const target = (hasSegment ? 0b10n : 0b11n) & (hasRest ? 0b01n : 0b11n);
    const targetFallback = (hasSegment ? 0b1000n : 0b1100n)
      & (hasRest ? 0b0100n : 0b1100n);
    return [{ primary: target, fallback: targetFallback }, {
      primary: 0b11n,
      fallback: 0b01n,
    }, {
      primary: 0b11n,
      fallback: 0b01n,
    }];
  };
  const bitCount = (value) => value.toString(2).replaceAll('0', '').length;
  const survivorVectorForBitsetEvaluator = (evaluate) => (volumes) => (
    evaluate(volumes).map(({ primary, fallback }) => (
      primary > 0n ? bitCount(primary) : bitCount(fallback)
    ))
  );
  const directSurvivorVector = survivorVectorForBitsetEvaluator(
    contextualDirectSurvivorBitsets,
  );
  const authoritativeSurvivorVector = (volumes) => {
    const hasSegment = volumes.some(({ id }) => id === 'segment:blocker:occupied:0');
    const hasRest = volumes.some(({ id }) => id === restVolume.id);
    if (hasSegment && hasRest) return [0, 0, 2];
    return hasSegment || hasRest ? [1, 2, 2] : [2, 2, 2];
  };
  const input = {
    planned,
    grantId: 'grant:landmark',
    parentRegionId: 'region:main',
    targetFutureOperationOrdinal: 4,
    endpointDescriptors: [{
      futureOperationOrdinal: 4,
      futureGrantId: 'grant:target',
      endpointOrdinal: 0,
      endpointId: 'endpoint:target:0',
    }, {
      futureOperationOrdinal: 4,
      futureGrantId: 'grant:target',
      endpointOrdinal: 1,
      endpointId: 'endpoint:target:1',
    }, {
      futureOperationOrdinal: 5,
      futureGrantId: 'grant:later',
      endpointOrdinal: 0,
      endpointId: 'endpoint:later:0',
    }],
    evaluateDirectSurvivorBitsets: contextualDirectSurvivorBitsets,
    evaluateDirectSurvivorVector: directSurvivorVector,
    evaluateAuthoritativeSurvivorVector: authoritativeSurvivorVector,
  };
  const classified = classifyRouteNetworkFutureEndpointSingleSegmentConflict(input);
  assert.equal(classified.accepted, true);
  assert.equal(classified.segment.id, segment.id);
  assert.equal(
    classified.exactFailureRoot.reason,
    'route-network-future-endpoint-domain-single-segment-conflict',
  );

  assert.equal(classifyRouteNetworkFutureEndpointSingleSegmentConflict({
    ...input,
    planned: {
      ...planned,
      segments: [{
        ...segment,
        occupiedVolumes: segment.occupiedVolumes.map((volume) => ({
          ...volume,
          ownerId: 'some-other-entity',
        })),
      }],
    },
  }).error, 'route-network-future-cut-qualifying-segment-count-invalid');
  assert.equal(classifyRouteNetworkFutureEndpointSingleSegmentConflict({
    ...input,
    planned: {
      ...planned,
      segments: [{
        ...segment,
        grantId: 'grant:other',
      }],
    },
  }).error, 'route-network-future-cut-qualifying-segment-count-invalid');
  assert.equal(classifyRouteNetworkFutureEndpointSingleSegmentConflict({
    ...input,
    evaluateAuthoritativeSurvivorVector: (volumes) => {
      const complete = volumes.some(({ id }) => id === 'segment:blocker:occupied:0')
        && volumes.some(({ id }) => id === restVolume.id);
      return complete ? [1, 2, 0] : authoritativeSurvivorVector(volumes);
    },
  }).error, 'route-network-future-cut-full-causation-invalid');
  assert.equal(classifyRouteNetworkFutureEndpointSingleSegmentConflict({
    ...input,
    evaluateAuthoritativeSurvivorVector: (volumes) => {
      const complete = volumes.some(({ id }) => id === 'segment:blocker:occupied:0')
        && volumes.some(({ id }) => id === restVolume.id);
      return complete ? [0, 0, 0] : authoritativeSurvivorVector(volumes);
    },
  }).error, 'route-network-future-cut-full-causation-invalid');
  assert.equal(classifyRouteNetworkFutureEndpointSingleSegmentConflict({
    ...input,
    evaluateDirectSurvivorVector: () => [0, 2, 2],
    evaluateAuthoritativeSurvivorVector: () => [0, 0, 2],
  }).error, 'route-network-future-cut-baseline-not-viable');
  assert.equal(classifyRouteNetworkFutureEndpointSingleSegmentConflict({
    ...input,
    evaluateAuthoritativeSurvivorVector: () => [Number.NaN, 2, 2],
  }).error, 'route-network-future-cut-baseline-not-viable');
  assert.equal(classifyRouteNetworkFutureEndpointSingleSegmentConflict({
    ...input,
    evaluateDirectSurvivorBitsets: () => [{
      primary: -1n,
      fallback: 0n,
    }, {
      primary: 0b11n,
      fallback: 0n,
    }, {
      primary: 0b11n,
      fallback: 0n,
    }],
  }).error, 'route-network-future-cut-baseline-not-viable');
  const assertBitsetProofRejected = (evaluateDirectSurvivorBitsets) => {
    assert.equal(classifyRouteNetworkFutureEndpointSingleSegmentConflict({
      ...input,
      evaluateDirectSurvivorBitsets,
      evaluateDirectSurvivorVector:
        survivorVectorForBitsetEvaluator(evaluateDirectSurvivorBitsets),
    }).error, 'route-network-future-cut-qualifying-segment-count-invalid');
  };
  assertBitsetProofRejected((volumes) => {
    const bitsets = contextualDirectSurvivorBitsets(volumes);
    if (volumes.some(({ id }) => id === 'segment:blocker:occupied:0')) {
      bitsets[2] = { primary: 0b01n, fallback: 0n };
    }
    return bitsets;
  });
  assertBitsetProofRejected((volumes) => {
    const hasSegment = volumes.some(({ id }) => id === 'segment:blocker:occupied:0');
    const hasRest = volumes.some(({ id }) => id === restVolume.id);
    const target = hasSegment
      ? (hasRest ? 0n : 0b110n)
      : (hasRest ? 0b01n : 0b11n);
    return [target, 0b11n, 0b11n].map((primary) => ({ primary, fallback: 0n }));
  });
  assertBitsetProofRejected((volumes) => {
    const hasSegment = volumes.some(({ id }) => id === 'segment:blocker:occupied:0');
    const hasRest = volumes.some(({ id }) => id === restVolume.id);
    const target = hasSegment && hasRest ? 0n : hasSegment || hasRest ? 0b10n : 0b11n;
    return [target, 0b11n, 0b11n].map((primary) => ({ primary, fallback: 0n }));
  });
  for (const endpointDescriptors of [[
    ...input.endpointDescriptors,
    { ...input.endpointDescriptors[0] },
  ], input.endpointDescriptors.map((descriptor, index) => index === 0 ? {
    ...descriptor,
    endpointId: '',
  } : descriptor), input.endpointDescriptors.map((descriptor, index) => index === 1 ? {
    ...descriptor,
    futureGrantId: 'grant:contradiction',
  } : descriptor), input.endpointDescriptors.map((descriptor, index) => index === 1 ? {
    ...descriptor,
    endpointOrdinal: 0,
  } : descriptor), input.endpointDescriptors.map((descriptor, index) => index === 1 ? {
    ...descriptor,
    endpointId: 'endpoint:target:0',
  } : descriptor)]) {
    assert.equal(classifyRouteNetworkFutureEndpointSingleSegmentConflict({
      ...input,
      endpointDescriptors,
    }).error, 'route-network-future-cut-endpoint-descriptors-invalid');
  }
});

test('complete authoritative survivor collection does not stop at an early zero', () => {
  const visited = [];
  const survivorVector = collectCompleteRouteNetworkFutureEndpointSurvivorVector(
    [4, 5],
    (futureOperationOrdinal) => {
      visited.push(futureOperationOrdinal);
      return futureOperationOrdinal === 4 ? [0, 0] : [0];
    },
  );
  assert.deepEqual(visited, [4, 5]);
  assert.deepEqual(survivorVector, [0, 0, 0]);
});

test('future-cut cap inputs are the exact deterministic nonaliased derivation', () => {
  const room = {
    id: 'node:room',
    kind: 'supplementRoom',
    placement: {
      center: { x: 0, y: 0, z: 0 },
      size: { x: 14, y: 8.4, z: 14 },
      rotationQuarterTurns: 0,
    },
    occupiedVolumes: [{
      id: 'node:room:occupied:0',
      ownerId: 'node:room',
      center: { x: 0, y: 4.2, z: 0 },
      size: { x: 14, y: 8.4, z: 14 },
    }],
    clearanceVolumes: [],
    sockets: [{
      id: 'node:room:socket:east',
      localSocketId: 'east',
      state: 'capped',
      position: { x: 5.6, y: 0, z: 0 },
      facing: { x: 1, y: 0, z: 0 },
    }, {
      id: 'node:room:socket:west',
      localSocketId: 'west',
      state: 'capped',
      position: { x: -5.6, y: 0, z: 0 },
      facing: { x: -1, y: 0, z: 0 },
    }],
  };
  const planned = {
    operation: { id: 'operation:fixture' },
    nodes: [room],
    segments: [],
  };
  const exactCaps = routeNetworkInactiveSocketCapPlanningVolumes([room]);
  assert.equal(exactCaps.length, 2);
  assert.equal(validateRouteNetworkFutureCutCapDerivation({
    planned,
    capPlanningVolumes: exactCaps,
  }).accepted, true);
  for (const capPlanningVolumes of [
    exactCaps.map((cap, index) => index === 0 ? { ...cap, ownerId: 'node:other' } : cap),
    exactCaps.map((cap, index) => index === 0 ? {
      ...cap,
      center: { ...cap.center, x: cap.center.x + 1 },
    } : cap),
    [...exactCaps].reverse(),
    [exactCaps[0], exactCaps[0]],
    exactCaps.slice(0, 1),
  ]) {
    assert.equal(validateRouteNetworkFutureCutCapDerivation({
      planned,
      capPlanningVolumes,
    }).error, 'route-network-future-cut-cap-derivation-mismatch');
  }
  assert.equal(validateRouteNetworkFutureCutCapDerivation({
    planned: {
      ...planned,
      nodes: [{
        ...room,
        occupiedVolumes: [{
          ...room.occupiedVolumes[0],
          id: exactCaps[0].id,
        }],
      }],
    },
    capPlanningVolumes: exactCaps,
  }).error, 'route-network-future-cut-cap-identity-alias');
  assert.equal(validateRouteNetworkFutureCutCapDerivation({
    planned: {
      ...planned,
      nodes: [{
        ...room,
        occupiedVolumes: [{
          ...room.occupiedVolumes[0],
          id: room.id,
        }],
      }],
    },
    capPlanningVolumes: exactCaps,
  }).error, 'route-network-future-cut-cap-identity-alias',
  'cap owner/node identities cannot alias an entity planning-volume ID');
});

test('contextual future cuts reject two individually viable segment removals', () => {
  const volume = (id, ownerId, x) => ({
    id,
    ownerId,
    center: { x, y: 0, z: 0 },
    size: { x: 1, y: 1, z: 1 },
  });
  const segment = (ordinal, blockerBit) => ({
    id: `segment:${ordinal}`,
    operationId: 'operation:landmark',
    grantId: 'grant:landmark',
    parentRegionId: 'region:main',
    physicalOrdinal: ordinal,
    routeRole: 'route-network-spine',
    from: { nodeId: 'node:left', socketId: `exit:${ordinal}` },
    to: { nodeId: 'node:right', socketId: `entry:${ordinal}` },
    path: [{ x: ordinal, y: 0, z: 0 }, { x: ordinal + 1, y: 0, z: 0 }],
    occupiedVolumes: [volume(`segment:${ordinal}:occupied:0`, `segment:${ordinal}`, ordinal)],
    clearanceVolumes: [],
    landingVolumes: [],
    blockerBit,
  });
  const first = segment(0, 0b001n);
  const second = segment(1, 0b010n);
  const nodeBlocker = volume('node:left:occupied:0', 'node:left', 4);
  const planned = {
    operation: {
      id: 'operation:landmark',
      grantId: 'grant:landmark',
      parentRegionId: 'region:main',
    },
    nodes: [{
      id: 'node:left',
      occupiedVolumes: [nodeBlocker],
      clearanceVolumes: [],
    }, {
      id: 'node:right',
      occupiedVolumes: [],
      clearanceVolumes: [],
    }],
    segments: [first, second],
  };
  const evaluateDirectSurvivorBitsets = (volumes) => {
    let target = 0b111n;
    if (volumes.some(({ id }) => id === first.occupiedVolumes[0].id)) target &= ~0b001n;
    if (volumes.some(({ id }) => id === second.occupiedVolumes[0].id)) target &= ~0b010n;
    if (volumes.some(({ id }) => id === nodeBlocker.id)) target &= ~0b100n;
    return [target, 0b11n, 0b11n].map((primary) => ({ primary, fallback: 0n }));
  };
  const bitCount = (value) => value.toString(2).replaceAll('0', '').length;
  const evaluateDirectSurvivorVector = (volumes) => (
    evaluateDirectSurvivorBitsets(volumes).map(({ primary }) => bitCount(primary))
  );
  const evaluateAuthoritativeSurvivorVector = (volumes) => {
    const direct = evaluateDirectSurvivorVector(volumes);
    return direct[0] === 0 ? [0, 0, 2] : direct;
  };
  assert.equal(classifyRouteNetworkFutureEndpointSingleSegmentConflict({
    planned,
    grantId: 'grant:landmark',
    parentRegionId: 'region:main',
    targetFutureOperationOrdinal: 4,
    endpointDescriptors: [{
      futureOperationOrdinal: 4,
      futureGrantId: 'grant:target',
      endpointOrdinal: 0,
      endpointId: 'endpoint:target:0',
    }, {
      futureOperationOrdinal: 4,
      futureGrantId: 'grant:target',
      endpointOrdinal: 1,
      endpointId: 'endpoint:target:1',
    }, {
      futureOperationOrdinal: 5,
      futureGrantId: 'grant:later',
      endpointOrdinal: 0,
      endpointId: 'endpoint:later:0',
    }],
    evaluateDirectSurvivorBitsets,
    evaluateDirectSurvivorVector,
    evaluateAuthoritativeSurvivorVector,
  }).error, 'route-network-future-cut-qualifying-segment-count-invalid');
  const evaluatorWithNonTargetSoloChange = (volumes) => {
    const bitsets = evaluateDirectSurvivorBitsets(volumes);
    if (volumes.some(({ id }) => id === first.occupiedVolumes[0].id)) {
      bitsets[1] = { primary: 0b01n, fallback: 0n };
    }
    return bitsets;
  };
  const vectorWithNonTargetSoloChange = (volumes) => (
    evaluatorWithNonTargetSoloChange(volumes).map(({ primary }) => bitCount(primary))
  );
  const nonTargetSoloChange = classifyRouteNetworkFutureEndpointSingleSegmentConflict({
    planned,
    grantId: 'grant:landmark',
    parentRegionId: 'region:main',
    targetFutureOperationOrdinal: 4,
    endpointDescriptors: [{
      futureOperationOrdinal: 4,
      futureGrantId: 'grant:target',
      endpointOrdinal: 0,
      endpointId: 'endpoint:target:0',
    }, {
      futureOperationOrdinal: 4,
      futureGrantId: 'grant:target',
      endpointOrdinal: 1,
      endpointId: 'endpoint:target:1',
    }, {
      futureOperationOrdinal: 5,
      futureGrantId: 'grant:later',
      endpointOrdinal: 0,
      endpointId: 'endpoint:later:0',
    }],
    evaluateDirectSurvivorBitsets: evaluatorWithNonTargetSoloChange,
    evaluateDirectSurvivorVector: vectorWithNonTargetSoloChange,
    evaluateAuthoritativeSurvivorVector: vectorWithNonTargetSoloChange,
  });
  assert.equal(
    nonTargetSoloChange.error,
    'route-network-future-cut-qualifying-segment-count-invalid',
    'every C-minus-segment restorer counts even if its solo state changes another domain',
  );
  assert.deepEqual(
    new Set(nonTargetSoloChange.context.restoringSegmentIds),
    new Set([first.id, second.id]),
  );
});

test('route-network segment grant ownership is stamped at its unified boundary', () => {
  const plannerSource = readFileSync(
    new URL('../src/dungeon-augmentation/planner.js', import.meta.url),
    'utf8',
  );
  assert.match(
    plannerSource,
    /function decorateRouteNetworkSegment\(segment, \{\s*grantId,[\s\S]*?segment\.grantId = String\(grantId \?\? ''\);/,
  );
  assert.equal(
    plannerSource.match(/decorateRouteNetworkSegment\(segment, \{\s*grantId: grant\.id,/g)?.length,
    3,
  );
  assert.match(
    plannerSource,
    /const provisionalSegment = \{[\s\S]*?operationId,\s*grantId: grant\.id,\s*parentRegionId: region\.id,/,
  );
});

test('future endpoint cut proposals remain ordinary non-replay work', () => {
  const plannerSource = readFileSync(
    new URL('../src/dungeon-augmentation/planner.js', import.meta.url),
    'utf8',
  );
  assert.match(plannerSource, /if \(allowPartialRouteNetworkRealization\s*\n\s*&& grant\.required\s*\n\s*&& !recoveryReplay\s*\n\s*&& !parentAnchoredForestSalvageReplay\) \{\s*\n\s*const futureCutProposal = createFutureEndpointSingleSegmentSalvageProposal/);
});

test('contextual future cuts are ledger roots but never reusable physical bans', () => {
  const samePhysicalRoot = {
    grantId: 'grant:landmark',
    entityKind: 'segment',
    entityId: 'segment:5',
    signature: 'signature:segment:5',
  };
  const contextual = {
    ...samePhysicalRoot,
    reason: 'route-network-future-endpoint-domain-single-segment-conflict',
  };
  const intrinsic = {
    ...samePhysicalRoot,
    reason: 'route-network-required-edge-static-route-conflict',
  };
  assert.equal(isRouteNetworkConflictExclusionReusablePhysicalBan(contextual), false);
  assert.equal(isRouteNetworkConflictExclusionReusablePhysicalBan(intrinsic), true);
  assert.deepEqual([contextual].filter(
    isRouteNetworkConflictExclusionReusablePhysicalBan,
  ), [], 'the same physical segment may be retried in a different candidate context');
  assert.deepEqual([intrinsic].filter(
    isRouteNetworkConflictExclusionReusablePhysicalBan,
  ), [intrinsic], 'intrinsic roots remain reusable across candidate contexts');

  const plannerSource = readFileSync(
    new URL('../src/dungeon-augmentation/planner.js', import.meta.url),
    'utf8',
  );
  assert.match(plannerSource, /const excludedSegmentConflictSignatures = new Set\([\s\S]*?isRouteNetworkConflictExclusionReusablePhysicalBan\(exclusion\)/);
  assert.match(plannerSource, /const reusableRouteNetworkConflictExclusions =\s*normalizedRouteNetworkConflictExclusions\.filter\(\s*isRouteNetworkConflictExclusionReusablePhysicalBan/);
  assert.match(plannerSource, /rejectRouteNetworkCandidateForConflictExclusions\(\s*completePlanned,\s*reusableRouteNetworkConflictExclusions/);
  assert.match(plannerSource, /const reusableRootSignatures = new Set\([\s\S]*?normalizeRouteNetworkConflictExclusions\(reusableRouteNetworkConflictExclusions\)[\s\S]*?isRouteNetworkConflictExclusionReusablePhysicalBan\(root\)/);
  assert.match(plannerSource, /const missingProposalLocalRoot = exactFailureRoots\.some\(\(root\) => \([\s\S]*?omissionMatchesProposalLocalRoot\(omission, root\)/);
});

test('pending exact salvage defers only candidate-continuation partial acceptance', () => {
  assert.equal(routeNetworkCandidateContinuationMayReturnPartial({
    allowPartialRouteNetworkRealization: true,
    pendingConflictSalvageProposalCount: 0,
  }), true);
  assert.equal(routeNetworkCandidateContinuationMayReturnPartial({
    allowPartialRouteNetworkRealization: true,
    pendingConflictSalvageProposalCount: 1,
  }), false);
  assert.equal(routeNetworkCandidateContinuationMayReturnPartial({
    allowPartialRouteNetworkRealization: false,
    pendingConflictSalvageProposalCount: 0,
  }), false);
  const plannerSource = readFileSync(
    new URL('../src/dungeon-augmentation/planner.js', import.meta.url),
    'utf8',
  );
  assert.match(
    plannerSource,
    /if \(considerScoredSolution\(solved\)\) return bestScoredSolution;\s*if \(routeNetworkCandidateContinuationMayReturnPartial\(\{\s*allowPartialRouteNetworkRealization,\s*pendingConflictSalvageProposalCount: conflictSalvageProposals\.length,/,
  );
});

test('candidate-owned roots stay local while accepted recovery roots union deterministically', () => {
  const exclusion = (entityId, signature) => ({
    grantId: 'grant:fixture',
    entityKind: 'segment',
    entityId,
    signature,
    reason: 'route-network-required-edge-span-exceeded',
  });
  const inherited = [exclusion('segment:inherited', 'signature:inherited')];
  const candidateRoot = exclusion('segment:candidate', 'signature:candidate');
  const recoveryRoot = exclusion('segment:recovery', 'signature:recovery');
  const stagedCandidate = stageRouteNetworkCandidateConflictExclusions(inherited, {
    routeNetworkConflictExclusions: [candidateRoot],
  });
  const stagedRecovery = stageRouteNetworkCandidateConflictExclusions(stagedCandidate, {
    routeNetworkConflictExclusions: [recoveryRoot],
  });

  assert.deepEqual(inherited.map(({ entityId }) => entityId), ['segment:inherited']);
  assert.deepEqual(new Set(stagedCandidate.map(({ entityId }) => entityId)), new Set([
    'segment:inherited',
    'segment:candidate',
  ]));
  assert.deepEqual(new Set(stagedRecovery.map(({ entityId }) => entityId)), new Set([
    'segment:inherited',
    'segment:candidate',
    'segment:recovery',
  ]));
  assert.deepEqual(
    stageRouteNetworkCandidateConflictExclusions(inherited, null),
    inherited,
    'discarding the candidate stage cannot leak its generated root',
  );
});

test('generated salvage checkpoints remain ahead of whole-grant pruning and are idempotent', () => {
  const schedule = createRouteNetworkPartialFirstCandidateSchedule([
    { candidateIndex: 0 },
    { candidateIndex: 1 },
  ], {
    allowPartialRouteNetworkRealization: true,
    routeNetworkKind: 'objective-route-coverage',
    required: true,
  });
  assert.equal(ensureRouteNetworkTerminalSalvageCheckpoint(schedule), true);
  assert.deepEqual(schedule.map((entry) => (
    entry.partialFirstCheckpoint ?? `candidate:${entry.candidateIndex}`
  )), [
    'candidate:0',
    'candidate:1',
    'terminal-exact-conflict-salvage',
    'prune-current-required-coverage',
  ]);
  assert.equal(ensureRouteNetworkTerminalSalvageCheckpoint(schedule), false);
  assert.equal(schedule.filter((entry) => (
    entry.partialFirstCheckpoint === 'terminal-exact-conflict-salvage'
  )).length, 1);

  const landmarkSchedule = [
    { candidateIndex: 0 },
    { partialFirstCheckpoint: 'deferred-blocked-future' },
    { partialFirstCheckpoint: 'terminal-exact-conflict-salvage' },
  ];
  assert.equal(ensureRouteNetworkTerminalSalvageCheckpoint(landmarkSchedule), true);
  assert.deepEqual(landmarkSchedule.map((entry) => (
    entry.partialFirstCheckpoint ?? `candidate:${entry.candidateIndex}`
  )), [
    'candidate:0',
    'terminal-exact-conflict-salvage',
    'deferred-blocked-future',
  ]);
  assert.equal(ensureRouteNetworkTerminalSalvageCheckpoint(landmarkSchedule), false);

  const resumedSchedule = [
    { partialFirstCheckpoint: 'deferred-blocked-future' },
    { partialFirstCheckpoint: 'consumed-exact-conflict-salvage' },
    { candidateIndex: 13 },
    { partialFirstCheckpoint: 'prune-current-required-coverage' },
  ];
  assert.equal(ensureRouteNetworkTerminalSalvageCheckpoint(
    resumedSchedule,
    { afterIndex: 1 },
  ), true);
  assert.deepEqual(resumedSchedule.map((entry) => (
    entry.partialFirstCheckpoint ?? `candidate:${entry.candidateIndex}`
  )), [
    'deferred-blocked-future',
    'consumed-exact-conflict-salvage',
    'candidate:13',
    'terminal-exact-conflict-salvage',
    'prune-current-required-coverage',
  ], 'a historical destructive checkpoint cannot pull new work behind the cursor');
  assert.equal(ensureRouteNetworkTerminalSalvageCheckpoint(
    resumedSchedule,
    { afterIndex: 1 },
  ), false);
});

test('parent-anchored salvage ranking retains the largest forest with stable ties', () => {
  const proposal = ({
    id,
    endpoints,
    modules,
    nodes,
    segments,
    omissions,
    candidateOrdinal,
  }) => ({
    candidateOrdinal,
    planned: {
      operation: {
        id,
        endpointSocketIds: Array.from({ length: endpoints }, (_, index) => `socket:${index}`),
        substantiveModuleCount: modules,
        physicalNodeCount: nodes,
        segmentIds: Array.from({ length: segments }, (_, index) => `segment:${index}`),
      },
      routeNetworkEntityOmissions: Array.from({ length: omissions }, (_, index) => ({
        grantId: 'grant:fixture',
        operationId: id,
        entityKind: 'node',
        entityId: `${id}:omission:${index}`,
        ordinal: index,
        signature: `${id}:signature:${index}`,
        disposition: index === 0 ? 'conflict-root' : 'dependency',
        reason: 'fixture-conflict',
        rootSignature: `${id}:signature:0`,
      })),
    },
  });
  const smaller = proposal({
    id: 'smaller', endpoints: 1, modules: 4, nodes: 5, segments: 5, omissions: 1,
    candidateOrdinal: 0,
  });
  const larger = proposal({
    id: 'larger', endpoints: 2, modules: 3, nodes: 4, segments: 4, omissions: 2,
    candidateOrdinal: 9,
  });
  assert.equal(
    selectPreferredParentAnchoredRouteNetworkSalvageProposal(smaller, larger),
    larger,
    'retained parent attachments outrank downstream size',
  );

  const fewerOmissions = proposal({
    id: 'fewer', endpoints: 2, modules: 3, nodes: 4, segments: 4, omissions: 1,
    candidateOrdinal: 8,
  });
  assert.equal(
    selectPreferredParentAnchoredRouteNetworkSalvageProposal(larger, fewerOmissions),
    fewerOmissions,
  );
  const earlierTie = proposal({
    id: 'earlier', endpoints: 2, modules: 3, nodes: 4, segments: 4, omissions: 1,
    candidateOrdinal: 2,
  });
  assert.equal(
    selectPreferredParentAnchoredRouteNetworkSalvageProposal(fewerOmissions, earlierTie),
    earlierTie,
  );
});

test('contextual segment cuts must strictly outrank every safe node cut', () => {
  const proposal = ({
    id,
    endpoints,
    modules,
    nodes,
    segments,
    candidateOrdinal = 7,
  }) => ({
    candidateOrdinal,
    planned: {
      operation: {
        id,
        endpointSocketIds: Array.from(
          { length: endpoints },
          (_, index) => `${id}:socket:${index}`,
        ),
        substantiveModuleCount: modules,
        physicalNodeCount: nodes,
        segmentIds: Array.from(
          { length: segments },
          (_, index) => `${id}:segment:${index}`,
        ),
      },
      routeNetworkEntityOmissions: [],
    },
  });
  const segment = proposal({
    id: 'segment-cut', endpoints: 2, modules: 3, nodes: 4, segments: 4,
  });
  const equalNode = proposal({
    id: 'equal-node-cut', endpoints: 2, modules: 3, nodes: 4, segments: 4,
  });
  const betterNode = proposal({
    id: 'better-node-cut', endpoints: 3, modules: 3, nodes: 4, segments: 4,
  });
  const worseNode = proposal({
    id: 'worse-node-cut', endpoints: 1, modules: 4, nodes: 5, segments: 5,
  });
  assert.equal(
    routeNetworkFutureSegmentCutOutranksNodeAlternatives(segment, [equalNode]),
    false,
    'a stable quality tie belongs to the node alternative',
  );
  assert.equal(
    routeNetworkFutureSegmentCutOutranksNodeAlternatives(segment, [betterNode]),
    false,
  );
  assert.equal(
    routeNetworkFutureSegmentCutOutranksNodeAlternatives(segment, [worseNode]),
    true,
  );
  assert.equal(
    routeNetworkFutureSegmentCutOutranksNodeAlternatives(
      segment,
      [worseNode, equalNode],
    ),
    false,
    'all safe node alternatives are considered',
  );

  const plannerSource = readFileSync(
    new URL('../src/dungeon-augmentation/planner.js', import.meta.url),
    'utf8',
  );
  assert.match(
    plannerSource,
    /const evaluateRootSalvage = \(proposedRoot\) => \{[\s\S]*?createParentAnchoredRouteNetworkSalvage\(\s*planned,\s*helperRoots,/,
  );
  assert.match(
    plannerSource,
    /const entityPlanningVolumes = \(entity\) => \[[\s\S]*?occupiedVolumes[\s\S]*?clearanceVolumes[\s\S]*?landingVolumes/,
    'nodes and segments use identical occupied, clearance, and landing planning volumes',
  );
  assert.match(
    plannerSource,
    /const capDerivation = validateRouteNetworkFutureCutCapDerivation\(\{\s*planned: salvaged,[\s\S]*?validateRouteNetworkInactiveSocketCapPlanningVolumes\([\s\S]*?completeFutureEndpointViability\(/,
  );
  assert.match(
    plannerSource,
    /const safeNodeAlternatives = nodeRootRecords\.map\([\s\S]*?evaluateRootSalvage\(nodeRoot\)[\s\S]*?routeNetworkFutureSegmentCutOutranksNodeAlternatives\(/,
    'every node root runs through the same helper and final viability checks',
  );
  assert.match(
    plannerSource,
    /const localRootOmissionCount = conflictRootOmissions\.filter\([\s\S]*?localRootOmissionCount !== 1/,
    'the proposal-local root remains independently mandatory',
  );
});

test('candidate evaluation budget preserves the reserved future window', () => {
  assert.deepEqual(consumeRouteNetworkCandidateEvaluationBudget({
    candidateEvaluations: 88,
    maximumCandidateEvaluations: 121,
    futureRequiredNetworkCount: 4,
    reservedCandidateEvaluationsPerFutureRequiredNetwork: 8,
  }), {
    accepted: true,
    candidateEvaluations: 89,
    maximumCandidateEvaluations: 121,
    reservedCandidateEvaluations: 32,
    currentNetworkCandidateEvaluationLimit: 89,
  }, 'the current grant remains inside the existing 89-evaluation ceiling');
  assert.equal(consumeRouteNetworkCandidateEvaluationBudget({
    candidateEvaluations: 89,
    maximumCandidateEvaluations: 121,
    futureRequiredNetworkCount: 4,
    reservedCandidateEvaluationsPerFutureRequiredNetwork: 8,
  }).accepted, false, 'the reserved 32-evaluation future window is unchanged');
});

test('multi-grant omission ledgers preserve the validator canonical order', () => {
  const omission = ({ grantId, operationId, entityId, ordinal }) => ({
    grantId,
    operationId,
    entityKind: 'segment',
    entityId,
    ordinal,
    signature: `signature:${entityId}`,
    disposition: 'conflict-root',
    reason: 'route-network-fixture-conflict',
    rootSignature: `signature:${entityId}`,
  });
  const progressionFirst = omission({
    grantId: 'grant:z-boss',
    operationId: 'operation:0',
    entityId: 'segment:boss',
    ordinal: 0,
  });
  const progressionSecond = omission({
    grantId: 'grant:a-trap',
    operationId: 'operation:1',
    entityId: 'segment:trap',
    ordinal: 0,
  });
  assert.deepEqual(
    normalizeRouteNetworkEntityOmissions([
      progressionFirst,
      progressionSecond,
    ]).map(({ grantId }) => grantId),
    ['grant:a-trap', 'grant:z-boss'],
    'canonical grant order may intentionally differ from progression order',
  );

  const plannerSource = readFileSync(
    new URL('../src/dungeon-augmentation/planner.js', import.meta.url),
    'utf8',
  );
  assert.match(
    plannerSource,
    /const routeNetworkEntityOmissions = normalizeRouteNetworkEntityOmissions\(\s*solvedRouteNetworks\.routeNetworkEntityOmissions \?\? \[\],\s*\);/,
  );
  assert.doesNotMatch(
    plannerSource,
    /const routeNetworkEntityOmissions = normalizeRouteNetworkEntityOmissions\([\s\S]*?\)\.sort\(/,
    'overlay serialization must not re-sort the canonical audited ledger',
  );
});

test('complete salvage witness cache keys are stable and isolated by grant host', () => {
  const commonIdentity = {
    basePlanHash: 'base-plan:fixture',
    baseDraftFingerprint: 'base-draft:fixture',
    augmentationSeed: 'augmentation-seed:fixture',
    layoutSeed: 'layout-seed:fixture',
    difficulty: 3,
    profileId: 'industrial-supplement-preview-v4',
    profileRevision: 5,
    planningAttempt: 0,
    grantId: 'grant:coverage:a',
    parentRegionId: 'region:parent:a',
    contextSignature: 'context:fixture',
    candidateIndex: 2,
    candidateOrdinal: 4,
    candidateSearchVariant: { id: 'variant:a', stationSideAlternativeOrdinal: 1 },
    moduleCount: 5,
    elevationMode: 'split-level',
    topologySelection: { selectedId: 'topology:a', legalIds: ['topology:a'] },
    junctionSelection: { selectedId: 'junction:a', legalIds: ['junction:a'] },
    elevationSelection: { selectedId: 'elevation:a', legalIds: ['elevation:a'] },
    candidateElevationModes: ['flat', 'split-level'],
    moduleCapacity: 6,
    solveDecisionOrdinal: 1,
  };
  const key = createRouteNetworkCompleteSalvageWitnessCacheKey(commonIdentity);
  assert.equal(typeof key, 'string');
  assert.equal(
    createRouteNetworkCompleteSalvageWitnessCacheKey({
      planningAttempt: commonIdentity.planningAttempt,
      profileRevision: commonIdentity.profileRevision,
      profileId: commonIdentity.profileId,
      difficulty: commonIdentity.difficulty,
      layoutSeed: commonIdentity.layoutSeed,
      augmentationSeed: commonIdentity.augmentationSeed,
      baseDraftFingerprint: commonIdentity.baseDraftFingerprint,
      basePlanHash: commonIdentity.basePlanHash,
      solveDecisionOrdinal: commonIdentity.solveDecisionOrdinal,
      moduleCapacity: commonIdentity.moduleCapacity,
      candidateElevationModes: commonIdentity.candidateElevationModes,
      elevationSelection: commonIdentity.elevationSelection,
      junctionSelection: commonIdentity.junctionSelection,
      topologySelection: commonIdentity.topologySelection,
      elevationMode: commonIdentity.elevationMode,
      moduleCount: commonIdentity.moduleCount,
      candidateSearchVariant: commonIdentity.candidateSearchVariant,
      candidateOrdinal: commonIdentity.candidateOrdinal,
      candidateIndex: commonIdentity.candidateIndex,
      contextSignature: commonIdentity.contextSignature,
      parentRegionId: commonIdentity.parentRegionId,
      grantId: commonIdentity.grantId,
    }),
    key,
    'canonical identity must not depend on object property order',
  );
  assert.equal(
    createRouteNetworkCompleteSalvageWitnessCacheKey({
      ...commonIdentity,
      routeNetworkConflictExclusions: [{
        grantId: commonIdentity.grantId,
        entityKind: 'segment',
        entityId: 'segment:excluded',
        signature: 'signature:excluded',
      }],
    }),
    key,
    'exact exclusions are intentionally not part of a paid-witness identity',
  );
  assert.notEqual(
    createRouteNetworkCompleteSalvageWitnessCacheKey({
      ...commonIdentity,
      grantId: 'grant:coverage:b',
    }),
    key,
  );
  assert.notEqual(
    createRouteNetworkCompleteSalvageWitnessCacheKey({
      ...commonIdentity,
      parentRegionId: 'region:parent:b',
    }),
    key,
  );
  for (const [field, value] of [
    ['basePlanHash', 'base-plan:other'],
    ['baseDraftFingerprint', 'base-draft:other'],
    ['augmentationSeed', 'augmentation-seed:other'],
    ['profileRevision', 6],
    ['planningAttempt', 1],
  ]) {
    assert.notEqual(
      createRouteNetworkCompleteSalvageWitnessCacheKey({
        ...commonIdentity,
        [field]: value,
      }),
      key,
      `${field} must isolate the generation-scoped witness cache`,
    );
  }
});

test('completed-plan memo keys isolate caller-owned maps by generation identity', () => {
  const commonIdentity = {
    basePlanHash: 'base-plan:fixture',
    baseDraftFingerprint: 'base-draft:fixture',
    augmentationSeed: 'augmentation-seed:fixture',
    layoutSeed: 'layout-seed:fixture',
    difficulty: 3,
    profileId: 'industrial-supplement-preview-v4',
    profileRevision: 5,
    planningAttempt: 0,
    grantId: 'grant:coverage:a',
    parentRegionId: 'region:parent:a',
    contextSignature: 'context:fixture',
    candidateIndex: 2,
    candidateOrdinal: 4,
    candidateSearchVariant: 7,
    moduleCount: 5,
    elevationMode: 'split-level',
    topologySelection: { selectedId: 'topology:a', legalIds: ['topology:a'] },
    junctionSelection: { selectedId: 'junction:a', legalIds: ['junction:a'] },
    elevationSelection: { selectedId: 'elevation:a', legalIds: ['elevation:a'] },
    candidateElevationModes: ['flat', 'split-level'],
    moduleCapacity: 6,
    solveDecisionOrdinal: 1,
    routeNetworkConflictExclusions: [],
  };
  const key = createRouteNetworkCompletedPlanCacheKey(commonIdentity);
  assert.equal(typeof key, 'string');
  assert.equal(createRouteNetworkCompletedPlanCacheKey({
    routeNetworkConflictExclusions: [],
    solveDecisionOrdinal: commonIdentity.solveDecisionOrdinal,
    moduleCapacity: commonIdentity.moduleCapacity,
    candidateElevationModes: commonIdentity.candidateElevationModes,
    elevationSelection: commonIdentity.elevationSelection,
    junctionSelection: commonIdentity.junctionSelection,
    topologySelection: commonIdentity.topologySelection,
    elevationMode: commonIdentity.elevationMode,
    moduleCount: commonIdentity.moduleCount,
    candidateSearchVariant: commonIdentity.candidateSearchVariant,
    candidateOrdinal: commonIdentity.candidateOrdinal,
    candidateIndex: commonIdentity.candidateIndex,
    contextSignature: commonIdentity.contextSignature,
    parentRegionId: commonIdentity.parentRegionId,
    grantId: commonIdentity.grantId,
    planningAttempt: commonIdentity.planningAttempt,
    profileRevision: commonIdentity.profileRevision,
    profileId: commonIdentity.profileId,
    difficulty: commonIdentity.difficulty,
    layoutSeed: commonIdentity.layoutSeed,
    augmentationSeed: commonIdentity.augmentationSeed,
    baseDraftFingerprint: commonIdentity.baseDraftFingerprint,
    basePlanHash: commonIdentity.basePlanHash,
  }), key, 'canonical property order preserves same-generation hits');

  const sharedCache = new Map([[key, { id: 'seed-a-result' }]]);
  const otherSeedKey = createRouteNetworkCompletedPlanCacheKey({
    ...commonIdentity,
    augmentationSeed: 'augmentation-seed:other',
  });
  assert.notEqual(otherSeedKey, key);
  assert.equal(sharedCache.get(otherSeedKey), undefined);
  assert.equal(sharedCache.get(createRouteNetworkCompletedPlanCacheKey(commonIdentity))?.id,
    'seed-a-result', 'same-seed hit behavior remains unchanged');

  for (const [field, value] of [
    ['basePlanHash', 'base-plan:other'],
    ['baseDraftFingerprint', 'base-draft:other'],
    ['augmentationSeed', 'augmentation-seed:other'],
    ['layoutSeed', 'layout-seed:other'],
    ['difficulty', 4],
    ['profileId', 'profile:other'],
    ['profileRevision', 6],
    ['planningAttempt', 1],
    ['grantId', 'grant:coverage:b'],
    ['parentRegionId', 'region:parent:b'],
    ['contextSignature', 'context:other'],
    ['candidateOrdinal', 5],
    ['candidateSearchVariant', 8],
    ['moduleCapacity', 7],
    ['solveDecisionOrdinal', 2],
  ]) {
    assert.notEqual(createRouteNetworkCompletedPlanCacheKey({
      ...commonIdentity,
      [field]: value,
    }), key, `${field} must isolate the completed-plan memo`);
  }
  const sameGrantExclusion = {
    grantId: commonIdentity.grantId,
    entityKind: 'segment',
    entityId: 'segment:excluded',
    signature: 'signature:excluded',
  };
  assert.notEqual(createRouteNetworkCompletedPlanCacheKey({
    ...commonIdentity,
    routeNetworkConflictExclusions: [sameGrantExclusion],
  }), key, 'same-grant exact exclusions partition completed results');
  assert.equal(createRouteNetworkCompletedPlanCacheKey({
    ...commonIdentity,
    routeNetworkConflictExclusions: [{
      ...sameGrantExclusion,
      grantId: 'grant:unrelated',
    }],
  }), key, 'unrelated-grant exclusions preserve the existing memo contract');
});

test('candidate diagnostics disable only completed-plan memoization, not salvage identity', () => {
  const context = {
    version: 2,
    operationOrdinal: 3,
    solverDepth: 1,
    state: {
      progressionOrder: 8,
      remainingModules: 4,
      acceptedNetworkCount: 2,
    },
    planningAvoidanceVolumes: [],
    connectorVariantRoomFootprints: [],
  };
  const ordinary = createRouteNetworkPlanningCacheContextSignatures(context, {
    completedPlanMemoEnabled: true,
  });
  const diagnostic = createRouteNetworkPlanningCacheContextSignatures(context, {
    completedPlanMemoEnabled: false,
  });
  assert.equal(
    diagnostic.completeCandidateSalvageContextSignature,
    ordinary.completeCandidateSalvageContextSignature,
  );
  assert.equal(
    ordinary.completedPlanMemoContextSignature,
    ordinary.completeCandidateSalvageContextSignature,
  );
  assert.equal(diagnostic.completedPlanMemoContextSignature, null);
});

test('route planning timing instrumentation remains outside memo eligibility', () => {
  const plannerSource = readFileSync(
    new URL('../src/dungeon-augmentation/planner.js', import.meta.url),
    'utf8',
  );
  const memoEligibility = plannerSource.match(
    /const completedPlanMemoEnabled = routeNetworkPlanResultCache instanceof Map[\s\S]*?__DUNGEON_AUGMENTATION_ROUTE_CANDIDATE_DEBUG__ !== true;/,
  )?.[0] ?? '';
  assert.ok(memoEligibility);
  assert.doesNotMatch(
    memoEligibility,
    /__DUNGEON_AUGMENTATION_ROUTE_PLANNING_TIMING_SINK__/,
  );
  assert.match(
    plannerSource,
    /completedPlanMemoEligible: Boolean\(completedPlanMemoKey\),\s*completedPlanMemoHit,\s*physicalTimingSource: completedPlanMemoHit \? 'memoized-plan' : 'current-frame'/,
  );
  assert.match(
    plannerSource,
    /try \{[\s\S]*?routePlanningTimingSink\(Object\.freeze\([\s\S]*?\}\s*catch \{\s*\/\/ Profiling must never participate in planner correctness\./,
  );
  assert.match(
    plannerSource,
    /const finalCandidateError = planned\?\.error \?\? null;[\s\S]*?rawPlanError,[\s\S]*?finalCandidateError,[\s\S]*?error: finalCandidateError/,
  );
  assert.doesNotMatch(plannerSource, /promotedSalvage|promotedCandidateLocalSalvage/);
});

test('complete salvage witnesses support Map-bearing planner nodes and retain replacements', () => {
  const witness = (variant, x) => ({
    operation: {
      id: 'operation:fixture',
      grantId: 'grant:fixture',
      parentRegionId: 'region:fixture',
      routeNetworkKind: 'objective-route-coverage',
      endpointSocketIds: ['socket:parent'],
    },
    nodes: [{
      id: `node:${variant}`,
      kind: 'supplementRoom',
      placement: { position: { x, y: 0, z: 1 }, rotationQuarterTurns: 0 },
      sockets: [],
      socketIdByLocalId: new Map([['west', `node:${variant}:socket:west`]]),
    }],
    segments: [{
      id: `segment:${variant}`,
      kind: 'supplementRouteSegment',
      path: [{ x: 0, y: 0, z: 0 }, { x, y: 0, z: 1 }],
    }],
  });
  const first = witness('a', 2);
  const renumberedDuplicateFirst = witness('renumbered-a', 2);
  const replacement = witness('b', 4);
  assert.equal(
    typeof createRouteNetworkCompleteSalvageWitnessPhysicalSignature(first),
    'string',
    'planner-only Map indexes must not enter canonical witness serialization',
  );
  let collection = mergeRouteNetworkCompleteSalvageWitnessCollection([], first);
  collection = mergeRouteNetworkCompleteSalvageWitnessCollection(
    collection,
    renumberedDuplicateFirst,
  );
  collection = mergeRouteNetworkCompleteSalvageWitnessCollection(
    collection,
    replacement,
  );
  assert.deepEqual(collection, [first, replacement]);
});

test('cold exact-conflict replay cannot synthesize an unpaid salvage witness', () => {
  assert.deepEqual(
    mergeRouteNetworkCompleteSalvageWitnessCollection([], {
      error: 'route-network-conflicting-entity-excluded',
    }),
    [],
  );
});

test('non-partial plans retain the ordinary schedule despite exact conflicts', () => {
  const ordinary = [0, 1, 2].map((candidateIndex) => ({ candidateIndex }));
  for (const options of [{
    allowPartialRouteNetworkRealization: true,
    routeNetworkKind: 'objective-route-coverage',
    required: false,
    hasConflictExclusions: false,
  }, {
    allowPartialRouteNetworkRealization: false,
    routeNetworkKind: 'objective-route-coverage',
    required: true,
  }]) {
    assert.deepEqual(
      createRouteNetworkPartialFirstCandidateSchedule(ordinary, options),
      ordinary,
    );
  }
});

test('deferred coverage suffixes choose the least-served class with FIFO ties', () => {
  const suffixes = [
    { id: 'op2-state-a', suffixClassKey: '2:1' },
    { id: 'op2-state-b', suffixClassKey: '2:1' },
    { id: 'op4-state-a', suffixClassKey: '4:1' },
    { id: 'op3-state-a', suffixClassKey: '3:2' },
  ];
  assert.equal(selectDeferredRouteNetworkCoverageSuffixIndex(
    suffixes,
    new Map([
      ['2:1', 1],
      ['4:1', 0],
      ['3:2', 0],
    ]),
  ), 2, 'the first queued class with the lowest dequeue count wins');
  assert.equal(selectDeferredRouteNetworkCoverageSuffixIndex(
    suffixes,
    new Map([
      ['2:1', 1],
      ['4:1', 1],
      ['3:2', 0],
    ]),
  ), 3);
  assert.equal(selectDeferredRouteNetworkCoverageSuffixIndex([], new Map()), -1);
});

test('deferred coverage suffixes preserve the strongest accepted-required anchor first', () => {
  const suffixes = [
    {
      id: 'landmark-only',
      suffixClassKey: '2:1',
      acceptedRequiredNetworkCount: 1,
    },
    {
      id: 'landmark-plus-coverage',
      suffixClassKey: '4:1',
      acceptedRequiredNetworkCount: 2,
    },
    {
      id: 'later-equal-anchor',
      suffixClassKey: '3:1',
      acceptedRequiredNetworkCount: 2,
    },
  ];
  assert.equal(selectDeferredRouteNetworkCoverageSuffixIndex(
    suffixes,
    new Map([
      ['2:1', 0],
      ['4:1', 3],
      ['3:1', 3],
    ]),
  ), 1, 'anchor completeness precedes class dequeue count and FIFO breaks the tie');
});

test('accepted prune checkpoint follows the complete modular replacement window', () => {
  const runSchedule = (checkpointSolution) => {
    const calls = [];
    const schedule = createRouteNetworkPartialFirstCandidateSchedule([
      { candidateIndex: 0, label: 'cheap-first' },
      { candidateIndex: 1, label: 'alternate-family' },
      { candidateIndex: 2, label: 'alternate-elevation' },
      { candidateIndex: 3, label: 'compact-modular-substitute' },
      { candidateIndex: 4, label: 'expensive-later' },
    ], {
      allowPartialRouteNetworkRealization: true,
      routeNetworkKind: 'objective-route-coverage',
      required: true,
    });
    const retentionUpperBound = routeNetworkPartialBranchRetentionUpperBound({
      acceptedGrantOrdinals: [0],
      remainingOperationOrdinals: [1, 2, 3, 4, 5],
      requiredOperationOrdinals: REQUIRED_ORDINALS,
      requiredCoverageOperationOrdinals: COVERAGE_ORDINALS,
    });
    for (const entry of schedule) {
      if (entry.partialFirstCheckpoint) {
        calls.push('prune-checkpoint');
        const accepted = evaluateRouteNetworkPartialPreRecoveryAcceptance(
          checkpointSolution,
          {
            requiredOperationOrdinals: REQUIRED_ORDINALS,
            requiredCoverageOperationOrdinals: COVERAGE_ORDINALS,
            requiredLandmarkOperationOrdinals: LANDMARK_ORDINALS,
            preferredRequiredNetworkCount: 2,
            requireCoverage: true,
            requireLandmark: true,
            retentionUpperBound,
          },
        ).accepted;
        if (accepted) break;
        continue;
      }
      calls.push(entry.label);
    }
    return calls;
  };

  assert.deepEqual(runSchedule({
    operations: [{ id: 'landmark' }, { id: 'coverage' }],
    acceptedGrantOrdinals: [0, 2],
    acceptedNetworkCount: 2,
    prunedRouteNetworkGrants: [{ operationOrdinal: 1 }],
  }), [
    'cheap-first',
    'alternate-family',
    'alternate-elevation',
    'compact-modular-substitute',
    'expensive-later',
    'prune-checkpoint',
  ]);

  assert.deepEqual(runSchedule({
    operations: [{ id: 'landmark' }],
    acceptedGrantOrdinals: [0],
    acceptedNetworkCount: 1,
    prunedRouteNetworkGrants: [{ operationOrdinal: 1 }],
  }), [
    'cheap-first',
    'alternate-family',
    'alternate-elevation',
    'compact-modular-substitute',
    'expensive-later',
    'prune-checkpoint',
  ]);
});

test('deferred provisional forest validation preserves identity, bags, and RNG state', () => {
  const fixture = createCandidateLocalProvisionalSalvageFixture();
  const validated = validateDeferredProvisionalSalvageFixture(fixture, {
    candidateIndex: 4,
    candidateOrdinal: 73,
  });

  assert.equal(validated.accepted, true);
  assert.equal(validated.error, null);
  assert.equal(validated.isolatedDependencyValidated, true);
  assert.equal(validated.proposal.candidateIndex, 4);
  assert.equal(validated.proposal.candidateOrdinal, 73);
  assert.equal(validated.proposal.sourceFullNodeCount, 2);
  assert.equal(
    validated.proposal.planned.operation.realizationMode,
    'parent-anchored-forest',
  );
  assert.deepEqual(
    validated.proposal.planned.nodes.map(({ id }) => id),
    ['node:root'],
  );
  assert.deepEqual(
    validated.proposal.planned.segments.map(({ id }) => id),
    ['segment:parent'],
  );
  assert.deepEqual(
    validated.proposal.planned.routeNetworkEntityOmissions.map((omission) => ({
      entityKind: omission.entityKind,
      entityId: omission.entityId,
      disposition: omission.disposition,
      rootSignature: omission.rootSignature,
    })),
    [{
      entityKind: 'node',
      entityId: 'node:isolated',
      disposition: 'dependency',
      rootSignature: fixture.exactFailureRoot.signature,
    }, {
      entityKind: 'segment',
      entityId: 'segment:conflict',
      disposition: 'conflict-root',
      rootSignature: fixture.exactFailureRoot.signature,
    }],
  );
  assert.equal(
    Object.hasOwn(validated.proposal.planned, 'provisionalWitnessOnly'),
    false,
  );
  assert.equal(
    [...validated.proposal.planned.nodes, ...validated.proposal.planned.segments]
      .some((entity) => entity.planningOnly === true
        || entity.provisionalUnanchoredDependency === true
        || entity.connectorVariant === 'structural-span-conflict-root-v1'),
    false,
  );
  assert.strictEqual(validated.proposal.planned.selectionBags, fixture.selectionBags);
  assert.strictEqual(validated.proposal.planned.random, fixture.planned.random);
  assert.equal(fixture.randomCallCount(), 0);
});

test('candidate-local provisional salvage requires the complete validator', () => {
  const fixture = createCandidateLocalProvisionalSalvageFixture();
  const validated = validateDeferredProvisionalSalvageFixture(fixture);

  assert.equal(validated.accepted, true);
  assert.equal(validated.proposal.planned.error, undefined);
  assert.equal(validated.proposal.planned.operation.realizationMode, 'parent-anchored-forest');
});

test('candidate-local provisional salvage cannot retain an exact external exclusion', () => {
  const fixture = createCandidateLocalProvisionalSalvageFixture();
  const baseline = validateDeferredProvisionalSalvageFixture(fixture);
  assert.equal(baseline.accepted, true);
  const retainedNode = baseline.proposal.planned.nodes[0];
  const externalExclusion = {
    grantId: fixture.grantId,
    entityKind: 'node',
    entityId: retainedNode.id,
    signature: createRouteNetworkConflictEntitySignature(retainedNode, 'node'),
    reason: 'route-network-runtime-physical-validation-failed',
  };

  const rejected = validateDeferredProvisionalRouteNetworkSalvage({
    completePlanned: fixture.completePlanned,
    candidateIndex: 4,
    candidateOrdinal: 73,
    grantId: fixture.grantId,
    reusableRouteNetworkConflictExclusions: [externalExclusion],
  });

  assert.equal(rejected.accepted, false);
  assert.equal(
    rejected.error,
    'route-network-conflict-salvage-retains-excluded-entity',
  );
  assert.deepEqual(rejected.context, {
    grantId: fixture.grantId,
    entityKind: 'node',
    entityId: retainedNode.id,
    matchedEntityId: retainedNode.id,
    signature: externalExclusion.signature,
  });
});

test('deferred provisional validation rejects ambiguous roots and invalid retained witnesses', () => {
  const duplicateFixture = createCandidateLocalProvisionalSalvageFixture();
  duplicateFixture.completePlanned.provisionalParentAnchoredSalvageWitness
    .exactFailureRoots.push({
      ...duplicateFixture.exactFailureRoot,
      entityId: 'segment:duplicate-ordinal-evidence',
    });
  assert.equal(validateDeferredProvisionalSalvageFixture(duplicateFixture).error,
    'route-network-conflict-salvage-root-ambiguous');

  const malformedFixture = createCandidateLocalProvisionalSalvageFixture();
  delete malformedFixture.completePlanned.provisionalParentAnchoredSalvageWitness
    .exactFailureRoots[0].signature;
  assert.equal(validateDeferredProvisionalSalvageFixture(malformedFixture).accepted, false);

  const markerFixture = createCandidateLocalProvisionalSalvageFixture();
  markerFixture.planned.nodes[0].planningOnly = true;
  assert.equal(validateDeferredProvisionalSalvageFixture(markerFixture).error,
    'route-network-conflict-salvage-planning-marker-retained');

  const dependencyFixture = createCandidateLocalProvisionalSalvageFixture();
  dependencyFixture.isolatedRootDependencyWitness.dependencies[0].nodeId = 'node:root';
  assert.equal(validateDeferredProvisionalSalvageFixture(dependencyFixture).error,
    'route-network-isolated-dependency-node-retained');

  const missingWitnessFixture = createCandidateLocalProvisionalSalvageFixture();
  missingWitnessFixture.completePlanned.provisionalParentAnchoredSalvageWitness
    .isolatedRootDependencyWitness = null;
  assert.equal(validateDeferredProvisionalSalvageFixture(missingWitnessFixture).error,
    'route-network-isolated-dependency-witness-missing');

  const spoofedRootFixture = createCandidateLocalProvisionalSalvageFixture();
  spoofedRootFixture.completePlanned.provisionalParentAnchoredSalvageWitness
    .exactFailureRoots[0].entityId = 'segment:nonexistent-spoof';
  assert.equal(validateDeferredProvisionalSalvageFixture(spoofedRootFixture).error,
    'route-network-proposal-local-root-omission-missing');
});

test('salvage proposal validation fails open on missing or unauthorized root omissions', () => {
  const fixture = createCandidateLocalProvisionalSalvageFixture();
  const validated = validateDeferredProvisionalSalvageFixture(fixture);
  assert.equal(validated.accepted, true);

  const missing = validateRouteNetworkConflictSalvageProposal({
    proposal: {
      ...validated.proposal,
      planned: {
        ...validated.proposal.planned,
        routeNetworkEntityOmissions:
          validated.proposal.planned.routeNetworkEntityOmissions.filter((omission) => (
            omission.disposition !== 'conflict-root'
          )),
      },
    },
    grantId: fixture.grantId,
  });
  assert.equal(missing.accepted, false);
  assert.equal(missing.error, 'route-network-proposal-local-root-omission-missing');

  const unauthorized = validateRouteNetworkConflictSalvageProposal({
    proposal: {
      ...validated.proposal,
      planned: {
        ...validated.proposal.planned,
        routeNetworkEntityOmissions:
          validated.proposal.planned.routeNetworkEntityOmissions.map((omission) => (
            omission.disposition === 'conflict-root'
              ? { ...omission, rootSignature: 'v1-unauthorized' }
              : omission
          )),
      },
    },
    grantId: fixture.grantId,
  });
  assert.equal(unauthorized.accepted, false);
  assert.equal(unauthorized.error, 'route-network-proposal-local-root-omission-missing');
});

test('a fully validated provisional forest replaces its failed candidate locally', () => {
  const fixture = createCandidateLocalProvisionalSalvageFixture();
  let laterPlannerCallCount = 0;
  const validated = validateDeferredProvisionalSalvageFixture(fixture);
  const accepted = validated.accepted
    ? validated.proposal.planned
    : (() => {
        laterPlannerCallCount += 1;
        return { operation: { id: 'later-ordinary-success' } };
      })();
  assert.equal(accepted.operation.realizationMode, 'parent-anchored-forest');
  assert.equal(laterPlannerCallCount, 0);

  const plannerSource = readFileSync(
    new URL('../src/dungeon-augmentation/planner.js', import.meta.url),
    'utf8',
  );
  assert.match(
    plannerSource,
    /const salvageWitnesses = mergeRouteNetworkCompleteSalvageWitnessCollection[\s\S]*?createParentAnchoredRouteNetworkSalvage[\s\S]*?cacheConflictSalvageProposal\([\s\S]*?planned = rejectedPlanned/,
  );
  assert.match(
    plannerSource,
    /validateDeferredProvisionalRouteNetworkSalvage\([\s\S]*?planned = provisionalSalvageValidation\.proposal\.planned/,
  );
});
