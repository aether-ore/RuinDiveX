function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pointOf(value = {}) {
  const point = value?.position ?? value?.center ?? value;
  return {
    x: number(point?.x),
    y: number(point?.y ?? point?.elevation),
    z: number(point?.z),
  };
}

function gridPoint(value, tileSize) {
  const point = pointOf(value);
  return {
    x: Math.round(point.x / tileSize),
    z: Math.round(point.z / tileSize),
  };
}

function sameGridPoint(first, second) {
  return first?.x === second?.x && first?.z === second?.z;
}

function appendGridPoint(points, point) {
  if (!sameGridPoint(points.at(-1), point)) points.push(point);
}

function appendManhattanSpan(points, destination, horizontalFirst = true) {
  const source = points.at(-1);
  if (!source) {
    appendGridPoint(points, destination);
    return;
  }
  if (horizontalFirst) {
    const stepX = Math.sign(destination.x - source.x);
    for (let x = source.x + stepX; stepX && x !== destination.x + stepX; x += stepX) {
      appendGridPoint(points, { x, z: source.z });
    }
    const stepZ = Math.sign(destination.z - source.z);
    for (let z = source.z + stepZ; stepZ && z !== destination.z + stepZ; z += stepZ) {
      appendGridPoint(points, { x: destination.x, z });
    }
  } else {
    const stepZ = Math.sign(destination.z - source.z);
    for (let z = source.z + stepZ; stepZ && z !== destination.z + stepZ; z += stepZ) {
      appendGridPoint(points, { x: source.x, z });
    }
    const stepX = Math.sign(destination.x - source.x);
    for (let x = source.x + stepX; stepX && x !== destination.x + stepX; x += stepX) {
      appendGridPoint(points, { x, z: destination.z });
    }
  }
}

function gridPath(rawPath, tileSize) {
  const raw = (Array.isArray(rawPath) ? rawPath : []).map((point) => gridPoint(point, tileSize));
  const path = [];
  for (const [index, point] of raw.entries()) {
    if (path.length === 0) appendGridPoint(path, point);
    else appendManhattanSpan(path, point, index % 2 === 0);
  }
  return path;
}

function oddTileSpan(meters, tileSize, minimum = 3) {
  // Industrial's rectangular stamper expands around a center tile and thus
  // requires odd spans. Round down so realized geometry never exceeds the
  // volume accepted by the renderer-free overlap validator.
  let span = Math.max(minimum, Math.floor(number(meters, minimum * tileSize) / tileSize));
  if (span % 2 === 0) span -= 1;
  return span;
}

function nodeOperationId(node) {
  return node.operationId ?? node.parentOperationId ?? node.operation?.id ?? null;
}

function segmentOperationId(segment) {
  return segment.operationId ?? segment.parentOperationId ?? segment.operation?.id ?? null;
}

function operationType(operation) {
  return operation.type ?? operation.operationType ?? operation.kind ?? null;
}

function endpointOf(segment, role) {
  if (role === 'from') {
    return segment.from ?? segment.source ?? segment.endpoints?.[0] ?? {};
  }
  return segment.to ?? segment.destination ?? segment.endpoints?.[1] ?? {};
}

function endpointNodeId(endpoint) {
  return endpoint?.nodeId
    ?? endpoint?.roomId
    ?? endpoint?.ownerNodeId
    ?? endpoint?.node?.id
    ?? null;
}

function endpointPosition(segment, role) {
  const endpoint = endpointOf(segment, role);
  return pointOf(endpoint.position ?? endpoint.point ?? endpoint);
}

function cardinalFacingOf(endpoint = {}) {
  const facing = endpoint?.facing ?? endpoint?.worldFacing ?? {};
  const x = Math.sign(number(facing.x ?? endpoint?.facingX));
  const z = Math.sign(number(facing.z ?? endpoint?.facingZ));
  return Math.abs(x) + Math.abs(z) === 1 ? { x, z } : null;
}

