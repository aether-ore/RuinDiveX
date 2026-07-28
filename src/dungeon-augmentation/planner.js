import {
  DUNGEON_AUGMENTATION_DIAGNOSTICS_SCHEMA,
  DUNGEON_AUGMENTATION_EFFECTIVE_DRAFT_SCHEMA,
  DUNGEON_AUGMENTATION_OPERATION_SCHEMA,
  DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
  DUNGEON_AUGMENTATION_RESULT_SCHEMA,
  DUNGEON_AUGMENTATION_SCHEMA_REVISION,
  DUNGEON_TRANSITION_BAY_SCHEMA,
} from './contracts.js';
import {
  DUNGEON_AUGMENTATION_PROFILES,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
} from './catalog.js';
import {
  canonicalStringify,
  cloneDungeonAugmentationValue,
  deepFreezeDungeonAugmentationValue,
  hashCanonicalValue,
} from './canonical.js';
import {
  addDungeonPoints,
  createDungeonPolyline,
  dungeonPointDistance,
  measureDungeonPolyline,
  rotationQuarterTurnsForFacing,
  sampleDungeonPolyline,
  scaleDungeonPoint,
  toDungeonFacing,
  toDungeonPoint,
  transformDungeonLocalFacing,
  transformDungeonLocalPoint,
  transformDungeonVolume,
} from './geometry.js';
import { createDungeonSupplementId } from './ids.js';
import {
  DungeonAugmentationRandom,
  deriveDungeonAugmentationSeed,
} from './rng.js';
import {
  computeDungeonAugmentationPlanHash,
  computeEffectiveDungeonPlanHash,
  validateDungeonAugmentationPlan,
} from './validation.js';

function issue(code, message, context = {}) {
  return { code, message, context };
}

function clampInteger(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.floor(Number(value) || 0)));
}

function normalizeRange(range, fallback = [1, 1]) {
  const first = clampInteger(range?.[0] ?? fallback[0], 0, 64);
  const second = clampInteger(range?.[1] ?? fallback[1], 0, 64);
  return [Math.min(first, second), Math.max(first, second)];
}

function asPosition(value, fallbackY = 0) {
  if (!value) return null;
  const source = value.position ?? value;
  if (!Number.isFinite(Number(source.x)) || !Number.isFinite(Number(source.z))) return null;
  return toDungeonPoint({
    x: source.x,
    y: source.y ?? source.elevation ?? fallbackY,
    z: source.z,
  }, fallbackY);
}

function normalizeAttachmentSocket(socket, region) {
  const position = asPosition(socket, socket?.elevation ?? region?.elevation ?? 0);
  return {
    source: socket,
    id: String(socket?.id ?? ''),
    nodeId: String(socket?.nodeId ?? socket?.roomId ?? ''),
    position,
    facing: toDungeonFacing(socket),
    connectorFamilies: [...new Set([
      ...(socket?.connectorFamilies ?? []),
      ...(socket?.connectorFamily ? [socket.connectorFamily] : []),
    ].map(String))],
    widthMeters: Number(socket?.widthMeters ?? socket?.landingWidthMeters ?? 8.4),
    heightMeters: Number(socket?.heightMeters ?? socket?.clearanceHeightMeters ?? 5.6),
    availableDepthMeters: Number(socket?.availableDepthMeters ?? socket?.clearanceDepthMeters ?? Infinity),
    coordinateSpace: String(socket?.coordinateSpace ?? region?.coordinateSpace ?? 'parent-plan'),
  };
}

function normalizeEdgeEndpoint(raw, fallback, side, edge, fallbackPosition) {
  const source = raw ?? fallback ?? {};
  return {
    kind: 'parentSocket',
    id: String(source.id ?? `${edge.id ?? edge.logicalEdgeId}:${side}`),
    nodeId: String(source.nodeId
      ?? source.roomId
      ?? (side === 'source' ? edge.fromRoomId : edge.toRoomId)
      ?? ''),
    socketId: String(source.socketId ?? source.id ?? `${edge.id ?? edge.logicalEdgeId}:${side}`),
    position: asPosition(source, edge.elevation ?? 0) ?? fallbackPosition,
    facing: toDungeonFacing(source),
  };
}

function normalizeSpliceEdge(edge, region) {
  const rawPath = edge?.path ?? edge?.fullPath ?? edge?.bridgePath ?? [];
  const fallbackY = Number(edge?.elevation ?? edge?.levelElevation ?? 0);
  let path = (Array.isArray(rawPath) ? rawPath : []).map((point) => asPosition(point, fallbackY));
  const explicitSource = edge?.from?.position ?? edge?.fromSocket ?? edge?.sourceSocket;
  const explicitDestination = edge?.to?.position ?? edge?.toSocket ?? edge?.destinationSocket;
  const fallbackSourcePosition = path[0] ?? asPosition(explicitSource, fallbackY);
  const fallbackDestinationPosition = path.at(-1) ?? asPosition(explicitDestination, fallbackY);
  const source = normalizeEdgeEndpoint(edge?.from, explicitSource, 'source', edge, fallbackSourcePosition);
  const destination = normalizeEdgeEndpoint(edge?.to, explicitDestination, 'destination', edge, fallbackDestinationPosition);
  if (path.length < 2 && source.position && destination.position) {
    path = createDungeonPolyline([], source.position, destination.position);
  }
  if (path.length >= 2) {
    source.position ??= path[0];
    destination.position ??= path.at(-1);
  }
  const logicalEdgeId = String(edge?.logicalEdgeId ?? edge?.edgeId ?? edge?.id ?? 'edge');
  return {
    sourceContract: edge,
    id: String(edge?.id ?? logicalEdgeId),
    logicalEdgeId,
    source,
    destination,
    path,
    lengthMeters: Number.isFinite(Number(edge?.availableLengthMeters))
      ? Number(edge.availableLengthMeters)
      : measureDungeonPolyline(path),
    connectorFamilies: [...new Set([
      ...(edge?.connectorFamilies ?? []),
      ...(edge?.connectorFamily ? [edge.connectorFamily] : []),
      'service-gallery',
    ].map(String))],
    sourceThemeBinding: edge?.sourceThemeBinding ?? region?.themeBinding,
    destinationThemeBinding: edge?.destinationThemeBinding ?? region?.themeBinding,
    coordinateSpace: String(edge?.coordinateSpace ?? region?.coordinateSpace ?? 'parent-plan'),
  };
}

