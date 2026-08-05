import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createParentAnchoredRouteNetworkSalvage,
  createRouteNetworkConflictEntitySignature,
  normalizeRouteNetworkConflictExclusions,
  normalizeRouteNetworkEntityOmissions,
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

function parentEndpoint(socketId, ordinal) {
  return {
    kind: 'parentSocket',
    nodeId: `authored:${socketId}`,
    socketId,
    position: { x: ordinal * 11.2, y: 0, z: -11.2 },
    facing: { x: 0, y: 0, z: 1 },
  };
}

function createSalvageGraphCandidate({
  nodes: nodeInputs,
  edges,
  endpointSocketIds,
}) {
  const nodes = nodeInputs.map((input, ordinal) => {
    const kind = input.kind ?? 'supplementRoom';
    const connectorOwned = [
      'supplementConnectorModule',
      'supplementConnectorJunction',
    ].includes(kind);
    return {
      id: input.id,
      operationId,
      ordinal: input.ordinal ?? ordinal,
      kind,
      grammarId: input.grammarId ?? `grammar:${kind}`,
      contentRole: input.contentRole ?? (connectorOwned ? 'connector' : 'challenge'),
      connectorOwned,
      isSupplementConnectorModule: kind === 'supplementConnectorModule',
      isSupplementConnectorJunction: kind === 'supplementConnectorJunction',
      exactParentEndpoint: input.exactParentEndpoint === true,
      parentEndpointSocketId: input.parentEndpointSocketId ?? null,
      parentEndpointSocketKind: input.parentEndpointSocketKind ?? null,
      parentThroughRouteDegreeContribution: Number(
        input.parentThroughRouteDegreeContribution ?? 0,
      ),
      parentThroughPhysicalArmId: input.parentThroughPhysicalArmId ?? null,
      placement: {
        center: { x: ordinal * 22.4, y: 0, z: ordinal * 5.6 },
        rotationQuarterTurns: ordinal % 4,
      },
      size: { x: 8.4, y: 5.6, z: 8.4 },
      sockets: [],
      ...(kind === 'supplementConnectorJunction' ? {
        junction: {
          junctionKind: 'through-t',
          countsAsMeaningfulStation: true,
          activeSocketIds: [],
          decisionSocketIds: [],
          throughSocketPairs: [],
        },
      } : {}),
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const segments = edges.map((edge, physicalOrdinal) => {
    const ordinal = edge.ordinal ?? physicalOrdinal;
    const endpointFor = (value, role) => {
      if (typeof value === 'object' && value?.parent) {
        return parentEndpoint(value.parent, ordinal * 2 + (role === 'to' ? 1 : 0));
      }
      const node = nodeById.get(value);
      assert.ok(node, `test edge ${edge.id} references node ${value}`);
      const socket = {
        id: `${node.id}:socket:${edge.id}`,
        localSocketId: `edge:${edge.id}`,
        position: {
          x: Number(node.placement.center.x) + (role === 'to' ? -2.8 : 2.8),
          y: 0,
          z: Number(node.placement.center.z),
        },
        facing: { x: role === 'to' ? -1 : 1, y: 0, z: 0 },
        state: 'connected',
        segmentId: edge.id,
      };
      node.sockets.push(socket);
      return {
        kind: 'supplementSocket',
        nodeId: node.id,
        socketId: socket.id,
        position: { ...socket.position },
        facing: { ...socket.facing },
      };
    };
    return {
      id: edge.id,
      operationId,
      physicalOrdinal: ordinal,
      kind: 'route-network-segment',
      routeRole: `salvage-test:${edge.id}`,
      connectorFamily: 'service-gallery',
      from: endpointFor(edge.from, 'from'),
      to: endpointFor(edge.to, 'to'),
      path: [
        { x: ordinal * 8.4, y: 0, z: ordinal * 2.8 },
        { x: ordinal * 8.4 + 5.6, y: 0, z: ordinal * 2.8 },
      ],
      bidirectional: true,
      returnRouteGuaranteed: true,
    };
  });
  for (const node of nodes) {
    node.graphDegree = node.sockets.length;
    if (!node.junction) continue;
    node.junction.graphDegree = node.graphDegree;
    node.junction.activeSocketIds = node.sockets.map(({ id }) => id);
    node.junction.decisionSocketIds = node.sockets.slice(0, 1).map(({ id }) => id);
    node.junction.throughSocketPairs = node.sockets.length >= 2
      ? [[node.sockets[0].id, node.sockets[1].id]]
      : [];
  }
  const roomNodeIds = nodes
    .filter(({ kind }) => kind === 'supplementRoom')
    .map(({ id }) => id);
  const connectorModuleNodeIds = nodes
    .filter(({ kind }) => kind === 'supplementConnectorModule')
    .map(({ id }) => id);
  const connectorJunctionNodeIds = nodes
    .filter(({ kind }) => kind === 'supplementConnectorJunction')
    .map(({ id }) => id);
  return {
    operation: {
      id: operationId,
      type: 'routeNetwork',
      grantId,
      endpointSocketIds: [...endpointSocketIds],
      nodeIds: nodes.map(({ id }) => id),
      roomNodeIds,
      connectorModuleNodeIds,
      connectorJunctionNodeIds,
      connectorInfrastructureNodeIds: [
        ...connectorModuleNodeIds,
        ...connectorJunctionNodeIds,
      ],
      moduleCount: roomNodeIds.length + connectorJunctionNodeIds.length,
      substantiveModuleCount: roomNodeIds.length + connectorJunctionNodeIds.length,
      physicalNodeCount: nodes.length,
      roomCount: roomNodeIds.length,
      connectorModuleCount: connectorModuleNodeIds.length,
      connectorJunctionCount: connectorJunctionNodeIds.length,
      connectorInfrastructureCount:
        connectorModuleNodeIds.length + connectorJunctionNodeIds.length,
      segmentIds: segments.map(({ id }) => id),
      contentRoles: nodes.map(({ contentRole }) => contentRole),
      junctionKinds: connectorJunctionNodeIds.length > 0 ? ['through-t'] : [],
      featurelessSpans: [],
      cycleRankDelta: 1,
      bidirectional: true,
      returnRouteGuaranteed: true,
    },
    nodes,
    segments,
    normalizedSemanticSignature: 'salvage-test-signature',
  };
}

function exactConflictExclusion(planned, entityKind, entityId) {
  const collection = entityKind === 'segment' ? planned.segments : planned.nodes;
  const entity = collection.find(({ id }) => id === entityId);
  assert.ok(entity, `missing ${entityKind} ${entityId}`);
  return {
    grantId,
    entityKind,
    entityId,
    signature: createRouteNetworkConflictEntitySignature(entity, entityKind),
    reason: `synthetic-${entityKind}-conflict`,
  };
}

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

test('entity omissions require exact signatures and a linked conflict root', () => {
  const root = {
    grantId,
    operationId,
    entityKind: 'node',
    entityId: 'node:root',
    ordinal: 2,
    signature: 'physical:node:root',
    disposition: 'conflict-root',
    reason: 'synthetic-root-conflict',
    rootSignature: 'physical:node:root',
  };
  const dependency = {
    grantId,
    operationId,
    entityKind: 'segment',
    entityId: 'segment:dependency',
    ordinal: 3,
    signature: 'physical:segment:dependency',
    disposition: 'dependency',
    reason: 'incident-to-omitted-node',
    rootSignature: root.signature,
  };
  assert.deepEqual(normalizeRouteNetworkEntityOmissions([
    dependency,
    { ...dependency, entityId: 'segment:missing-signature', signature: null },
    { ...dependency, entityId: 'segment:missing-root', rootSignature: null },
    root,
  ]), [root, dependency]);
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

test('parent-anchored salvage removes one conflicting leaf and keeps its rooted sibling branch', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:west'],
    nodes: [{ id: 'hub' }, { id: 'safe-leaf' }, { id: 'conflicting-leaf' }],
    edges: [{ id: 'parent-hub', from: { parent: 'parent:west' }, to: 'hub' }, {
      id: 'hub-safe', from: 'hub', to: 'safe-leaf',
    }, {
      id: 'hub-conflict', from: 'hub', to: 'conflicting-leaf',
    }],
  });
  const exclusion = exactConflictExclusion(planned, 'node', 'conflicting-leaf');
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, [exclusion]);

  assert.equal(salvaged.error, undefined);
  assert.equal(salvaged.operation.realizationMode, 'parent-anchored-forest');
  assert.deepEqual(salvaged.operation.nodeIds, ['hub', 'safe-leaf']);
  assert.deepEqual(salvaged.operation.segmentIds, ['parent-hub', 'hub-safe']);
  assert.deepEqual(salvaged.operation.endpointSocketIds, ['parent:west']);
  assert.deepEqual(salvaged.operation.omittedEndpointSocketIds, []);
  assert.equal(salvaged.operation.roomCount, 2);
  assert.equal(salvaged.operation.physicalNodeCount, 2);
  assert.equal(salvaged.operation.cycleRankDelta, 0);
  assert.deepEqual(salvaged.operation.parentAnchoredComponents, [{
    id: `${operationId}:parent-anchored-component:0`,
    attachmentSocketIds: ['parent:west'],
    attachmentSocketId: 'parent:west',
    nodeIds: ['hub', 'safe-leaf'],
    segmentIds: ['parent-hub', 'hub-safe'],
    bidirectional: true,
  }]);
  assert.deepEqual(salvaged.routeNetworkEntityOmissions.map((entry) => ({
    entityKind: entry.entityKind,
    entityId: entry.entityId,
    disposition: entry.disposition,
    reason: entry.reason,
  })), [{
    entityKind: 'node',
    entityId: 'conflicting-leaf',
    disposition: 'conflict-root',
    reason: 'synthetic-node-conflict',
  }, {
    entityKind: 'segment',
    entityId: 'hub-conflict',
    disposition: 'dependency',
    reason: 'incident-to-omitted-node',
  }]);
  const recappedSocket = salvaged.nodes.find(({ id }) => id === 'hub').sockets
    .find(({ id }) => id === 'hub:socket:hub-conflict');
  assert.equal(recappedSocket.state, 'capped');
  assert.equal(recappedSocket.segmentId, null);
  assert.equal(recappedSocket.capRole, 'cap');
  assert.equal(salvaged.nodes.find(({ id }) => id === 'hub').graphDegree, 2);
  assert.deepEqual(
    salvaged.operation.featurelessSpans.map(({ segmentId }) => segmentId),
    ['parent-hub', 'hub-safe'],
  );
  assert.equal(planned.nodes.find(({ id }) => id === 'hub').sockets
    .find(({ id }) => id === 'hub:socket:hub-conflict').state, 'connected');
});

test('parent-anchored salvage removes an exact middle module and only its unrooted closure', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:west'],
    nodes: [{ id: 'root-room' }, { id: 'middle-room' }, { id: 'far-room' }],
    edges: [{ id: 'parent-root', from: { parent: 'parent:west' }, to: 'root-room' }, {
      id: 'root-middle', from: 'root-room', to: 'middle-room',
    }, {
      id: 'middle-far', from: 'middle-room', to: 'far-room',
    }],
  });
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, [
    exactConflictExclusion(planned, 'node', 'middle-room'),
  ]);

  assert.equal(salvaged.error, undefined);
  assert.deepEqual(salvaged.operation.nodeIds, ['root-room']);
  assert.deepEqual(salvaged.operation.segmentIds, ['parent-root']);
  assert.deepEqual(
    salvaged.routeNetworkEntityOmissions.map(({ entityId }) => entityId),
    ['middle-room', 'far-room', 'root-middle', 'middle-far'],
  );
  assert.equal(
    salvaged.routeNetworkEntityOmissions.find(({ entityId }) => entityId === 'far-room').reason,
    'isolated-node',
  );
  assert.equal(salvaged.nodes[0].graphDegree, 1);
});