function createSupplementRoom(node, tileSize) {
  const center = pointOf(node.placement?.center ?? node.center ?? node.position);
  const size = node.size ?? node.placement?.size ?? {};
  const rotationQuarterTurns = ((Math.trunc(number(node.placement?.rotationQuarterTurns)) % 4) + 4) % 4;
  const swapsHorizontalAxes = rotationQuarterTurns % 2 === 1;
  const unrotatedWidth = size.x ?? size.width ?? size.widthMeters;
  const unrotatedDepth = size.z ?? size.depth ?? size.depthMeters;
  const realizedWidth = swapsHorizontalAxes ? unrotatedDepth : unrotatedWidth;
  const realizedDepth = swapsHorizontalAxes ? unrotatedWidth : unrotatedDepth;
  const anchors = (node.anchors ?? []).map((anchor) => ({
    ...anchor,
    position: pointOf(anchor.position ?? anchor.worldPosition ?? anchor),
  }));
  return {
    id: String(node.id),
    type: 'supplement',
    tileType: 'floor',
    x: Math.round(center.x / tileSize),
    z: Math.round(center.z / tileSize),
    width: oddTileSpan(realizedWidth, tileSize),
    depth: oddTileSpan(realizedDepth, tileSize),
    plannedBaseElevation: center.y,
    baseElevation: center.y,
    ceilingHeight: Math.max(5.6, number(size.y ?? size.height, 5.6)),
    archetype: 'supplement',
    archetypeId: node.grammarId ?? node.moduleId ?? 'dungeon-supplement',
    purpose: node.topology ?? 'optional_exploration',
    mood: 'inherited_parent_region',
    environmentalStory: null,
    exitSockets: [],
    augmentationNodeId: node.id,
    augmentationOperationId: nodeOperationId(node),
    augmentationThemeBinding: node.themeBinding ?? null,
    augmentationAnchors: anchors,
    augmentationStructure: node.structure ?? null,
    augmentationRotationQuarterTurns: rotationQuarterTurns,
    isDungeonSupplement: true,
  };
}

function cloneConnectionPlan(plan) {
  return {
    ...plan,
    fullPath: (plan.fullPath ?? []).map((point) => ({ ...point })),
    bridgePath: (plan.bridgePath ?? []).map((point) => ({ ...point })),
    fromSocket: plan.fromSocket ? { ...plan.fromSocket } : null,
    toSocket: plan.toSocket ? { ...plan.toSocket } : null,
    connectorVariantConstraints: plan.connectorVariantConstraints ? {
      ...plan.connectorVariantConstraints,
      roomFootprints: (plan.connectorVariantConstraints.roomFootprints ?? [])
        .map((footprint) => ({ ...footprint })),
      blockedLanePoints: (plan.connectorVariantConstraints.blockedLanePoints ?? [])
        .map((point) => ({ ...point })),
    } : null,
  };
}

function clonePlainValue(value) {
  if (Array.isArray(value)) return value.map(clonePlainValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clonePlainValue(child)]));
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immutableConnectionPlanSnapshot(plan) {
  return deepFreeze(clonePlainValue(plan));
}

function distanceSquared(first, second) {
  return (first.x - second.x) ** 2 + (first.z - second.z) ** 2;
}

function nearestRoomId(position, rooms, tileSize) {
  const grid = gridPoint(position, tileSize);
  return [...rooms]
    .sort((first, second) => (
      distanceSquared(grid, first) - distanceSquared(grid, second)
      || String(first.id).localeCompare(String(second.id))
    ))[0]?.id ?? null;
}

function endpointRoomId(endpoint, position, rooms, tileSize) {
  const explicitId = endpointNodeId(endpoint);
  if (explicitId && rooms.some((room) => room.id === explicitId)) return explicitId;
  return nearestRoomId(position, rooms, tileSize);
}

function roomBoundaryGridPoint(position, endpoint, room, tileSize) {
  const point = gridPoint(position, tileSize);
  if (!room) return point;
  const halfWidth = Math.floor(number(room.width, 1) / 2);
  const halfDepth = Math.floor(number(room.depth, 1) / 2);
  const minimumX = room.x - halfWidth;
  const maximumX = room.x + halfWidth;
  const minimumZ = room.z - halfDepth;
  const maximumZ = room.z + halfDepth;
  const facing = cardinalFacingOf(endpoint);
  const facingX = facing?.x ?? 0;
  const facingZ = facing?.z ?? 0;

  // Grammar sockets lie on the geometric perimeter, which is commonly a
  // half-grid coordinate. Floating-point rounding can otherwise put the
  // socket one cell outside its room, leaving an apparent floor gap between
  // the room and its connector. Bind the discrete socket to the owning room's
  // boundary cell in its declared outward direction.
  if (Math.abs(facingX) > Math.abs(facingZ)) {
    point.x = facingX > 0 ? maximumX : minimumX;
    point.z = Math.max(minimumZ, Math.min(maximumZ, point.z));
  } else if (facingZ) {
    point.z = facingZ > 0 ? maximumZ : minimumZ;
    point.x = Math.max(minimumX, Math.min(maximumX, point.x));
  } else {
    point.x = Math.max(minimumX, Math.min(maximumX, point.x));
    point.z = Math.max(minimumZ, Math.min(maximumZ, point.z));
  }
  return point;
}