function chooseConnectorFamily(profile, offered = []) {
  const offeredSet = new Set(offered);
  return profile.connectorFamilies.find((family) => offeredSet.size === 0 || offeredSet.has(family)) ?? null;
}

function weightedGrammar(random, profile, grammars, predicate = () => true) {
  const choices = profile.grammarPool
    .map((entry) => ({ value: grammars[entry.id], weight: Number(entry.weight ?? 1) }))
    .filter(({ value }) => value && predicate(value));
  return random.weightedPick(choices, null);
}

function createNode({
  id,
  operationId,
  parentRegionId,
  ordinal,
  grammar,
  themeBinding,
  center,
  facing,
  coordinateSpace,
  progressionOrder,
}) {
  const placement = {
    center: toDungeonPoint(center),
    facing: toDungeonFacing(facing),
    rotationQuarterTurns: rotationQuarterTurnsForFacing(facing),
    coordinateSpace,
  };
  const socketIdByLocalId = new Map();
  const sockets = grammar.sockets.map((socket, socketOrdinal) => {
    const socketId = createDungeonSupplementId({
      parentRegionId,
      operationType: 'nodeSocket',
      operationOrdinal: ordinal,
      kind: socket.id,
      ordinal: socketOrdinal,
      sourceId: id,
    });
    socketIdByLocalId.set(socket.id, socketId);
    return {
      ...cloneDungeonAugmentationValue(socket),
      id: socketId,
      localSocketId: socket.id,
      nodeId: id,
      position: transformDungeonLocalPoint(socket.localPosition, placement),
      facing: transformDungeonLocalFacing(socket.localFacing, placement),
      state: 'capped',
      capRole: 'cap',
      segmentId: null,
    };
  });
  const anchors = grammar.anchors.map((anchor, anchorOrdinal) => ({
    ...cloneDungeonAugmentationValue(anchor),
    id: createDungeonSupplementId({
      parentRegionId,
      operationType: 'nodeAnchor',
      operationOrdinal: ordinal,
      kind: anchor.kind,
      ordinal: anchorOrdinal,
      sourceId: id,
    }),
    localAnchorId: anchor.id,
    nodeId: id,
    position: transformDungeonLocalPoint({
      ...anchor.localPosition,
      y: anchor.elevation ?? anchor.localPosition?.y ?? 0,
    }, placement),
  }));
  return {
    id,
    operationId,
    parentRegionId,
    ordinal,
    kind: 'supplementRoom',
    grammarId: grammar.id,
    grammarRevision: grammar.revision,
    topology: grammar.topology,
    themeBinding: cloneDungeonAugmentationValue(themeBinding),
    placement,
    size: {
      x: Number(grammar.size.width),
      y: Number(grammar.size.height),
      z: Number(grammar.size.depth),
      widthMeters: Number(grammar.size.width),
      heightMeters: Number(grammar.size.height),
      depthMeters: Number(grammar.size.depth),
    },
    structure: cloneDungeonAugmentationValue(grammar.structure),
    sockets,
    anchors,
    occupiedVolumes: grammar.occupiedVolumes.map((volume) => transformDungeonVolume(volume, placement, `${id}:`)),
    clearanceVolumes: grammar.clearanceVolumes.map((volume) => transformDungeonVolume(volume, placement, `${id}:`)),
    requiredThemeCapabilities: cloneDungeonAugmentationValue(grammar.requiredThemeCapabilities),
    progressionOrder,
    socketIdByLocalId,
  };
}

function finalizeNode(node) {
  const { socketIdByLocalId: omitted, ...serializable } = node;
  return serializable;
}

function getNodeSocket(node, localSocketId) {
  return node.sockets.find((socket) => socket.localSocketId === localSocketId) ?? null;
}

function connectNodeSocket(node, localSocketId, segmentId) {
  const socket = getNodeSocket(node, localSocketId);
  if (!socket) return null;
  socket.state = 'connected';
  socket.segmentId = segmentId;
  socket.capRole = null;
  return socket;
}

function nodeEndpoint(node, localSocketId) {
  const socket = getNodeSocket(node, localSocketId);
  return socket ? {
    kind: 'supplementSocket',
    id: socket.id,
    nodeId: node.id,
    socketId: socket.id,
    localSocketId,
    position: cloneDungeonAugmentationValue(socket.position),
    facing: cloneDungeonAugmentationValue(socket.facing),
  } : null;
}

