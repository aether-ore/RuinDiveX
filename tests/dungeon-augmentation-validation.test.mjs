import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DUNGEON_AUGMENTATION_PROFILES,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  augmentDungeonDraft,
  canonicalStringify,
  computeDungeonAugmentationPlanHash,
  computeEffectiveDungeonPlanHash,
  createRouteNetworkConflictEntitySignature,
  createDungeonRouteEndpointSeam,
  evaluateDungeonRouteNetworkFeaturelessGraph,
  landmarkSharedThresholdParentPosition,
  validateDungeonAugmentationPlan,
} from '../src/dungeon-augmentation/index.js';
import {
  DUNGEON_SELECTION_BAG_FAMILIES,
  createDungeonSelectionBagWitness,
} from '../src/dungeon-augmentation/selectionBagWitness.js';
import {
  objectiveCoverageGrantForOperationStationSide,
} from '../src/dungeon-augmentation/objectiveCoverageStationSide.js';

const PROFILE_ID = 'industrial-supplement-preview-v2';
const THEME_BINDING = Object.freeze({
  schema: 'ruindivex-dungeon-region-theme/v1',
  parentMapId: 'validation-fixture-map',
  parentMapRevision: 'validation-fixture-map-r1',
  parentRegionId: 'validation-fixture-region',
  themeRef: {
    id: 'validation-fixture-theme',
    revision: 'validation-fixture-theme-r1',
    contentHash: 'validation-fixture-content-a',
  },
  presentationVariantId: 'validation-fixture-main',
  localLightingProfileId: 'validation-fixture-lights',
  soundscapeProfileId: 'validation-fixture-ambience',
});
const THEME_CAPABILITIES = Object.freeze({
  materials: ['primary-floor', 'corridor-floor', 'wall', 'ceiling', 'support', 'cap'],
  assets: ['light-fixture', 'transition-frame'],
  connectors: ['service-gallery', 'transition-bay'],
  transitions: ['level-transition-bay'],
});

function makeFixture() {
  const baseDraft = {
    schema: 'validation-fixture-base-draft/v1',
    basePlanHash: 'validation-fixture-base-plan-v1',
    rooms: [],
    connectionPlans: [],
    occupiedVolumes: [],
    protectedVolumes: [],
    progression: { keys: [], gates: [] },
  };
  const extensionRegions = [{
    id: 'validation-fixture-region',
    themeBinding: THEME_BINDING,
    attachmentSockets: [{
      id: 'validation-fixture-parent:branch-socket',
      nodeId: 'validation-fixture-parent',
      position: { x: -84, y: 0, z: -84 },
      facing: { x: 0, y: 0, z: -1 },
      availableDepthMeters: 100,
      connectorFamilies: ['service-gallery'],
    }],
    spliceEdges: [{
      id: 'validation-fixture-splice',
      logicalEdgeId: 'validation-parent-a_validation-parent-b',
      connectorFamilies: ['service-gallery'],
      availableLengthMeters: 140,
      path: [
        { x: -70, y: 0, z: 0 },
        { x: 70, y: 0, z: 0 },
      ],
      from: {
        nodeId: 'validation-parent-a',
        socketId: 'validation-parent-a:exit',
        position: { x: -70, y: 0, z: 0 },
        facing: { x: 1, y: 0, z: 0 },
      },
      to: {
        nodeId: 'validation-parent-b',
        socketId: 'validation-parent-b:entry',
        position: { x: 70, y: 0, z: 0 },
        facing: { x: -1, y: 0, z: 0 },
      },
      sourceThemeBinding: THEME_BINDING,
      destinationThemeBinding: THEME_BINDING,
    }],
    allowedProfileIds: [PROFILE_ID],
    delegatedProgressionBeats: [],
    themeCapabilities: THEME_CAPABILITIES,
  }];
  return { baseDraft, extensionRegions };
}

function createValidPlan() {
  const fixture = makeFixture();
  const result = augmentDungeonDraft({
    ...fixture,
    profileId: PROFILE_ID,
    layoutSeed: 'validation-fixture-layout',
    augmentationSeed: 'validation-fixture-augmentation',
    difficulty: 2,
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.diagnostics.errors));
  return { fixture, plan: structuredClone(result.overlayPlan) };
}

function rehash(plan) {
  plan.augmentationPlanHash = computeDungeonAugmentationPlanHash(plan);
  plan.effectivePlanHash = computeEffectiveDungeonPlanHash(
    plan.basePlanHash,
    plan.augmentationPlanHash,
  );
  return plan;
}

function validate(plan, fixture, profile = DUNGEON_AUGMENTATION_PROFILES[PROFILE_ID]) {
  return validateDungeonAugmentationPlan(plan, {
    ...fixture,
    profiles: { [PROFILE_ID]: profile },
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  });
}

const V4_PROFILE_ID = 'industrial-supplement-preview-v4-validation-fixture';
const V4_PROFILE = Object.freeze({
  id: V4_PROFILE_ID,
  revision: 5,
  operationBudget: {
    minimumTotalRooms: 0,
    maximumTotalRooms: 30,
  },
  routeNetworkPlanning: {
    allowPartialRouteNetworkRealization: true,
    maximumFeaturelessSpanMeters: 33.6,
    maximumNetworkCount: 8,
    maximumTotalModules: 30,
    localProgressionArc: ['enter', 'challenge', 'mechanism', 'payoff', 'reconnect'],
  },
  allowDelegatedProgression: false,
});

const V4_JUNCTION_KITS = Object.freeze([{
  kind: 'through-t',
  grammarId: 'supplement-route-connector-through-t-v1',
  width: 14,
  depth: 19.6,
}, {
  kind: 'crossroads',
  grammarId: 'supplement-route-connector-crossroads-v1',
  width: 19.6,
  depth: 19.6,
}, {
  kind: 'staggered-cross',
  grammarId: 'supplement-route-connector-staggered-cross-v1',
  width: 14,
  depth: 36.4,
}, {
  kind: 'fork-merge',
  grammarId: 'supplement-route-connector-fork-merge-v1',
  width: 14,
  depth: 19.6,
}, {
  kind: 'stacked-interchange',
  grammarId: 'supplement-route-connector-stacked-interchange-v1',
  width: 25.2,
  depth: 36.4,
}, {
  kind: 'over-under-crossover',
  grammarId: 'supplement-route-connector-over-under-v1',
  width: 19.6,
  depth: 19.6,
}]);

function v4Id(kind, ordinal) {
  return `supplement:validation-fixture-region:routenetwork:0:${kind}:${ordinal}`;
}

function maximumContinuousLevelPathDistance(path = []) {
  let current = 0;
  let maximum = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const point = path[index];
    if (Math.abs(Number(point.y) - Number(previous.y)) > 1e-6) {
      maximum = Math.max(maximum, current);
      current = 0;
      continue;
    }
    current += Math.hypot(
      Number(point.x) - Number(previous.x),
      Number(point.z) - Number(previous.z),
    );
  }
  return Math.max(maximum, current);
}

function applyV4EndpointContracts({
  segments,
  nodes,
  operationId,
  progressionBandId,
  grant,
}) {
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
  const parentSocketById = new Map((grant.endpointSockets ?? []).map((socket) => (
    [String(socket.id), socket]
  )));
  const parentOverlapBySocketId = new Map(
    (grant.socketLandingOverlapGrants ?? []).map((overlap) => (
      [String(overlap.socketId), overlap]
    )),
  );
  for (const segment of segments) {
    if (segment.sharedEndpointFootprint?.kind === 'shared-junction-threshold') continue;
    const endpointRecords = [segment.from, segment.to].map((endpoint, endpointIndex) => {
      const node = nodeById.get(String(endpoint.nodeId));
      if (node && !node.blueprintId && node.connectorOwned !== true) {
        node.blueprintId = `${node.id}:fixture-blueprint`;
      }
      if (!node && parentSocketById.has(String(endpoint.socketId ?? endpoint.id))) {
        endpoint.kind = 'parentSocket';
      }
      const exactSocket = node?.sockets?.find(({ id }) => (
        String(id) === String(endpoint.socketId ?? endpoint.id)
      )) ?? parentSocketById.get(String(endpoint.socketId ?? endpoint.id)) ?? endpoint;
      const role = endpointIndex === 0 ? 'from' : 'to';
      const parentOverlap = parentOverlapBySocketId.get(String(
        endpoint.socketId ?? endpoint.id,
      ));
      return {
        endpoint,
        node,
        exactSocket,
        seam: createDungeonRouteEndpointSeam(exactSocket, {
          id: `${segment.id}:${role}-endpoint-seam`,
          segmentId: segment.id,
          operationId,
          networkId: operationId,
          nodeId: endpoint.nodeId,
          socketId: endpoint.socketId ?? endpoint.id,
          localSocketId: exactSocket.localSocketId ?? endpoint.localSocketId ?? null,
          role,
          elevationBand: node?.progressionBandId ?? progressionBandId,
          parentOwnerId: parentOverlap?.parentOwnerId ?? null,
        }),
      };
    });
    segment.endpointSeams = endpointRecords.map(({ seam }) => seam);
    segment.localApproachWitnesses = endpointRecords.map(({
      endpoint,
      node,
      exactSocket,
    }, endpointIndex) => {
      const start = {
        x: Number(exactSocket.position.x) - Number(exactSocket.facing.x) * 5.6,
        y: Number(exactSocket.position.y),
        z: Number(exactSocket.position.z) - Number(exactSocket.facing.z) * 5.6,
      };
      if (node) {
        const alongX = Math.abs(Number(exactSocket.facing.x)) > 0.5;
        node.occupiedVolumes.push({
          id: `${segment.id}:endpoint-${endpointIndex}:walkable-intent`,
          ownerId: node.id,
          center: {
            x: (start.x + Number(exactSocket.position.x)) * 0.5,
            y: Number(exactSocket.position.y) + 0.1,
            z: (start.z + Number(exactSocket.position.z)) * 0.5,
          },
          size: {
            x: alongX ? 5.6 : 0.2,
            y: 0.2,
            z: alongX ? 0.2 : 5.6,
          },
          purpose: 'fixture-socket-walkable-intent',
        });
      }
      return {
        nodeId: endpoint.nodeId,
        socketId: endpoint.socketId ?? endpoint.id,
        localSocketId: exactSocket.localSocketId ?? endpoint.localSocketId ?? null,
        path: [start, { ...exactSocket.position }],
      };
    });
  }
}

function makeV4ValidationFixture() {
  const domain = 'validation-fixture-region:access-domain:band-0';
  const sockets = [{
    id: 'validation-fixture-region:socket:keycardRoom:south',
    nodeId: 'keycardRoom',
    roomId: 'keycardRoom',
    wallSide: 'south',
    position: { x: -12, y: 0, z: 0 },
    facing: { x: 0, y: 0, z: 1 },
    widthMeters: 8.4,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    clearanceHeightMeters: 3.6,
    progressionBandId: 0,
    accessDomainId: domain,
  }, {
    id: 'validation-fixture-region:socket:keycardRoom:west',
    nodeId: 'keycardRoom',
    roomId: 'keycardRoom',
    wallSide: 'west',
    position: { x: 36, y: 0, z: 0 },
    facing: { x: -1, y: 0, z: 0 },
    widthMeters: 8.4,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    clearanceHeightMeters: 3.6,
    progressionBandId: 0,
    accessDomainId: domain,
  }];
  const landingOverlaps = sockets.map((socket) => {
    const horizontal = Math.abs(socket.facing.x) > 0;
    return {
      id: `${socket.id}:landing-overlap`,
      socketId: socket.id,
      center: {
        ...socket.position,
        y: socket.position.y + 1.8,
      },
      size: {
        x: horizontal ? 14 : 8.4,
        y: 3.6,
        z: horizontal ? 8.4 : 14,
      },
      purpose: 'route-network-doorway-landing-overlap',
      widthTiles: 3,
      insideDepthTiles: 2,
      outsideDepthTiles: 2,
      maximumBoundaryDepthTiles: 2,
    };
  });
  const grant = {
    schema: 'ruindivex-dungeon-route-network-grant/v2',
    id: 'validation-fixture-region:route-network-grant:keycard-pyramid-loop',
    required: true,
    kind: 'landmark-perimeter-loop',
    landmarkRoomId: 'keycardRoom',
    endpointSockets: sockets,
    occupiedCriticalWallSides: ['east', 'north'],
    openedWallSides: ['south', 'west'],
    progressionBandId: 0,
    accessDomainId: domain,
    dominanceRegionId: 'post-enemyNestGate:pre-Door_Alpha',
    crossedBoundaryIds: [],
    requiredCredentialIds: [],
    sourceGate: null,
    protectedVolumes: [{
      id: 'validation-fixture-region:protected:pyramid',
      ownerId: 'keycardRoom',
      center: { x: 100, y: 5, z: 100 },
      size: { x: 20, y: 10, z: 20 },
    }],
    socketLandingOverlapGrants: landingOverlaps,
    mustPreserveBeatIds: [
      'enemyNestGate', 'keycardGuard', 'Keycard_Alpha', 'Door_Alpha',
      'keycardRoom:grandMechanicalPyramid',
    ],
    minimumModules: 3,
    maximumModules: 5,
    requiredCycleRankDelta: 1,
  };
  const snapshot = {
    schema: 'ruindivex-dungeon-progression-snapshot/v2',
    startRoomId: 'entrance',
    rooms: [{
      id: 'entrance', progressionBandId: 0, accessDomainId: domain,
    }, {
      id: 'keycardRoom', progressionBandId: 0, accessDomainId: domain,
    }, {
      id: 'trapRoom', progressionBandId: 1, accessDomainId: 'validation-fixture-region:access-domain:band-1',
    }],
    connections: [{
      id: 'entrance_keycardRoom',
      logicalEdgeId: 'entrance_keycardRoom',
      fromRoomId: 'entrance',
      toRoomId: 'keycardRoom',
      progressionBandId: 0,
      accessDomainId: domain,
      gateId: null,
      gatePlacementSide: null,
      requiredCredentialIds: [],
      dominanceBoundary: 'entrance_keycardRoom:ungated',
      centerline: [{ x: -10, y: 0, z: -10 }, { x: 0, y: 0, z: -10 }],
      pathLengthMeters: 10,
    }, {
      id: 'keycardRoom_trapRoom',
      logicalEdgeId: 'keycardRoom_trapRoom',
      fromRoomId: 'keycardRoom',
      toRoomId: 'trapRoom',
      progressionBandId: 1,
      accessDomainId: 'validation-fixture-region:access-domain:band-1',
      gateId: 'Door_Alpha',
      gatePlacementSide: 'source',
      requiredCredentialIds: ['Keycard_Alpha'],
      dominanceBoundary: 'keycardRoom_trapRoom:gate:Door_Alpha',
      centerline: [{ x: 0, y: 0, z: -10 }, { x: 10, y: 0, z: -10 }],
      pathLengthMeters: 10,
    }],
    bands: [{
      progressionBandId: 0,
      accessDomainId: domain,
      roomIds: ['entrance', 'keycardRoom'],
      exitGateId: 'Door_Alpha',
      requiredCredentialIdForExit: 'Keycard_Alpha',
    }, {
      progressionBandId: 1,
      accessDomainId: 'validation-fixture-region:access-domain:band-1',
      roomIds: ['trapRoom'],
      entryGateId: 'Door_Alpha',
      requiredCredentialIdForExit: null,
    }],
    keycards: [{
      id: 'Keycard_Alpha',
      spawnRoomId: 'keycardRoom',
      pairedGateId: 'Door_Alpha',
      progressionTier: 1,
    }],
    doors: [{
      id: 'Door_Alpha',
      requiredCredentialIds: ['Keycard_Alpha'],
      progressionTier: 1,
      leadsToDepthBand: 1,
      critical: true,
    }],
    objectiveRouteIds: [],
    protectedBeatIds: [
      'enemyNestGate', 'keycardGuard', 'Keycard_Alpha', 'Door_Alpha',
      'keycardRoom:grandMechanicalPyramid',
    ],
  };
  const extensionRegions = [{
    id: 'validation-fixture-region',
    themeBinding: THEME_BINDING,
    attachmentSockets: [],
    spliceEdges: [],
    allowedProfileIds: [V4_PROFILE_ID],
    delegatedProgressionBeats: [],
    themeCapabilities: THEME_CAPABILITIES,
    progressionSnapshot: snapshot,
    routeNetworkGrants: [grant],
  }];
  const baseDraft = {
    schema: 'validation-fixture-base-draft/v1',
    basePlanHash: 'validation-fixture-v4-base-plan',
    rooms: [],
    connectionPlans: [],
    occupiedVolumes: [],
    protectedVolumes: [],
  };
  const operationId = v4Id('operation', 0);
  const centers = {
    [v4Id('node', 0)]: { x: 0, y: 0, z: 0 },
    [v4Id('node', 1)]: { x: 12, y: 0, z: 0 },
    // The pyramid loop stays externally in band 0. This module's ramp is an
    // authored room-local transfer and does not lift either route socket.
    [v4Id('node', 2)]: { x: 24, y: 0, z: 0 },
    [v4Id('node', 3)]: { x: 0, y: 0, z: 12 },
  };
  const roles = ['junction', 'challenge', 'elevation', 'reward'];
  const segmentSpecs = [{
    from: { ...sockets[0], socketId: sockets[0].id },
    toNodeId: v4Id('node', 0), toSocketId: `${v4Id('node', 0)}:socket:0`,
    toFacing: { x: 0, y: 0, z: 1 },
    path: (from, to) => [
      { ...from.position },
      { x: from.position.x, y: from.position.y, z: from.position.z + 5.6 },
      { x: to.position.x, y: to.position.y, z: to.position.z + 5.6 },
      { ...to.position },
    ],
  }, {
    fromNodeId: v4Id('node', 0), fromSocketId: `${v4Id('node', 0)}:socket:1`,
    toNodeId: v4Id('node', 1), toSocketId: `${v4Id('node', 1)}:socket:0`,
    fromFacing: { x: 1, y: 0, z: 0 },
    toFacing: { x: -1, y: 0, z: 0 },
  }, {
    fromNodeId: v4Id('node', 1), fromSocketId: `${v4Id('node', 1)}:socket:1`,
    toNodeId: v4Id('node', 2), toSocketId: `${v4Id('node', 2)}:socket:0`,
    fromFacing: { x: 1, y: 0, z: 0 },
    toFacing: { x: -1, y: 0, z: 0 },
    path: (from, to) => [
      { ...from.position },
      { x: from.position.x + 5.6, y: from.position.y, z: from.position.z },
      { x: to.position.x - 5.6, y: to.position.y, z: to.position.z },
      { ...to.position },
    ],
  }, {
    fromNodeId: v4Id('node', 2), fromSocketId: `${v4Id('node', 2)}:socket:1`,
    to: { ...sockets[1], socketId: sockets[1].id },
    fromFacing: { x: 1, y: 0, z: 0 },
  }, {
    fromNodeId: v4Id('node', 0), fromSocketId: `${v4Id('node', 0)}:socket:2`,
    toNodeId: v4Id('node', 3), toSocketId: `${v4Id('node', 3)}:socket:0`,
    fromFacing: { x: 0, y: 0, z: 1 },
    toFacing: { x: 0, y: 0, z: -1 },
  }];
  const nodeSockets = new Map(Object.keys(centers).map((nodeId) => [nodeId, []]));
  const nodeEndpoint = (nodeId, socketId, facing) => ({
    kind: 'supplementSocket',
    id: socketId,
    nodeId,
    socketId,
    position: { ...centers[nodeId] },
    facing: { ...(facing ?? { x: 1, y: 0, z: 0 }) },
  });
  const segments = segmentSpecs.map((spec, index) => {
    const id = v4Id('segment', index);
    const from = spec.from ?? nodeEndpoint(
      spec.fromNodeId,
      spec.fromSocketId,
      spec.fromFacing,
    );
    const to = spec.to ?? nodeEndpoint(spec.toNodeId, spec.toSocketId, spec.toFacing);
    for (const endpoint of [from, to]) {
      if (!nodeSockets.has(endpoint.nodeId)) continue;
      nodeSockets.get(endpoint.nodeId).push({
        id: endpoint.socketId,
        position: { ...endpoint.position },
        facing: { ...endpoint.facing },
        state: 'connected',
        segmentId: id,
      });
    }
    const center = {
      x: (from.position.x + to.position.x) * 0.5,
      y: (from.position.y + to.position.y) * 0.5 + 0.25,
      z: (from.position.z + to.position.z) * 0.5,
    };
    const endpointParentNodeIds = [from.nodeId, to.nodeId];
    return {
      id,
      operationId,
      parentRegionId: 'validation-fixture-region',
      logicalEdgeId: null,
      physicalSegmentId: id,
      from,
      to,
      path: spec.path?.(from, to) ?? [{ ...from.position }, { ...to.position }],
      bidirectional: true,
      connectorFamily: 'service-gallery',
      themeBinding: THEME_BINDING,
      requiredThemeCapabilities: { materials: [], assets: [], connectors: [], transitions: [] },
      landings: [{ position: { ...from.position } }, { position: { ...to.position } }],
      landingVolumes: [from, to].map((endpoint, landingIndex) => ({
        id: `${id}:landing:${landingIndex}`,
        center: { ...endpoint.position, y: endpoint.position.y + 0.25 },
        size: { x: 0.5, y: 0.5, z: 0.5 },
        endpointParentNodeIds,
      })),
      occupiedVolumes: [{
        id: `${id}:occupied`, center, size: { x: 0.5, y: 0.5, z: 0.5 }, endpointParentNodeIds,
      }],
      clearanceVolumes: [{
        id: `${id}:clearance`, center, size: { x: 0.4, y: 0.4, z: 0.4 }, endpointParentNodeIds,
      }],
    };
  });
  const nodes = Object.entries(centers).map(([id, center], index) => {
    const anchors = index === 1
      ? [{ id: `${id}:encounter`, kind: 'encounter', position: { ...center } }]
      : index === 2
        ? [{ id: `${id}:platform`, kind: 'platform', position: { ...center } }]
        : index === 3
          ? [{ id: `${id}:reward`, kind: 'reward', position: { ...center } }]
          : [{ id: `${id}:light`, kind: 'light-fixture', position: { ...center } }];
    return {
      id,
      operationId,
      parentRegionId: 'validation-fixture-region',
      kind: index === 0
        ? 'supplementConnectorJunction'
        : 'supplementRoom',
      grammarId: index === 0
        ? 'supplement-route-connector-through-t-v1'
        : 'supplement-chamber-compact-v1',
      grammarRevision: 1,
      contentRole: roles[index],
      substantive: true,
      countsAsSupplementRoom: index > 0,
      connectorOwned: index === 0,
      connectorInfrastructure: index === 0,
      moduleKind: index === 0 ? 'connector-module' : 'room',
      progressionBandId: 0,
      accessDomainId: domain,
      placement: { center: { ...center }, rotationQuarterTurns: 0 },
      size: index === 0
        ? { x: 14, y: 8.4, z: 19.6 }
        : { x: 19.6, y: 8.4, z: 19.6 },
      occupiedVolumes: [{ id: `${id}:occupied`, center: { ...center, y: center.y + 1 }, size: { x: 2, y: 2, z: 2 } }],
      clearanceVolumes: [{ id: `${id}:clearance`, center: { ...center, y: center.y + 1 }, size: { x: 1, y: 2, z: 1 } }],
      themeBinding: THEME_BINDING,
      requiredThemeCapabilities: { materials: [], assets: [], connectors: [], transitions: [] },
      sockets: nodeSockets.get(id),
      anchors,
      structure: index === 2 ? { ramps: [{ id: `${id}:ramp`, role: 'ramp' }] } : {},
      ...(index === 0 ? {
        junction: {
          junctionKind: 'through-t',
          throughSocketPairs: [[`${id}:socket:0`, `${id}:socket:1`]],
          decisionSocketIds: [`${id}:socket:2`],
          clearCoreVolume: { id: `${id}:clear-core`, center: { ...center, y: center.y + 1 }, size: { x: 1, y: 2, z: 1 } },
          countsAsMeaningfulStation: true,
        },
      } : {}),
    };
  });
  applyV4EndpointContracts({
    segments,
    nodes,
    operationId,
    progressionBandId: 0,
    grant,
  });
  const operation = {
    schema: 'ruindivex-dungeon-augmentation-operation/v1',
    id: operationId,
    type: 'routeNetwork',
    parentRegionId: 'validation-fixture-region',
    themeBinding: THEME_BINDING,
    grantId: grant.id,
    routeNetworkKind: grant.kind,
    endpointSocketIds: sockets.map(({ id }) => id),
    progressionBandId: 0,
    accessDomainId: domain,
    crossedBoundaryIds: [],
    requiredCredentialIds: [],
    sourceGate: null,
    topologyTemplateId: 'parallel-gallery-loop',
    junctionKinds: ['through-t'],
    elevationModes: ['slope'],
    contentRoles: roles,
    localProgressionArc: ['enter', 'challenge', 'mechanism', 'payoff', 'reconnect'],
    stableRuntimeStateIds: {
      encounter: `${operationId}:state:encounter`,
      mechanism: `${operationId}:state:mechanism`,
      reward: `${operationId}:state:reward`,
      shortcut: `${operationId}:state:shortcut`,
    },
    runtimeStateIds: [
      `${operationId}:state:encounter`,
      `${operationId}:state:mechanism`,
      `${operationId}:state:reward`,
      `${operationId}:state:shortcut`,
    ],
    featurelessSpans: segments.map((segment, index) => ({
      id: `${operationId}:physical-featureless-span:${index}`,
      segmentId: segment.id,
      ordinal: index,
      path: structuredClone(segment.path),
      distanceMeters: maximumContinuousLevelPathDistance(segment.path),
      spanKind: 'supplement-physical-route',
      boundedByMeaningfulStations: true,
    })),
    maximumFeaturelessSpanMeters: 33.6,
    cycleRankDelta: 1,
    nodeIds: nodes.map(({ id }) => id),
    moduleCount: 4,
    substantiveModuleCount: 4,
    physicalNodeCount: 4,
    roomCount: 3,
    roomNodeIds: nodes.slice(1).map(({ id }) => id),
    connectorModuleCount: 0,
    connectorModuleNodeIds: [],
    connectorJunctionCount: 1,
    connectorJunctionNodeIds: [nodes[0].id],
    connectorInfrastructureCount: 1,
    connectorInfrastructureNodeIds: [nodes[0].id],
    segmentIds: segments.map(({ id }) => id),
    bidirectional: true,
    returnRouteGuaranteed: true,
    protectedVolumes: structuredClone(grant.protectedVolumes),
    socketLandingOverlapGrants: structuredClone(grant.socketLandingOverlapGrants),
    socketModuleOverlapGrants: [],
    mustPreserveBeatIds: structuredClone(grant.mustPreserveBeatIds),
  };
  const plan = {
    schema: 'ruindivex-dungeon-augmentation-overlay/v2',
    revision: 2,
    profileId: V4_PROFILE_ID,
    profileRevision: 5,
    basePlanHash: baseDraft.basePlanHash,
    baseDraftFingerprint: 'validation-fixture-v4-fingerprint',
    augmentationSeed: 'validation-fixture-v4-augmentation',
    layoutSeed: 'validation-fixture-v4-layout',
    difficulty: 2,
    operations: [operation],
    nodes,
    segments,
    transitionBays: [],
    progressionAssignments: [],
    themeBindings: [THEME_BINDING],
  };
  rehash(plan);
  return { fixture: { baseDraft, extensionRegions }, plan };
}

