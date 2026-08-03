import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRouteNetworkConflictEntitySignature,
  normalizeRouteNetworkConflictExclusions,
  rejectRouteNetworkCandidateForConflictExclusions,
} from '../src/dungeon-augmentation/routeNetworkModulePruning.js';
import {
  collectRouteNetworkFinalValidationExactConflictAttribution,
  omitConflictingRouteNetworkOperation,
  recoverRouteNetworkFinalValidationExactConflicts,
  routeNetworkConflictExclusionPruneRefusal,
} from '../src/dungeon-augmentation/planner.js';

const grantId = 'grant:coverage';
const operationId = 'operation:coverage';

function candidate({ nodeX = 0, segmentMidX = 2.8 } = {}) {
  const node = {
    id: 'node:ordinal:2',
    operationId,
    kind: 'supplementRoom',
    grammarId: 'industrial-switchback-room',
    moduleTemplateId: 'switchback-room-v1',
    contentRole: 'challenge',
    placement: { center: { x: nodeX, y: 0, z: 0 }, rotationQuarterTurns: 1 },
    size: { x: 14, y: 5.6, z: 14 },
    sockets: [{
      id: 'node:ordinal:2:socket:entry',
      localSocketId: 'entry',
      position: { x: nodeX - 7, y: 0, z: 0 },
      facing: { x: -1, y: 0, z: 0 },
    }],
  };
  const segment = {
    id: 'segment:ordinal:3',
    operationId,
    kind: 'route-network-segment',
    routeRole: 'content-wing',
    connectorFamily: 'service-gallery',
    from: { nodeId: 'node:junction', socketId: 'junction:north' },
    to: { nodeId: node.id, socketId: 'node:ordinal:2:socket:entry' },
    path: [
      { x: 0, y: 0, z: 0 },
      { x: segmentMidX, y: 0, z: 0 },
      { x: nodeX - 7, y: 0, z: 0 },
    ],
  };
  return {
    operation: { id: operationId, type: 'routeNetwork', grantId },
    nodes: [node],
    segments: [segment],
  };
}

test('an exact conflicting room placement rejects only that bounded candidate', () => {
  const planned = candidate();
  const exclusion = {
    grantId,
    entityKind: 'node',
    entityId: planned.nodes[0].id,
    signature: createRouteNetworkConflictEntitySignature(planned.nodes[0], 'node'),
    reason: 'synthetic-room-conflict',
  };

  const rejected = rejectRouteNetworkCandidateForConflictExclusions(planned, [exclusion]);
  assert.equal(rejected.error, 'route-network-conflicting-entity-excluded');
  assert.deepEqual(rejected.context.excludedEntities, [exclusion]);

  const replacement = candidate({ nodeX: 22.4 });
  assert.equal(
    rejectRouteNetworkCandidateForConflictExclusions(replacement, [exclusion]),
    replacement,
    'a replacement at a different exact placement must remain eligible',
  );
});

test('a finalized node exclusion rejects the same raw planner node after transient fields change', () => {
  const rawPlanned = candidate();
  rawPlanned.nodes[0].socketIdByLocalId = new Map([
    ['entry', rawPlanned.nodes[0].sockets[0].id],
  ]);
  rawPlanned.nodes[0].progressionOrder = 17;
  const finalizedNode = { ...rawPlanned.nodes[0] };
  delete finalizedNode.socketIdByLocalId;
  finalizedNode.progressionOrder = 0;
  const exclusion = {
    grantId,
    entityKind: 'node',
    entityId: finalizedNode.id,
    signature: createRouteNetworkConflictEntitySignature(finalizedNode, 'node'),
    reason: 'synthetic-finalized-node-conflict',
  };

  assert.equal(
    rejectRouteNetworkCandidateForConflictExclusions(rawPlanned, [exclusion]).error,
    'route-network-conflicting-entity-excluded',
  );

  const physicallyChanged = candidate({ nodeX: 22.4 });
  physicallyChanged.nodes[0].socketIdByLocalId = new Map([
    ['entry', physicallyChanged.nodes[0].sockets[0].id],
  ]);
  physicallyChanged.nodes[0].progressionOrder = 99;
  assert.equal(
    rejectRouteNetworkCandidateForConflictExclusions(physicallyChanged, [exclusion]),
    physicallyChanged,
    'the same ordinal ID at a different physical placement must remain eligible',
  );
});