function createSegment({
  id,
  operationId,
  parentRegionId,
  physicalOrdinal,
  logicalEdgeId = null,
  from,
  to,
  connectorFamily,
  themeBinding,
  coordinateSpace,
}) {
  const fromPoint = toDungeonPoint(from.position);
  const toPoint = toDungeonPoint(to.position);
  const deltaX = toPoint.x - fromPoint.x;
  const deltaY = toPoint.y - fromPoint.y;
  const deltaZ = toPoint.z - fromPoint.z;
  const length = Math.hypot(deltaX, deltaZ);
  const widthMeters = 8.4;
  const heightMeters = 5.6;
  const directionX = length > 1e-6 ? deltaX / length : 0;
  const directionZ = length > 1e-6 ? deltaZ / length : 1;
  const volumeSize = {
    x: Math.abs(deltaX) + widthMeters * Math.abs(directionZ),
    y: heightMeters + Math.abs(deltaY),
    z: Math.abs(deltaZ) + widthMeters * Math.abs(directionX),
  };
  const volumeCenter = {
    x: (fromPoint.x + toPoint.x) * 0.5,
    y: Math.min(fromPoint.y, toPoint.y) + volumeSize.y * 0.5,
    z: (fromPoint.z + toPoint.z) * 0.5,
  };
  return {
    id,
    operationId,
    parentRegionId,
    logicalEdgeId,
    physicalOrdinal,
    from: cloneDungeonAugmentationValue(from),
    to: cloneDungeonAugmentationValue(to),
    path: [cloneDungeonAugmentationValue(from.position), cloneDungeonAugmentationValue(to.position)],
    connectorFamily,
    widthMeters,
    heightMeters,
    themeBinding: cloneDungeonAugmentationValue(themeBinding),
    coordinateSpace,
    bidirectional: true,
    traversal: { player: true, groundedEnemy: true, aerialEnemy: true },
    occupiedVolumes: [{
      id: `${id}:occupied`,
      ownerId: id,
      center: volumeCenter,
      size: volumeSize,
      purpose: 'supplement-connector-occupied',
      endpointParentNodeIds: [from.nodeId, to.nodeId].filter(Boolean),
    }],
    clearanceVolumes: [{
      id: `${id}:camera-clearance`,
      ownerId: id,
      center: { ...volumeCenter },
      size: { x: volumeSize.x, y: Math.min(volumeSize.y, 4.2), z: volumeSize.z },
      purpose: 'supplement-connector-camera-clearance',
      endpointParentNodeIds: [from.nodeId, to.nodeId].filter(Boolean),
    }],
    landings: [
      { id: `${id}:from-landing`, position: fromPoint, flat: deltaY === 0 },
      { id: `${id}:to-landing`, position: toPoint, flat: deltaY === 0 },
    ],
    landingVolumes: [
      {
        id: `${id}:from-landing-volume`,
        ownerId: id,
        center: { x: fromPoint.x, y: fromPoint.y + 1.4, z: fromPoint.z },
        size: { x: widthMeters, y: 2.8, z: widthMeters },
        purpose: 'supplement-connector-landing-clearance',
        endpointParentNodeIds: [from.nodeId, to.nodeId].filter(Boolean),
      },
      {
        id: `${id}:to-landing-volume`,
        ownerId: id,
        center: { x: toPoint.x, y: toPoint.y + 1.4, z: toPoint.z },
        size: { x: widthMeters, y: 2.8, z: widthMeters },
        purpose: 'supplement-connector-landing-clearance',
        endpointParentNodeIds: [from.nodeId, to.nodeId].filter(Boolean),
      },
    ],
    requiredThemeCapabilities: {
      materials: ['corridor-floor', 'wall', 'ceiling'],
      assets: [],
      connectors: [connectorFamily],
      transitions: [],
    },
  };
}

function branchRequiredDepth(grammars, connectorGap) {
  return grammars.reduce((sum, grammar) => sum + Number(grammar.size.depth), 0)
    + connectorGap * grammars.length;
}

function planOptionalBranch({
  region,
  socket,
  operationOrdinal,
  roomCount,
  random,
  profile,
  grammars,
  progressionOrderStart,
}) {
  const connectorFamily = chooseConnectorFamily(profile, socket.connectorFamilies);
  if (!connectorFamily || !socket.position) return { error: 'branch-socket-incompatible' };
  const selectedGrammars = [];
  for (let index = 0; index < roomCount; index += 1) {
    const grammar = weightedGrammar(random.fork(`grammar:${index}`), profile, grammars);
    if (!grammar) return { error: 'branch-grammar-unavailable' };
    selectedGrammars.push(grammar);
  }
  const requiredDepth = branchRequiredDepth(selectedGrammars, profile.connectorGapMeters);
  if (Number.isFinite(socket.availableDepthMeters) && requiredDepth > socket.availableDepthMeters) {
    return { error: 'branch-clearance-too-short', context: { requiredDepth, availableDepth: socket.availableDepthMeters } };
  }
  const operationId = createDungeonSupplementId({
    parentRegionId: region.id,
    operationType: 'optionalBranch',
    operationOrdinal,
    kind: 'operation',
    sourceId: socket.id,
  });
  const nodes = [];
  const segments = [];
  let cursor = cloneDungeonAugmentationValue(socket.position);
  let previousDepth = 0;
  for (let index = 0; index < selectedGrammars.length; index += 1) {
    const grammar = selectedGrammars[index];
    const advance = (index === 0 ? 0 : previousDepth * 0.5)
      + profile.connectorGapMeters
      + Number(grammar.size.depth) * 0.5;
    cursor = addDungeonPoints(cursor, scaleDungeonPoint(socket.facing, advance));
    const nodeId = createDungeonSupplementId({
      parentRegionId: region.id,
      operationType: 'optionalBranch',
      operationOrdinal,
      kind: 'node',
      ordinal: index,
      sourceId: socket.id,
    });
    nodes.push(createNode({
      id: nodeId,
      operationId,
      parentRegionId: region.id,
      ordinal: index,
      grammar,
      themeBinding: region.themeBinding,
      center: cursor,
      facing: socket.facing,
      coordinateSpace: socket.coordinateSpace,
      progressionOrder: progressionOrderStart + index,
    }));
    previousDepth = Number(grammar.size.depth);
  }

  const parentEndpoint = {
    kind: 'parentSocket',
    id: socket.id,
    nodeId: socket.nodeId,
    socketId: socket.id,
    position: cloneDungeonAugmentationValue(socket.position),
    facing: cloneDungeonAugmentationValue(socket.facing),
  };
  const endpoints = [parentEndpoint, ...nodes.map((node) => nodeEndpoint(node, 'exit'))];
  const destinations = nodes.map((node) => nodeEndpoint(node, 'entry'));
  for (let index = 0; index < destinations.length; index += 1) {
    const segmentId = createDungeonSupplementId({
      parentRegionId: region.id,
      operationType: 'optionalBranch',
      operationOrdinal,
      kind: 'segment',
      ordinal: index,
      sourceId: socket.id,
    });
    if (index > 0) connectNodeSocket(nodes[index - 1], 'exit', segmentId);
    connectNodeSocket(nodes[index], 'entry', segmentId);
    segments.push(createSegment({
      id: segmentId,
      operationId,
      parentRegionId: region.id,
      physicalOrdinal: index,
      from: endpoints[index],
      to: destinations[index],
      connectorFamily,
      themeBinding: region.themeBinding,
      coordinateSpace: socket.coordinateSpace,
    }));
  }
  return {
    operation: {
      schema: DUNGEON_AUGMENTATION_OPERATION_SCHEMA,
      id: operationId,
      type: 'optionalBranch',
      parentRegionId: region.id,
      themeBinding: cloneDungeonAugmentationValue(region.themeBinding),
      attachmentSocketId: socket.id,
      attachmentNodeId: socket.nodeId,
      topology: profile.branchTopology,
      bidirectional: true,
      returnRouteGuaranteed: true,
      nodeIds: nodes.map(({ id }) => id),
      segmentIds: segments.map(({ id }) => id),
    },
    nodes,
    segments,
  };
}