function appendV4CrossBandShortcutFixture(fixture, plan, {
  elevationMode = 'shortcut-lift',
} = {}) {
  const sourceOperation = plan.operations[0];
  const sourcePrefix = 'supplement:validation-fixture-region:routenetwork:0:';
  const shortcutPrefix = 'supplement:validation-fixture-region:routenetwork:1:';
  const translateIds = (value) => JSON.parse(
    JSON.stringify(value).replaceAll(sourcePrefix, shortcutPrefix),
  );
  const operation = translateIds(sourceOperation);
  const nodes = translateIds(plan.nodes.filter(({ operationId }) => (
    operationId === sourceOperation.id
  )));
  const segments = translateIds(plan.segments.filter(({ operationId }) => (
    operationId === sourceOperation.id
  )));
  const shiftPoint = (point) => {
    if (point && Number.isFinite(Number(point.x))) point.x = Number(point.x) + 200;
  };
  for (const node of nodes) {
    shiftPoint(node.placement?.center);
    for (const record of [
      ...(node.sockets ?? []),
      ...(node.anchors ?? []),
      ...(node.occupiedVolumes ?? []),
      ...(node.clearanceVolumes ?? []),
    ]) shiftPoint(record.position ?? record.center);
    shiftPoint(node.junction?.clearCoreVolume?.center);
    node.progressionBandId = 1;
    node.accessDomainId = 'validation-fixture-region:access-domain:band-1';
  }
  for (const segment of segments) {
    shiftPoint(segment.from?.position);
    shiftPoint(segment.to?.position);
    for (const point of segment.path ?? []) shiftPoint(point);
    for (const landing of segment.landings ?? []) shiftPoint(landing.position);
    for (const record of [
      ...(segment.landingVolumes ?? []),
      ...(segment.occupiedVolumes ?? []),
      ...(segment.clearanceVolumes ?? []),
    ]) shiftPoint(record.center);
  }
  // Give the one-way transfer family enough straight machinery run while
  // keeping both endpoint vestibules aligned with their exact sockets.
  const elevationNode = nodes[2];
  const shiftElevationNodePoint = (point) => {
    if (point && Number.isFinite(Number(point.x))) point.x = Number(point.x) + 32;
  };
  shiftElevationNodePoint(elevationNode.placement?.center);
  for (const record of [
    ...(elevationNode.sockets ?? []),
    ...(elevationNode.anchors ?? []),
    ...(elevationNode.occupiedVolumes ?? []),
    ...(elevationNode.clearanceVolumes ?? []),
  ]) shiftElevationNodePoint(record.position ?? record.center);
  shiftElevationNodePoint(elevationNode.junction?.clearCoreVolume?.center);
  shiftElevationNodePoint(segments[2].to?.position);
  shiftElevationNodePoint(segments[3].from?.position);
  shiftElevationNodePoint(segments[3].path?.[0]);
  shiftElevationNodePoint(segments[2].landingVolumes?.[1]?.center);
  shiftElevationNodePoint(segments[3].landingVolumes?.[0]?.center);
  const raiseElevationNodePoint = (point) => {
    if (point && Number.isFinite(Number(point.y))) point.y = Number(point.y) + 14;
  };
  raiseElevationNodePoint(elevationNode.placement?.center);
  for (const record of [
    ...(elevationNode.sockets ?? []),
    ...(elevationNode.anchors ?? []),
    ...(elevationNode.occupiedVolumes ?? []),
    ...(elevationNode.clearanceVolumes ?? []),
  ]) raiseElevationNodePoint(record.position ?? record.center);
  raiseElevationNodePoint(elevationNode.junction?.clearCoreVolume?.center);
  raiseElevationNodePoint(segments[2].to?.position);
  raiseElevationNodePoint(segments[3].from?.position);
  raiseElevationNodePoint(segments[3].path?.[0]);
  raiseElevationNodePoint(segments[2].landingVolumes?.[1]?.center);
  raiseElevationNodePoint(segments[3].landingVolumes?.[0]?.center);
  const domain0 = 'validation-fixture-region:access-domain:band-0';
  const domain1 = 'validation-fixture-region:access-domain:band-1';
  const shallowSocket = {
    ...structuredClone(fixture.extensionRegions[0].routeNetworkGrants[0].endpointSockets[0]),
    id: 'validation-fixture-region:socket:keycardRoom:shortcut-south',
    position: { x: 188, y: 0, z: 0 },
    progressionBandId: 0,
    accessDomainId: domain0,
  };
  const deepSocket = {
    ...structuredClone(fixture.extensionRegions[0].routeNetworkGrants[0].endpointSockets[1]),
    id: 'validation-fixture-region:socket:trapRoom:shortcut-west',
    nodeId: 'trapRoom',
    roomId: 'trapRoom',
    position: { x: 288, y: 14, z: 0 },
    progressionBandId: 1,
    accessDomainId: domain1,
  };
  const grantId = 'validation-fixture-region:route-network-grant:cross-band-shortcut';
  const sourceGate = {
    gateId: `${grantId}:source-gate:${shallowSocket.id}`,
    gatePlacementSide: 'source',
    sourceGateSocketId: shallowSocket.id,
    shallowEndpointSocketIds: [shallowSocket.id],
    crossedBoundaryIds: ['Door_Alpha'],
    requiredCredentialIds: ['Keycard_Alpha'],
    requiredKeycardId: 'Keycard_Alpha',
    encounterRequirementId: null,
    supplementalIdentity: true,
  };
  const landingOverlap = (socket) => {
    const horizontal = Math.abs(Number(socket.facing.x)) > 0;
    return {
      id: `${socket.id}:landing-overlap:shortcut`,
      socketId: socket.id,
      center: { ...socket.position, y: Number(socket.position.y) + 1.8 },
      size: {
        x: horizontal ? 14 : 8.4,
        y: 3.6,
        z: horizontal ? 8.4 : 14,
      },
      purpose: 'route-network-doorway-landing-overlap',
      widthTiles: 3,
      insideDepthTiles: 2,
      outsideDepthTiles: 2,
      maximumBoundaryDepthTiles: 2,
    };
  };
  const grant = {
    schema: 'ruindivex-dungeon-route-network-grant/v2',
    id: grantId,
    required: false,
    kind: 'cross-band-shortcut',
    endpointSockets: [shallowSocket, deepSocket],
    shallowEndpointSocketIds: [shallowSocket.id],
    shallowProgressionBandId: 0,
    deepProgressionBandId: 1,
    progressionBandId: 1,
    accessDomainId: domain1,
    crossedBoundaryIds: ['Door_Alpha'],
    requiredCredentialIds: ['Keycard_Alpha'],
    sourceGate,
    protectedVolumes: [],
    socketLandingOverlapGrants: [landingOverlap(shallowSocket), landingOverlap(deepSocket)],
    mustPreserveBeatIds: ['keycardRoom', 'trapRoom', 'Door_Alpha', 'Keycard_Alpha'],
    minimumModules: 3,
    maximumModules: 6,
    shortcutActivationSide: 'far-side',
    allowedElevationModes: ['shortcut-lift', 'drop-ladder'],
  };

  const shallowSegment = segments[0];
  shallowSegment.from = {
    ...structuredClone(shallowSocket),
    kind: 'parentSocket',
    socketId: shallowSocket.id,
  };
  shallowSegment.path[0] = { ...shallowSocket.position };
  shallowSegment.sourceGate = structuredClone(sourceGate);
  shallowSegment.gatePlacementSide = 'source';
  shallowSegment.sourceGateSocketId = shallowSocket.id;
  shallowSegment.gateEndpointRole = 'from';
  shallowSegment.requiredCredentialIds = ['Keycard_Alpha'];
  const deepSegment = segments[3];
  deepSegment.to = {
    ...structuredClone(deepSocket),
    kind: 'parentSocket',
    socketId: deepSocket.id,
  };
  deepSegment.path[deepSegment.path.length - 1] = { ...deepSocket.position };
  const elevationSegment = segments[2];
  const shortcutContract = elevationMode === 'shortcut-lift'
    ? {
      kind: 'shortcut-lift',
      initialState: 'unavailable',
      activatedState: 'available',
      connectorFamily: 'lift',
    }
    : {
      kind: 'drop-ladder',
      initialState: 'retracted',
      activatedState: 'deployed',
      connectorFamily: 'ladder',
    };
  elevationSegment.connectorFamily = shortcutContract.connectorFamily;
  elevationSegment.path = [
    { ...elevationSegment.from.position },
    {
      x: elevationSegment.from.position.x + 5.6,
      y: elevationSegment.from.position.y,
      z: elevationSegment.from.position.z,
    },
    {
      x: elevationSegment.to.position.x - 5.6,
      y: elevationSegment.to.position.y,
      z: elevationSegment.to.position.z,
    },
    { ...elevationSegment.to.position },
  ];
  elevationSegment.verticalTransfer = true;
  elevationSegment.traversalKind = shortcutContract.connectorFamily;
  elevationSegment.direction = 'ascending';
  elevationSegment.sourceElevation = 0;
  elevationSegment.destinationElevation = 14;
  elevationSegment.elevationDelta = 14;
  elevationSegment.traversal = {
    kind: shortcutContract.connectorFamily,
    direction: 'ascending',
    elevationDelta: 14,
  };
  elevationSegment.shortcut = {
    kind: shortcutContract.kind,
    stateId: operation.stableRuntimeStateIds.shortcut,
    initialState: shortcutContract.initialState,
    activationSide: 'far',
    activatedState: shortcutContract.activatedState,
    persistent: true,
  };

  operation.grantId = grant.id;
  operation.routeNetworkKind = grant.kind;
  operation.endpointSocketIds = [shallowSocket.id, deepSocket.id];
  operation.shallowEndpointSocketIds = [shallowSocket.id];
  operation.progressionBandId = 1;
  operation.accessDomainId = domain1;
  operation.crossedBoundaryIds = ['Door_Alpha'];
  operation.requiredCredentialIds = ['Keycard_Alpha'];
  operation.sourceGate = structuredClone(sourceGate);
  operation.elevationModes = [elevationMode];
  operation.protectedVolumes = [];
  operation.socketLandingOverlapGrants = structuredClone(grant.socketLandingOverlapGrants);
  operation.mustPreserveBeatIds = structuredClone(grant.mustPreserveBeatIds);
  operation.featurelessSpans = segments.map((segment, index) => ({
    id: `${operation.id}:physical-featureless-span:${index}`,
    segmentId: segment.id,
    ordinal: index,
    ...(segment.verticalTransfer === true
      ? { transitionPath: structuredClone(segment.path), meaningfulTransition: true }
      : { path: structuredClone(segment.path) }),
    distanceMeters: maximumContinuousLevelPathDistance(segment.path),
    spanKind: segment.verticalTransfer === true
      ? 'supplement-horizontal-approach-to-elevation-transition'
      : 'supplement-physical-route',
    boundedByMeaningfulStations: true,
  }));

  applyV4EndpointContracts({
    segments,
    nodes,
    operationId: operation.id,
    progressionBandId: 1,
    grant,
  });

  fixture.extensionRegions[0].routeNetworkGrants.push(grant);
  plan.operations.push(operation);
  plan.nodes.push(...nodes);
  plan.segments.push(...segments);
  rehash(plan);
  return { operation, grant, nodes, segments, shallowSocket, deepSocket };
}

function validateV4(plan, fixture) {
  return validateDungeonAugmentationPlan(plan, {
    ...fixture,
    profiles: { [V4_PROFILE_ID]: V4_PROFILE },
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  });
}