function createSocket({
  id,
  roomId,
  role,
  point,
  outside,
  elevation,
  tileSize,
  fallbackFacing = null,
}) {
  const spanDirectionX = Math.sign(outside.x - point.x);
  const spanDirectionZ = Math.sign(outside.z - point.z);
  const spanIsCardinal = Math.abs(spanDirectionX) + Math.abs(spanDirectionZ) === 1;
  const fallbackDirectionX = Math.sign(number(fallbackFacing?.x));
  const fallbackDirectionZ = Math.sign(number(fallbackFacing?.z));
  const fallbackIsCardinal = Math.abs(fallbackDirectionX) + Math.abs(fallbackDirectionZ) === 1;
  const directionX = spanIsCardinal
    ? spanDirectionX
    : fallbackIsCardinal ? fallbackDirectionX : 0;
  const directionZ = spanIsCardinal
    ? spanDirectionZ
    : fallbackIsCardinal ? fallbackDirectionZ : 0;
  return {
    id,
    roomId,
    role,
    x: point.x,
    z: point.z,
    level: 0,
    elevation,
    facingX: directionX,
    facingZ: directionZ,
    connectorType: 'ground_corridor',
    landingWidth: tileSize * 3,
    clearanceHeight: 3.6,
    floorKey: `${point.x},${point.z}@y${Number(elevation).toFixed(3)}`,
  };
}

function createSupplementConnectionPlan(segment, rooms, tileSize, allFootprints) {
  const fromEndpoint = endpointOf(segment, 'from');
  const toEndpoint = endpointOf(segment, 'to');
  const fromPosition = endpointPosition(segment, 'from');
  const toPosition = endpointPosition(segment, 'to');
  const fromRoomId = endpointRoomId(fromEndpoint, fromPosition, rooms, tileSize);
  const toRoomId = endpointRoomId(toEndpoint, toPosition, rooms, tileSize);
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const fromPoint = roomBoundaryGridPoint(
    fromPosition,
    fromEndpoint,
    roomById.get(fromRoomId),
    tileSize,
  );
  const toPoint = roomBoundaryGridPoint(
    toPosition,
    toEndpoint,
    roomById.get(toRoomId),
    tileSize,
  );
  const fromFacing = cardinalFacingOf(fromEndpoint);
  const toFacing = cardinalFacingOf(toEndpoint);
  const fromApproach = fromFacing
    ? { x: fromPoint.x + fromFacing.x, z: fromPoint.z + fromFacing.z }
    : null;
  const toApproach = toFacing
    ? { x: toPoint.x + toFacing.x, z: toPoint.z + toFacing.z }
    : null;
  const rawPath = gridPath(segment.path ?? segment.polyline ?? [], tileSize);
  const intermediatePath = rawPath.length > 2 ? rawPath.slice(1, -1) : [];
  const path = [fromPoint];
  if (fromApproach) appendGridPoint(path, fromApproach);
  for (const [index, point] of intermediatePath.entries()) {
    if (sameGridPoint(point, fromPoint) || sameGridPoint(point, toPoint)) continue;
    appendManhattanSpan(path, point, index % 2 === 0);
  }
  appendManhattanSpan(path, toApproach ?? toPoint, false);
  appendGridPoint(path, toPoint);
  const elevation = number(fromPosition.y);
  const fromSocket = createSocket({
    id: `${segment.id}:from`,
    roomId: fromRoomId,
    role: 'exit',
    point: path[0],
    outside: path[1] ?? path[0],
    elevation,
    tileSize,
    fallbackFacing: fromEndpoint?.facing,
  });
  const toSocket = createSocket({
    id: `${segment.id}:to`,
    roomId: toRoomId,
    role: 'entrance',
    point: path.at(-1),
    outside: path.at(-2) ?? path.at(-1),
    elevation: number(toPosition.y, elevation),
    tileSize,
    fallbackFacing: toEndpoint?.facing,
  });
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  return {
    id: String(segment.id),
    logicalConnectionId: String(segment.logicalConnectionId ?? segment.logicalEdgeId ?? segment.id),
    fromRoomId,
    toRoomId,
    doorId: null,
    level: 0,
    elevation,
    sourceElevation: elevation,
    destinationElevation: number(toPosition.y, elevation),
    elevationDelta: number(toPosition.y, elevation) - elevation,
    direction: 'level',
    connectorType: 'ground_corridor',
    connectorVariantId: null,
    connectorVariant: null,
    requiredForProgression: false,
    purpose: 'supplement_optional_branch',
    routeClassification: 'optional_branch',
    fullPath: path,
    bridgePath: [...path],
    fromSocket,
    toSocket,
    isDungeonSupplement: true,
    isSharedThresholdConnection: path.length === 1,
    augmentationOperationId: segmentOperationId(segment),
    connectorVariantConstraints: {
      roomFootprints: allFootprints,
      endpointFlatBufferTiles: 2,
      reservedFootprintHalfWidthTiles: 2,
      reservedFootprintColumnCount: path.length * 5,
      footprintRoomCollisionCount: 0,
      footprintConnectorCollisionCount: 0,
      blockedLanePoints: [],
    },
  };
}