function themeBindingsDiffer(first, second) {
  return canonicalStringify(first) !== canonicalStringify(second);
}

function edgeRequiredLength(selectedGrammars, profile, crossTheme) {
  const roomLength = selectedGrammars.reduce((sum, grammar) => sum + Number(grammar.size.depth), 0);
  const transitionLength = crossTheme ? 2.8 : 0;
  return roomLength + transitionLength + profile.connectorGapMeters * (selectedGrammars.length + 1);
}

function transitionEndpoint(transition, side) {
  const threshold = transition.flatThresholds[side];
  return {
    kind: 'transitionSocket',
    id: threshold.id,
    nodeId: transition.id,
    socketId: threshold.id,
    position: cloneDungeonAugmentationValue(threshold.position),
    facing: cloneDungeonAugmentationValue(threshold.facing),
  };
}

function planEdgePadding({
  region,
  edge,
  operationOrdinal,
  roomCount,
  random,
  profile,
  grammars,
  progressionOrderStart,
}) {
  const connectorFamily = chooseConnectorFamily(profile, edge.connectorFamilies);
  if (!connectorFamily || edge.path.length < 2 || !edge.source.position || !edge.destination.position) {
    return { error: 'splice-edge-incompatible' };
  }
  const crossTheme = themeBindingsDiffer(edge.sourceThemeBinding, edge.destinationThemeBinding);
  const actualRoomCount = crossTheme ? Math.max(2, roomCount) : roomCount;
  const maximumPaddingRooms = normalizeRange(profile.operationBudget.edgePaddingRooms)[1];
  if (actualRoomCount > maximumPaddingRooms) return { error: 'cross-theme-padding-requires-two-rooms' };
  const selectedGrammars = [];
  for (let index = 0; index < actualRoomCount; index += 1) {
    const grammar = weightedGrammar(random.fork(`grammar:${index}`), profile, grammars, ({ topology }) => topology !== 'four-way-junction');
    if (!grammar) return { error: 'padding-grammar-unavailable' };
    selectedGrammars.push(grammar);
  }
  const requiredLength = edgeRequiredLength(selectedGrammars, profile, crossTheme);
  if (edge.lengthMeters + 1e-6 < requiredLength) {
    return { error: 'splice-edge-too-short', context: { requiredLength, availableLength: edge.lengthMeters } };
  }
  const operationId = createDungeonSupplementId({
    parentRegionId: region.id,
    operationType: 'edgePadding',
    operationOrdinal,
    kind: 'operation',
    sourceId: edge.logicalEdgeId,
  });
  const ratios = crossTheme
    ? [0.25, 0.75]
    : Array.from({ length: actualRoomCount }, (_, index) => (index + 1) / (actualRoomCount + 1));
  const nodes = selectedGrammars.map((grammar, index) => {
    const sample = sampleDungeonPolyline(edge.path, ratios[index]);
    return createNode({
      id: createDungeonSupplementId({
        parentRegionId: region.id,
        operationType: 'edgePadding',
        operationOrdinal,
        kind: 'node',
        ordinal: index,
        sourceId: edge.logicalEdgeId,
      }),
      operationId,
      parentRegionId: region.id,
      ordinal: index,
      grammar,
      themeBinding: crossTheme && index >= actualRoomCount * 0.5
        ? edge.destinationThemeBinding
        : edge.sourceThemeBinding,
      center: sample.point,
      facing: sample.facing,
      coordinateSpace: edge.coordinateSpace,
      progressionOrder: progressionOrderStart + index,
    });
  });
  let transition = null;
  if (crossTheme) {
    const sample = sampleDungeonPolyline(edge.path, 0.5);
    const halfDepth = 1.4;
    const sourcePosition = addDungeonPoints(sample.point, scaleDungeonPoint(sample.facing, -halfDepth));
    const destinationPosition = addDungeonPoints(sample.point, scaleDungeonPoint(sample.facing, halfDepth));
    const transitionId = createDungeonSupplementId({
      parentRegionId: region.id,
      operationType: 'edgePadding',
      operationOrdinal,
      kind: 'transition',
      ordinal: 0,
      sourceId: edge.logicalEdgeId,
    });
    transition = {
      schema: DUNGEON_TRANSITION_BAY_SCHEMA,
      id: transitionId,
      operationId,
      parentRegionId: region.id,
      originalEdgeId: edge.logicalEdgeId,
      sourceThemeBinding: cloneDungeonAugmentationValue(edge.sourceThemeBinding),
      destinationThemeBinding: cloneDungeonAugmentationValue(edge.destinationThemeBinding),
      splitRatio: 0.5,
      placement: {
        center: sample.point,
        facing: sample.facing,
        rotationQuarterTurns: rotationQuarterTurnsForFacing(sample.facing),
        coordinateSpace: edge.coordinateSpace,
      },
      size: { x: 8.4, y: 5.6, z: 2.8, widthMeters: 8.4, heightMeters: 5.6, depthMeters: 2.8 },
      flatThresholds: {
        source: {
          id: `${transitionId}:source-threshold`,
          position: sourcePosition,
          facing: scaleDungeonPoint(sample.facing, -1),
          elevation: sourcePosition.y,
        },
        destination: {
          id: `${transitionId}:destination-threshold`,
          position: destinationPosition,
          facing: sample.facing,
          elevation: destinationPosition.y,
        },
      },
      seam: { role: 'architectural-seam', cooperative: true },
      connectorFamiliesAllowed: ['service-gallery'],
      gatesAllowed: false,
      hazardsAllowed: false,
      encountersAllowed: false,
      elevationTransfersAllowed: false,
    };
  }

  const routeEndpoints = [cloneDungeonAugmentationValue(edge.source)];
  for (const node of nodes) {
    routeEndpoints.push(nodeEndpoint(node, 'entry'));
    routeEndpoints.push(nodeEndpoint(node, 'exit'));
  }
  if (transition) {
    routeEndpoints.length = 0;
    routeEndpoints.push(
      cloneDungeonAugmentationValue(edge.source),
      nodeEndpoint(nodes[0], 'entry'),
      nodeEndpoint(nodes[0], 'exit'),
      transitionEndpoint(transition, 'source'),
      transitionEndpoint(transition, 'destination'),
      nodeEndpoint(nodes[1], 'entry'),
      nodeEndpoint(nodes[1], 'exit'),
      cloneDungeonAugmentationValue(edge.destination),
    );
  } else {
    routeEndpoints.push(cloneDungeonAugmentationValue(edge.destination));
  }
  const destinationThemeStartIndex = transition
    ? routeEndpoints.findIndex((endpoint) => (
      endpoint?.id === transition.flatThresholds.destination.id
    ))
    : -1;
  const segments = [];
  for (let index = 0; index < routeEndpoints.length - 1; index += 1) {
    const from = routeEndpoints[index];
    const to = routeEndpoints[index + 1];
    // A room's own entry-to-exit traversal is represented by the node, not a
    // physical connector segment.
    if (from.nodeId && from.nodeId === to.nodeId && from.kind === 'supplementSocket') continue;
    if (transition && from.nodeId === transition.id && to.nodeId === transition.id) continue;
    const segmentId = createDungeonSupplementId({
      parentRegionId: region.id,
      operationType: 'edgePadding',
      operationOrdinal,
      kind: 'segment',
      ordinal: segments.length,
      sourceId: edge.logicalEdgeId,
    });
    for (const node of nodes) {
      for (const localId of ['entry', 'exit']) {
        const endpoint = nodeEndpoint(node, localId);
        if (endpoint?.id === from.id || endpoint?.id === to.id) connectNodeSocket(node, localId, segmentId);
      }
    }
    // Use the route endpoint index, not the count of emitted segments. Room
    // interiors and the transition interior are deliberately skipped, so an
    // emitted-count midpoint would classify destination-side connectors as
    // source themed.
    const segmentTheme = transition && index >= destinationThemeStartIndex
      ? edge.destinationThemeBinding
      : edge.sourceThemeBinding;
    segments.push(createSegment({
      id: segmentId,
      operationId,
      parentRegionId: region.id,
      physicalOrdinal: segments.length,
      logicalEdgeId: edge.logicalEdgeId,
      from,
      to,
      connectorFamily,
      themeBinding: segmentTheme,
      coordinateSpace: edge.coordinateSpace,
    }));
  }

  return {
    operation: {
      schema: DUNGEON_AUGMENTATION_OPERATION_SCHEMA,
      id: operationId,
      type: 'edgePadding',
      parentRegionId: region.id,
      themeBinding: cloneDungeonAugmentationValue(region.themeBinding),
      originalEdgeId: edge.id,
      originalLogicalEdge: {
        id: edge.logicalEdgeId,
        gateId: edge.sourceContract.gateId ?? edge.sourceContract.doorId ?? null,
        credentialRequirement: cloneDungeonAugmentationValue(edge.sourceContract.credentialRequirement ?? null),
        progressionTier: Number(edge.sourceContract.progressionTier ?? 0),
        dominanceBoundary: cloneDungeonAugmentationValue(
          edge.sourceContract.dominanceBoundary
            ?? edge.sourceContract.dominanceBoundaryId
            ?? null,
        ),
      },
      originalEdgeSnapshot: {
        id: edge.id,
        logicalEdgeId: edge.logicalEdgeId,
        source: cloneDungeonAugmentationValue(edge.source),
        destination: cloneDungeonAugmentationValue(edge.destination),
        path: cloneDungeonAugmentationValue(edge.path),
      },
      originalEdgePreserved: true,
      gateDominancePreserved: true,
      crossTheme,
      transitionBayId: transition?.id ?? null,
      nodeIds: nodes.map(({ id }) => id),
      segmentIds: segments.map(({ id }) => id),
      physicalSegmentIds: segments.map(({ id }) => id),
    },
    nodes,
    segments,
    transition,
  };
}