test('parent-anchored salvage of a conflicting segment keeps both independently rooted sides', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:west', 'parent:east'],
    nodes: [{ id: 'west-room' }, { id: 'east-room' }],
    edges: [{ id: 'parent-west', from: { parent: 'parent:west' }, to: 'west-room' }, {
      id: 'conflicting-span', from: 'west-room', to: 'east-room',
    }, {
      id: 'parent-east', from: 'east-room', to: { parent: 'parent:east' },
    }],
  });
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, [
    exactConflictExclusion(planned, 'segment', 'conflicting-span'),
  ]);

  assert.equal(salvaged.error, undefined);
  assert.deepEqual(salvaged.operation.nodeIds, ['west-room', 'east-room']);
  assert.deepEqual(salvaged.operation.segmentIds, ['parent-west', 'parent-east']);
  assert.deepEqual(salvaged.operation.endpointSocketIds, ['parent:west', 'parent:east']);
  assert.deepEqual(salvaged.operation.parentAnchoredComponents.map((component) => ({
    root: component.attachmentSocketId,
    nodes: component.nodeIds,
  })), [{ root: 'parent:west', nodes: ['west-room'] }, {
    root: 'parent:east', nodes: ['east-room'],
  }]);
  assert.deepEqual(salvaged.routeNetworkEntityOmissions.map((entry) => ({
    entityId: entry.entityId,
    disposition: entry.disposition,
  })), [{ entityId: 'conflicting-span', disposition: 'conflict-root' }]);
});