function paddingTargetId(operation) {
  return operation.originalLogicalEdge?.id
    ?? operation.originalLogicalEdge?.logicalEdgeId
    ?? operation.originalLogicalEdge?.physicalConnectionId
    ?? operation.spliceEdgeId
    ?? operation.targetEdgeId
    ?? operation.logicalEdgeId
    ?? operation.target?.spliceEdgeId
    ?? operation.target?.edgeId
    ?? operation.input?.spliceEdgeId
    ?? null;
}

function findSpliceEdge(targetId, extensionRegions) {
  const edges = extensionRegions.flatMap((region) => region.spliceEdges ?? []);
  if (targetId) {
    const exact = edges.find((edge) => [edge.id, edge.edgeId, edge.logicalEdgeId]
      .includes(targetId));
    if (exact) return exact;
  }
  return null;
}

function joinMaterializedConnectionPaths(plans, startPosition, endPosition, tileSize) {
  const result = [gridPoint(startPosition, tileSize)];
  for (const plan of plans) {
    const path = (plan.fullPath ?? []).map((point) => ({
      x: number(point.x),
      z: number(point.z),
    }));
    if (path.length === 0) continue;
    if (distanceSquared(result.at(-1), path.at(-1)) < distanceSquared(result.at(-1), path[0])) {
      path.reverse();
    }
    appendManhattanSpan(result, path[0]);
    for (const point of path.slice(1)) appendManhattanSpan(result, point);
  }
  appendManhattanSpan(result, gridPoint(endPosition, tileSize), false);
  return result;
}

function addRoomSocket(roomById, roomId, socket, connectionId, purpose) {
  const room = roomById.get(roomId);
  if (!room) return;
  room.exitSockets ??= [];
  room.exitSockets.push({ ...socket, connectionId, purpose });
}

/**
 * Converts a validated, world-meter overlay into Industrial V1's effective
 * tile/connection arrays. It never edits the renderer-free base snapshot.
 */
