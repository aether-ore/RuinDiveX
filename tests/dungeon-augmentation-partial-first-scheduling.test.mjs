import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRouteNetworkPartialFirstCandidateSchedule,
  evaluateRouteNetworkPartialPreRecoveryAcceptance,
  routeNetworkPartialBranchRetentionUpperBound,
  routeNetworkSolutionRetainsAllRequiredGrants,
  selectDeferredRouteNetworkCoverageSuffixIndex,
  selectPreferredParentAnchoredRouteNetworkSalvageProposal,
} from '../src/dungeon-augmentation/planner.js';
import { DUNGEON_AUGMENTATION_PROFILES } from '../src/dungeon-augmentation/catalog.js';

const REQUIRED_ORDINALS = new Set([0, 1, 2, 3, 4, 5]);
const COVERAGE_ORDINALS = new Set([1, 2, 3, 4, 5]);
const LANDMARK_ORDINALS = new Set([0]);

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
      'deferred-blocked-future',
      'terminal-exact-conflict-salvage',
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