test('a physical conflict rejects the same module under a different ordinal entity ID', () => {
  const planned = candidate();
  const exclusion = {
    grantId,
    entityKind: 'node',
    entityId: 'node:previous-candidate-ordinal',
    signature: createRouteNetworkConflictEntitySignature(planned.nodes[0], 'node'),
    reason: 'synthetic-renumbered-room-conflict',
  };

  const rejected = rejectRouteNetworkCandidateForConflictExclusions(planned, [exclusion]);
  assert.equal(rejected.error, 'route-network-conflicting-entity-excluded');
  assert.deepEqual(rejected.context.excludedEntities, [exclusion]);

  const physicallyDifferent = candidate({ nodeX: 22.4 });
  assert.equal(
    rejectRouteNetworkCandidateForConflictExclusions(physicallyDifferent, [exclusion]),
    physicallyDifferent,
  );
});

test('physical Map and Set fields have deterministic conflict signatures', () => {
  const first = {
    ...candidate().nodes[0],
    structure: {
      physicalLookup: new Map([
        ['second', new Set(['south', 'north'])],
        ['first', { clearance: 2.8 }],
      ]),
    },
  };
  const reordered = {
    ...candidate().nodes[0],
    structure: {
      physicalLookup: new Map([
        ['first', { clearance: 2.8 }],
        ['second', new Set(['north', 'south'])],
      ]),
    },
  };
  const changed = {
    ...reordered,
    structure: {
      physicalLookup: new Map([
        ['first', { clearance: 5.6 }],
        ['second', new Set(['north', 'south'])],
      ]),
    },
  };

  assert.equal(
    createRouteNetworkConflictEntitySignature(first, 'node'),
    createRouteNetworkConflictEntitySignature(reordered, 'node'),
  );
  assert.notEqual(
    createRouteNetworkConflictEntitySignature(first, 'node'),
    createRouteNetworkConflictEntitySignature(changed, 'node'),
  );
});

test('an exact conflicting segment path rejects only that path realization', () => {
  const planned = candidate();
  const exclusion = {
    grantId,
    entityKind: 'segment',
    entityId: planned.segments[0].id,
    signature: createRouteNetworkConflictEntitySignature(planned.segments[0], 'segment'),
    reason: 'synthetic-segment-conflict',
  };

  assert.equal(
    rejectRouteNetworkCandidateForConflictExclusions(planned, [exclusion]).error,
    'route-network-conflicting-entity-excluded',
  );
  const replacement = candidate({ segmentMidX: 5.6 });
  assert.equal(
    rejectRouteNetworkCandidateForConflictExclusions(replacement, [exclusion]),
    replacement,
  );
});

test('node conflict signatures cover junction and authored structure realization data', () => {
  const node = {
    ...candidate().nodes[0],
    junction: {
      junctionKind: 'through-t',
      activeSocketIds: ['entry', 'north', 'south'],
      clearCoreVolume: {
        id: 'junction:clear-core',
        center: { x: 0, y: 2.8, z: 0 },
        size: { x: 8.4, y: 5.6, z: 8.4 },
      },
    },
    structure: {
      blueprintId: 'industrial-switchback-room-v1',
      floorTiers: [{ id: 'base', elevation: 0, cells: [{ x: 0, z: 0 }] }],
      collisionVolumes: [{
        id: 'room:blocker',
        center: { x: 2.8, y: 1.4, z: 0 },
        size: { x: 2.8, y: 2.8, z: 2.8 },
      }],
    },
  };
  const baseline = createRouteNetworkConflictEntitySignature(node, 'node');
  assert.notEqual(createRouteNetworkConflictEntitySignature({
    ...node,
    junction: { ...node.junction, junctionKind: 'four-way' },
  }, 'node'), baseline);
  assert.notEqual(createRouteNetworkConflictEntitySignature({
    ...node,
    structure: {
      ...node.structure,
      collisionVolumes: [{
        ...node.structure.collisionVolumes[0],
        center: { x: 5.6, y: 1.4, z: 0 },
      }],
    },
  }, 'node'), baseline);
  assert.equal(createRouteNetworkConflictEntitySignature({
    ...node,
    planningParentLocalSocketId: 'planner-only-alternate',
    plannedMinimumGraphDegree: 99,
    searchVariant: 17,
    anchors: [{ id: 'logical-anchor', kind: 'reward' }],
    runtimeStateIds: ['logical-runtime-state'],
    themeBinding: { themeRef: { id: 'logical-theme' } },
    accessDomainId: 'logical-access-domain',
    progressionBandId: 99,
  }, 'node'), baseline, 'solver-only replay bookkeeping must not change physical identity');
});