function makeParentAnchoredForestValidationFixture() {
  const result = makeV4ValidationFixture();
  const { plan } = result;
  applyValidV4SelectionManifest(plan);
  const operation = plan.operations[0];
  const retainedNodeIds = new Set(operation.nodeIds.slice(0, 1));
  const retainedSegmentIds = new Set(operation.segmentIds.slice(0, 1));
  const omittedNodes = plan.nodes.filter((node) => !retainedNodeIds.has(node.id));
  const omittedSegments = plan.segments.filter((segment) => !retainedSegmentIds.has(segment.id));
  const rootSignatureByNodeId = new Map(omittedNodes.map((node) => ([
    node.id,
    createRouteNetworkConflictEntitySignature(node, 'node'),
  ])));
  plan.routeNetworkConflictExclusions = omittedNodes.map((node) => ({
    grantId: operation.grantId,
    entityKind: 'node',
    entityId: node.id,
    signature: rootSignatureByNodeId.get(node.id),
    reason: 'synthetic-forest-node-conflict',
  }));
  const rootForSegment = (segment) => omittedNodes.find((node) => (
    [segment.from?.nodeId, segment.to?.nodeId].map(String).includes(String(node.id))
  ));
  const fallbackRootSignature = [...rootSignatureByNodeId.values()].sort()[0];
  plan.routeNetworkEntityOmissions = [
    ...omittedNodes.map((node, ordinal) => ({
      grantId: operation.grantId,
      operationId: operation.id,
      entityKind: 'node',
      entityId: node.id,
      ordinal: ordinal + 1,
      signature: rootSignatureByNodeId.get(node.id),
      disposition: 'conflict-root',
      reason: 'synthetic-forest-node-conflict',
      rootSignature: rootSignatureByNodeId.get(node.id),
    })),
    ...omittedSegments.map((segment) => {
      const root = rootForSegment(segment);
      return {
        grantId: operation.grantId,
        operationId: operation.id,
        entityKind: 'segment',
        entityId: segment.id,
        ordinal: Number(segment.id.split(':').at(-1)),
        signature: createRouteNetworkConflictEntitySignature(segment, 'segment'),
        disposition: 'dependency',
        reason: 'endpoint-depends-on-omitted-node',
        rootSignature: root
          ? rootSignatureByNodeId.get(root.id)
          : fallbackRootSignature,
      };
    }),
  ];
  plan.nodes = plan.nodes.filter((node) => retainedNodeIds.has(node.id));
  plan.segments = plan.segments.filter((segment) => retainedSegmentIds.has(segment.id));
  for (const node of plan.nodes) {
    node.sockets = node.sockets.filter((socket) => retainedSegmentIds.has(String(socket.segmentId)));
  }
  const retainedRoom = plan.nodes[0];
  retainedRoom.kind = 'supplementRoom';
  retainedRoom.grammarId = 'supplement-chamber-compact-v1';
  retainedRoom.blueprintId = `${retainedRoom.id}:retained-room-blueprint`;
  retainedRoom.contentRole = 'challenge';
  retainedRoom.countsAsSupplementRoom = true;
  retainedRoom.connectorOwned = false;
  retainedRoom.connectorInfrastructure = false;
  retainedRoom.moduleKind = 'room';
  retainedRoom.anchors = [{
    id: `${retainedRoom.id}:retained-encounter`,
    kind: 'encounter',
    encounterProfileId: 'supplement-route-network-defense',
    position: structuredClone(retainedRoom.placement.center),
  }];
  delete retainedRoom.junction;
  const retainedSocketId = operation.endpointSocketIds[0];
  const omittedSocketId = operation.endpointSocketIds[1];
  operation.realizationMode = 'parent-anchored-forest';
  operation.endpointSocketIds = [retainedSocketId];
  operation.omittedEndpointSocketIds = [omittedSocketId];
  operation.parentAnchoredComponents = [{
    id: `${operation.id}:parent-anchored-component:0`,
    attachmentSocketId: retainedSocketId,
    nodeIds: [...retainedNodeIds],
    segmentIds: [...retainedSegmentIds],
    bidirectional: true,
  }];
  operation.nodeIds = [...retainedNodeIds];
  operation.segmentIds = [...retainedSegmentIds];
  operation.contentRoles = plan.nodes.map(({ contentRole }) => contentRole);
  operation.moduleCount = 1;
  operation.substantiveModuleCount = 1;
  operation.physicalNodeCount = 1;
  operation.roomCount = 1;
  operation.roomNodeIds = [retainedRoom.id];
  operation.connectorModuleCount = 0;
  operation.connectorModuleNodeIds = [];
  operation.connectorJunctionCount = 0;
  operation.connectorJunctionNodeIds = [];
  operation.connectorInfrastructureCount = 0;
  operation.connectorInfrastructureNodeIds = [];
  operation.featurelessSpans = plan.segments.map((segment, ordinal) => ({
    id: `${operation.id}:physical-featureless-span:${ordinal}`,
    segmentId: segment.id,
    ordinal,
    path: structuredClone(segment.path),
    distanceMeters: maximumContinuousLevelPathDistance(segment.path),
    spanKind: 'supplement-physical-route',
    boundedByMeaningfulStations: true,
  }));
  operation.localProgressionArc = ['enter', 'challenge'];
  operation.cycleRankDelta = 0;
  operation.returnRouteGuaranteed = false;
  plan.completionMode = 'best-effort-partial';
  plan.prunedRouteNetworkGrants = [];
  rehash(plan);
  return result;
}

test('V4 accepts a non-vacuous audited parent-anchored forest with a retained endpoint subset', () => {
  const { fixture, plan } = makeParentAnchoredForestValidationFixture();
  const operation = plan.operations[0];
  assert.equal(operation.endpointSocketIds.length, 1);
  assert.equal(operation.omittedEndpointSocketIds.length, 1);
  assert.equal(operation.moduleCount, 1, 'fixture is below the grant minimum');
  assert.deepEqual(operation.localProgressionArc, ['enter', 'challenge']);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors));
});

test('V4 parent-anchored forests reject components that do not partition retained modules', () => {
  const { fixture, plan } = makeParentAnchoredForestValidationFixture();
  plan.operations[0].parentAnchoredComponents[0].nodeIds.pop();
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.ok(validation.errors.some(({ code }) => (
    code === 'route-network-parent-anchored-component-partition-invalid'
  )));
});

test('V4 parent-anchored forests retain generic connector-junction degree checks', () => {
  const { fixture, plan } = makeParentAnchoredForestValidationFixture();
  const operation = plan.operations[0];
  const node = plan.nodes[0];
  node.kind = 'supplementConnectorJunction';
  node.grammarId = 'supplement-route-connector-through-t-v1';
  node.countsAsSupplementRoom = false;
  node.connectorOwned = true;
  node.connectorInfrastructure = true;
  node.moduleKind = 'connector-module';
  node.junction = {
    junctionKind: 'through-t',
    throughSocketPairs: [],
    decisionSocketIds: [],
    clearCoreVolume: {
      id: `${node.id}:retained-clear-core`,
      center: structuredClone(node.placement.center),
      size: { x: 1, y: 2, z: 1 },
    },
    countsAsMeaningfulStation: true,
  };
  operation.moduleCount = 0;
  operation.substantiveModuleCount = 0;
  operation.roomCount = 0;
  operation.roomNodeIds = [];
  operation.connectorJunctionCount = 1;
  operation.connectorJunctionNodeIds = [node.id];
  operation.connectorInfrastructureCount = 1;
  operation.connectorInfrastructureNodeIds = [node.id];
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.ok(validation.errors.some(({ code }) => (
    code === 'route-network-connector-junction-degree-invalid'
  )), JSON.stringify(validation.errors));
});

test('V4 best-effort overlays retain valid networks with an exact pruned-grant ledger', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const prunedGrant = structuredClone(fixture.extensionRegions[0].routeNetworkGrants[0]);
  prunedGrant.id = `${prunedGrant.id}:pruned`;
  fixture.extensionRegions[0].routeNetworkGrants.push(prunedGrant);
  plan.completionMode = 'best-effort-partial';
  plan.prunedRouteNetworkGrants = [{
    grantId: prunedGrant.id,
    parentRegionId: fixture.extensionRegions[0].id,
    routeNetworkKind: prunedGrant.kind,
    operationOrdinal: 1,
    reason: 'route-network-node-placement-collision',
  }];
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors));
  assert.ok(validation.warnings.some(({ code, context }) => (
    code === 'required-route-network-grant-pruned'
      && context?.grantId === prunedGrant.id
  )));
});

test('V4 validation never turns an exact entity conflict into whole-grant pruning', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const retainedOperation = plan.operations.find(({ type }) => type === 'routeNetwork');
  const prunedGrant = structuredClone(fixture.extensionRegions[0].routeNetworkGrants[0]);
  prunedGrant.id = `${prunedGrant.id}:exact-conflict-pruned`;
  fixture.extensionRegions[0].routeNetworkGrants.push(prunedGrant);
  plan.completionMode = 'best-effort-partial';
  plan.prunedRouteNetworkGrants = [{
    grantId: prunedGrant.id,
    parentRegionId: fixture.extensionRegions[0].id,
    routeNetworkKind: prunedGrant.kind,
    operationOrdinal: 1,
    reason: 'route-network-node-placement-collision',
  }];
  plan.routeNetworkConflictExclusions = [{
    grantId: prunedGrant.id,
    entityKind: 'node',
    entityId: 'node:rejected-candidate',
    signature: 'physical-signature:rejected-candidate',
    reason: 'synthetic-exact-conflict',
  }];
  rehash(plan);

  const protectedValidation = validateV4(plan, fixture);
  assert.ok(protectedValidation.errors.some(({ code, context }) => (
    code === 'route-network-conflict-exclusion-grant-pruned'
      && context?.grantId === prunedGrant.id
      && context?.conflictExclusionCount === 1
  )));

  plan.prunedRouteNetworkGrants[0] = {
    ...plan.prunedRouteNetworkGrants[0],
    reason: 'route-network-conflict-exclusion-replacements-exhausted',
    recoveryKind: 'exact-conflict-replacements-exhausted',
    conflictExclusionCount: 1,
    conflictEntityKinds: ['node'],
    replacementExhaustionKind: 'candidate-domain-exhausted',
  };
  rehash(plan);
  const exhaustedValidation = validateV4(plan, fixture);
  assert.ok(exhaustedValidation.errors.some(({ code, context }) => (
    code === 'route-network-conflict-exclusion-grant-pruned'
      && context?.grantId === prunedGrant.id
      && context?.recoveryKind === 'exact-conflict-replacements-exhausted'
  )), 'candidate-domain exhaustion cannot delete the affected grant');

  plan.prunedRouteNetworkGrants[0].replacementExhaustionKind = 'bounded-search-exhausted';
  rehash(plan);
  const mismatchedBoundedValidation = validateV4(plan, fixture);
  assert.ok(mismatchedBoundedValidation.errors.some(({ code }) => (
    code === 'route-network-conflict-exclusion-grant-pruned'
  )), 'bounded exhaustion must carry its exact bounded reason');

  plan.prunedRouteNetworkGrants[0].reason =
    'route-network-conflict-exclusion-bounded-search-exhausted';
  rehash(plan);
  const boundedValidation = validateV4(plan, fixture);
  assert.ok(boundedValidation.errors.some(({ code }) => (
    code === 'route-network-conflict-exclusion-grant-pruned'
  )), 'bounded exhaustion cannot delete the affected grant');

  plan.routeNetworkConflictExclusions[0].grantId = retainedOperation.grantId;
  rehash(plan);
  const orphanedMarkerValidation = validateV4(plan, fixture);
  assert.ok(orphanedMarkerValidation.errors.some(({ code }) => (
    code === 'route-network-conflict-exclusion-grant-pruned'
  )), 'the exact exhaustion marker cannot outlive its matching exclusion evidence');

  plan.prunedRouteNetworkGrants[0] = {
    grantId: prunedGrant.id,
    parentRegionId: fixture.extensionRegions[0].id,
    routeNetworkKind: prunedGrant.kind,
    operationOrdinal: 1,
    reason: 'route-network-node-placement-collision',
  };
  rehash(plan);
  const unrelatedValidation = validateV4(plan, fixture);
  assert.equal(
    unrelatedValidation.errors.some(({ code }) => (
      code === 'route-network-conflict-exclusion-grant-pruned'
    )),
    false,
  );
  assert.equal(unrelatedValidation.accepted, true, JSON.stringify(unrelatedValidation.errors));
});

test('terminal exact-conflict exhaustion cannot accept an empty supplemental overlay', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const grant = fixture.extensionRegions[0].routeNetworkGrants[0];
  plan.operations = [];
  plan.nodes = [];
  plan.segments = [];
  plan.themeBindings = [];
  plan.completionMode = 'best-effort-partial';
  plan.routeNetworkConflictExclusions = [{
    grantId: grant.id,
    entityKind: 'segment',
    entityId: 'segment:rejected-final-network',
    signature: 'physical-signature:rejected-final-network',
    reason: 'synthetic-final-network-conflict',
  }];
  plan.prunedRouteNetworkGrants = [{
    grantId: grant.id,
    parentRegionId: fixture.extensionRegions[0].id,
    routeNetworkKind: grant.kind,
    operationOrdinal: 0,
    reason: 'route-network-conflict-exclusion-replacements-exhausted',
    recoveryKind: 'exact-conflict-replacements-exhausted',
    conflictExclusionCount: 1,
    conflictEntityKinds: ['segment'],
    replacementExhaustionKind: 'candidate-domain-exhausted',
  }];
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.ok(validation.errors.some(({ code }) => (
    code === 'best-effort-route-network-overlay-empty'
  )));
  assert.equal(validation.accepted, false);
});

test('V4 validation rejects an accepted entity that exactly matches its conflict exclusion', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const operation = plan.operations.find(({ type }) => type === 'routeNetwork');
  const node = plan.nodes.find(({ operationId }) => operationId === operation.id);
  plan.routeNetworkConflictExclusions = [{
    grantId: operation.grantId,
    entityKind: 'node',
    entityId: node.id,
    signature: createRouteNetworkConflictEntitySignature(node, 'node'),
    reason: 'synthetic-validation-conflict',
  }];
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'route-network-conflict-exclusion-still-realized'
      && context?.entityId === node.id
  )));
});

test('V4 validation matches a physical conflict after its ordinal entity ID changes', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const operation = plan.operations.find(({ type }) => type === 'routeNetwork');
  const node = plan.nodes.find(({ operationId }) => operationId === operation.id);
  const evidenceEntityId = `${node.id}:previous-candidate-ordinal`;
  plan.routeNetworkConflictExclusions = [{
    grantId: operation.grantId,
    entityKind: 'node',
    entityId: evidenceEntityId,
    signature: createRouteNetworkConflictEntitySignature(node, 'node'),
    reason: 'synthetic-renumbered-validation-conflict',
  }];
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'route-network-conflict-exclusion-still-realized'
      && context?.entityId === evidenceEntityId
      && context?.matchedEntityId === node.id
  )));
});

test('V4 best-effort overlays reject forged ordinals and realized pruned grants', () => {
  const wrongOrdinal = makeV4ValidationFixture();
  const omittedGrant = structuredClone(
    wrongOrdinal.fixture.extensionRegions[0].routeNetworkGrants[0],
  );
  omittedGrant.id = `${omittedGrant.id}:pruned`;
  wrongOrdinal.fixture.extensionRegions[0].routeNetworkGrants.push(omittedGrant);
  wrongOrdinal.plan.completionMode = 'best-effort-partial';
  wrongOrdinal.plan.prunedRouteNetworkGrants = [{
    grantId: omittedGrant.id,
    parentRegionId: wrongOrdinal.fixture.extensionRegions[0].id,
    routeNetworkKind: omittedGrant.kind,
    operationOrdinal: 99,
    reason: 'route-network-node-placement-collision',
  }];
  rehash(wrongOrdinal.plan);
  assert.ok(validateV4(wrongOrdinal.plan, wrongOrdinal.fixture).errors.some(({ code }) => (
    code === 'route-network-pruned-grant-ledger-mismatch'
  )));

  const stillRealized = makeV4ValidationFixture();
  const realizedGrant = stillRealized.fixture.extensionRegions[0].routeNetworkGrants[0];
  stillRealized.plan.completionMode = 'best-effort-partial';
  stillRealized.plan.prunedRouteNetworkGrants = [{
    grantId: realizedGrant.id,
    parentRegionId: stillRealized.fixture.extensionRegions[0].id,
    routeNetworkKind: realizedGrant.kind,
    operationOrdinal: 0,
    reason: 'route-network-node-placement-collision',
  }];
  rehash(stillRealized.plan);
  assert.ok(validateV4(stillRealized.plan, stillRealized.fixture).errors.some(({ code }) => (
    code === 'route-network-pruned-grant-still-realized'
  )));
});

function createSelectionWitnessSequence(family, selectedIds) {
  const order = [...new Set(selectedIds.map(String))];
  let state = { cycle: 0, consumedIds: [] };
  return selectedIds.map((selectedValue) => {
    const selectedId = String(selectedValue);
    const consumed = new Set(state.consumedIds);
    const refilled = order.every((id) => consumed.has(id));
    const after = {
      cycle: state.cycle + (refilled ? 1 : 0),
      consumedIds: [
        ...(refilled ? [] : order.filter((id) => consumed.has(id))),
        selectedId,
      ],
    };
    const witness = createDungeonSelectionBagWitness({
      family,
      bag: { order, ...state },
      legalIds: order,
      selection: { id: selectedId, refilled, state: after },
    });
    state = after;
    return witness;
  });
}

function applyValidV4SelectionManifest(plan, operation = plan.operations[0]) {
  const nodeById = new Map(plan.nodes.map((node) => [String(node.id), node]));
  const nodeOrdinal = (nodeId) => operation.nodeIds.findIndex((id) => (
    String(id) === String(nodeId)
  ));
  const junctions = (operation.junctionKinds ?? []).map((junctionKind, index) => ({
    nodeOrdinal: nodeOrdinal(operation.connectorJunctionNodeIds?.[index]) >= 0
      ? nodeOrdinal(operation.connectorJunctionNodeIds[index])
      : index,
    junctionKind: String(junctionKind),
  }));
  const roomLayouts = (operation.roomNodeIds ?? []).map((nodeId) => {
    const node = nodeById.get(String(nodeId));
    return {
      nodeOrdinal: nodeOrdinal(nodeId),
      grammarId: String(node?.grammarId ?? ''),
      contentRole: String(node?.contentRole ?? ''),
      topologyKit: false,
    };
  });
  const encounters = (operation.nodeIds ?? []).flatMap((nodeId) => {
    const node = nodeById.get(String(nodeId));
    return (node?.anchors ?? []).some(({ kind }) => kind === 'encounter')
      ? [{
        nodeOrdinal: nodeOrdinal(nodeId),
        encounterProfileId: 'supplement-route-network-defense',
      }]
      : [];
  });
  const topologyTemplateId = String(operation.topologyTemplateId);
  const elevationMode = String(operation.elevationModes[0]);
  const normalizedSemanticSignature = canonicalStringify({
    topologyTemplateId,
    elevationMode,
    junctions,
    roomLayouts,
    encounters,
  });
  const selectedIdsByFamily = {
    topology: [topologyTemplateId],
    elevation: [elevationMode],
    junction: junctions.map(({ junctionKind }) => junctionKind),
    roomLayout: roomLayouts.map(({ grammarId }) => grammarId),
    encounter: encounters.map(({ encounterProfileId }) => encounterProfileId),
  };
  assert.ok(DUNGEON_SELECTION_BAG_FAMILIES.every((family) => (
    selectedIdsByFamily[family].length > 0
  )));
  operation.selectionManifest = {
    schema: 'ruindivex-dungeon-route-network-selection-manifest/v1',
    solveDecisionOrdinal: 0,
    topology: { id: topologyTemplateId, cycle: 0, refilled: false },
    elevation: { id: elevationMode, cycle: 0, refilled: false },
    junctions,
    roomLayouts,
    encounters,
    normalizedSemanticSignature,
    bagWitnesses: Object.fromEntries(DUNGEON_SELECTION_BAG_FAMILIES.map((family) => [
      family,
      createSelectionWitnessSequence(family, selectedIdsByFamily[family]),
    ])),
  };
  operation.normalizedSemanticSignature = normalizedSemanticSignature;
  rehash(plan);
  return operation.selectionManifest;
}

