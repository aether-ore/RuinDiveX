import {
  DUNGEON_AUGMENTATION_DIAGNOSTICS_SCHEMA,
  DUNGEON_AUGMENTATION_EFFECTIVE_DRAFT_SCHEMA,
  DUNGEON_AUGMENTATION_OPERATION_SCHEMA,
  DUNGEON_AUGMENTATION_OVERLAY_SCHEMA,
  DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
  DUNGEON_AUGMENTATION_RESULT_SCHEMA,
  DUNGEON_AUGMENTATION_SCHEMA_REVISION,
  DUNGEON_AUGMENTATION_V2_SCHEMA_REVISION,
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
  dungeonVolumeOverlapWithinGrants,
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
  const measuredPathLengthMeters = measureDungeonPolyline(path);
  const declaredLengthMeters = Number.isFinite(Number(edge?.availableLengthMeters))
    ? Math.max(0, Number(edge.availableLengthMeters))
    : measuredPathLengthMeters;
  const pathMatchesEndpoints = Boolean(
    path.length >= 2
      && source.position
      && destination.position
      && dungeonPointDistance(path[0], source.position) <= 1e-4
      && dungeonPointDistance(path.at(-1), destination.position) <= 1e-4
  );
  const logicalEdgeId = String(edge?.logicalEdgeId ?? edge?.edgeId ?? edge?.id ?? 'edge');
  return {
    sourceContract: edge,
    id: String(edge?.id ?? logicalEdgeId),
    logicalEdgeId,
    source,
    destination,
    path,
    // A host may reserve less than its complete path, but it may never claim
    // more usable padding length than the supplied boundary-to-boundary path.
    lengthMeters: Math.min(declaredLengthMeters, measuredPathLengthMeters),
    declaredLengthMeters,
    measuredPathLengthMeters,
    pathMatchesEndpoints,
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

function normalizeRouteNetworkGrant(grant, region) {
  return {
    source: grant,
    id: String(grant?.id ?? ''),
    required: grant?.required === true,
    kind: String(grant?.kind ?? ''),
    endpointSockets: (grant?.endpointSockets ?? []).map((socket) => ({
      ...normalizeAttachmentSocket(socket, region),
      source: socket,
      roomId: socket?.roomId == null ? null : String(socket.roomId),
      parentRouteId: socket?.parentRouteId == null ? null : String(socket.parentRouteId),
      logicalEdgeId: socket?.logicalEdgeId == null ? null : String(socket.logicalEdgeId),
      wallSide: socket?.wallSide == null ? null : String(socket.wallSide),
      sourceCenterlinePosition: asPosition(socket?.sourceCenterlinePosition),
      planningModuleCenter: asPosition(
        socket?.planningModuleCenter,
        socket?.position?.y ?? region?.elevation ?? 0,
      ),
      planningContinuationCenter: asPosition(
        socket?.planningContinuationCenter,
        socket?.position?.y ?? region?.elevation ?? 0,
      ),
      planningContinuationRoute: (socket?.planningContinuationRoute ?? [])
        .map((point) => asPosition(point, socket?.position?.y ?? region?.elevation ?? 0))
        .filter(Boolean),
      distanceMeters: Number.isFinite(Number(socket?.distanceMeters))
        ? Number(socket.distanceMeters)
        : null,
      progressionBandId: Number(
        socket?.progressionBandId ?? grant?.progressionBandId ?? 0,
      ),
      accessDomainId: String(socket?.accessDomainId ?? grant?.accessDomainId ?? ''),
    })),
    progressionBandId: Number(grant?.progressionBandId ?? 0),
    accessDomainId: String(grant?.accessDomainId ?? ''),
    crossedBoundaryIds: [...new Set((grant?.crossedBoundaryIds ?? []).map(String))],
    requiredCredentialIds: [...new Set((grant?.requiredCredentialIds ?? []).map(String))],
    sourceGate: grant?.sourceGate
      ? cloneDungeonAugmentationValue(grant.sourceGate)
      : null,
    protectedVolumes: cloneDungeonAugmentationValue(grant?.protectedVolumes ?? []),
    socketLandingOverlapGrants: cloneDungeonAugmentationValue(
      grant?.socketLandingOverlapGrants ?? [],
    ),
    socketModuleOverlapGrants: cloneDungeonAugmentationValue(
      grant?.socketModuleOverlapGrants ?? [],
    ),
    mustPreserveBeatIds: [...new Set((grant?.mustPreserveBeatIds ?? []).map(String))],
    minimumModules: clampInteger(grant?.minimumModules ?? 3, 3, 6),
    maximumModules: clampInteger(grant?.maximumModules ?? 6, 3, 6),
    coverage: grant?.coverage ? cloneDungeonAugmentationValue(grant.coverage) : null,
  };
}

function chooseConnectorFamily(profile, offered = []) {
  const offeredSet = new Set(offered);
  return profile.connectorFamilies.find((family) => offeredSet.size === 0 || offeredSet.has(family)) ?? null;
}

function weightedGrammar(
  random,
  profile,
  grammars,
  predicate = () => true,
  grammarPool = profile.grammarPool,
) {
  const choices = grammarPool
    .map((entry) => ({ value: grammars[entry.id], weight: Number(entry.weight ?? 1) }))
    .filter(({ value }) => value && predicate(value));
  return random.weightedPick(choices, null);
}

function blueprintRuntimeStateIds(nodeId, localStateIds = []) {
  return (Array.isArray(localStateIds) ? localStateIds : []).map((localStateId) => {
    const stablePart = String(localStateId)
      .trim()
      .replace(/[^A-Za-z0-9_.-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unnamed';
    return `${nodeId}:blueprint-state:${stablePart}`;
  });
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
  const anchors = grammar.anchors.map((anchor, anchorOrdinal) => {
    const localFacing = anchor.localFacing ?? null;
    return {
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
      ...(localFacing ? { facing: transformDungeonLocalFacing(localFacing, placement) } : {}),
    };
  });
  return {
    id,
    operationId,
    parentRegionId,
    ordinal,
    kind: 'supplementRoom',
    grammarId: grammar.id,
    grammarRevision: grammar.revision,
    blueprintId: grammar.blueprintId ?? null,
    blueprintPersistentStateIds: cloneDungeonAugmentationValue(
      grammar.blueprintPersistentStateIds ?? [],
    ),
    runtimeStateIds: blueprintRuntimeStateIds(
      id,
      grammar.blueprintPersistentStateIds,
    ),
    blueprintCanonicalRotationQuarterTurns:
      grammar.blueprintCanonicalRotationQuarterTurns ?? 0,
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
    socketConnectivityGroups: cloneDungeonAugmentationValue(
      grammar.socketConnectivityGroups ?? [],
    ),
    selectionConstraints: cloneDungeonAugmentationValue(
      grammar.selectionConstraints ?? {},
    ),
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
  path = null,
  heightMeters: requestedHeightMeters = 5.6,
  landingDepthMeters: requestedLandingDepthMeters = null,
}) {
  const fromPoint = toDungeonPoint(from.position);
  const toPoint = toDungeonPoint(to.position);
  const deltaY = toPoint.y - fromPoint.y;
  const widthMeters = 8.4;
  const heightMeters = Number(requestedHeightMeters);
  const segmentPath = createDungeonPolyline(path ?? [], fromPoint, toPoint);
  const spans = [];
  for (let index = 1; index < segmentPath.length; index += 1) {
    const start = segmentPath[index - 1];
    const end = segmentPath[index];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const deltaZ = end.z - start.z;
    const horizontalLength = Math.hypot(deltaX, deltaZ);
    if (horizontalLength <= 1e-6 && Math.abs(deltaY) <= 1e-6) continue;
    const directionX = horizontalLength > 1e-6 ? deltaX / horizontalLength : 0;
    const directionZ = horizontalLength > 1e-6 ? deltaZ / horizontalLength : 0;
    const size = {
      x: horizontalLength > 1e-6
        ? Math.abs(deltaX) + widthMeters * Math.abs(directionZ)
        : widthMeters,
      y: heightMeters + Math.abs(deltaY),
      z: horizontalLength > 1e-6
        ? Math.abs(deltaZ) + widthMeters * Math.abs(directionX)
        : widthMeters,
    };
    spans.push({
      center: {
        x: (start.x + end.x) * 0.5,
        y: Math.min(start.y, end.y) + size.y * 0.5,
        z: (start.z + end.z) * 0.5,
      },
      size,
    });
  }
  // Contract validation rejects an empty volume array. Preserve a concrete
  // landing-sized body for a degenerate same-position connector so malformed
  // host data cannot evade collision checks via a zero-length span.
  if (spans.length === 0) {
    spans.push({
      center: { x: fromPoint.x, y: fromPoint.y + heightMeters * 0.5, z: fromPoint.z },
      size: { x: widthMeters, y: heightMeters, z: widthMeters },
    });
  }
  const createLandingVolume = (endpoint, point, suffix) => {
    const isParentThreshold = endpoint?.kind === 'parentSocket';
    const facing = toDungeonFacing(endpoint?.facing);
    const horizontal = Math.abs(facing.x) > Math.abs(facing.z);
    // A doorway landing is three tiles across and one tile on either side of
    // its wall plane. Route-network rooms provide their own exact interior
    // floor/core, so their external connector landing uses the same bounded
    // 8.4m x 5.6m threshold rather than an overlapping 8.4m square. Legacy
    // callers omit requestedLandingDepthMeters and retain their replay shape.
    const boundedSupplementLanding = Number.isFinite(Number(requestedLandingDepthMeters));
    const boundedLanding = isParentThreshold || boundedSupplementLanding;
    const boundaryDepthMeters = isParentThreshold
      ? 5.6
      : boundedSupplementLanding
        ? Number(requestedLandingDepthMeters)
        : widthMeters;
    return {
      id: `${id}:${suffix}-landing-volume`,
      ownerId: id,
      center: { x: point.x, y: point.y + 1.4, z: point.z },
      size: {
        x: boundedLanding && horizontal ? boundaryDepthMeters : widthMeters,
        y: 2.8,
        z: boundedLanding && !horizontal ? boundaryDepthMeters : widthMeters,
      },
      purpose: 'supplement-connector-landing-clearance',
      endpointParentNodeIds: [from.nodeId, to.nodeId].filter(Boolean),
    };
  };
  return {
    id,
    operationId,
    parentRegionId,
    logicalEdgeId,
    physicalOrdinal,
    from: cloneDungeonAugmentationValue(from),
    to: cloneDungeonAugmentationValue(to),
    path: segmentPath.map((point) => cloneDungeonAugmentationValue(point)),
    connectorFamily,
    widthMeters,
    heightMeters,
    themeBinding: cloneDungeonAugmentationValue(themeBinding),
    coordinateSpace,
    bidirectional: true,
    traversal: { player: true, groundedEnemy: true, aerialEnemy: true },
    occupiedVolumes: spans.map((span, spanIndex) => ({
      id: `${id}:occupied:${spanIndex}`,
      ownerId: id,
      center: span.center,
      size: span.size,
      purpose: 'supplement-connector-occupied',
      endpointParentNodeIds: [from.nodeId, to.nodeId].filter(Boolean),
    })),
    clearanceVolumes: spans.map((span, spanIndex) => ({
      id: `${id}:camera-clearance:${spanIndex}`,
      ownerId: id,
      center: { ...span.center },
      size: { x: span.size.x, y: Math.min(span.size.y, 4.2), z: span.size.z },
      purpose: 'supplement-connector-camera-clearance',
      endpointParentNodeIds: [from.nodeId, to.nodeId].filter(Boolean),
    })),
    landings: [
      { id: `${id}:from-landing`, position: fromPoint, flat: deltaY === 0 },
      { id: `${id}:to-landing`, position: toPoint, flat: deltaY === 0 },
    ],
    landingVolumes: [
      createLandingVolume(from, fromPoint, 'from'),
      createLandingVolume(to, toPoint, 'to'),
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

function hallwayClusterGrammar(random, profile, grammars, role) {
  return weightedGrammar(
    random.fork(`role:${role}`),
    profile,
    grammars,
    (candidate) => candidate.selectionConstraints?.hallwayClusterRole === role,
  );
}

function hallwayGuaranteeFailure(profile, grammar) {
  const guarantee = profile.hallwayGuarantee;
  if (!guarantee) return null;
  const socketById = new Map((grammar.sockets ?? []).map((candidate) => [candidate.id, candidate]));
  const doorwaySocketIds = ['entry', 'left', 'right', 'exit']
    .filter((socketId) => socketById.has(socketId));
  const doorwayFrameCount = (grammar.anchors ?? [])
    .filter(({ kind, assetRole }) => kind === 'doorway-frame' && assetRole === 'frame')
    .length;
  const lengthMeters = Number(grammar.size?.depth ?? 0);
  const widthMeters = Number(grammar.size?.width ?? 0);
  const sideDoorSeparationMeters = Math.abs(
    Number(socketById.get('left')?.localPosition?.z ?? 0)
      - Number(socketById.get('right')?.localPosition?.z ?? 0),
  );
  if (guarantee.corridorOriented === true && lengthMeters <= widthMeters) {
    return { reason: 'hallway-not-corridor-oriented', lengthMeters, widthMeters };
  }
  if (lengthMeters < Number(guarantee.minimumLengthMeters ?? 0)) {
    return {
      reason: 'hallway-too-short',
      lengthMeters,
      minimumLengthMeters: Number(guarantee.minimumLengthMeters),
    };
  }
  const minimumDoorwayCount = Number(guarantee.minimumDoorwayCount ?? 0);
  if (doorwaySocketIds.length < minimumDoorwayCount || doorwayFrameCount < minimumDoorwayCount) {
    return {
      reason: 'hallway-doorways-missing',
      doorwaySocketCount: doorwaySocketIds.length,
      doorwayFrameCount,
      minimumDoorwayCount,
    };
  }
  if (sideDoorSeparationMeters < Number(guarantee.minimumSideDoorSeparationMeters ?? 0)) {
    return {
      reason: 'hallway-side-doors-not-staggered',
      sideDoorSeparationMeters,
      minimumSideDoorSeparationMeters: Number(guarantee.minimumSideDoorSeparationMeters),
    };
  }
  return null;
}

function planHallwayCluster({
  region,
  socket,
  operationOrdinal,
  roomCount,
  random,
  profile,
  grammars,
  progressionOrderStart,
}) {
  if (roomCount !== 4) {
    return { error: 'hallway-cluster-requires-four-rooms', context: { roomCount } };
  }
  const attachmentConnectorFamily = chooseConnectorFamily(profile, socket.connectorFamilies);
  if (!attachmentConnectorFamily || !socket.position) {
    return { error: 'branch-socket-incompatible' };
  }
  const grammarByRole = Object.fromEntries([
    'junction',
    'encounter',
    'reward',
    'terminal',
  ].map((role) => [
    role,
    hallwayClusterGrammar(random.fork('grammar'), profile, grammars, role),
  ]));
  const missingGrammarRole = Object.entries(grammarByRole)
    .find(([, candidate]) => !candidate)?.[0];
  if (missingGrammarRole) {
    return {
      error: 'hallway-cluster-grammar-unavailable',
      context: { role: missingGrammarRole },
    };
  }

  const [junctionGrammar, encounterGrammar, rewardGrammar, terminalGrammar] = [
    grammarByRole.junction,
    grammarByRole.encounter,
    grammarByRole.reward,
    grammarByRole.terminal,
  ];
  const guaranteeFailure = hallwayGuaranteeFailure(profile, junctionGrammar);
  if (guaranteeFailure) {
    return {
      error: 'hallway-cluster-guarantee-unsatisfied',
      context: guaranteeFailure,
    };
  }
  if (!encounterGrammar.anchors.some(({ kind }) => kind === 'encounter')
    || !rewardGrammar.anchors.some(({ kind }) => kind === 'reward')) {
    return { error: 'hallway-cluster-side-room-content-missing' };
  }
  const operationId = createDungeonSupplementId({
    parentRegionId: region.id,
    operationType: 'optionalBranch',
    operationOrdinal,
    kind: 'operation',
    sourceId: socket.id,
  });
  const nodeId = (ordinal) => createDungeonSupplementId({
    parentRegionId: region.id,
    operationType: 'optionalBranch',
    operationOrdinal,
    kind: 'node',
    ordinal,
    sourceId: socket.id,
  });
  const junctionCenter = addDungeonPoints(
    socket.position,
    scaleDungeonPoint(
      socket.facing,
      Number(profile.connectorGapMeters) + Number(junctionGrammar.size.depth) * 0.5,
    ),
  );
  const junction = createNode({
    id: nodeId(0),
    operationId,
    parentRegionId: region.id,
    ordinal: 0,
    grammar: junctionGrammar,
    themeBinding: region.themeBinding,
    center: junctionCenter,
    facing: socket.facing,
    coordinateSpace: socket.coordinateSpace,
    progressionOrder: progressionOrderStart,
  });
  junction.nodeRole = 'hallway-junction';
  junction.layoutRole = 'corridor-hallway-spine';
  junction.corridorOriented = true;
  junction.hallwayLengthMeters = Number(junctionGrammar.size.depth);
  const entrySocket = getNodeSocket(junction, 'entry');
  const leftSocket = getNodeSocket(junction, 'left');
  const rightSocket = getNodeSocket(junction, 'right');
  const exitSocket = getNodeSocket(junction, 'exit');
  if (!entrySocket || !leftSocket || !rightSocket || !exitSocket) {
    return { error: 'hallway-cluster-junction-sockets-missing' };
  }
  const hallwayDoorSockets = [entrySocket, leftSocket, rightSocket, exitSocket];
  junction.hallwayDoorwaySocketIds = hallwayDoorSockets.map(({ id }) => id);
  junction.sideRoomDoorwaySocketIds = [leftSocket.id, rightSocket.id];
  const sideRoomCenter = (junctionSocket, sideGrammar) => addDungeonPoints(
    junctionSocket.position,
    scaleDungeonPoint(
      junctionSocket.facing,
      Number(profile.connectorGapMeters) + Number(sideGrammar.size.depth) * 0.5,
    ),
  );
  const encounter = createNode({
    id: nodeId(1),
    operationId,
    parentRegionId: region.id,
    ordinal: 1,
    grammar: encounterGrammar,
    themeBinding: region.themeBinding,
    center: sideRoomCenter(leftSocket, encounterGrammar),
    facing: leftSocket.facing,
    coordinateSpace: socket.coordinateSpace,
    progressionOrder: progressionOrderStart + 1,
  });
  encounter.nodeRole = 'hallway-side-room';
  encounter.contentRole = 'encounter';
  const reward = createNode({
    id: nodeId(2),
    operationId,
    parentRegionId: region.id,
    ordinal: 2,
    grammar: rewardGrammar,
    themeBinding: region.themeBinding,
    center: sideRoomCenter(rightSocket, rewardGrammar),
    facing: rightSocket.facing,
    coordinateSpace: socket.coordinateSpace,
    progressionOrder: progressionOrderStart + 2,
  });
  reward.nodeRole = 'hallway-side-room';
  reward.contentRole = 'reward';
  const offeredVerticalFamilies = new Set([
    ...(exitSocket.connectorFamilies ?? []),
    ...(terminalGrammar.sockets.find(({ id }) => id === 'entry')?.connectorFamilies ?? []),
  ]);
  const verticalConnectorFamilies = (profile.verticalConnectorFamilies ?? [])
    .filter((family) => offeredVerticalFamilies.has(family));
  const verticalConnectorFamily = random.fork('vertical-connector-family')
    .pick(verticalConnectorFamilies);
  if (!verticalConnectorFamily) {
    return { error: 'hallway-cluster-vertical-connector-unavailable' };
  }
  const verticalConnectorGap = Math.max(
    Number(
      profile.verticalConnectorGapMetersByFamily?.[verticalConnectorFamily]
        ?? profile.verticalConnectorGapMeters
        ?? 44.8,
    ),
    Number(profile.connectorGapMeters ?? 2.8),
  );
  const requiredDepth = Number(profile.connectorGapMeters)
    + Number(junctionGrammar.size.depth)
    + verticalConnectorGap
    + Number(terminalGrammar.size.depth);
  if (Number.isFinite(socket.availableDepthMeters) && requiredDepth > socket.availableDepthMeters) {
    return {
      error: 'branch-clearance-too-short',
      context: {
        requiredDepth,
        availableDepth: socket.availableDepthMeters,
        verticalConnectorFamily,
      },
    };
  }
  const verticalDirection = random.fork('vertical-direction').chance(0.5)
    ? 'ascending'
    : 'descending';
  const terminalElevationDelta = verticalDirection === 'ascending' ? 14 : -14;
  const terminalCenter = addDungeonPoints(
    {
      ...exitSocket.position,
      y: Number(exitSocket.position.y) + terminalElevationDelta,
    },
    scaleDungeonPoint(
      exitSocket.facing,
      verticalConnectorGap + Number(terminalGrammar.size.depth) * 0.5,
    ),
  );
  const terminal = createNode({
    id: nodeId(3),
    operationId,
    parentRegionId: region.id,
    ordinal: 3,
    grammar: terminalGrammar,
    themeBinding: region.themeBinding,
    center: terminalCenter,
    facing: exitSocket.facing,
    coordinateSpace: socket.coordinateSpace,
    progressionOrder: progressionOrderStart + 3,
  });
  terminal.nodeRole = 'vertical-terminal-room';
  terminal.contentRole = 'trap';
  const nodes = [junction, encounter, reward, terminal];

  const parentEndpoint = {
    kind: 'parentSocket',
    id: socket.id,
    nodeId: socket.nodeId,
    socketId: socket.id,
    position: cloneDungeonAugmentationValue(socket.position),
    facing: cloneDungeonAugmentationValue(socket.facing),
  };
  const segmentSpecifications = [
    {
      from: parentEndpoint,
      to: nodeEndpoint(junction, 'entry'),
      family: attachmentConnectorFamily,
      routeRole: 'hallway-entry',
      sockets: [[junction, 'entry']],
    },
    {
      from: nodeEndpoint(junction, 'left'),
      to: nodeEndpoint(encounter, 'entry'),
      family: 'service-gallery',
      routeRole: 'lateral-encounter',
      sockets: [[junction, 'left'], [encounter, 'entry']],
    },
    {
      from: nodeEndpoint(junction, 'right'),
      to: nodeEndpoint(reward, 'entry'),
      family: 'service-gallery',
      routeRole: 'lateral-reward',
      sockets: [[junction, 'right'], [reward, 'entry']],
    },
    {
      from: nodeEndpoint(junction, 'exit'),
      to: nodeEndpoint(terminal, 'entry'),
      family: verticalConnectorFamily,
      routeRole: 'vertical-terminal',
      sockets: [[junction, 'exit'], [terminal, 'entry']],
      vertical: true,
    },
  ];
  const segments = segmentSpecifications.map((specification, index) => {
    const segmentId = createDungeonSupplementId({
      parentRegionId: region.id,
      operationType: 'optionalBranch',
      operationOrdinal,
      kind: 'segment',
      ordinal: index,
      sourceId: socket.id,
    });
    for (const [node, localSocketId] of specification.sockets) {
      connectNodeSocket(node, localSocketId, segmentId);
    }
    const segment = createSegment({
      id: segmentId,
      operationId,
      parentRegionId: region.id,
      physicalOrdinal: index,
      from: specification.from,
      to: specification.to,
      connectorFamily: specification.family,
      themeBinding: region.themeBinding,
      coordinateSpace: socket.coordinateSpace,
    });
    segment.routeRole = specification.routeRole;
    if (specification.vertical) {
      segment.verticalTransfer = true;
      segment.traversalKind = specification.family;
      segment.direction = verticalDirection;
      segment.sourceElevation = Number(specification.from.position.y);
      segment.destinationElevation = Number(specification.to.position.y);
      segment.elevationDelta = terminalElevationDelta;
      segment.traversal = {
        ...segment.traversal,
        kind: specification.family,
        direction: verticalDirection,
        elevationDelta: terminalElevationDelta,
      };
      if (specification.family === 'slope') {
        segment.requiredThemeCapabilities.materials = [
          ...segment.requiredThemeCapabilities.materials,
          'ramp',
        ];
      }
    }
    return segment;
  });
  const verticalSegment = segments.find(({ routeRole }) => routeRole === 'vertical-terminal');
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
      hallwayNodeId: junction.id,
      corridorOriented: true,
      hallwayLengthMeters: Number(junctionGrammar.size.depth),
      hallwayDoorwayCount: hallwayDoorSockets.length,
      hallwayDoorwaySocketIds: hallwayDoorSockets.map(({ id }) => id),
      sideRoomDoorwayCount: 2,
      sideRoomDoorwaySocketIds: [leftSocket.id, rightSocket.id],
      sideRoomNodeIds: [encounter.id, reward.id],
      terminalNodeId: terminal.id,
      verticalConnectorSegmentId: verticalSegment.id,
      verticalConnectorFamily,
      terminalElevationDelta,
      featureSummary: {
        sideRoomCount: 2,
        elevationTransferCount: 1,
        encounterCount: 1,
        rewardCount: 1,
        trapCount: 1,
        platformRoomCount: 2,
        doorwayCount: hallwayDoorSockets.length,
        hallwaySpineCount: 1,
      },
    },
    nodes,
    segments,
  };
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
  if (profile.branchTopology === 'hallway-cluster-v1') {
    return planHallwayCluster({
      region,
      socket,
      operationOrdinal,
      roomCount,
      random,
      profile,
      grammars,
      progressionOrderStart,
    });
  }
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

function sampleDungeonPolylineAtDistance(points, distance) {
  const totalLength = measureDungeonPolyline(points);
  if (totalLength <= 1e-6) return sampleDungeonPolyline(points, 0);
  return sampleDungeonPolyline(points, Math.max(0, Math.min(totalLength, distance)) / totalLength);
}

function sliceDungeonPolylineByDistance(points, startDistance, endDistance) {
  const totalLength = measureDungeonPolyline(points);
  const start = Math.max(0, Math.min(totalLength, Number(startDistance) || 0));
  const end = Math.max(start, Math.min(totalLength, Number(endDistance) || 0));
  const result = [sampleDungeonPolylineAtDistance(points, start).point];
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const spanLength = dungeonPointDistance(points[index - 1], points[index]);
    traversed += spanLength;
    if (traversed > start + 1e-6 && traversed < end - 1e-6) {
      result.push(cloneDungeonAugmentationValue(points[index]));
    }
  }
  const finalPoint = sampleDungeonPolylineAtDistance(points, end).point;
  if (dungeonPointDistance(result.at(-1), finalPoint) > 1e-6) result.push(finalPoint);
  if (result.length === 1) result.push(cloneDungeonAugmentationValue(finalPoint));
  return result;
}

function endpointMatchesSpliceDistance(endpoint, edgePath, distance) {
  return Boolean(endpoint?.position)
    && dungeonPointDistance(
      endpoint.position,
      sampleDungeonPolylineAtDistance(edgePath, distance).point,
    ) <= 1e-4;
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
  if (!edge.pathMatchesEndpoints) {
    return {
      error: 'splice-edge-path-endpoint-mismatch',
      context: { edgeId: edge.id },
    };
  }
  const crossTheme = themeBindingsDiffer(edge.sourceThemeBinding, edge.destinationThemeBinding);
  const actualRoomCount = crossTheme ? Math.max(2, roomCount) : roomCount;
  const maximumPaddingRooms = normalizeRange(profile.operationBudget.edgePaddingRooms)[1];
  if (actualRoomCount > maximumPaddingRooms) return { error: 'cross-theme-padding-requires-two-rooms' };
  const selectedGrammars = [];
  for (let index = 0; index < actualRoomCount; index += 1) {
    const grammar = weightedGrammar(
      random.fork(`grammar:${index}`),
      profile,
      grammars,
      ({ topology }) => topology !== 'four-way-junction',
      profile.paddingGrammarPool ?? profile.grammarPool,
    );
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
  const routeLengthMeters = measureDungeonPolyline(edge.path);
  const nodeSamples = ratios.map((ratio) => sampleDungeonPolyline(edge.path, ratio));
  const nodes = selectedGrammars.map((grammar, index) => {
    const sample = nodeSamples[index];
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
  const nodeRouteWindows = nodes.map((node, index) => {
    const halfDepth = Number(selectedGrammars[index].size.depth) * 0.5;
    const entryDistance = nodeSamples[index].distance - halfDepth;
    const exitDistance = nodeSamples[index].distance + halfDepth;
    const entry = nodeEndpoint(node, 'entry');
    const exit = nodeEndpoint(node, 'exit');
    return { entry, exit, entryDistance, exitDistance };
  });
  const invalidNodeWindow = nodeRouteWindows.find((window) => (
    window.entryDistance < -1e-6
      || window.exitDistance > routeLengthMeters + 1e-6
      || !endpointMatchesSpliceDistance(window.entry, edge.path, window.entryDistance)
      || !endpointMatchesSpliceDistance(window.exit, edge.path, window.exitDistance)
  ));
  if (invalidNodeWindow) {
    return {
      error: 'padding-room-does-not-follow-splice-path',
      context: { edgeId: edge.id },
    };
  }
  let transition = null;
  let transitionRouteWindow = null;
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
    transitionRouteWindow = {
      source: transitionEndpoint(transition, 'source'),
      destination: transitionEndpoint(transition, 'destination'),
      sourceDistance: sample.distance - halfDepth,
      destinationDistance: sample.distance + halfDepth,
    };
    if (!endpointMatchesSpliceDistance(
      transitionRouteWindow.source,
      edge.path,
      transitionRouteWindow.sourceDistance,
    ) || !endpointMatchesSpliceDistance(
      transitionRouteWindow.destination,
      edge.path,
      transitionRouteWindow.destinationDistance,
    )) {
      return {
        error: 'padding-transition-does-not-follow-splice-path',
        context: { edgeId: edge.id },
      };
    }
  }

  const routeEndpoints = [{
    endpoint: cloneDungeonAugmentationValue(edge.source),
    distance: 0,
  }];
  for (const window of nodeRouteWindows) {
    routeEndpoints.push(
      { endpoint: window.entry, distance: window.entryDistance },
      { endpoint: window.exit, distance: window.exitDistance },
    );
  }
  if (transition) {
    routeEndpoints.length = 0;
    routeEndpoints.push(
      { endpoint: cloneDungeonAugmentationValue(edge.source), distance: 0 },
      { endpoint: nodeRouteWindows[0].entry, distance: nodeRouteWindows[0].entryDistance },
      { endpoint: nodeRouteWindows[0].exit, distance: nodeRouteWindows[0].exitDistance },
      {
        endpoint: transitionRouteWindow.source,
        distance: transitionRouteWindow.sourceDistance,
      },
      {
        endpoint: transitionRouteWindow.destination,
        distance: transitionRouteWindow.destinationDistance,
      },
      { endpoint: nodeRouteWindows[1].entry, distance: nodeRouteWindows[1].entryDistance },
      { endpoint: nodeRouteWindows[1].exit, distance: nodeRouteWindows[1].exitDistance },
      {
        endpoint: cloneDungeonAugmentationValue(edge.destination),
        distance: routeLengthMeters,
      },
    );
  } else {
    routeEndpoints.push({
      endpoint: cloneDungeonAugmentationValue(edge.destination),
      distance: routeLengthMeters,
    });
  }
  if (routeEndpoints.some((record, index) => (
    index > 0 && record.distance < routeEndpoints[index - 1].distance - 1e-6
  ))) {
    return {
      error: 'padding-route-windows-overlap',
      context: { edgeId: edge.id },
    };
  }
  const destinationThemeStartIndex = transition
    ? routeEndpoints.findIndex(({ endpoint }) => (
      endpoint?.id === transition.flatThresholds.destination.id
    ))
    : -1;
  const segments = [];
  for (let index = 0; index < routeEndpoints.length - 1; index += 1) {
    const fromRecord = routeEndpoints[index];
    const toRecord = routeEndpoints[index + 1];
    const from = fromRecord.endpoint;
    const to = toRecord.endpoint;
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
      path: sliceDungeonPolylineByDistance(
        edge.path,
        fromRecord.distance,
        toRecord.distance,
      ),
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
        gatePlacementSide: (edge.sourceContract.gateId ?? edge.sourceContract.doorId)
          ? 'source'
          : null,
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
        availableLengthMeters: edge.lengthMeters,
        measuredPathLengthMeters: edge.measuredPathLengthMeters,
      },
      requiredLengthMeters: requiredLength,
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

function omitOptionalEdgePadding(plan, profile) {
  if (profile?.allowEdgePaddingFallback !== true
    || profile?.requiredOperations?.edgePadding === true) {
    return null;
  }
  const removedOperationIds = new Set((plan?.operations ?? [])
    .filter((operation) => operation?.type === 'edgePadding')
    .map((operation) => operation.id));
  if (removedOperationIds.size === 0) return null;
  const removedNodeIds = new Set((plan?.nodes ?? [])
    .filter((node) => removedOperationIds.has(node?.operationId))
    .map((node) => node.id));
  const removedSegmentIds = new Set((plan?.segments ?? [])
    .filter((segment) => removedOperationIds.has(segment?.operationId))
    .map((segment) => segment.id));
  const operations = plan.operations.filter((operation) => (
    !removedOperationIds.has(operation.id)
  ));
  const nodes = plan.nodes.filter((node) => !removedNodeIds.has(node.id));
  const segments = plan.segments.filter((segment) => !removedSegmentIds.has(segment.id));
  const transitionBays = (plan.transitionBays ?? []).filter((transition) => (
    !removedOperationIds.has(transition.operationId)
  ));
  const progressionAssignments = (plan.progressionAssignments ?? []).filter((assignment) => (
    !removedOperationIds.has(assignment.operationId)
      && !removedNodeIds.has(assignment.nodeId)
      && !removedSegmentIds.has(assignment.gatedSegmentId)
  ));
  const fallbackPlan = {
    ...plan,
    operations,
    nodes,
    segments,
    transitionBays,
    progressionAssignments,
    themeBindings: collectThemeBindings(nodes, transitionBays),
  };
  fallbackPlan.augmentationPlanHash = computeDungeonAugmentationPlanHash(fallbackPlan);
  fallbackPlan.effectivePlanHash = computeEffectiveDungeonPlanHash(
    fallbackPlan.basePlanHash,
    fallbackPlan.augmentationPlanHash,
  );
  return fallbackPlan;
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

function routeNetworkGrammarForKind(
  profile,
  grammars,
  junctionKind,
  moduleKind = 'room',
) {
  const candidates = profile.grammarPool
    .map(({ id }) => grammars[id])
    .filter((candidate) => (
      candidate?.selectionConstraints?.routeNetworkJunctionKind === junctionKind
    ));
  return candidates.find((candidate) => (
    String(candidate?.selectionConstraints?.routeNetworkModuleKind ?? 'room') === moduleKind
  )) ?? null;
}

function routeNetworkContentGrammarForRole(
  profile,
  grammars,
  contentRole,
  { selectionOrdinal = 0, elevationMode = 'level' } = {},
) {
  const requestedRole = String(contentRole ?? 'challenge');
  const pool = profile.grammarPool
    .map(({ id }) => grammars[id])
    .filter(Boolean);
  const authoredCandidates = pool
    .filter((candidate) => (
      Array.isArray(candidate?.selectionConstraints?.routeNetworkContentRoles)
        && candidate.selectionConstraints.routeNetworkContentRoles.includes(requestedRole)
        && String(candidate.selectionConstraints.routeNetworkModuleKind ?? 'room') === 'room'
        // Paired-T/H is a complete branch-and-rejoin topology kit.  Although
        // it carries challenge and reward zones, it must be selected by a
        // loop topology decision, not substituted for an ordinary serial
        // challenge room.  Doing so consumes 42 m of the station-to-station
        // run before either exterior socket is reached and makes otherwise
        // valid coverage grants impossible.
        && candidate.selectionConstraints?.routeNetworkJunctionKind == null
    ))
    .sort((first, second) => String(first.id).localeCompare(String(second.id)));
  if (authoredCandidates.length > 0) {
    const wantsElevation = requestedRole === 'elevation';
    const elevationCandidates = authoredCandidates.filter((candidate) => (
      Math.abs(Number(
        candidate.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
      )) > 0.000001
    ));
    const levelCandidates = authoredCandidates.filter((candidate) => (
      Math.abs(Number(
        candidate.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
      )) <= 0.000001
    ));
    const requestedTransferKinds = elevationMode === 'lift'
      ? new Set(['lift'])
      : elevationMode === 'ladder'
        ? new Set(['ladder'])
        : new Set(['ramp', 'stairs', 'step', 'landing']);
    // Same-band V4 networks realize their elevation change inside authored
    // modules. Prefer one 2.8 m rise in the requested family so a later
    // authored descent can return to the exact parent tier without synthesizing
    // a legacy 14 m connector prefab between room sockets.
    const balancedRiseCandidates = elevationCandidates.filter((candidate) => {
      const delta = Number(
        candidate.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
      );
      const transferKinds = candidate.selectionConstraints?.authoredTransferKinds ?? [];
      return Math.abs(delta - 2.8) <= 0.000001
        && transferKinds.some((kind) => requestedTransferKinds.has(String(kind)));
    });
    const choices = wantsElevation && balancedRiseCandidates.length > 0
      ? balancedRiseCandidates
      : wantsElevation && elevationCandidates.length > 0
        ? elevationCandidates
      : !wantsElevation && levelCandidates.length > 0
        ? levelCandidates
        : authoredCandidates;
    const index = ((Math.trunc(Number(selectionOrdinal)) % choices.length) + choices.length)
      % choices.length;
    return choices[index];
  }
  const hallwayRole = ['reward', 'treasure', 'calm', 'discovery'].includes(requestedRole)
    ? 'reward'
    : requestedRole === 'challenge'
      ? 'encounter'
      : 'terminal';
  const candidates = pool
    .filter((candidate) => candidate?.selectionConstraints?.hallwayClusterRole === hallwayRole)
    .sort((first, second) => String(first.id).localeCompare(String(second.id)));
  return candidates[0] ?? null;
}

function routeNetworkTopologyKitGrammarForTemplate(
  profile,
  grammars,
  topologyTemplateId,
) {
  return profile.grammarPool
    .map(({ id }) => grammars[id])
    .filter(Boolean)
    .find((candidate) => (
      candidate.selectionConstraints?.routeNetworkTopologyTemplateId === topologyTemplateId
    )) ?? null;
}

function balanceObjectiveRouteGrammarAssignments({
  profile,
  grammars,
  selectedGrammars,
  contentRoles,
  moduleKinds,
  topologyKitModuleIndex = null,
  operationOrdinal = 0,
  searchVariant = 0,
  elevationMode = 'level',
}) {
  const grammarDelta = (candidate) => Number(
    candidate?.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
  );
  const currentDelta = () => selectedGrammars.reduce((sum, candidate) => (
    sum + grammarDelta(candidate)
  ), 0);
  if (!selectedGrammars.some((candidate) => Math.abs(grammarDelta(candidate)) > 0.000001)) {
    const requestedTransferKinds = elevationMode === 'lift'
      ? new Set(['lift'])
      : elevationMode === 'ladder'
        ? new Set(['ladder'])
        : new Set(['ramp', 'stairs', 'step', 'landing']);
    const challengeIndices = moduleKinds
      .map((moduleKind, index) => ({ moduleKind, index }))
      .filter(({ moduleKind, index }) => (
        moduleKind === 'room'
          && index !== topologyKitModuleIndex
          && contentRoles[index] === 'challenge'
      ));
    for (const { index } of challengeIndices) {
      const candidates = profile.grammarPool
        .map(({ id }) => grammars[id])
        .filter((candidate) => {
          const transferKinds = candidate?.selectionConstraints?.authoredTransferKinds ?? [];
          return candidate
            && String(candidate.selectionConstraints?.routeNetworkModuleKind ?? 'room') === 'room'
            && candidate.selectionConstraints?.routeNetworkJunctionKind == null
            && candidate.selectionConstraints?.routeNetworkContentRoles?.includes('challenge')
            && Math.abs(grammarDelta(candidate) - 2.8) <= 0.000001
            && transferKinds.some((kind) => requestedTransferKinds.has(String(kind)));
        })
        .sort((first, second) => String(first.id).localeCompare(String(second.id)));
      if (candidates.length === 0) continue;
      const selectionIndex = ((operationOrdinal + searchVariant + index) % candidates.length
        + candidates.length) % candidates.length;
      selectedGrammars[index] = candidates[selectionIndex];
      break;
    }
  }
  const balanceIndices = moduleKinds
    .map((moduleKind, index) => ({ moduleKind, index }))
    .filter(({ moduleKind, index }) => (
      moduleKind === 'room'
        && index !== topologyKitModuleIndex
        && ['reward', 'treasure', 'mechanism', 'trap'].includes(contentRoles[index])
    ))
    .sort((first, second) => (
      Number(!['reward', 'treasure'].includes(contentRoles[first.index]))
        - Number(!['reward', 'treasure'].includes(contentRoles[second.index]))
        || second.index - first.index
    ));
  for (const { index } of balanceIndices) {
    const deltaWithoutCurrent = currentDelta() - grammarDelta(selectedGrammars[index]);
    if (Math.abs(deltaWithoutCurrent) <= 0.000001) continue;
    const requestedRole = String(contentRoles[index] ?? 'reward');
    const candidates = profile.grammarPool
      .map(({ id }) => grammars[id])
      .filter((candidate) => (
        candidate
          && String(candidate.selectionConstraints?.routeNetworkModuleKind ?? 'room') === 'room'
          && candidate.selectionConstraints?.routeNetworkJunctionKind == null
          && candidate.selectionConstraints?.routeNetworkContentRoles?.includes(requestedRole)
          && Math.abs(grammarDelta(candidate) + deltaWithoutCurrent) <= 0.000001
      ))
      .sort((first, second) => String(first.id).localeCompare(String(second.id)));
    if (candidates.length === 0) continue;
    const selectionIndex = ((operationOrdinal + searchVariant + index) % candidates.length
      + candidates.length) % candidates.length;
    selectedGrammars[index] = candidates[selectionIndex];
    if (Math.abs(currentDelta()) <= 0.000001) break;
  }
}

/**
 * Exact coverage stations are fixed to the authored connector tier. A rise in
 * one station interval therefore cannot be balanced by a descent in a later
 * interval: the intervening exact station would otherwise need an ungranted
 * vertical connector. Recompose the final semantic rooms so one interval owns
 * a complete authored rise-and-return pair and every other interval stays
 * level.
 */
function balanceObjectiveRouteGrammarIntervals({
  profile,
  grammars,
  selectedGrammars,
  contentRoles,
  moduleKinds,
  endpointNodeIndices,
  topologyKitModuleIndex = null,
  operationOrdinal = 0,
  searchVariant = 0,
  elevationMode = 'level',
  preferCompactRise = false,
}) {
  const epsilon = 0.000001;
  const grammarDelta = (candidate) => Number(
    candidate?.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
  );
  const requestedTransferKinds = ['lift', 'shortcut-lift'].includes(elevationMode)
    ? new Set(['lift'])
    : ['ladder', 'drop-ladder'].includes(elevationMode)
      ? new Set(['ladder'])
      : new Set(['ramp', 'stairs', 'step', 'landing']);
  const preferCompactCoverage = new Set(endpointNodeIndices).size >= 3;
  const candidatePool = profile.grammarPool
    .map(({ id }) => grammars[id])
    .filter((candidate) => (
      candidate
        && String(candidate.selectionConstraints?.routeNetworkModuleKind ?? 'room') === 'room'
        && candidate.selectionConstraints?.routeNetworkJunctionKind == null
    ))
    .sort((first, second) => String(first.id).localeCompare(String(second.id)));
  const candidatesFor = (index, targetDelta, { matchTransfer = false } = {}) => {
    const requestedRole = String(contentRoles[index] ?? 'discovery');
    return candidatePool.filter((candidate) => {
      if (!candidate.selectionConstraints?.routeNetworkContentRoles?.includes(requestedRole)) {
        return false;
      }
      if (Math.abs(grammarDelta(candidate) - targetDelta) > epsilon) return false;
      if (!matchTransfer) return true;
      return (candidate.selectionConstraints?.authoredTransferKinds ?? [])
        .some((kind) => requestedTransferKinds.has(String(kind)));
    }).sort((first, second) => (
      targetDelta < -epsilon
        || (preferCompactCoverage && (
          Math.abs(targetDelta) <= epsilon
            || (targetDelta > epsilon && preferCompactRise)
        ))
        ? Number(first.size?.width ?? 0) * Number(first.size?.depth ?? 0)
          - Number(second.size?.width ?? 0) * Number(second.size?.depth ?? 0)
        : 0
    ) || String(first.id).localeCompare(String(second.id)));
  };
  const roomIndices = moduleKinds
    .map((moduleKind, index) => ({ moduleKind, index }))
    .filter(({ moduleKind, index }) => (
      moduleKind === 'room' && index !== topologyKitModuleIndex
    ))
    .map(({ index }) => index);
  const orderedEndpointIndices = [...new Set(endpointNodeIndices)]
    .filter((index) => Number.isInteger(index))
    .sort((first, second) => first - second);
  const intervals = Array.from(
    { length: Math.max(0, orderedEndpointIndices.length - 1) },
    (_, ordinal) => ({
      ordinal,
      first: orderedEndpointIndices[ordinal],
      second: orderedEndpointIndices[ordinal + 1],
      roomIndices: roomIndices.filter((index) => (
        index > orderedEndpointIndices[ordinal]
          && index < orderedEndpointIndices[ordinal + 1]
      )),
    }),
  );
  const pairPlans = [];
  for (const interval of intervals) {
    for (const riseIndex of interval.roomIndices) {
      const riseCandidates = candidatesFor(riseIndex, 2.8, { matchTransfer: true });
      if (riseCandidates.length === 0) continue;
      for (const descentIndex of interval.roomIndices) {
        if (descentIndex <= riseIndex) continue;
        const descentCandidates = candidatesFor(descentIndex, -2.8);
        if (descentCandidates.length === 0) continue;
        const levelReplacements = new Map();
        let feasible = true;
        for (const index of roomIndices) {
          if (index === riseIndex || index === descentIndex) continue;
          if (Math.abs(grammarDelta(selectedGrammars[index])) <= epsilon
            && !preferCompactCoverage) continue;
          const levelCandidates = candidatesFor(index, 0);
          if (levelCandidates.length === 0) {
            feasible = false;
            break;
          }
          const selectionIndex = preferCompactCoverage
            ? 0
            : ((operationOrdinal + searchVariant + index)
              % levelCandidates.length + levelCandidates.length) % levelCandidates.length;
          levelReplacements.set(index, levelCandidates[selectionIndex]);
        }
        if (!feasible) continue;
        pairPlans.push({
          intervalOrdinal: interval.ordinal,
          riseIndex,
          descentIndex,
          riseCandidates,
          descentCandidates,
          levelReplacements,
        });
      }
    }
  }
  pairPlans.sort((first, second) => (
    Number(contentRoles[first.riseIndex] !== 'challenge')
      - Number(contentRoles[second.riseIndex] !== 'challenge')
      || Number(contentRoles[first.descentIndex] !== 'elevation')
        - Number(contentRoles[second.descentIndex] !== 'elevation')
      || first.intervalOrdinal - second.intervalOrdinal
      || first.riseIndex - second.riseIndex
      || first.descentIndex - second.descentIndex
  ));
  if (pairPlans.length === 0) {
    return {
      balanced: false,
      reason: 'authored-rise-return-pair-unavailable',
      intervals: intervals.map(({ first, second, roomIndices: indices }) => ({
        first,
        second,
        roomIndices: indices,
      })),
    };
  }
  // Pair ordering encodes the semantic preference. Variety is sampled within
  // the compatible rise/descent grammar families, never by choosing a weaker
  // pair that strands a required elevation-role room.
  const plan = pairPlans[0];
  for (const [index, grammar] of plan.levelReplacements) {
    selectedGrammars[index] = grammar;
  }
  const riseSelectionIndex = orderedEndpointIndices.length >= 3 && preferCompactRise
    ? 0
    : ((operationOrdinal + searchVariant + plan.riseIndex)
      % plan.riseCandidates.length + plan.riseCandidates.length) % plan.riseCandidates.length;
  // Three- and four-station coverage grants have only one 14 m station bay
  // between some exact sockets. Prefer the smallest legal authored rise and
  // return in those dense networks; two-station routes retain the normal
  // deterministic exhaustion order for visual variety.
  const descentSelectionIndex = orderedEndpointIndices.length >= 3
    ? 0
    : ((operationOrdinal + searchVariant + plan.descentIndex)
      % plan.descentCandidates.length + plan.descentCandidates.length)
      % plan.descentCandidates.length;
  selectedGrammars[plan.riseIndex] = plan.riseCandidates[riseSelectionIndex];
  selectedGrammars[plan.descentIndex] = plan.descentCandidates[descentSelectionIndex];

  const intervalDeltas = intervals.map(({ first, second }) => ({
    first,
    second,
    delta: selectedGrammars
      .slice(first + 1, second)
      .reduce((sum, grammar) => sum + grammarDelta(grammar), 0),
  }));
  return {
    balanced: intervalDeltas.every(({ delta }) => Math.abs(delta) <= epsilon),
    intervalDeltas,
    riseIndex: plan.riseIndex,
    descentIndex: plan.descentIndex,
  };
}

/**
 * Resolve the exact grammars used by a route-network candidate. This function
 * is intentionally shared by the provisional and both coverage-refinement
 * passes: topology kits must not disappear when endpoint indices are rebuilt.
 *
 * A grade-separated crossover is infrastructure, not a junction. It may only
 * occupy a connector slot other than the qualifying junction slot. If a grant
 * does not expose that spare slot (the pyramid loop, for example), selection is
 * deferred and the ordinary grammar remains in place for that candidate.
 */
export function resolveRouteNetworkGrammarAssignments({
  profile,
  grammars,
  routeNetworkKind = null,
  topologyTemplateId,
  junctionKinds = [],
  contentRoles = [],
  moduleKinds = [],
  junctionModuleIndex = 0,
  operationOrdinal = 0,
  searchVariant = 0,
  elevationMode = 'level',
} = {}) {
  const resolvedJunctionKinds = [...junctionKinds];
  const selectedGrammars = resolvedJunctionKinds.map((junctionKind, index) => (
    moduleKinds[index] === 'connector-module'
      ? routeNetworkGrammarForKind(profile, grammars, junctionKind, 'connector-module')
      : routeNetworkContentGrammarForRole(profile, grammars, contentRoles[index], {
        selectionOrdinal: operationOrdinal * 7 + index + searchVariant,
        elevationMode,
      })
  ));
  const topologyKitGrammar = routeNetworkTopologyKitGrammarForTemplate(
    profile,
    grammars,
    topologyTemplateId,
  );
  if (!topologyKitGrammar
    || routeNetworkKind === 'landmark-perimeter-loop'
    || routeNetworkKind === 'objective-route-coverage') {
    if (routeNetworkKind === 'objective-route-coverage') {
      balanceObjectiveRouteGrammarAssignments({
        profile,
        grammars,
        selectedGrammars,
        contentRoles,
        moduleKinds,
        operationOrdinal,
        searchVariant,
        elevationMode,
      });
    }
    return {
      selectedGrammars,
      junctionKinds: resolvedJunctionKinds,
      topologyKitGrammar,
      topologyKitModuleIndex: null,
      topologyKitDeferred: Boolean(topologyKitGrammar),
    };
  }
  const topologyModuleKind = String(
    topologyKitGrammar.selectionConstraints?.routeNetworkModuleKind ?? 'room',
  );
  const supportsJunctionPromotion =
    topologyKitGrammar.selectionConstraints?.supportsJunctionPromotion !== false;
  const compatibleIndices = moduleKinds
    .map((moduleKind, index) => ({ moduleKind, index }))
    .filter(({ moduleKind }) => moduleKind === topologyModuleKind)
    .map(({ index }) => index);
  let topologyKitModuleIndex = null;
  if (topologyModuleKind === 'room') {
    topologyKitModuleIndex = compatibleIndices.find((index) => (
      contentRoles[index] === 'challenge'
    )) ?? compatibleIndices[0] ?? null;
  } else if (!supportsJunctionPromotion) {
    const nonJunctionIndices = compatibleIndices.filter((index) => (
      index !== junctionModuleIndex
    ));
    topologyKitModuleIndex = nonJunctionIndices.find((index) => (
      index === 0 || index === moduleKinds.length - 1
    )) ?? nonJunctionIndices.at(-1) ?? null;
  } else if (compatibleIndices.includes(junctionModuleIndex)) {
    topologyKitModuleIndex = junctionModuleIndex;
  } else {
    [topologyKitModuleIndex = null] = compatibleIndices;
  }
  if (topologyKitModuleIndex != null) {
    selectedGrammars[topologyKitModuleIndex] = topologyKitGrammar;
    resolvedJunctionKinds[topologyKitModuleIndex] = String(
      topologyKitGrammar.selectionConstraints?.routeNetworkJunctionKind
        ?? resolvedJunctionKinds[topologyKitModuleIndex]
        ?? '',
    );
  }
  if (routeNetworkKind === 'objective-route-coverage') {
    balanceObjectiveRouteGrammarAssignments({
      profile,
      grammars,
      selectedGrammars,
      contentRoles,
      moduleKinds,
      topologyKitModuleIndex,
      operationOrdinal,
      searchVariant,
      elevationMode,
    });
  }
  return {
    selectedGrammars,
    junctionKinds: resolvedJunctionKinds,
    topologyKitGrammar,
    topologyKitModuleIndex,
    topologyKitDeferred: topologyKitModuleIndex == null,
  };
}

function samplePolylineByFraction(points, fraction) {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  if (points.length === 1) return cloneDungeonAugmentationValue(points[0]);
  if (measureDungeonPolyline(points) <= 1e-9) return cloneDungeonAugmentationValue(points[0]);
  return sampleDungeonPolyline(points, Math.max(0, Math.min(1, fraction))).point;
}

function routeNetworkOuterPoint(socket, offsetMeters) {
  return addDungeonPoints(
    socket.position,
    scaleDungeonPoint(socket.facing, offsetMeters),
  );
}

function toDungeonCardinalFacing(value) {
  const facing = toDungeonFacing(value);
  if (Math.abs(facing.x) >= Math.abs(facing.z)) {
    return { x: Math.sign(facing.x) || 1, y: 0, z: 0 };
  }
  return { x: 0, y: 0, z: Math.sign(facing.z) || 1 };
}

function pyramidPerimeterPolyline(grant, endpoints, offsetMeters, sideSign = 1) {
  const [first, second] = endpoints;
  const firstOuter = routeNetworkOuterPoint(first, offsetMeters);
  const secondOuter = routeNetworkOuterPoint(second, offsetMeters);
  const landmarkBounds = grant?.source?.landmarkBounds;
  if (landmarkBounds?.center
    && Number.isFinite(Number(landmarkBounds.widthMeters))
    && Number.isFinite(Number(landmarkBounds.depthMeters))) {
    const center = toDungeonPoint(landmarkBounds.center);
    const minimumX = center.x - Number(landmarkBounds.widthMeters) * 0.5 - offsetMeters;
    const maximumX = center.x + Number(landmarkBounds.widthMeters) * 0.5 + offsetMeters;
    const minimumZ = center.z - Number(landmarkBounds.depthMeters) * 0.5 - offsetMeters;
    const maximumZ = center.z + Number(landmarkBounds.depthMeters) * 0.5 + offsetMeters;
    const width = maximumX - minimumX;
    const depth = maximumZ - minimumZ;
    const perimeter = width * 2 + depth * 2;
    const perimeterOffset = (socket, point) => {
      if (Math.abs(socket.facing.z) >= Math.abs(socket.facing.x)) {
        return socket.facing.z < 0
          ? point.x - minimumX
          : width + depth + (maximumX - point.x);
      }
      return socket.facing.x > 0
        ? width + (point.z - minimumZ)
        : width * 2 + depth + (maximumZ - point.z);
    };
    const pointAtOffset = (rawOffset) => {
      const offset = ((rawOffset % perimeter) + perimeter) % perimeter;
      if (offset <= width) return { x: minimumX + offset, y: center.y, z: minimumZ };
      if (offset <= width + depth) {
        return { x: maximumX, y: center.y, z: minimumZ + offset - width };
      }
      if (offset <= width * 2 + depth) {
        return { x: maximumX - (offset - width - depth), y: center.y, z: maximumZ };
      }
      return { x: minimumX, y: center.y, z: maximumZ - (offset - width * 2 - depth) };
    };
    const firstOffset = perimeterOffset(first, firstOuter);
    const secondOffset = perimeterOffset(second, secondOuter);
    const forwardDistance = ((secondOffset - firstOffset) % perimeter + perimeter) % perimeter;
    const reverseDistance = perimeter - forwardDistance;
    const forward = sideSign > 0
      ? forwardDistance <= reverseDistance
      : forwardDistance < reverseDistance;
    const distance = forward ? forwardDistance : reverseDistance;
    const direction = forward ? 1 : -1;
    const cornerOffsets = [0, width, width + depth, width * 2 + depth, perimeter];
    const unwrappedCorners = [];
    for (let lap = -1; lap <= 2; lap += 1) {
      for (const cornerOffset of cornerOffsets) {
        unwrappedCorners.push(cornerOffset + perimeter * lap);
      }
    }
    const endOffset = firstOffset + direction * distance;
    const crossedCorners = unwrappedCorners
      .filter((offset) => direction > 0
        ? offset > firstOffset + 1e-6 && offset < endOffset - 1e-6
        : offset < firstOffset - 1e-6 && offset > endOffset + 1e-6)
      .sort((a, b) => direction > 0 ? a - b : b - a)
      .map(pointAtOffset);
    return [firstOuter, ...crossedCorners, secondOuter];
  }
  const dot = first.facing.x * second.facing.x + first.facing.z * second.facing.z;
  if (Math.abs(dot) < 0.25) {
    const firstHorizontal = Math.abs(first.facing.x) > Math.abs(first.facing.z);
    const corner = firstHorizontal
      ? { x: firstOuter.x, y: firstOuter.y, z: secondOuter.z }
      : { x: secondOuter.x, y: firstOuter.y, z: firstOuter.z };
    return [firstOuter, corner, secondOuter];
  }
  const tangent = {
    x: -first.facing.z * sideSign,
    y: 0,
    z: first.facing.x * sideSign,
  };
  const wrapOffset = offsetMeters * 1.5;
  return [
    firstOuter,
    addDungeonPoints(firstOuter, scaleDungeonPoint(tangent, wrapOffset)),
    addDungeonPoints(secondOuter, scaleDungeonPoint(tangent, wrapOffset)),
    secondOuter,
  ];
}

function routeNetworkPlacementPolyline(grant, offsetMeters, sideSign) {
  const endpoints = [...grant.endpointSockets].sort((first, second) => (
    Number(first.distanceMeters ?? 0) - Number(second.distanceMeters ?? 0)
      || first.id.localeCompare(second.id)
  ));
  if (grant.kind === 'landmark-perimeter-loop') {
    return pyramidPerimeterPolyline(grant, endpoints, offsetMeters, sideSign);
  }
  const outerPoints = endpoints.map((socket) => routeNetworkOuterPoint(socket, offsetMeters));
  // Coverage stations are already exact, collision-scored host apertures.
  // Preserve their one-to-one outer points; sampling a multi-bend polyline by
  // fraction can cut corners and rotate long grammars into the parent route.
  return outerPoints;
}

function objectiveCoverageStationSockets(
  center,
  endpoint,
  size = {},
  grammar = null,
) {
  if (Array.isArray(grammar?.sockets)) {
    const placement = {
      center: toDungeonPoint(center),
      facing: toDungeonFacing(endpoint?.facing),
      rotationQuarterTurns: rotationQuarterTurnsForFacing(endpoint?.facing),
      coordinateSpace: endpoint?.coordinateSpace,
    };
    const authoredSpineSocketIds =
      grammar.selectionConstraints?.supportsJunctionPromotion === false
      && Array.isArray(grammar.selectionConstraints?.routeNetworkSpineSocketIds)
      ? new Set(grammar.selectionConstraints.routeNetworkSpineSocketIds.map(String))
      : null;
    const authoredSockets = grammar.sockets
      // `entry` is reserved for the exact parent attachment.  Every returned
      // socket must physically exist on the selected station blueprint.
      .filter(({ id }) => (
        id !== 'entry' && (!authoredSpineSocketIds || authoredSpineSocketIds.has(String(id)))
      ))
      .map((socket) => ({
        localSocketId: socket.id,
        position: transformDungeonLocalPoint(socket.localPosition, placement),
        facing: transformDungeonLocalFacing(socket.localFacing, placement),
      }));
    if (authoredSockets.length > 0) return authoredSockets;
  }
  const forward = toDungeonCardinalFacing(endpoint?.facing);
  const right = { x: forward.z, y: 0, z: -forward.x };
  // Blueprint apertures sit on the centers of their boundary floor cells,
  // not on the outer edge of the mask's bounding box.  Using half the full
  // footprint shifted every planned station socket outward by 1.4 m; a pair
  // of those shifts turned a legal 33.6 m interval into a rejected 36.4 m
  // realized connector.
  const boundaryCellInsetMeters = 1.4;
  const halfWidth = Math.max(0, Number(size.width ?? 14) * 0.5 - boundaryCellInsetMeters);
  const halfDepth = Math.max(
    0,
    Number(size.depth ?? 19.6) * 0.5 - boundaryCellInsetMeters,
  );
  return [
    {
      localSocketId: 'exit',
      position: addDungeonPoints(center, scaleDungeonPoint(forward, halfDepth)),
      facing: forward,
    },
    {
      localSocketId: 'left',
      position: addDungeonPoints(center, scaleDungeonPoint(right, -halfWidth)),
      facing: scaleDungeonPoint(right, -1),
    },
    {
      localSocketId: 'right',
      position: addDungeonPoints(center, scaleDungeonPoint(right, halfWidth)),
      facing: right,
    },
  ];
}

function objectiveCoverageRoomPlacementsOnPath(
  path,
  roomOrdinals,
  roomDepthMeters,
  minimumApproachMeters,
  maximumFeaturelessSpanMeters,
  {
    roomEntryElevationMeters = [],
    roomExitElevationMeters = [],
    scorePlacement = () => 0,
  } = {},
) {
  const pathLengthMeters = measureDungeonPolyline(path);
  const runs = planarRouteRuns(path).map((run) => ({
    ...run,
    startDistanceMeters: run.precedingLengthMeters,
    endDistanceMeters: run.precedingLengthMeters + run.lengthMeters,
    facing: run.axis === 'x'
      ? { x: run.direction, y: 0, z: 0 }
      : { x: 0, y: 0, z: run.direction },
  }));
  const placementForEntry = (
    roomOrdinal,
    entryDistanceMeters,
    run,
    previousPlacement = null,
  ) => {
    const depthMeters = roomDepthMeters[roomOrdinal];
    const entryPoint = sampleDungeonPolylineAtDistance(path, entryDistanceMeters).point;
    const entryElevationMeters = Number(roomEntryElevationMeters[roomOrdinal] ?? 0);
    const baseElevationMeters = previousPlacement
      ? Number(previousPlacement.center.y)
        + Number(roomExitElevationMeters[previousPlacement.roomOrdinal] ?? 0)
        - entryElevationMeters
      : Number(entryPoint.y) - entryElevationMeters;
    return {
      roomOrdinal,
      entryDistanceMeters,
      exitDistanceMeters: entryDistanceMeters + depthMeters,
      center: {
        ...addDungeonPoints(
          entryPoint,
          scaleDungeonPoint(run.facing, depthMeters * 0.5),
        ),
        y: baseElevationMeters,
      },
      facing: cloneDungeonAugmentationValue(run.facing),
    };
  };
  if (roomOrdinals.length === 0) return [[]];
  if (roomOrdinals.length === 1) {
    const [roomOrdinal] = roomOrdinals;
    const depthMeters = roomDepthMeters[roomOrdinal];
    const idealEntryDistanceMeters = (pathLengthMeters - depthMeters) * 0.5;
    return runs.flatMap((run) => {
      const minimumEntryDistanceMeters = Math.max(
        minimumApproachMeters,
        run.startDistanceMeters + minimumApproachMeters,
        pathLengthMeters - depthMeters - maximumFeaturelessSpanMeters,
      );
      const maximumEntryDistanceMeters = Math.min(
        maximumFeaturelessSpanMeters,
        run.endDistanceMeters - depthMeters - minimumApproachMeters,
        pathLengthMeters - depthMeters - minimumApproachMeters,
      );
      if (minimumEntryDistanceMeters > maximumEntryDistanceMeters + 1e-6) return [];
      const entryDistanceMeters = Math.max(
        minimumEntryDistanceMeters,
        Math.min(maximumEntryDistanceMeters, idealEntryDistanceMeters),
      );
      return [{
        placements: [placementForEntry(roomOrdinal, entryDistanceMeters, run)],
        targetDeviationMeters: Math.abs(
          entryDistanceMeters - idealEntryDistanceMeters,
        ),
      }];
    }).map((candidate) => ({
      ...candidate,
      collisionScore: scorePlacement(candidate.placements[0]),
    })).sort((first, second) => (
      first.collisionScore - second.collisionScore
        || first.targetDeviationMeters - second.targetDeviationMeters
        || first.placements[0].entryDistanceMeters
          - second.placements[0].entryDistanceMeters
    )).map(({ placements }) => placements);
  }
  if (roomOrdinals.length === 2) {
    const [firstRoomOrdinal, secondRoomOrdinal] = roomOrdinals;
    const firstDepthMeters = roomDepthMeters[firstRoomOrdinal];
    const secondDepthMeters = roomDepthMeters[secondRoomOrdinal];
    // The first room's exit and second room's entry are the two target
    // attachment apertures. Deriving centers from those arc distances avoids
    // charging each half-room to the neighboring corridor a second time.
    const idealFirstEntryDistanceMeters = pathLengthMeters / 3 - firstDepthMeters;
    const idealSecondEntryDistanceMeters = pathLengthMeters * 2 / 3;
    const intervalValues = (minimum, maximum, ideal) => {
      if (minimum > maximum + 1e-6) return [];
      const values = [
        minimum,
        maximum,
        Math.max(minimum, Math.min(maximum, ideal)),
      ];
      for (let value = minimum; value <= maximum + 1e-6; value += 2.8) {
        values.push(Math.min(value, maximum));
      }
      return [...new Set(values.map((value) => Number(value.toFixed(6))))]
        .sort((first, second) => (
          Math.abs(first - ideal) - Math.abs(second - ideal)
            || first - second
        ));
    };
    const firstCandidates = runs.flatMap((run) => {
      const minimum = Math.max(
        minimumApproachMeters,
        run.startDistanceMeters + minimumApproachMeters,
      );
      const maximum = Math.min(
        maximumFeaturelessSpanMeters,
        run.endDistanceMeters - firstDepthMeters - minimumApproachMeters,
      );
      return intervalValues(minimum, maximum, idealFirstEntryDistanceMeters)
        .map((entryDistanceMeters) => ({ run, entryDistanceMeters }));
    });
    const secondCandidates = runs.flatMap((run) => {
      const minimum = Math.max(
        run.startDistanceMeters + minimumApproachMeters,
        pathLengthMeters - secondDepthMeters - maximumFeaturelessSpanMeters,
      );
      const maximum = Math.min(
        run.endDistanceMeters - secondDepthMeters - minimumApproachMeters,
        pathLengthMeters - secondDepthMeters - minimumApproachMeters,
      );
      return intervalValues(minimum, maximum, idealSecondEntryDistanceMeters)
        .map((entryDistanceMeters) => ({ run, entryDistanceMeters }));
    });
    return firstCandidates.flatMap((firstCandidate) => (
      secondCandidates.flatMap((secondCandidate) => {
        const middleGapMeters = secondCandidate.entryDistanceMeters
          - firstCandidate.entryDistanceMeters - firstDepthMeters;
        if (middleGapMeters < minimumApproachMeters - 1e-6
          || middleGapMeters > maximumFeaturelessSpanMeters + 1e-6) return [];
        const firstPlacement = placementForEntry(
          firstRoomOrdinal,
          firstCandidate.entryDistanceMeters,
          firstCandidate.run,
        );
        const secondPlacement = placementForEntry(
          secondRoomOrdinal,
          secondCandidate.entryDistanceMeters,
          secondCandidate.run,
          firstPlacement,
        );
        return [{
          placements: [firstPlacement, secondPlacement],
          collisionScore: scorePlacement(firstPlacement)
            + scorePlacement(secondPlacement),
          targetDeviationMeters: Math.abs(
            firstCandidate.entryDistanceMeters - idealFirstEntryDistanceMeters,
          ) + Math.abs(
            secondCandidate.entryDistanceMeters - idealSecondEntryDistanceMeters,
          ),
        }];
      })
    )).sort((first, second) => (
      first.collisionScore - second.collisionScore
        || first.targetDeviationMeters - second.targetDeviationMeters
        || first.placements[0].entryDistanceMeters
          - second.placements[0].entryDistanceMeters
        || first.placements[1].entryDistanceMeters
          - second.placements[1].entryDistanceMeters
    )).slice(0, 64).map(({ placements }) => placements);
  }
  if (roomOrdinals.length >= 3) {
    const totalRoomDepthMeters = roomOrdinals.reduce((total, roomOrdinal) => (
      total + Number(roomDepthMeters[roomOrdinal] ?? 0)
    ), 0);
    const idealGapMeters = Math.max(
      minimumApproachMeters,
      (pathLengthMeters - totalRoomDepthMeters) / (roomOrdinals.length + 1),
    );
    let placementStates = [{
      placements: [],
      collisionScore: 0,
      targetDeviationMeters: 0,
      signature: '',
    }];
    for (let roomIndex = 0; roomIndex < roomOrdinals.length; roomIndex += 1) {
      const roomOrdinal = roomOrdinals[roomIndex];
      const depthMeters = Number(roomDepthMeters[roomOrdinal]);
      const priorRoomDepthMeters = roomOrdinals
        .slice(0, roomIndex)
        .reduce((total, ordinal) => total + Number(roomDepthMeters[ordinal]), 0);
      const idealEntryDistanceMeters = priorRoomDepthMeters
        + idealGapMeters * (roomIndex + 1);
      const nextStates = [];
      for (const state of placementStates) {
        const previousPlacement = state.placements.at(-1) ?? null;
        const previousExitDistanceMeters = previousPlacement?.exitDistanceMeters ?? 0;
        for (const run of runs) {
          let minimumEntryDistanceMeters = Math.max(
            run.startDistanceMeters + minimumApproachMeters,
            roomIndex === 0
              ? minimumApproachMeters
              : previousExitDistanceMeters + minimumApproachMeters,
          );
          let maximumEntryDistanceMeters = Math.min(
            run.endDistanceMeters - depthMeters - minimumApproachMeters,
            roomIndex === 0
              ? maximumFeaturelessSpanMeters
              : previousExitDistanceMeters + maximumFeaturelessSpanMeters,
          );
          if (roomIndex === roomOrdinals.length - 1) {
            minimumEntryDistanceMeters = Math.max(
              minimumEntryDistanceMeters,
              pathLengthMeters - depthMeters - maximumFeaturelessSpanMeters,
            );
            maximumEntryDistanceMeters = Math.min(
              maximumEntryDistanceMeters,
              pathLengthMeters - depthMeters - minimumApproachMeters,
            );
          }
          if (minimumEntryDistanceMeters > maximumEntryDistanceMeters + 1e-6) continue;
          const entryValues = [
            minimumEntryDistanceMeters,
            maximumEntryDistanceMeters,
            Math.max(
              minimumEntryDistanceMeters,
              Math.min(maximumEntryDistanceMeters, idealEntryDistanceMeters),
            ),
          ];
          for (let value = minimumEntryDistanceMeters;
            value <= maximumEntryDistanceMeters + 1e-6;
            value += 2.8) {
            entryValues.push(Math.min(value, maximumEntryDistanceMeters));
          }
          const orderedEntryValues = [...new Set(entryValues.map((value) => (
            Number(value.toFixed(6))
          )))].sort((first, second) => (
            Math.abs(first - idealEntryDistanceMeters)
              - Math.abs(second - idealEntryDistanceMeters)
              || first - second
          ));
          for (const entryDistanceMeters of orderedEntryValues) {
            const placement = placementForEntry(
              roomOrdinal,
              entryDistanceMeters,
              run,
              previousPlacement,
            );
            nextStates.push({
              placements: [...state.placements, placement],
              collisionScore: state.collisionScore + scorePlacement(placement),
              targetDeviationMeters: state.targetDeviationMeters
                + Math.abs(entryDistanceMeters - idealEntryDistanceMeters),
              signature: `${state.signature}|${entryDistanceMeters.toFixed(4)}`,
            });
          }
        }
      }
      placementStates = nextStates.sort((first, second) => (
        first.collisionScore - second.collisionScore
          || first.targetDeviationMeters - second.targetDeviationMeters
          || first.signature.localeCompare(second.signature)
      )).slice(0, 128);
      if (placementStates.length === 0) return [];
    }
    return placementStates.map(({ placements }) => placements);
  }
  return [];
}

function objectiveCoverageExternalPlacement(outerPoints, endpoints, {
  stationSizes = [],
  stationGrammars = [],
  contentRoomDepthMeters = [19.6, 19.6],
  contentRoomEntryElevationMeters = [],
  contentRoomExitElevationMeters = [],
  contentRoomSizes = [],
  contentRoomPlanningVolumes = [],
  minimumApproachMeters = ROUTE_NETWORK_SOCKET_APPROACH_METERS,
  minimumRoomApproachMeters = 2.8,
  maximumFeaturelessSpanMeters = ROUTE_NETWORK_MAXIMUM_FEATURELESS_SPAN_METERS,
  searchVariant = 0,
  planningAvoidanceVolumes = [],
  planningOverlapGrants = [],
  diagnostics = null,
} = {}) {
  const setDiagnostics = (stage, details = {}) => {
    if (diagnostics && typeof diagnostics === 'object') {
      Object.assign(diagnostics, { stage, ...details });
    }
  };
  if (outerPoints.length < 2 || contentRoomDepthMeters.length < 2) {
    setDiagnostics('insufficient-input', {
      outerPointCount: outerPoints.length,
      contentRoomCount: contentRoomDepthMeters.length,
    });
    return null;
  }
  const stationSockets = outerPoints.map((center, stationOrdinal) => (
    objectiveCoverageStationSockets(
      center,
      endpoints[stationOrdinal],
      stationSizes[stationOrdinal],
      stationGrammars[stationOrdinal],
    )
  ));
  const footprintForPlacement = (center, facing, size = {}) => {
    const cardinalFacing = toDungeonCardinalFacing(facing);
    const horizontal = Math.abs(cardinalFacing.x) > 0.5;
    return {
      center,
      size: {
        x: Number(horizontal ? size.depth : size.width),
        z: Number(horizontal ? size.width : size.depth),
      },
    };
  };
  const stationFootprints = outerPoints.map((center, stationOrdinal) => (
    footprintForPlacement(
      center,
      endpoints[stationOrdinal].facing,
      stationSizes[stationOrdinal] ?? { width: 14, depth: 19.6 },
    )
  ));
  const stationPlanningVolumesByOrdinal = outerPoints.map((center, stationOrdinal) => {
    const grammar = stationGrammars[stationOrdinal];
    const volumeTemplates = (grammar?.occupiedVolumes ?? []).length > 0
      ? grammar.occupiedVolumes
      : grammar?.clearanceVolumes ?? [];
    if (volumeTemplates.length > 0) {
      const stationPlacement = {
        center: toDungeonPoint(center),
        facing: toDungeonFacing(endpoints[stationOrdinal].facing),
        rotationQuarterTurns: rotationQuarterTurnsForFacing(
          endpoints[stationOrdinal].facing,
        ),
        coordinateSpace: endpoints[stationOrdinal]?.coordinateSpace,
      };
      return volumeTemplates.map((volume, volumeOrdinal) => transformDungeonVolume(
        volume,
        stationPlacement,
        `objective-external-station:${stationOrdinal}:${volumeOrdinal}:`,
      ));
    }
    const footprint = stationFootprints[stationOrdinal];
    return [{
      id: `objective-external-station:${stationOrdinal}`,
      center: {
        x: Number(footprint.center.x),
        y: Number(footprint.center.y) + 4.2,
        z: Number(footprint.center.z),
      },
      size: {
        x: Number(footprint.size.x),
        y: 8.4,
        z: Number(footprint.size.z),
      },
    }];
  });
  const roomFootprint = (placement) => footprintForPlacement(
    placement.center,
    placement.facing,
    contentRoomSizes[placement.roomOrdinal] ?? {
      width: 19.6,
      depth: contentRoomDepthMeters[placement.roomOrdinal],
    },
  );
  const planningVolumesForRoomPlacement = (placement) => {
    const volumeTemplates = contentRoomPlanningVolumes[placement.roomOrdinal] ?? [];
    if (volumeTemplates.length > 0) {
      const roomPlacement = {
        center: toDungeonPoint(placement.center),
        facing: toDungeonFacing(placement.facing),
        rotationQuarterTurns: rotationQuarterTurnsForFacing(placement.facing),
        coordinateSpace: endpoints[0]?.coordinateSpace,
      };
      return volumeTemplates.map((volume, volumeOrdinal) => transformDungeonVolume(
        volume,
        roomPlacement,
        `objective-external-room:${placement.roomOrdinal}:${volumeOrdinal}:`,
      ));
    }
    const footprint = roomFootprint(placement);
    const size = contentRoomSizes[placement.roomOrdinal] ?? {};
    const heightMeters = Number(size.height ?? 8.4);
    return [{
      center: {
        x: Number(footprint.center.x),
        y: Number(footprint.center.y) + heightMeters * 0.5,
        z: Number(footprint.center.z),
      },
      size: {
        x: Number(footprint.size.x),
        y: heightMeters,
        z: Number(footprint.size.z),
      },
    }];
  };
  const nearbyPlanningAvoidanceVolumes = createPlanningVolumeSpatialLookup(
    planningAvoidanceVolumes,
  );
  const roomPlacementStaticCollisionScoreCache = new Map();
  const roomPlacementStaticCollisionScore = (placement) => (
    (() => {
      const key = [
        placement.roomOrdinal,
        Number(placement.center.x).toFixed(4),
        Number(placement.center.y).toFixed(4),
        Number(placement.center.z).toFixed(4),
        Number(placement.facing.x).toFixed(1),
        Number(placement.facing.z).toFixed(1),
      ].join(':');
      if (roomPlacementStaticCollisionScoreCache.has(key)) {
        return roomPlacementStaticCollisionScoreCache.get(key);
      }
      const score = planningVolumesForRoomPlacement(placement).reduce((total, volume) => (
        total + [...nearbyPlanningAvoidanceVolumes(volume)].reduce((count, obstacle) => (
          count + (planningVolumesOverlap(volume, obstacle) ? 1 : 0)
        ), 0)
      ), 0);
      roomPlacementStaticCollisionScoreCache.set(key, score);
      return score;
    })()
  );
  const indexedPathPlanningCollisionScore = (
    path,
    heightMeters = 5.6,
    overlapGrants = [],
  ) => routePathPlanningVolumes(path, heightMeters).reduce((score, volume) => (
    score + [...nearbyPlanningAvoidanceVolumes(volume)].reduce((count, obstacle) => (
      count + (planningVolumesOverlap(volume, obstacle)
        && !planningOverlapIsGranted(volume, obstacle, overlapGrants) ? 1 : 0)
    ), 0)
  ), 0);
  const roomPlacementStationCollisionScore = (placements) => {
    const roomVolumeGroups = placements.map(planningVolumesForRoomPlacement);
    const stationScore = roomVolumeGroups.reduce((score, roomVolumes) => (
      score + stationPlanningVolumesByOrdinal.reduce((stationTotal, stationVolumes) => (
        stationTotal + roomVolumes.reduce((roomTotal, roomVolume) => (
          roomTotal + stationVolumes.reduce((volumeTotal, stationVolume) => (
            volumeTotal + (planningVolumesOverlap(roomVolume, stationVolume) ? 1 : 0)
          ), 0)
        ), 0)
      ), 0)
    ), 0);
    const roomScore = roomVolumeGroups.reduce((score, roomVolumes, index) => (
      score + roomVolumeGroups.slice(index + 1).reduce((otherTotal, otherRoomVolumes) => (
        otherTotal + roomVolumes.reduce((roomTotal, roomVolume) => (
          roomTotal + otherRoomVolumes.reduce((volumeTotal, otherRoomVolume) => (
            volumeTotal + (planningVolumesOverlap(roomVolume, otherRoomVolume) ? 1 : 0)
          ), 0)
        ), 0)
      ), 0)
    ), 0);
    return stationScore + roomScore;
  };
  const roomPlacementsClearExactStations = (placements) => (
    roomPlacementStationCollisionScore(placements) === 0
  );
  const roomsByGap = Array.from(
    { length: outerPoints.length - 1 },
    () => [],
  );
  if (roomsByGap.length === 1) {
    roomsByGap[0] = contentRoomDepthMeters.map((_, roomOrdinal) => roomOrdinal);
  } else {
    const finalRoomOrdinal = contentRoomDepthMeters.length - 1;
    for (let roomOrdinal = 0;
      roomOrdinal < contentRoomDepthMeters.length;
      roomOrdinal += 1) {
      const gapOrdinal = finalRoomOrdinal === 0
        ? 0
        : Math.floor(roomOrdinal * (roomsByGap.length - 1) / finalRoomOrdinal);
      roomsByGap[gapOrdinal].push(roomOrdinal);
    }
  }
  const routePathCandidates = (fromSocket, toSocket) => {
    const results = [];
    const seen = new Set();
    const register = (path, routePreferenceOrdinal) => {
      const normalized = normalizedRoutePath(path);
      const signature = normalized.map((point) => (
        `${Number(point.x).toFixed(4)},${Number(point.z).toFixed(4)}`
      )).join('|');
      if (seen.has(signature)) return;
      seen.add(signature);
      results.push({
        path: normalized,
        lengthMeters: measureDungeonPolyline(normalized),
        routePreferenceOrdinal,
        signature,
      });
    };
    const coincident = dungeonPointDistance(
      fromSocket.position,
      toSocket.position,
    ) <= 1e-6;
    const facingDot = Number(fromSocket.facing.x) * Number(toSocket.facing.x)
      + Number(fromSocket.facing.z) * Number(toSocket.facing.z);
    if (coincident && facingDot <= -1 + 1e-6) {
      register([
        fromSocket.position,
        cloneDungeonAugmentationValue(fromSocket.position),
      ], -1);
    }
    const detourOffsetsMeters = Array.from(
      // A 31 m authored room needs its own straight run plus a two-tile
      // approach at both sockets.  The former 33.6 m detour ceiling could not
      // contain that perfectly legal footprint, so the exact-path solver
      // silently fell back to independent continuation leads.  Permit the
      // network to grow outward by two featureless intervals; accepted paths
      // are still checked interval-by-interval below.
      { length: 24 },
      (_, index) => (index + 1) * 2.8,
    );
    for (const [routePreferenceOrdinal, preferXFirst] of [true, false].entries()) {
      for (const path of facingAwareSocketRouteCandidates(fromSocket, toSocket, {
        preferXFirst,
        sourceApproachMeters: [minimumApproachMeters],
        destinationApproachMeters: [minimumApproachMeters],
        detourOffsetsMeters,
        minimumApproachMeters,
      })) register(path, routePreferenceOrdinal);
    }
    return results.sort((first, second) => (
      first.lengthMeters - second.lengthMeters
        || first.routePreferenceOrdinal - second.routePreferenceOrdinal
        || first.signature.localeCompare(second.signature)
    ));
  };
  const gapOptions = roomsByGap.map((roomOrdinals, gapOrdinal) => {
    const maximumRouteLengthMeters = roomOrdinals.reduce((total, roomOrdinal) => (
      total + Number(contentRoomDepthMeters[roomOrdinal] ?? 0)
    ), 0) + maximumFeaturelessSpanMeters * (roomOrdinals.length + 1);
    const options = stationSockets[gapOrdinal].flatMap((fromSocket) => (
      stationSockets[gapOrdinal + 1].flatMap((toSocket) => (
        routePathCandidates(fromSocket, toSocket).flatMap((route) => {
          if (route.lengthMeters > maximumRouteLengthMeters + 1e-6) return [];
          const rawPlacementSets = objectiveCoverageRoomPlacementsOnPath(
            route.path,
            roomOrdinals,
            contentRoomDepthMeters,
            minimumRoomApproachMeters,
            maximumFeaturelessSpanMeters,
            {
              roomEntryElevationMeters: contentRoomEntryElevationMeters,
              roomExitElevationMeters: contentRoomExitElevationMeters,
              scorePlacement: roomPlacementStaticCollisionScore,
            },
          );
          const scoredPlacementSets = rawPlacementSets.map((placements) => ({
            placements,
            stationCollisionScore: roomPlacementStationCollisionScore(placements),
          }));
          const placementSets = scoredPlacementSets
            .filter(({ stationCollisionScore }) => stationCollisionScore === 0)
            .map(({ placements }) => placements);
          return placementSets.map((roomPlacements) => {
            let connectorStartDistanceMeters = 0;
            const connectorPaths = [];
            for (const placement of roomPlacements) {
              connectorPaths.push(sliceDungeonPolylineByDistance(
                route.path,
                connectorStartDistanceMeters,
                placement.entryDistanceMeters,
              ));
              connectorStartDistanceMeters = placement.exitDistanceMeters;
            }
            connectorPaths.push(sliceDungeonPolylineByDistance(
              route.path,
              connectorStartDistanceMeters,
              route.lengthMeters,
            ));
            const connectorStaticCollisionScore = connectorPaths.reduce((score, connectorPath) => (
              score + (measureDungeonPolyline(connectorPath) > 1e-6
                ? indexedPathPlanningCollisionScore(
                  connectorPath,
                  5.6,
                  planningOverlapGrants,
                )
                : 0)
            ), 0);
            // A gap path may overlap its source station on the first leg and
            // its destination station on the final leg.  It may never loop
            // back through either station (or cross a third station) between
            // authored rooms.  Scoring only host volumes allowed exactly that
            // invalid shape, which the global physical solver rejected much
            // later as a collision with node 0.
            const connectorStationCollisionScore = connectorPaths.reduce(
              (score, connectorPath, connectorOrdinal) => {
                if (measureDungeonPolyline(connectorPath) <= 1e-6) return score;
                const permittedStationOrdinals = new Set([
                  ...(connectorOrdinal === 0 ? [gapOrdinal] : []),
                  ...(connectorOrdinal === connectorPaths.length - 1
                    ? [gapOrdinal + 1]
                    : []),
                ]);
                const forbiddenStationVolumes = stationPlanningVolumesByOrdinal.flatMap(
                  (stationVolumes, stationOrdinal) => (
                    permittedStationOrdinals.has(stationOrdinal) ? [] : stationVolumes
                  ),
                );
                return score + pathPlanningCollisionScore(
                  connectorPath,
                  forbiddenStationVolumes,
                  5.6,
                  [],
                );
              },
              0,
            );
            const roomStaticCollisionScore = roomPlacements.reduce((score, placement) => (
              score + roomPlacementStaticCollisionScore(placement)
            ), 0);
            return {
              gapOrdinal,
              fromLocalSocketId: fromSocket.localSocketId,
              toLocalSocketId: toSocket.localSocketId,
              roomPlacements,
              routePath: route.path,
              routeLengthMeters: route.lengthMeters,
              stationCollisionScore: connectorStationCollisionScore,
              staticCollisionScore: connectorStaticCollisionScore
                + connectorStationCollisionScore
                + roomStaticCollisionScore,
              signature: [
                fromSocket.localSocketId,
                toSocket.localSocketId,
                route.signature,
                ...roomPlacements.map(({ roomOrdinal, entryDistanceMeters }) => (
                  `${roomOrdinal}@${entryDistanceMeters.toFixed(4)}`
                )),
              ].join(':'),
            };
          }).filter(({ stationCollisionScore }) => stationCollisionScore === 0);
        })
      ))
    )).sort((first, second) => (
      first.staticCollisionScore - second.staticCollisionScore
        || first.routeLengthMeters - second.routeLengthMeters
        || first.fromLocalSocketId.localeCompare(second.fromLocalSocketId)
        || first.toLocalSocketId.localeCompare(second.toLocalSocketId)
        || first.signature.localeCompare(second.signature)
    ));
    // Keep deterministic socket-pair diversity while bounding the Cartesian
    // combination used by repeated global candidate attempts.
    const pairCounts = new Map();
    return options.filter((option) => {
      const pairKey = `${option.fromLocalSocketId}:${option.toLocalSocketId}`;
      const count = pairCounts.get(pairKey) ?? 0;
      pairCounts.set(pairKey, count + 1);
      return count < 8;
    });
  });
  if (gapOptions.some((options) => options.length === 0)) {
    setDiagnostics('gap-options-empty', {
      gapOptionCounts: gapOptions.map((options) => options.length),
    });
    return null;
  }
  let states = [{
    options: [],
    usedSockets: new Set(),
    totalStaticCollisionScore: 0,
    totalLengthMeters: 0,
    signature: '',
  }];
  for (const options of gapOptions) {
    const nextStates = [];
    for (const state of states) {
      for (const option of options) {
        const fromKey = `${option.gapOrdinal}:${option.fromLocalSocketId}`;
        const toKey = `${option.gapOrdinal + 1}:${option.toLocalSocketId}`;
        if (state.usedSockets.has(fromKey) || state.usedSockets.has(toKey)) continue;
        const existingRoomPlacements = state.options.flatMap((candidate) => (
          candidate.roomPlacements
        ));
        const combinedRoomPlacements = [
          ...existingRoomPlacements,
          ...option.roomPlacements,
        ];
        if (!roomPlacementsClearExactStations(combinedRoomPlacements)) continue;
        nextStates.push({
          options: [...state.options, option],
          usedSockets: new Set([...state.usedSockets, fromKey, toKey]),
          totalStaticCollisionScore: state.totalStaticCollisionScore
            + option.staticCollisionScore,
          totalLengthMeters: state.totalLengthMeters + option.routeLengthMeters,
          signature: `${state.signature}|${option.signature}`,
        });
      }
    }
    states = nextStates.sort((first, second) => (
      first.totalStaticCollisionScore - second.totalStaticCollisionScore
        || first.totalLengthMeters - second.totalLengthMeters
        || first.signature.localeCompare(second.signature)
    )).slice(0, 256);
    if (states.length === 0) {
      setDiagnostics('combined-state-empty', {
        gapOptionCounts: gapOptions.map((candidates) => candidates.length),
      });
      return null;
    }
  }
  const normalizedSearchVariant = Math.abs(
    Math.trunc(Number(searchVariant) || 0),
  );
  // Never trade physical feasibility for variety. The beam is ordered by its
  // collision score first, so restrict deterministic retry variation to the
  // complete states in the best available collision tier. This still varies
  // socket/path combinations, while preventing a later retry from selecting a
  // host-intersecting layout when a collision-free authored layout exists.
  const bestStaticCollisionScore = states[0].totalStaticCollisionScore;
  // This stage is an optimization, not authority to stamp a known collision.
  // When no collision-free composed state exists, hand the same authored
  // modules to the bounded global placement solver below; it can rotate and
  // spread them beyond the precomposed station-to-station polyline.
  if (bestStaticCollisionScore > 0) {
    setDiagnostics('best-state-collides', {
      bestStaticCollisionScore,
      stateCount: states.length,
      gapOptionCounts: gapOptions.map((candidates) => candidates.length),
    });
    return null;
  }
  const bestCollisionTier = states.filter(({ totalStaticCollisionScore }) => (
    totalStaticCollisionScore === bestStaticCollisionScore
  ));
  const selectedStateIndex = (normalizedSearchVariant * 67) % bestCollisionTier.length;
  const selectedState = bestCollisionTier[selectedStateIndex];
  const sequence = [];
  for (let gapOrdinal = 0; gapOrdinal < selectedState.options.length; gapOrdinal += 1) {
    if (gapOrdinal === 0) sequence.push({ kind: 'station', stationOrdinal: 0 });
    for (const roomPlacement of selectedState.options[gapOrdinal].roomPlacements) {
      sequence.push({ kind: 'room', ...roomPlacement });
    }
    sequence.push({ kind: 'station', stationOrdinal: gapOrdinal + 1 });
  }
  const stationNodeIndexByOrdinal = new Map();
  const roomNodeIndexByOrdinal = new Map();
  const centers = [];
  const anchorEndpointOrdinals = [];
  const nodeFacings = [];
  const placementOutwardFacings = [];
  for (const item of sequence) {
    const nodeIndex = centers.length;
    if (item.kind === 'station') {
      stationNodeIndexByOrdinal.set(item.stationOrdinal, nodeIndex);
      centers.push(cloneDungeonAugmentationValue(outerPoints[item.stationOrdinal]));
      anchorEndpointOrdinals.push(item.stationOrdinal);
      nodeFacings.push(cloneDungeonAugmentationValue(endpoints[item.stationOrdinal].facing));
      placementOutwardFacings.push(
        cloneDungeonAugmentationValue(endpoints[item.stationOrdinal].facing),
      );
      continue;
    }
    roomNodeIndexByOrdinal.set(item.roomOrdinal, nodeIndex);
    centers.push(cloneDungeonAugmentationValue(item.center));
    anchorEndpointOrdinals.push(null);
    nodeFacings.push(cloneDungeonAugmentationValue(item.facing));
    const owningGap = selectedState.options.find(({ roomPlacements }) => (
      roomPlacements.some(({ roomOrdinal }) => roomOrdinal === item.roomOrdinal)
    ));
    const gapMidpoint = {
      x: (Number(outerPoints[owningGap.gapOrdinal].x)
        + Number(outerPoints[owningGap.gapOrdinal + 1].x)) * 0.5,
      y: Number(item.center.y),
      z: (Number(outerPoints[owningGap.gapOrdinal].z)
        + Number(outerPoints[owningGap.gapOrdinal + 1].z)) * 0.5,
    };
    const outwardDelta = {
      x: Number(item.center.x) - gapMidpoint.x,
      z: Number(item.center.z) - gapMidpoint.z,
    };
    placementOutwardFacings.push(
      Math.hypot(outwardDelta.x, outwardDelta.z) > 1e-6
        ? toDungeonCardinalFacing(outwardDelta)
        : cloneDungeonAugmentationValue(item.facing),
    );
  }
  const requiredSocketBindings = [];
  for (const option of selectedState.options) {
    const fromStationNodeIndex = stationNodeIndexByOrdinal.get(option.gapOrdinal);
    const toStationNodeIndex = stationNodeIndexByOrdinal.get(option.gapOrdinal + 1);
    const roomNodeIndices = option.roomPlacements.map(({ roomOrdinal }) => (
      roomNodeIndexByOrdinal.get(roomOrdinal)
    ));
    if (roomNodeIndices.length === 0) {
      requiredSocketBindings.push({
        fromIndex: fromStationNodeIndex,
        toIndex: toStationNodeIndex,
        fromLocalSocketId: option.fromLocalSocketId,
        toLocalSocketId: option.toLocalSocketId,
      });
      continue;
    }
    requiredSocketBindings.push({
      fromIndex: fromStationNodeIndex,
      toIndex: roomNodeIndices[0],
      fromLocalSocketId: option.fromLocalSocketId,
      toLocalSocketId: 'entry',
    });
    for (let roomIndex = 1; roomIndex < roomNodeIndices.length; roomIndex += 1) {
      requiredSocketBindings.push({
        fromIndex: roomNodeIndices[roomIndex - 1],
        toIndex: roomNodeIndices[roomIndex],
        fromLocalSocketId: 'exit',
        toLocalSocketId: 'entry',
      });
    }
    requiredSocketBindings.push({
      fromIndex: roomNodeIndices.at(-1),
      toIndex: toStationNodeIndex,
      fromLocalSocketId: 'exit',
      toLocalSocketId: option.toLocalSocketId,
    });
  }
  setDiagnostics('composed', {
    stateCount: states.length,
    gapOptionCounts: gapOptions.map((candidates) => candidates.length),
    selectedStateIndex,
  });
  return {
    centers,
    endpointNodeIndices: outerPoints.map((_, stationOrdinal) => (
      stationNodeIndexByOrdinal.get(stationOrdinal)
    )),
    anchorEndpointOrdinals,
    nodeFacings,
    placementOutwardFacings,
    requiredSocketBindings,
    externalRoutePaths: selectedState.options.map(({ routePath }) => (
      cloneDungeonAugmentationValue(routePath)
    )),
  };
}

function expandCoveragePlacement(
  outerPoints,
  moduleCount,
  preferXFirst,
  endpoints = [],
  minimumInteriorSpacingMeters = 0,
  minimumExteriorTurnMeters = 0,
  options = {},
) {
  const coverageChainSocketBindings = (nodeCount, endpointNodeIndices) => {
    const endpointIndexSet = new Set(endpointNodeIndices);
    return (
    Array.from({ length: Math.max(0, nodeCount - 1) }, (_, fromIndex) => ({
      fromIndex,
      toIndex: fromIndex + 1,
      // Exact connector stations reserve `entry` for their parent gallery, but
      // may dispatch the supplement through any of their three physical arms.
      // Interior authored modules have a strict entry -> exit traversal.
      fromLocalSocketId: endpointIndexSet.has(fromIndex) ? null : 'exit',
      toLocalSocketId: endpointIndexSet.has(fromIndex + 1) ? null : 'entry',
    }))
    );
  };
  const continuationCenterForEndpoint = (endpoint, fallback) => {
    const continuation = endpoint?.planningContinuationCenter;
    return Number.isFinite(Number(continuation?.x))
      && Number.isFinite(Number(continuation?.z))
      ? {
        x: Number(continuation.x),
        y: Number(fallback.y),
        z: Number(continuation.z),
      }
      : fallback;
  };
  if (outerPoints.length < 2 || moduleCount <= outerPoints.length) {
    return {
      centers: outerPoints.map((point) => cloneDungeonAugmentationValue(point)),
      endpointNodeIndices: outerPoints.map((_, index) => index),
      anchorEndpointOrdinals: outerPoints.map((_, index) => index),
    };
  }
  if (options.objectiveExternalPath === true
    && moduleCount >= outerPoints.length + 2) {
    const externalPlacement = objectiveCoverageExternalPlacement(
      outerPoints,
      endpoints,
      options,
    );
    if (externalPlacement) return externalPlacement;
  }
  if (outerPoints.length === 2) {
    const facingDot = Number(endpoints[0]?.facing?.x ?? 0)
        * Number(endpoints[1]?.facing?.x ?? 0)
      + Number(endpoints[0]?.facing?.z ?? 0)
        * Number(endpoints[1]?.facing?.z ?? 0);
    if (facingDot > 0.5) {
      const outward = toDungeonFacing({
        x: Number(endpoints[0].facing.x) + Number(endpoints[1].facing.x),
        z: Number(endpoints[0].facing.z) + Number(endpoints[1].facing.z),
      });
      const firstLead = continuationCenterForEndpoint(
        endpoints[0],
        addDungeonPoints(
          outerPoints[0],
          scaleDungeonPoint(outward, 25.2),
        ),
      );
      const secondLead = continuationCenterForEndpoint(
        endpoints[1],
        addDungeonPoints(
          outerPoints[1],
          scaleDungeonPoint(outward, 25.2),
        ),
      );
      const path = normalizedRoutePath([
        outerPoints[0],
        firstLead,
        secondLead,
        outerPoints[1],
      ]);
      const interiorCount = moduleCount - 2;
      const leadPath = normalizedRoutePath([firstLead, secondLead]);
      const interiorCenters = interiorCount === 1
        ? [samplePolylineByFraction(path, 0.5)]
        : [
          firstLead,
          ...Array.from({ length: Math.max(0, interiorCount - 2) }, (_, index) => (
            samplePolylineByFraction(leadPath, (index + 1) / (interiorCount - 1))
          )),
          secondLead,
        ];
      const interiorAnchorEndpointOrdinals = interiorCount === 1
        ? [null]
        : [
          0,
          ...Array.from({ length: Math.max(0, interiorCount - 2) }, () => null),
          1,
        ];
      return {
        centers: [
          cloneDungeonAugmentationValue(outerPoints[0]),
          ...interiorCenters,
          cloneDungeonAugmentationValue(outerPoints[1]),
        ],
        endpointNodeIndices: [0, moduleCount - 1],
        anchorEndpointOrdinals: [0, ...interiorAnchorEndpointOrdinals, 1],
        requiredSocketBindings: coverageChainSocketBindings(
          moduleCount,
          [0, moduleCount - 1],
        ),
      };
    }
  }
  if (outerPoints.length > 2
    && moduleCount === outerPoints.length + 2
    && Math.abs(Math.trunc(Number(options.searchVariant) || 0)) % 2 === 0) {
    // Keep one deterministic retry family for the compact terminal-branch
    // layout. Some dense authored corridors have exact neighboring stations
    // close enough to form the external spine directly; placing challenge and
    // payoff rooms on the two continuation arms then clears geometry that an
    // interleaved room cannot occupy. Other retries use the alternating chain
    // below, so long station gaps still receive substantive modules.
    const terminalLead = (endpointOrdinal) => continuationCenterForEndpoint(
      endpoints[endpointOrdinal],
      addDungeonPoints(
        outerPoints[endpointOrdinal],
        scaleDungeonPoint(
          endpoints[endpointOrdinal]?.facing,
          Math.max(25.2, Number(minimumInteriorSpacingMeters)),
        ),
      ),
    );
    return {
      centers: [
        terminalLead(0),
        ...outerPoints.map((point) => cloneDungeonAugmentationValue(point)),
        terminalLead(outerPoints.length - 1),
      ],
      endpointNodeIndices: outerPoints.map((_, index) => index + 1),
      anchorEndpointOrdinals: [
        0,
        ...outerPoints.map((_, index) => index),
        outerPoints.length - 1,
      ],
    };
  }
  const insertionCounts = Array.from({ length: outerPoints.length - 1 }, () => 0);
  const horizontalDistance = (from, to) => (
    Math.abs(Number(to.x) - Number(from.x)) + Math.abs(Number(to.z) - Number(from.z))
  );
  const interiorModuleCount = moduleCount - outerPoints.length;
  // When the budget can cover every station interval, seed one authored room
  // into each gap before assigning the remaining rooms by span. Piling all
  // rooms into the longest first gap strands a later branch-entry T beside
  // the parent gallery: its two supplemental arms have nothing aligned with
  // them, while the preceding straight-through room is forced to U-turn back
  // through protected host geometry. One-per-gap gives the global solver the
  // intended station -> room -> station topology without changing the module
  // budget or inventing an overlap exception.
  const seededGapCount = interiorModuleCount >= insertionCounts.length
    ? insertionCounts.length
    : 0;
  for (let gap = 0; gap < seededGapCount; gap += 1) insertionCounts[gap] = 1;
  for (let extra = seededGapCount; extra < interiorModuleCount; extra += 1) {
    let selectedGap = 0;
    let selectedSpan = -Infinity;
    const hasParallelSeededGap = seededGapCount > 0 && insertionCounts.some((_, gap) => {
      const facingDot = Number(endpoints[gap]?.facing?.x ?? 0)
          * Number(endpoints[gap + 1]?.facing?.x ?? 0)
        + Number(endpoints[gap]?.facing?.z ?? 0)
          * Number(endpoints[gap + 1]?.facing?.z ?? 0);
      return facingDot > 0.5;
    });
    for (let gap = 0; gap < insertionCounts.length; gap += 1) {
      const facingDot = Number(endpoints[gap]?.facing?.x ?? 0)
          * Number(endpoints[gap + 1]?.facing?.x ?? 0)
        + Number(endpoints[gap]?.facing?.z ?? 0)
          * Number(endpoints[gap + 1]?.facing?.z ?? 0);
      // Once every station interval has content, place an additional room on
      // a parallel-facing pair when available. Those endpoints share a clean
      // outward lane for a rise/return pair; doubling a bent interval forces
      // consecutive large room exits to meet at an unusable diagonal elbow.
      if (hasParallelSeededGap && facingDot <= 0.5) continue;
      const bendWeight = Math.abs(facingDot) < 0.5 ? 1.5 : 1;
      const dividedSpan = horizontalDistance(outerPoints[gap], outerPoints[gap + 1])
        / (insertionCounts[gap] + 1) * bendWeight;
      if (dividedSpan > selectedSpan + 1e-6) {
        selectedGap = gap;
        selectedSpan = dividedSpan;
      }
    }
    insertionCounts[selectedGap] += 1;
  }
  const centers = [];
  const endpointNodeIndices = [];
  const anchorEndpointOrdinals = [];
  for (let gap = 0; gap < outerPoints.length - 1; gap += 1) {
    if (gap === 0) {
      endpointNodeIndices.push(0);
      centers.push(cloneDungeonAugmentationValue(outerPoints[0]));
      anchorEndpointOrdinals.push(0);
    }
    const preferredXFirst = (gap % 2 === 0) === preferXFirst;
    // Nine grid cells place a 7x7 content room beyond the compact 5x7 station
    // with the profile's two-tile connector gap. The Industrial host reserves
    // this exact continuation witness while choosing each corridor side.
    const outwardLeadMeters = 25.2;
    const fromLead = continuationCenterForEndpoint(
      endpoints[gap],
      addDungeonPoints(
        outerPoints[gap],
        scaleDungeonPoint(endpoints[gap]?.facing, outwardLeadMeters),
      ),
    );
    const toLead = continuationCenterForEndpoint(
      endpoints[gap + 1],
      addDungeonPoints(
        outerPoints[gap + 1],
        scaleDungeonPoint(endpoints[gap + 1]?.facing, outwardLeadMeters),
      ),
    );
    const insertionCount = insertionCounts[gap];
    const minimumLeadLengthMeters = Math.max(0, insertionCount - 1)
      * Math.max(0, Number(minimumInteriorSpacingMeters));
    const candidateMiddlePaths = (xFirst) => {
      const directPath = orthogonalRouteSegmentPath(
        { position: fromLead },
        { position: toLead },
        xFirst,
      );
      const lengthDeficitMeters = minimumLeadLengthMeters
        - measureDungeonPolyline(directPath);
      if (lengthDeficitMeters <= 1e-6) return [directPath];
      // An exterior dogleg adds twice its offset to the Manhattan lead. Snap
      // that offset to the planner's 2.8m grid and consider both exterior
      // sides; the outward-depth score below deterministically keeps the side
      // that continues away from the authored endpoint rooms.
      const detourMeters = Math.max(2.8, Math.ceil(Math.max(
        lengthDeficitMeters * 0.5,
        Number(minimumExteriorTurnMeters),
      ) / 2.8 - 1e-6) * 2.8);
      if (xFirst) {
        const detourXs = [
          Math.min(Number(fromLead.x), Number(toLead.x)) - detourMeters,
          Math.max(Number(fromLead.x), Number(toLead.x)) + detourMeters,
        ];
        return detourXs.map((detourX) => [
          fromLead,
          { x: detourX, y: fromLead.y, z: fromLead.z },
          { x: detourX, y: fromLead.y, z: toLead.z },
          toLead,
        ]);
      }
      const detourZs = [
        Math.min(Number(fromLead.z), Number(toLead.z)) - detourMeters,
        Math.max(Number(fromLead.z), Number(toLead.z)) + detourMeters,
      ];
      return detourZs.map((detourZ) => [
        fromLead,
        { x: fromLead.x, y: fromLead.y, z: detourZ },
        { x: toLead.x, y: fromLead.y, z: detourZ },
        toLead,
      ]);
    };
    const path = [preferredXFirst, !preferredXFirst]
      .flatMap((xFirst) => candidateMiddlePaths(xFirst))
      .map((middlePath) => normalizedRoutePath([
        outerPoints[gap],
        fromLead,
        ...middlePath.slice(1, -1),
        toLead,
        outerPoints[gap + 1],
      ]))
      .map((candidate, candidateIndex) => {
        const spineInterior = candidate.slice(1, -1);
        // `candidate[1]` is the first continuation-room center, not the
        // orthogonal elbow. Scoring that point made both L routes appear
        // identical and could select the inward leg beside the authored room.
        const elbow = spineInterior.length > 2
          ? spineInterior[1]
          : samplePolylineByFraction(spineInterior, 0.5);
        const endpointPair = [endpoints[gap], endpoints[gap + 1]];
        const outwardDepths = endpointPair.map((endpoint) => (
          (Number(elbow.x) - Number(endpoint?.position?.x ?? elbow.x))
              * Number(endpoint?.facing?.x ?? 0)
            + (Number(elbow.z) - Number(endpoint?.position?.z ?? elbow.z))
              * Number(endpoint?.facing?.z ?? 0)
        ));
        const inwardPenalty = outwardDepths.reduce((sum, depth) => (
          sum + Math.max(0, -depth) ** 2
        ), 0);
        return {
          candidate,
          candidateIndex,
          inwardPenalty,
          minimumOutwardDepth: Math.min(...outwardDepths),
          totalOutwardDepth: outwardDepths.reduce((sum, depth) => sum + depth, 0),
        };
      })
      .sort((first, second) => (
        first.inwardPenalty - second.inwardPenalty
          || second.minimumOutwardDepth - first.minimumOutwardDepth
          || second.totalOutwardDepth - first.totalOutwardDepth
          || first.candidateIndex - second.candidateIndex
      ))[0].candidate;
    if (insertionCount === 1) {
      if (outerPoints.length > 2) {
        // A midpoint room in every short station interval bunches neighboring
        // envelopes around their shared T. Anchor lone rooms at alternating
        // outer-station clearance leads instead. The exact half-envelope +
        // connector spacing keeps both incident routes short while maximizing
        // separation between rooms in adjacent intervals.
        const anchorEndpointIndex = gap % 2 === 0 ? gap : gap + 1;
        const anchorFacing = toDungeonCardinalFacing(
          endpoints[anchorEndpointIndex]?.facing,
        );
        centers.push(addDungeonPoints(
          outerPoints[anchorEndpointIndex],
          scaleDungeonPoint(
            anchorFacing,
            Math.max(25.2, Number(minimumInteriorSpacingMeters)),
          ),
        ));
        anchorEndpointOrdinals.push(anchorEndpointIndex);
      } else {
        centers.push(samplePolylineByFraction(path, 0.5));
        anchorEndpointOrdinals.push(null);
      }
    } else if (insertionCount >= 2) {
      const leadPath = path.slice(1, -1);
      centers.push(cloneDungeonAugmentationValue(fromLead));
      anchorEndpointOrdinals.push(gap);
      for (let index = 1; index < insertionCount - 1; index += 1) {
        centers.push(samplePolylineByFraction(
          leadPath,
          index / (insertionCount - 1),
        ));
        anchorEndpointOrdinals.push(null);
      }
      centers.push(cloneDungeonAugmentationValue(toLead));
      anchorEndpointOrdinals.push(gap + 1);
    }
    centers.push(cloneDungeonAugmentationValue(outerPoints[gap + 1]));
    anchorEndpointOrdinals.push(gap + 1);
    endpointNodeIndices.push(centers.length - 1);
  }
  return {
    centers,
    endpointNodeIndices,
    anchorEndpointOrdinals,
    requiredSocketBindings: coverageChainSocketBindings(
      centers.length,
      endpointNodeIndices,
    ),
  };
}

function applyRouteNetworkNodeSemantics(node, {
  contentRole,
  junctionKind,
  progressionBandId,
  accessDomainId,
  elevationMode,
  moduleKind = 'room',
}) {
  const connectorModule = moduleKind === 'connector-module';
  node.kind = connectorModule ? 'supplementConnectorModule' : 'supplementRoom';
  node.nodeRole = connectorModule
    ? 'route-network-connector-module'
    : 'route-network-room';
  node.layoutRole = connectorModule
    ? 'connector-owned-route-network-traversal'
    : 'substantive-route-network-room';
  node.moduleKind = moduleKind;
  node.moduleTemplateId = node.blueprintId ?? node.grammarId;
  node.contentRole = connectorModule ? (contentRole ?? 'connector') : contentRole;
  node.connectorOwned = connectorModule;
  node.connectorInfrastructure = connectorModule;
  node.substantive = !connectorModule;
  node.countsAsSupplementRoom = !connectorModule;
  node.isSupplementConnectorModule = connectorModule;
  node.isSupplementConnectorJunction = false;
  node.countsAsMeaningfulStation = !connectorModule;
  node.progressionBandId = progressionBandId;
  node.accessDomainId = accessDomainId;
  node.elevationMode = elevationMode;
  const keepAnchor = (anchor) => {
    if (anchor.kind === 'doorway-frame' || anchor.kind === 'light-fixture') return true;
    if (connectorModule) return false;
    // A blueprint's anchors are part of its authored spatial contract (spawn
    // roles, local controls, rewards, transfers, and story fixtures). Do not
    // erase them merely because the network selected one primary semantic
    // role for budgeting.
    if (node.blueprintId) return true;
    if (contentRole === 'challenge') return anchor.kind === 'encounter';
    if (contentRole === 'reward' || contentRole === 'treasure') return anchor.kind === 'reward';
    if (contentRole === 'trap') return anchor.kind === 'trap';
    if (contentRole === 'mechanism') return anchor.kind === 'progression';
    if (contentRole === 'elevation') return anchor.kind === 'platform';
    return false;
  };
  node.anchors = node.anchors.filter(keepAnchor);
  const hasAuthoredPhysicalTransfer = Boolean(node.blueprintId)
    && (
      (node.structure?.physicalTransfers?.length ?? 0) > 0
      || (node.structure?.transfers?.length ?? 0) > 0
      || Math.abs(Number(
        node.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
      )) > 0.000001
    );
  if ((contentRole === 'elevation'
      || elevationMode !== 'level')
    && !(node.structure.platforms?.length > 0)
    && !hasAuthoredPhysicalTransfer) {
    node.structure.platforms = [{
      id: 'route-network-elevation-platform',
      role: 'catwalk',
      localCenterGrid: { x: 0, z: 1 },
      widthTiles: 3,
      depthTiles: 3,
      elevation: 2.8,
      platformPurpose: 'route-network-elevation-decision',
    }];
    node.structure.ramps = [{
      id: 'route-network-elevation-ramp',
      role: 'ramp',
      localStartGrid: { x: -2, z: -2 },
      localEndGrid: { x: -2, z: 2 },
      fromElevation: 0,
      toElevation: 2.8,
    }];
    node.structure.rails = [{
      id: 'route-network-elevation-rails',
      role: 'rail',
      platformId: 'route-network-elevation-platform',
    }];
    for (const role of ['catwalk', 'rail', 'ramp']) {
      if (!node.requiredThemeCapabilities.materials.includes(role)) {
        node.requiredThemeCapabilities.materials.push(role);
      }
    }
  }
  const entry = getNodeSocket(node, 'entry');
  const exit = getNodeSocket(node, 'exit');
  const left = getNodeSocket(node, 'left');
  const right = getNodeSocket(node, 'right');
  node.junction = {
    junctionKind,
    throughSocketPairs: entry && exit ? [[entry.id, exit.id]] : [],
    decisionSocketIds: [left?.id, right?.id].filter(Boolean),
    clearCoreVolume: {
      id: `${node.id}:junction-clear-core`,
      ownerId: node.id,
      center: {
        x: node.placement.center.x,
        y: node.placement.center.y + 2.1,
        z: node.placement.center.z,
      },
      size: { x: 8.4, y: 4.2, z: 8.4 },
      purpose: 'junction-approach-clearance',
    },
    countsAsMeaningfulStation: false,
  };
}

function connectorFamilyForElevationMode(elevationMode) {
  if (elevationMode === 'slope') return 'slope';
  if (elevationMode === 'ladder' || elevationMode === 'drop-ladder') return 'ladder';
  if (elevationMode === 'lift' || elevationMode === 'shortcut-lift') return 'lift';
  // Split-level traversal is authored inside its owning content module. When
  // that authored exit remains elevated at the next external socket, the
  // reconnect still needs a real physical transfer rather than a diagonal
  // service-gallery segment. A slope is the permanent bidirectional fallback;
  // level handoffs continue to select `service-gallery` at the call site.
  if (elevationMode === 'split-level-platform') return 'slope';
  return 'service-gallery';
}

function orthogonalRouteSegmentPath(from, to, preferXFirst) {
  const start = toDungeonPoint(from.position);
  const end = toDungeonPoint(to.position);
  if (Math.abs(start.x - end.x) <= 1e-6 || Math.abs(start.z - end.z) <= 1e-6) {
    return [start, end];
  }
  const elbow = preferXFirst
    ? { x: end.x, y: start.y, z: start.z }
    : { x: start.x, y: start.y, z: end.z };
  return [start, elbow, end];
}

const ROUTE_NETWORK_SOCKET_APPROACH_METERS = 5.6;
const ROUTE_NETWORK_CORRIDOR_WIDTH_METERS = 8.4;
const ROUTE_NETWORK_MAXIMUM_FEATURELESS_SPAN_METERS = 33.6;
const ROUTE_NETWORK_VERTICAL_MINIMUM_RUN_METERS = Object.freeze({
  slope: 36.4,
  ladder: 19.6,
  lift: 28,
});

function appendDistinctRoutePoint(points, point) {
  const candidate = toDungeonPoint(point);
  if (points.length > 0 && dungeonPointDistance(points.at(-1), candidate) <= 1e-6) return;
  if (points.length >= 2) {
    const previous = points.at(-2);
    const current = points.at(-1);
    const incoming = {
      x: Number(current.x) - Number(previous.x),
      y: Number(current.y) - Number(previous.y),
      z: Number(current.z) - Number(previous.z),
    };
    const outgoing = {
      x: Number(candidate.x) - Number(current.x),
      y: Number(candidate.y) - Number(current.y),
      z: Number(candidate.z) - Number(current.z),
    };
    const occupiedIncomingAxes = ['x', 'y', 'z'].filter((axis) => (
      Math.abs(incoming[axis]) > 1e-6
    ));
    const occupiedOutgoingAxes = ['x', 'y', 'z'].filter((axis) => (
      Math.abs(outgoing[axis]) > 1e-6
    ));
    if (occupiedIncomingAxes.length === 1
      && occupiedOutgoingAxes.length === 1
      && occupiedIncomingAxes[0] === occupiedOutgoingAxes[0]
      && incoming[occupiedIncomingAxes[0]] * outgoing[occupiedOutgoingAxes[0]] > 0) {
      // Socket-lead construction can introduce a waypoint in the middle of a
      // straight run. Preserve the route geometry canonically as one leg so
      // the non-adjacent-volume self-overlap check does not mistake a valid L
      // for a corridor folding back across itself.
      points[points.length - 1] = candidate;
      return;
    }
  }
  points.push(candidate);
}

function normalizedRoutePath(points = []) {
  const normalized = [];
  for (const point of points) appendDistinctRoutePoint(normalized, point);
  return normalized;
}

function routeSocketLead(socket, distanceMeters = ROUTE_NETWORK_SOCKET_APPROACH_METERS) {
  return addDungeonPoints(
    toDungeonPoint(socket?.position),
    scaleDungeonPoint(toDungeonFacing(socket?.facing), distanceMeters),
  );
}

function planarRouteRuns(path = []) {
  const runs = [];
  let current = null;
  let precedingLengthMeters = 0;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const deltaX = Number(end.x) - Number(start.x);
    const deltaZ = Number(end.z) - Number(start.z);
    const lengthMeters = Math.hypot(deltaX, deltaZ);
    if (lengthMeters <= 1e-6) continue;
    const axis = Math.abs(deltaX) >= Math.abs(deltaZ) ? 'x' : 'z';
    const direction = Math.sign(axis === 'x' ? deltaX : deltaZ);
    if (current && current.axis === axis && current.direction === direction
      && current.endIndex === index - 1) {
      current.endIndex = index;
      current.lengthMeters += lengthMeters;
    } else {
      if (current) {
        runs.push({ ...current });
        precedingLengthMeters += current.lengthMeters;
      }
      current = {
        axis,
        direction,
        startIndex: index - 1,
        endIndex: index,
        lengthMeters,
        precedingLengthMeters,
      };
    }
  }
  if (current) runs.push({ ...current });
  return runs;
}

function maximumContinuousLevelRouteSpan(path = []) {
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

function routePathBacktracksOrSelfOverlaps(path = []) {
  const legs = [];
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const delta = {
      x: Number(end.x) - Number(start.x),
      y: Number(end.y) - Number(start.y),
      z: Number(end.z) - Number(start.z),
    };
    if (Math.hypot(delta.x, delta.y, delta.z) <= 1e-6) continue;
    legs.push({ start, end, delta });
  }
  for (let index = 1; index < legs.length; index += 1) {
    const previous = legs[index - 1].delta;
    const current = legs[index].delta;
    const previousHorizontal = Math.hypot(previous.x, previous.z) > 1e-6;
    const currentHorizontal = Math.hypot(current.x, current.z) > 1e-6;
    if (!previousHorizontal || !currentHorizontal) continue;
    const sameAxis = (Math.abs(previous.x) > 1e-6 && Math.abs(current.x) > 1e-6)
      || (Math.abs(previous.z) > 1e-6 && Math.abs(current.z) > 1e-6);
    if (sameAxis && previous.x * current.x + previous.z * current.z < -1e-6) {
      return true;
    }
  }
  const volumes = routePathPlanningVolumes(path);
  for (let first = 0; first < volumes.length; first += 1) {
    for (let second = first + 2; second < volumes.length; second += 1) {
      if (planningVolumesOverlap(volumes[first], volumes[second])) return true;
    }
  }
  return false;
}

function routePathsWithVerticalTransfer(path, destinationElevation, connectorFamily) {
  if (path.length < 2) return [];
  const sourceElevation = Number(path[0].y);
  const targetElevation = Number(destinationElevation);
  if (Math.abs(targetElevation - sourceElevation) <= 1e-6) {
    return [path.map((point) => ({ ...point, y: sourceElevation }))];
  }
  const minimumRunMeters = ROUTE_NETWORK_VERTICAL_MINIMUM_RUN_METERS[connectorFamily];
  if (!Number.isFinite(minimumRunMeters)) return [];
  const totalPlanarLengthMeters = measureDungeonPolyline(path);
  const candidates = planarRouteRuns(path)
    .filter(({ lengthMeters }) => lengthMeters >= minimumRunMeters - 1e-6)
    .flatMap((run, runOrdinal) => {
      const minimumTransferDistance = ROUTE_NETWORK_SOCKET_APPROACH_METERS;
      const maximumTransferDistance = run.lengthMeters
        - ROUTE_NETWORK_SOCKET_APPROACH_METERS;
      if (maximumTransferDistance < minimumTransferDistance - 1e-6) return [];
      const idealTransferDistance = totalPlanarLengthMeters * 0.5
        - run.precedingLengthMeters;
      const minimumTransferTile = Math.ceil(minimumTransferDistance / 2.8 - 1e-6);
      const maximumTransferTile = Math.floor(maximumTransferDistance / 2.8 + 1e-6);
      if (maximumTransferTile < minimumTransferTile) return [];
      const featurelessMinimumTransferTile = Math.ceil((
        totalPlanarLengthMeters
          - ROUTE_NETWORK_MAXIMUM_FEATURELESS_SPAN_METERS
          - run.precedingLengthMeters
      ) / 2.8 - 1e-6);
      const featurelessMaximumTransferTile = Math.floor((
        ROUTE_NETWORK_MAXIMUM_FEATURELESS_SPAN_METERS
          - run.precedingLengthMeters
      ) / 2.8 + 1e-6);
      const legalMinimumTransferTile = Math.max(
        minimumTransferTile,
        featurelessMinimumTransferTile,
      );
      const legalMaximumTransferTile = Math.min(
        maximumTransferTile,
        featurelessMaximumTransferTile,
      );
      if (legalMaximumTransferTile < legalMinimumTransferTile) return [];
      const idealTransferTile = Math.max(
        legalMinimumTransferTile,
        Math.min(
          legalMaximumTransferTile,
          Math.round(idealTransferDistance / 2.8),
        ),
      );
      // The midpoint is normally best, while the two legal extremes let the
      // deterministic physical solver move a lift/ladder/slope off an authored
      // obstacle. Enumerating every tile multiplied route/self-overlap work
      // without adding a distinct topological choice.
      const transferTiles = [...new Set([
        idealTransferTile,
        legalMinimumTransferTile,
        legalMaximumTransferTile,
      ])];
      return transferTiles.map((transferTile) => {
        const transferDistance = transferTile * 2.8;
        const horizontalBeforeMeters = run.precedingLengthMeters + transferDistance;
        const horizontalAfterMeters = totalPlanarLengthMeters - horizontalBeforeMeters;
        const runStart = path[run.startIndex];
        const runEnd = path[run.endIndex];
        const ratio = run.lengthMeters > 1e-6 ? transferDistance / run.lengthMeters : 0.5;
        const transferPoint = {
          x: Number(runStart.x) + (Number(runEnd.x) - Number(runStart.x)) * ratio,
          y: sourceElevation,
          z: Number(runStart.z) + (Number(runEnd.z) - Number(runStart.z)) * ratio,
        };
        const result = [];
        for (let index = 0; index <= run.startIndex; index += 1) {
          appendDistinctRoutePoint(result, { ...path[index], y: sourceElevation });
        }
        appendDistinctRoutePoint(result, transferPoint);
        appendDistinctRoutePoint(result, { ...transferPoint, y: targetElevation });
        for (let index = run.endIndex; index < path.length; index += 1) {
          appendDistinctRoutePoint(result, { ...path[index], y: targetElevation });
        }
        return {
          path: result,
          runOrdinal,
          transferTile,
          maximumHorizontalSpanMeters: Math.max(
            horizontalBeforeMeters,
            horizontalAfterMeters,
          ),
          midpointImbalanceMeters: Math.abs(horizontalBeforeMeters - horizontalAfterMeters),
          idealTransferDeltaMeters: Math.abs(transferDistance - idealTransferDistance),
        };
      });
    })
    .sort((first, second) => (
      first.maximumHorizontalSpanMeters - second.maximumHorizontalSpanMeters
        || first.midpointImbalanceMeters - second.midpointImbalanceMeters
        || first.idealTransferDeltaMeters - second.idealTransferDeltaMeters
        || first.runOrdinal - second.runOrdinal
        || first.transferTile - second.transferTile
    ));
  return candidates.map((candidate) => candidate.path);
}

function facingAwareSocketRouteCandidates(from, to, {
  preferXFirst = true,
  connectorFamily = 'service-gallery',
  sourceApproachMeters = [ROUTE_NETWORK_SOCKET_APPROACH_METERS],
  destinationApproachMeters = [ROUTE_NETWORK_SOCKET_APPROACH_METERS],
  // Include the five-tile offset: on a 33.6 m featureless budget it is the
  // exact dogleg that fits a complete 7-tile ladder run between two compact
  // junction sockets without folding the two 8.4 m-wide legs together.
  detourOffsetsMeters = [8.4, 14, 16.8, 25.2, 33.6],
  minimumApproachMeters = ROUTE_NETWORK_SOCKET_APPROACH_METERS,
} = {}) {
  const start = toDungeonPoint(from?.position);
  const end = toDungeonPoint(to?.position);
  const fromFacing = toDungeonFacing(from?.facing);
  const toFacing = toDungeonFacing(to?.facing);
  const results = [];
  const seen = new Set();
  const registerPlanarPath = (rawPath) => {
    const planarPath = normalizedRoutePath(rawPath.map((point) => ({
      ...point,
      y: start.y,
    })));
    if (planarPath.length < 2) return;
    const firstDelta = {
      x: planarPath[1].x - planarPath[0].x,
      z: planarPath[1].z - planarPath[0].z,
    };
    const lastDelta = {
      x: planarPath.at(-1).x - planarPath.at(-2).x,
      z: planarPath.at(-1).z - planarPath.at(-2).z,
    };
    if (firstDelta.x * fromFacing.x + firstDelta.z * fromFacing.z
        < minimumApproachMeters - 1e-6
      || -(lastDelta.x * toFacing.x + lastDelta.z * toFacing.z)
        < minimumApproachMeters - 1e-6) return;
    for (const path of routePathsWithVerticalTransfer(
      planarPath,
      end.y,
      connectorFamily,
    )) {
      if (measureDungeonPolyline(path) <= 1e-6
        || routePathBacktracksOrSelfOverlaps(path)) continue;
      const signature = path.map((point) => (
        `${point.x.toFixed(4)},${point.y.toFixed(4)},${point.z.toFixed(4)}`
      )).join('|');
      if (seen.has(signature)) continue;
      seen.add(signature);
      results.push(path);
    }
  };
  // Opposing sockets may share the same two-tile flat vestibule. Prefer that
  // monotonic threshold over adding two overlapping approach stubs which
  // backtrack through each other during materialization.
  if (Math.abs(start.x - end.x) <= 1e-6 || Math.abs(start.z - end.z) <= 1e-6) {
    registerPlanarPath([start, end]);
  }
  for (const fromApproach of sourceApproachMeters) {
    for (const toApproach of destinationApproachMeters) {
      const fromLead = routeSocketLead(from, fromApproach);
      const toLead = routeSocketLead(to, toApproach);
      const middleCandidates = [
        orthogonalRouteSegmentPath(
          { position: fromLead },
          { position: toLead },
          preferXFirst,
        ),
        orthogonalRouteSegmentPath(
          { position: fromLead },
          { position: toLead },
          !preferXFirst,
        ),
      ];
      for (const offset of detourOffsetsMeters) {
        for (const detourX of [
          Math.min(fromLead.x, toLead.x) - offset,
          Math.max(fromLead.x, toLead.x) + offset,
        ]) {
          middleCandidates.push([
            fromLead,
            { x: detourX, y: fromLead.y, z: fromLead.z },
            { x: detourX, y: fromLead.y, z: toLead.z },
            toLead,
          ]);
        }
        for (const detourZ of [
          Math.min(fromLead.z, toLead.z) - offset,
          Math.max(fromLead.z, toLead.z) + offset,
        ]) {
          middleCandidates.push([
            fromLead,
            { x: fromLead.x, y: fromLead.y, z: detourZ },
            { x: toLead.x, y: fromLead.y, z: detourZ },
            toLead,
          ]);
        }
      }
      for (const middle of middleCandidates) {
        registerPlanarPath([
          start,
          fromLead,
          ...middle.slice(1, -1),
          toLead,
          end,
        ]);
      }
      const facingDot = fromFacing.x * toFacing.x + fromFacing.z * toFacing.z;
      if (facingDot > 0.5) {
        // Same-facing sockets need a true expanded U when both parallel legs
        // contain authored rooms.  A simple rectangle fixes those legs at the
        // host apertures' separation, which can be narrower than the combined
        // room half-depths even though there is ample free space outward.
        const tangent = { x: -fromFacing.z, y: 0, z: fromFacing.x };
        const relativeTangent = (end.x - start.x) * tangent.x
          + (end.z - start.z) * tangent.z;
        const sourceSide = relativeTangent >= 0 ? -1 : 1;
        const maximumOfferedDetour = Math.max(0, ...detourOffsetsMeters);
        const lateralSpreads = [
          8.4, 14, 16.8, 19.6, 22.4, 25.2, 28, 30.8, 33.6,
        ]
          .filter((spread) => spread <= maximumOfferedDetour + 1e-6);
        // Close parallel stations need a shallow U with its authored room on
        // the widened crossbar; forcing a 42 m minimum on both legs makes that
        // otherwise legal path exceed the two permitted featureless intervals.
        // Longer runs remain available when multiple rooms occupy the legs.
        const outwardRuns = [
          8.4, 11.2, 14, 16.8, 25.2, 33.6, 42, 50.4, 58.8, 67.2,
        ]
          .filter((distance) => distance <= maximumOfferedDetour + 1e-6);
        for (const lateralSpread of lateralSpreads) {
          const routeOrderSign = relativeTangent >= 0 ? 1 : -1;
          const balancedNearShift = Math.floor(
            lateralSpread * 0.5 / 2.8,
          ) * 2.8;
          const balancedFarShift = lateralSpread - balancedNearShift;
          const shiftPairs = [
            [sourceSide * lateralSpread, -sourceSide * lateralSpread],
            [
              -routeOrderSign * balancedNearShift,
              routeOrderSign * balancedFarShift,
            ],
            [
              -routeOrderSign * balancedFarShift,
              routeOrderSign * balancedNearShift,
            ],
            [0, routeOrderSign * lateralSpread],
            [-routeOrderSign * lateralSpread, 0],
            [routeOrderSign * lateralSpread, routeOrderSign * lateralSpread * 3],
            [-routeOrderSign * lateralSpread * 3, -routeOrderSign * lateralSpread],
          ].filter(([fromShift, toShift]) => (
            Math.max(Math.abs(fromShift), Math.abs(toShift))
              <= maximumOfferedDetour + 1e-6
          ));
          for (const [fromShift, toShift] of shiftPairs) {
            const fromSpreadLead = addDungeonPoints(
              fromLead,
              scaleDungeonPoint(tangent, fromShift),
            );
            const toSpreadLead = addDungeonPoints(
              toLead,
              scaleDungeonPoint(tangent, toShift),
            );
            for (const outwardRun of outwardRuns) {
              registerPlanarPath([
                start,
                fromLead,
                fromSpreadLead,
                addDungeonPoints(
                  fromSpreadLead,
                  scaleDungeonPoint(fromFacing, outwardRun),
                ),
                addDungeonPoints(
                  toSpreadLead,
                  scaleDungeonPoint(fromFacing, outwardRun),
                ),
                toSpreadLead,
                toLead,
                end,
              ]);
            }
          }
        }
      }
    }
  }
  return results;
}

function parentAttachmentRouteSegmentPath(
  from,
  to,
  preferXFirst,
  connectorFamily = 'service-gallery',
  minimumApproachMeters = ROUTE_NETWORK_SOCKET_APPROACH_METERS,
) {
  return facingAwareSocketRouteCandidates(from, to, {
    preferXFirst,
    connectorFamily,
    sourceApproachMeters: [minimumApproachMeters],
    destinationApproachMeters: [minimumApproachMeters],
    minimumApproachMeters,
  }).sort((first, second) => (
    measureDungeonPolyline(first) - measureDungeonPolyline(second)
  ))[0] ?? [];
}

function planningVolumesOverlap(first, second) {
  if (!first?.center || !first?.size || !second?.center || !second?.size) return false;
  return ['x', 'y', 'z'].every((axis) => (
    Math.abs(Number(first.center[axis]) - Number(second.center[axis]))
      < (Number(first.size[axis]) + Number(second.size[axis])) * 0.5 - 1e-6
  ));
}

function planningVolumeOwnedBy(volume, ownerId) {
  const actual = String(volume?.ownerId ?? '');
  const volumeId = String(volume?.id ?? '');
  const expected = String(ownerId ?? '');
  return Boolean(expected && (
    actual === expected
      || actual.startsWith(`${expected}:`)
      || volumeId === expected
      || volumeId.startsWith(`${expected}:`)
  ));
}

function planningVolumeOwnedByAny(volume, ownerIds) {
  return [...ownerIds].some((ownerId) => planningVolumeOwnedBy(volume, ownerId));
}

function createPlanningVolumeSpatialLookup(volumes, cellMeters = 8.4) {
  const buckets = new Map();
  const unindexed = [];
  const boundsFor = (volume) => {
    const halfX = Number(volume?.size?.x ?? 0) * 0.5;
    const halfZ = Number(volume?.size?.z ?? 0) * 0.5;
    return {
      minimumX: Math.floor((Number(volume?.center?.x ?? 0) - halfX) / cellMeters),
      maximumX: Math.floor((Number(volume?.center?.x ?? 0) + halfX) / cellMeters),
      minimumZ: Math.floor((Number(volume?.center?.z ?? 0) - halfZ) / cellMeters),
      maximumZ: Math.floor((Number(volume?.center?.z ?? 0) + halfZ) / cellMeters),
    };
  };
  const keyFor = (x, z) => `${x}:${z}`;
  for (const volume of volumes) {
    const bounds = boundsFor(volume);
    const bucketCount = (bounds.maximumX - bounds.minimumX + 1)
      * (bounds.maximumZ - bounds.minimumZ + 1);
    if (!Number.isFinite(bucketCount) || bucketCount > 4096) {
      unindexed.push(volume);
      continue;
    }
    for (let x = bounds.minimumX; x <= bounds.maximumX; x += 1) {
      for (let z = bounds.minimumZ; z <= bounds.maximumZ; z += 1) {
        const key = keyFor(x, z);
        const bucket = buckets.get(key) ?? [];
        bucket.push(volume);
        buckets.set(key, bucket);
      }
    }
  }
  return (queryVolume) => {
    const bounds = boundsFor(queryVolume);
    const nearby = new Set(unindexed);
    for (let x = bounds.minimumX; x <= bounds.maximumX; x += 1) {
      for (let z = bounds.minimumZ; z <= bounds.maximumZ; z += 1) {
        for (const volume of buckets.get(keyFor(x, z)) ?? []) nearby.add(volume);
      }
    }
    return nearby;
  };
}

function planningOverlapIsGranted(first, second, overlapGrants = []) {
  const applicableGrants = overlapGrants.filter((grant) => (
    !grant?.parentOwnerId || [first, second].some((volume) => (
      [volume?.ownerId, volume?.logicalConnectionId, volume?.physicalConnectionId]
        .some((ownerId) => String(ownerId ?? '') === String(grant.parentOwnerId))
    ))
  ));
  return dungeonVolumeOverlapWithinGrants(first, second, applicableGrants);
}

function isGrantedParentGalleryThresholdVolume(volume, landingOverlapGrant) {
  if (!landingOverlapGrant || !planningVolumesOverlap(volume, landingOverlapGrant)) return false;
  const purpose = String(volume?.purpose ?? '');
  const eligiblePurpose = purpose === 'industrial-authored-gallery-footprint-column'
    || purpose === 'industrial-single-owner-xz-connector-column'
    || purpose === 'base-connection-camera-clearance'
    || purpose === 'base-connection-occupied';
  if (!eligiblePurpose) return false;
  if (landingOverlapGrant.parentOwnerId && ![
    volume?.ownerId,
    volume?.logicalConnectionId,
    volume?.physicalConnectionId,
  ].some((ownerId) => (
    String(ownerId ?? '') === String(landingOverlapGrant.parentOwnerId)
  ))) return false;
  // An overlap grant is a doorway-sized exception, not permission to ignore a
  // whole connection proxy merely because that proxy touches the doorway.
  // Vertical footprint columns intentionally exceed the landing's height, so
  // containment is evaluated only in the planning plane.
  return ['x', 'z'].every((axis) => {
    const volumeHalfSize = Number(volume.size?.[axis] ?? 0) * 0.5;
    const grantHalfSize = Number(landingOverlapGrant.size?.[axis] ?? 0) * 0.5;
    const volumeMinimum = Number(volume.center?.[axis] ?? 0) - volumeHalfSize;
    const volumeMaximum = Number(volume.center?.[axis] ?? 0) + volumeHalfSize;
    const grantMinimum = Number(landingOverlapGrant.center?.[axis] ?? 0) - grantHalfSize;
    const grantMaximum = Number(landingOverlapGrant.center?.[axis] ?? 0) + grantHalfSize;
    return volumeMinimum >= grantMinimum - 1e-6
      && volumeMaximum <= grantMaximum + 1e-6;
  });
}

function nodePlanningCollisionScore(node, avoidanceVolumes) {
  const volumes = [...(node.occupiedVolumes ?? []), ...(node.clearanceVolumes ?? [])];
  return volumes.reduce((score, volume) => (
    score + avoidanceVolumes.reduce((count, obstacle) => (
      count + (planningVolumesOverlap(volume, obstacle) ? 1 : 0)
    ), 0)
  ), 0);
}

function nodePlanningCollisionIds(node, avoidanceVolumes) {
  const volumes = [...(node.occupiedVolumes ?? []), ...(node.clearanceVolumes ?? [])];
  return [...new Set(avoidanceVolumes.filter((obstacle) => (
    volumes.some((volume) => planningVolumesOverlap(volume, obstacle))
  )).map((obstacle) => String(obstacle.id ?? obstacle.ownerId ?? 'unknown')))];
}

function routePathPlanningVolumes(path, heightMeters = 5.6) {
  const widthMeters = ROUTE_NETWORK_CORRIDOR_WIDTH_METERS;
  return path.slice(1).map((end, index) => {
    const start = path[index];
    const deltaX = Number(end.x) - Number(start.x);
    const deltaY = Number(end.y) - Number(start.y);
    const deltaZ = Number(end.z) - Number(start.z);
    const horizontalLength = Math.hypot(deltaX, deltaZ);
    if (horizontalLength <= 1e-6 && Math.abs(deltaY) <= 1e-6) return null;
    const directionX = horizontalLength > 1e-6 ? deltaX / horizontalLength : 0;
    const directionZ = horizontalLength > 1e-6 ? deltaZ / horizontalLength : 0;
    return {
      center: {
        x: (Number(start.x) + Number(end.x)) * 0.5,
        y: Math.min(Number(start.y), Number(end.y))
          + (heightMeters + Math.abs(deltaY)) * 0.5,
        z: (Number(start.z) + Number(end.z)) * 0.5,
      },
      size: {
        x: horizontalLength > 1e-6
          ? Math.abs(deltaX) + widthMeters * Math.abs(directionZ)
          : widthMeters,
        y: heightMeters + Math.abs(deltaY),
        z: horizontalLength > 1e-6
          ? Math.abs(deltaZ) + widthMeters * Math.abs(directionX)
          : widthMeters,
      },
    };
  }).filter(Boolean);
}

function pathPlanningCollisionScore(
  path,
  avoidanceVolumes,
  heightMeters = 5.6,
  overlapGrants = [],
) {
  return routePathPlanningVolumes(path, heightMeters).reduce((score, volume) => (
    score + avoidanceVolumes.reduce((count, obstacle) => (
      count + (planningVolumesOverlap(volume, obstacle)
        && !planningOverlapIsGranted(volume, obstacle, overlapGrants) ? 1 : 0)
    ), 0)
  ), 0);
}

function pathPlanningCollisionIds(
  path,
  avoidanceVolumes,
  heightMeters = 5.6,
  overlapGrants = [],
) {
  const pathVolumes = routePathPlanningVolumes(path, heightMeters);
  return [...new Set(avoidanceVolumes.filter((obstacle) => (
    pathVolumes.some((volume) => (
      planningVolumesOverlap(volume, obstacle)
        && !planningOverlapIsGranted(volume, obstacle, overlapGrants)
    ))
  )).map((obstacle) => String(obstacle.id ?? obstacle.ownerId ?? 'unknown')))];
}

function collisionAvoidingOrthogonalPath(from, to, avoidanceVolumes, preferXFirst) {
  const start = toDungeonPoint(from.position);
  const end = toDungeonPoint(to.position);
  const searchMargin = 33.6 + 4.2;
  const minimumX = Math.min(start.x, end.x) - searchMargin;
  const maximumX = Math.max(start.x, end.x) + searchMargin;
  const minimumZ = Math.min(start.z, end.z) - searchMargin;
  const maximumZ = Math.max(start.z, end.z) + searchMargin;
  const relevantAvoidanceVolumes = avoidanceVolumes.filter((volume) => (
    Number(volume?.center?.x ?? 0) + Number(volume?.size?.x ?? 0) * 0.5 > minimumX
      && Number(volume?.center?.x ?? 0) - Number(volume?.size?.x ?? 0) * 0.5 < maximumX
      && Number(volume?.center?.z ?? 0) + Number(volume?.size?.z ?? 0) * 0.5 > minimumZ
      && Number(volume?.center?.z ?? 0) - Number(volume?.size?.z ?? 0) * 0.5 < maximumZ
  ));
  const candidates = [
    orthogonalRouteSegmentPath(from, to, preferXFirst),
    orthogonalRouteSegmentPath(from, to, !preferXFirst),
  ];
  // Two simple elbows are insufficient in a dense authored layout: both can
  // cross the same room/gallery even though a short three-elbow dogleg exists
  // around it. Search a bounded, tile-aligned ring around the endpoint box.
  for (const offset of [8.4, 16.8, 25.2, 33.6]) {
    for (const detourX of [
      Math.min(start.x, end.x) - offset,
      Math.max(start.x, end.x) + offset,
    ]) {
      candidates.push([
        start,
        { x: detourX, y: start.y, z: start.z },
        { x: detourX, y: start.y, z: end.z },
        end,
      ]);
    }
    for (const detourZ of [
      Math.min(start.z, end.z) - offset,
      Math.max(start.z, end.z) + offset,
    ]) {
      candidates.push([
        start,
        { x: start.x, y: start.y, z: detourZ },
        { x: end.x, y: start.y, z: detourZ },
        end,
      ]);
    }
  }
  const orderedCandidates = candidates.map((path, ordinal) => ({
    path,
    ordinal,
    lengthMeters: measureDungeonPolyline(path),
  })).sort((first, second) => (
    first.lengthMeters - second.lengthMeters
      || first.ordinal - second.ordinal
  ));
  let bestBlocked = null;
  for (const candidate of orderedCandidates) {
    const collisionScore = pathPlanningCollisionScore(
      candidate.path,
      relevantAvoidanceVolumes,
    );
    // Candidates are length-ordered, so the first clear path is the same
    // shortest zero-collision path selected by the former full score/sort.
    if (collisionScore === 0) return candidate.path;
    if (!bestBlocked
      || collisionScore < bestBlocked.collisionScore
      || (collisionScore === bestBlocked.collisionScore
        && candidate.lengthMeters < bestBlocked.lengthMeters)
      || (collisionScore === bestBlocked.collisionScore
        && candidate.lengthMeters === bestBlocked.lengthMeters
        && candidate.ordinal < bestBlocked.ordinal)) {
      bestBlocked = { ...candidate, collisionScore };
    }
  }
  return bestBlocked?.path ?? orderedCandidates[0].path;
}

function collisionAvoidingParentAttachmentPath(
  from,
  to,
  avoidanceVolumes,
  preferXFirst,
  overlapGrants = [],
  connectorFamily = 'service-gallery',
  minimumApproachMeters = ROUTE_NETWORK_SOCKET_APPROACH_METERS,
  returnCandidate = false,
) {
  const volumeEnvelope = (volumes) => {
    if (volumes.length === 0) return null;
    const minimum = Object.fromEntries(['x', 'y', 'z'].map((axis) => [
      axis,
      Math.min(...volumes.map((volume) => (
        Number(volume.center[axis]) - Number(volume.size[axis]) * 0.5
      ))),
    ]));
    const maximum = Object.fromEntries(['x', 'y', 'z'].map((axis) => [
      axis,
      Math.max(...volumes.map((volume) => (
        Number(volume.center[axis]) + Number(volume.size[axis]) * 0.5
      ))),
    ]));
    return {
      center: Object.fromEntries(['x', 'y', 'z'].map((axis) => [
        axis,
        (minimum[axis] + maximum[axis]) * 0.5,
      ])),
      size: Object.fromEntries(['x', 'y', 'z'].map((axis) => [
        axis,
        maximum[axis] - minimum[axis],
      ])),
    };
  };
  const candidates = facingAwareSocketRouteCandidates(from, to, {
    preferXFirst,
    connectorFamily,
    sourceApproachMeters: [
      minimumApproachMeters,
      minimumApproachMeters + 2.8,
      minimumApproachMeters + 5.6,
    ],
    destinationApproachMeters: [minimumApproachMeters],
    minimumApproachMeters,
  }).map((path, ordinal) => {
    const pathVolumes = routePathPlanningVolumes(path, 3.6);
    return {
      ordinal,
      path,
      pathVolumes,
      envelope: volumeEnvelope(pathVolumes),
      lengthMeters: measureDungeonPolyline(path),
    };
  }).sort((first, second) => (
    first.lengthMeters - second.lengthMeters
      || first.ordinal - second.ordinal
  ));
  const candidateEnvelope = volumeEnvelope(candidates.flatMap(({ pathVolumes }) => pathVolumes));
  const relevantAvoidanceVolumes = candidateEnvelope
    ? avoidanceVolumes.filter((obstacle) => planningVolumesOverlap(candidateEnvelope, obstacle))
    : [];
  let bestCandidate = null;
  for (const candidate of candidates) {
    const candidateAvoidanceVolumes = candidate.envelope
      ? relevantAvoidanceVolumes.filter((obstacle) => (
        planningVolumesOverlap(candidate.envelope, obstacle)
      ))
      : [];
    let collisionScore = 0;
    scoreCandidate:
    for (const volume of candidate.pathVolumes) {
      for (const obstacle of candidateAvoidanceVolumes) {
        if (planningVolumesOverlap(volume, obstacle)
          && !planningOverlapIsGranted(volume, obstacle, overlapGrants)) {
          collisionScore += 1;
          if (bestCandidate && collisionScore > bestCandidate.collisionScore) {
            break scoreCandidate;
          }
        }
      }
    }
    const scoredCandidate = { ...candidate, collisionScore };
    if (!bestCandidate
      || scoredCandidate.collisionScore < bestCandidate.collisionScore
      || (scoredCandidate.collisionScore === bestCandidate.collisionScore
        && scoredCandidate.lengthMeters < bestCandidate.lengthMeters)
      || (scoredCandidate.collisionScore === bestCandidate.collisionScore
        && scoredCandidate.lengthMeters === bestCandidate.lengthMeters
        && scoredCandidate.ordinal < bestCandidate.ordinal)) {
      bestCandidate = scoredCandidate;
    }
    // Candidates are length-ordered. The first collision-free path is exactly
    // the former score/length/ordinal sort winner.
    if (collisionScore === 0) break;
  }
  // The caller still performs the exact proxy check before committing. Never
  // fall back to an inward dogleg through the parent room merely because it
  // has a lower heuristic score.
  if (returnCandidate) return bestCandidate;
  return bestCandidate?.path ?? null;
}

function decorateRouteNetworkSegment(segment, {
  routeRole,
  elevationMode,
  stableRuntimeStateIds,
}) {
  segment.routeRole = routeRole;
  segment.routeNetworkElevationMode = elevationMode;
  const elevationDelta = Number(segment.to.position.y) - Number(segment.from.position.y);
  if (Math.abs(elevationDelta) > 1e-6) {
    segment.verticalTransfer = true;
    segment.traversalKind = segment.connectorFamily;
    segment.direction = elevationDelta > 0 ? 'ascending' : 'descending';
    segment.sourceElevation = Number(segment.from.position.y);
    segment.destinationElevation = Number(segment.to.position.y);
    segment.elevationDelta = elevationDelta;
    segment.traversal = {
      ...segment.traversal,
      kind: segment.connectorFamily,
      direction: segment.direction,
      elevationDelta,
    };
  }
  if (elevationMode === 'shortcut-lift' && segment.connectorFamily === 'lift') {
    segment.shortcut = {
      kind: 'shortcut-lift',
      stateId: stableRuntimeStateIds.shortcut,
      initialState: 'unavailable',
      activationSide: 'far',
      activatedState: 'available',
      persistent: true,
    };
  }
  if (elevationMode === 'drop-ladder' && segment.connectorFamily === 'ladder') {
    segment.shortcut = {
      kind: 'drop-ladder',
      stateId: stableRuntimeStateIds.shortcut,
      initialState: 'retracted',
      activationSide: 'far',
      activatedState: 'deployed',
      persistent: true,
    };
  }
}

function planRouteNetwork({
  region,
  grant,
  operationOrdinal,
  moduleCount,
  topologyTemplateId,
  junctionBag,
  elevationMode,
  random,
  profile,
  grammars,
  progressionOrderStart,
  planningAvoidanceVolumes = [],
  moduleCapacity = moduleCount,
  searchVariant = 0,
}) {
  if (!grant.id || grant.endpointSockets.length < 2) {
    return { error: 'route-network-grant-endpoints-missing', context: { grantId: grant.id } };
  }
  if (!grant.accessDomainId) {
    return { error: 'route-network-access-domain-missing', context: { grantId: grant.id } };
  }
  if (grant.coverage && grant.coverage.coverageComplete !== true) {
    return { error: 'route-network-featureless-coverage-incomplete', context: { grantId: grant.id } };
  }
  const sourceId = grant.id;
  const operationId = createDungeonSupplementId({
    parentRegionId: region.id,
    operationType: 'routeNetwork',
    operationOrdinal,
    kind: 'operation',
    sourceId,
  });
  const endpoints = [...grant.endpointSockets].sort((first, second) => (
    Number(first.distanceMeters ?? 0) - Number(second.distanceMeters ?? 0)
      || first.id.localeCompare(second.id)
  ));
  // Every non-landmark parent socket terminates at compact connector-owned
  // infrastructure. Only one of those stations is promoted into the required
  // physical junction; the remaining endpoint vestibules stay outside the
  // public 3-6 substantive-module budget. This prevents exact corridor
  // stations from being forced to host a full challenge/reward room while
  // preserving the requested number of meaningful modules.
  const endpointInfrastructureOverhead = [
    'landmark-perimeter-loop',
    'objective-route-coverage',
  ].includes(grant.kind)
    ? 0
    : Math.max(0, endpoints.length - 1);
  const physicalModuleCount = moduleCount + endpointInfrastructureOverhead;
  const mainNodeCount = grant.kind === 'landmark-perimeter-loop'
    ? physicalModuleCount - 1
    : physicalModuleCount;
  let endpointNodeIndexSet = grant.kind === 'landmark-perimeter-loop'
    ? new Set([0, mainNodeCount - 1])
    : new Set([0]);
  let junctionModuleIndex = 0;
  const selectCoverageJunctionModuleIndex = (placement) => {
    const endpointNodeIndices = [...(placement?.endpointNodeIndices ?? [])]
      .sort((first, second) => first - second);
    if (endpointNodeIndices.length === 0) return 0;
    // A station inside the chain already owns two supplemental spine arms;
    // together with its parent attachment it is the natural single junction.
    // With only terminal stations, promote the one beside the longer interval
    // so the meaningful reset covers the larger endpoint prefix.
    const structuralJunctionIndices = endpointNodeIndices.filter((index) => (
      index > 0 && index < Number(placement?.centers?.length ?? mainNodeCount) - 1
    ));
    const candidates = structuralJunctionIndices.length > 0
      ? structuralJunctionIndices
      : endpointNodeIndices;
    const adjacentIntervalDistance = (index) => Math.max(
      ...[index - 1, index + 1]
        .filter((adjacentIndex) => placement?.centers?.[adjacentIndex])
        .map((adjacentIndex) => (
          Math.abs(
            Number(placement.centers[index].x)
              - Number(placement.centers[adjacentIndex].x),
          ) + Math.abs(
            Number(placement.centers[index].z)
              - Number(placement.centers[adjacentIndex].z),
          )
        )),
    );
    return [...candidates].sort((first, second) => (
      adjacentIntervalDistance(second) - adjacentIntervalDistance(first)
        || first - second
    ))[0];
  };
  const buildPlannedContentRoles = () => {
    if (grant.kind === 'landmark-perimeter-loop') {
      return Array.from({ length: physicalModuleCount }, (_, index) => {
        if (index === 0) return 'junction';
        if (index === physicalModuleCount - 1) return 'reward';
        if (index === 1) return 'challenge';
        return index % 2 === 0 ? 'mechanism' : 'discovery';
      });
    }
    const roomNodeIndices = Array.from(
      { length: physicalModuleCount },
      (_, index) => index,
    ).filter((index) => !endpointNodeIndexSet.has(index));
    const roomRoleByIndex = new Map(roomNodeIndices.map((index, roomOrdinal) => {
      if (roomOrdinal === 0) return [index, 'challenge'];
      if (roomOrdinal === roomNodeIndices.length - 1) return [index, 'reward'];
      // The first intermediate room owns the required authored vertical
      // traversal. Elevation blueprints can also carry a local mechanism, while
      // a generic control room cannot substitute for a physical tier change.
      return [index, ['elevation', 'mechanism', 'trap'][(roomOrdinal - 1) % 3]];
    }));
    return Array.from({ length: physicalModuleCount }, (_, index) => {
      if (endpointNodeIndexSet.has(index)) {
        return index === junctionModuleIndex ? 'junction' : 'connector';
      }
      return roomRoleByIndex.get(index) ?? 'discovery';
    });
  };
  let plannedContentRoles = buildPlannedContentRoles();
  // A compact authored junction is infrastructure until the realized graph
  // gives it three active physical arms. The remaining modules are curated
  // gameplay rooms. This keeps the public 3-6 module budget meaningful without
  // forcing every station to use a giant rectangular shell.
  const moduleKindForIndex = (index) => (
    grant.kind === 'landmark-perimeter-loop'
      ? index === junctionModuleIndex
      : endpointNodeIndexSet.has(index)
  ) ? 'connector-module' : 'room';
  const candidateJunctionBag = junctionBag.filter((kind) => {
    const candidate = routeNetworkGrammarForKind(
      profile,
      grammars,
      kind,
      'connector-module',
    );
    return Boolean(candidate)
      && candidate.selectionConstraints?.supportsJunctionPromotion !== false;
  });
  if (candidateJunctionBag.length === 0) {
    return {
      error: 'route-network-junction-grammar-unavailable',
      context: { grantId: grant.id },
    };
  }
  const baseJunctionKinds = Array.from({ length: physicalModuleCount }, (_, index) => (
    candidateJunctionBag[(operationOrdinal + index) % candidateJunctionBag.length]
  ));
  let junctionKinds = [...baseJunctionKinds];
  let topologyKitModuleIndex = null;
  const assignRouteNetworkGrammars = (candidateJunctionKinds) => {
    const assignment = resolveRouteNetworkGrammarAssignments({
      profile,
      grammars,
      routeNetworkKind: grant.kind,
      topologyTemplateId,
      junctionKinds: candidateJunctionKinds,
      contentRoles: plannedContentRoles,
      moduleKinds: Array.from(
        { length: physicalModuleCount },
        (_, index) => moduleKindForIndex(index),
      ),
      junctionModuleIndex,
      operationOrdinal,
      searchVariant,
      elevationMode,
    });
    junctionKinds = assignment.junctionKinds;
    topologyKitModuleIndex = assignment.topologyKitModuleIndex;
    if (grant.kind === 'objective-route-coverage') {
      const branchEntryThroughT = grammars[
        'supplement-route-connector-through-t-branch-entry-v1'
      ];
      if (branchEntryThroughT) {
        for (const endpointNodeIndex of endpointNodeIndexSet) {
          // An interior exact station has a parent attachment plus two ordered
          // supplemental neighbors. Use the authored branch-entry T so those
          // neighbor arms remain a collinear through pair. Terminal stations
          // retain the parent-through T and its outward decision arm.
          if (endpointNodeIndex <= 0
            || endpointNodeIndex >= physicalModuleCount - 1
            || endpointNodeIndex === assignment.topologyKitModuleIndex) continue;
          assignment.selectedGrammars[endpointNodeIndex] = branchEntryThroughT;
          assignment.junctionKinds[endpointNodeIndex] = 'through-t';
        }
      }
    }
    return assignment.selectedGrammars;
  };
  let selectedGrammars = assignRouteNetworkGrammars(junctionKinds);
  let balancedCoverageLayoutSignature = null;
  let hasBalancedAuthoredCoverageElevation = false;
  if (selectedGrammars.some((grammar) => !grammar)) {
    return {
      error: 'route-network-junction-grammar-unavailable',
      context: { grantId: grant.id, junctionKinds },
    };
  }
  const balanceCoverageElevationIntervals = () => (
    balanceObjectiveRouteGrammarIntervals({
      profile,
      grammars,
      selectedGrammars,
      contentRoles: plannedContentRoles,
      moduleKinds: Array.from(
        { length: physicalModuleCount },
        (_, index) => moduleKindForIndex(index),
      ),
      endpointNodeIndices: [...endpointNodeIndexSet],
      topologyKitModuleIndex,
      operationOrdinal,
      searchVariant,
      elevationMode,
      // Parallel stations on one authored gallery retain the ordinary
      // exhaustion-bag rise. Mixed-facing stations meet around a bend, where
      // the compact authored rise prevents the transfer body from consuming
      // another exact station's egress.
      preferCompactRise: new Set(endpoints.map((endpoint) => {
        const facing = toDungeonCardinalFacing(endpoint.facing);
        return `${facing.x}:${facing.z}`;
      })).size > 1,
    })
  );
  const connectorGapMeters = Number(profile.connectorGapMeters ?? 5.6);
  const connectorEndpointGapMeters = Math.max(
    ROUTE_NETWORK_SOCKET_APPROACH_METERS,
    connectorGapMeters,
  );
  const grammarEntryExitTraversalMeters = (grammar) => {
    const entry = grammar?.sockets?.find(({ id }) => id === 'entry');
    const exit = grammar?.sockets?.find(({ id }) => id === 'exit');
    if (!entry?.localPosition || !exit?.localPosition) {
      return Number(grammar?.size?.depth ?? 0);
    }
    // Serial blueprint placement follows a rectilinear tile path.  Budget the
    // distance between the actual aperture cell centers; footprint depth also
    // includes the two outer half-cells and is therefore 2.8 m too large.
    return Math.abs(Number(exit.localPosition.x) - Number(entry.localPosition.x))
      + Math.abs(Number(exit.localPosition.z) - Number(entry.localPosition.z));
  };
  let placementPath = null;
  let coveragePlacement = null;
  const objectiveExternalDiagnostics = {};
  if (grant.kind !== 'landmark-perimeter-loop') {
    const maximumHalfDepth = Math.max(...selectedGrammars.map(({ size }) => (
      Number(size.depth) * 0.5
    )));
    // Every non-landmark route network (objective coverage, same-band local
    // progression, and future explicitly granted shortcuts) has exact parent
    // endpoints. Give them the same one-to-one outer-point expansion instead
    // of leaving coveragePlacement null for the generic grants.
    placementPath = routeNetworkPlacementPolyline(
      grant,
      maximumHalfDepth + connectorEndpointGapMeters,
      random.fork('perimeter-side').chance(0.5) ? 1 : -1,
    );
    coveragePlacement = expandCoveragePlacement(
      placementPath,
      mainNodeCount,
      operationOrdinal % 2 === 0,
      endpoints,
      0,
      0,
      {
        objectiveExternalPath: grant.kind === 'objective-route-coverage',
        contentRoomDepthMeters: Array.from(
          { length: Math.max(2, mainNodeCount - endpoints.length) },
          () => 19.6,
        ),
        minimumApproachMeters: ROUTE_NETWORK_SOCKET_APPROACH_METERS,
        maximumFeaturelessSpanMeters: Number(
          profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
        ),
        searchVariant,
        planningAvoidanceVolumes,
        planningOverlapGrants: [
          ...(grant.socketLandingOverlapGrants ?? []),
          ...(grant.socketModuleOverlapGrants ?? []),
        ],
        diagnostics: objectiveExternalDiagnostics,
      },
    );
    endpointNodeIndexSet = new Set(coveragePlacement.endpointNodeIndices);
    junctionModuleIndex = selectCoverageJunctionModuleIndex(coveragePlacement);
    plannedContentRoles = buildPlannedContentRoles();
    // Authored corridor stations are physical T intersections. Give every
    // exact station the compact 5x7 Through-T footprint so its
    // parent approach + internal traverse + next station interval can satisfy
    // the 33.6 m featureless bound. Larger junction families remain available
    // to free-standing topology decisions where their complete arms fit.
    const coverageJunctionKinds = baseJunctionKinds.map((junctionKind, index) => (
      endpointNodeIndexSet.has(index)
        ? 'through-t'
        : junctionKind
    ));
    selectedGrammars = assignRouteNetworkGrammars(coverageJunctionKinds);
    if (selectedGrammars.some((grammar) => !grammar)) {
      return {
        error: 'route-network-junction-grammar-unavailable',
        context: { grantId: grant.id, junctionKinds },
      };
    }
    if (grant.kind === 'objective-route-coverage') {
      const intervalBalance = balanceCoverageElevationIntervals();
      if (!intervalBalance.balanced) {
        return {
          error: 'route-network-authored-elevation-interval-unavailable',
          context: { grantId: grant.id, elevationMode, ...intervalBalance },
        };
      }
      balancedCoverageLayoutSignature = canonicalStringify({
        endpointNodeIndices: coveragePlacement.endpointNodeIndices,
        grammarIds: selectedGrammars.map(({ id }) => id),
      });
    }
    // Rebuild the whole coverage path from the selected compact endpoint
    // stations. Merely pulling endpoint centers inward after expanding from
    // the largest room depth leaves the adjacent reward/challenge rooms on
    // stale, overlong leads; their only apparent reconnect then crosses the
    // authored gallery. Endpoint stations all use the same Through-T grammar,
    // so one deterministic rebuild also keeps multi-endpoint index allocation
    // stable after semantics are refreshed below.
    placementPath = endpoints.map((endpoint, endpointOrdinal) => {
      const nodeIndex = coveragePlacement.endpointNodeIndices[endpointOrdinal];
      return routeNetworkOuterPoint(
        endpoint,
        Number(selectedGrammars[nodeIndex].size.depth) * 0.5 + 2.8,
      );
    });
    const minimumCoverageInteriorSpacingMeters = Math.max(
      connectorEndpointGapMeters,
      ...Array.from({ length: Math.max(0, selectedGrammars.length - 1) }, (_, index) => (
        Number(selectedGrammars[index].size.depth) * 0.5
          + Number(selectedGrammars[index + 1].size.depth) * 0.5
        + connectorEndpointGapMeters
      )),
    );
    const minimumCoverageExteriorTurnMeters = Math.max(
      connectorEndpointGapMeters,
      ...selectedGrammars.map(({ size }) => (
        Number(size.depth) * 0.5 + connectorEndpointGapMeters
      )),
    );
    coveragePlacement = expandCoveragePlacement(
      placementPath,
      mainNodeCount,
      operationOrdinal % 2 === 0,
      endpoints,
      minimumCoverageInteriorSpacingMeters,
      minimumCoverageExteriorTurnMeters,
      {
        objectiveExternalPath: grant.kind === 'objective-route-coverage',
        stationSizes: endpoints.map((_, endpointOrdinal) => (
          selectedGrammars[
            coveragePlacement.endpointNodeIndices[endpointOrdinal]
          ]?.size
        )),
        stationGrammars: endpoints.map((_, endpointOrdinal) => (
          selectedGrammars[
            coveragePlacement.endpointNodeIndices[endpointOrdinal]
          ]
        )),
        contentRoomDepthMeters: selectedGrammars
          .filter((_, index) => !endpointNodeIndexSet.has(index))
          .map((grammar) => grammarEntryExitTraversalMeters(grammar)),
        contentRoomEntryElevationMeters: selectedGrammars
          .filter((_, index) => !endpointNodeIndexSet.has(index))
          .map((grammar) => Number(grammar.sockets.find(({ id }) => id === 'entry')
            ?.localPosition?.y ?? 0)),
        contentRoomExitElevationMeters: selectedGrammars
          .filter((_, index) => !endpointNodeIndexSet.has(index))
          .map((grammar) => Number(grammar.sockets.find(({ id }) => id === 'exit')
            ?.localPosition?.y ?? 0)),
        contentRoomSizes: selectedGrammars
          .filter((_, index) => !endpointNodeIndexSet.has(index))
          .map(({ size }) => cloneDungeonAugmentationValue(size)),
        contentRoomPlanningVolumes: selectedGrammars
          .filter((_, index) => !endpointNodeIndexSet.has(index))
          .map((grammar) => cloneDungeonAugmentationValue(
            (grammar.occupiedVolumes ?? []).length > 0
              ? grammar.occupiedVolumes
              : grammar.clearanceVolumes ?? [],
          )),
        minimumApproachMeters: ROUTE_NETWORK_SOCKET_APPROACH_METERS,
        maximumFeaturelessSpanMeters: Number(
          profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
        ),
        searchVariant,
        planningAvoidanceVolumes,
        planningOverlapGrants: [
          ...(grant.socketLandingOverlapGrants ?? []),
          ...(grant.socketModuleOverlapGrants ?? []),
        ],
        diagnostics: objectiveExternalDiagnostics,
      },
    );
    endpointNodeIndexSet = new Set(coveragePlacement.endpointNodeIndices);
    junctionModuleIndex = selectCoverageJunctionModuleIndex(coveragePlacement);
    plannedContentRoles = buildPlannedContentRoles();
    const refinedCoverageJunctionKinds = baseJunctionKinds.map((junctionKind, index) => (
      endpointNodeIndexSet.has(index) ? 'through-t' : junctionKind
    ));
    selectedGrammars = assignRouteNetworkGrammars(refinedCoverageJunctionKinds);
    if (selectedGrammars.some((grammar) => !grammar)) {
      return {
        error: 'route-network-junction-grammar-unavailable',
        context: { grantId: grant.id, junctionKinds },
      };
    }
    if (grant.kind === 'objective-route-coverage') {
      const intervalBalance = balanceCoverageElevationIntervals();
      if (!intervalBalance.balanced) {
        return {
          error: 'route-network-authored-elevation-interval-unavailable',
          context: { grantId: grant.id, elevationMode, ...intervalBalance },
        };
      }
      const refinedLayoutSignature = canonicalStringify({
        endpointNodeIndices: coveragePlacement.endpointNodeIndices,
        grammarIds: selectedGrammars.map(({ id }) => id),
      });
      if (refinedLayoutSignature !== balancedCoverageLayoutSignature) {
        return {
          error: 'route-network-coverage-refinement-changed-layout',
          context: {
            grantId: grant.id,
            elevationMode,
            balancedCoverageLayoutSignature,
            refinedLayoutSignature,
          },
        };
      }
      // The refinement pass can move endpoint ordinals around the semantic
      // rooms. Recompute every exact station center from the final grammar's
      // authored entry socket instead of retaining a provisional room-depth
      // offset. This keeps the entry cell centered on the host's 8.4 m
      // aperture and inside the matching template-scoped overlap grant.
      for (let endpointOrdinal = 0; endpointOrdinal < endpoints.length; endpointOrdinal += 1) {
        const nodeIndex = coveragePlacement.endpointNodeIndices[endpointOrdinal];
        const endpoint = endpoints[endpointOrdinal];
        const grammar = selectedGrammars[nodeIndex];
        const entrySocket = grammar?.sockets?.find(({ id }) => id === 'entry');
        if (!entrySocket?.localPosition) continue;
        const facing = toDungeonCardinalFacing(endpoint.facing);
        const rotatedEntry = transformDungeonLocalPoint(
          entrySocket.localPosition,
          {
            center: { x: 0, y: 0, z: 0 },
            rotationQuarterTurns: rotationQuarterTurnsForFacing(facing),
          },
        );
        const thresholdLeadMeters = Number(endpoint.widthMeters ?? 8.4) * 0.5;
        const desiredEntry = addDungeonPoints(
          endpoint.position,
          scaleDungeonPoint(facing, thresholdLeadMeters),
        );
        coveragePlacement.centers[nodeIndex] = {
          x: Number(desiredEntry.x) - Number(rotatedEntry.x),
          y: Number(desiredEntry.y) - Number(rotatedEntry.y),
          z: Number(desiredEntry.z) - Number(rotatedEntry.z),
        };
      }
      hasBalancedAuthoredCoverageElevation = true;
    }
  } else {
    const maximumHalfDepth = Math.max(...selectedGrammars.map(({ size }) => (
      Number(size.depth) * 0.5
    )));
    placementPath = routeNetworkPlacementPolyline(
      grant,
      maximumHalfDepth + connectorEndpointGapMeters,
      random.fork('perimeter-side').chance(0.5) ? 1 : -1,
    );
  }
  if (grant.kind === 'objective-route-coverage') {
    const authoredExitDeltas = selectedGrammars.map((grammar) => Number(
      grammar?.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
    ));
    const authoredExitDelta = authoredExitDeltas.reduce((sum, delta) => sum + delta, 0);
    if (!authoredExitDeltas.some((delta) => Math.abs(delta) > 0.000001)) {
      return {
        error: 'route-network-authored-elevation-module-missing',
        context: { grantId: grant.id, elevationMode },
      };
    }
    if (Math.abs(authoredExitDelta) > 0.000001) {
      return {
        error: 'route-network-authored-elevation-unbalanced',
        context: {
          grantId: grant.id,
          elevationMode,
          authoredExitDelta,
          selectedGrammarIds: selectedGrammars.map(({ id }) => id),
        },
      };
    }
    const orderedEndpointNodeIndices = [...endpointNodeIndexSet]
      .sort((first, second) => first - second);
    const unbalancedIntervals = Array.from(
      { length: Math.max(0, orderedEndpointNodeIndices.length - 1) },
      (_, ordinal) => {
        const first = orderedEndpointNodeIndices[ordinal];
        const second = orderedEndpointNodeIndices[ordinal + 1];
        return {
          first,
          second,
          authoredExitDelta: authoredExitDeltas
            .slice(first + 1, second)
            .reduce((sum, delta) => sum + delta, 0),
        };
      },
    ).filter(({ authoredExitDelta: delta }) => Math.abs(delta) > 0.000001);
    if (unbalancedIntervals.length > 0) {
      return {
        error: 'route-network-authored-elevation-interval-unbalanced',
        context: {
          grantId: grant.id,
          elevationMode,
          unbalancedIntervals,
          selectedGrammarIds: selectedGrammars.map(({ id }) => id),
        },
      };
    }
  }
  if (!placementPath || placementPath.length < 2) {
    return { error: 'route-network-placement-path-unavailable', context: { grantId: grant.id } };
  }
  const mainCenters = coveragePlacement?.centers ?? (
    placementPath.length === mainNodeCount
      ? placementPath.map((point) => cloneDungeonAugmentationValue(point))
      : Array.from({ length: mainNodeCount }, (_, index) => (
        samplePolylineByFraction(
          placementPath,
          mainNodeCount === 1 ? 0 : index / (mainNodeCount - 1),
        )
      ))
  );
  if (grant.kind === 'landmark-perimeter-loop' && mainCenters.length >= 2) {
    // Landmark apertures are exact wall grants. Pin the first entry and final
    // exit socket directly in front of those grants so the attachment is a
    // straight two-tile approach, never a dogleg inside the protected room
    // envelope. Deriving the center from the selected grammar also avoids the
    // max-grammar-depth tangent error that previously shifted the doorway.
    mainCenters[0] = routeNetworkOuterPoint(
      endpoints[0],
      Number(selectedGrammars[0].size.depth) * 0.5 + connectorEndpointGapMeters,
    );
    mainCenters[mainCenters.length - 1] = routeNetworkOuterPoint(
      endpoints[1],
      Number(selectedGrammars[mainCenters.length - 1].size.depth) * 0.5
        + connectorEndpointGapMeters,
    );
  }
  // The perimeter path already includes the largest selected half-depth plus
  // the exact socket lead. The former giant-room planner pushed interior
  // centers outward a second time, creating artificial >33.6m gaps between
  // otherwise valid compact/content modules.
  const centers = [...mainCenters];
  // Authored blueprints may deliberately leave on a different tier. Carry
  // that exit elevation into the next module instead of immediately undoing
  // the rise with a compensating external connector. Exact parent stations
  // remain pinned later and therefore receive a real descent/ascent witness
  // when the chain must return to the authored host elevation.
  for (let index = 1; index < Math.min(mainNodeCount, centers.length); index += 1) {
    if (endpointNodeIndexSet.has(index)) continue;
    const previousExitElevation = Number(
      selectedGrammars[index - 1]?.sockets?.find(({ id }) => id === 'exit')
        ?.localPosition?.y ?? 0,
    );
    const currentEntryElevation = Number(
      selectedGrammars[index]?.sockets?.find(({ id }) => id === 'entry')
        ?.localPosition?.y ?? 0,
    );
    centers[index].y = Number(centers[index - 1]?.y ?? centers[index].y ?? 0)
      + previousExitElevation
      - currentEntryElevation;
  }
  const verticalFamily = connectorFamilyForElevationMode(elevationMode);
  const coverageModuleRouteOptions = grant.kind === 'objective-route-coverage'
    ? {
      sourceApproachMeters: [ROUTE_NETWORK_SOCKET_APPROACH_METERS, 2.8],
      destinationApproachMeters: [ROUTE_NETWORK_SOCKET_APPROACH_METERS, 2.8],
      minimumApproachMeters: 2.8,
    }
    : {};
  const socketRouteCandidateCache = new Map();
  const cachedSocketRouteCandidates = (from, to, options = {}) => {
    const cacheKey = canonicalStringify({
      from: { position: from?.position, facing: from?.facing },
      to: { position: to?.position, facing: to?.facing },
      options,
    });
    if (!socketRouteCandidateCache.has(cacheKey)) {
      socketRouteCandidateCache.set(
        cacheKey,
        facingAwareSocketRouteCandidates(from, to, options),
      );
    }
    return socketRouteCandidateCache.get(cacheKey);
  };
  const roomNodeIndices = Array.from({ length: physicalModuleCount }, (_, index) => index)
    .filter((index) => moduleKindForIndex(index) === 'room');
  const contentRoles = [...plannedContentRoles];
  const interiorRoomNodeIndices = roomNodeIndices.filter((index) => (
    index < mainCenters.length && !endpointNodeIndexSet.has(index)
  ));
  const elevationNodeIndex = grant.kind === 'landmark-perimeter-loop'
    ? junctionModuleIndex
    : interiorRoomNodeIndices.find((index) => (
      contentRoles[index] === 'elevation' && index < mainCenters.length
    )) ?? interiorRoomNodeIndices.find((index) => (
      contentRoles[index] === 'mechanism'
    // A minimum three-module network has only challenge + payoff rooms beside
    // its active junction. Start the transfer at the challenge so the entire
    // external run can cross an authored gallery on the separated tier and
    // descend only at the reconnect station; choosing the payoff was too late
    // for alternating-side coverage stations.
    )) ?? interiorRoomNodeIndices[0]
    ?? roomNodeIndices.find((index) => (
      contentRoles[index] === 'elevation' && index < mainCenters.length
    )) ?? [...endpointNodeIndexSet]
    .filter((index) => index < mainCenters.length)
    .sort((first, second) => first - second)
    .at(-1) ?? -1;
  const hasAuthoredNetworkElevationTransfer = selectedGrammars
    .slice(0, mainNodeCount)
    .some((grammar) => Math.abs(Number(
      grammar?.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
    )) > 0.000001);
  const requiresExternalVerticalTransfer = !hasAuthoredNetworkElevationTransfer && [
    'slope', 'ladder', 'lift', 'shortcut-lift', 'drop-ladder',
  ].includes(elevationMode);
  const elevationRunStartNodeIndex = grant.kind !== 'landmark-perimeter-loop'
    && ['elevation', 'mechanism'].includes(contentRoles[elevationNodeIndex])
    ? interiorRoomNodeIndices.filter((index) => index < elevationNodeIndex).at(-1)
      ?? elevationNodeIndex
    : elevationNodeIndex;
  if (requiresExternalVerticalTransfer
    && elevationRunStartNodeIndex >= 0
    && centers[elevationRunStartNodeIndex]) {
    // Keep the challenge/mechanism-to-payoff run on the transferred tier and
    // descend only at the next exact reconnect station. Raising a single room
    // immediately dropped the reward route back onto the authored corridor it
    // was meant to bypass, making otherwise valid outward networks impossible
    // at widened parent galleries.
    const elevatedNodeIndices = new Set();
    for (let index = elevationRunStartNodeIndex;
      index < mainNodeCount && !endpointNodeIndexSet.has(index);
      index += 1) {
      elevatedNodeIndices.add(index);
    }
    if (grant.kind !== 'landmark-perimeter-loop') {
      const orderedEndpointNodeIndices = [...endpointNodeIndexSet]
        .filter((index) => index < mainNodeCount)
        .sort((first, second) => first - second);
      for (let ordinal = 1; ordinal < orderedEndpointNodeIndices.length; ordinal += 1) {
        const firstEndpointNodeIndex = orderedEndpointNodeIndices[ordinal - 1];
        const secondEndpointNodeIndex = orderedEndpointNodeIndices[ordinal];
        const firstEndpoint = endpoints[
          coveragePlacement.endpointNodeIndices.indexOf(firstEndpointNodeIndex)
        ];
        const secondEndpoint = endpoints[
          coveragePlacement.endpointNodeIndices.indexOf(secondEndpointNodeIndex)
        ];
        const facingDot = Number(firstEndpoint?.facing?.x ?? 0)
            * Number(secondEndpoint?.facing?.x ?? 0)
          + Number(firstEndpoint?.facing?.z ?? 0)
            * Number(secondEndpoint?.facing?.z ?? 0);
        if (facingDot >= -0.5) continue;
        // Opposite-side coverage stations are an authored over-under
        // crossover. Raise the complete intervening module run so ascent and
        // descent happen outside the widened parent gallery, while its middle
        // spine crosses that gallery on the separated tier.
        for (let index = firstEndpointNodeIndex + 1;
          index < secondEndpointNodeIndex;
          index += 1) {
          if (!endpointNodeIndexSet.has(index)) elevatedNodeIndices.add(index);
        }
      }
    }
    for (const index of elevatedNodeIndices) {
      centers[index].y += 14;
    }
  }
  // `split-level-platform` is realized inside its owning content room. The
  // external gameplay path remains at the authored station elevation; lifting
  // alternating whole rooms here turns a legal 33.6m rectilinear U into a
  // much longer forced transfer and breaks the selected socket-bound layout.
  const endpointOrdinalForNodeIndex = (index) => {
    if (grant.kind === 'landmark-perimeter-loop') {
      if (index === 0) return 0;
      if (index === mainNodeCount - 1) return 1;
      return -1;
    }
    return coveragePlacement.endpointNodeIndices.indexOf(index);
  };
  const connectorModuleCoreTraversalDistance = (
    node,
    firstLocalSocketId,
    secondLocalSocketId,
  ) => {
    const firstSocket = getNodeSocket(node, firstLocalSocketId);
    const secondSocket = getNodeSocket(node, secondLocalSocketId);
    return firstSocket?.position && secondSocket?.position
      ? dungeonPointDistance(firstSocket.position, secondSocket.position)
      : Number.POSITIVE_INFINITY;
  };
  const parentAttachmentFeaturelessDistanceForNode = (
    node,
    index,
    throughLocalSocketId = null,
  ) => {
    if (!node?.connectorOwned || Number(node.plannedMinimumGraphDegree ?? 0) >= 3) return 0;
    const endpointOrdinal = endpointOrdinalForNodeIndex(index);
    if (endpointOrdinal < 0) return 0;
    const parentSocket = endpoints[endpointOrdinal];
    const parentLocalSocketId = grant.kind === 'landmark-perimeter-loop'
      && index === mainNodeCount - 1
      ? 'exit'
      : 'entry';
    const nodeSocket = getNodeSocket(node, parentLocalSocketId);
    if (!parentSocket?.position || !nodeSocket?.position) return Number.POSITIVE_INFINITY;
    const connectorFamily = Math.abs(
      Number(nodeSocket.position.y) - Number(parentSocket.position.y),
    ) > 1e-6 ? verticalFamily : 'service-gallery';
    const attachmentDistance = Math.min(...[true, false].map((preferXFirst) => {
      const path = parentAttachmentRouteSegmentPath(
        { position: parentSocket.position, facing: parentSocket.facing },
        nodeSocket,
        preferXFirst,
        connectorFamily,
        grant.kind === 'landmark-perimeter-loop'
          ? ROUTE_NETWORK_SOCKET_APPROACH_METERS
          : 2.8,
      );
      return path.length >= 2
        ? maximumContinuousLevelRouteSpan(path)
        : Number.POSITIVE_INFINITY;
    }));
    const coreTraversalDistance = throughLocalSocketId
      ? connectorModuleCoreTraversalDistance(
        node,
        parentLocalSocketId,
        throughLocalSocketId,
      )
      : 0;
    return attachmentDistance + coreTraversalDistance;
  };
  const createRouteNetworkNode = (index, center, facing) => {
    const grammar = selectedGrammars[index];
    const nodeId = createDungeonSupplementId({
      parentRegionId: region.id,
      operationType: 'routeNetwork',
      operationOrdinal,
      kind: 'node',
      ordinal: index,
      sourceId,
    });
    const node = createNode({
      id: nodeId,
      operationId,
      parentRegionId: region.id,
      ordinal: index,
      grammar,
      themeBinding: region.themeBinding,
      center,
      facing,
      coordinateSpace: grant.endpointSockets[0].coordinateSpace,
      progressionOrder: progressionOrderStart + index,
    });
    applyRouteNetworkNodeSemantics(node, {
      contentRole: contentRoles[index],
      junctionKind: junctionKinds[index],
      progressionBandId: grant.progressionBandId,
      accessDomainId: grant.accessDomainId,
      elevationMode: index === elevationNodeIndex ? elevationMode : 'level',
      moduleKind: moduleKindForIndex(index),
    });
    const endpointOrdinal = endpointOrdinalForNodeIndex(index);
    if (endpointOrdinal >= 0) {
      const parentEndpoint = endpoints[endpointOrdinal];
      node.exactParentEndpoint = true;
      node.parentEndpointSocketId = String(parentEndpoint.id);
      node.parentEndpointSocketKind = String(
        parentEndpoint.source?.routeNetworkSocketKind
          ?? parentEndpoint.routeNetworkSocketKind
          ?? 'parent-socket',
      );
      // Every authored corridor station owns the parent corridor's onward arm.
      // Its exact attachment plus the supplement arm therefore realizes a
      // physical T even at a terminal position in this supplemental chain.
      node.parentThroughRouteDegreeContribution = node.parentEndpointSocketKind
          === 'authored-corridor-station' ? 1 : 0;
      node.connectorOwnershipId = node.id;
      node.plannedMinimumGraphDegree = 1
        + (index > 0 ? 1 : 0)
        + (index < mainNodeCount - 1 ? 1 : 0)
        + Number(node.parentThroughRouteDegreeContribution ?? 0);
      if (index === junctionModuleIndex) {
        node.plannedMinimumGraphDegree = Math.max(3, node.plannedMinimumGraphDegree);
      }
    }
    return node;
  };
  const facingForMainNode = (index) => {
    if (grant.kind !== 'landmark-perimeter-loop') {
      const endpointOrdinal = coveragePlacement.endpointNodeIndices.indexOf(index);
      if (endpointOrdinal >= 0) return endpoints[endpointOrdinal].facing;
      if (grant.kind === 'objective-route-coverage'
        && !Array.isArray(coveragePlacement.externalRoutePaths)) {
        // The external coverage solver positions rooms on a valid station-to-
        // station route, but a room can land on the run immediately before a
        // bend.  Reusing that run's tangent then points its authored `exit`
        // away from the next physical module.  The topology still looks
        // connected while the socket router has to wrap around a whole room,
        // commonly exceeding the 33.6 m featureless limit.  Orient every
        // substantive room by its actual ordered socket binding instead.  Its
        // entry consequently faces the preceding module and its exit faces the
        // succeeding module, so the realized route follows the blueprint
        // chain represented by requiredSocketBindings.
        const outgoingBinding = coveragePlacement.requiredSocketBindings?.find((binding) => (
          binding.fromIndex === index
            && binding.fromLocalSocketId === 'exit'
            && centers[binding.toIndex]
        ));
        const incomingBinding = coveragePlacement.requiredSocketBindings?.find((binding) => (
          binding.toIndex === index
            && binding.toLocalSocketId === 'entry'
            && centers[binding.fromIndex]
        ));
        const adjacentCenter = outgoingBinding
          ? centers[outgoingBinding.toIndex]
          : incomingBinding
            ? centers[incomingBinding.fromIndex]
            : null;
        if (adjacentCenter) {
          const delta = outgoingBinding
            ? {
              x: Number(adjacentCenter.x) - Number(centers[index].x),
              z: Number(adjacentCenter.z) - Number(centers[index].z),
            }
            : {
              x: Number(centers[index].x) - Number(adjacentCenter.x),
              z: Number(centers[index].z) - Number(adjacentCenter.z),
            };
          if (Math.hypot(delta.x, delta.z) > 1e-6) {
            return toDungeonCardinalFacing(delta);
          }
        }
      }
      if (coveragePlacement.nodeFacings?.[index]) {
        return coveragePlacement.nodeFacings[index];
      }
      const anchorEndpointOrdinal = Number(
        coveragePlacement.anchorEndpointOrdinals?.[index],
      );
      if (Number.isInteger(anchorEndpointOrdinal)
        && endpoints[anchorEndpointOrdinal]) {
        // A room placed on an authored continuation lead owns that station's
        // outward edge even when it lies between two endpoint indices. Keep
        // the room's entry aligned to the exact T-to-room continuation; the
        // chain chord would rotate that entry away and consume the middle T's
        // only short socket on the wrong interval.
        return endpoints[anchorEndpointOrdinal].facing;
      }
      const adjacentEndpointOrdinals = coveragePlacement.endpointNodeIndices
        .map((endpointIndex, ordinal) => ({ endpointIndex, ordinal }))
        .filter(({ endpointIndex }) => Math.abs(endpointIndex - index) === 1);
      // Host continuation centers lie directly on the endpoint's outward ray.
      // Keep the adjacent two-socket content room aligned to that ray so one
      // socket receives the endpoint edge and the other remains available for
      // the continuation. The external gallery, not a straight-through room,
      // owns the eventual elbow. A lone room between two endpoints keeps the
      // chord fallback because neither endpoint can uniquely own its facing.
      if (adjacentEndpointOrdinals.length === 1) {
        return endpoints[adjacentEndpointOrdinals[0].ordinal].facing;
      }
      const previous = mainCenters[Math.max(0, index - 1)];
      const next = mainCenters[Math.min(mainCenters.length - 1, index + 1)];
      return toDungeonFacing({ x: next.x - previous.x, z: next.z - previous.z });
    }
    if (index === 0) return endpoints[0].facing;
    if (index === mainCenters.length - 1) {
      return scaleDungeonPoint(endpoints[1].facing, -1);
    }
    const previous = mainCenters[Math.max(0, index - 1)];
    const next = mainCenters[Math.min(mainCenters.length - 1, index + 1)];
    return toDungeonFacing({
      x: next.x - previous.x,
      z: next.z - previous.z,
    });
  };
  const localPlacementAvoidanceVolumes = [...planningAvoidanceVolumes];
  let nodePlacementFailureDetails = null;
  const placementCandidatesForNode = (baseCenter, outward, allowReverse = false) => {
    const tangent = { x: -outward.z, y: 0, z: outward.x };
    const candidates = [];
    const isPyramidLoop = grant.kind === 'landmark-perimeter-loop';
    const outwardOffsets = isPyramidLoop
      ? [0, 8.4, 16.8, 25.2, 33.6, 42, 50.4, 58.8]
      : [0, 2.8, 5.6, 8.4, 16.8, 25.2, 33.6, 42, 50.4, 58.8, 67.2, 75.6, 84];
    if (allowReverse) {
      outwardOffsets.push(
        -2.8, -5.6, -8.4, -16.8, -25.2, -33.6, -42, -50.4, -58.8, -67.2, -75.6, -84,
      );
    }
    for (const outwardOffset of outwardOffsets) {
      const tangentOffsets = isPyramidLoop
        ? [
          0, -8.4, 8.4, -16.8, 16.8,
          -19.6, 19.6, -22.4, 22.4,
          -25.2, 25.2, -33.6, 33.6, -42, 42, -50.4, 50.4,
        ]
         : [
          0, -2.8, 2.8, -5.6, 5.6, -8.4, 8.4, -11.2, 11.2, -16.8, 16.8,
          -25.2, 25.2, -33.6, 33.6,
          -42, 42, -50.4, 50.4, -58.8, 58.8, -67.2, 67.2,
          -75.6, 75.6, -84, 84,
        ];
      for (const tangentOffset of tangentOffsets) {
        candidates.push(addDungeonPoints(
          addDungeonPoints(baseCenter, scaleDungeonPoint(outward, outwardOffset)),
          scaleDungeonPoint(tangent, tangentOffset),
        ));
      }
    }
    return candidates;
  };
  const placeCollisionSafeNode = (
    index,
    baseCenter,
    facing,
    outward,
    parentSocket = null,
    adjacentPlacedNodes = [],
    {
      candidatesOnly = false,
      avoidanceVolumes = localPlacementAvoidanceVolumes,
      collisionScoreForNode = nodePlanningCollisionScore,
    } = {},
  ) => {
    const landmarkEndpointRoom = Boolean(parentSocket)
      && grant.kind === 'landmark-perimeter-loop';
    const exactCoverageEndpointStation = Boolean(parentSocket)
      && grant.kind !== 'landmark-perimeter-loop';
    // A coverage station is the authored merge body for one exact host
    // socket. The host's module-overlap grant describes that one body, not a
    // corridor along which the station may slide. Global expansion belongs to
    // the substantive rooms and their recomputed spine paths; moving the
    // station itself creates a long parent attachment that can cut across the
    // same network at another tier.
    const movableDenseCoverageEndpointStation = false;
    const precomposedObjectiveExternalRoom = parentSocket == null
      && grant.kind === 'objective-route-coverage'
      && Array.isArray(coveragePlacement?.externalRoutePaths);
    const planarCandidates = exactCoverageEndpointStation
      ? movableDenseCoverageEndpointStation
        ? placementCandidatesForNode(baseCenter, outward, false)
        : [cloneDungeonAugmentationValue(baseCenter)]
      : precomposedObjectiveExternalRoom
        // The external composer supplies a strong deterministic seed, not an
        // immutable room center. Its station-to-station route can still cross
        // a later authored mask. Keep host stations exact, while allowing the
        // bounded global solver to spread interior modules on either side of
        // that seed and recompute their physical socket paths from the same
        // semantic ordering. Static/protected volumes still reject movement
        // back into the authored host; allowing the reverse half-plane is
        // necessary when two consecutive room seeds lie on opposite arms and
        // must meet at a socket-aligned threshold.
        ? placementCandidatesForNode(baseCenter, outward, true)
      : landmarkEndpointRoom
      ? (() => {
        const tangent = { x: -outward.z, y: 0, z: outward.x };
        // A full Cartesian sweep here is needlessly expensive because every
        // candidate also validates several facing-aware physical corridors.
        // These tile-aligned bounds cover the complete legal featureless span:
        // four outward stations and enough lateral displacement to clear a
        // 15x13 authored gallery obstruction after the exact 5.6m approach.
        return [0, 8.4, 16.8, 25.2].flatMap((outwardOffset) => (
          [0, -8.4, 8.4, -16.8, 16.8, -25.2, 25.2, -28, 28]
            .filter((tangentOffset) => (
              outwardOffset + Math.abs(tangentOffset) <= 28 + 1e-6
            ))
            .map((tangentOffset) => (
            addDungeonPoints(
              addDungeonPoints(baseCenter, scaleDungeonPoint(outward, outwardOffset)),
              scaleDungeonPoint(tangent, tangentOffset),
            )
            ))
        ));
      })()
      : placementCandidatesForNode(
        baseCenter,
        outward,
        parentSocket == null && (
          grant.kind !== 'landmark-perimeter-loop'
            // A raised pyramid room may safely move back over the protected XZ
            // envelope because its exact Y slab is disjoint. This supplies the
            // compact upper corner needed to connect two large rooms while the
            // endpoint rooms retain their full in-core distance.
            || Number(baseCenter.y) >= Number(endpoints[0]?.position?.y ?? 0) + 14 - 1e-6
        ),
      );
    // Landmark wall apertures stay exact and retain their two flat approach
    // tiles, but the attached full-size room is not pinned to the first center.
    // An authored gallery may legitimately occupy that body. Search the same
    // bounded tile-aligned outward/tangent candidates used by other rooms and
    // accept only a collision-free, <=33.6m physical corridor witness. The
    // orientation remains inherited from its exact parent socket. If the
    // authored obstruction occupies the complete level slab, the room may use
    // one standard 14m transfer after that flat approach; the physical slope,
    // ladder, or lift is still the room's direct connector. No compact
    // vestibule is introduced.
    const placementCandidates = exactCoverageEndpointStation
      ? planarCandidates.map((center) => ({
        ...cloneDungeonAugmentationValue(center),
        y: Number(parentSocket.position.y),
      }))
      : landmarkEndpointRoom
      ? planarCandidates.flatMap((center) => [
        Number(baseCenter.y),
        Number(baseCenter.y) + 14,
      ].map((candidateElevation) => ({ ...center, y: candidateElevation })))
      : parentSocket
      ? planarCandidates.flatMap((center) => [
        Number(parentSocket.position.y),
        Number(parentSocket.position.y) + 14,
      ].map((candidateElevation) => ({
        ...center,
        y: candidateElevation,
      })))
      : candidatesOnly
        && grant.kind === 'objective-route-coverage'
        && endpoints.length >= 3
        && !hasBalancedAuthoredCoverageElevation
        && !Array.isArray(coveragePlacement?.externalRoutePaths)
        ? planarCandidates.flatMap((center) => [
          Number(center.y),
          Number(center.y) + 14,
        ].map((candidateElevation) => ({
          ...center,
          y: candidateElevation,
        })))
      : planarCandidates;
    const solveInteriorOrientation = candidatesOnly
      && grant.kind === 'objective-route-coverage'
      && !exactCoverageEndpointStation;
    const orientationCandidates = solveInteriorOrientation
      ? [
        toDungeonCardinalFacing(facing),
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: -1 },
      ].filter((candidateFacing, orientationOrdinal, allFacings) => (
        allFacings.findIndex((otherFacing) => (
          Math.abs(Number(otherFacing.x) - Number(candidateFacing.x)) <= 1e-6
            && Math.abs(Number(otherFacing.z) - Number(candidateFacing.z)) <= 1e-6
        )) === orientationOrdinal
      ))
      : [toDungeonCardinalFacing(facing)];
    const orientedPlacementCandidates = placementCandidates.flatMap((center) => (
      orientationCandidates.map((candidateFacing, orientationOrdinal) => ({
        center,
        candidateFacing,
        orientationOrdinal,
      }))
    ));
    const candidates = random.fork(`node-placement:${index}`).shuffle(
      orientedPlacementCandidates,
    ).map(({ center, candidateFacing, orientationOrdinal }) => {
      const node = createRouteNetworkNode(index, center, candidateFacing);
      const parentLocalSocketId = grant.kind === 'landmark-perimeter-loop'
        && index === mainCenters.length - 1
        ? 'exit'
        : 'entry';
      const parentNodeSocket = getNodeSocket(node, parentLocalSocketId);
      const parentConnectorFamily = parentSocket && Math.abs(
        Number(parentNodeSocket.position.y) - Number(parentSocket.position.y),
      ) > 1e-6 ? verticalFamily : 'service-gallery';
      const parentDistanceMeters = parentSocket
        ? Math.min(...[true, false].map((preferXFirst) => {
          const path = parentAttachmentRouteSegmentPath(
            { position: parentSocket.position, facing: parentSocket.facing },
            parentNodeSocket,
            preferXFirst,
            parentConnectorFamily,
            grant.kind === 'landmark-perimeter-loop'
              ? ROUTE_NETWORK_SOCKET_APPROACH_METERS
              : 2.8,
          );
          return path.length >= 2
            ? maximumContinuousLevelRouteSpan(path)
            : Number.POSITIVE_INFINITY;
        }))
        : 0;
      const parentOverlapGrants = parentSocket
        ? (grant.socketLandingOverlapGrants ?? []).filter(({ socketId }) => (
          String(socketId) === String(parentSocket.id)
        ))
        : [];
      const parentRouteAvoidanceVolumes = parentSocket
        ? avoidanceVolumes.filter((volume) => (
          !planningVolumeOwnedBy(volume, node.id)
            && !isGrantedParentGalleryThresholdVolume(volume, parentOverlapGrants[0])
        ))
        : [];
      const parentRouteCandidates = parentSocket
        && grant.kind === 'landmark-perimeter-loop'
        ? cachedSocketRouteCandidates(
          { position: parentSocket.position, facing: parentSocket.facing },
          parentNodeSocket,
          {
            connectorFamily: parentConnectorFamily,
            sourceApproachMeters: [5.6, 8.4, 11.2],
          },
        ).map((path) => ({
          path,
          collisionScore: pathPlanningCollisionScore(
            path,
            parentRouteAvoidanceVolumes,
            3.6,
            parentOverlapGrants,
          ),
        }))
        : [];
      const parentAttachmentCollisionScore = parentSocket
        && grant.kind === 'landmark-perimeter-loop'
        ? Math.min(
          Number.POSITIVE_INFINITY,
          ...parentRouteCandidates.map(({ collisionScore }) => collisionScore),
        )
        : 0;
      const currentEntryReserved = Boolean(parentSocket);
      const currentSockets = node.sockets.filter((socket) => (
        socket.state === 'capped'
          && !(currentEntryReserved && socket.localSocketId === parentLocalSocketId)
      ));
      const adjacentDistancesMeters = adjacentPlacedNodes.map(({ node: adjacentNode, index: adjacentIndex }) => {
        if (grant.kind === 'landmark-perimeter-loop') {
          const parentReservedLocalSocketId = (nodeIndex) => {
            if (nodeIndex === 0) return 'entry';
            if (nodeIndex === mainNodeCount - 1) return 'exit';
            return null;
          };
          const usableSockets = (candidateNode, nodeIndex) => {
            const reserved = parentReservedLocalSocketId(nodeIndex);
            return candidateNode.sockets.filter(({ localSocketId }) => localSocketId !== reserved);
          };
          const distances = usableSockets(adjacentNode, adjacentIndex).flatMap((fromSocket) => (
            usableSockets(node, index).flatMap((toSocket) => {
              // Candidate enumeration is deliberately cheap: an exact facing-
              // aware witness is solved jointly after the five nodes and wing
              // are fixed. Running every detour/collision route for every one
              // of hundreds of placement candidates made a single retry take
              // seconds. Manhattan distance is exact for a level orthogonal
              // route; a real vertical transfer optimistically splits its
              // planar arclength at the midpoint. Commit still fails closed.
              const planarDistance = Math.abs(
                Number(toSocket.position.x) - Number(fromSocket.position.x),
              ) + Math.abs(
                Number(toSocket.position.z) - Number(fromSocket.position.z),
              );
              const spineDistance = Math.abs(
                Number(toSocket.position.y) - Number(fromSocket.position.y),
              ) > 1e-6 ? planarDistance * 0.5 : planarDistance;
              // Include the exact parent approach and the real in-room distance
              // for whichever boundary socket this candidate route actually
              // uses.
              const adjacentPrefix = parentAttachmentFeaturelessDistanceForNode(
                adjacentNode,
                adjacentIndex,
                fromSocket.localSocketId,
              );
              const currentPrefix = parentAttachmentFeaturelessDistanceForNode(
                node,
                index,
                toSocket.localSocketId,
              );
              return spineDistance + adjacentPrefix + currentPrefix;
            })
          ));
          return distances.length > 0
            ? Math.min(...distances)
            : Number.POSITIVE_INFINITY;
        }
        const adjacentEntryReserved = grant.kind !== 'landmark-perimeter-loop'
          && coveragePlacement.endpointNodeIndices.includes(adjacentIndex);
        const adjacentSockets = adjacentNode.sockets.filter((socket) => (
          socket.state === 'capped'
            && !(adjacentEntryReserved && socket.localSocketId === 'entry')
        ));
        return Math.min(...adjacentSockets.flatMap((fromSocket) => currentSockets.map((toSocket) => {
          const connectorFamily = Math.abs(
            Number(toSocket.position.y) - Number(fromSocket.position.y),
          ) > 1e-6 ? verticalFamily : 'service-gallery';
          const paths = cachedSocketRouteCandidates(fromSocket, toSocket, {
            connectorFamily,
            ...coverageModuleRouteOptions,
          });
          return paths.length > 0
            ? Math.min(...paths.map(maximumContinuousLevelRouteSpan))
            : Number.POSITIVE_INFINITY;
        })));
      });
      const spineDistanceMeters = adjacentDistancesMeters.length > 0
        ? Math.max(...adjacentDistancesMeters)
        : 0;
      return {
        center,
        facing: candidateFacing,
        orientationOrdinal,
        node,
        collisionScore: collisionScoreForNode(node, avoidanceVolumes),
        parentAttachmentCollisionScore,
        parentAttachmentBlocked: parentAttachmentCollisionScore > 0,
        parentDistanceMeters,
        parentDistanceExceeded: parentSocket
          && parentDistanceMeters > Number(
            profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
          ) + 1e-6,
        spineDistanceMeters,
        spineDistanceExceeded: adjacentPlacedNodes.length > 0
          && spineDistanceMeters > Number(
            profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
          ) + 1e-6,
        displacement: dungeonPointDistance(center, baseCenter),
      };
    }).sort((first, second) => (
      Number(first.parentDistanceExceeded) - Number(second.parentDistanceExceeded)
        || Number(first.spineDistanceExceeded) - Number(second.spineDistanceExceeded)
        || Number(first.parentAttachmentBlocked) - Number(second.parentAttachmentBlocked)
        || first.collisionScore - second.collisionScore
        || first.displacement - second.displacement
        || first.orientationOrdinal - second.orientationOrdinal
    ));
    if (candidatesOnly) return candidates;
    const selected = candidates[0];
    if (!selected
      || selected.parentDistanceExceeded
      || selected.spineDistanceExceeded
      || selected.parentAttachmentBlocked
      || selected.collisionScore > 0) {
      nodePlacementFailureDetails = {
        minimumCollisionScore: selected?.collisionScore ?? null,
        parentDistanceMeters: selected?.parentDistanceMeters ?? null,
        parentDistanceExceeded: selected?.parentDistanceExceeded ?? null,
        spineDistanceMeters: selected?.spineDistanceMeters ?? null,
        spineDistanceExceeded: selected?.spineDistanceExceeded ?? null,
        parentAttachmentCollisionScore: selected?.parentAttachmentCollisionScore ?? null,
        parentAttachmentBlocked: selected?.parentAttachmentBlocked ?? null,
        candidateCenter: selected?.center ?? null,
        collidingVolumeIds: selected
          ? nodePlanningCollisionIds(selected.node, avoidanceVolumes).slice(0, 8)
          : [],
        bestWithinParentDistance: candidates
          .filter(({ parentDistanceExceeded }) => !parentDistanceExceeded)
          .slice(0, 3)
          .map(({ center, collisionScore, parentDistanceMeters }) => ({
            center,
            collisionScore,
            parentDistanceMeters,
          })),
      };
      return null;
    }
    centers[index] = selected.center;
    localPlacementAvoidanceVolumes.push(
      ...selected.node.occupiedVolumes,
      ...selected.node.clearanceVolumes,
    );
    return selected.node;
  };
  const mainNodes = Array.from({ length: mainCenters.length }, () => null);
  let preselectedCoverageSpinePairs = null;
  let preselectedCoverageParentAttachmentPaths = null;
  const placementInputsForIndex = (index) => {
    const endpointOrdinal = grant.kind === 'landmark-perimeter-loop'
      ? index === 0 ? 0 : index === mainCenters.length - 1 ? 1 : -1
      : coveragePlacement?.endpointNodeIndices.indexOf(index) ?? -1;
    // Coverage endpoint modules attach through their `entry` socket, so their
    // local forward axis must inherit the exact parent socket's outward
    // facing. Orienting them along the supplement spine turns an otherwise
    // straight threshold into a dogleg that can re-enter the protected parent
    // gallery at bends.
    const facing = grant.kind !== 'landmark-perimeter-loop' && endpointOrdinal >= 0
      ? endpoints[endpointOrdinal].facing
      : facingForMainNode(index);
    const landmarkCenter = grant.source?.landmarkBounds?.center
      ?? grant.protectedVolumes?.[0]?.center
      ?? null;
    const anchorEndpointOrdinal = Number(
      coveragePlacement?.anchorEndpointOrdinals?.[index],
    );
    const explicitPlacementOutward = coveragePlacement
      ?.placementOutwardFacings?.[index];
    const outward = grant.kind === 'landmark-perimeter-loop' && landmarkCenter
      ? toDungeonCardinalFacing({
        x: mainCenters[index].x - Number(landmarkCenter.x),
        z: mainCenters[index].z - Number(landmarkCenter.z),
      })
      : endpointOrdinal >= 0
        ? endpoints[endpointOrdinal].facing
        : explicitPlacementOutward
          ? explicitPlacementOutward
        : Number.isInteger(anchorEndpointOrdinal) && endpoints[anchorEndpointOrdinal]
          ? endpoints[anchorEndpointOrdinal].facing
        : endpoints.reduce((closest, endpoint, ordinal) => {
          const endpointNodeIndex = coveragePlacement.endpointNodeIndices[ordinal];
          const distance = Math.abs(endpointNodeIndex - index);
          return !closest || distance < closest.distance
            ? { endpoint, distance }
            : closest;
        }, null).endpoint.facing;
    return {
      index,
      facing,
      outward,
      parentSocket: endpointOrdinal >= 0 ? endpoints[endpointOrdinal] : null,
    };
  };
  const adjacentPlacedNodesForIndex = (index) => [index - 1, index + 1]
    .filter((adjacentIndex) => mainNodes[adjacentIndex])
    .map((adjacentIndex) => ({ node: mainNodes[adjacentIndex], index: adjacentIndex }));
  const placeNodeAtIndex = (index) => {
    const inputs = placementInputsForIndex(index);
    const node = placeCollisionSafeNode(
      index,
      centers[index],
      inputs.facing,
      inputs.outward,
      inputs.parentSocket,
      adjacentPlacedNodesForIndex(index),
    );
    if (!node) {
      return {
        error: 'route-network-node-placement-collision',
        context: { grantId: grant.id, nodeIndex: index, ...nodePlacementFailureDetails },
      };
    }
    mainNodes[index] = node;
    return null;
  };
  if (grant.kind === 'landmark-perimeter-loop') {
    // Reserve both exact parent attachments before filling the perimeter.
    for (const index of [0, mainCenters.length - 1]) {
      const failure = placeNodeAtIndex(index);
      if (failure) return failure;
    }
    const interiorIndices = Array.from(
      { length: Math.max(0, mainCenters.length - 2) },
      (_, ordinal) => ordinal + 1,
    );
    if (interiorIndices.length === 2) {
      // The V4 pyramid has two large rooms on its perimeter spine. Choosing
      // either greedily can consume every non-overlapping placement within the
      // opposite endpoint's accumulated featureless bound. Solve the pair as
      // one bounded problem while the full-size endpoint rooms remain fixed
      // and exact.
      const [firstIndex, secondIndex] = interiorIndices;
      const fixedAvoidanceVolumes = [...localPlacementAvoidanceVolumes];
      const validPlacementCandidate = (candidate) => (
        candidate
          && candidate.collisionScore === 0
          && !candidate.parentDistanceExceeded
          && !candidate.spineDistanceExceeded
          && !candidate.parentAttachmentBlocked
      );
      const exactAdjacentRouteWitness = (
        fromNode,
        fromIndex,
        toNode,
        toIndex,
        avoidanceVolumes,
        diagnostics = null,
      ) => {
        const routeAvoidanceVolumes = avoidanceVolumes.filter((volume) => (
          !planningVolumeOwnedByAny(volume, [fromNode.id, toNode.id])
        ));
        const parentReservedLocalSocketId = (nodeIndex) => {
          if (nodeIndex === 0) return 'entry';
          if (nodeIndex === mainNodeCount - 1) return 'exit';
          return null;
        };
        const usableSockets = (node, nodeIndex) => node.sockets.filter(({ localSocketId }) => (
          localSocketId !== parentReservedLocalSocketId(nodeIndex)
        ));
        const rawCandidates = usableSockets(fromNode, fromIndex).flatMap((fromSocket) => (
          usableSockets(toNode, toIndex).flatMap((toSocket) => {
            const connectorFamily = Math.abs(
              Number(toSocket.position.y) - Number(fromSocket.position.y),
            ) > 1e-6 ? verticalFamily : 'service-gallery';
            return cachedSocketRouteCandidates(fromSocket, toSocket, {
              connectorFamily,
              ...coverageModuleRouteOptions,
            }).map((path) => ({
              path,
              distanceMeters: maximumContinuousLevelRouteSpan(path)
                + parentAttachmentFeaturelessDistanceForNode(
                  fromNode,
                  fromIndex,
                  fromSocket.localSocketId,
                )
                + parentAttachmentFeaturelessDistanceForNode(
                  toNode,
                  toIndex,
                  toSocket.localSocketId,
                ),
              collisionScore: pathPlanningCollisionScore(path, routeAvoidanceVolumes),
            }));
          })
        ));
        const collisionFreeCandidates = rawCandidates.filter(({ collisionScore }) => (
          collisionScore === 0
        ));
        const candidates = collisionFreeCandidates.filter(({ distanceMeters }) => (
          distanceMeters <= Number(
              profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
            ) + 1e-6
        )).sort((first, second) => (
          first.distanceMeters - second.distanceMeters
            || measureDungeonPolyline(first.path) - measureDungeonPolyline(second.path)
        ));
        if (diagnostics && typeof diagnostics === 'object') {
          Object.assign(diagnostics, {
            fromNodeId: fromNode.id,
            toNodeId: toNode.id,
            routeCandidateCount: rawCandidates.length,
            collisionFreeCandidateCount: collisionFreeCandidates.length,
            featurelessEligibleCandidateCount: candidates.length,
            minimumFeaturelessDistanceMeters: collisionFreeCandidates.length > 0
              ? Math.min(...collisionFreeCandidates.map(({ distanceMeters }) => distanceMeters))
              : null,
          });
        }
        return candidates[0] ?? null;
      };
      const firstInputs = placementInputsForIndex(firstIndex);
      const rawFirstCandidates = placeCollisionSafeNode(
        firstIndex,
        centers[firstIndex],
        firstInputs.facing,
        firstInputs.outward,
        null,
        [{ node: mainNodes[0], index: 0 }],
        {
          candidatesOnly: true,
          avoidanceVolumes: fixedAvoidanceVolumes,
        },
      );
      const firstCandidates = rawFirstCandidates.filter(validPlacementCandidate).slice(0, 96);
      let selectedPair = null;
      const pairPlacementDiagnostics = [];
      for (const firstCandidate of firstCandidates) {
        const firstVolumes = [
          ...(firstCandidate.node.occupiedVolumes ?? []),
          ...(firstCandidate.node.clearanceVolumes ?? []),
        ];
        const entryRouteDiagnostics = {};
        const entryRouteWitness = exactAdjacentRouteWitness(
          mainNodes[0],
          0,
          firstCandidate.node,
          firstIndex,
          [...fixedAvoidanceVolumes, ...firstVolumes],
          entryRouteDiagnostics,
        );
        // The joint solver previously checked only the two latter spine edges.
        // Once a landmark endpoint room relocates around authored geometry, a
        // cheap Manhattan precheck can still admit a dogleg whose real level
        // span exceeds 33.6m. Require the first physical edge here as well so
        // the selected five-room layout is realizable end to end.
        if (!entryRouteWitness) {
          pairPlacementDiagnostics.push({
            firstCenter: cloneDungeonAugmentationValue(firstCandidate.center),
            secondCandidateCount: 0,
            entryRouteDiagnostics,
          });
          continue;
        }
        const secondInputs = placementInputsForIndex(secondIndex);
        const rawSecondCandidates = placeCollisionSafeNode(
          secondIndex,
          centers[secondIndex],
          secondInputs.facing,
          secondInputs.outward,
          null,
          [
            { node: firstCandidate.node, index: firstIndex },
            { node: mainNodes.at(-1), index: mainCenters.length - 1 },
          ],
          {
            candidatesOnly: true,
            avoidanceVolumes: [...fixedAvoidanceVolumes, ...firstVolumes],
          },
        );
        const secondCandidates = rawSecondCandidates.filter(validPlacementCandidate);
        pairPlacementDiagnostics.push({
          firstCenter: cloneDungeonAugmentationValue(firstCandidate.center),
          secondCandidateCount: secondCandidates.length,
          bestSecondCandidates: rawSecondCandidates.slice(0, 4).map((candidate) => ({
            center: cloneDungeonAugmentationValue(candidate.center),
            collisionScore: candidate.collisionScore,
            spineDistanceMeters: candidate.spineDistanceMeters,
            spineDistanceExceeded: candidate.spineDistanceExceeded,
          })),
        });
        // The cheap placement metric is only a forward check. A vertical
        // connector is snapped to a 2.8m transfer tile and may therefore have
        // a slightly longer level run than half its Manhattan distance. Pick
        // the first deterministic candidate with a real collision-free route
        // witness inside the 33.6m featureless bound.
        const secondCandidate = secondCandidates.find((candidate) => (
          exactAdjacentRouteWitness(
            firstCandidate.node,
            firstIndex,
            candidate.node,
            secondIndex,
            [
              ...fixedAvoidanceVolumes,
              ...firstVolumes,
              ...(candidate.node.occupiedVolumes ?? []),
              ...(candidate.node.clearanceVolumes ?? []),
            ],
          )
            && exactAdjacentRouteWitness(
              candidate.node,
              secondIndex,
              mainNodes.at(-1),
              mainCenters.length - 1,
              [
                ...fixedAvoidanceVolumes,
                ...firstVolumes,
                ...(candidate.node.occupiedVolumes ?? []),
                ...(candidate.node.clearanceVolumes ?? []),
              ],
            )
        )) ?? null;
        if (!secondCandidate) {
          const currentPairDiagnostics = pairPlacementDiagnostics.at(-1);
          if (currentPairDiagnostics && secondCandidates.length > 0) {
            currentPairDiagnostics.exactRouteDiagnostics = secondCandidates
              .slice(0, 4)
              .map((candidate) => {
                const middle = {};
                const endpoint = {};
                const candidateAvoidanceVolumes = [
                  ...fixedAvoidanceVolumes,
                  ...firstVolumes,
                  ...(candidate.node.occupiedVolumes ?? []),
                  ...(candidate.node.clearanceVolumes ?? []),
                ];
                exactAdjacentRouteWitness(
                  firstCandidate.node,
                  firstIndex,
                  candidate.node,
                  secondIndex,
                  candidateAvoidanceVolumes,
                  middle,
                );
                exactAdjacentRouteWitness(
                  candidate.node,
                  secondIndex,
                  mainNodes.at(-1),
                  mainCenters.length - 1,
                  candidateAvoidanceVolumes,
                  endpoint,
                );
                return {
                  center: cloneDungeonAugmentationValue(candidate.center),
                  middle,
                  endpoint,
                };
              });
          }
          continue;
        }
        selectedPair = { firstCandidate, secondCandidate };
        break;
      }
      if (!selectedPair) {
        return {
          error: 'pyramid-loop-room-pair-placement-unavailable',
          context: {
            grantId: grant.id,
            topologyTemplateId,
            elevationMode,
            selectedGrammarIds: selectedGrammars.map(({ id }) => id),
            firstNodeIndex: firstIndex,
            secondNodeIndex: secondIndex,
            firstCandidateCount: firstCandidates.length,
            firstCandidateCenters: firstCandidates.slice(0, 8).map(({ center }) => (
              cloneDungeonAugmentationValue(center)
            )),
            nearestRawFirstCandidates: rawFirstCandidates
              .slice()
              .sort((first, second) => first.displacement - second.displacement)
              .slice(0, 8)
              .map((candidate) => ({
                center: cloneDungeonAugmentationValue(candidate.center),
                collisionScore: candidate.collisionScore,
                collidingVolumeIds: nodePlanningCollisionIds(
                  candidate.node,
                  fixedAvoidanceVolumes,
                ).slice(0, 8),
                spineDistanceMeters: candidate.spineDistanceMeters,
                spineDistanceExceeded: candidate.spineDistanceExceeded,
              })),
            pairPlacementDiagnostics: pairPlacementDiagnostics.slice(0, 8),
          },
        };
      }
      for (const [index, candidate] of [
        [firstIndex, selectedPair.firstCandidate],
        [secondIndex, selectedPair.secondCandidate],
      ]) {
        centers[index] = candidate.center;
        mainNodes[index] = candidate.node;
        localPlacementAvoidanceVolumes.push(
          ...(candidate.node.occupiedVolumes ?? []),
          ...(candidate.node.clearanceVolumes ?? []),
        );
      }
    } else {
      // Keep a deterministic fallback for non-standard fixtures while the V4
      // host continues to grant the specified five-module pyramid network.
      for (const index of [...interiorIndices].reverse()) {
        const failure = placeNodeAtIndex(index);
        if (failure) return failure;
      }
    }
  } else {
    // Solve every coverage module as one bounded placement problem. Endpoint-
    // only reservation still lets an interior bend consume a future endpoint,
    // or lets the chosen endpoints leave no collision-free placement between
    // them on a winding authored route. Joint search keeps the immutable base
    // proxy, parent threshold reach, pairwise room clearance, and adjacent
    // connector bounds in the same decision.
    const staticAvoidanceVolumes = [...localPlacementAvoidanceVolumes];
    const planningIndexCellMeters = 8.4;
    const staticAvoidanceVolumeBuckets = new Map();
    const unindexedStaticAvoidanceVolumes = [];
    const planningVolumeCellBounds = (volume) => {
      const halfX = Number(volume?.size?.x ?? 0) * 0.5;
      const halfZ = Number(volume?.size?.z ?? 0) * 0.5;
      return {
        minimumX: Math.floor(
          (Number(volume?.center?.x ?? 0) - halfX) / planningIndexCellMeters,
        ),
        maximumX: Math.floor(
          (Number(volume?.center?.x ?? 0) + halfX) / planningIndexCellMeters,
        ),
        minimumZ: Math.floor(
          (Number(volume?.center?.z ?? 0) - halfZ) / planningIndexCellMeters,
        ),
        maximumZ: Math.floor(
          (Number(volume?.center?.z ?? 0) + halfZ) / planningIndexCellMeters,
        ),
      };
    };
    const planningBucketKey = (cellX, cellZ) => `${cellX}:${cellZ}`;
    for (const volume of staticAvoidanceVolumes) {
      const bounds = planningVolumeCellBounds(volume);
      const bucketCount = (bounds.maximumX - bounds.minimumX + 1)
        * (bounds.maximumZ - bounds.minimumZ + 1);
      if (!Number.isFinite(bucketCount) || bucketCount > 4096) {
        unindexedStaticAvoidanceVolumes.push(volume);
        continue;
      }
      for (let cellX = bounds.minimumX; cellX <= bounds.maximumX; cellX += 1) {
        for (let cellZ = bounds.minimumZ; cellZ <= bounds.maximumZ; cellZ += 1) {
          const key = planningBucketKey(cellX, cellZ);
          const bucket = staticAvoidanceVolumeBuckets.get(key) ?? [];
          bucket.push(volume);
          staticAvoidanceVolumeBuckets.set(key, bucket);
        }
      }
    }
    const nearbyStaticAvoidanceVolumes = (queryVolume) => {
      const bounds = planningVolumeCellBounds(queryVolume);
      const volumes = new Set(unindexedStaticAvoidanceVolumes);
      for (let cellX = bounds.minimumX; cellX <= bounds.maximumX; cellX += 1) {
        for (let cellZ = bounds.minimumZ; cellZ <= bounds.maximumZ; cellZ += 1) {
          for (const volume of (
            staticAvoidanceVolumeBuckets.get(planningBucketKey(cellX, cellZ)) ?? []
          )) volumes.add(volume);
        }
      }
      return volumes;
    };
    const indexedStaticPathVolumesHaveCollision = (pathVolumes) => (
      pathVolumes.some((pathVolume) => (
        [...nearbyStaticAvoidanceVolumes(pathVolume)].some((obstacle) => (
          planningVolumesOverlap(pathVolume, obstacle)
        ))
      ))
    );
    const indexedStaticNodeCollisionScore = (node, overlapGrants = []) => (
      [...(node.occupiedVolumes ?? []), ...(node.clearanceVolumes ?? [])]
        .reduce((score, nodeVolume) => (
          score + [...nearbyStaticAvoidanceVolumes(nodeVolume)].reduce((count, obstacle) => (
            count + (planningVolumesOverlap(nodeVolume, obstacle)
              && !planningOverlapIsGranted(
                nodeVolume,
                obstacle,
                overlapGrants.filter(({ moduleTemplateId }) => (
                  !moduleTemplateId || String(moduleTemplateId) === String(node.grammarId)
                )),
              ) ? 1 : 0)
          ), 0)
        ), 0)
    );
    const maximumSpan = Number(profile.routeNetworkPlanning.maximumFeaturelessSpanMeters);
    const featurelessPathDistance = maximumContinuousLevelRouteSpan;
    const endpointOrdinalForNodeIndex = (index) => (
      coveragePlacement.endpointNodeIndices.indexOf(index)
    );
    const parentAttachmentContextByNodeIndex = new Map(
      coveragePlacement.endpointNodeIndices.map((nodeIndex, endpointOrdinal) => {
        const parentSocket = endpoints[endpointOrdinal];
        const landingOverlapGrant = (grant.socketLandingOverlapGrants ?? []).find(({ socketId }) => (
          String(socketId) === String(parentSocket.id)
        )) ?? null;
        return [nodeIndex, {
          endpointOrdinal,
          parentSocket,
          routeAvoidanceVolumes: staticAvoidanceVolumes.filter((volume) => (
            !isGrantedParentGalleryThresholdVolume(volume, landingOverlapGrant)
          )),
        }];
      }),
    );
    const candidateNodeVolumeCache = new WeakMap();
    const candidateNodeVolumes = (candidate) => {
      if (!candidateNodeVolumeCache.has(candidate)) {
        candidateNodeVolumeCache.set(candidate, [
          ...(candidate?.node?.occupiedVolumes ?? []),
          ...(candidate?.node?.clearanceVolumes ?? []),
        ]);
      }
      return candidateNodeVolumeCache.get(candidate);
    };
    const parentAttachmentForCandidate = (candidate, index) => {
      const endpointOrdinal = endpointOrdinalForNodeIndex(index);
      if (endpointOrdinal < 0) return { compatible: true, path: null };
      const attachmentContext = parentAttachmentContextByNodeIndex.get(index);
      const { parentSocket, routeAvoidanceVolumes } = attachmentContext;
      const nodeSocket = getNodeSocket(candidate.node, 'entry');
      // The host grants two adjacent pieces of the exact corridor station:
      // the centered doorway landing and the authored Through-T merge body.
      // Canonical Industrial clearance columns are deliberately wider than a
      // floor tile, so the short parent attachment can intersect both grants
      // even though its physical centerline never leaves the approved socket.
      // Final validation already evaluates this same union; use it during
      // placement as well so the global solver cannot reject its only exact
      // production station for an overlap that realization later permits.
      const parentAttachmentOverlapGrants = [
        ...(grant.socketLandingOverlapGrants ?? []).filter(({ socketId }) => (
          String(socketId) === String(parentSocket.id)
        )),
        ...(grant.socketModuleOverlapGrants ?? []).filter(({
          socketId,
          moduleTemplateId,
        }) => (
          String(socketId) === String(parentSocket.id)
            && (!moduleTemplateId
              || String(moduleTemplateId) === String(candidate.node.grammarId))
        )),
      ];
      const parentConnectorFamily = Math.abs(
        Number(nodeSocket.position.y) - Number(parentSocket.position.y),
      ) > 1e-6 ? verticalFamily : 'service-gallery';
      const selectedParentAttachment = collisionAvoidingParentAttachmentPath(
        { position: parentSocket.position, facing: parentSocket.facing },
        nodeSocket,
        routeAvoidanceVolumes,
        true,
        parentAttachmentOverlapGrants,
        parentConnectorFamily,
        2.8,
        true,
      );
      const path = selectedParentAttachment?.path ?? null;
      if (!path || path.length < 2) {
        return {
          compatible: false,
          path: null,
          pathVolumes: [],
          collisionScore: Number.POSITIVE_INFINITY,
          distanceMeters: Number.POSITIVE_INFINITY,
          routeAvoidanceVolumes,
          overlapGrants: parentAttachmentOverlapGrants,
        };
      }
      const collisionScore = selectedParentAttachment.collisionScore;
      const distanceMeters = featurelessPathDistance(path);
      return {
        compatible: collisionScore === 0 && distanceMeters <= maximumSpan + 1e-6,
        path,
        pathVolumes: selectedParentAttachment.pathVolumes,
        collisionScore,
        distanceMeters,
        routeAvoidanceVolumes,
        overlapGrants: parentAttachmentOverlapGrants,
      };
    };
    const staticParentAttachmentCache = new WeakMap();
    const staticParentAttachmentForCandidate = (candidate, index) => {
      if (!staticParentAttachmentCache.has(candidate)) {
        staticParentAttachmentCache.set(
          candidate,
          parentAttachmentForCandidate(candidate, index),
        );
      }
      return staticParentAttachmentCache.get(candidate);
    };
    const coverageSocketBindingKey = (firstIndex, secondIndex) => (
      firstIndex < secondIndex
        ? `${firstIndex}:${secondIndex}`
        : `${secondIndex}:${firstIndex}`
    );
    const requiredCoverageSocketBindingByKey = new Map(
      (coveragePlacement?.requiredSocketBindings ?? []).map((binding) => [
        coverageSocketBindingKey(binding.fromIndex, binding.toIndex),
        binding,
      ]),
    );
    const requiredLocalSocketIdForPair = (nodeIndex, adjacentNodeIndex) => {
      const binding = requiredCoverageSocketBindingByKey.get(
        coverageSocketBindingKey(nodeIndex, adjacentNodeIndex),
      );
      if (!binding) return null;
      return binding.fromIndex === nodeIndex
        ? binding.fromLocalSocketId
        : binding.toLocalSocketId;
    };
    const availableSpineSockets = (node, index, adjacentIndex = null) => {
      const requiredLocalSocketId = adjacentIndex == null
        ? null
        : requiredLocalSocketIdForPair(index, adjacentIndex);
      return node.sockets.filter((socket) => (
        socket.state === 'capped'
          && !(endpointNodeIndexSet.has(index) && socket.localSocketId === 'entry')
          && (!requiredLocalSocketId
            || socket.localSocketId === requiredLocalSocketId)
      ));
    };
    const minimumSpineDistance = (
      firstNode,
      firstIndex,
      secondNode,
      secondIndex,
    ) => (
      Math.min(...availableSpineSockets(firstNode, firstIndex, secondIndex)
        .flatMap((firstSocket) => (
        availableSpineSockets(secondNode, secondIndex, firstIndex).map((secondSocket) => (
          (() => {
            const deltaX = Math.abs(
              Number(secondSocket.position.x) - Number(firstSocket.position.x),
            );
            const deltaY = Math.abs(
              Number(secondSocket.position.y) - Number(firstSocket.position.y),
            );
            const deltaZ = Math.abs(
              Number(secondSocket.position.z) - Number(firstSocket.position.z),
            );
            // Match featurelessPathDistance exactly. A real elevation-changing
            // connector is itself a meaningful reset: the segment containing
            // the vertical transfer contributes no featureless distance. For
            // an L path only its first, level leg contributes, so choose the
            // shorter ordering. The exact physical witness remains mandatory.
            if (deltaY > 1e-6) {
              if (deltaX <= 1e-6 || deltaZ <= 1e-6) return 0;
              return Math.min(deltaX, deltaZ);
            }
            return deltaX + deltaZ;
          })()
        ))
      )))
    );
    const selectBoundedPlacementCandidates = (
      validCandidates,
      endpoint,
      baseCenter,
      grammar,
      preferredOutward,
      preferredAdjacentEndpointTargets = [],
    ) => {
      // Corridor stations are exact host-authored 5x7 merge witnesses. Their
      // first compatible candidate is the signed module center covered by the
      // socketModuleOverlapGrant; moving that station multiplies the global
      // search and weakens the exact endpoint contract. Interior modules keep
      // a bounded local/tangent spread for genuine backtracking.
      const movableDenseCoverageEndpoint = endpoint
        && grant.kind === 'objective-route-coverage'
        && endpoints.length >= 3
        // objectiveCoverageExternalPlacement has already solved these station
        // centers together with its exact socket/path witnesses. Moving one of
        // those stations here invalidates that global solution and makes the
        // physical pass route a different network. Only the legacy/fallback
        // coverage expansion may spread dense endpoint stations locally.
        && !Array.isArray(coveragePlacement?.externalRoutePaths);
      const globallyPlacedObjectiveCoverage = grant.kind === 'objective-route-coverage';
      // Dense authored connectors frequently leave several disjoint legal
      // pockets around their reserved gallery. Twelve samples are enough for
      // an endpoint station, but can consume an interior module's entire bag
      // on the near side of those pockets before the deterministic radius
      // sweep reaches a routable pair. Keep a wider, still bounded domain for
      // the global solver; its 20k-visit cap remains the hard search budget.
      const limit = endpoint
        ? movableDenseCoverageEndpoint ? 24 : 1
        : globallyPlacedObjectiveCoverage ? 64 : 12;
      if (validCandidates.length <= limit) return validCandidates;
      if (endpoint) {
        // Keep the best local attachments, but retain a deterministic spread
        // across the complete legal outward range. Nearest-only truncation can
        // place every endpoint module beside a widened parent gallery even
        // though farther candidates (still within the exact 33.6 m attachment
        // bound) have a clear supplement-side egress.
        const localCount = 6;
        const selected = new Set(validCandidates.slice(0, localCount));
        const remainingSlots = limit - selected.size;
        for (let slot = 1; slot <= remainingSlots; slot += 1) {
          const candidateIndex = Math.min(
            validCandidates.length - 1,
            localCount - 1 + Math.round(
              (validCandidates.length - localCount) * slot / remainingSlots,
            ),
          );
          selected.add(validCandidates[candidateIndex]);
        }
        for (const candidate of validCandidates) {
          selected.add(candidate);
          if (selected.size >= limit) break;
        }
        return [...selected].slice(0, limit);
      }
      // Preserve the best local placements, then sample the full valid
      // displacement range. A nearest-only cap omitted the farther tangent
      // reset needed to route around a finite authored room at an L-turn.
      const localCount = 8;
      const selected = new Set();
      if (globallyPlacedObjectiveCoverage) {
        // At a bend the global solver must decide whether the turn happens
        // before or after an authored module. Retain the base position and its
        // one-tile neighborhood for every legal rotation. Keeping only two
        // shuffled ties can omit the single 2.8 m tangent shift that aligns
        // opposing authored sockets, leaving only an invalid diagonal elbow.
        const candidatesByFacing = new Map();
        for (const candidate of validCandidates) {
          const key = `${Number(candidate.facing?.x ?? 0).toFixed(0)}:${Number(
            candidate.facing?.z ?? 0,
          ).toFixed(0)}`;
          const group = candidatesByFacing.get(key) ?? [];
          group.push(candidate);
          candidatesByFacing.set(key, group);
        }
        for (const group of candidatesByFacing.values()) {
          for (const candidate of group.slice(0, 8)) selected.add(candidate);
        }
      } else {
        for (const candidate of validCandidates.slice(0, localCount)) selected.add(candidate);
      }
      const grammarClearanceRadius = Math.max(
        Number(grammar?.size?.width ?? 19.6),
        Number(grammar?.size?.depth ?? 19.6),
      ) * 0.5 + 5.6;
      // An interior room beside an exact endpoint has a unique clearance-tight
      // target: one half-envelope plus the connector gap away from the compact
      // endpoint module. Preserve that candidate before sampling farther
      // displacements, or the local eight can omit the first non-overlapping
      // placement and make an otherwise bounded featureless run look too long.
      for (const preferredAdjacentEndpointTarget of preferredAdjacentEndpointTargets) {
        const closest = [...validCandidates].sort((first, second) => (
          Math.hypot(
            first.center.x - preferredAdjacentEndpointTarget.x,
            first.center.z - preferredAdjacentEndpointTarget.z,
          ) - Math.hypot(
            second.center.x - preferredAdjacentEndpointTarget.x,
            second.center.z - preferredAdjacentEndpointTarget.z,
          ) || first.displacement - second.displacement
        ))[0];
        if (closest) selected.add(closest);
      }
      // Reserve outward continuation choices before generic envelope/cardinal
      // sampling. The old code overfilled `selected` from the first future
      // envelope and then truncated to the limit, so its later radius spread
      // was unreachable. That can strand a vertical reconnect beside its
      // endpoint with too little planar run for the selected connector family.
      if (preferredOutward) {
        const outward = toDungeonCardinalFacing(preferredOutward);
        for (const distance of [grammarClearanceRadius, grammarClearanceRadius * 2]) {
          const targetX = Number(baseCenter.x) + outward.x * distance;
          const targetZ = Number(baseCenter.z) + outward.z * distance;
          const closest = [...validCandidates].sort((first, second) => (
            Math.hypot(first.center.x - targetX, first.center.z - targetZ)
              - Math.hypot(second.center.x - targetX, second.center.z - targetZ)
              || first.displacement - second.displacement
          ))[0];
          if (closest) selected.add(closest);
        }
      }
      const futureEndpointEnvelopes = staticAvoidanceVolumes
        .filter(({ purpose }) => purpose === 'future-route-network-endpoint-envelope-reservation')
        .sort((first, second) => (
          Math.hypot(
            Number(first.center.x) - Number(baseCenter.x),
            Number(first.center.z) - Number(baseCenter.z),
          ) - Math.hypot(
            Number(second.center.x) - Number(baseCenter.x),
            Number(second.center.z) - Number(baseCenter.z),
          ) || String(first.id).localeCompare(String(second.id))
        ))
        .slice(0, 4);
      for (const volume of futureEndpointEnvelopes) {
        const offsetX = Number(volume.size.x) * 0.5 + grammarClearanceRadius;
        const offsetZ = Number(volume.size.z) * 0.5 + grammarClearanceRadius;
        for (const [targetX, targetZ] of [
          [Number(volume.center.x) - offsetX, Number(volume.center.z)],
          [Number(volume.center.x) + offsetX, Number(volume.center.z)],
          [Number(volume.center.x), Number(volume.center.z) - offsetZ],
          [Number(volume.center.x), Number(volume.center.z) + offsetZ],
        ]) {
          const closest = [...validCandidates].sort((first, second) => (
            Math.hypot(first.center.x - targetX, first.center.z - targetZ)
              - Math.hypot(second.center.x - targetX, second.center.z - targetZ)
              || first.displacement - second.displacement
          ))[0];
          if (closest) selected.add(closest);
        }
      }
      const directions = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1],
      ];
      for (const radius of [16.8, 33.6, 50.4, 75.6]) {
        for (const [directionX, directionZ] of directions) {
          const targetX = baseCenter.x + directionX * radius;
          const targetZ = baseCenter.z + directionZ * radius;
          const closest = [...validCandidates].sort((first, second) => (
            Math.hypot(first.center.x - targetX, first.center.z - targetZ)
              - Math.hypot(second.center.x - targetX, second.center.z - targetZ)
              || first.displacement - second.displacement
          ))[0];
          if (closest) selected.add(closest);
        }
      }
      const remainingSlots = limit - selected.size;
      for (let slot = 1; slot <= remainingSlots; slot += 1) {
        const candidateIndex = Math.min(
          validCandidates.length - 1,
          localCount - 1 + Math.round(
            (validCandidates.length - localCount) * slot / Math.max(1, remainingSlots),
          ),
        );
        selected.add(validCandidates[candidateIndex]);
      }
      if (selected.size < limit) {
        for (const candidate of validCandidates) {
          selected.add(candidate);
          if (selected.size >= limit) break;
        }
      }
      return [...selected].slice(0, limit);
    };
    const placementCandidateGroups = mainCenters.map((_, index) => {
      const inputs = placementInputsForIndex(index);
      const endpointOrdinal = endpointOrdinalForNodeIndex(index);
      const endpointOverlapGrants = endpointOrdinal >= 0
        ? [
          ...(grant.socketLandingOverlapGrants ?? []),
          ...(grant.socketModuleOverlapGrants ?? []),
        ].filter(({ socketId }) => (
          String(socketId) === String(endpoints[endpointOrdinal]?.id)
        ))
        : [];
      const rawCandidates = placeCollisionSafeNode(
        index,
        centers[index],
        inputs.facing,
        inputs.outward,
        inputs.parentSocket,
        [],
        {
          candidatesOnly: true,
          avoidanceVolumes: staticAvoidanceVolumes,
          collisionScoreForNode: (node) => indexedStaticNodeCollisionScore(
            node,
            endpointOverlapGrants,
          ),
        },
      );
      const nodeValidCandidates = rawCandidates.filter((candidate) => (
        !candidate.parentDistanceExceeded
          && candidate.collisionScore === 0
      ));
      let parentAttachmentCandidatesEvaluated = 0;
      let parentAttachmentRejectedCount = 0;
      let bestRejectedParentAttachment = null;
      const adjacentEndpointNodeIndices = [...endpointNodeIndexSet]
        .filter((endpointNodeIndex) => Math.abs(endpointNodeIndex - index) === 1);
      const preferredAdjacentEndpointTargets = endpointOrdinal < 0
        ? adjacentEndpointNodeIndices.flatMap((adjacentEndpointNodeIndex) => {
          const endpointGrammar = selectedGrammars[adjacentEndpointNodeIndex];
          const awayFromEndpoint = toDungeonCardinalFacing({
            x: Number(centers[index].x) - Number(centers[adjacentEndpointNodeIndex].x),
            z: Number(centers[index].z) - Number(centers[adjacentEndpointNodeIndex].z),
          });
          const centerSeparationMeters = Math.max(
            Number(selectedGrammars[index]?.size?.width ?? 19.6),
            Number(selectedGrammars[index]?.size?.depth ?? 19.6),
          ) * 0.5 + Math.max(
            Number(endpointGrammar?.size?.width ?? 19.6),
            Number(endpointGrammar?.size?.depth ?? 19.6),
          ) * 0.5 + connectorEndpointGapMeters;
          const directTarget = addDungeonPoints(
            centers[adjacentEndpointNodeIndex],
            scaleDungeonPoint(awayFromEndpoint, centerSeparationMeters),
          );
          if (adjacentEndpointNodeIndices.length < 2) return [directTarget];
          const otherEndpointCenters = adjacentEndpointNodeIndices
            .filter((otherIndex) => otherIndex !== adjacentEndpointNodeIndex)
            .map((otherIndex) => centers[otherIndex]);
          const otherCenter = {
            x: otherEndpointCenters.reduce((sum, center) => sum + Number(center.x), 0)
              / otherEndpointCenters.length,
            y: Number(centers[adjacentEndpointNodeIndex].y),
            z: otherEndpointCenters.reduce((sum, center) => sum + Number(center.z), 0)
              / otherEndpointCenters.length,
          };
          const awayFromOtherEndpoint = toDungeonCardinalFacing({
            x: Number(centers[adjacentEndpointNodeIndex].x) - otherCenter.x,
            z: Number(centers[adjacentEndpointNodeIndex].z) - otherCenter.z,
          });
          return [
            directTarget,
            addDungeonPoints(
              directTarget,
              scaleDungeonPoint(
                awayFromOtherEndpoint,
                connectorEndpointGapMeters,
              ),
            ),
          ];
        })
        : [];
      let candidates;
      if (endpointNodeIndexSet.has(index)) {
        // Validate the complete collision-free, in-range endpoint domain, then
        // keep a bounded deterministic spread. This preserves global solver
        // performance without losing the farther egress that clears a widened
        // authored connector footprint.
        const compatibleCandidates = [];
        for (const candidate of nodeValidCandidates) {
          parentAttachmentCandidatesEvaluated += 1;
          const attachment = staticParentAttachmentForCandidate(candidate, index);
          if (attachment.compatible) {
            compatibleCandidates.push(candidate);
          } else {
            parentAttachmentRejectedCount += 1;
            if (!bestRejectedParentAttachment
              || attachment.collisionScore < bestRejectedParentAttachment.collisionScore
              || (attachment.collisionScore === bestRejectedParentAttachment.collisionScore
                && attachment.distanceMeters < bestRejectedParentAttachment.distanceMeters)) {
              bestRejectedParentAttachment = {
                center: cloneDungeonAugmentationValue(candidate.center),
                path: cloneDungeonAugmentationValue(attachment.path),
                collisionScore: attachment.collisionScore,
                distanceMeters: attachment.distanceMeters,
                blockingVolumeIds: attachment.path
                  ? pathPlanningCollisionIds(
                    attachment.path,
                    attachment.routeAvoidanceVolumes,
                    3.6,
                    attachment.overlapGrants ?? [],
                  ).slice(0, 12)
                  : [],
              };
            }
          }
        }
        candidates = selectBoundedPlacementCandidates(
          compatibleCandidates,
          true,
          centers[index],
          selectedGrammars[index],
          inputs.outward,
          null,
        );
      } else {
        candidates = selectBoundedPlacementCandidates(
          nodeValidCandidates,
          false,
          centers[index],
          selectedGrammars[index],
          inputs.outward,
          preferredAdjacentEndpointTargets,
        );
      }
      const withinParentDistance = rawCandidates.filter(({ parentDistanceExceeded }) => (
        !parentDistanceExceeded
      ));
      const collisionFree = rawCandidates.filter(({ collisionScore }) => collisionScore === 0);
      const minimumCollisionCandidate = [...withinParentDistance].sort((first, second) => (
        first.collisionScore - second.collisionScore
          || first.parentDistanceMeters - second.parentDistanceMeters
          || first.displacement - second.displacement
      ))[0] ?? rawCandidates[0] ?? null;
      const minimumParentDistanceCandidate = [...collisionFree].sort((first, second) => (
        first.parentDistanceMeters - second.parentDistanceMeters
          || first.collisionScore - second.collisionScore
          || first.displacement - second.displacement
      ))[0] ?? rawCandidates[0] ?? null;
      return {
        index,
        candidates,
        endpoint: endpointNodeIndexSet.has(index),
        diagnostics: {
          baseCenterCandidate: (() => {
            const candidate = [...rawCandidates].sort((first, second) => (
              first.displacement - second.displacement
            ))[0] ?? null;
            return candidate ? {
              center: cloneDungeonAugmentationValue(candidate.center),
              collisionScore: candidate.collisionScore,
              parentDistanceMeters: candidate.parentDistanceMeters,
              parentDistanceExceeded: candidate.parentDistanceExceeded,
              collidingVolumeIds: nodePlanningCollisionIds(
                candidate.node,
                staticAvoidanceVolumes,
              ).slice(0, 12),
            } : null;
          })(),
          rawCandidateCount: rawCandidates.length,
          withinParentDistanceCount: withinParentDistance.length,
          collisionFreeCount: collisionFree.length,
          parentAttachmentCompatibleCount: endpointNodeIndexSet.has(index)
            ? candidates.length
            : null,
          parentAttachmentCandidatesEvaluated: endpointNodeIndexSet.has(index)
            ? parentAttachmentCandidatesEvaluated
            : null,
          parentAttachmentRejectedCount: endpointNodeIndexSet.has(index)
            ? parentAttachmentRejectedCount
            : null,
          bestRejectedParentAttachment: endpointNodeIndexSet.has(index)
            ? bestRejectedParentAttachment
            : null,
          minimumCollisionScore: minimumCollisionCandidate?.collisionScore ?? null,
          minimumCollisionCenter: minimumCollisionCandidate?.center ?? null,
          minimumCollisionParentDistanceMeters:
            minimumCollisionCandidate?.parentDistanceMeters ?? null,
          collidingVolumeIds: minimumCollisionCandidate
            ? nodePlanningCollisionIds(
              minimumCollisionCandidate.node,
              staticAvoidanceVolumes,
            ).slice(0, 12)
            : [],
          minimumParentDistanceMeters:
            minimumParentDistanceCandidate?.parentDistanceMeters ?? null,
          minimumParentDistanceCenter: minimumParentDistanceCandidate?.center ?? null,
          minimumParentDistanceCollisionScore:
            minimumParentDistanceCandidate?.collisionScore ?? null,
          bestWithinParentDistanceCandidates: [...withinParentDistance]
            .sort((first, second) => (
              first.collisionScore - second.collisionScore
                || first.parentDistanceMeters - second.parentDistanceMeters
                || first.displacement - second.displacement
            ))
            .slice(0, 8)
            .map((candidate) => ({
              center: cloneDungeonAugmentationValue(candidate.center),
              collisionScore: candidate.collisionScore,
              parentDistanceMeters: candidate.parentDistanceMeters,
              collidingVolumeIds: nodePlanningCollisionIds(
                candidate.node,
                staticAvoidanceVolumes,
              ).slice(0, 8),
            })),
          selectedCandidateCenters: candidates.map(({ center }) => (
            cloneDungeonAugmentationValue(center)
          )),
        },
      };
    }).sort((first, second) => first.index - second.index);
    if (placementCandidateGroups.some(({ candidates }) => candidates.length === 0)) {
      const failedGroup = placementCandidateGroups.find(({ candidates }) => candidates.length === 0);
      return {
        error: 'route-network-node-placement-collision',
        context: {
          grantId: grant.id,
          nodeIndex: failedGroup.index,
          selectedGrammarIds: selectedGrammars.map((grammar) => grammar?.id ?? null),
          endpointNodeIndices: [...endpointNodeIndexSet].sort((first, second) => first - second),
          placementFailureDiagnostics: failedGroup.diagnostics,
          placementCandidateCounts: placementCandidateGroups.map(({ index, candidates }) => ({
            nodeIndex: index,
            count: candidates.length,
          })),
        },
      };
    }
    // Objective coverage contributes one bidirectional external gameplay path.
    // Its authored corridor is already the parallel return leg, so duplicating
    // every station-to-station parent edge and then adding an overlay closure
    // invents an infeasible second loop. The structural placement order makes
    // the required overlay path consecutive for every endpoint cardinality.
    const coverageRequiredEdges = Array.from(
      { length: Math.max(0, mainCenters.length - 1) },
      (_, edgeOrdinal) => ({
        edgeOrdinal,
        fromIndex: edgeOrdinal,
        toIndex: edgeOrdinal + 1,
        routeRole: 'route-network-spine',
        requiredSocketBinding: requiredCoverageSocketBindingByKey.get(
          coverageSocketBindingKey(edgeOrdinal, edgeOrdinal + 1),
        ) ?? null,
      }),
    );
    const coverageEdgeKey = (firstIndex, secondIndex) => (
      firstIndex < secondIndex
        ? `${firstIndex}:${secondIndex}`
        : `${secondIndex}:${firstIndex}`
    );
    const coverageRequiredEdgeByKey = new Map(coverageRequiredEdges.map((edge) => [
      coverageEdgeKey(edge.fromIndex, edge.toIndex),
      edge,
    ]));
    const coverageRequiredEdgeForPair = (firstIndex, secondIndex) => (
      coverageRequiredEdgeByKey.get(coverageEdgeKey(firstIndex, secondIndex)) ?? null
    );
    const selectedPlacementCandidates = new Map();
    let placementSolution = null;
    let placementSpineSolution = null;
    let placementSearchVisits = 0;
    let physicalSpineAttempts = 0;
    let lastPhysicalPlacementCenters = null;
    const physicalSpineEdgeDiagnostics = coverageRequiredEdges.map((edge) => ({
        edgeIndex: edge.edgeOrdinal,
        fromNodeIndex: edge.fromIndex,
        toNodeIndex: edge.toIndex,
        visits: 0,
        deadEnds: 0,
        maximumRawCandidateCount: 0,
        maximumCollisionFreeCandidateCount: 0,
        maximumWithinSpanCandidateCount: 0,
        maximumFeasibleCandidateCount: 0,
        forwardCheckFailures: 0,
        minimumEndpointPrefixMeters: null,
        minimumAccumulatedFeaturelessDistanceMeters: null,
        minimumCollisionScore: null,
        minimumDistanceMeters: null,
        bestBlockedPath: null,
        bestBlockedCollisionIds: [],
      }));
    const parentAttachmentFailureDiagnostics = endpoints.map((_, endpointOrdinal) => ({
      endpointOrdinal,
      failures: 0,
      minimumCollisionScore: null,
      minimumDistanceMeters: null,
      endpointSocketPosition: null,
      nodeEntryPosition: null,
      bestBlockedPath: null,
      bestBlockedCollisionIds: [],
      bestBlockingVolumes: [],
    }));
    const physicalPairCompatibilityCache = new Map();
    const physicalPairEdgeDiagnostics = coverageRequiredEdges.map((edge) => ({
        edgeIndex: edge.edgeOrdinal,
        fromNodeIndex: edge.fromIndex,
        toNodeIndex: edge.toIndex,
        evaluatedPairCount: 0,
        compatiblePairCount: 0,
        minimumCollisionScore: null,
        minimumDistanceMeters: null,
        bestBlockedPath: null,
        bestBlockedCollisionIds: [],
        socketPairCandidateCounts: [],
      }));
    const candidatePhysicalKey = (candidate, index) => [
      index,
      Number(candidate.center.x).toFixed(3),
      Number(candidate.center.y).toFixed(3),
      Number(candidate.center.z).toFixed(3),
      Number(candidate.facing?.x ?? 0).toFixed(3),
      Number(candidate.facing?.z ?? 0).toFixed(3),
    ].join(':');
    const parentAttachmentPairCompatibilityCache = new Map();
    const candidatePairRespectsParentAttachments = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      if (!endpointNodeIndexSet.has(firstIndex)
        && !endpointNodeIndexSet.has(secondIndex)) return true;
      const ordered = firstIndex <= secondIndex
        ? [firstCandidate, firstIndex, secondCandidate, secondIndex]
        : [secondCandidate, secondIndex, firstCandidate, firstIndex];
      const [orderedFirst, orderedFirstIndex, orderedSecond, orderedSecondIndex] = ordered;
      const cacheKey = `${candidatePhysicalKey(
        orderedFirst,
        orderedFirstIndex,
      )}|attachment-clearance|${candidatePhysicalKey(
        orderedSecond,
        orderedSecondIndex,
      )}`;
      if (parentAttachmentPairCompatibilityCache.has(cacheKey)) {
        return parentAttachmentPairCompatibilityCache.get(cacheKey);
      }
      const firstAttachment = endpointNodeIndexSet.has(firstIndex)
        ? staticParentAttachmentForCandidate(firstCandidate, firstIndex)
        : null;
      const secondAttachment = endpointNodeIndexSet.has(secondIndex)
        ? staticParentAttachmentForCandidate(secondCandidate, secondIndex)
        : null;
      const compatible = (!firstAttachment
          || !firstAttachment.pathVolumes.some((pathVolume) => (
            candidateNodeVolumes(secondCandidate).some((nodeVolume) => (
              planningVolumesOverlap(pathVolume, nodeVolume)
            ))
          )))
        && (!secondAttachment
          || !secondAttachment.pathVolumes.some((pathVolume) => (
            candidateNodeVolumes(firstCandidate).some((nodeVolume) => (
              planningVolumesOverlap(pathVolume, nodeVolume)
            ))
          )))
        && (!firstAttachment || !secondAttachment
          || !firstAttachment.pathVolumes.some((firstPathVolume) => (
            secondAttachment.pathVolumes.some((secondPathVolume) => (
              planningVolumesOverlap(firstPathVolume, secondPathVolume)
            ))
          )));
      parentAttachmentPairCompatibilityCache.set(cacheKey, compatible);
      return compatible;
    };
    const staticSocketRouteWitnessCache = new Map();
    const socketRouteOptionsCache = new Map();
    const staticRouteOptionCollisionCache = new WeakMap();
    // Only a singleton endpoint domain owns an immutable attachment path at
    // this stage. Dense coverage stations remain movable until the global
    // assignment is chosen; reserving candidates[0] for those domains creates
    // a phantom corridor that can incorrectly eliminate every other station
    // and room placement. Pair consistency and the final spine solve validate
    // the actual selected attachment paths below.
    const pinnedParentAttachmentPathVolumes = placementCandidateGroups
      .filter(({ endpoint, candidates }) => endpoint && candidates.length === 1)
      .flatMap(({ index, candidates }) => (
        staticParentAttachmentForCandidate(candidates[0], index).pathVolumes ?? []
      ));
    const socketPositionKey = (socket) => [
      Number(socket.position.x).toFixed(3),
      Number(socket.position.y).toFixed(3),
      Number(socket.position.z).toFixed(3),
      Number(socket.facing?.x ?? 0).toFixed(3),
      Number(socket.facing?.z ?? 0).toFixed(3),
    ].join(':');
    const nodeLocalApproachWitness = (node, socket) => ({
      nodeId: node.id,
      socketId: socket.id,
      localSocketId: socket.localSocketId,
      path: [
        addDungeonPoints(
          socket.position,
          scaleDungeonPoint(socket.facing, -ROUTE_NETWORK_SOCKET_APPROACH_METERS),
        ),
        cloneDungeonAugmentationValue(socket.position),
      ],
    });
    const connectorStationSocketPair = (
      fromNode,
      fromSocket,
      toNode,
      toSocket,
    ) => grant.kind === 'objective-route-coverage'
      && fromNode?.connectorOwned === true
      && toNode?.connectorOwned === true
      && fromNode?.exactParentEndpoint === true
      && toNode?.exactParentEndpoint === true
      && fromSocket?.localSocketId !== 'entry'
      && toSocket?.localSocketId !== 'entry';
    const sharedJunctionThresholdOption = (
      fromNode,
      fromSocket,
      toNode,
      toSocket,
    ) => {
      if (!connectorStationSocketPair(fromNode, fromSocket, toNode, toSocket)
        || dungeonPointDistance(fromSocket.position, toSocket.position) > 1e-6) return null;
      const facingDot = Number(fromSocket.facing?.x ?? 0) * Number(toSocket.facing?.x ?? 0)
        + Number(fromSocket.facing?.z ?? 0) * Number(toSocket.facing?.z ?? 0);
      if (facingDot > -1 + 1e-6) return null;
      const sharedPosition = cloneDungeonAugmentationValue(fromSocket.position);
      const horizontalNormal = Math.abs(Number(fromSocket.facing?.x ?? 0)) > 0.5;
      return {
        path: [sharedPosition, cloneDungeonAugmentationValue(sharedPosition)],
        ordinal: -1,
        distanceMeters: 0,
        pathVolumes: [],
        sharedEndpointFootprint: {
          kind: 'shared-junction-threshold',
          center: sharedPosition,
          size: {
            x: horizontalNormal ? 2.8 : 8.4,
            y: 5.6,
            z: horizontalNormal ? 8.4 : 2.8,
          },
          nodeIds: [fromNode.id, toNode.id],
          socketIds: [fromSocket.id, toSocket.id],
        },
        localApproachWitnesses: [
          nodeLocalApproachWitness(fromNode, fromSocket),
          nodeLocalApproachWitness(toNode, toSocket),
        ],
      };
    };
    const shortJunctionLinkOption = (
      fromNode,
      fromSocket,
      toNode,
      toSocket,
    ) => {
      if (!connectorStationSocketPair(fromNode, fromSocket, toNode, toSocket)) return null;
      const distanceMeters = dungeonPointDistance(fromSocket.position, toSocket.position);
      if (distanceMeters <= 1e-6
        || distanceMeters > ROUTE_NETWORK_SOCKET_APPROACH_METERS + 1e-6) return null;
      const facingDot = Number(fromSocket.facing?.x ?? 0) * Number(toSocket.facing?.x ?? 0)
        + Number(fromSocket.facing?.z ?? 0) * Number(toSocket.facing?.z ?? 0);
      const direction = toDungeonCardinalFacing({
        x: Number(toSocket.position.x) - Number(fromSocket.position.x),
        z: Number(toSocket.position.z) - Number(fromSocket.position.z),
      });
      const facesDestination = Number(fromSocket.facing?.x ?? 0) * direction.x
        + Number(fromSocket.facing?.z ?? 0) * direction.z;
      if (facingDot > -1 + 1e-6 || facesDestination < 1 - 1e-6) return null;
      const path = [
        cloneDungeonAugmentationValue(fromSocket.position),
        cloneDungeonAugmentationValue(toSocket.position),
      ];
      return {
        path,
        ordinal: -2,
        distanceMeters,
        pathVolumes: routePathPlanningVolumes(path),
        localApproachWitnesses: [
          nodeLocalApproachWitness(fromNode, fromSocket),
          nodeLocalApproachWitness(toNode, toSocket),
        ],
      };
    };
    const orderedSocketRouteOptions = (
      fromSocket,
      toSocket,
      preferXFirst,
      fromNode = null,
      toNode = null,
    ) => {
      const sharedThreshold = sharedJunctionThresholdOption(
        fromNode,
        fromSocket,
        toNode,
        toSocket,
      );
      const shortJunctionLink = shortJunctionLinkOption(
        fromNode,
        fromSocket,
        toNode,
        toSocket,
      );
      const cacheKey = `${socketPositionKey(fromSocket)}>${socketPositionKey(
        toSocket,
      )}:${preferXFirst ? 'x' : 'z'}:${sharedThreshold
        ? 'shared'
        : shortJunctionLink ? 'short-local' : 'corridor'}`;
      if (socketRouteOptionsCache.has(cacheKey)) {
        return socketRouteOptionsCache.get(cacheKey);
      }
      const connectorFamily = Math.abs(
        Number(toSocket.position.y) - Number(fromSocket.position.y),
      ) > 1e-6 ? verticalFamily : 'service-gallery';
      const paths = cachedSocketRouteCandidates(fromSocket, toSocket, {
        preferXFirst,
        connectorFamily,
        ...coverageModuleRouteOptions,
      });
      const orderedPaths = [
        ...(sharedThreshold ? [sharedThreshold] : []),
        ...(shortJunctionLink ? [shortJunctionLink] : []),
        ...paths.map((path, ordinal) => ({
        path,
        ordinal,
        distanceMeters: featurelessPathDistance(path),
        pathVolumes: routePathPlanningVolumes(path),
        })),
      ].filter(({ path, distanceMeters, sharedEndpointFootprint }) => (
        (sharedEndpointFootprint || measureDungeonPolyline(path) > 1e-6)
          && distanceMeters <= maximumSpan + 1e-6
      )).sort((first, second) => (
        first.distanceMeters - second.distanceMeters
          || first.ordinal - second.ordinal
      ));
      socketRouteOptionsCache.set(cacheKey, orderedPaths);
      return orderedPaths;
    };
    const spineLandingOverlapGrants = (firstNodeIndex, secondNodeIndex) => [
      firstNodeIndex,
      secondNodeIndex,
    ]
      .filter((nodeIndex) => endpointNodeIndexSet.has(nodeIndex))
      .flatMap((nodeIndex) => {
        const endpointOrdinal = endpointOrdinalForNodeIndex(nodeIndex);
        const socketId = endpoints[endpointOrdinal]?.id;
        return [
          ...(grant.socketLandingOverlapGrants ?? []),
          ...(grant.socketModuleOverlapGrants ?? []),
        ].filter((overlap) => (
          String(overlap.socketId) === String(socketId)
        ));
      });
    const routeOptionHasStaticCollision = (routeOption, overlapGrants = []) => {
      if (overlapGrants.length === 0) {
        if (!staticRouteOptionCollisionCache.has(routeOption)) {
          staticRouteOptionCollisionCache.set(
            routeOption,
            indexedStaticPathVolumesHaveCollision(routeOption.pathVolumes)
              || routeOption.pathVolumes.some((pathVolume) => (
                pinnedParentAttachmentPathVolumes.some((attachmentVolume) => (
                  planningVolumesOverlap(pathVolume, attachmentVolume)
                ))
              )),
          );
        }
        return staticRouteOptionCollisionCache.get(routeOption);
      }
      return routeOption.pathVolumes.some((pathVolume) => (
        [...nearbyStaticAvoidanceVolumes(pathVolume), ...pinnedParentAttachmentPathVolumes]
          .some((obstacle) => (
          planningVolumesOverlap(pathVolume, obstacle)
            && !planningOverlapIsGranted(pathVolume, obstacle, overlapGrants)
          ))
      ));
    };
    const staticSocketRouteWitness = (
      fromSocket,
      toSocket,
      preferXFirst,
      firstNodeIndex = null,
      secondNodeIndex = null,
      fromNode = null,
      toNode = null,
    ) => {
      const cacheKey = `${socketPositionKey(fromSocket)}>${socketPositionKey(
        toSocket,
      )}:${preferXFirst ? 'x' : 'z'}:${firstNodeIndex ?? 'none'}:${secondNodeIndex ?? 'none'}`;
      if (staticSocketRouteWitnessCache.has(cacheKey)) {
        return staticSocketRouteWitnessCache.get(cacheKey);
      }
      const witness = orderedSocketRouteOptions(
        fromSocket,
        toSocket,
        preferXFirst,
        fromNode,
        toNode,
      ).find((routeOption) => !routeOptionHasStaticCollision(
        routeOption,
        firstNodeIndex == null || secondNodeIndex == null
          ? []
          : spineLandingOverlapGrants(firstNodeIndex, secondNodeIndex),
      )) ?? null;
      staticSocketRouteWitnessCache.set(cacheKey, witness);
      return witness;
    };
    const adjacentPairHasPhysicalRoute = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      const ordered = firstIndex <= secondIndex
        ? [firstCandidate, firstIndex, secondCandidate, secondIndex]
        : [secondCandidate, secondIndex, firstCandidate, firstIndex];
      const [fromCandidate, fromIndex, toCandidate, toIndex] = ordered;
      const requiredEdge = coverageRequiredEdgeForPair(fromIndex, toIndex);
      if (!requiredEdge) return false;
      const cacheKey = `${candidatePhysicalKey(fromCandidate, fromIndex)}>${candidatePhysicalKey(
        toCandidate,
        toIndex,
      )}`;
      if (physicalPairCompatibilityCache.has(cacheKey)) {
        return physicalPairCompatibilityCache.get(cacheKey);
      }
      const edgeDiagnostics = physicalPairEdgeDiagnostics[requiredEdge.edgeOrdinal];
      let compatible = false;
      let bestRoute = null;
      for (const fromSocket of availableSpineSockets(
        fromCandidate.node,
        fromIndex,
        toIndex,
      )) {
        for (const toSocket of availableSpineSockets(
          toCandidate.node,
          toIndex,
          fromIndex,
        )) {
          const connectorFamily = Math.abs(
            Number(toSocket.position.y) - Number(fromSocket.position.y),
          ) > 1e-6 ? verticalFamily : 'service-gallery';
          const rawRouteCandidates = cachedSocketRouteCandidates(
            fromSocket,
            toSocket,
            { preferXFirst: true, connectorFamily, ...coverageModuleRouteOptions },
          );
          const rawRouteCandidateCount = rawRouteCandidates.length;
          const routeOptionCount = orderedSocketRouteOptions(
            fromSocket,
            toSocket,
            true,
            fromCandidate.node,
            toCandidate.node,
          ).length;
          if (edgeDiagnostics.socketPairCandidateCounts.length < 16) {
            edgeDiagnostics.socketPairCandidateCounts.push({
              fromLocalSocketId: fromSocket.localSocketId,
              toLocalSocketId: toSocket.localSocketId,
              connectorFamily,
              rawRouteCandidateCount,
              routeOptionCount,
              fromPosition: cloneDungeonAugmentationValue(fromSocket.position),
              toPosition: cloneDungeonAugmentationValue(toSocket.position),
              fromFacing: cloneDungeonAugmentationValue(fromSocket.facing),
              toFacing: cloneDungeonAugmentationValue(toSocket.facing),
              minimumRawFeaturelessDistanceMeters: rawRouteCandidates.length > 0
                ? Math.min(...rawRouteCandidates.map(featurelessPathDistance))
                : null,
            });
          }
          const witness = staticSocketRouteWitness(
            fromSocket,
            toSocket,
            true,
            fromIndex,
            toIndex,
            fromCandidate.node,
            toCandidate.node,
          );
          if (witness) {
            bestRoute = {
              path: witness.path,
              collisionScore: 0,
              distanceMeters: witness.distanceMeters,
            };
            compatible = true;
            break;
          }
          const overlapGrants = spineLandingOverlapGrants(fromIndex, toIndex);
          const blockedRoute = orderedSocketRouteOptions(
            fromSocket,
            toSocket,
            true,
            fromCandidate.node,
            toCandidate.node,
          )
            .map((routeOption) => ({
              path: routeOption.path,
              distanceMeters: routeOption.distanceMeters,
              collisionScore: pathPlanningCollisionScore(
                routeOption.path,
                staticAvoidanceVolumes,
                5.6,
                overlapGrants,
              ),
            }))
            .sort((first, second) => (
              first.collisionScore - second.collisionScore
                || first.distanceMeters - second.distanceMeters
            ))[0] ?? null;
          if (blockedRoute && (!bestRoute
            || blockedRoute.collisionScore < bestRoute.collisionScore
            || (blockedRoute.collisionScore === bestRoute.collisionScore
              && blockedRoute.distanceMeters < bestRoute.distanceMeters))) {
            bestRoute = blockedRoute;
          }
        }
        if (compatible) break;
      }
      edgeDiagnostics.evaluatedPairCount += 1;
      if (compatible) edgeDiagnostics.compatiblePairCount += 1;
      if (bestRoute && (
        edgeDiagnostics.minimumCollisionScore == null
          || bestRoute.collisionScore < edgeDiagnostics.minimumCollisionScore
          || (bestRoute.collisionScore === edgeDiagnostics.minimumCollisionScore
            && bestRoute.distanceMeters < edgeDiagnostics.minimumDistanceMeters)
      )) {
        edgeDiagnostics.minimumCollisionScore = bestRoute.collisionScore;
        edgeDiagnostics.minimumDistanceMeters = bestRoute.distanceMeters;
        edgeDiagnostics.bestBlockedPath = bestRoute.path;
        edgeDiagnostics.bestBlockedCollisionIds = pathPlanningCollisionIds(
          bestRoute.path,
          staticAvoidanceVolumes,
        ).slice(0, 12);
      }
      physicalPairCompatibilityCache.set(cacheKey, compatible);
      return compatible;
    };
    const adjacentCandidatesCompatible = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      const secondVolumes = [
        ...(secondCandidate.node.occupiedVolumes ?? []),
        ...(secondCandidate.node.clearanceVolumes ?? []),
      ];
      return nodePlanningCollisionScore(firstCandidate.node, secondVolumes) === 0
        && minimumSpineDistance(
          firstCandidate.node,
          firstIndex,
          secondCandidate.node,
          secondIndex,
        ) <= maximumSpan + 1e-6
        && adjacentPairHasPhysicalRoute(
          firstCandidate,
          firstIndex,
          secondCandidate,
          secondIndex,
        );
    };
    const adjacentCandidatesMeetCheapBounds = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      const secondVolumes = candidateNodeVolumes(secondCandidate);
      return nodePlanningCollisionScore(firstCandidate.node, secondVolumes) === 0
        && minimumSpineDistance(
          firstCandidate.node,
          firstIndex,
          secondCandidate.node,
          secondIndex,
        ) <= maximumSpan + 1e-6;
    };
    const candidatePairSatisfiesPlacementConstraints = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      const secondVolumes = candidateNodeVolumes(secondCandidate);
      if (nodePlanningCollisionScore(firstCandidate.node, secondVolumes) > 0) return false;
      if (!candidatePairRespectsParentAttachments(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      )) return false;
      return !coverageRequiredEdgeForPair(firstIndex, secondIndex)
        || adjacentCandidatesCompatible(
          firstCandidate,
          firstIndex,
          secondCandidate,
          secondIndex,
        );
    };
    const placementConstraintPairs = placementCandidateGroups.flatMap((firstGroup, firstOrdinal) => (
      placementCandidateGroups.slice(firstOrdinal + 1).map((secondGroup) => {
        const adjacent = Boolean(coverageRequiredEdgeForPair(
          firstGroup.index,
          secondGroup.index,
        ));
        const parentAttachment = firstGroup.endpoint || secondGroup.endpoint;
        return { firstGroup, secondGroup, adjacent, parentAttachment };
      })
    ));
    // Arc-consistency covers both neighboring spine modules and every binary
    // endpoint-to-module pair. The latter is essential: a non-adjacent room
    // can otherwise consume an endpoint's only clear two-tile parent approach,
    // leaving the expensive full-layout solver to discover the conflict late.
    let arcChanged = true;
    while (arcChanged) {
      arcChanged = false;
      for (const {
        firstGroup,
        secondGroup,
        adjacent,
        parentAttachment,
      } of placementConstraintPairs) {
        const originalFirstCandidates = firstGroup.candidates;
        const originalSecondCandidates = secondGroup.candidates;
        const firstCandidates = firstGroup.candidates.filter((firstCandidate) => (
          secondGroup.candidates.some((secondCandidate) => (
            candidatePairSatisfiesPlacementConstraints(
            firstCandidate,
            firstGroup.index,
            secondCandidate,
            secondGroup.index,
            )
          ))
        ));
        const secondCandidates = secondGroup.candidates.filter((secondCandidate) => (
          firstCandidates.some((firstCandidate) => candidatePairSatisfiesPlacementConstraints(
            firstCandidate,
            firstGroup.index,
            secondCandidate,
            secondGroup.index,
          ))
        ));
        if (firstCandidates.length !== firstGroup.candidates.length
          || secondCandidates.length !== secondGroup.candidates.length) {
          arcChanged = true;
          firstGroup.candidates = firstCandidates;
          secondGroup.candidates = secondCandidates;
        }
        if (firstCandidates.length === 0 || secondCandidates.length === 0) {
          const closestRejectedPairs = originalFirstCandidates.flatMap((firstCandidate) => (
            originalSecondCandidates.map((secondCandidate) => {
              const secondVolumes = [
                ...(secondCandidate.node.occupiedVolumes ?? []),
                ...(secondCandidate.node.clearanceVolumes ?? []),
              ];
              return {
                firstCenter: firstCandidate.center,
                secondCenter: secondCandidate.center,
                firstAvailableSockets: availableSpineSockets(
                  firstCandidate.node,
                  firstGroup.index,
                  secondGroup.index,
                ).map(({ localSocketId, position, facing }) => ({
                  localSocketId,
                  position,
                  facing,
                })),
                secondAvailableSockets: availableSpineSockets(
                  secondCandidate.node,
                  secondGroup.index,
                  firstGroup.index,
                ).map(({ localSocketId, position, facing }) => ({
                  localSocketId,
                  position,
                  facing,
                })),
                nodeCollisionScore: nodePlanningCollisionScore(
                  firstCandidate.node,
                  secondVolumes,
                ),
                minimumSpineDistanceMeters: minimumSpineDistance(
                  firstCandidate.node,
                  firstGroup.index,
                  secondCandidate.node,
                  secondGroup.index,
                ),
                parentAttachmentClear: candidatePairRespectsParentAttachments(
                  firstCandidate,
                  firstGroup.index,
                  secondCandidate,
                  secondGroup.index,
                ),
                physicalRouteClear: !adjacent || adjacentPairHasPhysicalRoute(
                  firstCandidate,
                  firstGroup.index,
                  secondCandidate,
                  secondGroup.index,
                ),
              };
            })
          )).sort((first, second) => (
            first.nodeCollisionScore - second.nodeCollisionScore
              || Number(second.parentAttachmentClear) - Number(first.parentAttachmentClear)
              || first.minimumSpineDistanceMeters - second.minimumSpineDistanceMeters
          )).slice(0, 8);
          return {
            error: parentAttachment
              ? 'route-network-parent-attachment-domain-exhausted'
              : adjacent
                ? 'route-network-adjacent-domain-exhausted'
                : 'route-network-node-domain-exhausted',
            context: {
              grantId: grant.id,
              constraintKind: adjacent && parentAttachment
                ? 'adjacent-and-parent-attachment'
                : parentAttachment
                  ? 'parent-attachment'
                  : adjacent
                    ? 'adjacent-spine'
                    : 'nonadjacent-node-clearance',
              firstNodeIndex: firstGroup.index,
              secondNodeIndex: secondGroup.index,
              placementCandidateCounts: placementCandidateGroups.map(({ index, candidates }) => ({
                nodeIndex: index,
                count: candidates.length,
              })),
              selectedGrammarIds: selectedGrammars
                .slice(0, mainCenters.length)
                .map((grammar) => grammar?.id ?? null),
              initialPlacementCandidateCenters: placementCandidateGroups.map((group) => ({
                nodeIndex: group.index,
                centers: group.diagnostics?.selectedCandidateCenters ?? [],
                baseCenterCandidate: group.diagnostics?.baseCenterCandidate ?? null,
              })),
              closestRejectedPairs,
              physicalPairEdgeDiagnostics,
            },
          };
        }
      }
    }
    const candidateCompatibleWithSelection = (candidate, index) => {
      const selectedEntries = [...selectedPlacementCandidates.entries()];
      const selectedVolumes = selectedEntries.flatMap(([, selected]) => [
        ...(selected.node.occupiedVolumes ?? []),
        ...(selected.node.clearanceVolumes ?? []),
      ]);
      if (nodePlanningCollisionScore(candidate.node, selectedVolumes) > 0) return false;
      return selectedEntries.every(([selectedIndex, selected]) => (
        candidatePairRespectsParentAttachments(
          candidate,
          index,
          selected,
          selectedIndex,
        ) && (!coverageRequiredEdgeForPair(selectedIndex, index)
          || adjacentCandidatesCompatible(
            candidate,
            index,
            selected,
            selectedIndex,
          ))
      ));
    };
    const candidateCheaplyCompatibleWithSelection = (candidate, index) => {
      const selectedEntries = [...selectedPlacementCandidates.entries()];
      return selectedEntries.every(([selectedIndex, selected]) => (
        nodePlanningCollisionScore(candidate.node, candidateNodeVolumes(selected)) === 0
          && candidatePairRespectsParentAttachments(
            candidate,
            index,
            selected,
            selectedIndex,
          )
          && (!coverageRequiredEdgeForPair(selectedIndex, index)
            || adjacentCandidatesMeetCheapBounds(
              candidate,
              index,
              selected,
              selectedIndex,
            ))
      ));
    };
    const solvePhysicalSpine = () => {
      physicalSpineAttempts += 1;
      lastPhysicalPlacementCenters = [...selectedPlacementCandidates.entries()]
        .sort((first, second) => first[0] - second[0])
        .map(([nodeIndex, candidate]) => ({ nodeIndex, center: candidate.center }));
      const selectedNodes = mainCenters.map((_, index) => (
        selectedPlacementCandidates.get(index)?.node ?? null
      ));
      if (selectedNodes.some((node) => !node)) return null;
      const usedSocketIdsByNodeIndex = new Map(selectedNodes.map((node, index) => [
        index,
        new Set(endpointNodeIndexSet.has(index) ? ['entry'] : []),
      ]));
      const parentAttachmentPaths = [];
      const parentAttachmentPathVolumes = [];
      const parentAttachmentDistanceByNodeIndex = new Map();
      for (let endpointOrdinal = 0; endpointOrdinal < endpoints.length; endpointOrdinal += 1) {
        const parentSocket = endpoints[endpointOrdinal];
        const nodeIndex = coveragePlacement.endpointNodeIndices[endpointOrdinal];
        const node = selectedNodes[nodeIndex];
        const selectedCandidate = selectedPlacementCandidates.get(nodeIndex);
        const nodeSocket = getNodeSocket(node, 'entry');
        const selectedOtherNodeVolumes = selectedNodes.flatMap((selectedNode, selectedIndex) => (
          selectedIndex === nodeIndex
            ? []
            : [
              ...(selectedNode.occupiedVolumes ?? []),
              ...(selectedNode.clearanceVolumes ?? []),
            ]
        ));
        // AC reserves one statically validated physical attachment for every
        // endpoint candidate. Keep that exact path here: a later selected room
        // must be rejected if it consumes the reservation, never routed around.
        const attachment = staticParentAttachmentForCandidate(
          selectedCandidate,
          nodeIndex,
        );
        const path = attachment.path;
        const collisionScore = attachment.pathVolumes.reduce((score, pathVolume) => (
          score + selectedOtherNodeVolumes.reduce((count, obstacle) => (
            count + (planningVolumesOverlap(pathVolume, obstacle) ? 1 : 0)
          ), 0)
        ), 0);
        const distanceMeters = attachment.distanceMeters;
        if (collisionScore > 0 || distanceMeters > maximumSpan + 1e-6) {
          const diagnostics = parentAttachmentFailureDiagnostics[endpointOrdinal];
          diagnostics.failures += 1;
          if (diagnostics.minimumCollisionScore == null
            || collisionScore < diagnostics.minimumCollisionScore
            || (collisionScore === diagnostics.minimumCollisionScore
              && distanceMeters < diagnostics.minimumDistanceMeters)) {
            diagnostics.minimumCollisionScore = collisionScore;
            diagnostics.minimumDistanceMeters = distanceMeters;
            diagnostics.endpointSocketPosition = cloneDungeonAugmentationValue(
              parentSocket.position,
            );
            diagnostics.nodeEntryPosition = cloneDungeonAugmentationValue(nodeSocket.position);
            diagnostics.bestBlockedPath = path;
            const blockedIds = pathPlanningCollisionIds(
              path,
              selectedOtherNodeVolumes,
              3.6,
            );
            diagnostics.bestBlockedCollisionIds = blockedIds.slice(0, 12);
            const blockedIdSet = new Set(blockedIds);
            diagnostics.bestBlockingVolumes = selectedOtherNodeVolumes
              .filter((volume) => blockedIdSet.has(String(
                volume.id ?? volume.ownerId ?? 'unknown',
              )))
              .slice(0, 12)
              .map((volume) => ({
                id: String(volume.id ?? volume.ownerId ?? 'unknown'),
                ownerId: String(volume.ownerId ?? ''),
                purpose: String(volume.purpose ?? ''),
                center: cloneDungeonAugmentationValue(volume.center),
                size: cloneDungeonAugmentationValue(volume.size),
              }));
          }
          return null;
        }
        parentAttachmentPaths.push(path);
        parentAttachmentPathVolumes.push(...attachment.pathVolumes);
        parentAttachmentDistanceByNodeIndex.set(nodeIndex, distanceMeters);
      }
      const pairs = [];
      const selectedOtherNodeVolumesByEdge = coverageRequiredEdges.map(({
        fromIndex,
        toIndex,
      }) => selectedNodes.flatMap((selectedNode, selectedIndex) => (
        selectedIndex === fromIndex || selectedIndex === toIndex
          ? []
          : [
            ...(selectedNode.occupiedVolumes ?? []),
            ...(selectedNode.clearanceVolumes ?? []),
          ]
      )));
      const routeOptionIntersectsVolumes = (routeOption, obstacleVolumes) => (
        routeOption.pathVolumes.some((pathVolume) => obstacleVolumes.some((obstacle) => (
          planningVolumesOverlap(pathVolume, obstacle)
        )))
      );
      // Node placements and parent attachments are immutable for this spine
      // attempt. Filter those fixed obstacles once per socket pair; recursive
      // states then test only the small incremental set of already committed
      // spine corridors.
      const fixedSocketPairOptionsByEdge = coverageRequiredEdges.map((edge) => {
          const { edgeOrdinal, fromIndex, toIndex } = edge;
          const fromNode = selectedNodes[fromIndex];
          const toNode = selectedNodes[toIndex];
          const fixedObstacles = [
            ...selectedOtherNodeVolumesByEdge[edgeOrdinal],
            ...parentAttachmentPathVolumes,
          ];
          const overlapGrants = spineLandingOverlapGrants(fromIndex, toIndex);
          return availableSpineSockets(fromNode, fromIndex, toIndex)
            .flatMap((fromSocket) => (
            availableSpineSockets(toNode, toIndex, fromIndex).map((toSocket) => ({
              fromSocket,
              toSocket,
              routeOptions: orderedSocketRouteOptions(
                fromSocket,
                toSocket,
                true,
                fromNode,
                toNode,
              )
                .filter((routeOption) => (
                  !routeOptionHasStaticCollision(routeOption, overlapGrants)
                    && !routeOptionIntersectsVolumes(routeOption, fixedObstacles)
                )),
            }))
          ));
        });
      const committedSpineRouteVolumes = [];
      const routeOptionClearsCommittedSpine = (routeOption) => (
        !routeOptionIntersectsVolumes(routeOption, committedSpineRouteVolumes)
      );
      const futureEdgeHasRouteOption = (edgeOrdinal) => {
        const { fromIndex, toIndex } = coverageRequiredEdges[edgeOrdinal];
        const fromUsed = usedSocketIdsByNodeIndex.get(fromIndex);
        const toUsed = usedSocketIdsByNodeIndex.get(toIndex);
        return fixedSocketPairOptionsByEdge[edgeOrdinal].some(({
          fromSocket,
          toSocket,
          routeOptions,
        }) => (
          !fromUsed.has(fromSocket.localSocketId)
            && !toUsed.has(toSocket.localSocketId)
            && routeOptions.some(routeOptionClearsCommittedSpine)
        ));
      };
      const visitSpineEdge = (edgeOrdinal) => {
        if (edgeOrdinal >= coverageRequiredEdges.length) return true;
        const requiredEdge = coverageRequiredEdges[edgeOrdinal];
        const { fromIndex, toIndex } = requiredEdge;
        const fromNode = selectedNodes[fromIndex];
        const toNode = selectedNodes[toIndex];
        const fromUsed = usedSocketIdsByNodeIndex.get(fromIndex);
        const toUsed = usedSocketIdsByNodeIndex.get(toIndex);
        const selectedOtherNodeVolumes = selectedOtherNodeVolumesByEdge[edgeOrdinal];
        const socketPairs = fixedSocketPairOptionsByEdge[edgeOrdinal]
          .filter(({ fromSocket, toSocket }) => (
            !fromUsed.has(fromSocket.localSocketId)
              && !toUsed.has(toSocket.localSocketId)
          ));
        const collisionFreeCandidates = socketPairs
          .map(({ fromSocket, toSocket, routeOptions }) => ({
            fromSocket,
            toSocket,
            witness: routeOptions.find(routeOptionClearsCommittedSpine) ?? null,
          }))
          .filter(({ witness }) => witness)
          .map(({ fromSocket, toSocket, witness }) => {
            const fromLocalSocketId = fromSocket.localSocketId;
            const toLocalSocketId = toSocket.localSocketId;
            const endpointPrefix = [
              [fromIndex, fromLocalSocketId],
              [toIndex, toLocalSocketId],
            ].reduce((sum, [nodeIndex, throughLocalSocketId]) => {
              const node = selectedNodes[nodeIndex];
              if (!node?.connectorOwned
                || Number(node.plannedMinimumGraphDegree ?? 0) >= 3) return sum;
              return sum
                + Number(
                  parentAttachmentDistanceByNodeIndex.get(nodeIndex)
                    ?? Number.POSITIVE_INFINITY,
                )
                + connectorModuleCoreTraversalDistance(
                  node,
                  'entry',
                  throughLocalSocketId,
                );
            }, 0);
            return {
              fromLocalSocketId,
              toLocalSocketId,
              path: witness.path,
              pathVolumes: witness.pathVolumes,
              collisionScore: 0,
              distanceMeters: witness.distanceMeters,
              endpointPrefixMeters: endpointPrefix,
              accumulatedFeaturelessDistanceMeters: witness.distanceMeters + endpointPrefix,
              edgeOrdinal,
              fromIndex,
              toIndex,
              routeRole: requiredEdge.routeRole,
              ...(witness.sharedEndpointFootprint ? {
                sharedEndpointFootprint: cloneDungeonAugmentationValue(
                  witness.sharedEndpointFootprint,
                ),
              } : {}),
              ...(witness.localApproachWitnesses ? {
                localApproachWitnesses: cloneDungeonAugmentationValue(
                  witness.localApproachWitnesses,
                ),
              } : {}),
            };
          })
          ;
        const candidates = collisionFreeCandidates
          .filter(({ accumulatedFeaturelessDistanceMeters }) => (
            accumulatedFeaturelessDistanceMeters <= maximumSpan + 1e-6
          ))
          .sort((first, second) => (
            first.distanceMeters - second.distanceMeters
              || first.fromLocalSocketId.localeCompare(second.fromLocalSocketId)
              || first.toLocalSocketId.localeCompare(second.toLocalSocketId)
          ));
        const edgeDiagnostics = physicalSpineEdgeDiagnostics[edgeOrdinal];
        edgeDiagnostics.visits += 1;
        edgeDiagnostics.maximumRawCandidateCount = Math.max(
          edgeDiagnostics.maximumRawCandidateCount,
          socketPairs.length,
        );
        edgeDiagnostics.maximumCollisionFreeCandidateCount = Math.max(
          edgeDiagnostics.maximumCollisionFreeCandidateCount,
          collisionFreeCandidates.length,
        );
        edgeDiagnostics.maximumWithinSpanCandidateCount = Math.max(
          edgeDiagnostics.maximumWithinSpanCandidateCount,
          socketPairs.filter(({ fromSocket, toSocket }) => (
            orderedSocketRouteOptions(
              fromSocket,
              toSocket,
              true,
              fromNode,
              toNode,
            ).length > 0
          )).length,
        );
        edgeDiagnostics.maximumFeasibleCandidateCount = Math.max(
          edgeDiagnostics.maximumFeasibleCandidateCount,
          candidates.length,
        );
        const minimumEndpointPrefixMeters = Math.min(
          ...collisionFreeCandidates.map(({ endpointPrefixMeters }) => endpointPrefixMeters),
        );
        if (Number.isFinite(minimumEndpointPrefixMeters)) {
          edgeDiagnostics.minimumEndpointPrefixMeters = Math.min(
            edgeDiagnostics.minimumEndpointPrefixMeters ?? Number.POSITIVE_INFINITY,
            minimumEndpointPrefixMeters,
          );
        }
        const minimumAccumulatedFeaturelessDistanceMeters = Math.min(
          ...collisionFreeCandidates.map(({
            accumulatedFeaturelessDistanceMeters,
          }) => accumulatedFeaturelessDistanceMeters),
        );
        if (Number.isFinite(minimumAccumulatedFeaturelessDistanceMeters)) {
          edgeDiagnostics.minimumAccumulatedFeaturelessDistanceMeters = Math.min(
            edgeDiagnostics.minimumAccumulatedFeaturelessDistanceMeters
              ?? Number.POSITIVE_INFINITY,
            minimumAccumulatedFeaturelessDistanceMeters,
          );
        }
        if (candidates.length === 0 && socketPairs.length > 0) {
          const selectedPhysicalObstacles = [
            ...selectedOtherNodeVolumes,
            ...parentAttachmentPathVolumes,
            ...committedSpineRouteVolumes,
          ];
          const routeAvoidanceVolumes = [
            ...staticAvoidanceVolumes,
            ...selectedPhysicalObstacles,
          ];
          const bestBlocked = socketPairs.flatMap(({ fromSocket, toSocket }) => (
            orderedSocketRouteOptions(
              fromSocket,
              toSocket,
              true,
              fromNode,
              toNode,
            )
              .slice(0, 2)
              .map((routeOption) => ({
                path: routeOption.path,
                distanceMeters: routeOption.distanceMeters,
                collisionScore: pathPlanningCollisionScore(
                  routeOption.path,
                  routeAvoidanceVolumes,
                ),
              }))
          )).sort((first, second) => (
            first.collisionScore - second.collisionScore
              || first.distanceMeters - second.distanceMeters
          )).slice(0, 8)[0] ?? null;
          if (bestBlocked) {
            if (edgeDiagnostics.minimumCollisionScore == null
              || bestBlocked.collisionScore < edgeDiagnostics.minimumCollisionScore
              || (bestBlocked.collisionScore === edgeDiagnostics.minimumCollisionScore
                && bestBlocked.distanceMeters < edgeDiagnostics.minimumDistanceMeters)) {
              edgeDiagnostics.minimumCollisionScore = bestBlocked.collisionScore;
              edgeDiagnostics.minimumDistanceMeters = bestBlocked.distanceMeters;
              edgeDiagnostics.bestBlockedPath = bestBlocked.path;
              edgeDiagnostics.bestBlockedCollisionIds = pathPlanningCollisionIds(
                bestBlocked.path,
                routeAvoidanceVolumes,
              ).slice(0, 12);
            }
          }
        }
        if (candidates.length === 0) edgeDiagnostics.deadEnds += 1;
        for (const candidate of candidates) {
          fromUsed.add(candidate.fromLocalSocketId);
          toUsed.add(candidate.toLocalSocketId);
          pairs.push(candidate);
          const committedVolumeCount = committedSpineRouteVolumes.length;
          committedSpineRouteVolumes.push(...candidate.pathVolumes);
          const futureEdgeIndices = Array.from(
            { length: coverageRequiredEdges.length - edgeOrdinal - 1 },
            (_, offset) => edgeOrdinal + offset + 1,
          );
          const blockedFutureEdgeIndex = futureEdgeIndices.find((futureEdgeIndex) => (
            !futureEdgeHasRouteOption(futureEdgeIndex)
          ));
          if (blockedFutureEdgeIndex != null) {
            physicalSpineEdgeDiagnostics[blockedFutureEdgeIndex].forwardCheckFailures += 1;
          }
          // Keep the forward-check as a diagnostic hint, but let the exact
          // next-edge visit own rejection. Shared endpoint sockets and their
          // clear cores can make a coarse future witness look occupied until
          // the preceding route choice is committed.
          if (visitSpineEdge(edgeOrdinal + 1)) return true;
          committedSpineRouteVolumes.length = committedVolumeCount;
          pairs.pop();
          fromUsed.delete(candidate.fromLocalSocketId);
          toUsed.delete(candidate.toLocalSocketId);
        }
        return false;
      };
      return visitSpineEdge(0) ? {
        pairs: pairs.map(({ pathVolumes: omitted, ...pair }) => ({ ...pair })),
        parentAttachmentPaths,
      } : null;
    };
    const visitPlacementCandidates = () => {
      if (placementSolution || placementSearchVisits >= 20000) return;
      placementSearchVisits += 1;
      if (selectedPlacementCandidates.size >= placementCandidateGroups.length) {
        const spineSolution = solvePhysicalSpine();
        if (spineSolution) {
          placementSolution = new Map(selectedPlacementCandidates);
          placementSpineSolution = spineSolution.pairs;
          preselectedCoverageParentAttachmentPaths = spineSolution.parentAttachmentPaths;
        }
        return;
      }
      const remainingDomains = placementCandidateGroups
        .filter(({ index }) => !selectedPlacementCandidates.has(index))
        .map((group) => ({
          group,
          candidates: group.candidates.filter((candidate) => (
            candidateCheaplyCompatibleWithSelection(candidate, group.index)
          )),
        }))
        .sort((first, second) => (
          first.candidates.length - second.candidates.length
            || first.group.index - second.group.index
        ));
      const selectedDomain = remainingDomains[0] ?? null;
      if (!selectedDomain || selectedDomain.candidates.length === 0) return;
      const { group } = selectedDomain;
      for (const candidate of selectedDomain.candidates) {
        if (!candidateCompatibleWithSelection(candidate, group.index)) continue;
        selectedPlacementCandidates.set(group.index, candidate);
        // Cheaply forward-check every unassigned module, not only the next
        // spine index. Exact route witnesses are still required when a module
        // is selected and by solvePhysicalSpine at every complete assignment.
        const remainingFeasible = placementCandidateGroups
          .filter(({ index }) => !selectedPlacementCandidates.has(index))
          .every((remainingGroup) => remainingGroup.candidates.some((remainingCandidate) => (
            candidateCheaplyCompatibleWithSelection(
              remainingCandidate,
              remainingGroup.index,
            )
          )));
        if (remainingFeasible) visitPlacementCandidates();
        selectedPlacementCandidates.delete(group.index);
        if (placementSolution) break;
      }
    };
    visitPlacementCandidates();
    if (!placementSolution) {
      return {
        error: 'route-network-placement-backtrack-exhausted',
        context: {
          grantId: grant.id,
          selectedGrammarIds: selectedGrammars.map(({ id }) => id),
          contentRoles,
          endpointNodeIndices: [...endpointNodeIndexSet].sort((first, second) => first - second),
          placementSearchVisits,
          physicalSpineAttempts,
          objectiveExternalDiagnostics,
          lastPhysicalPlacementCenters,
          remainingPlacementCandidateCenters: placementCandidateGroups.map((group) => ({
            nodeIndex: group.index,
            centers: group.candidates.map(({ center }) => center),
          })),
          parentAttachmentFailureDiagnostics,
          physicalSpineEdgeDiagnostics,
          placementCandidateCounts: placementCandidateGroups.map(({
            index,
            candidates,
            diagnostics,
          }) => ({
            nodeIndex: index,
            count: candidates.length,
            diagnostics,
          })),
        },
      };
    }
    preselectedCoverageSpinePairs = placementSpineSolution;
    for (let index = 0; index < mainCenters.length; index += 1) {
      const selected = placementSolution.get(index);
      centers[index] = selected.center;
      mainNodes[index] = selected.node;
      localPlacementAvoidanceVolumes.push(
        ...selected.node.occupiedVolumes,
        ...selected.node.clearanceVolumes,
      );
    }
  }
  let pyramidWingConnection = null;
  const nodes = [...mainNodes];
  const stableRuntimeStateIds = {
    encounter: `${operationId}:state:encounter`,
    mechanism: `${operationId}:state:mechanism`,
    reward: `${operationId}:state:reward`,
    shortcut: `${operationId}:state:shortcut`,
  };
  const segments = [];
  let nextSegmentOrdinal = 0;
  let lastSegmentFailureDiagnostics = null;
  const addSegment = ({
    from,
    to,
    routeRole,
    nodeSockets = [],
    preselectedPath = null,
    localApproachWitnesses = null,
  }) => {
    lastSegmentFailureDiagnostics = null;
    if (nodeSockets.some(([node, localSocketId]) => {
      const socket = getNodeSocket(node, localSocketId);
      return !socket || socket.state !== 'capped' || socket.segmentId != null;
    })) return null;
    const segmentOrdinal = nextSegmentOrdinal;
    const segmentId = createDungeonSupplementId({
      parentRegionId: region.id,
      operationType: 'routeNetwork',
      operationOrdinal,
      kind: 'segment',
      ordinal: segmentOrdinal,
      sourceId,
    });
    if (!from?.position || !to?.position) return null;
    const elevationDelta = Number(to.position.y) - Number(from.position.y);
    const connectorFamily = Math.abs(elevationDelta) > 1e-6
      ? verticalFamily
      : 'service-gallery';
    const endpointOwnerIds = new Set(nodeSockets
      .map(([node]) => node?.id)
      .filter(Boolean)
      .map(String));
    const sharedEndpointOverlapGrants = nodeSockets.flatMap(([node]) => [
      node?.junction?.clearCoreVolume,
      // Two connector segments that terminate at different sockets of the
      // same authored module may meet inside that module's exact floor mask.
      // The centerline solver excludes endpoint-owned geometry, but final
      // landing squares also need the same bounded ownership grant. Without
      // it, an exit landing can falsely collide with the preceding entrance
      // span even though their intersection is wholly inside the shared room.
      ...(node?.occupiedVolumes ?? []),
    ]).filter((volume) => volume?.center && volume?.size);
    const parentLandingOverlapGrant = routeRole === 'parent-station-attachment'
      ? (grant.socketLandingOverlapGrants ?? []).find(({ socketId }) => (
        String(socketId) === String(from.socketId ?? from.id)
      )) ?? null
      : null;
    const parentModuleNode = routeRole === 'parent-station-attachment'
      ? nodeSockets[0]?.[0] ?? null
      : null;
    const parentModuleOverlapGrant = parentModuleNode
      ? (grant.socketModuleOverlapGrants ?? []).find(({
        socketId,
        moduleTemplateId,
      }) => (
        String(socketId) === String(from.socketId ?? from.id)
          && (!moduleTemplateId
            || String(moduleTemplateId) === String(parentModuleNode.grammarId))
      )) ?? null
      : null;
    const parentAttachmentOverlapGrants = [
      parentLandingOverlapGrant,
      parentModuleOverlapGrant,
    ].filter(Boolean);
    const routeAvoidanceVolumes = localPlacementAvoidanceVolumes.filter((volume) => (
      !planningVolumeOwnedByAny(volume, endpointOwnerIds)
        // The host explicitly grants this exact three-tile threshold footprint
        // to the attachment. Ignore only obstacles intersecting that bounded
        // landing; every gallery/room column beyond it remains authoritative.
        && !isGrantedParentGalleryThresholdVolume(volume, parentLandingOverlapGrant)
    ));
    const preferXFirst = segments.length % 2 === 0;
    let segmentPath = preselectedPath;
    if (!segmentPath) {
      if (routeRole === 'parent-station-attachment') {
        segmentPath = collisionAvoidingParentAttachmentPath(
          from,
          to,
          routeAvoidanceVolumes,
          preferXFirst,
          parentAttachmentOverlapGrants,
          connectorFamily,
          grant.kind === 'landmark-perimeter-loop'
            ? ROUTE_NETWORK_SOCKET_APPROACH_METERS
            : 2.8,
        );
      } else {
        segmentPath = cachedSocketRouteCandidates(from, to, {
          preferXFirst,
          connectorFamily,
          ...coverageModuleRouteOptions,
        }).map((path, ordinal) => ({
          path,
          ordinal,
          collisionScore: pathPlanningCollisionScore(
            path,
            routeAvoidanceVolumes,
            5.6,
            sharedEndpointOverlapGrants,
          ),
          lengthMeters: measureDungeonPolyline(path),
          maximumLevelSpanMeters: maximumContinuousLevelRouteSpan(path),
        })).filter(({ collisionScore, maximumLevelSpanMeters }) => (
          collisionScore === 0
            && maximumLevelSpanMeters <= Number(
              profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
            ) + 1e-6
        ))
          .sort((first, second) => (
            first.lengthMeters - second.lengthMeters
              || first.ordinal - second.ordinal
          ))[0]?.path ?? null;
      }
    }
    const segmentFeaturelessDistance = Array.isArray(segmentPath)
      ? maximumContinuousLevelRouteSpan(segmentPath)
      : Number.POSITIVE_INFINITY;
    const endpointModulePrefixMeters = routeRole === 'parent-station-attachment'
      ? 0
      : nodeSockets.reduce((sum, [node, throughLocalSocketId]) => {
        if (!node?.connectorOwned || !node?.exactParentEndpoint) return sum;
        if (Number(node.plannedMinimumGraphDegree ?? 0) >= 3) return sum;
        const committedDegree = node.sockets.filter((socket) => (
          socket.state === 'connected' && socket.segmentId
        )).length;
        // This segment promotes a degree-two-or-higher compact node to a real
        // junction, which is a legitimate reset. Only infrastructure that will
        // remain below degree three carries its parent approach into this span.
        if (committedDegree + 1 >= 3) return sum;
        const parentSegment = segments.find((candidate) => (
          candidate.routeRole === 'parent-station-attachment'
            && [candidate.from, candidate.to].some((endpoint) => (
              String(endpoint?.nodeId ?? '') === String(node.id)
            ))
        ));
        const parentNodeSocket = parentSegment
          ? node.sockets.find(({ segmentId }) => String(segmentId ?? '') === parentSegment.id)
          : null;
        return sum + (parentSegment && parentNodeSocket
          ? maximumContinuousLevelRouteSpan(parentSegment.path)
            + connectorModuleCoreTraversalDistance(
              node,
              parentNodeSocket.localSocketId,
              throughLocalSocketId,
            )
          : Number.POSITIVE_INFINITY);
      }, 0);
    if (!Array.isArray(segmentPath)
      || segmentPath.length < 2
      || measureDungeonPolyline(segmentPath) <= 1e-6
      || segmentFeaturelessDistance > Number(
        profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
      ) + 1e-6
      || segmentFeaturelessDistance + endpointModulePrefixMeters > Number(
        profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
      ) + 1e-6) return null;
    if (routeRole === 'parent-station-attachment'
      && pathPlanningCollisionScore(
        segmentPath,
        routeAvoidanceVolumes,
        3.6,
        parentAttachmentOverlapGrants,
      ) > 0) return null;
    const segment = createSegment({
      id: segmentId,
      operationId,
      parentRegionId: region.id,
      physicalOrdinal: segmentOrdinal,
      logicalEdgeId: grant.coverage?.logicalEdgeId ?? null,
      from,
      to,
      connectorFamily,
      themeBinding: region.themeBinding,
      coordinateSpace: grant.endpointSockets[0].coordinateSpace,
      heightMeters: routeRole === 'parent-station-attachment' ? 3.6 : 5.6,
      landingDepthMeters: 5.6,
      path: segmentPath,
    });
    const authoredLocalApproachWitness = (endpoint) => {
      const endpointSocketId = String(endpoint?.socketId ?? endpoint?.id ?? '');
      const ownedNodeSocket = nodeSockets.flatMap(([node]) => (
        node?.sockets ?? []
      )).find((socket) => String(socket.id) === endpointSocketId);
      const socket = ownedNodeSocket ?? endpoint;
      if (!socket?.position || !socket?.facing || !endpointSocketId) return null;
      return {
        nodeId: String(endpoint?.nodeId ?? ownedNodeSocket?.nodeId ?? ''),
        socketId: endpointSocketId,
        localSocketId: ownedNodeSocket?.localSocketId ?? endpoint?.localSocketId ?? null,
        path: [
          addDungeonPoints(
            socket.position,
            scaleDungeonPoint(socket.facing, -ROUTE_NETWORK_SOCKET_APPROACH_METERS),
          ),
          cloneDungeonAugmentationValue(socket.position),
        ],
      };
    };
    const resolvedLocalApproachWitnesses = Array.isArray(localApproachWitnesses)
      ? localApproachWitnesses
      : [from, to].map(authoredLocalApproachWitness);
    if (resolvedLocalApproachWitnesses.some(Boolean)) {
      segment.localApproachWitnesses = cloneDungeonAugmentationValue(
        resolvedLocalApproachWitnesses,
      );
    }
    if ((segment.occupiedVolumes ?? []).some((volume) => (
      !['x', 'y', 'z'].every((axis) => Number(volume.size?.[axis]) > 1e-6)
    ))) return null;
    const finalSegmentVolumes = [
      ...(segment.occupiedVolumes ?? []),
      ...(segment.clearanceVolumes ?? []),
      ...(segment.landingVolumes ?? []),
    ];
    const finalOverlapGrants = [
      ...parentAttachmentOverlapGrants,
      ...sharedEndpointOverlapGrants,
    ];
    const rejectedFinalOverlap = finalSegmentVolumes.flatMap((volume) => (
      routeAvoidanceVolumes.map((obstacle) => ({ volume, obstacle }))
    )).find(({ volume, obstacle }) => (
      planningVolumesOverlap(volume, obstacle)
        && !planningOverlapIsGranted(volume, obstacle, finalOverlapGrants)
    ));
    if (rejectedFinalOverlap) {
      lastSegmentFailureDiagnostics = {
        code: 'final-segment-volume-overlap',
        segmentId,
        routeRole,
        volume: cloneDungeonAugmentationValue(rejectedFinalOverlap.volume),
        obstacle: cloneDungeonAugmentationValue(rejectedFinalOverlap.obstacle),
        overlapGrants: cloneDungeonAugmentationValue(finalOverlapGrants),
      };
      return null;
    }
    decorateRouteNetworkSegment(segment, {
      routeRole,
      elevationMode,
      stableRuntimeStateIds,
    });
    nextSegmentOrdinal += 1;
    for (const [node, localSocketId] of nodeSockets) {
      connectNodeSocket(node, localSocketId, segmentId);
    }
    segments.push(segment);
    localPlacementAvoidanceVolumes.push(
      ...segment.occupiedVolumes,
      ...segment.clearanceVolumes,
      ...segment.landingVolumes,
    );
    return segment;
  };
  const addSharedJunctionThresholdSegment = ({
    fromNode,
    fromLocalSocketId,
    toNode,
    toLocalSocketId,
    routeRole,
    sharedEndpointFootprint,
    localApproachWitnesses,
  }) => {
    const fromSocket = getNodeSocket(fromNode, fromLocalSocketId);
    const toSocket = getNodeSocket(toNode, toLocalSocketId);
    if (!fromSocket || !toSocket
      || fromSocket.state !== 'capped'
      || toSocket.state !== 'capped'
      || dungeonPointDistance(fromSocket.position, toSocket.position) > 1e-6
      || sharedEndpointFootprint?.kind !== 'shared-junction-threshold'
      || !Array.isArray(localApproachWitnesses)
      || localApproachWitnesses.length !== 2) return null;
    const segmentOrdinal = nextSegmentOrdinal;
    const segmentId = createDungeonSupplementId({
      parentRegionId: region.id,
      operationType: 'routeNetwork',
      operationOrdinal,
      kind: 'segment',
      ordinal: segmentOrdinal,
      sourceId,
    });
    const from = nodeEndpoint(fromNode, fromLocalSocketId);
    const to = nodeEndpoint(toNode, toLocalSocketId);
    const sharedPosition = cloneDungeonAugmentationValue(fromSocket.position);
    const segment = {
      id: segmentId,
      operationId,
      parentRegionId: region.id,
      logicalEdgeId: grant.coverage?.logicalEdgeId ?? null,
      physicalOrdinal: segmentOrdinal,
      kind: 'shared-junction-threshold',
      from,
      to,
      // The typed footprint is the physical edge. Keep the coincident endpoint
      // path explicit so no ordinary corridor body is synthesized or stamped.
      path: [sharedPosition, cloneDungeonAugmentationValue(sharedPosition)],
      connectorFamily: 'service-gallery',
      widthMeters: Number(sharedEndpointFootprint.size?.x ?? 8.4),
      heightMeters: Number(sharedEndpointFootprint.size?.y ?? 5.6),
      themeBinding: cloneDungeonAugmentationValue(region.themeBinding),
      coordinateSpace: grant.endpointSockets[0].coordinateSpace,
      bidirectional: true,
      traversal: { player: true, groundedEnemy: true, aerialEnemy: true },
      sharedCorridorDistanceMeters: 0,
      sharedEndpointFootprint: cloneDungeonAugmentationValue(sharedEndpointFootprint),
      localApproachWitnesses: cloneDungeonAugmentationValue(localApproachWitnesses),
      occupiedVolumes: [],
      clearanceVolumes: [],
      landings: [
        { id: `${segmentId}:from-landing`, position: sharedPosition, flat: true },
        {
          id: `${segmentId}:to-landing`,
          position: cloneDungeonAugmentationValue(sharedPosition),
          flat: true,
        },
      ],
      landingVolumes: [],
      requiredThemeCapabilities: {
        materials: [],
        assets: [],
        connectors: ['service-gallery'],
        transitions: [],
      },
    };
    decorateRouteNetworkSegment(segment, {
      routeRole,
      elevationMode,
      stableRuntimeStateIds,
    });
    connectNodeSocket(fromNode, fromLocalSocketId, segmentId);
    connectNodeSocket(toNode, toLocalSocketId, segmentId);
    nextSegmentOrdinal += 1;
    segments.push(segment);
    return segment;
  };
  for (let index = 0; index < endpoints.length; index += 1) {
    const socket = endpoints[index];
    const nodeIndex = grant.kind === 'landmark-perimeter-loop'
      ? (index === 0 ? 0 : mainNodes.length - 1)
      : coveragePlacement.endpointNodeIndices[index];
    const node = nodes[nodeIndex];
    const localSocketId = grant.kind === 'landmark-perimeter-loop'
      ? index === 0 ? 'entry' : 'exit'
      : 'entry';
    const parentEndpoint = {
      kind: 'parentSocket',
      id: socket.id,
      nodeId: socket.nodeId,
      socketId: socket.id,
      position: cloneDungeonAugmentationValue(socket.position),
      facing: cloneDungeonAugmentationValue(socket.facing),
    };
    const attachmentSegment = addSegment({
      from: parentEndpoint,
      to: nodeEndpoint(node, localSocketId),
      routeRole: 'parent-station-attachment',
      nodeSockets: [[node, localSocketId]],
      preselectedPath: grant.kind === 'objective-route-coverage'
        ? preselectedCoverageParentAttachmentPaths?.[index] ?? null
        : null,
    });
    if (!attachmentSegment) {
      return {
        error: 'route-network-parent-attachment-unrealizable',
        context: { grantId: grant.id, socketId: socket.id, endpointOrdinal: index },
      };
    }
  }
  if (grant.kind === 'landmark-perimeter-loop') {
    const wingNodeIndex = physicalModuleCount - 1;
    const wingParent = mainNodes[junctionModuleIndex];
    const landmarkCenter = grant.source?.landmarkBounds?.center;
    const outwardReference = landmarkCenter
      ? toDungeonCardinalFacing({
        x: wingParent.placement.center.x - Number(landmarkCenter.x),
        z: wingParent.placement.center.z - Number(landmarkCenter.z),
      })
      : endpoints.at(-1).facing;
    const decisionSockets = ['exit', 'left', 'right']
      .map((localSocketId) => ({
        localSocketId,
        socket: getNodeSocket(wingParent, localSocketId),
      }))
      .filter(({ socket }) => socket?.state === 'capped')
      .sort((first, second) => (
        second.socket.facing.x * outwardReference.x
          + second.socket.facing.z * outwardReference.z
          - first.socket.facing.x * outwardReference.x
          - first.socket.facing.z * outwardReference.z
          || first.localSocketId.localeCompare(second.localSocketId)
      ));
    const variant = Math.max(0, Math.floor(Number(searchVariant) || 0));
    const decisionOffset = decisionSockets.length > 0 ? variant % decisionSockets.length : 0;
    const orderedDecisionSockets = [
      ...decisionSockets.slice(decisionOffset),
      ...decisionSockets.slice(0, decisionOffset),
    ];
    const wingDepth = Number(selectedGrammars[wingNodeIndex].size.depth);
    const minimumWingConnectorRun = Math.max(
      Math.max(
        ROUTE_NETWORK_SOCKET_APPROACH_METERS,
        Number(profile.connectorGapMeters ?? ROUTE_NETWORK_SOCKET_APPROACH_METERS),
      ) * 2,
      wingNodeIndex === elevationNodeIndex
        ? Number(ROUTE_NETWORK_VERTICAL_MINIMUM_RUN_METERS[verticalFamily] ?? 0)
        : 0,
    );
    const attemptedWingCandidates = [];
    for (const decisionSocket of orderedDecisionSockets) {
      const wingFacing = decisionSocket.socket.facing;
      const wingCenter = addDungeonPoints(
        decisionSocket.socket.position,
        scaleDungeonPoint(
          wingFacing,
          wingDepth * 0.5 + minimumWingConnectorRun,
        ),
      );
      if (wingNodeIndex === elevationNodeIndex) {
        wingCenter.y = Number(wingParent.placement.center.y) + 14;
      }
      const rawCandidates = placeCollisionSafeNode(
        wingNodeIndex,
        wingCenter,
        wingFacing,
        wingFacing,
        null,
        [],
        { candidatesOnly: true },
      ).filter((candidate) => (
        candidate.collisionScore === 0
          && !candidate.parentDistanceExceeded
          && !candidate.spineDistanceExceeded
          && !candidate.parentAttachmentBlocked
      ));
      const candidateOffset = rawCandidates.length > 0
        ? Math.floor(variant / Math.max(1, decisionSockets.length)) % rawCandidates.length
        : 0;
      const candidates = [
        ...rawCandidates.slice(candidateOffset),
        ...rawCandidates.slice(0, candidateOffset),
      ].slice(0, 24);
      for (const candidate of candidates) {
        const candidateVolumes = [
          ...(candidate.node.occupiedVolumes ?? []),
          ...(candidate.node.clearanceVolumes ?? []),
        ];
        localPlacementAvoidanceVolumes.push(...candidateVolumes);
        // This compact parent is committed to the two perimeter approaches and
        // the reward wing. Mark the promised degree before measuring the wing,
        // so the already-realized parent threshold is not incorrectly carried
        // through what will be a meaningful three-arm junction.
        wingParent.plannedMinimumGraphDegree = Math.max(
          3,
          Number(wingParent.plannedMinimumGraphDegree ?? 0),
        );
        const wingSegment = addSegment({
          from: nodeEndpoint(wingParent, decisionSocket.localSocketId),
          to: nodeEndpoint(candidate.node, 'entry'),
          routeRole: 'pyramid-loop-content-wing',
          nodeSockets: [
            [wingParent, decisionSocket.localSocketId],
            [candidate.node, 'entry'],
          ],
        });
        attemptedWingCandidates.push({
          parentLocalSocketId: decisionSocket.localSocketId,
          center: cloneDungeonAugmentationValue(candidate.center),
          connected: Boolean(wingSegment),
        });
        if (!wingSegment) {
          localPlacementAvoidanceVolumes.splice(
            localPlacementAvoidanceVolumes.length - candidateVolumes.length,
            candidateVolumes.length,
          );
          continue;
        }
        centers.push(candidate.center);
        nodes.push(candidate.node);
        pyramidWingConnection = {
          parentNode: wingParent,
          parentLocalSocketId: decisionSocket.localSocketId,
          wingNode: candidate.node,
          segment: wingSegment,
        };
        break;
      }
      if (pyramidWingConnection) break;
    }
    if (!pyramidWingConnection) {
      return {
        error: 'pyramid-loop-content-wing-unrealizable',
        context: {
          grantId: grant.id,
          searchVariant: variant,
          attemptedWingCandidates: attemptedWingCandidates.slice(0, 12),
        },
      };
    }
  }
  const availableSocketPairs = (fromNode, toNode, diagnostics = null) => {
    const fromSockets = fromNode.sockets.filter(({ state }) => state === 'capped');
    const toSockets = toNode.sockets.filter(({ state }) => state === 'capped');
    const routeAvoidanceVolumes = localPlacementAvoidanceVolumes.filter((volume) => (
      !planningVolumeOwnedByAny(volume, [fromNode.id, toNode.id])
    ));
    const rawCandidates = fromSockets.flatMap((fromSocket) => toSockets.flatMap((toSocket) => {
      const connectorFamily = Math.abs(
        Number(toSocket.position.y) - Number(fromSocket.position.y),
      ) > 1e-6 ? verticalFamily : 'service-gallery';
      return cachedSocketRouteCandidates(fromSocket, toSocket, {
        preferXFirst: segments.length % 2 === 0,
        connectorFamily,
        ...coverageModuleRouteOptions,
      }).map((path) => ({
        fromLocalSocketId: fromSocket.localSocketId,
        toLocalSocketId: toSocket.localSocketId,
        path,
        collisionScore: pathPlanningCollisionScore(path, routeAvoidanceVolumes),
        distanceMeters: maximumContinuousLevelRouteSpan(path),
        physicalLengthMeters: measureDungeonPolyline(path),
        endpointPrefixMeters: [
          [fromNode, fromSocket],
          [toNode, toSocket],
        ].reduce((sum, [candidateNode, throughSocket]) => {
          if (!candidateNode?.connectorOwned
            || !candidateNode?.exactParentEndpoint
            || Number(candidateNode.plannedMinimumGraphDegree ?? 0) >= 3) return sum;
          const parentSegment = segments.find((candidate) => (
            candidate.routeRole === 'parent-station-attachment'
              && [candidate.from, candidate.to].some((endpoint) => (
                String(endpoint?.nodeId ?? '') === String(candidateNode.id)
              ))
          ));
          const parentNodeSocket = parentSegment
            ? candidateNode.sockets.find(({ segmentId }) => (
              String(segmentId ?? '') === String(parentSegment.id)
            ))
            : null;
          return sum + (parentSegment && parentNodeSocket
            ? maximumContinuousLevelRouteSpan(parentSegment.path)
              + connectorModuleCoreTraversalDistance(
                candidateNode,
                parentNodeSocket.localSocketId,
                throughSocket.localSocketId,
              )
            : Number.POSITIVE_INFINITY);
        }, 0),
      }));
    }));
    const physicallyEligibleCandidates = rawCandidates.filter(({
      collisionScore,
      physicalLengthMeters,
    }) => collisionScore === 0 && physicalLengthMeters > 1e-6);
    const measuredCandidates = physicallyEligibleCandidates.map((candidate) => ({
        ...candidate,
        accumulatedFeaturelessDistanceMeters: candidate.distanceMeters
          + candidate.endpointPrefixMeters,
      }));
    const maximumFeaturelessSpanMeters = Number(
      profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
    );
    const eligibleCandidates = measuredCandidates.filter(({
      accumulatedFeaturelessDistanceMeters,
    }) => accumulatedFeaturelessDistanceMeters <= maximumFeaturelessSpanMeters + 1e-6);
    if (diagnostics && typeof diagnostics === 'object') {
      Object.assign(diagnostics, {
        fromNodeId: fromNode.id,
        toNodeId: toNode.id,
        fromCenter: cloneDungeonAugmentationValue(fromNode.placement?.center),
        toCenter: cloneDungeonAugmentationValue(toNode.placement?.center),
        fromSocketCount: fromSockets.length,
        toSocketCount: toSockets.length,
        routeCandidateCount: rawCandidates.length,
        physicallyEligibleCandidateCount: physicallyEligibleCandidates.length,
        featurelessEligibleCandidateCount: eligibleCandidates.length,
        featurelessEligibleSocketPairs: eligibleCandidates.slice(0, 8).map((candidate) => ({
          fromLocalSocketId: candidate.fromLocalSocketId,
          toLocalSocketId: candidate.toLocalSocketId,
          distanceMeters: candidate.accumulatedFeaturelessDistanceMeters,
        })),
        minimumCollisionScore: rawCandidates.length > 0
          ? Math.min(...rawCandidates.map(({ collisionScore }) => collisionScore))
          : null,
        minimumPhysicalLengthMeters: physicallyEligibleCandidates.length > 0
          ? Math.min(...physicallyEligibleCandidates.map(({ physicalLengthMeters }) => (
            physicalLengthMeters
          )))
          : null,
        minimumAccumulatedFeaturelessDistanceMeters: measuredCandidates.length > 0
          ? Math.min(...measuredCandidates.map(({ accumulatedFeaturelessDistanceMeters }) => (
            accumulatedFeaturelessDistanceMeters
          )))
          : null,
        maximumFeaturelessSpanMeters,
      });
    }
    return eligibleCandidates.sort((first, second) => (
      first.accumulatedFeaturelessDistanceMeters
        - second.accumulatedFeaturelessDistanceMeters
        || first.distanceMeters - second.distanceMeters
        || first.physicalLengthMeters - second.physicalLengthMeters
        || first.fromLocalSocketId.localeCompare(second.fromLocalSocketId)
        || first.toLocalSocketId.localeCompare(second.toLocalSocketId)
    ));
  };
  const closestAvailableSocketPair = (fromNode, toNode) => (
    availableSocketPairs(fromNode, toNode)[0] ?? null
  );
  const realizedConnectedSockets = (node) => node.sockets
    .filter((socket) => (
      socket.state === 'connected'
        && socket.segmentId
        && segments.some((segment) => (
          String(segment.id) === String(socket.segmentId)
            && [segment.from, segment.to].some((endpoint) => (
              String(endpoint?.nodeId ?? '') === String(node.id)
                && String(endpoint?.socketId ?? endpoint?.id ?? '') === String(socket.id)
            ))
        ))
    ));
  const realizedParentThroughPhysicalArmId = (node) => (
    node?.exactParentEndpoint === true
      && node?.parentEndpointSocketKind === 'authored-corridor-station'
      && Number(node?.parentThroughRouteDegreeContribution ?? 0) === 1
      ? String(
          node.parentThroughPhysicalArmId ?? `${node.id}:authored-parent-through-arm`,
        )
      : null
  );
  const realizedPhysicalArmIds = (
    node,
    activeSockets = realizedConnectedSockets(node),
  ) => {
    const parentThroughPhysicalArmId = realizedParentThroughPhysicalArmId(node);
    return [
      ...activeSockets.map(({ id }) => String(id)),
      ...(parentThroughPhysicalArmId ? [parentThroughPhysicalArmId] : []),
    ];
  };
  const realizedNodeDegree = (node) => realizedPhysicalArmIds(node).length;
  const canPromoteToRealizedJunction = (node) => (
    node?.selectionConstraints?.supportsJunctionPromotion !== false
  );
  const hasRealizedJunction = () => nodes.some((node) => (
    canPromoteToRealizedJunction(node) && realizedNodeDegree(node) >= 3
  ));
  const mainSpineNodeCount = grant.kind === 'landmark-perimeter-loop'
    ? nodes.length - 1
    : nodes.length;
  let pyramidSpineFailureDiagnostics = [];
  const pyramidSpinePairs = grant.kind === 'landmark-perimeter-loop'
    ? (() => {
      const diagnostics = [];
      const usedByNodeId = new Map(nodes.map((node) => [
        node.id,
        new Set(node.sockets
          .filter(({ state }) => state !== 'capped')
          .map(({ localSocketId }) => localSocketId)),
      ]));
      // The reward wing's aperture belongs to the physical degree-three
      // midpoint junction. Reserve that aperture while solving the perimeter
      // spine, but defer its corridor until the spine is committed. This keeps
      // the branch from falsely blocking a valid main route while still
      // preventing the spine from consuming the branch socket.
      usedByNodeId
        .get(pyramidWingConnection.parentNode.id)
        ?.add(pyramidWingConnection.parentLocalSocketId);
      const selectedPairs = [];
      const visit = (edgeIndex) => {
        if (edgeIndex >= mainSpineNodeCount - 1) return true;
        const fromNode = nodes[edgeIndex];
        const toNode = nodes[edgeIndex + 1];
        const fromUsed = usedByNodeId.get(fromNode.id);
        const toUsed = usedByNodeId.get(toNode.id);
        const edgeDiagnostics = {
          edgeIndex,
          fromUsedSocketIds: [...fromUsed].sort(),
          toUsedSocketIds: [...toUsed].sort(),
        };
        const previouslySelectedRouteVolumes = selectedPairs.flatMap(({ path }) => (
          routePathPlanningVolumes(path)
        ));
        const sharedMidpointOverlapGrants = [fromNode?.junction?.clearCoreVolume]
          .filter((volume) => volume?.center && volume?.size);
        const candidates = availableSocketPairs(
          fromNode,
          toNode,
          edgeDiagnostics,
        ).filter((candidate) => (
          !fromUsed.has(candidate.fromLocalSocketId)
            && !toUsed.has(candidate.toLocalSocketId)
            && pathPlanningCollisionScore(
              candidate.path,
              previouslySelectedRouteVolumes,
              5.6,
              sharedMidpointOverlapGrants,
            ) === 0
        ));
        edgeDiagnostics.unusedEligibleCandidateCount = candidates.length;
        if (diagnostics.length < 32) diagnostics.push(edgeDiagnostics);
        for (const candidate of candidates) {
          fromUsed.add(candidate.fromLocalSocketId);
          toUsed.add(candidate.toLocalSocketId);
          selectedPairs.push(candidate);
          if (visit(edgeIndex + 1)) return true;
          selectedPairs.pop();
          fromUsed.delete(candidate.fromLocalSocketId);
          toUsed.delete(candidate.toLocalSocketId);
        }
        return false;
      };
      const solved = visit(0);
      pyramidSpineFailureDiagnostics = solved ? [] : diagnostics;
      return solved ? selectedPairs.map((pair) => ({ ...pair })) : null;
    })()
    : null;
  const coverageSpinePairs = grant.kind === 'landmark-perimeter-loop'
    ? null
    : preselectedCoverageSpinePairs ?? (() => {
      const usedByNodeId = new Map(nodes.map((node) => [
        node.id,
        new Set(node.sockets
          .filter(({ state }) => state !== 'capped')
          .map(({ localSocketId }) => localSocketId)),
      ]));
      let best = null;
      const visit = (edgeIndex, pairs, maximumDistance, totalDistance) => {
        if (edgeIndex >= mainSpineNodeCount - 1) {
          if (!best
            || maximumDistance < best.maximumDistance - 1e-6
            || (Math.abs(maximumDistance - best.maximumDistance) <= 1e-6
              && totalDistance < best.totalDistance - 1e-6)) {
            best = {
              pairs: pairs.map((pair) => ({ ...pair })),
              maximumDistance,
              totalDistance,
            };
          }
          return;
        }
        const fromNode = nodes[edgeIndex];
        const toNode = nodes[edgeIndex + 1];
        const fromUsed = usedByNodeId.get(fromNode.id);
        const toUsed = usedByNodeId.get(toNode.id);
        const candidates = fromNode.sockets
          .filter(({ localSocketId }) => !fromUsed.has(localSocketId))
          .flatMap((fromSocket) => toNode.sockets
            .filter(({ localSocketId }) => !toUsed.has(localSocketId))
            .map((toSocket) => ({
              fromLocalSocketId: fromSocket.localSocketId,
              toLocalSocketId: toSocket.localSocketId,
              distanceMeters: Math.min(...[true, false].map((preferXFirst) => (
                measureDungeonPolyline(orthogonalRouteSegmentPath(
                  { position: fromSocket.position },
                  { position: toSocket.position },
                  preferXFirst,
                ))
              ))),
            })))
          .sort((first, second) => first.distanceMeters - second.distanceMeters);
        for (const pair of candidates) {
          const nextMaximum = Math.max(maximumDistance, pair.distanceMeters);
          if (best && nextMaximum > best.maximumDistance + 1e-6) continue;
          fromUsed.add(pair.fromLocalSocketId);
          toUsed.add(pair.toLocalSocketId);
          visit(
            edgeIndex + 1,
            [...pairs, pair],
            nextMaximum,
            totalDistance + pair.distanceMeters,
          );
          fromUsed.delete(pair.fromLocalSocketId);
          toUsed.delete(pair.toLocalSocketId);
        }
      };
      visit(0, [], 0, 0);
      return best?.pairs?.map((pair, edgeOrdinal) => ({
        ...pair,
        edgeOrdinal,
        fromIndex: edgeOrdinal,
        toIndex: edgeOrdinal + 1,
        routeRole: 'route-network-spine',
      })) ?? null;
    })();
  if (grant.kind === 'landmark-perimeter-loop' && !pyramidSpinePairs) {
    return {
      error: 'route-network-spine-sockets-unavailable',
      context: {
        grantId: grant.id,
        routeNetworkKind: grant.kind,
        pyramidSpineFailureDiagnostics,
      },
    };
  }
  if (grant.kind !== 'landmark-perimeter-loop' && !coverageSpinePairs) {
    return {
      error: 'route-network-spine-sockets-unavailable',
      context: { grantId: grant.id },
    };
  }
  const committedSpinePairs = grant.kind === 'landmark-perimeter-loop'
    ? pyramidSpinePairs.map((pair, edgeOrdinal) => ({
      ...pair,
      edgeOrdinal,
      fromIndex: edgeOrdinal,
      toIndex: edgeOrdinal + 1,
      routeRole: 'route-network-spine',
    }))
    : coverageSpinePairs;
  for (const dynamicPair of committedSpinePairs) {
    // Perimeter rooms turn around the landmark, so a fixed exit -> entry
    // chain is not generally compatible with the sockets' real outward
    // facings. Select a collision-free physical witness just as coverage
    // networks do, after parent thresholds and the content wing are reserved.
    const fromIndex = Number(dynamicPair?.fromIndex);
    const toIndex = Number(dynamicPair?.toIndex);
    if (!dynamicPair) {
      return {
        error: 'route-network-spine-sockets-unavailable',
        context: { grantId: grant.id, fromNodeIndex: fromIndex, toNodeIndex: toIndex },
      };
    }
    const fromSocketId = dynamicPair?.fromLocalSocketId ?? 'exit';
    const toSocketId = dynamicPair?.toLocalSocketId ?? 'entry';
    const routeRole = dynamicPair.routeRole ?? 'route-network-spine';
    const spineSegment = dynamicPair.sharedEndpointFootprint
      ? addSharedJunctionThresholdSegment({
        fromNode: nodes[fromIndex],
        fromLocalSocketId: fromSocketId,
        toNode: nodes[toIndex],
        toLocalSocketId: toSocketId,
        routeRole,
        sharedEndpointFootprint: dynamicPair.sharedEndpointFootprint,
        localApproachWitnesses: dynamicPair.localApproachWitnesses,
      })
      : addSegment({
        from: nodeEndpoint(nodes[fromIndex], fromSocketId),
        to: nodeEndpoint(nodes[toIndex], toSocketId),
        routeRole,
        nodeSockets: [[nodes[fromIndex], fromSocketId], [nodes[toIndex], toSocketId]],
        preselectedPath: dynamicPair?.path ?? null,
        localApproachWitnesses: dynamicPair?.localApproachWitnesses ?? null,
      });
    if (!spineSegment) {
      const failedFromSocket = getNodeSocket(nodes[fromIndex], fromSocketId);
      const failedToSocket = getNodeSocket(nodes[toIndex], toSocketId);
      const failedEndpointIds = new Set([
        nodes[fromIndex].id,
        nodes[toIndex].id,
      ]);
      const failedAvoidanceVolumes = localPlacementAvoidanceVolumes.filter((volume) => (
        !planningVolumeOwnedByAny(volume, failedEndpointIds)
      ));
      const failedConnectorFamily = Math.abs(
        Number(failedToSocket.position.y) - Number(failedFromSocket.position.y),
      ) > 1e-6 ? verticalFamily : 'service-gallery';
      const failedCandidates = cachedSocketRouteCandidates(
        failedFromSocket,
        failedToSocket,
        {
          preferXFirst: segments.length % 2 === 0,
          connectorFamily: failedConnectorFamily,
          ...coverageModuleRouteOptions,
        },
      ).map((path) => ({
        path,
        collisionScore: pathPlanningCollisionScore(path, failedAvoidanceVolumes),
        collisionIds: pathPlanningCollisionIds(path, failedAvoidanceVolumes).slice(0, 8),
        maximumLevelSpanMeters: maximumContinuousLevelRouteSpan(path),
        physicalLengthMeters: measureDungeonPolyline(path),
      })).sort((first, second) => (
        first.collisionScore - second.collisionScore
          || first.maximumLevelSpanMeters - second.maximumLevelSpanMeters
          || first.physicalLengthMeters - second.physicalLengthMeters
      )).slice(0, 4);
      return {
        error: 'route-network-spine-segment-unrealizable',
        context: {
          grantId: grant.id,
          fromNodeIndex: fromIndex,
          toNodeIndex: toIndex,
          fromSocket: cloneDungeonAugmentationValue(failedFromSocket),
          toSocket: cloneDungeonAugmentationValue(failedToSocket),
          routeCandidates: failedCandidates,
          segmentFailureDiagnostics: cloneDungeonAugmentationValue(
            lastSegmentFailureDiagnostics,
          ),
        },
      };
    }
  }
  if (grant.kind !== 'landmark-perimeter-loop') {
    const connectTopologyChord = (
      fromIndex,
      toIndex,
      routeRole,
      { fromLocalSocketId = null, toLocalSocketId = null } = {},
    ) => {
      if (fromIndex === toIndex) return false;
      const socketPairs = availableSocketPairs(nodes[fromIndex], nodes[toIndex])
        .filter((pair) => (
          (!fromLocalSocketId || pair.fromLocalSocketId === fromLocalSocketId)
            && (!toLocalSocketId || pair.toLocalSocketId === toLocalSocketId)
        ));
      for (const pair of socketPairs) {
        if (pair.distanceMeters > Number(
          profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
        ) + 1e-6) continue;
        const chordSegment = addSegment({
          from: nodeEndpoint(nodes[fromIndex], pair.fromLocalSocketId),
          to: nodeEndpoint(nodes[toIndex], pair.toLocalSocketId),
          routeRole,
          nodeSockets: [
            [nodes[fromIndex], pair.fromLocalSocketId],
            [nodes[toIndex], pair.toLocalSocketId],
          ],
          preselectedPath: pair.path,
        });
        if (chordSegment) return true;
      }
      return false;
    };
    const connectAuthoredTopologySockets = (kitNodeIndex, routeRole) => {
      const kitNode = nodes[kitNodeIndex];
      const topologySocketIds = (
        kitNode?.selectionConstraints?.routeNetworkTopologySocketIds ?? []
      ).map(String);
      if (!kitNode || topologySocketIds.length === 0) return false;
      const pendingSocketIds = topologySocketIds.filter((localSocketId) => (
        getNodeSocket(kitNode, localSocketId)?.state === 'capped'
      ));
      if (pendingSocketIds.length === 0) return true;
      const targetNodeIndices = nodes
        .map((node, index) => ({
          index,
          distanceMeters: index === kitNodeIndex
            ? Number.POSITIVE_INFINITY
            : dungeonPointDistance(node.placement.center, kitNode.placement.center),
        }))
        .filter(({ index }) => index !== kitNodeIndex)
        .sort((first, second) => (
          first.distanceMeters - second.distanceMeters || first.index - second.index
        ))
        .map(({ index }) => index);
      const targetIndexSets = pendingSocketIds.length === 1
        ? targetNodeIndices.map((index) => [index])
        : targetNodeIndices.flatMap((firstIndex) => targetNodeIndices
          .filter((secondIndex) => secondIndex !== firstIndex)
          .map((secondIndex) => [firstIndex, secondIndex]));
      for (const targetIndices of targetIndexSets) {
        const transaction = {
          segmentCount: segments.length,
          avoidanceVolumeCount: localPlacementAvoidanceVolumes.length,
          nextSegmentOrdinal,
          sockets: nodes.flatMap((node) => node.sockets.map((socket) => ({
            socket,
            state: socket.state,
            segmentId: socket.segmentId,
            capRole: socket.capRole,
          }))),
        };
        const connected = pendingSocketIds.every((localSocketId, ordinal) => (
          connectTopologyChord(
            kitNodeIndex,
            targetIndices[ordinal],
            `${routeRole}:${localSocketId}`,
            { fromLocalSocketId: localSocketId },
          )
        ));
        if (connected) return true;
        segments.length = transaction.segmentCount;
        localPlacementAvoidanceVolumes.length = transaction.avoidanceVolumeCount;
        nextSegmentOrdinal = transaction.nextSegmentOrdinal;
        for (const socketState of transaction.sockets) {
          socketState.socket.state = socketState.state;
          socketState.socket.segmentId = socketState.segmentId;
          socketState.socket.capRole = socketState.capRole;
        }
      }
      return false;
    };
    if (topologyTemplateId === 'parallel-gallery-loop') {
      connectTopologyChord(0, 1, 'parallel-gallery-loop:return-leg');
    } else if (topologyTemplateId === 'split-level-ring') {
      const middle = Math.max(0, Math.floor(nodes.length * 0.5) - 1);
      connectTopologyChord(middle, Math.min(nodes.length - 1, middle + 1), 'split-level-ring:return-leg');
    } else if (topologyTemplateId === 'over-under-loop') {
      const upperRouteConnected = topologyKitModuleIndex == null
        ? connectTopologyChord(0, 1, 'over-under-loop:upper-return-leg')
        : connectAuthoredTopologySockets(
          topologyKitModuleIndex,
          'over-under-loop:upper-return-leg',
        );
      if (!upperRouteConnected) {
        return {
          error: 'route-network-topology-kit-return-leg-unrealizable',
          context: {
            grantId: grant.id,
            topologyTemplateId,
            topologyKitModuleIndex,
          },
        };
      }
    } else if (topologyTemplateId === 'fork-merge-h-loop') {
      if (nodes.length >= 4) {
        connectTopologyChord(0, 1, 'fork-merge:first-arm');
        connectTopologyChord(
          nodes.length - 2,
          nodes.length - 1,
          'fork-merge:second-arm',
        );
      } else {
        connectTopologyChord(0, nodes.length - 1, 'fork-merge:return-arm');
      }
    } else if (topologyTemplateId === 'stacked-interchange') {
      const middle = Math.max(0, Math.floor(nodes.length * 0.5) - 1);
      const upperRouteConnected = topologyKitModuleIndex == null
        ? connectTopologyChord(
          middle,
          Math.min(nodes.length - 1, middle + 1),
          'stacked-interchange:upper-arm',
        )
        : connectAuthoredTopologySockets(
          topologyKitModuleIndex,
          'stacked-interchange:upper-arm',
        );
      if (!upperRouteConnected) {
        return {
          error: 'route-network-topology-kit-return-leg-unrealizable',
          context: {
            grantId: grant.id,
            topologyTemplateId,
            topologyKitModuleIndex,
          },
        };
      }
    } else if (topologyTemplateId === 'multi-door-room-chain') {
      const middle = Math.max(0, Math.floor(nodes.length * 0.5) - 1);
      connectTopologyChord(
        middle,
        Math.min(nodes.length - 1, middle + 1),
        'multi-door-room-chain:local-junction-loop',
      );
    }
    if (!hasRealizedJunction()) {
      const fallbackPairs = [];
      for (let fromIndex = 0; fromIndex < nodes.length; fromIndex += 1) {
        for (let toIndex = fromIndex + 1; toIndex < nodes.length; toIndex += 1) {
          fallbackPairs.push({ fromIndex, toIndex, separation: toIndex - fromIndex });
        }
      }
      fallbackPairs.sort((first, second) => (
        first.separation - second.separation
          || first.fromIndex - second.fromIndex
      ));
      for (const { fromIndex, toIndex } of fallbackPairs) {
        if (connectTopologyChord(
          fromIndex,
          toIndex,
          `${topologyTemplateId}:bounded-junction-arm`,
        )) break;
      }
    }
    if (!hasRealizedJunction()) {
      const wingGrammar = routeNetworkContentGrammarForRole(profile, grammars, 'reward');
      let wingAdded = false;
      if (nodes.length < moduleCapacity && wingGrammar) {
        for (const parentNode of nodes.filter((node) => realizedNodeDegree(node) === 2)) {
          const decisionSockets = parentNode.sockets
            .filter(({ state }) => state === 'capped')
            .sort((first, second) => first.id.localeCompare(second.id));
          for (const decisionSocket of decisionSockets) {
            const wingIndex = nodes.length;
            const wingId = createDungeonSupplementId({
              parentRegionId: region.id,
              operationType: 'routeNetwork',
              operationOrdinal,
              kind: 'node',
              ordinal: wingIndex,
              sourceId,
            });
            const wingFacing = decisionSocket.facing;
            const tangent = { x: -wingFacing.z, y: 0, z: wingFacing.x };
            const minimumGap = Math.max(
              ROUTE_NETWORK_SOCKET_APPROACH_METERS,
              Number(profile.connectorGapMeters ?? ROUTE_NETWORK_SOCKET_APPROACH_METERS),
            );
            // A fixed straight wing often lands inside an authored gallery.
            // Search a bounded, tile-aligned fan instead. Every accepted
            // candidate still has a facing-correct two-tile lead, a clear
            // substantive room, and an exact collision-free corridor; a
            // decorative capped arm can never satisfy this fallback.
            const wingPlacements = [];
            const seenWingCenters = new Set();
            for (const outwardGap of [
              minimumGap,
              minimumGap + 8.4,
              minimumGap + 16.8,
              minimumGap + 25.2,
            ]) {
              for (const tangentOffset of [0, -8.4, 8.4, -16.8, 16.8, -25.2, 25.2]) {
                if (outwardGap + Math.abs(tangentOffset)
                  > Number(profile.routeNetworkPlanning.maximumFeaturelessSpanMeters) + 1e-6) {
                  continue;
                }
                const wingCenter = addDungeonPoints(
                  addDungeonPoints(
                    decisionSocket.position,
                    scaleDungeonPoint(
                      wingFacing,
                      Number(wingGrammar.size.depth) * 0.5 + outwardGap,
                    ),
                  ),
                  scaleDungeonPoint(tangent, tangentOffset),
                );
                const centerSignature = [wingCenter.x, wingCenter.y, wingCenter.z]
                  .map((value) => Number(value).toFixed(4)).join(':');
                if (seenWingCenters.has(centerSignature)) continue;
                seenWingCenters.add(centerSignature);
                wingPlacements.push({ wingCenter, outwardGap, tangentOffset });
              }
            }
            wingPlacements.sort((first, second) => (
              first.outwardGap + Math.abs(first.tangentOffset)
                - second.outwardGap - Math.abs(second.tangentOffset)
                || Math.abs(first.tangentOffset) - Math.abs(second.tangentOffset)
                || first.tangentOffset - second.tangentOffset
            ));
            for (const { wingCenter } of wingPlacements) {
              const wingNode = createNode({
                id: wingId,
                operationId,
                parentRegionId: region.id,
                ordinal: wingIndex,
                grammar: wingGrammar,
                themeBinding: region.themeBinding,
                center: wingCenter,
                facing: wingFacing,
                coordinateSpace: grant.endpointSockets[0].coordinateSpace,
                progressionOrder: progressionOrderStart + wingIndex,
              });
              applyRouteNetworkNodeSemantics(wingNode, {
                contentRole: 'reward',
                junctionKind: 'through-t',
                progressionBandId: grant.progressionBandId,
                accessDomainId: grant.accessDomainId,
                elevationMode: 'level',
              });
              if (nodePlanningCollisionScore(wingNode, localPlacementAvoidanceVolumes) > 0) {
                continue;
              }
              const wingSegment = addSegment({
                from: nodeEndpoint(parentNode, decisionSocket.localSocketId),
                to: nodeEndpoint(wingNode, 'entry'),
                routeRole: `${topologyTemplateId}:bounded-content-wing`,
                nodeSockets: [
                  [parentNode, decisionSocket.localSocketId],
                  [wingNode, 'entry'],
                ],
              });
              if (!wingSegment) continue;
              nodes.push(wingNode);
              centers.push(wingCenter);
              contentRoles.push('reward');
              junctionKinds.push('through-t');
              localPlacementAvoidanceVolumes.push(
                ...wingNode.occupiedVolumes,
                ...wingNode.clearanceVolumes,
              );
              wingAdded = realizedNodeDegree(parentNode) >= 3
                && getNodeSocket(wingNode, 'entry')?.segmentId === wingSegment.id
                && hasRealizedJunction();
              if (!wingAdded) {
                return {
                  error: 'route-network-bounded-junction-commit-inconsistent',
                  context: {
                    grantId: grant.id,
                    parentNodeId: parentNode.id,
                    wingNodeId: wingNode.id,
                    segmentId: wingSegment.id,
                  },
                };
              }
              break;
            }
            if (wingAdded) break;
          }
          if (wingAdded) break;
        }
      }
      if (!wingAdded) {
        return {
          error: 'route-network-bounded-junction-unavailable',
          context: { grantId: grant.id, topologyTemplateId },
        };
      }
    }
  }
  const segmentFeaturelessDistanceMeters = (segment) => {
    return maximumContinuousLevelRouteSpan(segment.path);
  };
  const maximumFeaturelessSpanMeters = Number(
    profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
  );
  for (const node of nodes) {
    const activeSockets = realizedConnectedSockets(node);
    const activeSocketIds = activeSockets.map(({ id }) => id);
    const connectorInfrastructure = node.connectorOwned === true;
    // An authored corridor station exposes a through pair on the parent route;
    // the single attachment socket represents one of those arms. Count its
    // recorded continuation as a real physical arm, so a supplement branch at
    // that station is correctly recognized as a T rather than as a degree-two
    // vestibule. Ordinary caps and free-standing connector modules contribute
    // nothing here.
    const parentThroughRouteDegreeContribution = Number(
      node.parentThroughRouteDegreeContribution ?? 0,
    );
    const parentAttachmentSocket = activeSockets.find((socket) => {
      const segment = segments.find(({ id }) => String(id) === String(socket.segmentId));
      return segment?.routeRole === 'parent-station-attachment';
    }) ?? null;
    const parentThroughPhysicalArmId = realizedParentThroughPhysicalArmId(node);
    const activePhysicalArmIds = realizedPhysicalArmIds(node, activeSockets);
    const throughSocketIds = parentThroughPhysicalArmId && parentAttachmentSocket
      ? [parentAttachmentSocket.id, parentThroughPhysicalArmId]
      : activeSocketIds.slice(0, Math.min(2, activeSocketIds.length));
    const throughSocketIdSet = new Set(throughSocketIds);
    const realizedGraphDegree = activePhysicalArmIds.length;
    const realizedJunction = canPromoteToRealizedJunction(node)
      && realizedGraphDegree >= 3;
    const junctionCandidateKind = node.junction.junctionKind;
    node.junction.activeSocketIds = activePhysicalArmIds;
    node.junction.graphDegree = realizedGraphDegree;
    node.junction.parentThroughRouteDegreeContribution =
      parentThroughRouteDegreeContribution;
    node.parentThroughPhysicalArmId = parentThroughPhysicalArmId;
    node.junction.throughSocketPairs = throughSocketIds.length === 2
      ? [throughSocketIds]
      : [];
    node.junction.decisionSocketIds = activePhysicalArmIds.filter((socketId) => (
      !throughSocketIdSet.has(socketId)
    ));
    node.junction.countsAsMeaningfulStation = realizedJunction;
    node.graphDegree = realizedGraphDegree;
    node.junctionCandidateKind = junctionCandidateKind;
    if (connectorInfrastructure) {
      // A connector grammar is only a compact piece of infrastructure until
      // the committed physical graph proves three active arms. Exact parent
      // vestibules, turns, landings, and transfer modules therefore cannot
      // masquerade as featureless-distance-resetting junctions.
      node.kind = realizedJunction
        ? 'supplementConnectorJunction'
        : 'supplementConnectorModule';
      node.nodeRole = realizedJunction
        ? 'route-network-connector-junction'
        : 'route-network-connector-module';
      node.layoutRole = realizedJunction
        ? 'meaningful-route-network-junction'
        : 'connector-owned-route-network-traversal';
      node.realizedConnectorKind = realizedJunction ? 'junction' : 'module';
      node.contentRole = realizedJunction ? 'junction' : 'connector';
      node.isSupplementConnectorJunction = realizedJunction;
      node.isSupplementConnectorModule = !realizedJunction;
      node.countsAsMeaningfulStation = realizedJunction;
      node.junctionKind = realizedJunction ? junctionCandidateKind : null;
      if (!realizedJunction && activeSockets.length === 2) {
        node.connectorModuleTraversal = {
          socketIds: activeSockets.map(({ id }) => id),
          distanceMeters: dungeonPointDistance(
            activeSockets[0].position,
            activeSockets[1].position,
          ),
          countsAsFeaturelessDistance: true,
        };
      }
    } else {
      node.kind = 'supplementRoom';
      node.nodeRole = 'route-network-room';
      node.layoutRole = 'substantive-route-network-room';
      node.isSupplementConnectorJunction = false;
      node.isSupplementConnectorModule = false;
      // Challenge, reward, mechanism, and elevation rooms are substantive
      // stations even when they have only a through pair. Their junction record
      // is retained only if the room also realizes a physical decision point.
      node.countsAsMeaningfulStation = true;
      node.junctionKind = realizedJunction ? junctionCandidateKind : null;
      if (!realizedJunction) delete node.junction;
    }
  }
  const authoredFeaturelessSpans = (grant.coverage?.featurelessSpansMeters ?? []).map(
    (distanceMeters, index) => ({
      id: `${operationId}:featureless-span:${index}`,
      logicalEdgeId: grant.coverage.logicalEdgeId,
      ordinal: index,
      distanceMeters: Number(distanceMeters),
      spanKind: 'authored-route-coverage',
      boundedByMeaningfulStations: true,
    }),
  );
  const physicalFeaturelessSpans = segments.map((segment, index) => {
    const verticalTransition = segment.verticalTransfer === true;
    const horizontalApproachMeters = segmentFeaturelessDistanceMeters(segment);
    return {
      id: `${operationId}:physical-featureless-span:${index}`,
      segmentId: segment.id,
      ordinal: authoredFeaturelessSpans.length + index,
      // A real ladder/lift/slope transfer is itself a meaningful station under
      // the V4 contract. Preserve its complete route separately while measuring
      // only the featureless horizontal approach on either side of that reset.
      ...(verticalTransition
        ? {
          transitionPath: cloneDungeonAugmentationValue(segment.path),
          meaningfulTransition: true,
        }
        : { path: cloneDungeonAugmentationValue(segment.path) }),
      distanceMeters: horizontalApproachMeters,
      spanKind: verticalTransition
        ? 'supplement-horizontal-approach-to-elevation-transition'
        : 'supplement-physical-route',
      boundedByMeaningfulStations: true,
    };
  });
  const overlongPhysicalSpan = physicalFeaturelessSpans.find(({ distanceMeters }) => (
    distanceMeters > maximumFeaturelessSpanMeters + 1e-6
  ));
  if (overlongPhysicalSpan) {
    return {
      error: 'route-network-physical-featureless-span-exceeded',
      context: {
        grantId: grant.id,
        segmentId: overlongPhysicalSpan.segmentId,
        routeRole: segments.find(({ id }) => id === overlongPhysicalSpan.segmentId)?.routeRole ?? null,
        path: overlongPhysicalSpan.path ?? overlongPhysicalSpan.transitionPath,
        distanceMeters: overlongPhysicalSpan.distanceMeters,
        maximumFeaturelessSpanMeters,
      },
    };
  }
  const featurelessSpans = [...authoredFeaturelessSpans, ...physicalFeaturelessSpans];
  const activeJunctionKinds = [...new Set(nodes
    .filter(({ graphDegree, junction }) => (
      Number(graphDegree) >= 3 && junction?.countsAsMeaningfulStation === true
    ))
    .map(({ junction }) => junction.junctionKind)
    .filter(Boolean))];
  const connectorModuleNodeIds = nodes
    .filter(({ kind }) => kind === 'supplementConnectorModule')
    .map(({ id }) => id);
  const connectorJunctionNodeIds = nodes
    .filter(({ kind }) => kind === 'supplementConnectorJunction')
    .map(({ id }) => id);
  const connectorInfrastructureNodeIds = nodes
    .filter(({ connectorOwned }) => connectorOwned === true)
    .map(({ id }) => id);
  const roomNodeIds = nodes
    .filter(({ kind }) => kind === 'supplementRoom')
    .map(({ id }) => id);
  const operation = {
    schema: DUNGEON_AUGMENTATION_OPERATION_SCHEMA,
    id: operationId,
    type: 'routeNetwork',
    parentRegionId: region.id,
    themeBinding: cloneDungeonAugmentationValue(region.themeBinding),
    grantId: grant.id,
    routeNetworkKind: grant.kind,
    endpointSocketIds: endpoints.map(({ id }) => id),
    progressionBandId: grant.progressionBandId,
    accessDomainId: grant.accessDomainId,
    crossedBoundaryIds: cloneDungeonAugmentationValue(grant.crossedBoundaryIds),
    requiredCredentialIds: cloneDungeonAugmentationValue(grant.requiredCredentialIds),
    sourceGate: cloneDungeonAugmentationValue(grant.sourceGate),
    topologyTemplateId,
    junctionKinds: activeJunctionKinds,
    elevationModes: [elevationMode],
    contentRoles: nodes.map(({ contentRole }) => String(contentRole ?? '')),
    localProgressionArc: cloneDungeonAugmentationValue(
      profile.routeNetworkPlanning.localProgressionArc,
    ),
    stableRuntimeStateIds,
    runtimeStateIds: Object.values(stableRuntimeStateIds),
    featurelessSpans,
    maximumFeaturelessSpanMeters,
    cycleRankDelta: grant.kind === 'landmark-perimeter-loop'
      ? Number(grant.source?.requiredCycleRankDelta ?? 1)
      : Math.max(1, endpoints.length - 1 + segments.filter(({ routeRole }) => (
        String(routeRole).includes('return')
          || String(routeRole).includes('arm')
          || String(routeRole).includes('upper')
      )).length),
    nodeIds: nodes.map(({ id }) => id),
    roomNodeIds,
    connectorModuleNodeIds,
    connectorJunctionNodeIds,
    connectorInfrastructureNodeIds,
    // V4 budgets substantive gameplay modules separately from compact
    // connector-owned infrastructure. `moduleCount` retains the public budget
    // meaning; `physicalNodeCount` exposes the complete assembled graph.
    moduleCount: roomNodeIds.length + connectorJunctionNodeIds.length,
    substantiveModuleCount: roomNodeIds.length + connectorJunctionNodeIds.length,
    physicalNodeCount: nodes.length,
    roomCount: roomNodeIds.length,
    connectorModuleCount: connectorModuleNodeIds.length,
    connectorJunctionCount: connectorJunctionNodeIds.length,
    connectorInfrastructureCount: connectorInfrastructureNodeIds.length,
    segmentIds: segments.map(({ id }) => id),
    bidirectional: true,
    returnRouteGuaranteed: true,
    protectedVolumes: cloneDungeonAugmentationValue(grant.protectedVolumes),
    socketLandingOverlapGrants: cloneDungeonAugmentationValue(
      grant.socketLandingOverlapGrants,
    ),
    socketModuleOverlapGrants: cloneDungeonAugmentationValue(
      grant.socketModuleOverlapGrants,
    ),
    mustPreserveBeatIds: cloneDungeonAugmentationValue(grant.mustPreserveBeatIds),
    ...(grant.kind === 'landmark-perimeter-loop' ? {
      landmarkRoomId: String(grant.source.landmarkRoomId ?? 'keycardRoom'),
      occupiedCriticalWallSides: cloneDungeonAugmentationValue(
        grant.source.occupiedCriticalWallSides ?? [],
      ),
      openedWallSides: cloneDungeonAugmentationValue(grant.source.openedWallSides ?? []),
      dominanceRegionId: String(grant.source.dominanceRegionId ?? ''),
    } : {}),
    ...(grant.coverage ? { coverage: cloneDungeonAugmentationValue(grant.coverage) } : {}),
  };
  return { operation, nodes, segments };
}

function planRouteNetworkAttempt({
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
  const random = new DungeonAugmentationRandom(augmentationSeed).fork(`attempt:${attempt}:v4`);
  const grants = eligibleRegions.flatMap((region) => (
    (region.routeNetworkGrants ?? []).map((rawGrant, grantOrdinal) => ({
      region,
      grant: normalizeRouteNetworkGrant(rawGrant, region),
      grantOrdinal,
    }))
  )).sort((first, second) => {
    const planningPhase = ({ grant }) => {
      if (grant.kind === 'landmark-perimeter-loop') return 0;
      if (grant.required && grant.kind === 'objective-route-coverage') return 1;
      if (grant.kind !== 'cross-band-shortcut') return 2;
      return 3;
    };
    return planningPhase(first) - planningPhase(second)
      || first.region.id.localeCompare(second.region.id)
      || first.grantOrdinal - second.grantOrdinal;
  });
  const stagingReservationsByGrantId = new Map(grants.map(({ grant }) => {
    // The landmark loop is always planned first. Later operations avoid its
    // exact accepted geometry, so synthetic future envelopes around the
    // pyramid apertures would only create false cross-tier conflicts.
    if (grant.kind === 'landmark-perimeter-loop') return [grant.id, []];
    const sourceRectangles = grant.source?.planningReservationRectangles ?? [];
    const reservations = grant.endpointSockets.flatMap((socket, endpointOrdinal) => {
      const rectangle = sourceRectangles[endpointOrdinal] ?? null;
      const facing = toDungeonFacing(socket.facing);
      const fallbackCenter = addDungeonPoints(
        socket.position,
        scaleDungeonPoint(facing, 15.4),
      );
      const envelopeCenter = rectangle?.center
        ? toDungeonPoint({ ...rectangle.center, y: socket.position.y })
        : fallbackCenter;
      const envelopeSizeX = rectangle
        ? Number(rectangle.maxX) - Number(rectangle.minX)
        : 19.6;
      const envelopeSizeZ = rectangle
        ? Number(rectangle.maxZ) - Number(rectangle.minZ)
        : 19.6;
      const approachEnd = addDungeonPoints(
        socket.position,
        scaleDungeonPoint(facing, 5.6),
      );
      const approachRunsAlongX = Math.abs(facing.x) > Math.abs(facing.z);
      return [
        {
          id: `${grant.id}:staging:${endpointOrdinal}:endpoint-envelope`,
          ownerId: grant.id,
          center: {
            x: envelopeCenter.x,
            y: Number(socket.position.y),
            z: envelopeCenter.z,
          },
          size: {
            x: envelopeSizeX,
            y: 2048,
            z: envelopeSizeZ,
          },
          purpose: 'future-route-network-endpoint-envelope-reservation',
        },
        {
          id: `${grant.id}:staging:${endpointOrdinal}:flat-approach`,
          ownerId: grant.id,
          center: {
            x: (Number(socket.position.x) + Number(approachEnd.x)) * 0.5,
            y: Number(socket.position.y),
            z: (Number(socket.position.z) + Number(approachEnd.z)) * 0.5,
          },
          size: {
            x: approachRunsAlongX ? 5.6 : 8.4,
            y: 2048,
            z: approachRunsAlongX ? 8.4 : 5.6,
          },
          purpose: 'future-route-network-flat-approach-reservation',
        },
      ];
    });
    return [grant.id, reservations];
  }));
  const settings = profile.routeNetworkPlanning;
  const requiredPyramidCount = grants.filter(({ grant }) => (
    grant.required && grant.kind === 'landmark-perimeter-loop'
  )).length;
  if (requiredPyramidCount !== settings.requiredPyramidLoopCount) {
    return {
      error: 'required-pyramid-loop-grant-count-mismatch',
      context: { expected: settings.requiredPyramidLoopCount, actual: requiredPyramidCount },
    };
  }
  if (grants.length === 0) {
    return { error: 'v4-route-network-grants-incomplete' };
  }
  const requiredNetworkCount = grants.filter(({ grant }) => grant.required).length;
  if (requiredNetworkCount > settings.maximumNetworkCount) {
    return {
      error: 'route-network-count-budget-exceeded',
      context: { count: requiredNetworkCount, maximum: settings.maximumNetworkCount },
    };
  }
  const minimumModuleCounts = grants.map(({ grant }) => {
    const endpointFacingReversalCount = (grant.endpointSockets ?? [])
      .slice(1)
      .filter((socket, index) => {
        const previous = grant.endpointSockets[index];
        return Number(previous?.facing?.x ?? 0) * Number(socket?.facing?.x ?? 0)
          + Number(previous?.facing?.z ?? 0) * Number(socket?.facing?.z ?? 0) < -0.5;
      }).length;
    return Math.max(
      grant.minimumModules,
      // Three substantive roles plus the connector-owned decision module make
      // the compact landmark loop complete in four modules. Five remains an
      // admissible search alternative, but is no longer forced into tight
      // authored pyramid geometry.
      grant.kind === 'landmark-perimeter-loop'
        ? 4
        : grant.kind === 'objective-route-coverage'
          // Exact corridor stations are connector-owned infrastructure unless
          // the committed graph gives them three real segment arms. Budget
          // the brief's substantive 3-6 modules, not the number of host
          // sockets; realized junctions are counted after physical routing.
          ? Number(grant.minimumModules)
        // One active junction plus one substantive room per exact coverage
        // interval gives every station-side change a physical reset/turning
        // opportunity. A three-station route therefore needs four substantive
        // modules; trying to bridge both outside faces with only challenge +
        // payoff creates an unavoidable >33.6 m span across the parent route.
          : Math.min(
            6,
            Number(grant.endpointSockets?.length ?? 2)
              + 1
              + endpointFacingReversalCount,
          ),
    );
  });
  const endpointModuleBudgetViolationIndex = grants.findIndex(({ grant }, index) => {
    if (!grant.required) return false;
    const maximumModules = Math.min(
      Number(grant.maximumModules),
      Number(settings.maximumModulesPerNetwork),
    );
    return minimumModuleCounts[index] > maximumModules;
  });
  if (endpointModuleBudgetViolationIndex >= 0) {
    const { grant } = grants[endpointModuleBudgetViolationIndex];
    const requiredModuleCount = minimumModuleCounts[endpointModuleBudgetViolationIndex];
    return {
      error: 'route-network-endpoint-room-module-budget-exceeded',
      context: {
        grantId: grant.id,
        endpointCount: Number(grant.endpointSockets?.length ?? 0),
        requiredRoomCount: requiredModuleCount,
        requiredModuleCount,
        maximumModuleCount: Math.min(
          Number(grant.maximumModules),
          Number(settings.maximumModulesPerNetwork),
        ),
      },
    };
  }
  const minimumRequiredTotalModules = minimumModuleCounts.reduce((sum, count, index) => (
    sum + (grants[index].grant.required ? count : 0)
  ), 0);
  if (minimumRequiredTotalModules > settings.maximumTotalModules) {
    return {
      error: 'route-network-module-budget-exceeded',
      context: {
        minimumTotalModules: minimumRequiredTotalModules,
        maximum: settings.maximumTotalModules,
      },
    };
  }
  const allocatedModuleCounts = [...minimumModuleCounts];
  // Parent-route length determines how many exact coverage stations the host
  // grants; it must not independently inflate the supplemental room count.
  // Starting every network at its complete semantic minimum leaves the
  // bounded solver free to add a module only when a topology candidate truly
  // needs one, rather than packing six large rooms around two nearby stations.
  const topologyBag = random.fork('topology-bag').shuffle(settings.topologyTemplates);
  const junctionBag = random.fork('junction-bag').shuffle(settings.junctionKinds);
  const elevationBag = random.fork('elevation-bag').shuffle(settings.elevationModes);
  if (topologyBag.length < 3 || junctionBag.length < 2 || elevationBag.length < 3) {
    return { error: 'route-network-variety-catalog-incomplete' };
  }
  const projectPriorSupplementVolume = (volume) => ({
    ...volume,
    center: { ...volume.center, y: 0 },
    size: { ...volume.size, y: 2048 },
    purpose: `${volume.purpose ?? 'supplement'}:cross-network-xz-reservation`,
  });
  const requiredMinimumModulesFrom = Array(grants.length + 1).fill(0);
  const requiredNetworkCountFrom = Array(grants.length + 1).fill(0);
  for (let index = grants.length - 1; index >= 0; index -= 1) {
    const required = grants[index].grant.required;
    requiredMinimumModulesFrom[index] = requiredMinimumModulesFrom[index + 1]
      + (required ? minimumModuleCounts[index] : 0);
    requiredNetworkCountFrom[index] = requiredNetworkCountFrom[index + 1]
      + (required ? 1 : 0);
  }
  const sameBandElevationBag = elevationBag.filter((mode) => (
    !['shortcut-lift', 'drop-ladder'].includes(mode)
  ));
  const requiredElevationModeCount = Number(
    profile?.requiredVariety?.elevationModeCount ?? 3,
  );
  const rotateBag = (bag, offset) => {
    if (bag.length === 0) return [];
    const normalizedOffset = ((offset % bag.length) + bag.length) % bag.length;
    return [...bag.slice(normalizedOffset), ...bag.slice(0, normalizedOffset)];
  };
  const orderedModuleCounts = (operationOrdinal, maximumModules) => {
    const minimumModules = minimumModuleCounts[operationOrdinal];
    if (grants[operationOrdinal]?.grant?.kind === 'objective-route-coverage') {
      // Coverage is bounded by featureless travel, not by its number of host
      // sockets.  Two distant stations can require one or two additional
      // authored traversal modules after their mandatory junction, challenge,
      // and payoff have been allocated.  Keeping coverage pinned to its
      // semantic minimum made the global solver retry the same impossible
      // four-module chain in every elevation family.  Enumerate the complete
      // legal 3-6 range so a real station can be inserted wherever the final
      // physical graph would otherwise exceed 33.6 m.
      const physicalMinimumModules = Math.max(
        minimumModules,
        Number(grants[operationOrdinal].grant.endpointSockets?.length ?? 0) + 2,
      );
      return Array.from(
        { length: Math.max(0, maximumModules - physicalMinimumModules + 1) },
        (_, index) => physicalMinimumModules + index,
      );
    }
    const preferredModules = clampInteger(
      allocatedModuleCounts[operationOrdinal],
      minimumModules,
      maximumModules,
    );
    const counts = [preferredModules];
    for (let delta = 1; counts.length < maximumModules - minimumModules + 1; delta += 1) {
      const lower = preferredModules - delta;
      const higher = preferredModules + delta;
      if (lower >= minimumModules) counts.push(lower);
      if (higher <= maximumModules) counts.push(higher);
    }
    return counts;
  };
  const maximumCandidateEvaluations = Math.max(
    96,
    // A candidate that succeeds physically still has to reserve geometry for
    // every later mandatory network. Eight evaluations per grant leaves no
    // room to backtrack an earlier dense connector after discovering a late
    // boss-side conflict. Preserve a finite global bound, but budget three
    // additional deterministic alternatives per required network.
    Math.min(128, requiredNetworkCount * 20 + (grants.length - requiredNetworkCount)),
  );
  const reservedCandidateEvaluationsPerFutureRequiredNetwork = 8;
  let candidateEvaluations = 0;
  let searchBudgetExhausted = false;
  let deepestRequiredFailure = null;
  const recordRequiredFailure = (failure, operationOrdinal, candidateOrdinal = null) => {
    if (!failure?.error) return;
    if (deepestRequiredFailure && deepestRequiredFailure.operationOrdinal > operationOrdinal) return;
    if (deepestRequiredFailure
      && deepestRequiredFailure.operationOrdinal === operationOrdinal
      && Number(deepestRequiredFailure.candidateOrdinal ?? -1)
        > Number(candidateOrdinal ?? -1)) return;
    deepestRequiredFailure = {
      ...failure,
      operationOrdinal,
      candidateOrdinal,
      grantId: grants[operationOrdinal]?.grant?.id ?? null,
    };
  };
  const solveRouteNetworks = (operationOrdinal, state) => {
    if (operationOrdinal >= grants.length) {
      const realizedElevationModes = new Set(state.elevationModes ?? []);
      if (realizedElevationModes.size < requiredElevationModeCount) {
        recordRequiredFailure({
          error: 'route-network-elevation-variety-unavailable',
          context: {
            actual: realizedElevationModes.size,
            required: requiredElevationModeCount,
            elevationModes: [...realizedElevationModes].sort(),
          },
        }, grants.length);
        return null;
      }
      return state;
    }
    const { region, grant } = grants[operationOrdinal];
    const futureRequiredMinimum = requiredMinimumModulesFrom[operationOrdinal + 1];
    const futureRequiredNetworkCount = requiredNetworkCountFrom[operationOrdinal + 1];
    const minimumModules = minimumModuleCounts[operationOrdinal];
    const hasNetworkCapacity = state.acceptedNetworkCount
      + 1
      + futureRequiredNetworkCount <= settings.maximumNetworkCount;
    const maximumModules = Math.min(
      Number(grant.maximumModules),
      Number(settings.maximumModulesPerNetwork),
      state.remainingModules - futureRequiredMinimum,
    );
    if (!hasNetworkCapacity || maximumModules < minimumModules) {
      if (!grant.required) return solveRouteNetworks(operationOrdinal + 1, state);
      recordRequiredFailure({
        error: !hasNetworkCapacity
          ? 'route-network-count-budget-exceeded'
          : 'route-network-module-allocation-failed',
        context: {
          grantId: grant.id,
          remainingModules: state.remainingModules,
          futureRequiredMinimum,
          minimumModules,
          maximumModules,
        },
      }, operationOrdinal);
      return null;
    }
    const futureRequiredStagingReservations = grants
      .slice(operationOrdinal + 1)
      .filter(({ grant: futureGrant }) => futureGrant.required)
      .flatMap(({ grant: futureGrant }) => (
        stagingReservationsByGrantId.get(futureGrant.id) ?? []
      ));
    const planningAvoidanceVolumes = [
      ...(region.routeNetworkPlacementProtectedVolumes
        ?? region.protectedVolumes
        ?? []),
      ...(grant.protectedVolumes ?? []),
      ...futureRequiredStagingReservations,
      ...state.nodes.flatMap((node) => [
        ...(node.occupiedVolumes ?? []).map(projectPriorSupplementVolume),
        ...(node.clearanceVolumes ?? []).map(projectPriorSupplementVolume),
      ]),
      ...state.segments.flatMap((segment) => [
        ...(segment.occupiedVolumes ?? []).map(projectPriorSupplementVolume),
        ...(segment.clearanceVolumes ?? []).map(projectPriorSupplementVolume),
        ...(segment.landingVolumes ?? []).map(projectPriorSupplementVolume),
      ]),
    ];
    const moduleCounts = orderedModuleCounts(operationOrdinal, maximumModules);
    const rotatedSameBandElevationModes = rotateBag(
      sameBandElevationBag,
      operationOrdinal,
    );
    const previouslyUsedElevationModes = new Set(state.elevationModes ?? []);
    // Exhaust the elevation-family bag globally, not independently per
    // network.  A complete solve is allowed to reuse a family only after every
    // still-legal family has had a deterministic opportunity.  This makes the
    // required per-seed variety a solver invariant instead of a late validator
    // rejection.
    const splitLevelMode = grant.kind === 'objective-route-coverage'
      && rotatedSameBandElevationModes.includes('split-level-platform')
      ? ['split-level-platform']
      : [];
    const remainingSameBandElevationModes = rotatedSameBandElevationModes.filter((mode) => (
      mode !== 'split-level-platform' || splitLevelMode.length === 0
    ));
    const sameBandElevationModes = [
      // Keep the collision-dense authored coverage baseline first. The global
      // completion gate below still backtracks into unused families when the
      // seed would otherwise miss its elevation variety contract.
      ...splitLevelMode,
      ...remainingSameBandElevationModes.filter((mode) => (
        !previouslyUsedElevationModes.has(mode)
      )),
      ...remainingSameBandElevationModes.filter((mode) => (
        previouslyUsedElevationModes.has(mode)
      )),
    ];
    const legalElevationModes = grant.kind === 'landmark-perimeter-loop'
      ? ['split-level-platform']
      : grant.kind === 'cross-band-shortcut'
        ? rotateBag(['shortcut-lift', 'drop-ladder'], operationOrdinal % 2)
        : sameBandElevationModes;
    const missingElevationModeCount = Math.max(
      0,
      requiredElevationModeCount - previouslyUsedElevationModes.size,
    );
    const mustConsumeUnusedElevationMode = grant.required
      && missingElevationModeCount > futureRequiredNetworkCount;
    // Do not defer the variety contract to an end-of-search rejection. When
    // the current mandatory network is one of the last remaining chances to
    // reach the quota, its candidate bag contains only still-unused legal
    // families. This preserves deterministic exhaustion while avoiding a
    // full-layout backtrack merely to replace the final repeated mode.
    const elevationModes = mustConsumeUnusedElevationMode
      ? legalElevationModes.filter((mode) => !previouslyUsedElevationModes.has(mode))
      : legalElevationModes;
    if (elevationModes.length === 0) {
      if (!grant.required) return solveRouteNetworks(operationOrdinal + 1, state);
      recordRequiredFailure({
        error: 'route-network-elevation-variety-unavailable',
        context: {
          grantId: grant.id,
          actual: previouslyUsedElevationModes.size,
          required: requiredElevationModeCount,
          futureRequiredNetworkCount,
          legalElevationModes,
        },
      }, operationOrdinal);
      return null;
    }
    const denseMultiStationCoverage = grant.kind === 'objective-route-coverage'
      && Number(grant.endpointSockets?.length ?? 0) >= 3;
    const candidateSignatures = [];
    const addCandidateSignature = (
      moduleCount,
      elevationMode,
      placementVariant = null,
    ) => {
      if (candidateSignatures.some((signature) => (
        signature.moduleCount === moduleCount
          && signature.elevationMode === elevationMode
          && signature.placementVariant === placementVariant
      ))) return;
      candidateSignatures.push({ moduleCount, elevationMode, placementVariant });
    };
    if (denseMultiStationCoverage) {
      // A selected exterior path is one coherent placement domain: its rooms
      // may not be shifted independently without invalidating the socket-bound
      // corridors. Try several complete, length-ordered level-path states
      // before advancing to external elevation families.
      const internalMode = elevationModes.includes('split-level-platform')
        ? 'split-level-platform'
        : elevationModes[0];
      for (let placementVariant = 0; placementVariant < 4; placementVariant += 1) {
        for (const moduleCount of moduleCounts) {
          addCandidateSignature(moduleCount, internalMode, placementVariant);
        }
      }
      for (const elevationMode of elevationModes) {
        if (elevationMode === internalMode) continue;
        for (const moduleCount of moduleCounts) {
          addCandidateSignature(moduleCount, elevationMode, 0);
        }
      }
    } else {
      // Preserve the original deterministic diagonal first, then enumerate
      // the remaining Cartesian pairs without repeating a complete signature.
      // The former count/mode zip repeated after one diagonal and could never
      // try a viable mode at another legal module count.
      const primaryModuleCounts = moduleCounts.slice(0, 2);
      for (let offset = 0; offset < elevationModes.length; offset += 1) {
        for (let countIndex = 0; countIndex < primaryModuleCounts.length; countIndex += 1) {
          addCandidateSignature(
            primaryModuleCounts[countIndex],
            elevationModes[(countIndex + offset) % elevationModes.length],
          );
        }
      }
      for (const moduleCount of moduleCounts.slice(primaryModuleCounts.length)) {
        for (const elevationMode of elevationModes) {
          addCandidateSignature(moduleCount, elevationMode);
        }
      }
    }
    const candidateLimit = grant.required
      ? grant.kind === 'landmark-perimeter-loop'
        ? 8
        : Math.min(denseMultiStationCoverage ? 8 : 12, candidateSignatures.length)
      : Math.min(1, candidateSignatures.length);
    let attemptedCandidate = false;
    for (let candidateOrdinal = 0; candidateOrdinal < candidateLimit; candidateOrdinal += 1) {
      const futureCandidateEvaluationReserve = futureRequiredNetworkCount
        * reservedCandidateEvaluationsPerFutureRequiredNetwork;
      if (candidateEvaluations
        >= maximumCandidateEvaluations - futureCandidateEvaluationReserve) {
        searchBudgetExhausted = true;
        break;
      }
      attemptedCandidate = true;
      candidateEvaluations += 1;
      const candidateSignature = grant.kind === 'landmark-perimeter-loop'
        ? {
          moduleCount: moduleCounts[candidateOrdinal % moduleCounts.length],
          elevationMode: elevationModes[candidateOrdinal % elevationModes.length],
        }
        : candidateSignatures[candidateOrdinal];
      const { moduleCount, elevationMode } = candidateSignature;
      const candidateJunctionBag = rotateBag(junctionBag, candidateOrdinal);
      const candidateRandom = candidateOrdinal === 0
        ? random.fork(`network:${grant.id}`)
        : random.fork(`network:${grant.id}:global-solver:${candidateOrdinal}`);
      const planned = planRouteNetwork({
        region,
        grant,
        operationOrdinal,
        moduleCount,
        topologyTemplateId: topologyBag[
          (operationOrdinal + candidateOrdinal) % topologyBag.length
        ],
        junctionBag: candidateJunctionBag,
        elevationMode,
        random: candidateRandom,
        profile,
        grammars,
        progressionOrderStart: state.progressionOrder,
        planningAvoidanceVolumes,
        moduleCapacity: maximumModules,
        searchVariant: candidateSignature.placementVariant ?? candidateOrdinal,
      });
      if (planned.error) {
        if (grant.required) {
          recordRequiredFailure({
            ...planned,
            context: {
              ...(planned.context ?? {}),
              requestedSubstantiveModuleCount: moduleCount,
            },
          }, operationOrdinal, candidateOrdinal);
        }
        continue;
      }
      const substantiveModuleCount = Number(
        planned.operation?.substantiveModuleCount
          ?? planned.nodes.filter(({ kind }) => kind !== 'supplementConnectorModule').length,
      );
      if (!Number.isFinite(substantiveModuleCount)
        || substantiveModuleCount < minimumModules
        || substantiveModuleCount > maximumModules
        || state.remainingModules - substantiveModuleCount < futureRequiredMinimum) {
        if (grant.required) {
          recordRequiredFailure({
            error: 'route-network-module-allocation-failed',
            context: {
              grantId: grant.id,
              substantiveModuleCount,
              minimumModules,
              maximumModules,
              remainingModules: state.remainingModules,
              futureRequiredMinimum,
            },
          }, operationOrdinal, candidateOrdinal);
        }
        continue;
      }
      const solved = solveRouteNetworks(operationOrdinal + 1, {
        operations: [...state.operations, planned.operation],
        nodes: [...state.nodes, ...planned.nodes],
        segments: [...state.segments, ...planned.segments],
        progressionOrder: state.progressionOrder + planned.nodes.length,
        remainingModules: state.remainingModules - substantiveModuleCount,
        acceptedNetworkCount: state.acceptedNetworkCount + 1,
        elevationModes: [...new Set([
          ...(state.elevationModes ?? []),
          ...(planned.operation?.elevationModes ?? [elevationMode]),
        ])],
      });
      if (solved) return solved;
    }
    if (!grant.required) return solveRouteNetworks(operationOrdinal + 1, state);
    if (!attemptedCandidate) {
      recordRequiredFailure({
        error: 'route-network-global-search-budget-exhausted',
        context: { grantId: grant.id },
      }, operationOrdinal);
    }
    return null;
  };
  const solvedRouteNetworks = solveRouteNetworks(0, {
    operations: [],
    nodes: [],
    segments: [],
    progressionOrder: 0,
    remainingModules: settings.maximumTotalModules,
    acceptedNetworkCount: 0,
    elevationModes: [],
  });
  if (!solvedRouteNetworks) {
    const failure = deepestRequiredFailure ?? {
      error: 'route-network-global-search-exhausted',
      context: {},
    };
    return {
      error: failure.error,
      context: {
        ...(failure.context ?? {}),
        routeNetworkSolver: {
          candidateEvaluations,
          maximumCandidateEvaluations,
          searchBudgetExhausted,
          deepestOperationOrdinal: failure.operationOrdinal ?? null,
          deepestGrantId: failure.grantId ?? null,
          candidateOrdinal: failure.candidateOrdinal ?? null,
        },
      },
    };
  }
  const {
    operations,
    nodes,
    segments,
  } = solvedRouteNetworks;
  const serializableNodes = nodes.map(finalizeNode);
  const plan = {
    schema: DUNGEON_AUGMENTATION_OVERLAY_V2_SCHEMA,
    revision: DUNGEON_AUGMENTATION_V2_SCHEMA_REVISION,
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
    transitionBays: [],
    progressionAssignments: [],
    progressionSnapshots: eligibleRegions.map((region) => ({
      parentRegionId: region.id,
      snapshot: cloneDungeonAugmentationValue(region.progressionSnapshot),
    })),
    routeNetworkGrantIds: operations.map(({ grantId }) => grantId),
    featurelessCoverage: operations
      .filter(({ coverage }) => Boolean(coverage))
      .map(({ id, coverage }) => ({ operationId: id, ...cloneDungeonAugmentationValue(coverage) })),
    varietySignature: {
      topologyTemplateIds: operations.map(({ topologyTemplateId }) => topologyTemplateId),
      junctionKinds: [...new Set(operations.flatMap(({ junctionKinds }) => junctionKinds))],
      elevationModes: operations.flatMap(({ elevationModes }) => elevationModes),
      contentRoleSequences: operations.map(({ contentRoles }) => [...contentRoles]),
      graphDegrees: serializableNodes.map((node) => Number(
        node.graphDegree
          ?? node.junction?.graphDegree
          ?? (node.sockets ?? []).filter(({ state, segmentId }) => (
            state === 'connected' && segmentId
          )).length,
      )),
    },
    themeBindings: collectThemeBindings(serializableNodes, []),
  };
  plan.augmentationPlanHash = computeDungeonAugmentationPlanHash(plan);
  plan.effectivePlanHash = computeEffectiveDungeonPlanHash(basePlanHash, plan.augmentationPlanHash);
  return { plan };
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
  if (profile.routeNetworkPlanning?.enabled === true) {
    return planRouteNetworkAttempt({
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
  }
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
    let candidatePlan = planned.plan;
    let validation = validateDungeonAugmentationPlan(candidatePlan, {
      baseDraft: safeBaseDraft,
      extensionRegions: eligibleRegions,
      profiles,
      grammars,
      themeCapabilitiesByRegionId,
    });
    if (!validation.accepted) {
      const originalErrorCodes = validation.errors.map(({ code }) => code);
      const fallbackPlan = omitOptionalEdgePadding(candidatePlan, profile);
      if (fallbackPlan) {
        const fallbackValidation = validateDungeonAugmentationPlan(fallbackPlan, {
          baseDraft: safeBaseDraft,
          extensionRegions: eligibleRegions,
          profiles,
          grammars,
          themeCapabilitiesByRegionId,
        });
        if (fallbackValidation.accepted) {
          candidatePlan = fallbackPlan;
          validation = fallbackValidation;
          decisions.at(-1).context = {
            optionalEdgePaddingOmitted: true,
            originalErrorCodes,
          };
        }
      }
    }
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
    const overlayPlan = deepFreezeDungeonAugmentationValue(candidatePlan);
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