function normalizeDelegatedBeat(rawBeat, parentRegionId) {
  const beat = typeof rawBeat === 'string' ? { id: rawBeat } : rawBeat;
  const prerequisiteIds = [
    ...(beat?.requiresBeatIds ?? []),
    ...(beat?.requiredBeatIds ?? []),
    ...(beat?.prerequisiteBeatIds ?? []),
    ...(beat?.credentialBeatId ? [beat.credentialBeatId] : []),
    ...(beat?.keyBeatId ? [beat.keyBeatId] : []),
  ];
  return {
    ...cloneDungeonAugmentationValue(beat),
    id: String(beat?.id ?? ''),
    parentRegionId,
    required: beat?.required !== false,
    requiresBeatIds: [...new Set(prerequisiteIds.map(String))],
  };
}

function topologicalBeats(beats) {
  const remaining = new Map(beats.map((beat) => [beat.id, beat]));
  const sorted = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((beat) => beat.requiresBeatIds.every((id) => !remaining.has(id)))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (ready.length === 0) return null;
    for (const beat of ready) {
      sorted.push(beat);
      remaining.delete(beat.id);
    }
  }
  return sorted;
}

function planDelegatedProgression({ regions, nodes, segments, operations, profile }) {
  if (!profile.allowDelegatedProgression) return { operations: [], assignments: [] };
  const beats = regions.flatMap((region) => (region.delegatedProgressionBeats ?? [])
    .map((beat) => normalizeDelegatedBeat(beat, region.id)))
    .filter((beat) => beat.id);
  const beatById = new Map(beats.map((beat) => [beat.id, beat]));
  for (const beat of beats) {
    const unlocked = beatById.get(String(beat.unlocksBeatId ?? ''));
    if (unlocked && !unlocked.requiresBeatIds.includes(beat.id)) {
      unlocked.requiresBeatIds.push(beat.id);
      unlocked.requiresBeatIds.sort();
    }
  }
  const sorted = topologicalBeats(beats);
  if (!sorted) return { error: 'delegated-progression-cycle' };
  const structuralOperationById = new Map(
    operations.map((operation) => [operation.id, operation]),
  );
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const delegatedOperations = [];
  const assignments = [];
  const assignmentByBeatId = new Map();
  const usedAnchors = new Set();
  for (const [index, beat] of sorted.entries()) {
    const gateBeat = /gate|door/i.test(String(beat.kind ?? ''));
    const prerequisiteOrders = beat.requiresBeatIds
      .map((beatId) => assignmentByBeatId.get(beatId)?.nodeProgressionOrder)
      .filter(Number.isFinite);
    const minimumNodeOrder = prerequisiteOrders.length > 0
      ? Math.max(...prerequisiteOrders)
      : -Infinity;
    const candidates = nodes
      .filter((node) => (
        node.parentRegionId === beat.parentRegionId
        // The initial generic authority fixture uses a single-entry branch,
        // where a gate can dominate the only route without relying on opaque
        // parent-graph reachability. Parents may opt into broader placement in
        // a future contract revision with explicit start-side authority.
        && structuralOperationById.get(node.operationId)?.type === 'optionalBranch'
        && Number(node.progressionOrder) > minimumNodeOrder
        && (!gateBeat || Boolean(getNodeSocket(node, 'entry')?.segmentId))
      ))
      .sort((a, b) => a.progressionOrder - b.progressionOrder)
      .flatMap((node) => node.anchors
        .filter((anchor) => anchor.kind === 'progression' && !usedAnchors.has(anchor.id))
        .map((anchor) => ({ node, anchor })));
    const chosen = candidates[0] ?? null;
    if (!chosen) {
      if (beat.required) return { error: 'delegated-progression-anchor-unavailable', context: { beatId: beat.id } };
      continue;
    }
    usedAnchors.add(chosen.anchor.id);
    const operationId = createDungeonSupplementId({
      parentRegionId: beat.parentRegionId,
      operationType: 'delegatedProgression',
      operationOrdinal: index,
      kind: 'operation',
      sourceId: beat.id,
    });
    const assignmentId = createDungeonSupplementId({
      parentRegionId: beat.parentRegionId,
      operationType: 'delegatedProgression',
      operationOrdinal: index,
      kind: 'assignment',
      sourceId: beat.id,
    });
    delegatedOperations.push({
      schema: DUNGEON_AUGMENTATION_OPERATION_SCHEMA,
      id: operationId,
      type: 'delegatedProgression',
      parentRegionId: beat.parentRegionId,
      themeBinding: cloneDungeonAugmentationValue(chosen.node.themeBinding),
      beatId: beat.id,
      nodeIds: [chosen.node.id],
      segmentIds: [],
      parentAuthorityRequired: true,
    });
    const entrySocket = gateBeat ? getNodeSocket(chosen.node, 'entry') : null;
    const gatedSegment = entrySocket?.segmentId
      ? segmentById.get(entrySocket.segmentId)
      : null;
    if (gateBeat && !gatedSegment) {
      return {
        error: 'delegated-progression-gate-segment-unavailable',
        context: { beatId: beat.id, nodeId: chosen.node.id },
      };
    }
    const assignment = {
      id: assignmentId,
      operationId,
      parentRegionId: beat.parentRegionId,
      beatId: beat.id,
      beatKind: String(beat.kind ?? 'objective'),
      nodeId: chosen.node.id,
      anchorId: chosen.anchor.id,
      progressionOrder: index,
      nodeProgressionOrder: chosen.node.progressionOrder,
      requiresBeatIds: cloneDungeonAugmentationValue(beat.requiresBeatIds),
      placementKind: gateBeat ? 'connectorGate' : 'nodeAnchor',
      gatedSegmentId: gatedSegment?.id ?? null,
      gateEndpointSocketId: entrySocket?.id ?? null,
    };
    assignments.push(assignment);
    assignmentByBeatId.set(beat.id, assignment);
  }
  return { operations: delegatedOperations, assignments };
}