test('parent-anchored salvage can omit one exact parent attachment and retain the opposite root', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:west', 'parent:east'],
    nodes: [{ id: 'west-room' }, { id: 'east-room' }],
    edges: [{ id: 'parent-west', from: { parent: 'parent:west' }, to: 'west-room' }, {
      id: 'west-east', from: 'west-room', to: 'east-room',
    }, {
      id: 'parent-east', from: 'east-room', to: { parent: 'parent:east' },
    }],
  });
  planned.operation.routeNetworkKind = 'objective-route-coverage';
  planned.operation.coverage = {
    logicalEdgeId: 'keycard-to-trap',
    coverageComplete: true,
  };
  const exclusion = exactConflictExclusion(planned, 'segment', 'parent-west');
  exclusion.reason = 'route-network-structural-frame-wall-run-missing';
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, [exclusion]);

  assert.equal(salvaged.error, undefined);
  assert.deepEqual(salvaged.operation.nodeIds, ['west-room', 'east-room']);
  assert.deepEqual(salvaged.operation.segmentIds, ['west-east', 'parent-east']);
  assert.deepEqual(salvaged.operation.endpointSocketIds, ['parent:east']);
  assert.deepEqual(salvaged.operation.omittedEndpointSocketIds, ['parent:west']);
  assert.deepEqual(salvaged.operation.coverage, planned.operation.coverage);
  assert.equal(salvaged.operation.authoredCoverageRealized, false);
  assert.equal(salvaged.operation.localProgressionArcRealized, false);
  assert.deepEqual(salvaged.operation.parentAnchoredComponents.map((component) => ({
    root: component.attachmentSocketId,
    nodes: component.nodeIds,
    segments: component.segmentIds,
  })), [{
    root: 'parent:east',
    nodes: ['west-room', 'east-room'],
    segments: ['west-east', 'parent-east'],
  }]);
  assert.deepEqual(salvaged.routeNetworkEntityOmissions.map((entry) => ({
    entityId: entry.entityId,
    disposition: entry.disposition,
    reason: entry.reason,
  })), [{
    entityId: 'parent-west',
    disposition: 'conflict-root',
    reason: 'route-network-structural-frame-wall-run-missing',
  }]);
});