function appendSharedJunctionThresholdCoverageFixture(fixture, plan) {
  const region = fixture.extensionRegions[0];
  const snapshot = region.progressionSnapshot;
  const coveredConnection = snapshot.connections.find(({ id }) => (
    id === 'entrance_keycardRoom'
  ));
  coveredConnection.centerline = [
    { x: -10, y: 0, z: -10 },
    { x: 32, y: 0, z: -10 },
  ];
  coveredConnection.pathLengthMeters = 42;
  coveredConnection.ordinaryTraversalSpans = [{
    startDistanceMeters: 0,
    endDistanceMeters: 42,
    lengthMeters: 42,
    elevation: 0,
  }];
  snapshot.objectiveRouteIds = [coveredConnection.logicalEdgeId];

  const operationId = 'supplement:validation-fixture-region:routenetwork:1:operation:0';
  const nodeIds = Array.from({ length: 4 }, (_, index) => (
    `supplement:validation-fixture-region:routenetwork:1:node:${index}`
  ));
  const segmentIds = Array.from({ length: 6 }, (_, index) => (
    `supplement:validation-fixture-region:routenetwork:1:segment:${index}`
  ));
  const domain = 'validation-fixture-region:access-domain:band-0';
  const stationSockets = [{
    id: 'validation-fixture-region:route-socket:entrance_keycardRoom:0',
    nodeId: 'keycardRoom',
    roomId: 'keycardRoom',
    logicalEdgeId: coveredConnection.logicalEdgeId,
    routeNetworkSocketKind: 'authored-corridor-station',
    position: { x: 100, y: 0, z: -15.4 },
    facing: { x: 0, y: 0, z: 1 },
    widthMeters: 8.4,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    clearanceHeightMeters: 3.6,
    coordinateSpace: 'parent-plan',
    distanceMeters: 14,
    progressionBandId: 0,
    accessDomainId: domain,
  }, {
    id: 'validation-fixture-region:route-socket:entrance_keycardRoom:1',
    nodeId: 'keycardRoom',
    roomId: 'keycardRoom',
    logicalEdgeId: coveredConnection.logicalEdgeId,
    routeNetworkSocketKind: 'authored-corridor-station',
    position: { x: 114, y: 0, z: -15.4 },
    facing: { x: 0, y: 0, z: 1 },
    widthMeters: 8.4,
    heightMeters: 3.6,
    landingWidthTiles: 3,
    clearanceHeightMeters: 3.6,
    coordinateSpace: 'parent-plan',
    distanceMeters: 28,
    progressionBandId: 0,
    accessDomainId: domain,
  }];
  const socketLandingOverlapGrants = stationSockets.map((socket) => ({
    id: `${socket.id}:landing-overlap`,
    socketId: socket.id,
    center: { ...socket.position, y: 1.8 },
    size: { x: 8.4, y: 3.6, z: 14 },
    purpose: 'route-network-doorway-landing-overlap',
    widthTiles: 3,
    insideDepthTiles: 2,
    outsideDepthTiles: 2,
    maximumBoundaryDepthTiles: 2,
  }));
  const coverage = {
    logicalEdgeId: coveredConnection.logicalEdgeId,
    physicalConnectionId: coveredConnection.id,
    pathLengthMeters: 42,
    stationDistancesMeters: [14, 28],
    featurelessSpansMeters: [14, 14, 14],
    ordinaryTraversalSpans: structuredClone(coveredConnection.ordinaryTraversalSpans),
    directionChangeCount: 0,
    maximumFeaturelessSpanMeters: 33.6,
    coverageComplete: true,
  };
  const grant = {
    schema: 'ruindivex-dungeon-route-network-grant/v2',
    id: 'validation-fixture-region:route-network-grant:coverage:entrance_keycardRoom',
    required: true,
    kind: 'objective-route-coverage',
    endpointSockets: stationSockets,
    progressionBandId: 0,
    accessDomainId: domain,
    crossedBoundaryIds: [],
    requiredCredentialIds: [],
    sourceGate: null,
    protectedVolumes: [],
    socketLandingOverlapGrants,
    socketModuleOverlapGrants: [],
    mustPreserveBeatIds: ['entrance', 'keycardRoom'],
    minimumModules: 3,
    maximumModules: 6,
    coverage,
  };
  region.routeNetworkGrants.push(grant);

  const parentEndpoint = (socket) => ({
    kind: 'parentSocket',
    id: socket.id,
    nodeId: socket.nodeId,
    socketId: socket.id,
    position: { ...socket.position },
    facing: { ...socket.facing },
  });
  const supplementEndpoint = (nodeIndex, localSocketId, position, facing) => ({
    kind: 'supplementSocket',
    id: `${nodeIds[nodeIndex]}:${localSocketId}`,
    nodeId: nodeIds[nodeIndex],
    socketId: `${nodeIds[nodeIndex]}:${localSocketId}`,
    localSocketId,
    position: { ...position },
    facing: { ...facing },
  });
  const endpoints = {
    station0Entry: supplementEndpoint(0, 'entry', { x: 100, y: 0, z: -9.8 }, { x: 0, y: 0, z: -1 }),
    station0Right: supplementEndpoint(0, 'right', { x: 107, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
    station0Exit: supplementEndpoint(0, 'exit', { x: 100, y: 0, z: 9.8 }, { x: 0, y: 0, z: 1 }),
    station1Entry: supplementEndpoint(1, 'entry', { x: 114, y: 0, z: -9.8 }, { x: 0, y: 0, z: -1 }),
    station1Left: supplementEndpoint(1, 'left', { x: 107, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
    station1Exit: supplementEndpoint(1, 'exit', { x: 114, y: 0, z: 9.8 }, { x: 0, y: 0, z: 1 }),
    challengeEntry: supplementEndpoint(2, 'entry', { x: 100, y: 0, z: 15.4 }, { x: 0, y: 0, z: -1 }),
    challengeExit: supplementEndpoint(2, 'exit', { x: 109.8, y: 0, z: 30.8 }, { x: 1, y: 0, z: 0 }),
    rewardEntry: supplementEndpoint(3, 'entry', { x: 115.4, y: 0, z: 30.8 }, { x: -1, y: 0, z: 0 }),
    rewardExit: supplementEndpoint(3, 'exit', { x: 115.4, y: 0, z: 25.2 }, { x: -1, y: 0, z: 0 }),
  };
  const ordinarySegment = (index, from, to, path = [from.position, to.position]) => {
    const id = segmentIds[index];
    const center = {
      x: (Number(from.position.x) + Number(to.position.x)) * 0.5,
      y: (Number(from.position.y) + Number(to.position.y)) * 0.5 + 0.25,
      z: (Number(from.position.z) + Number(to.position.z)) * 0.5,
    };
    const endpointParentNodeIds = [from.nodeId, to.nodeId];
    return {
      id,
      operationId,
      parentRegionId: region.id,
      logicalEdgeId: coverage.logicalEdgeId,
      physicalSegmentId: id,
      from: structuredClone(from),
      to: structuredClone(to),
      path: structuredClone(path),
      bidirectional: true,
      connectorFamily: 'service-gallery',
      themeBinding: THEME_BINDING,
      requiredThemeCapabilities: { materials: [], assets: [], connectors: [], transitions: [] },
      landings: [{ position: { ...from.position } }, { position: { ...to.position } }],
      landingVolumes: [from, to].map((endpoint, endpointIndex) => ({
        id: `${id}:landing:${endpointIndex}`,
        center: { ...endpoint.position, y: Number(endpoint.position.y) + 0.25 },
        size: { x: 0.5, y: 0.5, z: 0.5 },
        endpointParentNodeIds,
      })),
      occupiedVolumes: [{
        id: `${id}:occupied`,
        center,
        size: { x: 0.5, y: 0.5, z: 0.5 },
        endpointParentNodeIds,
      }],
      clearanceVolumes: [{
        id: `${id}:clearance`,
        center,
        size: { x: 0.4, y: 0.4, z: 0.4 },
        endpointParentNodeIds,
      }],
    };
  };
  const sharedPosition = { x: 107, y: 0, z: 0 };
  const sharedThreshold = {
    id: segmentIds[2],
    operationId,
    parentRegionId: region.id,
    logicalEdgeId: coverage.logicalEdgeId,
    physicalSegmentId: segmentIds[2],
    from: structuredClone(endpoints.station0Right),
    to: structuredClone(endpoints.station1Left),
    path: [structuredClone(sharedPosition), structuredClone(sharedPosition)],
    bidirectional: true,
    connectorFamily: 'service-gallery',
    themeBinding: THEME_BINDING,
    requiredThemeCapabilities: { materials: [], assets: [], connectors: [], transitions: [] },
    landings: [{ position: structuredClone(sharedPosition) }, { position: structuredClone(sharedPosition) }],
    landingVolumes: [],
    occupiedVolumes: [],
    clearanceVolumes: [],
    sharedEndpointFootprint: {
      kind: 'shared-junction-threshold',
      center: structuredClone(sharedPosition),
      size: { x: 2.8, y: 5.6, z: 8.4 },
      nodeIds: [nodeIds[0], nodeIds[1]],
      socketIds: [endpoints.station0Right.socketId, endpoints.station1Left.socketId],
    },
    localApproachWitnesses: [{
      nodeId: nodeIds[0],
      socketId: endpoints.station0Right.socketId,
      localSocketId: 'right',
      path: [{ x: 101.4, y: 0, z: 0 }, structuredClone(sharedPosition)],
    }, {
      nodeId: nodeIds[1],
      socketId: endpoints.station1Left.socketId,
      localSocketId: 'left',
      path: [{ x: 112.6, y: 0, z: 0 }, structuredClone(sharedPosition)],
    }],
  };
  const segments = [
    ordinarySegment(0, parentEndpoint(stationSockets[0]), endpoints.station0Entry),
    ordinarySegment(1, parentEndpoint(stationSockets[1]), endpoints.station1Entry),
    sharedThreshold,
    ordinarySegment(3, endpoints.station0Exit, endpoints.challengeEntry),
    ordinarySegment(4, endpoints.challengeExit, endpoints.rewardEntry),
    ordinarySegment(5, endpoints.rewardExit, endpoints.station1Exit, [
      endpoints.rewardExit.position,
      { x: 109.8, y: 0, z: 25.2 },
      { x: 109.8, y: 0, z: 15.4 },
      { x: 114, y: 0, z: 15.4 },
      endpoints.station1Exit.position,
    ]),
  ];

  const socketsForNode = (nodeId) => segments.flatMap((segment) => (
    [segment.from, segment.to]
      .filter((endpoint) => endpoint.nodeId === nodeId)
      .map((endpoint) => ({
        id: endpoint.socketId,
        localSocketId: endpoint.localSocketId,
        position: { ...endpoint.position },
        facing: { ...endpoint.facing },
        state: 'connected',
        segmentId: segment.id,
      }))
  ));
  const nodeBase = (index, center, contentRole) => ({
    id: nodeIds[index],
    operationId,
    parentRegionId: region.id,
    grammarId: index < 2
      ? 'supplement-route-connector-through-t-v1'
      : 'supplement-chamber-compact-v1',
    grammarRevision: 1,
    contentRole,
    substantive: true,
    progressionBandId: 0,
    accessDomainId: domain,
    placement: { center: { ...center }, rotationQuarterTurns: 0 },
    size: index < 2
      ? { x: 14, y: 8.4, z: 19.6 }
      : { x: 19.6, y: 8.4, z: 19.6 },
    occupiedVolumes: [{
      id: `${nodeIds[index]}:occupied`,
      center: { ...center, y: 1 },
      size: { x: 2, y: 2, z: 2 },
    }],
    clearanceVolumes: [{
      id: `${nodeIds[index]}:clearance`,
      center: { ...center, y: 1 },
      size: { x: 1, y: 2, z: 1 },
    }],
    themeBinding: THEME_BINDING,
    requiredThemeCapabilities: { materials: [], assets: [], connectors: [], transitions: [] },
    sockets: socketsForNode(nodeIds[index]),
  });
  const nodes = [
    { ...nodeBase(0, { x: 100, y: 0, z: 0 }, 'junction') },
    { ...nodeBase(1, { x: 114, y: 0, z: 0 }, 'junction') },
    { ...nodeBase(2, { x: 100, y: 0, z: 25.2 }, 'challenge') },
    { ...nodeBase(3, { x: 125.2, y: 0, z: 25.2 }, 'reward') },
  ];
  for (const [stationIndex, node] of nodes.slice(0, 2).entries()) {
    const throughPair = stationIndex === 0
      ? [`${node.id}:entry`, `${node.id}:right`]
      : [`${node.id}:entry`, `${node.id}:left`];
    node.kind = 'supplementConnectorJunction';
    node.countsAsSupplementRoom = false;
    node.connectorOwned = true;
    node.connectorInfrastructure = true;
    node.moduleKind = 'connector-module';
    node.exactParentEndpoint = true;
    node.parentEndpointSocketId = stationSockets[stationIndex].id;
    node.parentEndpointSocketKind = 'authored-corridor-station';
    node.parentThroughRouteDegreeContribution = 1;
    node.connectorOwnershipId = node.id;
    node.plannedMinimumGraphDegree = 3;
    node.occupiedVolumes = [{
      id: `${node.id}:occupied`,
      center: { ...node.placement.center, y: 4.2 },
      size: { x: 14, y: 8.4, z: 19.6 },
    }];
    node.anchors = [{
      id: `${node.id}:light`,
      kind: 'light-fixture',
      position: { ...node.placement.center },
    }];
    node.junction = {
      junctionKind: 'through-t',
      throughSocketPairs: [throughPair],
      decisionSocketIds: [`${node.id}:exit`],
      clearCoreVolume: {
        id: `${node.id}:clear-core`,
        center: { ...node.placement.center, y: 1 },
        size: { x: 1, y: 2, z: 1 },
      },
      countsAsMeaningfulStation: true,
    };
  }
  Object.assign(nodes[2], {
    kind: 'supplementRoom',
    countsAsSupplementRoom: true,
    connectorOwned: false,
    connectorInfrastructure: false,
    moduleKind: 'room',
    anchors: [{
      id: `${nodes[2].id}:encounter`,
      kind: 'encounter',
      position: { ...nodes[2].placement.center },
    }],
    structure: {},
  });
  Object.assign(nodes[3], {
    kind: 'supplementRoom',
    countsAsSupplementRoom: true,
    connectorOwned: false,
    connectorInfrastructure: false,
    moduleKind: 'room',
    anchors: [{
      id: `${nodes[3].id}:reward`,
      kind: 'reward',
      position: { ...nodes[3].placement.center },
    }],
    structure: {
      ramps: [{ id: `${nodes[3].id}:ramp`, role: 'ramp' }],
    },
  });

  applyV4EndpointContracts({
    segments,
    nodes,
    operationId,
    progressionBandId: 0,
    grant,
  });

  const stableRuntimeStateIds = Object.fromEntries([
    'encounter', 'mechanism', 'reward', 'shortcut',
  ].map((role) => [role, `${operationId}:state:${role}`]));
  const operation = {
    schema: 'ruindivex-dungeon-augmentation-operation/v1',
    id: operationId,
    type: 'routeNetwork',
    parentRegionId: region.id,
    themeBinding: THEME_BINDING,
    grantId: grant.id,
    routeNetworkKind: grant.kind,
    endpointSocketIds: stationSockets.map(({ id }) => id),
    progressionBandId: 0,
    accessDomainId: domain,
    crossedBoundaryIds: [],
    requiredCredentialIds: [],
    sourceGate: null,
    topologyTemplateId: 'parallel-gallery-loop',
    junctionKinds: ['through-t'],
    elevationModes: ['slope'],
    contentRoles: nodes.map(({ contentRole }) => contentRole),
    localProgressionArc: ['enter', 'challenge', 'mechanism', 'payoff', 'reconnect'],
    stableRuntimeStateIds,
    runtimeStateIds: Object.values(stableRuntimeStateIds),
    maximumFeaturelessSpanMeters: 33.6,
    cycleRankDelta: 1,
    nodeIds,
    moduleCount: 4,
    substantiveModuleCount: 4,
    physicalNodeCount: 4,
    roomCount: 2,
    roomNodeIds: nodeIds.slice(2),
    connectorModuleCount: 0,
    connectorModuleNodeIds: [],
    connectorJunctionCount: 2,
    connectorJunctionNodeIds: nodeIds.slice(0, 2),
    connectorInfrastructureCount: 2,
    connectorInfrastructureNodeIds: nodeIds.slice(0, 2),
    segmentIds,
    bidirectional: true,
    returnRouteGuaranteed: true,
    protectedVolumes: [],
    socketLandingOverlapGrants: structuredClone(socketLandingOverlapGrants),
    socketModuleOverlapGrants: [],
    mustPreserveBeatIds: structuredClone(grant.mustPreserveBeatIds),
    coverage: structuredClone(coverage),
  };
  operation.featurelessSpans = [
    ...coverage.featurelessSpansMeters.map((distanceMeters, index) => ({
      id: `${operationId}:featureless-span:${index}`,
      logicalEdgeId: coverage.logicalEdgeId,
      ordinal: index,
      distanceMeters,
      spanKind: 'authored-route-coverage',
      boundedByMeaningfulStations: true,
    })),
    ...segments.map((segment, index) => ({
      id: `${operationId}:physical-featureless-span:${index}`,
      segmentId: segment.id,
      ordinal: coverage.featurelessSpansMeters.length + index,
      path: structuredClone(segment.path),
      distanceMeters: maximumContinuousLevelPathDistance(segment.path),
      spanKind: 'supplement-physical-route',
      boundedByMeaningfulStations: true,
    })),
  ];

  plan.operations.push(operation);
  plan.nodes.push(...nodes);
  plan.segments.push(...segments);
  rehash(plan);
  return { fixture, plan, operation, grant, nodes, segments, sharedThreshold };
}

function makeV4SharedJunctionThresholdFixture() {
  const { fixture, plan } = makeV4ValidationFixture();
  return appendSharedJunctionThresholdCoverageFixture(fixture, plan);
}

test('optional branch validation derives parent connectivity instead of trusting return-route flags', () => {
  const { fixture, plan } = createValidPlan();
  const branch = plan.operations.find((operation) => operation.type === 'optionalBranch');
  const branchNodeIds = new Set(branch.nodeIds);
  const attachmentSegment = plan.segments.find((segment) => (
    segment.operationId === branch.id
      && [segment.from, segment.to].filter((endpoint) => branchNodeIds.has(endpoint.nodeId)).length === 1
  ));
  assert.ok(attachmentSegment);
  const externalEndpoint = branchNodeIds.has(attachmentSegment.from.nodeId)
    ? attachmentSegment.to
    : attachmentSegment.from;
  externalEndpoint.nodeId = 'unregistered-external-parent';
  assert.equal(branch.returnRouteGuaranteed, true);
  assert.equal(branch.bidirectional, true);
  rehash(plan);

  const validation = validate(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('optional-branch-external-endpoint-invalid'));
  assert.ok(codes.includes('optional-branch-parent-attachment-missing'));
  assert.ok(codes.includes('optional-branch-node-unreachable'));
  assert.equal(validation.diagnostics.optionalBranchGraphChecks.length, 1);
  assert.equal(validation.diagnostics.optionalBranchGraphChecks[0].accepted, false);
  assert.equal(validation.diagnostics.optionalBranchGraphChecks[0].reachableNodeCount, 0);
});

test('optional branch validation rejects a one-way segment even when operation flags promise a return', () => {
  const { fixture, plan } = createValidPlan();
  const branch = plan.operations.find((operation) => operation.type === 'optionalBranch');
  const segment = plan.segments.find((candidate) => candidate.operationId === branch.id);
  segment.bidirectional = false;
  rehash(plan);

  const validation = validate(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('segment-must-be-bidirectional'));
  assert.ok(codes.includes('optional-branch-segment-not-bidirectional'));
});

test('edge padding cannot trust a declared length beyond its boundary-socket path', () => {
  const fixture = makeFixture();
  const edge = fixture.extensionRegions[0].spliceEdges[0];
  edge.path = [
    { x: -8, y: 0, z: 0 },
    { x: 8, y: 0, z: 0 },
  ];
  edge.from.position = { ...edge.path[0] };
  edge.to.position = { ...edge.path[1] };
  edge.availableLengthMeters = 140;

  const result = augmentDungeonDraft({
    ...fixture,
    profileId: PROFILE_ID,
    layoutSeed: 'validation-overstated-splice-length',
    augmentationSeed: 'validation-overstated-splice-length',
    difficulty: 2,
  });

  assert.equal(result.status, 'unchanged');
  assert.equal(result.diagnostics.reason, 'planning-failed');
  assert.ok(result.diagnostics.decisions.every(({ accepted }) => accepted === false));
});

test('edge-padding validation independently verifies usable length and boundary endpoints', () => {
  const { fixture, plan } = createValidPlan();
  const padding = plan.operations.find(({ type }) => type === 'edgePadding');
  assert.ok(padding);
  padding.originalEdgeSnapshot.availableLengthMeters = 1000;
  padding.originalEdgeSnapshot.path[0].x += 1;
  rehash(plan);

  const validation = validate(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('edge-padding-path-endpoint-mismatch'));
  assert.ok(codes.includes('edge-padding-usable-length-invalid'));
});

test('validation rejects collapsed room and connector volumes before collision checks', () => {
  const { fixture, plan } = createValidPlan();
  plan.nodes[0].occupiedVolumes[0].size.x = 0;
  plan.segments[0].clearanceVolumes[0].size.z = 0;
  rehash(plan);

  const validation = validate(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('node-occupied-volume-invalid'));
  assert.ok(codes.includes('segment-clearance-volume-invalid'));
});

test('edge-padding segments cannot cut away from their parent splice polyline', () => {
  const { fixture, plan } = createValidPlan();
  const padding = plan.operations.find(({ type }) => type === 'edgePadding');
  const segment = plan.segments.find(({ operationId }) => operationId === padding.id);
  const first = segment.path[0];
  const last = segment.path.at(-1);
  segment.path.splice(1, 0, {
    x: (first.x + last.x) * 0.5,
    y: (first.y + last.y) * 0.5,
    z: (first.z + last.z) * 0.5 + 8,
  });
  rehash(plan);

  const validation = validate(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'edge-padding-segment-leaves-splice-path'
      && context.segmentId === segment.id
  )));
});

test('feature quotas are optional and report all unmet renderer-free plan requirements', () => {
  const { fixture, plan } = createValidPlan();
  const baseline = validate(plan, fixture);
  assert.equal(baseline.accepted, true, JSON.stringify(baseline.errors));
  const baselineCounts = baseline.diagnostics.featureCounts;
  assert.deepEqual(baselineCounts, {
    sideRoomCount: 0,
    elevationTransferCount: 0,
    encounterCount: plan.nodes.length,
    rewardCount: plan.nodes.length,
    trapCount: 0,
    platformRoomCount: 0,
    connectorFamilyCount: 1,
    connectorFamilies: ['service-gallery'],
  });

  const requiredFeatures = {
    sideRoomCount: 1,
    elevationTransferCount: 1,
    encounterCount: plan.nodes.length + 1,
    rewardCount: plan.nodes.length + 1,
    trapCount: 1,
    platformRoomCount: 1,
    connectorFamilyCount: 2,
  };
  const validation = validate(plan, fixture, {
    ...DUNGEON_AUGMENTATION_PROFILES[PROFILE_ID],
    requiredFeatures,
  });
  assert.equal(validation.accepted, false);
  const quotaErrors = validation.errors.filter(({ code }) => (
    code === 'required-feature-quota-not-met'
  ));
  assert.deepEqual(
    quotaErrors.map(({ context }) => context.feature).sort(),
    Object.keys(requiredFeatures).sort(),
  );
  assert.ok(quotaErrors.every(({ context }) => (
    context.actual === baselineCounts[context.feature]
      && context.required === requiredFeatures[context.feature]
  )));
});

test('feature quotas count explicit side-room, platform, trap, transfer, and connector records', () => {
  const { fixture, plan } = createValidPlan();
  const node = plan.nodes[0];
  node.role = 'hallway-side-room';
  node.anchors.push({
    id: `${node.id}:trap-anchor`,
    nodeId: node.id,
    kind: 'trap',
    position: { ...node.placement.center },
  });
  node.structure.platforms = [{ id: `${node.id}:platform`, role: 'platform' }];
  node.structure.ramps = [{ id: `${node.id}:ramp`, connectorFamily: 'slope' }];
  rehash(plan);

  const requiredFeatures = {
    sideRoomCount: 1,
    elevationTransferCount: 1,
    encounterCount: plan.nodes.length,
    rewardCount: plan.nodes.length,
    trapCount: 1,
    platformRoomCount: 1,
    connectorFamilyCoverageCount: 2,
  };
  const validation = validate(plan, fixture, {
    ...DUNGEON_AUGMENTATION_PROFILES[PROFILE_ID],
    requiredFeatures,
  });
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors));
  assert.deepEqual(validation.diagnostics.featureCounts, {
    sideRoomCount: 1,
    elevationTransferCount: 1,
    encounterCount: plan.nodes.length,
    rewardCount: plan.nodes.length,
    trapCount: 1,
    platformRoomCount: 1,
    connectorFamilyCount: 2,
    connectorFamilies: ['service-gallery', 'slope'],
  });
});