export function materializeIndustrialOverlay({
  rooms = [],
  connectionPlans = [],
  overlayPlan,
  extensionRegions = [],
  tileSize = 2.8,
} = {}) {
  if (!overlayPlan) {
    return {
      rooms,
      connectionPlans,
      supplementalRoomIds: [],
      supplementalConnectionIds: [],
      diagnostics: { accepted: false, reason: 'missing-overlay-plan', errors: [] },
    };
  }

  const effectiveRooms = rooms.map((room) => ({
    ...room,
    exitSockets: (room.exitSockets ?? []).map((socket) => ({ ...socket })),
  }));
  const supplementRooms = (overlayPlan.nodes ?? []).map((node) => createSupplementRoom(node, tileSize));
  effectiveRooms.push(...supplementRooms);
  const roomById = new Map(effectiveRooms.map((room) => [room.id, room]));
  const footprints = effectiveRooms.map((room) => ({
    roomId: room.id,
    minX: room.x - Math.floor(room.width / 2),
    maxX: room.x + Math.floor(room.width / 2),
    minZ: room.z - Math.floor(room.depth / 2),
    maxZ: room.z + Math.floor(room.depth / 2),
  }));
  const immutableOriginalPlanById = new Map(connectionPlans.map((plan) => (
    [plan.id, immutableConnectionPlanSnapshot(plan)]
  )));
  const effectiveConnections = connectionPlans.map(cloneConnectionPlan);
  for (const plan of effectiveConnections) {
    if (plan.connectorVariantConstraints) {
      plan.connectorVariantConstraints.roomFootprints = footprints.map((entry) => ({ ...entry }));
    }
  }

  const operations = overlayPlan.operations ?? [];
  const segments = overlayPlan.segments ?? [];
  const paddingOperationIds = new Set(operations
    .filter((operation) => operationType(operation) === 'edgePadding')
    .map((operation) => operation.id));
  const errors = [];
  const materializedPaddingConnectionIds = [];
  const materializedOptionalConnectionIds = [];
  const paddedConnections = [];

  for (const operation of operations.filter((entry) => operationType(entry) === 'edgePadding')) {
    const operationSegments = segments.filter((segment) => (
      segmentOperationId(segment) === operation.id
      || (operation.segmentIds ?? []).includes(segment.id)
    )).sort((first, second) => (
      number(first.physicalOrdinal) - number(second.physicalOrdinal)
      || String(first.id).localeCompare(String(second.id))
    ));
    const spliceEdge = findSpliceEdge(paddingTargetId(operation), extensionRegions)
      ?? extensionRegions.flatMap((region) => region.spliceEdges ?? [])
        .find((edge) => operationSegments.some((segment) => (
          segment.replacesEdgeId === edge.id
          || segment.logicalConnectionId === edge.logicalEdgeId
        )));
    const plan = effectiveConnections.find((candidate) => (
      candidate.id === spliceEdge?.physicalConnectionId
      || candidate.logicalConnectionId === spliceEdge?.logicalEdgeId
      || candidate.logicalConnectionId === spliceEdge?.edgeId
    ));
    if (!spliceEdge || !plan || operationSegments.length === 0) {
      errors.push(`Unable to materialize padded operation ${operation.id}.`);
      continue;
    }
    const physicalPlans = operationSegments.map((segment, physicalOrdinal) => {
      const physicalPlan = createSupplementConnectionPlan(
        segment,
        effectiveRooms,
        tileSize,
        footprints,
      );
      const logicalGateId = operation.originalLogicalEdge?.gateId ?? plan.doorId ?? null;
      return {
        ...physicalPlan,
        logicalConnectionId: String(plan.logicalConnectionId ?? operation.originalLogicalEdge?.id ?? plan.id),
        parentConnectionId: plan.id,
        originalConnectionPlanId: plan.id,
        physicalOrdinal: number(segment.physicalOrdinal, physicalOrdinal),
        doorId: null,
        logicalGateId,
        parentGateId: logicalGateId,
        credentialRequirement: clonePlainValue(operation.originalLogicalEdge?.credentialRequirement ?? null),
        progressionTier: number(operation.originalLogicalEdge?.progressionTier),
        dominanceBoundary: clonePlainValue(operation.originalLogicalEdge?.dominanceBoundary ?? null),
        level: number(plan.level),
        requiredForProgression: Boolean(plan.requiredForProgression),
        purpose: 'supplement_edge_padding',
        routeClassification: plan.routeClassification ?? 'main_route',
        connectorType: plan.connectorType ?? physicalPlan.connectorType,
        connectorVariantId: plan.connectorVariantId ?? null,
        connectorVariant: plan.connectorVariant ? clonePlainValue(plan.connectorVariant) : null,
        isPaddedByDungeonSupplement: true,
        isDungeonSupplement: true,
        // The parent logical plan owns Industrial's combined physical gallery.
        // These records expose the inserted room graph to navigation/minimap
        // consumers without assembling a second overlapping gallery shell.
        isSupplementGraphConnection: true,
        hostsLogicalGate: false,
        originalEdgeSnapshot: clonePlainValue(operation.originalEdgeSnapshot ?? null),
      };
    });
    const logicalGateId = operation.originalLogicalEdge?.gateId ?? plan.doorId ?? null;
    if (logicalGateId) {
      // Industrial places an authored connection's gate at its destination
      // threshold. Mirror that ownership in the effective room graph so the
      // generated chain cannot become a controller-level bypass.
      const gateHost = [...physicalPlans].reverse().find((physicalPlan) => (
        physicalPlan.toRoomId === plan.toRoomId
      )) ?? physicalPlans.at(-1);
      if (gateHost) {
        gateHost.doorId = logicalGateId;
        gateHost.hostsLogicalGate = true;
      }
    }
    const invalidPhysicalPlan = physicalPlans.find((candidate) => (
      !candidate.fromRoomId
      || !candidate.toRoomId
      || candidate.fullPath.length < 1
    ));
    if (invalidPhysicalPlan) {
      errors.push(`Padded segment ${invalidPhysicalPlan.id} has unresolved endpoints.`);
      continue;
    }
    const path = joinMaterializedConnectionPaths(
      physicalPlans,
      spliceEdge.from?.position ?? spliceEdge.fromSocket,
      spliceEdge.to?.position ?? spliceEdge.toSocket,
      tileSize,
    );
    plan.fullPath = path;
    plan.bridgePath = [...path];
    plan.originalConnectionPlanSnapshot = immutableOriginalPlanById.get(plan.id)
      ?? immutableConnectionPlanSnapshot(plan);
    plan.supplementalPhysicalSegmentIds = physicalPlans.map((physicalPlan) => physicalPlan.id);
    plan.augmentationOperationId = operation.id;
    plan.isPaddedByDungeonSupplement = true;
    plan.logicalGateId = operation.originalLogicalEdge?.gateId ?? plan.doorId ?? null;
    plan.credentialRequirement = clonePlainValue(
      operation.originalLogicalEdge?.credentialRequirement ?? plan.credentialRequirement ?? null,
    );
    plan.progressionTier = number(
      operation.originalLogicalEdge?.progressionTier,
      number(plan.progressionTier),
    );
    plan.dominanceBoundary = clonePlainValue(
      operation.originalLogicalEdge?.dominanceBoundary ?? plan.dominanceBoundary ?? null,
    );
    plan.isLogicalPaddedConnectionRecord = true;

    effectiveConnections.push(...physicalPlans);
    for (const physicalPlan of physicalPlans) {
      addRoomSocket(
        roomById,
        physicalPlan.fromRoomId,
        physicalPlan.fromSocket,
        physicalPlan.id,
        physicalPlan.purpose,
      );
      addRoomSocket(
        roomById,
        physicalPlan.toRoomId,
        physicalPlan.toSocket,
        physicalPlan.id,
        physicalPlan.purpose,
      );
      materializedPaddingConnectionIds.push(physicalPlan.id);
    }
    paddedConnections.push({
      operationId: operation.id,
      logicalConnectionId: plan.logicalConnectionId,
      parentConnectionId: plan.id,
      gateId: plan.logicalGateId,
      physicalConnectionIds: physicalPlans.map((physicalPlan) => physicalPlan.id),
    });
  }

  const optionalSegments = segments.filter((segment) => !paddingOperationIds.has(
    segmentOperationId(segment),
  ));
  for (const segment of optionalSegments) {
    const plan = createSupplementConnectionPlan(segment, effectiveRooms, tileSize, footprints);
    if (!plan.fromRoomId || !plan.toRoomId || plan.fullPath.length < 1) {
      errors.push(`Supplement segment ${segment.id} has unresolved endpoints.`);
      continue;
    }
    effectiveConnections.push(plan);
    addRoomSocket(roomById, plan.fromRoomId, plan.fromSocket, plan.id, plan.purpose);
    addRoomSocket(roomById, plan.toRoomId, plan.toSocket, plan.id, plan.purpose);
    materializedOptionalConnectionIds.push(plan.id);
  }

  const supplementalConnectionIds = [
    ...materializedPaddingConnectionIds,
    ...materializedOptionalConnectionIds,
  ];

  return {
    rooms: effectiveRooms,
    connectionPlans: effectiveConnections,
    supplementalRoomIds: supplementRooms.map((room) => room.id),
    supplementalConnectionIds,
    diagnostics: {
      accepted: errors.length === 0,
      reason: errors.length === 0 ? 'materialized' : 'materialization-failed',
      errors,
      roomCount: supplementRooms.length,
      connectionCount: supplementalConnectionIds.length,
      physicalConnectionCount: supplementalConnectionIds.length,
      paddingConnectionCount: materializedPaddingConnectionIds.length,
      optionalConnectionCount: materializedOptionalConnectionIds.length,
      paddedLogicalConnectionCount: paddedConnections.length,
      paddedConnections,
    },
  };
}

export function createIndustrialSupplementRewardTiles(rooms = [], tileSize = 2.8) {
  return rooms.flatMap((room) => (room.augmentationAnchors ?? [])
    .filter((anchor) => anchor.kind === 'reward')
    .map((anchor) => ({
      roomId: room.id,
      x: Math.round(number(anchor.position?.x, room.x * tileSize) / tileSize),
      z: Math.round(number(anchor.position?.z, room.z * tileSize) / tileSize),
    })));
}