test('parent-anchored salvage retains a safe deterministic multi-root merge', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:west', 'parent:east'],
    nodes: [{ id: 'west-room' }, { id: 'east-room' }, { id: 'conflicting-leaf' }],
    edges: [{ id: 'parent-west', ordinal: 0, from: { parent: 'parent:west' }, to: 'west-room' }, {
      id: 'parent-east', ordinal: 1, from: { parent: 'parent:east' }, to: 'east-room',
    }, {
      id: 'root-merge', ordinal: 2, from: 'west-room', to: 'east-room',
    }, {
      id: 'conflict-arm', ordinal: 3, from: 'west-room', to: 'conflicting-leaf',
    }],
  });
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, [
    exactConflictExclusion(planned, 'node', 'conflicting-leaf'),
  ]);

  assert.equal(salvaged.error, undefined);
  assert.deepEqual(salvaged.operation.segmentIds, [
    'parent-west',
    'parent-east',
    'root-merge',
  ]);
  assert.equal(salvaged.operation.parentAnchoredComponents.length, 1);
  assert.deepEqual(
    salvaged.operation.parentAnchoredComponents[0].attachmentSocketIds,
    ['parent:west', 'parent:east'],
  );
  assert.equal(salvaged.operation.parentAnchoredComponents[0].attachmentSocketId, 'parent:west');
  assert.equal(salvaged.operation.cycleRankDelta, 0);
  assert.equal(
    salvaged.routeNetworkEntityOmissions.some(({ entityId }) => entityId === 'root-merge'),
    false,
  );
});