test('V4 accepts an exact same-band pyramid loop with a real junction and final progression route', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors));
  assert.equal(validation.diagnostics.routeNetworkValidation.routeNetworkCount, 1);
  assert.equal(validation.diagnostics.routeNetworkValidation.pyramidLoopCount, 1);
  assert.equal(
    validation.diagnostics.routeNetworkValidation.graphChecks[0].realJunctionCount,
    1,
  );
  assert.equal(validation.diagnostics.routeNetworkValidation.routeNetworkNodeCount, 4);
  assert.equal(
    validation.diagnostics.routeNetworkValidation.routeNetworkSubstantiveModuleCount,
    4,
  );
  assert.equal(validation.diagnostics.routeNetworkValidation.routeNetworkPhysicalNodeCount, 4);
  assert.equal(
    validation.diagnostics.routeNetworkValidation.graphChecks[0].connectorInfrastructureNodeCount,
    0,
  );
  assert.ok(validation.diagnostics.routeNetworkValidation.progression[0].reachableNodeCount >= 6);
});

test('V4 accepts an absent selection manifest and validates a complete manifest when present', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  assert.equal(Object.hasOwn(plan.operations[0], 'selectionManifest'), false);
  const absent = validateV4(plan, fixture);
  assert.equal(absent.accepted, true, JSON.stringify(absent.errors));

  applyValidV4SelectionManifest(plan);
  const present = validateV4(plan, fixture);
  assert.equal(present.accepted, true, JSON.stringify(present.errors));
});

test('V4 selection manifests preserve schema, topology, elevation, and normalized signature identity', () => {
  const mutations = [{
    label: 'schema',
    expectedCode: 'route-network-selection-manifest-schema-invalid',
    mutate: (operation) => { operation.selectionManifest.schema = 'invented-selection-schema'; },
  }, {
    label: 'topology identity',
    expectedCode: 'route-network-selection-manifest-topology-identity-mismatch',
    mutate: (operation) => { operation.selectionManifest.topology.id = 'other-topology'; },
  }, {
    label: 'elevation identity',
    expectedCode: 'route-network-selection-manifest-elevation-identity-mismatch',
    mutate: (operation) => { operation.selectionManifest.elevation.id = 'other-elevation'; },
  }, {
    label: 'manifest normalized signature',
    expectedCode: 'route-network-selection-manifest-normalized-signature-mismatch',
    mutate: (operation) => {
      operation.selectionManifest.normalizedSemanticSignature = 'stale-manifest-signature';
    },
  }, {
    label: 'operation normalized signature',
    expectedCode: 'route-network-selection-manifest-normalized-signature-mismatch',
    mutate: (operation) => { operation.normalizedSemanticSignature = 'stale-operation-signature'; },
  }];

  for (const { label, expectedCode, mutate } of mutations) {
    const { fixture, plan } = makeV4ValidationFixture();
    const operation = plan.operations[0];
    applyValidV4SelectionManifest(plan, operation);
    mutate(operation);
    rehash(plan);
    const validation = validateV4(plan, fixture);
    assert.equal(validation.accepted, false, label);
    assert.ok(validation.errors.some(({ code, context }) => (
      code === expectedCode && context.operationId === operation.id
    )), `${label}: ${JSON.stringify(validation.errors)}`);
  }
});

test('V4 selection manifests serialize the accepted room layouts and encounter profiles', () => {
  for (const { label, expectedCode, mutate } of [{
    label: 'accepted room grammar',
    expectedCode: 'route-network-selection-manifest-room-layout-mismatch',
    mutate: (plan, operation) => {
      const room = plan.nodes.find(({ id }) => operation.roomNodeIds.includes(id));
      room.grammarId = 'different-accepted-room-layout';
    },
  }, {
    label: 'accepted encounter profile',
    expectedCode: 'route-network-selection-manifest-encounter-mismatch',
    mutate: (plan, operation) => {
      const node = plan.nodes.find(({ id, anchors }) => (
        operation.nodeIds.includes(id)
          && anchors?.some(({ kind }) => kind === 'encounter')
      ));
      const anchor = node.anchors.find(({ kind }) => kind === 'encounter');
      anchor.encounterProfileId = 'supplement-lateral-defense';
    },
  }]) {
    const { fixture, plan } = makeV4ValidationFixture();
    const operation = plan.operations[0];
    applyValidV4SelectionManifest(plan, operation);
    mutate(plan, operation);
    rehash(plan);
    const validation = validateV4(plan, fixture);
    assert.equal(validation.accepted, false, label);
    assert.ok(validation.errors.some(({ code }) => code === expectedCode), (
      `${label}: ${JSON.stringify(validation.errors)}`
    ));
  }
});

test('V4 selection manifests require valid nonempty witnesses for exactly five families', () => {
  const mutations = [{
    label: 'missing family',
    expectedCode: 'route-network-selection-manifest-bag-witness-invalid',
    expectedFamily: 'roomLayout',
    mutate: (manifest) => { manifest.bagWitnesses.roomLayout = []; },
  }, {
    label: 'state drift',
    expectedCode: 'route-network-selection-manifest-bag-witness-invalid',
    expectedFamily: 'encounter',
    mutate: (manifest) => { manifest.bagWitnesses.encounter[0].after.consumedIds = []; },
  }, {
    label: 'unknown family',
    expectedCode: 'route-network-selection-manifest-bag-witness-family-invalid',
    mutate: (manifest) => { manifest.bagWitnesses.inventedFamily = []; },
  }];

  for (const { label, expectedCode, expectedFamily, mutate } of mutations) {
    const { fixture, plan } = makeV4ValidationFixture();
    const manifest = applyValidV4SelectionManifest(plan);
    mutate(manifest);
    rehash(plan);
    const validation = validateV4(plan, fixture);
    assert.equal(validation.accepted, false, label);
    assert.ok(validation.errors.some(({ code, context }) => (
      code === expectedCode
        && (expectedFamily === undefined || context.family === expectedFamily)
    )), `${label}: ${JSON.stringify(validation.errors)}`);
  }
});

test('V4 selection witnesses must exactly match every ordered manifest declaration', () => {
  for (const family of DUNGEON_SELECTION_BAG_FAMILIES) {
    const { fixture, plan } = makeV4ValidationFixture();
    const operation = plan.operations[0];
    const manifest = applyValidV4SelectionManifest(plan, operation);
    manifest.bagWitnesses[family] = createSelectionWitnessSequence(
      family,
      [`${family}-alternate-selection`],
    );
    rehash(plan);

    const validation = validateV4(plan, fixture);
    assert.equal(validation.accepted, false, family);
    assert.ok(validation.errors.some(({ code, context }) => (
      code === 'route-network-selection-manifest-witness-selection-mismatch'
        && context.operationId === operation.id
        && context.family === family
    )), `${family}: ${JSON.stringify(validation.errors)}`);
  }
});

test('V4 route-network operations expose exact ordered module, segment, coverage, and local dependency records', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const operation = plan.operations[0];
  const grant = fixture.extensionRegions[0].routeNetworkGrants[0];

  assert.deepEqual(operation.endpointSocketIds, grant.endpointSockets.map(({ id }) => id));
  assert.deepEqual(operation.nodeIds, plan.nodes.map(({ id }) => id));
  assert.deepEqual(operation.roomNodeIds, plan.nodes.slice(1).map(({ id }) => id));
  assert.deepEqual(operation.connectorJunctionNodeIds, [plan.nodes[0].id]);
  assert.deepEqual(operation.segmentIds, plan.segments.map(({ id }) => id));
  assert.deepEqual(operation.contentRoles, plan.nodes.map(({ contentRole }) => contentRole));
  assert.deepEqual(operation.protectedVolumes, grant.protectedVolumes);
  assert.deepEqual(operation.socketLandingOverlapGrants, grant.socketLandingOverlapGrants);
  assert.deepEqual(operation.mustPreserveBeatIds, grant.mustPreserveBeatIds);
  assert.deepEqual(operation.runtimeStateIds, Object.values(operation.stableRuntimeStateIds));
  assert.deepEqual(operation.featurelessSpans.map(({ segmentId }) => segmentId), operation.segmentIds);

  const mutations = [{
    label: 'endpoint order',
    mutate: ({ operation: target }) => { target.endpointSocketIds.reverse(); },
    expectedCode: 'route-network-endpoint-order-contract-mismatch',
  }, {
    label: 'module order',
    mutate: ({ operation: target }) => { target.nodeIds.reverse(); },
    expectedCode: 'route-network-node-order-contract-mismatch',
  }, {
    label: 'segment order',
    mutate: ({ operation: target }) => { target.segmentIds.reverse(); },
    expectedCode: 'route-network-segment-order-contract-mismatch',
  }, {
    label: 'ordered room identities',
    mutate: ({ operation: target }) => { target.roomNodeIds.reverse(); },
    expectedCode: 'route-network-v4-ordered-module-identities-mismatch',
  }, {
    label: 'grant copy',
    mutate: ({ operation: target }) => { target.protectedVolumes[0].center.x += 1; },
    expectedCode: 'route-network-grant-copy-mismatch',
  }, {
    label: 'coverage witness',
    mutate: ({ operation: target }) => { target.featurelessSpans[0].distanceMeters += 1; },
    expectedCode: 'route-network-featureless-witness-contract-mismatch',
  }, {
    label: 'local progression dependencies',
    mutate: ({ operation: target }) => { target.localProgressionArc.reverse(); },
    expectedCode: 'route-network-local-progression-dependencies-mismatch',
  }, {
    label: 'local runtime dependencies',
    mutate: ({ operation: target }) => {
      target.runtimeStateIds[0] = 'foreign:state:encounter';
    },
    expectedCode: 'route-network-local-runtime-dependencies-invalid',
  }];

  for (const { label, mutate, expectedCode } of mutations) {
    const isolated = makeV4ValidationFixture();
    const isolatedOperation = isolated.plan.operations[0];
    mutate({
      fixture: isolated.fixture,
      plan: isolated.plan,
      operation: isolatedOperation,
    });
    rehash(isolated.plan);
    const result = validateV4(isolated.plan, isolated.fixture);
    assert.equal(result.accepted, false, label);
    assert.ok(result.errors.some(({ code }) => code === expectedCode), label);
  }
});

test('V4 validates finite orthogonal endpoint continuation witnesses during plan acceptance', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const grant = fixture.extensionRegions[0].routeNetworkGrants[0];
  const operation = plan.operations[0];
  const socket = grant.endpointSockets[0];
  socket.routeNetworkSocketKind = 'authored-corridor-station';
  socket.endpointModuleOverlapRequired = true;
  socket.planningModuleCenter = { x: -12, z: 12.6 };
  socket.planningContinuationCenter = { x: -12, z: 43 };
  socket.planningContinuationRoute = [
    { x: -12, z: 22.4 },
    { x: -12, z: 33.2 },
  ];
  grant.socketModuleOverlapGrants = [{
    id: `${socket.id}:endpoint-module-overlap`,
    socketId: socket.id,
    center: { x: -12, y: 4.2, z: 12.6 },
    size: { x: 14, y: 8.4, z: 19.6 },
    purpose: 'route-network-endpoint-module-parent-merge',
    moduleKind: 'connector-module',
    moduleTemplateId: 'supplement-route-connector-through-t-v1',
    footprintTiles: { width: 5, depth: 7 },
    leadTiles: 1,
  }];
  operation.socketModuleOverlapGrants = structuredClone(grant.socketModuleOverlapGrants);
  rehash(plan);
  const accepted = validateV4(plan, fixture);
  assert.equal(accepted.accepted, true, JSON.stringify(accepted.errors));

  socket.planningContinuationRoute[1].x += 2.8;
  rehash(plan);
  const rejected = validateV4(plan, fixture);
  assert.equal(rejected.accepted, false);
  assert.ok(rejected.errors.some(({ code, context }) => (
    code === 'route-network-endpoint-planning-continuation-route-not-orthogonal'
      && context.socketId === socket.id
  )));
});

test('V4 accepts every exact compact junction-kit footprint', () => {
  for (const kit of V4_JUNCTION_KITS) {
    const { fixture, plan } = makeV4ValidationFixture();
    const junction = plan.nodes[0];
    junction.grammarId = kit.grammarId;
    junction.junction.junctionKind = kit.kind;
    junction.size = { x: kit.width, y: 8.4, z: kit.depth };
    plan.operations[0].junctionKinds = [kit.kind];
    rehash(plan);

    const result = validateV4(plan, fixture);
    assert.equal(result.accepted, true, `${kit.kind}: ${JSON.stringify(result.errors)}`);
  }
});

test('V4 rejects junction footprints that do not exactly match their declared kit', () => {
  for (const kit of V4_JUNCTION_KITS) {
    const { fixture, plan } = makeV4ValidationFixture();
    const junction = plan.nodes[0];
    junction.grammarId = kit.grammarId;
    junction.junction.junctionKind = kit.kind;
    junction.size = { x: kit.width + 2.8, y: 8.4, z: kit.depth };
    plan.operations[0].junctionKinds = [kit.kind];
    rehash(plan);

    const result = validateV4(plan, fixture);
    assert.equal(result.accepted, false, kit.kind);
    assert.ok(result.errors.some(({ code, context }) => (
      code === 'route-network-connector-junction-footprint-invalid'
        && context.nodeId === junction.id
        && context.junctionKind === kit.kind
    )), kit.kind);
  }
});

test('V4 does not impose a universal 15x13 footprint on substantive content rooms', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const room = plan.nodes.find(({ kind }) => kind === 'supplementRoom');
  room.size = { x: 14, y: 8.4, z: 19.6 };
  rehash(plan);
  const result = validateV4(plan, fixture);
  assert.equal(result.accepted, true, JSON.stringify(result.errors));
});