test('segment conflict signatures cover seams, landings, and shortcut realization data', () => {
  const segment = {
    ...candidate().segments[0],
    endpointSeams: [{
      id: 'segment:ordinal:3:from-seam',
      socketId: 'junction:north',
      orderedCells: [{ id: 'seam:cell:0', lane: 0, signedDepthTiles: 0, gridX: 0, gridZ: 0 }],
    }],
    landings: [{
      id: 'segment:ordinal:3:from-landing',
      position: { x: 0, y: 0, z: 0 },
      flat: true,
    }],
    landingVolumes: [{
      id: 'segment:ordinal:3:from-landing-volume',
      center: { x: 0, y: 1.4, z: 0 },
      size: { x: 8.4, y: 2.8, z: 8.4 },
    }],
    shortcut: {
      kind: 'shortcut-lift',
      runtimeStateId: 'shortcut:state:1',
      bidirectional: true,
    },
  };
  const baseline = createRouteNetworkConflictEntitySignature(segment, 'segment');
  assert.notEqual(createRouteNetworkConflictEntitySignature({
    ...segment,
    endpointSeams: [{
      ...segment.endpointSeams[0],
      orderedCells: [{ ...segment.endpointSeams[0].orderedCells[0], gridX: 1 }],
    }],
  }, 'segment'), baseline);
  assert.notEqual(createRouteNetworkConflictEntitySignature({
    ...segment,
    landings: [{
      ...segment.landings[0],
      position: { x: 2.8, y: 0, z: 0 },
    }],
  }, 'segment'), baseline);
  assert.notEqual(createRouteNetworkConflictEntitySignature({
    ...segment,
    shortcut: { ...segment.shortcut, bidirectional: false },
  }, 'segment'), baseline);
  assert.equal(createRouteNetworkConflictEntitySignature({
    ...segment,
    runtimeStateIds: ['logical-runtime-state'],
    requiredCredentialIds: ['logical-keycard'],
    presentationVariantId: 'logical-presentation-variant',
    themeBinding: { themeRef: { id: 'logical-theme' } },
  }, 'segment'), baseline);
});

test('conflict exclusions canonicalize without allowing ID-only bans', () => {
  assert.deepEqual(normalizeRouteNetworkConflictExclusions([
    { grantId, kind: 'node', nodeId: 'node:2', signature: 'sig:b', reason: 'z' },
    { grantId, kind: 'node', nodeId: 'node:2', signature: 'sig:b', reason: 'a' },
    { grantId, kind: 'node', nodeId: 'node:9', signature: 'sig:b', reason: 'different-evidence' },
    { grantId, kind: 'segment', segmentId: 'segment:1', signature: 'sig:a' },
    { grantId, kind: 'node', nodeId: 'node:unsafe-id-only' },
  ]), [{
    grantId,
    entityKind: 'node',
    entityId: 'node:2',
    signature: 'sig:b',
    reason: 'a',
  }, {
    grantId,
    entityKind: 'segment',
    entityId: 'segment:1',
    signature: 'sig:a',
    reason: 'route-network-runtime-physical-conflict',
  }]);
});

test('whole-grant recovery protects exact-exclusion grants but can omit an unrelated grant', () => {
  const protectedGrantId = 'grant:protected';
  const unrelatedGrantId = 'grant:unrelated';
  const protectedOperationId = 'operation:protected';
  const unrelatedOperationId = 'operation:unrelated';
  const conflictExclusion = {
    grantId: protectedGrantId,
    entityKind: 'node',
    entityId: 'node:protected:prior-candidate',
    signature: 'physical-signature:protected',
    reason: 'synthetic-exact-conflict',
  };
  const plan = {
    operations: [{
      id: protectedOperationId,
      type: 'routeNetwork',
      grantId: protectedGrantId,
    }, {
      id: unrelatedOperationId,
      type: 'routeNetwork',
      grantId: unrelatedGrantId,
    }],
    nodes: [{ id: 'node:protected', operationId: protectedOperationId }, {
      id: 'node:unrelated', operationId: unrelatedOperationId,
    }],
    segments: [],
    routeNetworkConflictExclusions: [conflictExclusion],
  };
  const profile = {
    routeNetworkPlanning: { allowPartialRouteNetworkRealization: true },
  };
  const extensionRegions = [{
    id: 'region:one',
    routeNetworkGrants: [{
      id: protectedGrantId,
      kind: 'objective-route-coverage',
      required: true,
    }, {
      id: unrelatedGrantId,
      kind: 'objective-route-coverage',
      required: true,
    }],
  }];

  assert.deepEqual(
    routeNetworkConflictExclusionPruneRefusal(
      protectedGrantId,
      [conflictExclusion],
    ),
    {
      error: 'route-network-conflict-exclusion-replacements-exhausted',
      grantId: protectedGrantId,
      conflictExclusionCount: 1,
      entityKinds: ['node'],
    },
  );
  assert.equal(
    routeNetworkConflictExclusionPruneRefusal(
      unrelatedGrantId,
      [conflictExclusion],
    ),
    null,
  );
  assert.equal(omitConflictingRouteNetworkOperation(
    plan,
    {
      accepted: false,
      errors: [{ code: 'synthetic-conflict', context: { nodeId: 'node:protected' } }],
    },
    profile,
    extensionRegions,
  ), null, 'post-validation recovery must not whole-prune the protected grant');

  assert.deepEqual(omitConflictingRouteNetworkOperation(
    plan,
    {
      accepted: false,
      errors: [{ code: 'synthetic-conflict', context: { nodeId: 'node:unrelated' } }],
    },
    profile,
    extensionRegions,
  )?.omission, {
    operationId: unrelatedOperationId,
    grantId: unrelatedGrantId,
    reason: 'route-network-validation-synthetic-conflict',
    validationErrorCodes: ['synthetic-conflict'],
  });
});