test('parent-anchored salvage retains safe cycles and is canonical across input collection order', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:west'],
    nodes: [{ id: 'room-a' }, { id: 'room-b' }, { id: 'room-c' }, {
      id: 'conflicting-leaf',
    }],
    edges: [{ id: 'parent-a', ordinal: 0, from: { parent: 'parent:west' }, to: 'room-a' }, {
      id: 'a-b', ordinal: 1, from: 'room-a', to: 'room-b',
    }, {
      id: 'b-c', ordinal: 2, from: 'room-b', to: 'room-c',
    }, {
      id: 'c-a-cycle', ordinal: 3, from: 'room-c', to: 'room-a',
    }, {
      id: 'conflict-arm', ordinal: 4, from: 'room-a', to: 'conflicting-leaf',
    }],
  });
  const exclusion = exactConflictExclusion(planned, 'node', 'conflicting-leaf');
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, [exclusion]);
  const reordered = createParentAnchoredRouteNetworkSalvage({
    ...planned,
    nodes: [...planned.nodes].reverse(),
    segments: [...planned.segments].reverse(),
  }, [exclusion]);

  assert.equal(salvaged.error, undefined);
  assert.deepEqual(salvaged.operation.nodeIds, ['room-a', 'room-b', 'room-c']);
  assert.deepEqual(salvaged.operation.segmentIds, ['parent-a', 'a-b', 'b-c', 'c-a-cycle']);
  assert.equal(salvaged.operation.cycleRankDelta, 1);
  assert.equal(
    salvaged.routeNetworkEntityOmissions.some(({ entityId }) => entityId === 'c-a-cycle'),
    false,
  );
  assert.deepEqual(reordered, salvaged);
});