test('V4 counts an active junction and curated rooms as substantive modules', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  fixture.extensionRegions[0].routeNetworkGrants[0].maximumModules = 4;
  rehash(plan);

  const result = validateV4(plan, fixture);
  assert.equal(result.accepted, true, JSON.stringify(result.errors));
  const diagnostics = result.diagnostics.routeNetworkValidation;
  assert.equal(diagnostics.routeNetworkSubstantiveModuleCount, 4);
  assert.equal(diagnostics.routeNetworkPhysicalNodeCount, 4);
  assert.equal(diagnostics.graphChecks[0].connectorInfrastructureNodeCount, 0);
  assert.equal(diagnostics.graphChecks[0].substantiveModuleCount, 4);
  assert.equal(diagnostics.graphChecks[0].physicalNodeCount, 4);
});

test('V4 permits compact connector infrastructure without counting it as a substantive module', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const operation = plan.operations[0];
  const rewardRoom = plan.nodes[2];
  const connector = plan.nodes[3];
  rewardRoom.anchors.push({
    id: `${rewardRoom.id}:reward`,
    kind: 'reward',
    position: { ...rewardRoom.placement.center },
  });
  connector.kind = 'supplementConnectorModule';
  connector.grammarId = 'supplement-route-connector-through-t-v1';
  connector.contentRole = 'plain-connector';
  connector.substantive = false;
  connector.countsAsSupplementRoom = false;
  connector.connectorOwned = true;
  connector.connectorInfrastructure = true;
  connector.moduleKind = 'connector-module';
  connector.size = { x: 14, y: 8.4, z: 19.6 };
  connector.anchors = connector.anchors.filter(({ kind }) => kind === 'light-fixture');
  delete connector.junction;
  operation.moduleCount = 3;
  operation.substantiveModuleCount = 3;
  operation.roomCount = 2;
  operation.roomNodeIds = plan.nodes.slice(1, 3).map(({ id }) => id);
  operation.connectorModuleCount = 1;
  operation.connectorModuleNodeIds = [connector.id];
  operation.connectorInfrastructureCount = 2;
  operation.connectorInfrastructureNodeIds = [plan.nodes[0].id, connector.id];
  operation.contentRoles[3] = connector.contentRole;
  rehash(plan);

  const result = validateV4(plan, fixture);
  assert.equal(result.accepted, true, JSON.stringify(result.errors));
  const graph = result.diagnostics.routeNetworkValidation.graphChecks[0];
  assert.equal(graph.substantiveModuleCount, 3);
  assert.equal(graph.physicalNodeCount, 4);
  assert.equal(graph.connectorInfrastructureNodeCount, 1);
});

test('V4 validates declared substantive and physical node counts when supplied', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  plan.operations[0].substantiveModuleCount = 5;
  plan.operations[0].physicalNodeCount = 5;
  rehash(plan);

  const result = validateV4(plan, fixture);
  assert.equal(result.accepted, false);
  const codes = result.errors.map(({ code }) => code);
  assert.ok(codes.includes('route-network-substantive-module-count-mismatch'));
  assert.ok(codes.includes('route-network-physical-node-count-mismatch'));
});

test('V4 rejects a promoted connector junction with fewer than three physical routes', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const connector = plan.nodes.find(({ kind }) => kind === 'supplementConnectorJunction');
  const removedSegment = plan.segments.find((segment) => (
    segment.from?.nodeId === connector.id
      && segment.to?.nodeId === plan.nodes.at(-1).id
  ));
  assert.ok(removedSegment);
  plan.segments = plan.segments.filter(({ id }) => id !== removedSegment.id);
  plan.operations[0].segmentIds = plan.operations[0].segmentIds
    .filter((id) => id !== removedSegment.id);
  rehash(plan);

  const result = validate(plan, fixture, V4_PROFILE);
  assert.equal(result.accepted, false);
  assert.ok(result.errors.some(({ code, context }) => (
    code === 'route-network-connector-junction-degree-invalid'
      && context.nodeId === connector.id
      && context.activeDegree === 2
  )));
});

test('V4 requires degree-three connector infrastructure to be promoted to a junction', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const connector = plan.nodes[0];
  connector.kind = 'supplementConnectorModule';
  connector.contentRole = 'plain-connector';
  connector.substantive = false;
  connector.countsAsSupplementRoom = false;
  delete connector.junction;
  plan.operations[0].moduleCount = 3;
  plan.operations[0].substantiveModuleCount = 3;
  plan.operations[0].connectorModuleCount = 1;
  plan.operations[0].connectorModuleNodeIds = [connector.id];
  plan.operations[0].connectorInfrastructureNodeIds = [connector.id];
  rehash(plan);

  const result = validateV4(plan, fixture);
  assert.equal(result.accepted, false);
  assert.ok(result.errors.some(({ code, context }) => (
    code === 'route-network-connector-module-promotion-missing'
      && context.nodeId === connector.id
      && context.activeDegree === 3
  )));
});

test('V4 rejects gameplay content hosted by a plain connector module', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const connector = plan.nodes[3];
  connector.kind = 'supplementConnectorModule';
  connector.grammarId = 'supplement-route-connector-through-t-v1';
  connector.substantive = false;
  connector.countsAsSupplementRoom = false;
  connector.connectorOwned = true;
  connector.connectorInfrastructure = true;
  connector.moduleKind = 'connector-module';
  plan.operations[0].moduleCount = 3;
  plan.operations[0].substantiveModuleCount = 3;
  plan.operations[0].connectorModuleCount = 1;
  plan.operations[0].connectorModuleNodeIds = [connector.id];
  plan.operations[0].connectorInfrastructureNodeIds = [plan.nodes[0].id, connector.id];
  rehash(plan);

  const result = validateV4(plan, fixture);
  assert.equal(result.accepted, false);
  assert.ok(result.errors.some(({ code, context }) => (
    code === 'route-network-content-on-plain-connector'
      && context.nodeId === connector.id
  )));
});

test('V4 rejects stale physical and connector-infrastructure metadata', () => {
  const mutations = [{
    label: 'module count omits a physical node',
    mutate: (operation) => { operation.moduleCount = 3; },
    expectedCode: 'route-network-v4-node-count-contract-invalid',
  }, {
    label: 'declared node identities exceed the physical module count',
    mutate: (operation) => { operation.nodeIds.push(operation.nodeIds[0]); },
    expectedCode: 'route-network-v4-node-count-contract-invalid',
  }, {
    label: 'nonzero connector module count',
    mutate: (operation) => { operation.connectorModuleCount = 1; },
    expectedCode: 'route-network-v4-connector-module-count-mismatch',
  }, {
    label: 'connector module identity',
    mutate: (operation) => { operation.connectorModuleNodeIds = ['unknown-module']; },
    expectedCode: 'route-network-v4-connector-module-identities-mismatch',
  }, {
    label: 'connector infrastructure identity',
    mutate: (operation) => { operation.connectorInfrastructureNodeIds = []; },
    expectedCode: 'route-network-v4-connector-module-identities-mismatch',
  }];

  for (const { label, mutate, expectedCode } of mutations) {
    const { fixture, plan } = makeV4ValidationFixture();
    mutate(plan.operations[0]);
    rehash(plan);
    const result = validateV4(plan, fixture);
    assert.equal(result.accepted, false, label);
    assert.ok(result.errors.some(({ code }) => code === expectedCode), label);
  }
});

test('V4 rejects challenge and reward content hosted only by a connector junction', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const connector = plan.nodes.find(({ kind }) => kind === 'supplementConnectorJunction');
  for (const room of plan.nodes.filter(({ kind }) => kind === 'supplementRoom')) {
    room.anchors = room.anchors.filter(({ kind }) => (
      kind !== 'encounter' && kind !== 'reward'
    ));
    if (room.contentRole === 'challenge' || room.contentRole === 'reward') {
      room.contentRole = 'room';
    }
  }
  connector.anchors = [{
    id: `${connector.id}:encounter`,
    kind: 'encounter',
    position: { ...connector.placement.center },
  }, {
    id: `${connector.id}:reward`,
    kind: 'reward',
    position: { ...connector.placement.center },
  }];
  rehash(plan);

  const result = validate(plan, fixture, V4_PROFILE);
  assert.equal(result.accepted, false);
  assert.ok(result.errors.some(({ code, context }) => (
    code === 'route-network-content-on-connector-junction'
      && context.nodeId === connector.id
      && context.providesChallenge === true
      && context.providesReward === true
  )));
  assert.ok(result.errors.some(({ code, context }) => (
    code === 'route-network-content-arc-incomplete'
      && context.challengeRoomCount === 0
      && context.rewardRoomCount === 0
  )));
});

test('V4 rejects a supplemental room with no committed physical corridor connector', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const isolatedNodeId = plan.nodes.find(({ contentRole, kind }) => (
    kind === 'supplementRoom' && contentRole === 'reward'
  )).id;
  const retainedSegments = plan.segments.filter((segment) => (
    segment.from?.nodeId !== isolatedNodeId && segment.to?.nodeId !== isolatedNodeId
  ));
  plan.segments = retainedSegments;
  plan.operations[0].segmentIds = retainedSegments.map(({ id }) => id);
  rehash(plan);
  const result = validate(plan, fixture, V4_PROFILE);
  assert.equal(result.accepted, false);
  assert.ok(result.errors.some(({ code, context }) => (
    code === 'route-network-room-connector-required' && context.nodeId === isolatedNodeId
  )));
});

test('validation rejects a route segment containing a zero-length physical leg', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const segment = plan.segments[1];
  segment.path.splice(1, 0, { ...segment.path[0] });
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'segment-path-degenerate'
      && context.segmentId === segment.id
      && context.zeroLengthLegIndex === 0
  )));
});

test('V4 accepts only the typed zero-distance threshold shared by adjacent station junctions', () => {
  const { fixture, plan, sharedThreshold } = makeV4SharedJunctionThresholdFixture();
  const validation = validateV4(plan, fixture);

  assert.equal(validation.accepted, true, JSON.stringify(validation.errors));
  assert.deepEqual(sharedThreshold.path, [
    { x: 107, y: 0, z: 0 },
    { x: 107, y: 0, z: 0 },
  ]);
  assert.deepEqual(sharedThreshold.occupiedVolumes, []);
  assert.deepEqual(sharedThreshold.clearanceVolumes, []);
  assert.deepEqual(sharedThreshold.landingVolumes, []);
  assert.equal(validation.errors.some(({ code, context }) => (
    code === 'segment-path-degenerate'
      && context.segmentId === sharedThreshold.id
  )), false);
});

test('V4 rejects every mutated shared-junction threshold contract field', () => {
  const mutations = [{
    label: 'footprint center',
    reason: 'center-mismatch',
    mutate: ({ sharedThreshold }) => {
      sharedThreshold.sharedEndpointFootprint.center.x += 2.8;
    },
  }, {
    label: 'footprint size',
    reason: 'size-invalid',
    mutate: ({ sharedThreshold }) => {
      sharedThreshold.sharedEndpointFootprint.size.x = 5.6;
    },
  }, {
    label: 'opposed socket facing',
    reason: 'facing-invalid',
    mutate: ({ sharedThreshold, nodes }) => {
      sharedThreshold.to.facing = { ...sharedThreshold.from.facing };
      nodes[1].sockets.find(({ id }) => id === sharedThreshold.to.socketId).facing = {
        ...sharedThreshold.from.facing,
      };
    },
  }, {
    label: 'footprint node identities',
    reason: 'node-identity-mismatch',
    mutate: ({ sharedThreshold }) => {
      sharedThreshold.sharedEndpointFootprint.nodeIds[1] = 'invented-station-node';
    },
  }, {
    label: 'footprint socket identities',
    reason: 'socket-identity-mismatch',
    mutate: ({ sharedThreshold }) => {
      sharedThreshold.sharedEndpointFootprint.socketIds[1] = 'invented-station-socket';
    },
  }, {
    label: 'local approach witness',
    reason: 'approach-witness-invalid',
    mutate: ({ sharedThreshold }) => {
      sharedThreshold.localApproachWitnesses[1].path[0].x -= 2.8;
    },
  }, {
    label: 'non-station endpoint node',
    reason: 'station-node-invalid',
    mutate: ({ nodes }) => {
      nodes[1].parentEndpointSocketKind = 'parent-room-wall';
    },
  }, {
    label: 'non-coincident endpoint sockets',
    reason: 'endpoints-not-coincident',
    mutate: ({ sharedThreshold, nodes }) => {
      sharedThreshold.to.position.x += 2.8;
      sharedThreshold.path[1] = { ...sharedThreshold.to.position };
      nodes[1].sockets.find(({ id }) => id === sharedThreshold.to.socketId).position = {
        ...sharedThreshold.to.position,
      };
    },
  }, ...['occupiedVolumes', 'clearanceVolumes', 'landingVolumes'].map((field) => ({
    label: `${field} corridor record`,
    reason: 'corridor-volume-present',
    mutate: ({ sharedThreshold }) => {
      sharedThreshold[field] = [{
        id: `${sharedThreshold.id}:${field}:invented`,
        center: { x: 107, y: 0.25, z: 0 },
        size: { x: 0.5, y: 0.5, z: 0.5 },
      }];
    },
  }))];

  for (const { label, reason, mutate } of mutations) {
    const isolated = makeV4SharedJunctionThresholdFixture();
    mutate(isolated);
    rehash(isolated.plan);
    const validation = validateV4(isolated.plan, isolated.fixture);
    assert.equal(validation.accepted, false, label);
    assert.ok(validation.errors.some(({ code, context }) => (
      code === 'route-network-shared-threshold-invalid'
        && context.segmentId === isolated.sharedThreshold.id
        && context.reason === reason
    )), `${label}: ${JSON.stringify(validation.errors)}`);
  }
});

test('an absent or unknown shared-threshold kind cannot bypass ordinary degenerate-path rejection', () => {
  for (const kind of [undefined, 'invented-zero-distance-threshold']) {
    const { fixture, plan, sharedThreshold } = makeV4SharedJunctionThresholdFixture();
    if (kind === undefined) delete sharedThreshold.sharedEndpointFootprint.kind;
    else sharedThreshold.sharedEndpointFootprint.kind = kind;
    rehash(plan);

    const validation = validateV4(plan, fixture);
    assert.equal(validation.accepted, false, String(kind));
    assert.ok(validation.errors.some(({ code, context }) => (
      code === 'segment-path-degenerate'
        && context.segmentId === sharedThreshold.id
        && context.zeroLengthLegIndex === 0
    )), JSON.stringify(validation.errors));
  }
});

test('V4 validates the exact identities and all 15 ordered cells of both endpoint seams', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  for (const segment of plan.segments) {
    assert.equal(segment.endpointSeams.length, 2);
    assert.deepEqual(segment.endpointSeams.map(({ role }) => role), ['from', 'to']);
    assert.equal(segment.endpointSeams.every(({ orderedCells }) => (
      orderedCells.length === 15
    )), true);
  }
  const accepted = validateV4(plan, fixture);
  assert.equal(accepted.accepted, true, JSON.stringify(accepted.errors));

  const malformed = plan.segments[1].endpointSeams[0];
  malformed.orderedCells[0].position.x += 2.8;
  rehash(plan);
  const rejected = validateV4(plan, fixture);
  assert.equal(rejected.accepted, false);
  assert.ok(rejected.errors.some(({ code, context }) => (
    code === 'route-network-endpoint-seam-record-invalid'
      && context.segmentId === plan.segments[1].id
      && context.role === 'from'
  )), JSON.stringify(rejected.errors));
});

test('V4 reconstructs a serialized objective-coverage station-side alternative before seam validation', () => {
  const { fixture, plan, operation, grant } = makeV4SharedJunctionThresholdFixture();
  const desiredSockets = structuredClone(grant.endpointSockets);
  grant.source = {
    planningStationSideDiagnostics: desiredSockets.map((desired) => {
      const desiredFacing = { ...desired.facing };
      const leadMeters = 5.6;
      const sourceCenterlinePosition = {
        x: Number(desired.position.x) - Number(desiredFacing.x) * leadMeters,
        y: Number(desired.position.y),
        z: Number(desired.position.z) - Number(desiredFacing.z) * leadMeters,
      };
      const canonicalFacing = {
        x: -Number(desiredFacing.x),
        y: 0,
        z: -Number(desiredFacing.z),
      };
      const canonicalPosition = {
        x: Number(sourceCenterlinePosition.x) + Number(canonicalFacing.x) * leadMeters,
        y: Number(desired.position.y),
        z: Number(sourceCenterlinePosition.z) + Number(canonicalFacing.z) * leadMeters,
      };
      const socket = grant.endpointSockets.find(({ id }) => id === desired.id);
      socket.sourceCenterlinePosition = sourceCenterlinePosition;
      socket.position = canonicalPosition;
      socket.facing = canonicalFacing;
      const landing = grant.socketLandingOverlapGrants.find(({ socketId }) => (
        socketId === desired.id
      ));
      landing.center = { ...canonicalPosition, y: Number(canonicalPosition.y) + 1.8 };
      return {
        candidates: [{
          sideSign: 1,
          facing: desiredFacing,
          stationEligible: true,
          stationBodyBlocked: false,
          fullRoomBodyBlocked: false,
          approachIntersectsOwnCenterline: false,
          hardRouteOverlapArea: 0,
          roomOverlapArea: 0,
          ownRouteOverlapArea: 0,
          authoredScore: 1,
          fullRoomWitness: {
            center: { ...desired.position },
            continuationCenter: { ...desired.position },
            continuationRoute: [{ ...desired.position }],
          },
        }],
      };
    }),
  };
  operation.planningStationSideAlternativeOrdinal = 1;
  const resolvedGrant = objectiveCoverageGrantForOperationStationSide(grant, operation);
  const resolvedSocketById = new Map(resolvedGrant.endpointSockets.map((socket) => (
    [String(socket.id), socket]
  )));
  const resolvedLandingBySocketId = new Map(
    resolvedGrant.socketLandingOverlapGrants.map((overlap) => (
      [String(overlap.socketId), overlap]
    )),
  );
  operation.socketLandingOverlapGrants = structuredClone(
    resolvedGrant.socketLandingOverlapGrants,
  );
  for (const segment of plan.segments.filter(({ operationId }) => (
    operationId === operation.id
  ))) {
    for (const [endpointIndex, endpoint] of [segment.from, segment.to].entries()) {
      const socket = resolvedSocketById.get(String(endpoint.socketId ?? endpoint.id));
      if (!socket) continue;
      endpoint.position = structuredClone(socket.position);
      endpoint.facing = structuredClone(socket.facing);
      const pathIndex = endpointIndex === 0 ? 0 : segment.path.length - 1;
      segment.path[pathIndex] = structuredClone(socket.position);
      segment.landings[endpointIndex].position = structuredClone(socket.position);
      segment.landingVolumes[endpointIndex].center = {
        ...structuredClone(socket.position),
        y: Number(socket.position.y) + 0.25,
      };
      const role = endpointIndex === 0 ? 'from' : 'to';
      segment.endpointSeams[endpointIndex] = createDungeonRouteEndpointSeam(socket, {
        id: `${segment.id}:${role}-endpoint-seam`,
        segmentId: segment.id,
        operationId: operation.id,
        networkId: operation.id,
        nodeId: endpoint.nodeId,
        socketId: endpoint.socketId ?? endpoint.id,
        localSocketId: socket.localSocketId ?? endpoint.localSocketId ?? null,
        role,
        elevationBand: operation.progressionBandId,
        parentOwnerId: resolvedLandingBySocketId.get(String(socket.id))
          ?.parentOwnerId ?? null,
      });
      segment.localApproachWitnesses[endpointIndex].path = [{
        x: Number(socket.position.x) - Number(socket.facing.x) * 5.6,
        y: Number(socket.position.y),
        z: Number(socket.position.z) - Number(socket.facing.z) * 5.6,
      }, structuredClone(socket.position)];
      const physicalSpan = operation.featurelessSpans.find(({ segmentId }) => (
        segmentId === segment.id
      ));
      physicalSpan.path = structuredClone(segment.path);
      physicalSpan.distanceMeters = maximumContinuousLevelPathDistance(segment.path);
    }
  }
  rehash(plan);

  const accepted = validateV4(plan, fixture);
  assert.equal(accepted.accepted, true, JSON.stringify(accepted.errors));

  delete operation.planningStationSideAlternativeOrdinal;
  rehash(plan);
  const canonicalMismatch = validateV4(plan, fixture);
  assert.equal(canonicalMismatch.accepted, false);
  assert.ok(canonicalMismatch.errors.some(({ code }) => (
    code === 'route-network-endpoint-seam-record-invalid'
      || code === 'route-network-external-endpoint-not-granted'
      || code === 'route-network-grant-copy-mismatch'
  )), JSON.stringify(canonicalMismatch.errors));
});