test('final validation exact node conflict retries the same candidate attempt and keeps its grant', () => {
  const protectedGrantId = 'grant:final-validation-node';
  const protectedOperationId = 'operation:final-validation-node';
  const conflictingNode = {
    id: 'node:final-validation-conflict',
    operationId: protectedOperationId,
    kind: 'supplementRoom',
    grammarId: 'industrial-switchback-room',
    placement: {
      center: { x: 0, y: 0, z: 0 },
      rotationQuarterTurns: 0,
    },
    size: { x: 14, y: 5.6, z: 14 },
    occupiedVolumes: [{
      id: 'node:final-validation-conflict:occupied',
      center: { x: 0, y: 2.8, z: 0 },
      size: { x: 14, y: 5.6, z: 14 },
    }],
  };
  const initialPlan = {
    augmentationPlanHash: 'augmentation:final-validation-node-conflict',
    operations: [{
      id: protectedOperationId,
      type: 'routeNetwork',
      grantId: protectedGrantId,
      routeNetworkKind: 'objective-route-coverage',
    }],
    nodes: [conflictingNode],
    segments: [],
  };
  const replacementNode = {
    ...conflictingNode,
    placement: {
      ...conflictingNode.placement,
      center: { x: 28, y: 0, z: 0 },
    },
    occupiedVolumes: [{
      ...conflictingNode.occupiedVolumes[0],
      center: { x: 28, y: 2.8, z: 0 },
    }],
  };
  let replanCount = 0;
  const result = recoverRouteNetworkFinalValidationExactConflicts({
    candidatePlan: initialPlan,
    validation: {
      accepted: false,
      errors: [{
        code: 'supplement-overlaps-base-draft',
        context: {
          nodeId: conflictingNode.id,
          baseVolumeId: 'base:immutable-room',
        },
      }],
    },
    replan: (conflictExclusions, { recoveryPass, additions }) => {
      replanCount += 1;
      assert.equal(recoveryPass, 1);
      assert.deepEqual(additions, conflictExclusions);
      return {
        plan: {
          ...initialPlan,
          augmentationPlanHash: 'augmentation:final-validation-node-replacement',
          routeNetworkConflictExclusions: conflictExclusions,
          nodes: [replacementNode],
        },
      };
    },
    validate: (replacementPlan) => ({
      accepted: replacementPlan.nodes[0].placement.center.x === 28,
      errors: [],
      warnings: [],
    }),
  });

  const expectedExclusion = {
    grantId: protectedGrantId,
    entityKind: 'node',
    entityId: conflictingNode.id,
    signature: createRouteNetworkConflictEntitySignature(conflictingNode, 'node'),
    reason: 'route-network-final-validation-supplement-overlaps-base-draft',
  };
  assert.equal(replanCount, 1);
  assert.equal(result.exactConflictDetected, true);
  assert.equal(result.recovered, true);
  assert.equal(result.exhausted, false);
  assert.equal(result.plan.nodes[0], replacementNode);
  assert.equal(result.plan.operations[0].grantId, protectedGrantId);
  assert.deepEqual(result.conflictExclusions, [expectedExclusion]);
  assert.deepEqual(result.failedRouteNetworkGrants, [{
    grantId: protectedGrantId,
    augmentationOperationId: protectedOperationId,
    routeNetworkKind: 'objective-route-coverage',
    connectionIds: [],
    roomIds: [conflictingNode.id],
    socketIds: [],
    failureKinds: ['supplement-overlaps-base-draft'],
  }]);
});