test('parent-anchored salvage iteratively drops under-degree connector infrastructure', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:safe', 'parent:connector'],
    nodes: [{ id: 'safe-room' }, {
      id: 'thin-connector', kind: 'supplementConnectorModule',
    }, { id: 'connector-room' }],
    edges: [{ id: 'parent-safe', ordinal: 0, from: { parent: 'parent:safe' }, to: 'safe-room' }, {
      id: 'parent-connector', ordinal: 1, from: { parent: 'parent:connector' }, to: 'thin-connector',
    }, {
      id: 'conflicting-connector-span', ordinal: 2, from: 'thin-connector', to: 'connector-room',
    }],
  });
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, [
    exactConflictExclusion(planned, 'segment', 'conflicting-connector-span'),
  ]);

  assert.equal(salvaged.error, undefined);
  assert.deepEqual(salvaged.operation.nodeIds, ['safe-room']);
  assert.deepEqual(salvaged.operation.segmentIds, ['parent-safe']);
  assert.deepEqual(salvaged.operation.endpointSocketIds, ['parent:safe']);
  assert.deepEqual(salvaged.operation.omittedEndpointSocketIds, ['parent:connector']);
  assert.equal(
    salvaged.routeNetworkEntityOmissions.find(({ entityId }) => (
      entityId === 'thin-connector'
    )).reason,
    'under-degree-connector-infrastructure',
  );
  assert.ok(salvaged.routeNetworkEntityOmissions.some(({ entityId, reason }) => (
    entityId === 'parent-connector' && reason === 'incident-to-under-degree-node'
  )));
  assert.ok(salvaged.routeNetworkEntityOmissions.some(({ entityId, reason }) => (
    entityId === 'connector-room' && reason === 'isolated-node'
  )));
});

test('parent-through corridor arms do not preserve one-segment connector modules', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:safe', 'parent:station'],
    nodes: [{ id: 'safe-room' }, {
      id: 'terminal-station-module',
      kind: 'supplementConnectorModule',
      exactParentEndpoint: true,
      parentEndpointSocketId: 'parent:station',
      parentEndpointSocketKind: 'authored-corridor-station',
      parentThroughRouteDegreeContribution: 1,
      parentThroughPhysicalArmId: 'terminal-station-module:authored-parent-through-arm',
    }, { id: 'conflicting-room' }],
    edges: [{
      id: 'parent-safe',
      ordinal: 0,
      from: { parent: 'parent:safe' },
      to: 'safe-room',
    }, {
      id: 'parent-station-attachment',
      ordinal: 1,
      from: { parent: 'parent:station' },
      to: 'terminal-station-module',
    }, {
      id: 'conflicting-branch',
      ordinal: 2,
      from: 'terminal-station-module',
      to: 'conflicting-room',
    }],
  });
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, [
    exactConflictExclusion(planned, 'segment', 'conflicting-branch'),
  ]);

  assert.equal(salvaged.error, undefined);
  assert.deepEqual(salvaged.operation.nodeIds, ['safe-room']);
  assert.deepEqual(salvaged.operation.segmentIds, ['parent-safe']);
  assert.deepEqual(salvaged.operation.endpointSocketIds, ['parent:safe']);
  assert.deepEqual(salvaged.operation.omittedEndpointSocketIds, ['parent:station']);
  assert.equal(
    salvaged.routeNetworkEntityOmissions.find(({ entityId }) => (
      entityId === 'terminal-station-module'
    ))?.reason,
    'under-degree-connector-infrastructure',
  );
  assert.ok(salvaged.routeNetworkEntityOmissions.some(({ entityId, reason }) => (
    entityId === 'parent-station-attachment'
      && reason === 'incident-to-under-degree-node'
  )));
});