test('V4 rejects landmark parent seams displaced from their authored socket grant', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const operation = plan.operations[0];
  const grant = fixture.extensionRegions[0].routeNetworkGrants[0];
  const nodeById = new Map(plan.nodes.map((node) => [String(node.id), node]));
  const parentSocketById = new Map(grant.endpointSockets.map((socket) => (
    [String(socket.id), socket]
  )));
  const parentOverlapBySocketId = new Map(grant.socketLandingOverlapGrants.map((overlap) => (
    [String(overlap.socketId), overlap]
  )));
  const parentSegments = plan.segments.filter((segment) => (
    [segment.from, segment.to].filter((endpoint) => nodeById.has(String(endpoint.nodeId))).length
      === 1
  ));
  assert.equal(parentSegments.length, 2);

  for (const segment of parentSegments) {
    const endpoints = [segment.from, segment.to];
    const externalIndex = nodeById.has(String(segment.from.nodeId)) ? 1 : 0;
    const internalIndex = externalIndex === 0 ? 1 : 0;
    const externalEndpoint = endpoints[externalIndex];
    const internalEndpoint = endpoints[internalIndex];
    const parentSocket = parentSocketById.get(String(
      externalEndpoint.socketId ?? externalEndpoint.id,
    ));
    const internalNode = nodeById.get(String(internalEndpoint.nodeId));
    const internalSocket = internalNode.sockets.find(({ id }) => (
      String(id) === String(internalEndpoint.socketId ?? internalEndpoint.id)
    ));
    assert.ok(parentSocket && internalSocket);

    internalSocket.facing = {
      x: -Number(parentSocket.facing.x),
      y: 0,
      z: -Number(parentSocket.facing.z),
    };
    internalEndpoint.facing = { ...internalSocket.facing };
    const physicalParentPosition = landmarkSharedThresholdParentPosition(
      parentSocket,
      internalSocket,
    );
    externalEndpoint.position = { ...physicalParentPosition };
    externalEndpoint.authoredSocketPosition = { ...parentSocket.position };
    segment.routeRole = 'parent-station-attachment';
    segment.path = [
      { ...segment.from.position },
      { ...segment.to.position },
    ];
    segment.landings = endpoints.map(({ position }) => ({ position: { ...position } }));
    const midpoint = {
      x: (Number(segment.from.position.x) + Number(segment.to.position.x)) * 0.5,
      y: 0.25,
      z: (Number(segment.from.position.z) + Number(segment.to.position.z)) * 0.5,
    };
    for (const volume of [
      ...(segment.occupiedVolumes ?? []),
      ...(segment.clearanceVolumes ?? []),
    ]) volume.center = { ...midpoint };
    for (const [landingIndex, volume] of (segment.landingVolumes ?? []).entries()) {
      volume.center = { ...endpoints[landingIndex].position, y: 0.25 };
    }

    const exactSockets = endpoints.map((endpoint, endpointIndex) => {
      if (endpointIndex === externalIndex) {
        return { ...parentSocket, position: { ...physicalParentPosition } };
      }
      return internalSocket;
    });
    segment.endpointSeams = exactSockets.map((socket, endpointIndex) => {
      const endpoint = endpoints[endpointIndex];
      const role = endpointIndex === 0 ? 'from' : 'to';
      const parentOverlap = parentOverlapBySocketId.get(String(
        endpoint.socketId ?? endpoint.id,
      ));
      return createDungeonRouteEndpointSeam(socket, {
        id: `${segment.id}:${role}-endpoint-seam`,
        segmentId: segment.id,
        operationId: operation.id,
        networkId: operation.id,
        nodeId: endpoint.nodeId,
        socketId: endpoint.socketId ?? endpoint.id,
        localSocketId: socket.localSocketId ?? endpoint.localSocketId ?? null,
        role,
        elevationBand: internalNode.progressionBandId,
        parentOwnerId: parentOverlap?.parentOwnerId ?? null,
      });
    });
    segment.localApproachWitnesses = exactSockets.map((socket, endpointIndex) => {
      const endpoint = endpoints[endpointIndex];
      const start = {
        x: Number(socket.position.x) - Number(socket.facing.x) * 5.6,
        y: Number(socket.position.y),
        z: Number(socket.position.z) - Number(socket.facing.z) * 5.6,
      };
      if (endpointIndex === internalIndex) {
        const intent = internalNode.occupiedVolumes.find(({ id }) => (
          id === `${segment.id}:endpoint-${internalIndex}:walkable-intent`
        ));
        assert.ok(intent);
        const alongX = Math.abs(Number(socket.facing.x)) > 0.5;
        intent.center = {
          x: (start.x + Number(socket.position.x)) * 0.5,
          y: Number(socket.position.y) + 0.1,
          z: (start.z + Number(socket.position.z)) * 0.5,
        };
        intent.size = {
          x: alongX ? 5.6 : 0.2,
          y: 0.2,
          z: alongX ? 0.2 : 5.6,
        };
      }
      return {
        nodeId: endpoint.nodeId,
        socketId: endpoint.socketId ?? endpoint.id,
        localSocketId: socket.localSocketId ?? endpoint.localSocketId ?? null,
        path: [start, { ...socket.position }],
      };
    });
    const featurelessSpan = operation.featurelessSpans.find(({ segmentId }) => (
      segmentId === segment.id
    ));
    featurelessSpan.path = structuredClone(segment.path);
    featurelessSpan.distanceMeters = maximumContinuousLevelPathDistance(segment.path);
  }
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code }) => (
    code === 'route-network-segment-endpoint-socket-mismatch'
      || code === 'route-network-external-endpoint-not-granted'
  )), JSON.stringify(validation.errors));
});

test('V4 rejects duplicate, skipped, and reordered endpoint-seam lattice cells explicitly', () => {
  const mutations = [{
    label: 'duplicate',
    mutate(seam) {
      const threshold = seam.orderedCells.find(({ signedDepthTiles, lane }) => (
        signedDepthTiles === 0 && lane === 0
      ));
      const outside = seam.orderedCells.find(({ signedDepthTiles, lane }) => (
        signedDepthTiles === 1 && lane === 0
      ));
      outside.gridX = threshold.gridX;
      outside.gridZ = threshold.gridZ;
    },
  }, {
    label: 'skip',
    mutate(seam) {
      const outside = seam.orderedCells.find(({ signedDepthTiles, lane }) => (
        signedDepthTiles === 1 && lane === 0
      ));
      outside.gridX += seam.facing.x * 3;
      outside.gridZ += seam.facing.z * 3;
    },
  }, {
    label: 'reorder',
    mutate(seam) {
      [seam.orderedCells[0], seam.orderedCells[1]] = [
        seam.orderedCells[1],
        seam.orderedCells[0],
      ];
    },
  }];

  for (const { label, mutate } of mutations) {
    const { fixture, plan } = makeV4ValidationFixture();
    const segment = plan.segments[1];
    const seam = segment.endpointSeams[0];
    mutate(seam);
    rehash(plan);

    const rejected = validateV4(plan, fixture);
    assert.equal(rejected.accepted, false, label);
    assert.ok(rejected.errors.some(({ code, context }) => (
      code === 'route-network-endpoint-seam-grid-lattice-invalid'
        && context.segmentId === segment.id
        && context.role === 'from'
    )), `${label}: ${JSON.stringify(rejected.errors)}`);
  }
});

test('V4 pyramid room seams do not inherit remote landmark-wall ownership', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const grant = fixture.extensionRegions[0].routeNetworkGrants[0];
  const remoteParentSocket = grant.endpointSockets[1];
  const physicalParentOwnerId = 'keycardRoom_ground';
  const pyramidRoom = plan.nodes[2];
  pyramidRoom.exactParentEndpoint = true;
  pyramidRoom.parentEndpointSocketId = remoteParentSocket.id;
  pyramidRoom.parentEndpointSocketKind = 'landmark-wall-aperture';
  grant.socketLandingOverlapGrants[1].parentOwnerId = physicalParentOwnerId;
  plan.operations[0].socketLandingOverlapGrants[1].parentOwnerId = physicalParentOwnerId;
  for (const segment of plan.segments) {
    for (const [endpointIndex, endpoint] of [segment.from, segment.to].entries()) {
      if ((endpoint.socketId ?? endpoint.id) !== remoteParentSocket.id) continue;
      segment.endpointSeams[endpointIndex].overlapEnvelope.parentOwnerId =
        physicalParentOwnerId;
    }
  }

  const roomEndpointSeams = plan.segments.flatMap((segment) => (
    [segment.from, segment.to].flatMap((endpoint, endpointIndex) => (
      endpoint.nodeId === pyramidRoom.id ? [segment.endpointSeams[endpointIndex]] : []
    ))
  ));
  assert.ok(roomEndpointSeams.length >= 2);
  assert.equal(roomEndpointSeams.every(({ overlapEnvelope }) => (
    overlapEnvelope.parentOwnerId == null
  )), true);
  rehash(plan);

  const accepted = validateV4(plan, fixture);
  assert.equal(accepted.accepted, true, JSON.stringify(accepted.errors));

  roomEndpointSeams[0].overlapEnvelope.parentOwnerId = physicalParentOwnerId;
  rehash(plan);
  const broadened = validateV4(plan, fixture);
  assert.equal(broadened.accepted, false);
  assert.ok(broadened.errors.some(({ code, context }) => (
    code === 'route-network-endpoint-seam-record-invalid'
      && context.segmentId === roomEndpointSeams[0].segmentId
      && context.expectedParentOwnerId === null
      && context.actualParentOwnerId === physicalParentOwnerId
      && context.mismatchedFields.includes('overlapEnvelope')
  )), JSON.stringify(broadened.errors));

  delete roomEndpointSeams[0].overlapEnvelope.parentOwnerId;
  pyramidRoom.parentEndpointSocketKind = 'authored-corridor-station';
  rehash(plan);
  const stationWithoutInheritedOwner = validateV4(plan, fixture);
  assert.equal(stationWithoutInheritedOwner.accepted, false);
  assert.ok(stationWithoutInheritedOwner.errors.some(({ code, context }) => (
    code === 'route-network-endpoint-seam-record-invalid'
      && context.expectedParentOwnerId === physicalParentOwnerId
      && context.actualParentOwnerId === null
      && context.mismatchedFields.includes('overlapEnvelope')
  )), JSON.stringify(stationWithoutInheritedOwner.errors));
});

test('V4 rejects endpoint-node solid overlap outside the segment exact seam', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const segment = plan.segments[1];
  const endpointNode = plan.nodes.find(({ id }) => id === segment.from.nodeId);
  endpointNode.occupiedVolumes.push({
    id: `${endpointNode.id}:outside-seam-solid`,
    ownerId: endpointNode.id,
    center: { x: segment.from.position.x, y: 0.25, z: 6 },
    size: { x: 0.5, y: 0.5, z: 0.5 },
  });
  segment.occupiedVolumes[0].center = {
    x: segment.from.position.x,
    y: 0.25,
    z: 6,
  };
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'route-network-segment-endpoint-overlap-outside-seam'
      && context.segmentId === segment.id
      && context.nodeId === endpointNode.id
  )), JSON.stringify(validation.errors));
});

test('V4 allows shared segment geometry only inside the intersection of both endpoint seams', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const first = plan.segments[0];
  const second = plan.segments[1];
  const sharedPoint = { x: 7, y: 0.25, z: 7 };
  first.occupiedVolumes[0].center = { ...sharedPoint };
  second.occupiedVolumes[0].center = { ...sharedPoint };
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'route-network-segment-shared-overlap-outside-seams'
      && [context.firstSegmentId, context.secondSegmentId].includes(first.id)
      && [context.firstSegmentId, context.secondSegmentId].includes(second.id)
  )), JSON.stringify(validation.errors));
});

test('V4 requires both exact socket approaches to remain flat and facing-aligned for 5.6m', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const segment = plan.segments[0];
  segment.path = [
    { ...segment.from.position },
    { ...segment.to.position },
  ];
  rehash(plan);

  const validation = validateV4(plan, fixture);
  const approachErrors = validation.errors.filter(({ code, context }) => (
    code === 'route-network-socket-approach-invalid'
      && context.segmentId === segment.id
  ));
  assert.equal(validation.accepted, false);
  assert.deepEqual(
    approachErrors.map(({ context }) => context.side).sort(),
    ['destination', 'source'],
  );
  assert.ok(approachErrors.every(({ context }) => (
    context.minimumApproachMeters === 5.6
      && context.approachLengthMeters < context.minimumApproachMeters
  )));
});

test('V4 rejects a route witness whose non-adjacent corridor legs overlap', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const segment = plan.segments[1];
  segment.path = [
    { x: 0, y: 0, z: 0 },
    { x: 5.6, y: 0, z: 0 },
    { x: 5.6, y: 0, z: 11.2 },
    { x: -5.6, y: 0, z: 11.2 },
    { x: -5.6, y: 0, z: 0 },
    { x: 6.4, y: 0, z: 0 },
    { x: 12, y: 0, z: 0 },
  ];
  plan.operations[0].featurelessSpans[1].path = structuredClone(segment.path);
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'route-network-segment-path-self-overlap'
      && context.segmentId === segment.id
      && context.reason === 'non-adjacent-self-overlap'
      && context.secondLegIndex >= context.firstLegIndex + 2
  )));
});

test('V4 rejects an adjacent route reversal even when both endpoint approaches are valid', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const segment = plan.segments[1];
  segment.path = [
    { x: 0, y: 0, z: 0 },
    { x: 8.4, y: 0, z: 0 },
    { x: 5.6, y: 0, z: 0 },
    { x: 12, y: 0, z: 0 },
  ];
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'route-network-segment-path-self-overlap'
      && context.segmentId === segment.id
      && context.reason === 'adjacent-backtracking'
  )));
  assert.equal(validation.errors.some(({ code, context }) => (
    code === 'route-network-socket-approach-invalid'
      && context.segmentId === segment.id
  )), false);
});

test('V4 enforces each vertical connector family minimum horizontal run', () => {
  const minimumByFamily = new Map([
    ['slope', 44.8],
    ['ladder', 28],
    ['lift', 36.4],
  ]);
  for (const [connectorFamily, minimumHorizontalRunMeters] of minimumByFamily) {
    const { fixture, plan } = makeV4ValidationFixture();
    const segment = plan.segments[2];
    segment.connectorFamily = connectorFamily;
    rehash(plan);

    const validation = validateV4(plan, fixture);
    assert.equal(validation.accepted, false, connectorFamily);
    assert.ok(validation.errors.some(({ code, context }) => (
      code === 'route-network-vertical-connector-run-too-short'
        && context.segmentId === segment.id
        && context.connectorFamily === connectorFamily
        && context.minimumHorizontalRunMeters === minimumHorizontalRunMeters
        && context.horizontalRunMeters < minimumHorizontalRunMeters
    )), `${connectorFamily} minimum run`);
  }
});

test('V4 rejects a purely vertical connector footprint without treating elevation as zero length', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const segment = plan.segments[2];
  const destination = {
    ...segment.to.position,
    x: segment.from.position.x,
    y: segment.from.position.y + 14,
  };
  segment.connectorFamily = 'ladder';
  segment.to.position = destination;
  segment.path = [{ ...segment.from.position }, destination];
  const destinationNode = plan.nodes.find(({ id }) => id === segment.to.nodeId);
  destinationNode.sockets.find(({ id }) => id === segment.to.socketId).position = destination;
  rehash(plan);

  const validation = validateV4(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('route-network-vertical-connector-footprint-invalid'));
  assert.equal(codes.includes('segment-path-degenerate'), false);
});

test('V4 physical witnesses allow a real vertical transfer point on a sufficient family run', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const segment = plan.segments[2];
  segment.connectorFamily = 'slope';
  segment.path = [
    { x: 12, y: 0, z: 0 },
    { x: 17.6, y: 0, z: 0 },
    { x: 17.6, y: 0, z: -11.2 },
    { x: 62.4, y: 0, z: -11.2 },
    { x: 62.4, y: 14, z: -11.2 },
    { x: 62.4, y: 14, z: 22.4 },
    { x: 18.4, y: 14, z: 22.4 },
    { x: 18.4, y: 14, z: 0 },
    { x: 24, y: 14, z: 0 },
  ];
  rehash(plan);

  const validation = validateV4(plan, fixture);
  const rejectedPhysicalCodes = new Set([
    'segment-path-degenerate',
    'route-network-socket-approach-invalid',
    'route-network-segment-path-self-overlap',
    'route-network-vertical-connector-footprint-invalid',
    'route-network-vertical-connector-run-too-short',
  ]);
  assert.deepEqual(
    validation.errors.filter(({ code, context }) => (
      rejectedPhysicalCodes.has(code) && context.segmentId === segment.id
    )),
    [],
    JSON.stringify(validation.errors),
  );
});

test('V4 rejects a keycard-band connection whose requirements have no physical gate', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const connection = fixture.extensionRegions[0].progressionSnapshot.connections
    .find(({ id }) => id === 'keycardRoom_trapRoom');
  connection.gateId = null;
  connection.gatePlacementSide = null;

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'progression-boundary-gate-missing'
      && context.connectionId === connection.id
      && context.gateId === null
  )));
});

test('V4 rejects a cross-band route that omits its operation-owned source gate', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const grant = fixture.extensionRegions[0].routeNetworkGrants[0];
  const operation = plan.operations[0];
  grant.crossedBoundaryIds = ['Door_Alpha'];
  grant.requiredCredentialIds = ['Keycard_Alpha'];
  grant.sourceGate = {
    gateId: 'Door_Alpha',
    gatePlacementSide: 'source',
    requiredCredentialIds: ['Keycard_Alpha'],
    encounterRequirementId: null,
  };
  operation.crossedBoundaryIds = ['Door_Alpha'];
  operation.requiredCredentialIds = ['Keycard_Alpha'];
  delete operation.sourceGate;
  rehash(plan);

  const validation = validateV4(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('route-network-source-gate-mismatch'));
  assert.ok(codes.includes('route-network-cross-band-gate-missing'));
});

test('V4 rejects runtime-state IDs reused by different operations', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const sharedStateId = Object.values(plan.operations[0].stableRuntimeStateIds)[0];
  plan.operations.push({
    schema: 'ruindivex-dungeon-augmentation-operation/v1',
    id: v4Id('operation', 1),
    type: 'optionalBranch',
    parentRegionId: 'validation-fixture-region',
    nodeIds: [],
    segmentIds: [],
    runtimeStateIds: [sharedStateId],
    bidirectional: true,
    returnRouteGuaranteed: true,
  });
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'augmentation-runtime-state-id-duplicated'
      && context.runtimeStateId === sharedStateId
      && context.firstOperationId === plan.operations[0].id
      && context.duplicateOperationId === plan.operations[1].id
  )));
});