function collectThemeBindings(nodes, transitions) {
  const byHash = new Map();
  const add = (binding) => {
    if (!binding) return;
    const bindingHash = hashCanonicalValue(binding, { namespace: 'ruindivex-dungeon-region-theme/v1' });
    byHash.set(bindingHash, { bindingHash, binding: cloneDungeonAugmentationValue(binding) });
  };
  for (const node of nodes) add(node.themeBinding);
  for (const transition of transitions) {
    add(transition.sourceThemeBinding);
    add(transition.destinationThemeBinding);
  }
  return [...byHash.values()].sort((a, b) => a.bindingHash.localeCompare(b.bindingHash));
}

function freezeResult(result) {
  if (result.overlayPlan) deepFreezeDungeonAugmentationValue(result.overlayPlan);
  deepFreezeDungeonAugmentationValue(result.diagnostics);
  if (result.status === 'applied') deepFreezeDungeonAugmentationValue(result.effectiveDraft);
  return Object.freeze(result);
}

function unchangedResult({
  baseDraft,
  reason,
  requested,
  profileId = null,
  basePlanHash = '',
  baseDraftFingerprint = null,
  errors = [],
  warnings = [],
  decisions = [],
}) {
  return freezeResult({
    schema: DUNGEON_AUGMENTATION_RESULT_SCHEMA,
    status: 'unchanged',
    overlayPlan: null,
    effectiveDraft: baseDraft,
    diagnostics: {
      schema: DUNGEON_AUGMENTATION_DIAGNOSTICS_SCHEMA,
      accepted: !requested,
      requested,
      reason,
      profileId,
      basePlanHash,
      baseDraftFingerprint,
      augmentationPlanHash: null,
      effectivePlanHash: basePlanHash,
      errors,
      warnings,
      decisions,
      counts: {
        attempts: decisions.filter(({ code }) => code === 'planning-attempt').length,
        operations: 0,
        rooms: 0,
        segments: 0,
        transitionBays: 0,
        progressionAssignments: 0,
      },
    },
  });
}