test('parent-anchored salvage requires explicit unique source ordinals', () => {
  const missing = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:west'],
    nodes: [{ id: 'root-room' }, { id: 'conflicting-room' }],
    edges: [{ id: 'parent-root', from: { parent: 'parent:west' }, to: 'root-room' }, {
      id: 'root-conflict', from: 'root-room', to: 'conflicting-room',
    }],
  });
  delete missing.nodes[0].ordinal;
  assert.equal(
    createParentAnchoredRouteNetworkSalvage(missing, [
      exactConflictExclusion(missing, 'node', 'conflicting-room'),
    ]).error,
    'route-network-parent-anchored-salvage-source-ordinals-invalid',
  );

  for (const invalidOrdinal of [null, '0']) {
    const invalid = createSalvageGraphCandidate({
      endpointSocketIds: ['parent:west'],
      nodes: [{ id: 'root-room' }, { id: 'conflicting-room' }],
      edges: [{ id: 'parent-root', from: { parent: 'parent:west' }, to: 'root-room' }, {
        id: 'root-conflict', from: 'root-room', to: 'conflicting-room',
      }],
    });
    invalid.nodes[0].ordinal = invalidOrdinal;
    assert.equal(
      createParentAnchoredRouteNetworkSalvage(invalid, [
        exactConflictExclusion(invalid, 'node', 'conflicting-room'),
      ]).error,
      'route-network-parent-anchored-salvage-source-ordinals-invalid',
    );
  }

  const duplicate = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:west'],
    nodes: [{ id: 'root-room', ordinal: 0 }, { id: 'conflicting-room', ordinal: 0 }],
    edges: [{ id: 'parent-root', from: { parent: 'parent:west' }, to: 'root-room' }, {
      id: 'root-conflict', from: 'root-room', to: 'conflicting-room',
    }],
  });
  assert.equal(
    createParentAnchoredRouteNetworkSalvage(duplicate, [
      exactConflictExclusion(duplicate, 'node', 'conflicting-room'),
    ]).error,
    'route-network-parent-anchored-salvage-source-ordinals-invalid',
  );
});

test('parent-anchored salvage links dependencies to a conflict root in the same source component', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:safe', 'parent:west', 'parent:east'],
    nodes: [
      { id: 'safe-room' },
      { id: 'west-root' },
      { id: 'west-conflict' },
      { id: 'east-root' },
      { id: 'east-conflict' },
    ],
    edges: [
      { id: 'parent-safe', from: { parent: 'parent:safe' }, to: 'safe-room' },
      { id: 'parent-west', from: { parent: 'parent:west' }, to: 'west-root' },
      { id: 'west-arm', from: 'west-root', to: 'west-conflict' },
      { id: 'parent-east', from: { parent: 'parent:east' }, to: 'east-root' },
      { id: 'east-arm', from: 'east-root', to: 'east-conflict' },
    ],
  });
  const westExclusion = exactConflictExclusion(planned, 'node', 'west-conflict');
  const eastExclusion = exactConflictExclusion(planned, 'node', 'east-conflict');
  const salvaged = createParentAnchoredRouteNetworkSalvage(
    planned,
    [westExclusion, eastExclusion],
  );

  assert.equal(salvaged.error, undefined);
  assert.equal(
    salvaged.routeNetworkEntityOmissions.find(({ entityId }) => entityId === 'west-arm')
      .rootSignature,
    westExclusion.signature,
  );
  assert.equal(
    salvaged.routeNetworkEntityOmissions.find(({ entityId }) => entityId === 'east-arm')
      .rootSignature,
    eastExclusion.signature,
  );
});

test('parent-anchored salvage attributes isolated nodes to their incident conflict roots', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:root'],
    nodes: [
      { id: 'root-room' },
      { id: 'isolated-by-root-four' },
      { id: 'isolated-by-root-six' },
      { id: 'isolated-by-root-seven' },
    ],
    edges: [
      { id: 'parent-root', ordinal: 0, from: { parent: 'parent:root' }, to: 'root-room' },
      { id: 'conflict-root-four', ordinal: 4, from: 'root-room', to: 'isolated-by-root-four' },
      { id: 'conflict-root-six', ordinal: 6, from: 'root-room', to: 'isolated-by-root-six' },
      { id: 'conflict-root-seven', ordinal: 7, from: 'root-room', to: 'isolated-by-root-seven' },
    ],
  });
  const exclusions = [
    exactConflictExclusion(planned, 'segment', 'conflict-root-four'),
    exactConflictExclusion(planned, 'segment', 'conflict-root-six'),
    exactConflictExclusion(planned, 'segment', 'conflict-root-seven'),
  ];
  const rootSignatureByIsolatedNodeId = new Map([
    ['isolated-by-root-four', exclusions[0].signature],
    ['isolated-by-root-six', exclusions[1].signature],
    ['isolated-by-root-seven', exclusions[2].signature],
  ]);
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, exclusions);

  assert.equal(salvaged.error, undefined);
  assert.deepEqual(salvaged.operation.nodeIds, ['root-room']);
  assert.deepEqual(salvaged.operation.segmentIds, ['parent-root']);
  for (const [nodeId, rootSignature] of rootSignatureByIsolatedNodeId) {
    const omission = salvaged.routeNetworkEntityOmissions.find(({ entityId }) => (
      entityId === nodeId
    ));
    assert.equal(omission.disposition, 'dependency');
    assert.equal(omission.reason, 'isolated-node');
    assert.equal(
      omission.rootSignature,
      rootSignature,
      `${nodeId} must not borrow another conflict root from its source component`,
    );
  }
});