test('final validation exact segment exhaustion stays structured and cannot whole-prune its grant', () => {
  const protectedGrantId = 'grant:final-validation-segment';
  const protectedOperationId = 'operation:final-validation-segment';
  const unrelatedGrantId = 'grant:unrelated-final-validation';
  const unrelatedOperationId = 'operation:unrelated-final-validation';
  const conflictingSegment = {
    id: 'segment:final-validation-conflict',
    operationId: protectedOperationId,
    kind: 'route-network-segment',
    connectorFamily: 'service-gallery',
    routeRole: 'objective-route-coverage:spine',
    from: { nodeId: 'authored:a', socketId: 'socket:a' },
    to: { nodeId: 'node:protected', socketId: 'socket:entry' },
    path: [
      { x: 0, y: 0, z: 0 },
      { x: 8.4, y: 0, z: 0 },
    ],
  };
  const plan = {
    augmentationPlanHash: 'augmentation:final-validation-segment-conflict',
    operations: [{
      id: protectedOperationId,
      type: 'routeNetwork',
      grantId: protectedGrantId,
      routeNetworkKind: 'objective-route-coverage',
    }, {
      id: unrelatedOperationId,
      type: 'routeNetwork',
      grantId: unrelatedGrantId,
      routeNetworkKind: 'objective-route-coverage',
    }],
    nodes: [{ id: 'node:protected', operationId: protectedOperationId }, {
      id: 'node:unrelated', operationId: unrelatedOperationId,
    }],
    segments: [conflictingSegment],
  };
  const validation = {
    accepted: false,
    errors: [{
      code: 'route-network-segment-base-overlap-outside-landing-grant',
      context: {
        segmentId: conflictingSegment.id,
        baseVolumeId: 'base:immutable-corridor',
      },
    }],
  };
  const result = recoverRouteNetworkFinalValidationExactConflicts({
    candidatePlan: plan,
    validation,
    replan: () => ({
      error: 'route-network-conflict-exclusion-replacements-exhausted',
      context: { grantId: protectedGrantId },
    }),
    validate: () => assert.fail('an exhausted replan must not be validated'),
  });

  const expectedExclusion = {
    grantId: protectedGrantId,
    entityKind: 'segment',
    entityId: conflictingSegment.id,
    signature: createRouteNetworkConflictEntitySignature(
      conflictingSegment,
      'segment',
    ),
    reason: 'route-network-final-validation-route-network-segment-base-overlap-outside-landing-grant',
  };
  assert.equal(result.recovered, false);
  assert.equal(result.exhausted, true);
  assert.equal(
    result.exhaustionReason,
    'route-network-conflict-exclusion-replacements-exhausted',
  );
  assert.deepEqual(result.conflictExclusions, [expectedExclusion]);
  assert.deepEqual(result.routeNetworkGrantIds, [protectedGrantId, unrelatedGrantId]);
  assert.equal(result.routeNetworkEntityCount, 3);
  assert.equal(
    result.rejectedAugmentationPlanHash,
    'augmentation:final-validation-segment-conflict',
  );
  assert.deepEqual(result.failedRouteNetworkGrants, [{
    grantId: protectedGrantId,
    augmentationOperationId: protectedOperationId,
    routeNetworkKind: 'objective-route-coverage',
    connectionIds: [conflictingSegment.id],
    roomIds: [],
    socketIds: [],
    failureKinds: [
      'route-network-segment-base-overlap-outside-landing-grant',
    ],
  }]);

  const protectedPlan = {
    ...plan,
    routeNetworkConflictExclusions: result.conflictExclusions,
  };
  assert.equal(omitConflictingRouteNetworkOperation(
    protectedPlan,
    validation,
    { routeNetworkPlanning: { allowPartialRouteNetworkRealization: true } },
    [{
      id: 'region:final-validation',
      routeNetworkGrants: [{
        id: protectedGrantId,
        kind: 'objective-route-coverage',
        required: true,
      }, {
        id: unrelatedGrantId,
        kind: 'objective-route-coverage',
        required: true,
      }],
    }],
  ), null, 'exact segment exhaustion must not become a whole-grant omission');

  assert.deepEqual(
    collectRouteNetworkFinalValidationExactConflictAttribution(
      plan,
      {
        accepted: false,
        errors: [{
          code: 'supplement-nodes-overlap',
          context: {
            firstNodeId: 'node:protected',
            secondNodeId: 'node:unrelated',
          },
        }],
      },
    ).routeNetworkConflictExclusions,
    [],
    'ambiguous pairwise conflicts must not select an exact victim',
  );
});