function planAttempt({
  basePlanHash,
  baseDraftFingerprint,
  augmentationSeed,
  layoutSeed,
  difficulty,
  profile,
  eligibleRegions,
  grammars,
  attempt,
}) {
  const attemptRandom = new DungeonAugmentationRandom(augmentationSeed).fork(`attempt:${attempt}`);
  const operations = [];
  const nodes = [];
  const segments = [];
  const transitionBays = [];
  const usedSocketIds = new Set();
  const usedEdgeIds = new Set();
  let progressionOrder = 0;

  const branchRange = normalizeRange(profile.operationBudget.optionalBranchRooms, [1, 2]);
  for (let operationOrdinal = 0; operationOrdinal < profile.operationBudget.optionalBranchCount; operationOrdinal += 1) {
    const candidates = attemptRandom.fork(`branch:${operationOrdinal}:regions`).shuffle(
      eligibleRegions.flatMap((region) => (region.attachmentSockets ?? []).map((rawSocket) => ({
        region,
        socket: normalizeAttachmentSocket(rawSocket, region),
      }))),
    ).filter(({ socket }) => socket.id && !usedSocketIds.has(socket.id));
    let planned = null;
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const roomCount = attemptRandom.fork(`branch:${operationOrdinal}:rooms:${candidateIndex}`)
        .int(branchRange[0], branchRange[1]);
      const result = planOptionalBranch({
        ...candidate,
        operationOrdinal,
        roomCount,
        random: attemptRandom.fork(`branch:${operationOrdinal}:candidate:${candidateIndex}`),
        profile,
        grammars,
        progressionOrderStart: progressionOrder,
      });
      if (!result.error) {
        planned = result;
        usedSocketIds.add(candidate.socket.id);
        break;
      }
    }
    if (!planned) {
      if (profile.requiredOperations.optionalBranch) return { error: 'optional-branch-planning-failed' };
      continue;
    }
    operations.push(planned.operation);
    nodes.push(...planned.nodes);
    segments.push(...planned.segments);
    progressionOrder += planned.nodes.length;
  }

  const paddingRange = normalizeRange(profile.operationBudget.edgePaddingRooms, [1, 2]);
  for (let operationOrdinal = 0; operationOrdinal < profile.operationBudget.edgePaddingCount; operationOrdinal += 1) {
    const candidates = attemptRandom.fork(`padding:${operationOrdinal}:regions`).shuffle(
      eligibleRegions.flatMap((region) => (region.spliceEdges ?? []).map((rawEdge) => ({
        region,
        edge: normalizeSpliceEdge(rawEdge, region),
      }))),
    ).filter(({ edge }) => edge.id && !usedEdgeIds.has(edge.id));
    let planned = null;
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const roomCount = attemptRandom.fork(`padding:${operationOrdinal}:rooms:${candidateIndex}`)
        .int(paddingRange[0], paddingRange[1]);
      const result = planEdgePadding({
        ...candidate,
        operationOrdinal,
        roomCount,
        random: attemptRandom.fork(`padding:${operationOrdinal}:candidate:${candidateIndex}`),
        profile,
        grammars,
        progressionOrderStart: progressionOrder,
      });
      if (!result.error) {
        planned = result;
        usedEdgeIds.add(candidate.edge.id);
        break;
      }
    }
    if (!planned) {
      if (profile.requiredOperations.edgePadding) return { error: 'edge-padding-planning-failed' };
      continue;
    }
    operations.push(planned.operation);
    nodes.push(...planned.nodes);
    segments.push(...planned.segments);
    if (planned.transition) transitionBays.push(planned.transition);
    progressionOrder += planned.nodes.length;
  }

  const progression = planDelegatedProgression({
    regions: eligibleRegions,
    nodes,
    segments,
    operations,
    profile,
  });
  if (progression.error) return progression;
  operations.push(...progression.operations);
  const serializableNodes = nodes.map(finalizeNode);
  const plan = {
    schema: DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
    revision: DUNGEON_AUGMENTATION_SCHEMA_REVISION,
    profileId: profile.id,
    profileRevision: profile.revision,
    basePlanHash,
    baseDraftFingerprint,
    augmentationSeed,
    layoutSeed: String(layoutSeed ?? ''),
    difficulty: Number(difficulty ?? 1),
    operations,
    nodes: serializableNodes,
    segments,
    transitionBays,
    progressionAssignments: progression.assignments,
    themeBindings: collectThemeBindings(serializableNodes, transitionBays),
  };
  plan.augmentationPlanHash = computeDungeonAugmentationPlanHash(plan);
  plan.effectivePlanHash = computeEffectiveDungeonPlanHash(basePlanHash, plan.augmentationPlanHash);
  return { plan };
}

/**
 * Pure sidecar entrypoint. It never mutates the parent draft and creates no
 * renderer objects. Disabled and failed augmentation returns the exact parent
 * draft reference so legacy generation remains byte-for-byte authoritative.
 */