test('parent-anchored salvage fails closed when a dependency has no source-component root', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:safe'],
    nodes: [{ id: 'safe-room' }, { id: 'conflicting-leaf' }, { id: 'orphan-room' }],
    edges: [
      { id: 'parent-safe', from: { parent: 'parent:safe' }, to: 'safe-room' },
      { id: 'safe-conflict', from: 'safe-room', to: 'conflicting-leaf' },
      { id: 'orphan-invalid', from: { parent: 'parent:undeclared' }, to: 'orphan-room' },
    ],
  });
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, [
    exactConflictExclusion(planned, 'segment', 'safe-conflict'),
  ]);

  assert.equal(
    salvaged.error,
    'route-network-parent-anchored-salvage-dependency-root-unavailable',
  );
});

test('parent-anchored objective salvage preserves grant coverage provenance but disclaims realization', () => {
  const planned = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:west'],
    nodes: [{ id: 'root-room' }, { id: 'conflicting-room' }],
    edges: [{ id: 'parent-root', from: { parent: 'parent:west' }, to: 'root-room' }, {
      id: 'root-conflict', from: 'root-room', to: 'conflicting-room',
    }],
  });
  planned.operation.routeNetworkKind = 'objective-route-coverage';
  planned.operation.coverage = {
    logicalEdgeId: 'authored-route',
    coverageComplete: true,
  };
  const salvaged = createParentAnchoredRouteNetworkSalvage(planned, [
    exactConflictExclusion(planned, 'node', 'conflicting-room'),
  ]);

  assert.equal(salvaged.error, undefined);
  assert.deepEqual(salvaged.operation.coverage, planned.operation.coverage);
  assert.equal(salvaged.operation.authoredCoverageRealized, false);
  assert.equal(salvaged.operation.localProgressionArcRealized, false);
  assert.equal(salvaged.operation.returnRouteGuaranteed, true);
});

test('parent-anchored salvage returns structured failures for no match and empty closure', () => {
  const noMatchCandidate = createSalvageGraphCandidate({
    endpointSocketIds: ['parent:west'],
    nodes: [{ id: 'only-room' }],
    edges: [{ id: 'parent-only', from: { parent: 'parent:west' }, to: 'only-room' }],
  });
  assert.equal(createParentAnchoredRouteNetworkSalvage(noMatchCandidate, [{
    grantId,
    entityKind: 'node',
    entityId: 'prior-candidate-room',
    signature: 'nonmatching-physical-signature',
    reason: 'synthetic-no-match',
  }]).error, 'route-network-parent-anchored-salvage-no-matching-conflict');

  const emptied = createParentAnchoredRouteNetworkSalvage(noMatchCandidate, [
    exactConflictExclusion(noMatchCandidate, 'node', 'only-room'),
  ]);
  assert.equal(emptied.error, 'route-network-parent-anchored-salvage-empty');
  assert.deepEqual(emptied.context.routeNetworkEntityOmissions.map(({ entityId }) => entityId), [
    'only-room',
    'parent-only',
  ]);
});