test('V4 measures objective coverage length from the exact centerline', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const snapshot = fixture.extensionRegions[0].progressionSnapshot;
  const connection = snapshot.connections.find(({ id }) => id === 'entrance_keycardRoom');
  snapshot.objectiveRouteIds = [connection.logicalEdgeId];
  connection.centerline = [
    { x: -10, y: 0, z: -10 },
    { x: 30, y: 0, z: -10 },
  ];
  // The false 20m declaration used to avoid the 33.6m coverage requirement
  // despite the authored centerline actually spanning 40m.
  connection.pathLengthMeters = 20;

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'progression-snapshot-path-length-mismatch'
      && context.connectionId === connection.id
      && context.declaredLengthMeters === 20
      && context.measuredLengthMeters === 40
  )));
});

test('shared-node segment overlap is allowed inside the exact junction endpoint footprint', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const junctionNode = plan.nodes.find(({ junction }) => junction?.clearCoreVolume);
  assert.ok(junctionNode);
  const segments = plan.segments.filter((segment) => (
    [segment.from?.nodeId, segment.to?.nodeId].includes(junctionNode.id)
  ));
  assert.ok(segments.length >= 2);
  for (const segment of segments.slice(0, 2)) {
    segment.occupiedVolumes[0].center = { x: 0, y: 0.25, z: 0 };
    segment.occupiedVolumes[0].size = { x: 0.4, y: 0.4, z: 0.4 };
  }
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, true, JSON.stringify(validation.errors));
  assert.equal(validation.errors.some(({ code }) => (
    code === 'supplement-segments-overlap'
  )), false);
});

test('shared-node segment overlap is rejected when it continues past the endpoint footprint', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const junctionNode = plan.nodes.find(({ junction }) => junction?.clearCoreVolume);
  assert.ok(junctionNode);
  const segments = plan.segments.filter((segment) => (
    [segment.from?.nodeId, segment.to?.nodeId].includes(junctionNode.id)
  ));
  assert.ok(segments.length >= 2);
  for (const segment of segments.slice(0, 2)) {
    segment.occupiedVolumes[0].center = { x: 4, y: 0.25, z: 0 };
    segment.occupiedVolumes[0].size = { x: 0.5, y: 0.5, z: 0.5 };
  }
  rehash(plan);

  const validation = validateV4(plan, fixture);
  const overlapError = validation.errors.find(({ code, context }) => (
    code === 'route-network-segment-shared-overlap-outside-seams'
      && context.firstSegmentId === segments[0].id
      && context.secondSegmentId === segments[1].id
      && context.firstVolumeClass === 'occupied'
      && context.secondVolumeClass === 'occupied'
  ));
  assert.equal(validation.accepted, false);
  assert.ok(overlapError, JSON.stringify(validation.errors));
  assert.deepEqual(overlapError.context.sharedEndpointNodeIds, [junctionNode.id]);
  assert.equal(overlapError.context.allowedEndpointFootprintIds.length, 1);
  assert.match(overlapError.context.allowedEndpointFootprintIds[0], /endpoint-seam:.*intersection$/);
});

test('V4 rejects altered endpoint grants and same-band nodes that escape their access domain', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  plan.operations[0].endpointSocketIds[0] = 'invented-nearest-socket';
  plan.nodes[1].progressionBandId = 1;
  rehash(plan);

  const validation = validateV4(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('route-network-endpoint-grant-mismatch'));
  assert.ok(codes.includes('route-network-node-domain-mismatch'));
});

test('V4 rejects pyramid wall, cycle, aperture, and protected-volume mutations', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const grant = fixture.extensionRegions[0].routeNetworkGrants[0];
  grant.openedWallSides = ['east', 'west'];
  grant.endpointSockets[0].widthMeters = 5.6;
  plan.operations[0].cycleRankDelta = 0;
  grant.protectedVolumes[0] = structuredClone(plan.nodes[1].occupiedVolumes[0]);
  rehash(plan);

  const validation = validateV4(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('pyramid-loop-wall-complement-invalid'));
  assert.ok(codes.includes('pyramid-loop-aperture-contract-invalid'));
  assert.ok(codes.includes('pyramid-loop-cycle-rank-invalid'));
  assert.ok(codes.includes('route-network-node-overlaps-protected-volume'));
});

test('V4 pyramid loops keep external geometry in parent band 0', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const operation = plan.operations[0];
  const segment = plan.segments.find(({ id }) => operation.segmentIds.includes(id));
  segment.connectorFamily = 'slope';
  segment.path[1].y = 14;
  rehash(plan);

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code, context }) => (
    code === 'pyramid-loop-external-elevation-invalid'
      && context.operationId === operation.id
      && context.parentElevation === 0
  )), JSON.stringify(validation.errors));
});

test('V4 rejects fake junctions and substantive-module budget violations', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const junction = plan.nodes[0];
  junction.junction.decisionSocketIds = ['capped-or-invented-socket'];
  fixture.extensionRegions[0].routeNetworkGrants[0].maximumModules = 3;
  rehash(plan);

  const validation = validateV4(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('route-network-junction-decision-sockets-invalid'));
  assert.ok(codes.includes('route-network-module-budget-violated'));
});

test('V4 rejects a release-wide total of 31 substantive modules', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const operation = plan.operations[0];
  const templateRoom = plan.nodes.find(({ kind }) => kind === 'supplementRoom');
  for (let index = 0; index < 27; index += 1) {
    const id = `${operation.id}:global-budget-room:${index}`;
    const center = { x: 200 + index * 50, y: 0, z: 200 };
    const room = structuredClone(templateRoom);
    room.id = id;
    room.placement = { ...room.placement, center };
    room.sockets = [];
    room.anchors = room.anchors.map((anchor, anchorIndex) => ({
      ...anchor,
      id: `${id}:anchor:${anchorIndex}`,
      position: { ...center },
    }));
    room.occupiedVolumes = [{
      id: `${id}:occupied`,
      center: { ...center, y: 1 },
      size: { x: 2, y: 2, z: 2 },
    }];
    room.clearanceVolumes = [{
      id: `${id}:clearance`,
      center: { ...center, y: 1 },
      size: { x: 1, y: 2, z: 1 },
    }];
    plan.nodes.push(room);
    operation.nodeIds.push(id);
  }
  operation.substantiveModuleCount = 31;
  operation.physicalNodeCount = 31;
  operation.moduleCount = 31;
  rehash(plan);

  const result = validateV4(plan, fixture);
  assert.equal(result.accepted, false);
  assert.ok(result.errors.some(({ code, context }) => (
    code === 'route-network-global-budget-violated'
      && context.substantiveModuleCount === 31
      && context.physicalNodeCount === 31
      && context.maximumModules === 30
  )));
});

test('V4 accumulates featureless length through bends and rejects spans over 33.6m', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const segment = plan.segments[1];
  const from = segment.path[0];
  const to = segment.path.at(-1);
  segment.path = [
    { ...from },
    { x: from.x, y: from.y, z: 20 },
    { x: to.x, y: to.y, z: 20 },
    { ...to },
  ];
  plan.operations[0].featurelessSpans[1].path = structuredClone(segment.path);
  rehash(plan);

  const validation = validateV4(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('route-network-featureless-span-exceeded'));
  assert.ok(codes.includes('route-network-accumulated-featureless-span-exceeded'));
});

test('V4 carries featureless distance across the canonical boss-shrine degree-two shell', () => {
  const firstJunction = {
    id: 'boss-shrine:node:0',
    kind: 'supplementConnectorJunction',
    connectorOwned: true,
    placement: { center: { x: 0, y: 0, z: 0 } },
    sockets: [],
  };
  const connectorShell = {
    id: 'boss-shrine:node:1',
    kind: 'supplementConnectorModule',
    connectorOwned: true,
    // Optimistic planner metadata must not turn a capped third arm into a
    // final-graph reset.
    plannedMinimumGraphDegree: 3,
    placement: { center: { x: 30.8, y: 0, z: 0 } },
    sockets: [],
  };
  const secondJunction = {
    id: 'boss-shrine:node:2',
    kind: 'supplementConnectorJunction',
    connectorOwned: true,
    placement: { center: { x: 60.4, y: 0, z: 0 } },
    sockets: [],
  };
  const nodeById = new Map([
    [firstJunction.id, firstJunction],
    [connectorShell.id, connectorShell],
    [secondJunction.id, secondJunction],
  ]);
  const graphAdjacency = new Map([...nodeById.keys()].map((nodeId) => [nodeId, []]));
  const addEdge = (id, from, to, lengthMeters, fromPosition, toPosition) => {
    graphAdjacency.get(from).push({
      id, to, lengthMeters, fromPosition, toPosition,
    });
    graphAdjacency.get(to).push({
      id,
      to: from,
      lengthMeters,
      fromPosition: toPosition,
      toPosition: fromPosition,
    });
  };
  const firstShellSocket = { x: 0, y: 0, z: 0 };
  const secondShellSocket = { x: 8.4, y: 0, z: 5.6 };
  addEdge(
    'boss-shrine:segment:3',
    firstJunction.id,
    connectorShell.id,
    30.8,
    { x: -30.8, y: 0, z: 0 },
    firstShellSocket,
  );
  addEdge(
    'boss-shrine:segment:4',
    connectorShell.id,
    secondJunction.id,
    19.6,
    secondShellSocket,
    { x: 28, y: 0, z: 5.6 },
  );
  const operationNodeIds = new Set(nodeById.keys());
  const operation = {
    id: 'boss-shrine:operation',
    topologyTemplateId: 'multi-door-room-chain',
  };
  const realJunctionNodeIds = new Set([firstJunction.id, secondJunction.id]);
  const evaluation = evaluateDungeonRouteNetworkFeaturelessGraph({
    operation,
    operationNodeIds,
    graphAdjacency,
    nodeById,
    externalKeys: new Set(),
    realJunctionNodeIds,
    maximum: 33.6,
  });

  assert.equal(evaluation.overlongSpans.length, 2, 'both traversal directions reject');
  const expected = 30.8 + Math.hypot(8.4, 5.6) + 19.6;
  assert.ok(evaluation.overlongSpans.every(({ lengthMeters }) => (
    Math.abs(lengthMeters - expected) <= 1e-9
  )));
  assert.ok(evaluation.overlongSpans.every(({ traversalTrace }) => (
    traversalTrace.some(({ connectorModuleTraversalMeters }) => (
      Math.abs(connectorModuleTraversalMeters - Math.hypot(8.4, 5.6)) <= 1e-9
    ))
  )));

  const challengeBranch = {
    id: 'boss-shrine:node:challenge',
    kind: 'supplementRoom',
    contentRole: 'challenge',
    placement: { center: { x: 30.8, y: 0, z: 11.2 } },
    sockets: [],
  };
  nodeById.set(challengeBranch.id, challengeBranch);
  graphAdjacency.set(challengeBranch.id, []);
  operationNodeIds.add(challengeBranch.id);
  addEdge(
    'boss-shrine:segment:challenge-branch',
    connectorShell.id,
    challengeBranch.id,
    5.6,
    { x: 30.8, y: 0, z: 5.6 },
    { x: 30.8, y: 0, z: 11.2 },
  );
  connectorShell.kind = 'supplementConnectorJunction';
  connectorShell.junction = { countsAsMeaningfulStation: true };
  realJunctionNodeIds.add(connectorShell.id);
  assert.equal(graphAdjacency.get(connectorShell.id).length, 3);
  const withPhysicalThirdArm = evaluateDungeonRouteNetworkFeaturelessGraph({
    operation,
    operationNodeIds,
    graphAdjacency,
    nodeById,
    externalKeys: new Set(),
    realJunctionNodeIds,
    maximum: 33.6,
  });
  assert.equal(withPhysicalThirdArm.overlongSpans.length, 0);
});

test('V4 accepts both far-side shortcut families with an exact physical shallow gate', () => {
  for (const elevationMode of ['shortcut-lift', 'drop-ladder']) {
    const { fixture, plan } = makeV4ValidationFixture();
    appendV4CrossBandShortcutFixture(fixture, plan, { elevationMode });
    const validation = validateV4(plan, fixture);
    assert.equal(
      validation.accepted,
      true,
      `${elevationMode}: ${JSON.stringify(validation.errors)}`,
    );
  }
});

test('V4 rejects missing, late, deep-side, wrong-credential, and authored shortcut gates', () => {
  const mutationCases = [{
    label: 'missing shallow gate',
    expectedCode: 'cross-band-shortcut-shallow-arm-gate-missing',
    mutate: ({ segments }) => {
      delete segments[0].sourceGate;
      delete segments[0].sourceGateSocketId;
      delete segments[0].gateEndpointRole;
      delete segments[0].gatePlacementSide;
      delete segments[0].requiredCredentialIds;
    },
  }, {
    label: 'late internal gate',
    expectedCode: 'cross-band-shortcut-source-gate-late',
    mutate: ({ segments, grant }) => {
      for (const field of [
        'sourceGate', 'sourceGateSocketId', 'gateEndpointRole',
        'gatePlacementSide', 'requiredCredentialIds',
      ]) delete segments[0][field];
      segments[1].sourceGate = structuredClone(grant.sourceGate);
      segments[1].sourceGateSocketId = grant.shallowEndpointSocketIds[0];
      segments[1].gateEndpointRole = 'from';
      segments[1].gatePlacementSide = 'source';
      segments[1].requiredCredentialIds = ['Keycard_Alpha'];
    },
  }, {
    label: 'deep-side gate',
    expectedCode: 'cross-band-shortcut-deep-arm-gate-invalid',
    mutate: ({ segments, grant, deepSocket }) => {
      segments[3].sourceGate = structuredClone(grant.sourceGate);
      segments[3].sourceGateSocketId = deepSocket.id;
      segments[3].gateEndpointRole = 'to';
      segments[3].gatePlacementSide = 'source';
      segments[3].requiredCredentialIds = ['Keycard_Alpha'];
    },
  }, {
    label: 'wrong shallow credential',
    expectedCode: 'cross-band-shortcut-shallow-arm-gate-mismatch',
    mutate: ({ segments }) => {
      segments[0].requiredCredentialIds = ['Keycard_Beta'];
    },
  }, {
    label: 'authored gate identity reused',
    expectedCode: 'cross-band-shortcut-source-gate-contract-invalid',
    mutate: ({ operation, grant, segments }) => {
      grant.sourceGate.gateId = 'Door_Alpha';
      operation.sourceGate.gateId = 'Door_Alpha';
      segments[0].sourceGate.gateId = 'Door_Alpha';
    },
  }, {
    label: 'boss shortcut endpoint',
    expectedCode: 'cross-band-shortcut-domain-invalid',
    mutate: ({ grant, deepSocket, segments }) => {
      deepSocket.roomId = 'bossRoom';
      deepSocket.nodeId = 'bossRoom';
      grant.endpointSockets[1].roomId = 'bossRoom';
      grant.endpointSockets[1].nodeId = 'bossRoom';
      segments[3].to.roomId = 'bossRoom';
      segments[3].to.nodeId = 'bossRoom';
    },
  }, {
    label: 'far-side activation omitted',
    expectedCode: 'cross-band-shortcut-far-side-activation-invalid',
    mutate: ({ segments }) => {
      segments[2].shortcut.activationSide = 'near';
    },
  }];
  for (const { label, expectedCode, mutate } of mutationCases) {
    const { fixture, plan } = makeV4ValidationFixture();
    const shortcut = appendV4CrossBandShortcutFixture(fixture, plan);
    mutate(shortcut);
    rehash(plan);
    const validation = validateV4(plan, fixture);
    assert.equal(validation.accepted, false, label);
    assert.ok(
      validation.errors.some(({ code }) => code === expectedCode),
      `${label}: ${JSON.stringify(validation.errors)}`,
    );
  }
});

test('V4 fails closed for late gates, unknown credentials, and keycard-band bypasses', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const snapshot = fixture.extensionRegions[0].progressionSnapshot;
  snapshot.connections[1].gatePlacementSide = 'destination';
  snapshot.connections[1].requiredCredentialIds = ['Unknown_Keycard'];
  snapshot.connections.push({
    id: 'entrance_trapRoom_bypass',
    logicalEdgeId: 'entrance_trapRoom_bypass',
    fromRoomId: 'entrance',
    toRoomId: 'trapRoom',
    progressionBandId: 1,
    accessDomainId: 'validation-fixture-region:access-domain:band-1',
    gateId: null,
    gatePlacementSide: null,
    requiredCredentialIds: [],
    dominanceBoundary: 'invalid-bypass',
    centerline: [{ x: -10, y: 0, z: -10 }, { x: 10, y: 0, z: -10 }],
    pathLengthMeters: 20,
  });

  const validation = validateV4(plan, fixture);
  const codes = validation.errors.map(({ code }) => code);
  assert.equal(validation.accepted, false);
  assert.ok(codes.includes('locked-gate-not-at-source-entrance'));
  assert.ok(codes.includes('unknown-gate-requirement'));
  assert.ok(codes.includes('progression-boundary-credential-missing'));
});

test('V4 rejects landing overlaps that extend beyond two clear approach tiles per side', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const overlap = fixture.extensionRegions[0]
    .routeNetworkGrants[0]
    .socketLandingOverlapGrants[0];
  overlap.size.z = 16.8;

  const validation = validateV4(plan, fixture);
  assert.equal(validation.accepted, false);
  assert.ok(validation.errors.some(({ code }) => (
    code === 'route-network-landing-overlap-out-of-bounds'
  )));
});

test('V4 base-volume overlap is allowed only inside the segment endpoint exact landing grant', () => {
  const { fixture, plan } = makeV4ValidationFixture();
  const endpointLanding = plan.segments[0].landingVolumes[0];
  fixture.baseDraft.occupiedVolumes = [{
    id: 'keycardRoom:doorway-threshold',
    ownerId: 'keycardRoom',
    center: { ...endpointLanding.center },
    size: { ...endpointLanding.size },
    purpose: 'authored-room-doorway-threshold',
  }];

  const bounded = validateV4(plan, fixture);
  assert.equal(bounded.accepted, true, JSON.stringify(bounded.errors));

  const physicalParentOwnerId = 'keycardRoom_ground';
  fixture.extensionRegions[0].routeNetworkGrants[0]
    .socketLandingOverlapGrants[0].parentOwnerId = physicalParentOwnerId;
  plan.operations[0]
    .socketLandingOverlapGrants[0].parentOwnerId = physicalParentOwnerId;
  plan.segments[0].endpointSeams[0]
    .overlapEnvelope.parentOwnerId = physicalParentOwnerId;
  fixture.baseDraft.occupiedVolumes[0] = {
    ...fixture.baseDraft.occupiedVolumes[0],
    id: `base:connection:${physicalParentOwnerId}:family-reserved:0:industrial-projected-column`,
    // Base-draft normalization may retain the logical edge as ownerId while
    // preserving the exact physical connector only in this stable ID.
    ownerId: 'logical-parent-without-ground-suffix',
  };
  rehash(plan);
  const normalizedPhysicalOwner = validateV4(plan, fixture);
  assert.equal(
    normalizedPhysicalOwner.accepted,
    true,
    JSON.stringify(normalizedPhysicalOwner.errors),
  );

  fixture.baseDraft.occupiedVolumes[0].id = 'keycardRoom:doorway-threshold';
  fixture.baseDraft.occupiedVolumes[0].ownerId = 'keycardRoom';
  endpointLanding.center.z = 8.4;
  fixture.baseDraft.occupiedVolumes[0].center.z = 8.4;
  rehash(plan);
  const escaped = validateV4(plan, fixture);
  assert.equal(escaped.accepted, false);
  assert.ok(escaped.errors.some(({ code, context }) => (
    code === 'route-network-segment-base-overlap-outside-landing-grant'
      && context.segmentId === plan.segments[0].id
      && context.baseVolumeId === 'keycardRoom:doorway-threshold'
  )));
});