export function augmentDungeonDraft({
  baseDraft,
  extensionRegions = [],
  profileId = null,
  layoutSeed = '',
  augmentationSeed: suppliedAugmentationSeed = null,
  difficulty = 1,
  profiles = DUNGEON_AUGMENTATION_PROFILES,
  grammars = GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  themeCapabilitiesByRegionId = {},
} = {}) {
  const safeBaseDraft = baseDraft ?? null;
  const immediateBasePlanHash = String(
    safeBaseDraft?.basePlanHash
      ?? safeBaseDraft?.planHash
      ?? '',
  );
  if (!profileId) {
    return unchangedResult({
      baseDraft: safeBaseDraft,
      reason: 'augmentation-disabled',
      requested: false,
      basePlanHash: immediateBasePlanHash,
    });
  }
  if (!safeBaseDraft || typeof safeBaseDraft !== 'object' || Array.isArray(safeBaseDraft)) {
    return unchangedResult({
      baseDraft: safeBaseDraft,
      reason: 'invalid-input',
      requested: true,
      profileId,
      basePlanHash: immediateBasePlanHash,
      errors: [issue('base-draft-object-required', 'Dungeon augmentation requires a serializable base draft object.')],
    });
  }
  const profile = profiles?.[profileId] ?? null;
  if (!profile || profile.enabled === false) {
    return unchangedResult({
      baseDraft: safeBaseDraft,
      reason: profile ? 'augmentation-disabled' : 'profile-not-found',
      requested: true,
      profileId,
      basePlanHash: immediateBasePlanHash,
      errors: profile ? [] : [issue('profile-not-found', `Unknown augmentation profile ${profileId}.`)],
    });
  }
  let baseSnapshot;
  let baseDraftFingerprint;
  try {
    baseSnapshot = canonicalStringify(safeBaseDraft);
    baseDraftFingerprint = hashCanonicalValue(safeBaseDraft, {
      namespace: 'ruindivex-dungeon-base-draft/v1',
    });
  } catch (error) {
    return unchangedResult({
      baseDraft: safeBaseDraft,
      reason: 'invalid-input',
      requested: true,
      profileId,
      basePlanHash: immediateBasePlanHash,
      errors: [issue('base-draft-not-serializable', error.message, { path: error.path ?? null })],
    });
  }
  const basePlanHash = immediateBasePlanHash || baseDraftFingerprint;
  const regions = Array.isArray(extensionRegions) ? extensionRegions : [];
  const eligibleRegions = regions.filter((region) => (
    Array.isArray(region?.allowedProfileIds)
      && region.allowedProfileIds.includes(profileId)
      && region.themeBinding
  ));
  if (eligibleRegions.length === 0) {
    return unchangedResult({
      baseDraft: safeBaseDraft,
      reason: regions.length > 0 ? 'profile-not-allowed' : 'no-eligible-regions',
      requested: true,
      profileId,
      basePlanHash,
      baseDraftFingerprint,
      errors: [issue('no-eligible-regions', `No extension region permits ${profileId}.`)],
    });
  }
  const augmentationSeed = suppliedAugmentationSeed == null
    ? hashCanonicalValue(
        eligibleRegions.map((region) => deriveDungeonAugmentationSeed({
          layoutSeed,
          baseDraftFingerprint,
          parentRegionId: region.id,
          profileId,
        })),
        { namespace: 'ruindivex-dungeon-augmentation-seed-set/v1' },
      )
    : String(suppliedAugmentationSeed);
  const decisions = [];
  let lastFailure = null;
  for (let attempt = 0; attempt < profile.maximumPlanningAttempts; attempt += 1) {
    const planned = planAttempt({
      basePlanHash,
      baseDraftFingerprint,
      augmentationSeed,
      layoutSeed,
      difficulty,
      profile,
      eligibleRegions,
      grammars,
      attempt,
    });
    decisions.push({
      code: 'planning-attempt',
      attempt,
      accepted: Boolean(planned.plan),
      rejection: planned.error ?? null,
      context: planned.context ?? {},
    });
    if (!planned.plan) {
      lastFailure = planned;
      continue;
    }
    const validation = validateDungeonAugmentationPlan(planned.plan, {
      baseDraft: safeBaseDraft,
      extensionRegions: eligibleRegions,
      profiles,
      grammars,
      themeCapabilitiesByRegionId,
    });
    if (!validation.accepted) {
      lastFailure = { error: 'validation-failed', validation };
      decisions.at(-1).accepted = false;
      decisions.at(-1).rejection = 'validation-failed';
      decisions.at(-1).context = { errorCodes: validation.errors.map(({ code }) => code) };
      continue;
    }
    if (canonicalStringify(safeBaseDraft) !== baseSnapshot) {
      return unchangedResult({
        baseDraft: safeBaseDraft,
        reason: 'base-draft-mutated',
        requested: true,
        profileId,
        basePlanHash,
        baseDraftFingerprint,
        errors: [issue('base-draft-mutated', 'The parent draft changed during augmentation planning.')],
        decisions,
      });
    }
    const overlayPlan = deepFreezeDungeonAugmentationValue(planned.plan);
    const effectiveDraft = cloneDungeonAugmentationValue(safeBaseDraft);
    effectiveDraft.dungeonAugmentation = {
      schema: DUNGEON_AUGMENTATION_EFFECTIVE_DRAFT_SCHEMA,
      basePlanHash,
      augmentationPlanHash: overlayPlan.augmentationPlanHash,
      effectivePlanHash: overlayPlan.effectivePlanHash,
      overlayPlan,
    };
    return freezeResult({
      schema: DUNGEON_AUGMENTATION_RESULT_SCHEMA,
      status: 'applied',
      overlayPlan,
      effectiveDraft,
      diagnostics: {
        schema: DUNGEON_AUGMENTATION_DIAGNOSTICS_SCHEMA,
        accepted: true,
        requested: true,
        reason: 'applied',
        profileId,
        basePlanHash,
        baseDraftFingerprint,
        augmentationPlanHash: overlayPlan.augmentationPlanHash,
        effectivePlanHash: overlayPlan.effectivePlanHash,
        errors: [],
        warnings: validation.warnings,
        decisions,
        counts: {
          attempts: decisions.length,
          operations: overlayPlan.operations.length,
          rooms: overlayPlan.nodes.length,
          segments: overlayPlan.segments.length,
          transitionBays: overlayPlan.transitionBays.length,
          progressionAssignments: overlayPlan.progressionAssignments.length,
        },
      },
    });
  }
  const validationErrors = lastFailure?.validation?.errors ?? [];
  const errorCode = lastFailure?.error ?? 'planning-failed';
  return unchangedResult({
    baseDraft: safeBaseDraft,
    reason: errorCode === 'validation-failed' ? 'validation-failed' : 'planning-failed',
    requested: true,
    profileId,
    basePlanHash,
    baseDraftFingerprint,
    errors: validationErrors.length > 0
      ? validationErrors
      : [issue(errorCode, `Dungeon augmentation failed after ${profile.maximumPlanningAttempts} attempts.`, lastFailure?.context ?? {})],
    decisions,
  });
}
