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
  createDungeonRouteEndpointSeam,
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
  DUNGEON_ROUTE_ENDPOINT_SEAM_GRID_LATTICE_DIAGNOSTIC,
  inspectDungeonRouteEndpointSeamGridLattice,
} from './endpointSeamLattice.js';
import {
  DungeonAugmentationRandom,
  deriveDungeonAugmentationSeed,
} from './rng.js';
import { createDungeonSelectionBagWitness } from './selectionBagWitness.js';
import {
  computeDungeonAugmentationPlanHash,
  computeEffectiveDungeonPlanHash,
  evaluateDungeonRouteNetworkFeaturelessGraph,
  validateDungeonAugmentationPlan,
} from './validation.js';

function issue(code, message, context = {}) {
  return { code, message, context };
}

function clampInteger(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.floor(Number(value) || 0)));
}

function stableUniqueSelectionIds(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
}

function uniqueSelectionIdsInOrder(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
}

export function dungeonSelectionBagDomainKey(legalIds = []) {
  return canonicalStringify(stableUniqueSelectionIds(legalIds));
}

function selectionBagDomainState(bag, domainKey, legalIds = []) {
  const legalSet = new Set(stableUniqueSelectionIds(legalIds));
  const filteredState = (state, cycle = 0) => ({
    cycle: Math.max(0, Math.trunc(Number(state?.cycle ?? cycle))),
    consumedIds: uniqueSelectionIdsInOrder(state?.consumedIds)
      .filter((id) => legalSet.has(id)),
  });
  const domains = bag?.domains && typeof bag.domains === 'object'
    ? bag.domains
    : null;
  const domain = domains?.[domainKey];
  if (domain) return filteredState(domain);
  const seedState = {
    cycle: !domains || Object.keys(domains).length === 0 ? bag?.cycle : 0,
    consumedIds: bag?.globalConsumedIds ?? bag?.consumedIds,
  };
  // A newly encountered compatibility domain inherits only the selections
  // that overlap its legal set. This preserves global no-repeat ordering
  // across changing grant constraints while preventing one role's refill
  // from clearing another overlapping role's state.
  return filteredState(seedState);
}

function cloneSelectionBagDomains(domains) {
  return Object.fromEntries(Object.entries(
    domains && typeof domains === 'object' ? domains : {},
  ).sort(([first], [second]) => first.localeCompare(second)).map(([key, state]) => [
    key,
    {
      cycle: Math.max(0, Math.trunc(Number(state?.cycle ?? 0))),
      consumedIds: uniqueSelectionIdsInOrder(state?.consumedIds),
    },
  ]));
}

function cloneDungeonSelectionBag(bag) {
  return {
    order: uniqueSelectionIdsInOrder(bag?.order),
    cycle: Math.max(0, Math.trunc(Number(bag?.cycle ?? 0))),
    consumedIds: uniqueSelectionIdsInOrder(bag?.consumedIds),
    ...(Array.isArray(bag?.globalConsumedIds)
      ? { globalConsumedIds: uniqueSelectionIdsInOrder(bag.globalConsumedIds) }
      : {}),
    ...(bag?.domains && typeof bag.domains === 'object'
      ? { domains: cloneSelectionBagDomains(bag.domains) }
      : {}),
  };
}

/**
 * Creates one immutable exhaustion bag. Callers must provide an isolated RNG
 * fork for the family; the returned state is renderer-free and serializable.
 */
export function createDungeonSelectionBag(random, ids = []) {
  const legalIds = stableUniqueSelectionIds(ids);
  return {
    order: random?.shuffle ? random.shuffle(legalIds) : legalIds,
    cycle: 0,
    consumedIds: [],
  };
}

/**
 * Enumerates tentative immutable selections. A cycle refills only after every
 * member that is legal for the current decision has already been consumed.
 * Merely enumerating a failed branch never mutates the parent bag.
 */
export function dungeonSelectionBagCandidates(bag, legalIds = []) {
  const order = uniqueSelectionIdsInOrder(bag?.order ?? []);
  const canonicalLegalIds = stableUniqueSelectionIds(legalIds);
  const legal = new Set(canonicalLegalIds);
  const orderedLegal = order.filter((id) => legal.has(id));
  if (orderedLegal.length === 0) return [];
  const domainKey = dungeonSelectionBagDomainKey(canonicalLegalIds);
  const beforeDomain = selectionBagDomainState(bag, domainKey, canonicalLegalIds);
  const consumed = new Set(beforeDomain.consumedIds);
  let available = orderedLegal.filter((id) => !consumed.has(id));
  const refilled = available.length === 0;
  const baseDomainState = {
    cycle: beforeDomain.cycle + (refilled ? 1 : 0),
    consumedIds: refilled ? [] : orderedLegal.filter((id) => consumed.has(id)),
  };
  let globalConsumedIds = uniqueSelectionIdsInOrder(
    bag?.globalConsumedIds ?? bag?.consumedIds,
  ).filter((id) => order.includes(id));
  if (globalConsumedIds.length >= order.length) globalConsumedIds = [];
  if (refilled) available = orderedLegal;
  return available.map((id) => ({
    id,
    domainKey,
    beforeDomainState: {
      cycle: beforeDomain.cycle,
      consumedIds: [...beforeDomain.consumedIds],
    },
    beforeGlobalConsumedIds: [...globalConsumedIds],
    refilled,
    state: {
      order: [...order],
      cycle: baseDomainState.cycle,
      consumedIds: [...baseDomainState.consumedIds, id],
      globalConsumedIds: uniqueSelectionIdsInOrder([...globalConsumedIds, id]),
      domains: {
        ...cloneSelectionBagDomains(bag?.domains),
        [domainKey]: {
          cycle: baseDomainState.cycle,
          consumedIds: [...baseDomainState.consumedIds, id],
        },
      },
    },
  }));
}

function consumeDungeonSelectionBagIds(bag, selectedIds = [], legalIds = bag?.order ?? []) {
  let next = cloneDungeonSelectionBag(bag);
  for (const id of uniqueSelectionIdsInOrder(selectedIds)) {
    const candidate = dungeonSelectionBagCandidates(next, legalIds)
      .find((entry) => entry.id === String(id));
    if (candidate) next = candidate.state;
  }
  return next;
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

export function normalizeRouteNetworkGrant(grant, region) {
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
  planningOnly = false,
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
      ...(planningOnly ? socket : cloneDungeonAugmentationValue(socket)),
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
  // Placement search can construct thousands of candidates before retaining
  // a domain of at most 64. Anchors and their runtime payload never
  // participate in collision, socket routing, or mask checks, so defer them
  // until the accepted candidate is hydrated below. This keeps the planning
  // record physical and deterministic without deep-cloning discarded
  // gameplay content.
  const anchors = planningOnly ? [] : grammar.anchors.map((anchor, anchorOrdinal) => {
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
    blueprintPersistentStateIds: planningOnly
      ? (grammar.blueprintPersistentStateIds ?? [])
      : cloneDungeonAugmentationValue(grammar.blueprintPersistentStateIds ?? []),
    runtimeStateIds: planningOnly
      ? []
      : blueprintRuntimeStateIds(id, grammar.blueprintPersistentStateIds),
    blueprintCanonicalRotationQuarterTurns:
      grammar.blueprintCanonicalRotationQuarterTurns ?? 0,
    topology: grammar.topology,
    themeBinding: planningOnly
      ? themeBinding
      : cloneDungeonAugmentationValue(themeBinding),
    placement,
    size: {
      x: Number(grammar.size.width),
      y: Number(grammar.size.height),
      z: Number(grammar.size.depth),
      widthMeters: Number(grammar.size.width),
      heightMeters: Number(grammar.size.height),
      depthMeters: Number(grammar.size.depth),
    },
    // Route semantics can replace the top-level platform/ramp/rail arrays, so
    // every planning candidate still receives its own structure shell. The
    // immutable authored children are safe to share until final hydration.
    structure: planningOnly
      ? { ...(grammar.structure ?? {}) }
      : cloneDungeonAugmentationValue(grammar.structure),
    socketConnectivityGroups: planningOnly
      ? (grammar.socketConnectivityGroups ?? [])
      : cloneDungeonAugmentationValue(grammar.socketConnectivityGroups ?? []),
    selectionConstraints: planningOnly
      ? (grammar.selectionConstraints ?? {})
      : cloneDungeonAugmentationValue(grammar.selectionConstraints ?? {}),
    sockets,
    anchors,
    occupiedVolumes: grammar.occupiedVolumes.map((volume) => transformDungeonVolume(volume, placement, `${id}:`)),
    clearanceVolumes: grammar.clearanceVolumes.map((volume) => transformDungeonVolume(volume, placement, `${id}:`)),
    requiredThemeCapabilities: planningOnly
      ? {
        ...(grammar.requiredThemeCapabilities ?? {}),
        materials: [...(grammar.requiredThemeCapabilities?.materials ?? [])],
      }
      : cloneDungeonAugmentationValue(grammar.requiredThemeCapabilities),
    progressionOrder,
    socketIdByLocalId,
    ...(planningOnly ? { planningOnly: true } : {}),
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
    // V4 applies the global room-layout bag after semantic/elevation
    // balancing. Keep this resolver as a stable constraint seed; it must not
    // independently consume or pseudo-randomly index a family.
    return choices[0];
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

const ROUTE_NETWORK_ENCOUNTER_PROFILE_IDS = Object.freeze([
  'supplement-route-network-defense',
  'supplement-lateral-defense',
]);

function routeNetworkRoomLayoutCandidates({
  profile,
  grammars,
  contentRole,
  currentGrammar,
  topologyKit = false,
}) {
  if (!currentGrammar) return [];
  if (topologyKit) return [currentGrammar];
  const currentDelta = Number(
    currentGrammar.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
  );
  const currentTransferKinds = new Set(
    currentGrammar.selectionConstraints?.authoredTransferKinds ?? [],
  );
  return profile.grammarPool
    .map(({ id }) => grammars[id])
    .filter((candidate) => {
      if (!candidate
        || String(candidate.selectionConstraints?.routeNetworkModuleKind ?? 'room') !== 'room'
        || candidate.selectionConstraints?.routeNetworkJunctionKind != null
        || !candidate.selectionConstraints?.routeNetworkContentRoles?.includes(contentRole)) {
        return false;
      }
      const candidateDelta = Number(
        candidate.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
      );
      if (Math.abs(candidateDelta - currentDelta) > 0.000001) return false;
      if (Math.abs(currentDelta) <= 0.000001 || currentTransferKinds.size === 0) return true;
      return (candidate.selectionConstraints?.authoredTransferKinds ?? [])
        .some((kind) => currentTransferKinds.has(kind));
    })
    .sort((first, second) => String(first.id).localeCompare(String(second.id)));
}

function selectRouteNetworkRoomLayouts({
  profile,
  grammars,
  selectedGrammars,
  contentRoles,
  moduleKinds,
  topologyKitModuleIndex,
  roomLayoutBag,
  legalGrammarIdsByIndex = new Map(),
  selectionAlternativeOrdinal = 0,
}) {
  let nextBag = cloneDungeonSelectionBag(roomLayoutBag);
  const selections = [];
  const witnesses = [];
  const resolvedGrammars = [...selectedGrammars];
  for (let index = 0; index < resolvedGrammars.length; index += 1) {
    if (moduleKinds[index] !== 'room') continue;
    const compatibleGrammars = routeNetworkRoomLayoutCandidates({
      profile,
      grammars,
      contentRole: contentRoles[index],
      currentGrammar: resolvedGrammars[index],
      topologyKit: index === topologyKitModuleIndex,
    });
    const constrainedGrammarIds = legalGrammarIdsByIndex.get(index);
    const constrainedGrammarIdSet = constrainedGrammarIds
      ? new Set(constrainedGrammarIds.map(String))
      : null;
    const legalGrammars = constrainedGrammarIdSet
      ? [...constrainedGrammarIdSet]
        .map((id) => grammars[id])
        .filter(Boolean)
      : compatibleGrammars;
    const legalIds = legalGrammars.map(({ id }) => id);
    const beforeBag = nextBag;
    const candidates = dungeonSelectionBagCandidates(nextBag, legalIds);
    const selected = candidates[Math.min(
      Math.max(0, Math.trunc(Number(selectionAlternativeOrdinal) || 0)),
      Math.max(0, candidates.length - 1),
    )];
    if (!selected) continue;
    const grammar = grammars[selected.id];
    if (!grammar) continue;
    resolvedGrammars[index] = grammar;
    nextBag = selected.state;
    witnesses.push(createDungeonSelectionBagWitness({
      family: 'roomLayout',
      bag: beforeBag,
      legalIds,
      selection: selected,
    }));
    selections.push({
      nodeOrdinal: index,
      grammarId: grammar.id,
      contentRole: String(contentRoles[index] ?? ''),
      cycle: selected.state.cycle,
      refilled: selected.refilled,
      topologyKit: index === topologyKitModuleIndex,
    });
  }
  return {
    selectedGrammars: resolvedGrammars,
    bag: nextBag,
    selections,
    witnesses,
  };
}

function recordAcceptedRouteNetworkRoomLayouts({
  profile,
  grammars,
  selectedGrammars,
  contentRoles,
  moduleKinds,
  topologyKitModuleIndex,
  roomLayoutBag,
  legalGrammarIdsByIndex = new Map(),
}) {
  let nextBag = cloneDungeonSelectionBag(roomLayoutBag);
  const selections = [];
  const witnesses = [];
  for (let index = 0; index < selectedGrammars.length; index += 1) {
    if (moduleKinds[index] !== 'room') continue;
    const grammar = selectedGrammars[index];
    const compatibleIds = routeNetworkRoomLayoutCandidates({
      profile,
      grammars,
      contentRole: contentRoles[index],
      currentGrammar: grammar,
      topologyKit: index === topologyKitModuleIndex,
    }).map(({ id }) => id);
    const constrainedGrammarIds = legalGrammarIdsByIndex.get(index);
    const constrainedGrammarIdSet = constrainedGrammarIds
      ? new Set(constrainedGrammarIds.map(String))
      : null;
    const legalCompatibleIds = constrainedGrammarIdSet
      ? [...constrainedGrammarIdSet].filter((id) => Boolean(grammars[id]))
      : compatibleIds;
    const beforeBag = nextBag;
    let legalIds = legalCompatibleIds;
    let selected = dungeonSelectionBagCandidates(nextBag, legalIds)
      .find(({ id }) => id === String(grammar?.id ?? ''));
    if (!selected) {
      // A topology/elevation balance can make one exact authored grammar the
      // only physically legal choice after the provisional bag decision. Its
      // singleton compatibility domain records that forced decision without
      // changing the already accepted geometry or consuming a failed branch.
      legalIds = [String(grammar?.id ?? '')].filter(Boolean);
      [selected] = dungeonSelectionBagCandidates(nextBag, legalIds);
    }
    if (!selected) continue;
    nextBag = selected.state;
    witnesses.push(createDungeonSelectionBagWitness({
      family: 'roomLayout',
      bag: beforeBag,
      legalIds,
      selection: selected,
    }));
    selections.push({
      nodeOrdinal: index,
      grammarId: String(grammar.id),
      contentRole: String(contentRoles[index] ?? ''),
      cycle: selected.state.cycle,
      refilled: selected.refilled,
      topologyKit: index === topologyKitModuleIndex,
    });
  }
  return { bag: nextBag, selections, witnesses };
}

function selectRouteNetworkEncounters(nodes, encounterBag) {
  let nextBag = cloneDungeonSelectionBag(encounterBag);
  const selections = [];
  const witnesses = [];
  for (const node of nodes) {
    const encounterAnchors = (node.anchors ?? []).filter(({ kind }) => kind === 'encounter');
    if (encounterAnchors.length === 0) continue;
    const beforeBag = nextBag;
    const selected = dungeonSelectionBagCandidates(
      nextBag,
      ROUTE_NETWORK_ENCOUNTER_PROFILE_IDS,
    )[0];
    if (!selected) continue;
    nextBag = selected.state;
    witnesses.push(createDungeonSelectionBagWitness({
      family: 'encounter',
      bag: beforeBag,
      legalIds: ROUTE_NETWORK_ENCOUNTER_PROFILE_IDS,
      selection: selected,
    }));
    for (const anchor of encounterAnchors) anchor.encounterProfileId = selected.id;
    selections.push({
      nodeOrdinal: Number(node.ordinal),
      encounterProfileId: selected.id,
      cycle: selected.state.cycle,
      refilled: selected.refilled,
    });
  }
  return { bag: nextBag, selections, witnesses };
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
      selectedGrammars[index] = candidates[0];
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
    selectedGrammars[index] = candidates[0];
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
export function balanceObjectiveRouteGrammarIntervals({
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
  excludedNodeIndices = [],
  legalGrammarIdsByIndex = new Map(),
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
    const constrainedGrammarIds = legalGrammarIdsByIndex.get(index);
    const constrainedGrammarIdSet = constrainedGrammarIds
      ? new Set(constrainedGrammarIds.map(String))
      : null;
    return candidatePool.filter((candidate) => {
      if (constrainedGrammarIdSet
        && !constrainedGrammarIdSet.has(String(candidate.id))) return false;
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
  const excludedNodeIndexSet = new Set(excludedNodeIndices.map(Number));
  const allRoomIndices = moduleKinds
    .map((moduleKind, index) => ({ moduleKind, index }))
    .filter(({ moduleKind, index }) => (
      moduleKind === 'room' && index !== topologyKitModuleIndex
    ))
    .map(({ index }) => index);
  // A content room moved onto a topology branch is not part of the mandatory
  // endpoint-to-endpoint elevation arc. A self-contained transfer on that
  // branch can satisfy the network's vertical-traversal contract, but it
  // cannot provide a nonzero rise or descent across an authored station.
  const roomIndices = allRoomIndices.filter((index) => (
    !excludedNodeIndexSet.has(index)
  ));
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
  const selfContainedBranchTransferPlan = allRoomIndices
    .filter((index) => (
      excludedNodeIndexSet.has(index) && contentRoles[index] === 'challenge'
    ))
    .map((index) => ({
      index,
      candidates: candidatesFor(index, 0, { matchTransfer: true }),
    }))
    .find(({ candidates }) => candidates.length > 0);
  if (selfContainedBranchTransferPlan) {
    const selfContainedBranchTransferIndex = selfContainedBranchTransferPlan.index;
    selectedGrammars[selfContainedBranchTransferIndex] =
      selfContainedBranchTransferPlan.candidates[0];
    for (const index of roomIndices) {
      const levelCandidates = candidatesFor(index, 0);
      if (levelCandidates.length === 0) {
        return {
          balanced: false,
          reason: 'branch-transfer-level-replacement-unavailable',
          branchTransferIndex: selfContainedBranchTransferIndex,
          nodeIndex: index,
        };
      }
      selectedGrammars[index] = levelCandidates[0];
    }
    const intervalDeltas = intervals.map(({ first, second, roomIndices: indices }) => ({
      first,
      second,
      delta: indices.reduce((sum, index) => (
        sum + grammarDelta(selectedGrammars[index])
      ), 0),
    }));
    return {
      balanced: intervalDeltas.every(({ delta }) => Math.abs(delta) <= epsilon),
      intervalDeltas,
      branchTransferIndex: selfContainedBranchTransferIndex,
    };
  }
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
        for (const index of allRoomIndices) {
          if (index === riseIndex || index === descentIndex) continue;
          if (Math.abs(grammarDelta(selectedGrammars[index])) <= epsilon
            && !preferCompactCoverage) continue;
          const levelCandidates = candidatesFor(index, 0);
          if (levelCandidates.length === 0) {
            feasible = false;
            break;
          }
          levelReplacements.set(index, levelCandidates[0]);
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
    const selfContainedPlans = intervals.flatMap((interval) => (
      interval.roomIndices.flatMap((index) => {
        const transferCandidates = candidatesFor(index, 0, { matchTransfer: true });
        if (transferCandidates.length === 0) return [];
        const levelReplacements = new Map();
        for (const otherIndex of allRoomIndices) {
          if (otherIndex === index) continue;
          const levelCandidates = candidatesFor(otherIndex, 0);
          if (levelCandidates.length === 0) return [];
          levelReplacements.set(otherIndex, levelCandidates[0]);
        }
        return [{
          intervalOrdinal: interval.ordinal,
          index,
          transferCandidates,
          levelReplacements,
        }];
      })
    )).sort((first, second) => (
      Number(contentRoles[first.index] !== 'challenge')
        - Number(contentRoles[second.index] !== 'challenge')
        || Number(contentRoles[first.index] !== 'mechanism')
          - Number(contentRoles[second.index] !== 'mechanism')
        || first.intervalOrdinal - second.intervalOrdinal
        || first.index - second.index
    ));
    if (selfContainedPlans.length > 0) {
      const plan = selfContainedPlans[0];
      for (const [index, grammar] of plan.levelReplacements) {
        selectedGrammars[index] = grammar;
      }
      selectedGrammars[plan.index] = plan.transferCandidates[0];
      return {
        balanced: true,
        intervalDeltas: intervals.map(({ first, second }) => ({
          first,
          second,
          delta: 0,
        })),
        selfContainedTransferIndex: plan.index,
      };
    }
    return {
      balanced: false,
      reason: 'authored-rise-return-pair-unavailable',
      intervals: intervals.map(({ first, second, roomIndices: indices }) => ({
        first,
        second,
        roomIndices: indices,
      })),
      excludedNodeIndices: [...excludedNodeIndexSet].sort((first, second) => first - second),
    };
  }
  // Pair ordering encodes the semantic preference. Variety is sampled within
  // the compatible rise/descent grammar families, never by choosing a weaker
  // pair that strands a required elevation-role room.
  const plan = pairPlans[0];
  for (const [index, grammar] of plan.levelReplacements) {
    selectedGrammars[index] = grammar;
  }
  // Three- and four-station coverage grants have only one 14 m station bay
  // between some exact sockets. Prefer the smallest legal authored rise and
  // return in those dense networks; two-station routes retain the normal
  // deterministic exhaustion order for visual variety.
  selectedGrammars[plan.riseIndex] = plan.riseCandidates[0];
  selectedGrammars[plan.descentIndex] = plan.descentCandidates[0];

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
  topologySupportConnectorIndex = null,
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
    || routeNetworkKind === 'landmark-perimeter-loop') {
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
  // Balancing is allowed to diversify ordinary connector grammars, but the
  // stacked-interchange support is structural topology, not a free selection
  // slot. Apply it after balancing so refinement cannot turn the support into
  // a second stacked kit and invalidate the authored compound.
  if (Number.isSafeInteger(Number(topologySupportConnectorIndex))) {
    const supportIndex = Number(topologySupportConnectorIndex);
    const throughTGrammar = routeNetworkGrammarForKind(
      profile,
      grammars,
      'through-t',
      'connector-module',
    );
    if (supportIndex >= 0
      && supportIndex < selectedGrammars.length
      && supportIndex !== topologyKitModuleIndex
      && moduleKinds[supportIndex] === 'connector-module'
      && throughTGrammar) {
      selectedGrammars[supportIndex] = throughTGrammar;
      resolvedJunctionKinds[supportIndex] = 'through-t';
    }
  }
  return {
    selectedGrammars,
    junctionKinds: resolvedJunctionKinds,
    topologyKitGrammar,
    topologyKitModuleIndex,
    topologyKitDeferred: topologyKitModuleIndex == null,
  };
}

/**
 * Reserve the free-standing connector needed by the stacked-interchange kit.
 *
 * The terminal interchange owns two upper-route sockets. Those sockets cannot
 * legally return to one ordinary two-socket room: their minimum exterior U is
 * already longer than the V4 featureless-distance limit. Preserve the first
 * and last non-endpoint modules as challenge/payoff rooms and reserve the
 * middle non-endpoint module as an authored Through-T support instead.
 *
 * This helper is deliberately renderer- and geometry-free so the allocation
 * is stable across provisional and refined coverage placement passes.
 */
export function resolveStackedInterchangeSupportAllocation({
  routeNetworkKind = null,
  topologyTemplateId = null,
  physicalModuleCount = 0,
  endpointNodeIndices = [],
} = {}) {
  const count = Math.max(0, Math.trunc(Number(physicalModuleCount) || 0));
  const endpointIndexSet = new Set((endpointNodeIndices ?? [])
    .map((index) => Math.trunc(Number(index)))
    .filter((index) => Number.isSafeInteger(index) && index >= 0 && index < count));
  const ordinaryNodeIndices = Array.from({ length: count }, (_, index) => index)
    .filter((index) => !endpointIndexSet.has(index));
  const supportCandidates = routeNetworkKind === 'objective-route-coverage'
    && topologyTemplateId === 'stacked-interchange'
    ? ordinaryNodeIndices.slice(1, -1)
    : [];
  const supportConnectorIndex = supportCandidates[
    Math.floor(supportCandidates.length * 0.5)
  ] ?? null;
  const connectorNodeIndices = [...endpointIndexSet];
  if (supportConnectorIndex != null) connectorNodeIndices.push(supportConnectorIndex);
  connectorNodeIndices.sort((first, second) => first - second);
  return {
    supportConnectorIndex,
    supportMinimumGraphDegree: supportConnectorIndex == null ? null : 3,
    connectorNodeIndices,
    roomNodeIndices: ordinaryNodeIndices.filter((index) => index !== supportConnectorIndex),
  };
}

export function routeNetworkTopologyIsLegalForGrant(topologyTemplateId, grant = {}) {
  if (String(topologyTemplateId) === 'stacked-interchange') {
    return Number(grant.endpointSockets?.length ?? 0) === 2;
  }
  return true;
}

/**
 * Reject catalog/topology compositions that cannot allocate their authored
 * infrastructure before running geometry. The stacked interchange consumes a
 * terminal kit plus one ordinary Through-T support, while still preserving
 * two curated content rooms. With two exact parent stations that requires at
 * least five physical modules; a four-module candidate can only fail later
 * while trying to invent the missing return leg.
 */
export function routeNetworkTopologySupportsModuleCount(
  topologyTemplateId,
  grant = {},
  moduleCount = 0,
) {
  if (!routeNetworkTopologyIsLegalForGrant(topologyTemplateId, grant)) return false;
  if (String(topologyTemplateId) !== 'stacked-interchange'
    || String(grant.kind ?? '') !== 'objective-route-coverage') return true;
  const endpointCount = Number(grant.endpointSockets?.length ?? 0);
  return Number(moduleCount) - endpointCount >= 3;
}

/**
 * Expands a two-endpoint coverage composition with the reserved Through-T as
 * a physical companion to the terminal stacked-interchange kit. The two
 * ordinary rooms remain on the externally composed route; the support is
 * inserted immediately before the kit in graph order and starts exactly two
 * 5.6 m seam leads from one upper socket.
 */
export function composeStackedInterchangeSupportCompound({
  placement,
  selectedGrammars = [],
  physicalModuleCount = 0,
  endpointNodeIndices = [],
  topologyKitModuleIndex = null,
  supportConnectorIndex = null,
  endpoints = [],
  diagnostics = null,
} = {}) {
  const reject = (reason, details = {}) => {
    if (diagnostics && typeof diagnostics === 'object') {
      Object.assign(diagnostics, { accepted: false, reason, ...details });
    }
    return null;
  };
  const count = Math.max(0, Math.trunc(Number(physicalModuleCount) || 0));
  const endpointIndices = [...new Set((endpointNodeIndices ?? []).map(Number))]
    .filter((index) => Number.isSafeInteger(index) && index >= 0 && index < count)
    .sort((first, second) => first - second);
  const supportIndex = Number(supportConnectorIndex);
  const kitIndex = Number(topologyKitModuleIndex);
  if (!placement
    || endpointIndices.length !== 2
    || !Number.isSafeInteger(supportIndex)
    || !Number.isSafeInteger(kitIndex)
    || supportIndex < 0
    || supportIndex >= count
    || kitIndex < 0
    || kitIndex >= count
    || !endpointIndices.includes(kitIndex)) return reject('invalid-compound-contract', {
      physicalModuleCount: count,
      endpointNodeIndices: endpointIndices,
      topologyKitModuleIndex: topologyKitModuleIndex ?? null,
      supportConnectorIndex: supportConnectorIndex ?? null,
    });
  const physicalOrderWithoutSupport = Array.from({ length: count }, (_, index) => index)
    .filter((index) => index !== supportIndex);
  const placementCenterCount = placement.centers?.length ?? 0;
  const supportAlreadyPresent = placementCenterCount === count
    && placement.endpointNodeIndices?.length === 2
    && endpointIndices.every((index, ordinal) => (
      Number(placement.endpointNodeIndices[ordinal]) === index
    ));
  const supportOmitted = placementCenterCount === physicalOrderWithoutSupport.length
    && placement.endpointNodeIndices?.length === 2
    && Number(placement.endpointNodeIndices[0]) === 0
    && Number(placement.endpointNodeIndices[1]) === physicalOrderWithoutSupport.length - 1;
  if (!supportAlreadyPresent && !supportOmitted) {
    return reject('unsupported-placement-shape', {
      placementCenterCount,
      placementEndpointNodeIndices: cloneDungeonAugmentationValue(
        placement.endpointNodeIndices ?? [],
      ),
      expectedPhysicalModuleCount: count,
      expectedWithoutSupportCount: physicalOrderWithoutSupport.length,
    });
  }
  const oldPhysicalOrder = supportAlreadyPresent
    ? Array.from({ length: count }, (_, index) => index)
    : physicalOrderWithoutSupport;
  const oldIndexByPhysicalIndex = new Map(oldPhysicalOrder.map((index, ordinal) => (
    [index, ordinal]
  )));
  const remapIndex = (oldIndex) => oldPhysicalOrder[Number(oldIndex)];
  const expandArray = (values = [], fallback = null) => Array.from(
    { length: count },
    (_, index) => index === supportIndex
      ? cloneDungeonAugmentationValue(fallback)
      : cloneDungeonAugmentationValue(values[oldIndexByPhysicalIndex.get(index)] ?? fallback),
  );
  const centers = expandArray(placement.centers, null);
  const nodeFacings = expandArray(placement.nodeFacings, null);
  const placementOutwardFacings = expandArray(placement.placementOutwardFacings, null);
  const anchorEndpointOrdinals = expandArray(placement.anchorEndpointOrdinals, null);
  const kitCenter = centers[kitIndex];
  const kitEndpointOrdinal = endpointIndices.indexOf(kitIndex);
  const kitFacing = toDungeonCardinalFacing(
    nodeFacings[kitIndex] ?? endpoints[kitEndpointOrdinal]?.facing,
  );
  const kitGrammar = selectedGrammars[kitIndex];
  const supportGrammar = selectedGrammars[supportIndex];
  const topologySocketIds = new Set(
    kitGrammar?.selectionConstraints?.routeNetworkTopologySocketIds ?? ['left', 'right'],
  );
  const kitPlacement = {
    center: kitCenter,
    rotationQuarterTurns: rotationQuarterTurnsForFacing(kitFacing),
  };
  const otherEndpointCenter = centers[endpointIndices.find((index) => index !== kitIndex)];
  const kitSocketCandidates = (kitGrammar?.sockets ?? [])
    .filter(({ id }) => topologySocketIds.has(id))
    .map((socket) => ({
      socket,
      position: transformDungeonLocalPoint(socket.localPosition, kitPlacement),
      facing: transformDungeonLocalFacing(socket.localFacing, kitPlacement),
    }))
    .sort((first, second) => (
      dungeonPointDistance(second.position, otherEndpointCenter)
        - dungeonPointDistance(first.position, otherEndpointCenter)
        || String(first.socket.id).localeCompare(String(second.socket.id))
    ));
  const supportBranchSocket = supportGrammar?.sockets?.find(({ id }) => id === 'right')
    ?? supportGrammar?.sockets?.find(({ id }) => !['entry', 'exit'].includes(id));
  const kitSocket = kitSocketCandidates[0] ?? null;
  if (!kitCenter || !kitSocket || !supportBranchSocket) {
    return reject('compound-socket-unavailable', {
      kitCenter: cloneDungeonAugmentationValue(kitCenter),
      topologySocketCount: kitSocketCandidates.length,
      supportSocketIds: (supportGrammar?.sockets ?? []).map(({ id }) => id),
    });
  }
  const desiredSupportSocketFacing = scaleDungeonPoint(kitSocket.facing, -1);
  const supportFacing = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 },
  ].find((candidateFacing) => {
    const transformedFacing = transformDungeonLocalFacing(
      supportBranchSocket.localFacing,
      { rotationQuarterTurns: rotationQuarterTurnsForFacing(candidateFacing) },
    );
    return dungeonPointDistance(transformedFacing, desiredSupportSocketFacing) <= 1e-6;
  }) ?? null;
  if (!supportFacing) return reject('support-orientation-unavailable', {
    kitLocalSocketId: kitSocket.socket.id,
    kitSocketFacing: cloneDungeonAugmentationValue(kitSocket.facing),
    supportLocalSocketId: supportBranchSocket.id,
  });
  const supportRotationQuarterTurns = rotationQuarterTurnsForFacing(supportFacing);
  const desiredSupportSocketPosition = addDungeonPoints(
    kitSocket.position,
    scaleDungeonPoint(kitSocket.facing, ROUTE_NETWORK_SOCKET_APPROACH_METERS * 2),
  );
  const rotatedSupportSocketPosition = transformDungeonLocalPoint(
    supportBranchSocket.localPosition,
    {
      center: { x: 0, y: 0, z: 0 },
      rotationQuarterTurns: supportRotationQuarterTurns,
    },
  );
  const supportCenter = {
    x: Number(desiredSupportSocketPosition.x) - Number(rotatedSupportSocketPosition.x),
    y: Number(desiredSupportSocketPosition.y) - Number(rotatedSupportSocketPosition.y),
    z: Number(desiredSupportSocketPosition.z) - Number(rotatedSupportSocketPosition.z),
  };
  centers[supportIndex] = supportCenter;
  nodeFacings[supportIndex] = supportFacing;
  placementOutwardFacings[supportIndex] = cloneDungeonAugmentationValue(kitSocket.facing);
  anchorEndpointOrdinals[supportIndex] = null;

  const graphOrder = physicalOrderWithoutSupport.filter((index) => index !== kitIndex);
  graphOrder.push(supportIndex, kitIndex);
  const endpointIndexSet = new Set(endpointIndices);
  const requiredSocketBindings = graphOrder.slice(1).map((toIndex, ordinal) => {
    const fromIndex = graphOrder[ordinal];
    if (fromIndex === supportIndex && toIndex === kitIndex) {
      return {
        fromIndex,
        toIndex,
        fromLocalSocketId: supportBranchSocket.id,
        toLocalSocketId: kitSocket.socket.id,
      };
    }
    return {
      fromIndex,
      toIndex,
      fromLocalSocketId: endpointIndexSet.has(fromIndex) ? null : 'exit',
      toLocalSocketId: endpointIndexSet.has(toIndex) ? null : 'entry',
    };
  });
  const requiredPairKeys = new Set(requiredSocketBindings.map(({ fromIndex, toIndex }) => (
    fromIndex < toIndex ? `${fromIndex}:${toIndex}` : `${toIndex}:${fromIndex}`
  )));
  const externalSpinePaths = (placement.externalSpinePaths ?? []).flatMap((record) => {
    const fromIndex = remapIndex(record.fromIndex);
    const toIndex = remapIndex(record.toIndex);
    const pairKey = fromIndex < toIndex
      ? `${fromIndex}:${toIndex}`
      : `${toIndex}:${fromIndex}`;
    if (!requiredPairKeys.has(pairKey)) return [];
    return [{ ...cloneDungeonAugmentationValue(record), fromIndex, toIndex }];
  });
  const result = {
    ...cloneDungeonAugmentationValue(placement),
    centers,
    endpointNodeIndices: endpointIndices,
    anchorEndpointOrdinals,
    nodeFacings,
    placementOutwardFacings,
    requiredSocketBindings,
    externalSpinePaths,
    stackedInterchangeCompound: {
      kitNodeIndex: kitIndex,
      supportNodeIndex: supportIndex,
      kitLocalSocketId: kitSocket.socket.id,
      supportLocalSocketId: supportBranchSocket.id,
      seamLeadMeters: ROUTE_NETWORK_SOCKET_APPROACH_METERS,
      routePath: [
        cloneDungeonAugmentationValue(kitSocket.position),
        cloneDungeonAugmentationValue(desiredSupportSocketPosition),
      ],
    },
  };
  if (diagnostics && typeof diagnostics === 'object') {
    Object.assign(diagnostics, {
      accepted: true,
      inputShape: supportAlreadyPresent ? 'support-present' : 'support-omitted',
      supportCenter: cloneDungeonAugmentationValue(supportCenter),
      graphOrder: [...graphOrder],
    });
  }
  return result;
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
    roomEntryLocalPositions = [],
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
    const entryLocalPosition = roomEntryLocalPositions[roomOrdinal] ?? null;
    const rotatedEntryOffset = entryLocalPosition
      ? transformDungeonLocalPoint(entryLocalPosition, {
        center: { x: 0, y: 0, z: 0 },
        rotationQuarterTurns: rotationQuarterTurnsForFacing(run.facing),
      })
      : scaleDungeonPoint(run.facing, -depthMeters * 0.5);
    return {
      roomOrdinal,
      entryDistanceMeters,
      exitDistanceMeters: entryDistanceMeters + depthMeters,
      center: {
        x: Number(entryPoint.x) - Number(rotatedEntryOffset.x),
        y: baseElevationMeters,
        z: Number(entryPoint.z) - Number(rotatedEntryOffset.z),
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
      return [...new Set(entryValues.map((value) => Number(value.toFixed(6))))]
        .map((entryDistanceMeters) => ({
          placements: [placementForEntry(roomOrdinal, entryDistanceMeters, run)],
          targetDeviationMeters: Math.abs(
            entryDistanceMeters - idealEntryDistanceMeters,
          ),
        }));
    }).map((candidate) => ({
      ...candidate,
      collisionScore: scorePlacement(candidate.placements[0]),
    })).sort((first, second) => (
      first.collisionScore - second.collisionScore
        || first.targetDeviationMeters - second.targetDeviationMeters
        || first.placements[0].entryDistanceMeters
          - second.placements[0].entryDistanceMeters
    )).slice(0, 64).map(({ placements }) => placements);
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
  contentRoomEntryLocalPositions = [],
  contentRoomSizes = [],
  contentRoomPlanningVolumes = [],
  minimumApproachMeters = ROUTE_NETWORK_SOCKET_APPROACH_METERS,
  minimumRoomApproachMeters = ROUTE_NETWORK_SOCKET_APPROACH_METERS,
  maximumFeaturelessSpanMeters = ROUTE_NETWORK_MAXIMUM_FEATURELESS_SPAN_METERS,
  searchVariant = 0,
  planningAvoidanceVolumes = [],
  planningOverlapGrants = [],
  diagnostics = null,
} = {}) {
  const planningNowMilliseconds = () => (
    globalThis.performance?.now?.() ?? Date.now()
  );
  const planningStartedAt = planningNowMilliseconds();
  const planningPhaseTimings = {
    candidateGenerationMs: 0,
    staticCollisionScoringMs: 0,
    staticCollisionScoringCalls: 0,
    pairCompatibilityMs: 0,
    pairCompatibilityEvaluations: 0,
    recursiveCompositionMs: 0,
    totalMs: 0,
  };
  const setDiagnostics = (stage, details = {}) => {
    if (diagnostics && typeof diagnostics === 'object') {
      planningPhaseTimings.totalMs = planningNowMilliseconds() - planningStartedAt;
      Object.assign(diagnostics, {
        stage,
        ...details,
        planningPhaseTimings: cloneDungeonAugmentationValue(planningPhaseTimings),
      });
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
    const volumeTemplates = [
      ...(grammar?.occupiedVolumes ?? []),
      ...(grammar?.clearanceVolumes ?? []),
    ];
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
      const scoringStartedAt = planningNowMilliseconds();
      const score = planningVolumesForRoomPlacement(placement).reduce((total, volume) => (
        total + [...nearbyPlanningAvoidanceVolumes(volume)].reduce((count, obstacle) => (
          count + (planningVolumesOverlap(volume, obstacle) ? 1 : 0)
        ), 0)
      ), 0);
      planningPhaseTimings.staticCollisionScoringMs +=
        planningNowMilliseconds() - scoringStartedAt;
      planningPhaseTimings.staticCollisionScoringCalls += 1;
      roomPlacementStaticCollisionScoreCache.set(key, score);
      return score;
    })()
  );
  const indexedPathPlanningCollisionScore = (
    path,
    heightMeters = 5.6,
    overlapGrants = [],
  ) => {
    const scoringStartedAt = planningNowMilliseconds();
    const score = routePathPlanningVolumes(path, heightMeters).reduce((total, volume) => (
      total + [...nearbyPlanningAvoidanceVolumes(volume)].reduce((count, obstacle) => (
        count + (planningVolumesOverlap(volume, obstacle)
          && !planningOverlapIsGranted(volume, obstacle, overlapGrants) ? 1 : 0)
      ), 0)
    ), 0);
    planningPhaseTimings.staticCollisionScoringMs +=
      planningNowMilliseconds() - scoringStartedAt;
    planningPhaseTimings.staticCollisionScoringCalls += 1;
    return score;
  };
  const planningCollisionIdsForVolumes = (
    volumes,
    overlapGrants = [],
  ) => [...new Set(volumes.flatMap((volume) => (
    [...nearbyPlanningAvoidanceVolumes(volume)]
      .filter((obstacle) => (
        planningVolumesOverlap(volume, obstacle)
          && !planningOverlapIsGranted(volume, obstacle, overlapGrants)
      ))
      .map((obstacle) => String(obstacle.id ?? obstacle.ownerId ?? 'unknown'))
  )))].sort();
  const roomPlacementStationCollisionScore = (placements) => {
    const compatibilityStartedAt = planningNowMilliseconds();
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
    const score = stationScore + roomScore;
    planningPhaseTimings.pairCompatibilityMs +=
      planningNowMilliseconds() - compatibilityStartedAt;
    planningPhaseTimings.pairCompatibilityEvaluations += 1;
    return score;
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
  const maximumRoomHalfExtentMeters = Math.max(
    4.2,
    ...contentRoomSizes.flatMap((size = {}) => [
      Number(size.width ?? 0) * 0.5,
      Number(size.depth ?? 0) * 0.5,
    ]),
  );
  const obstacleBoundsByOwner = new Map();
  for (const volume of planningAvoidanceVolumes) {
    if (!volume?.center || !volume?.size) continue;
    const ownerId = String(volume.ownerId ?? volume.id ?? 'unknown');
    const halfX = Number(volume.size.x ?? 0) * 0.5;
    const halfZ = Number(volume.size.z ?? 0) * 0.5;
    const bounds = obstacleBoundsByOwner.get(ownerId) ?? {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    };
    bounds.minX = Math.min(bounds.minX, Number(volume.center.x) - halfX);
    bounds.maxX = Math.max(bounds.maxX, Number(volume.center.x) + halfX);
    bounds.minZ = Math.min(bounds.minZ, Number(volume.center.z) - halfZ);
    bounds.maxZ = Math.max(bounds.maxZ, Number(volume.center.z) + halfZ);
    obstacleBoundsByOwner.set(ownerId, bounds);
  }
  const obstacleOwnerBounds = [...obstacleBoundsByOwner.values()];
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
    const baseDetourOffsetsMeters = Array.from(
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
        detourOffsetsMeters: (() => {
          const fromLead = routeSocketLead(fromSocket, minimumApproachMeters);
          const toLead = routeSocketLead(toSocket, minimumApproachMeters);
          const minimumLeadX = Math.min(Number(fromLead.x), Number(toLead.x));
          const maximumLeadX = Math.max(Number(fromLead.x), Number(toLead.x));
          const minimumLeadZ = Math.min(Number(fromLead.z), Number(toLead.z));
          const maximumLeadZ = Math.max(Number(fromLead.z), Number(toLead.z));
          const clearanceMeters = maximumRoomHalfExtentMeters + 2.8;
          const maximumDetourMeters = maximumFeaturelessSpanMeters
            * (contentRoomDepthMeters.length + 1);
          const quantizedOutwardOffset = (distance) => (
            Math.ceil(Math.max(0, Number(distance)) / 2.8 - 1e-9) * 2.8
          );
          const boundaryOffsets = obstacleOwnerBounds.flatMap((bounds) => [
            minimumLeadX - (Number(bounds.minX) - clearanceMeters),
            Number(bounds.maxX) + clearanceMeters - maximumLeadX,
            minimumLeadZ - (Number(bounds.minZ) - clearanceMeters),
            Number(bounds.maxZ) + clearanceMeters - maximumLeadZ,
          ]).map(quantizedOutwardOffset);
          return [...new Set([
            ...baseDetourOffsetsMeters,
            ...boundaryOffsets,
          ].filter((offset) => (
            offset >= 2.8 - 1e-6
              && offset <= maximumDetourMeters + 1e-6
          )).map((offset) => Number(offset.toFixed(6))))].sort((first, second) => (
            first - second
          ));
        })(),
        minimumApproachMeters,
      })) register(path, routePreferenceOrdinal);
    }
    return results.sort((first, second) => (
      first.lengthMeters - second.lengthMeters
        || first.routePreferenceOrdinal - second.routePreferenceOrdinal
        || first.signature.localeCompare(second.signature)
    ));
  };
  const candidateGenerationStartedAt = planningNowMilliseconds();
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
              roomEntryLocalPositions: contentRoomEntryLocalPositions,
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
            const stationCollisionScoringStartedAt = planningNowMilliseconds();
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
            planningPhaseTimings.staticCollisionScoringMs +=
              planningNowMilliseconds() - stationCollisionScoringStartedAt;
            planningPhaseTimings.staticCollisionScoringCalls += connectorPaths.length;
            const roomStaticCollisionScore = roomPlacements.reduce((score, placement) => (
              score + roomPlacementStaticCollisionScore(placement)
            ), 0);
            return {
              gapOrdinal,
              fromLocalSocketId: fromSocket.localSocketId,
              toLocalSocketId: toSocket.localSocketId,
              routeSignature: route.signature,
              roomPlacements,
              connectorPaths,
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
    // Keep the same eight-candidate bound per socket pair, but spend it on
    // distinct physical routes before retaining alternate placements along a
    // single shortest route.  The latter all bunch rooms beside the shared
    // station and can hide a collision-free outward detour beyond the beam.
    const optionsByPair = new Map();
    for (const option of options) {
      const pairKey = `${option.fromLocalSocketId}:${option.toLocalSocketId}`;
      const pairOptions = optionsByPair.get(pairKey) ?? [];
      pairOptions.push(option);
      optionsByPair.set(pairKey, pairOptions);
    }
    return [...optionsByPair.values()].flatMap((pairOptions) => {
      const selected = [];
      const selectedOptions = new Set();
      const seenRouteSignatures = new Set();
      for (const option of pairOptions) {
        if (selected.length >= 4) break;
        if (seenRouteSignatures.has(option.routeSignature)) continue;
        seenRouteSignatures.add(option.routeSignature);
        selected.push(option);
        selectedOptions.add(option);
      }
      for (const option of pairOptions) {
        if (selected.length >= 8) break;
        if (selectedOptions.has(option)) continue;
        selected.push(option);
      }
      return selected;
    }).sort((first, second) => (
      first.staticCollisionScore - second.staticCollisionScore
        || first.routeLengthMeters - second.routeLengthMeters
        || first.fromLocalSocketId.localeCompare(second.fromLocalSocketId)
        || first.toLocalSocketId.localeCompare(second.toLocalSocketId)
        || first.signature.localeCompare(second.signature)
    ));
  });
  planningPhaseTimings.candidateGenerationMs +=
    planningNowMilliseconds() - candidateGenerationStartedAt;
  if (gapOptions.some((options) => options.length === 0)) {
    setDiagnostics('gap-options-empty', {
      gapOptionCounts: gapOptions.map((options) => options.length),
    });
    return null;
  }
  const recursiveCompositionStartedAt = planningNowMilliseconds();
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
      planningPhaseTimings.recursiveCompositionMs +=
        planningNowMilliseconds() - recursiveCompositionStartedAt;
      setDiagnostics('combined-state-empty', {
        gapOptionCounts: gapOptions.map((candidates) => candidates.length),
      });
      return null;
    }
  }
  planningPhaseTimings.recursiveCompositionMs +=
    planningNowMilliseconds() - recursiveCompositionStartedAt;
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
    const bestState = states[0];
    const zeroStaticAdjacentPairDiagnostics = gapOptions.length >= 2
      ? gapOptions[0].flatMap((firstOption) => gapOptions[1].flatMap((secondOption) => {
        if (firstOption.staticCollisionScore !== 0
          || secondOption.staticCollisionScore !== 0
          || firstOption.toLocalSocketId === secondOption.fromLocalSocketId) return [];
        const combinedPlacements = [
          ...firstOption.roomPlacements,
          ...secondOption.roomPlacements,
        ];
        return [{
          firstSocketPair: `${firstOption.fromLocalSocketId}:${firstOption.toLocalSocketId}`,
          secondSocketPair: `${secondOption.fromLocalSocketId}:${secondOption.toLocalSocketId}`,
          combinedRoomStationCollisionScore:
            roomPlacementStationCollisionScore(combinedPlacements),
          firstRoomCenters: firstOption.roomPlacements.map(({ center }) => (
            cloneDungeonAugmentationValue(center)
          )),
          secondRoomCenters: secondOption.roomPlacements.map(({ center }) => (
            cloneDungeonAugmentationValue(center)
          )),
        }];
      })).sort((first, second) => (
        first.combinedRoomStationCollisionScore
          - second.combinedRoomStationCollisionScore
      )).slice(0, 8)
      : [];
    const connectorCollisionIds = planningCollisionIdsForVolumes(
      bestState.options.flatMap(({ connectorPaths = [] }) => (
        connectorPaths.flatMap((path) => routePathPlanningVolumes(path, 5.6))
      )),
      planningOverlapGrants,
    );
    const roomCollisionIds = planningCollisionIdsForVolumes(
      bestState.options.flatMap(({ roomPlacements }) => (
        roomPlacements.flatMap(planningVolumesForRoomPlacement)
      )),
    );
    setDiagnostics('best-state-collides', {
      bestStaticCollisionScore,
      stateCount: states.length,
      gapOptionCounts: gapOptions.map((candidates) => candidates.length),
      connectorCollisionIds: connectorCollisionIds.slice(0, 24),
      roomCollisionIds: roomCollisionIds.slice(0, 24),
      zeroStaticAdjacentPairDiagnostics,
      gapBestSocketPairs: gapOptions.map((options, gapOrdinal) => (
        [...new Map(options.map((option) => [
          `${option.fromLocalSocketId}:${option.toLocalSocketId}`,
          option,
        ])).values()].map((option) => ({
          gapOrdinal,
          fromLocalSocketId: option.fromLocalSocketId,
          toLocalSocketId: option.toLocalSocketId,
          routeLengthMeters: option.routeLengthMeters,
          staticCollisionScore: option.staticCollisionScore,
          routePath: cloneDungeonAugmentationValue(option.routePath),
          roomPlacements: option.roomPlacements.map(({ roomOrdinal, center, facing }) => ({
            roomOrdinal,
            center: cloneDungeonAugmentationValue(center),
            facing: cloneDungeonAugmentationValue(facing),
          })),
        }))
      )),
      bestStateSocketPairs: bestState.options.map((option) => ({
        gapOrdinal: option.gapOrdinal,
        fromLocalSocketId: option.fromLocalSocketId,
        toLocalSocketId: option.toLocalSocketId,
        routeLengthMeters: option.routeLengthMeters,
        staticCollisionScore: option.staticCollisionScore,
        routePath: cloneDungeonAugmentationValue(option.routePath),
        roomPlacements: option.roomPlacements.map((placement) => ({
          roomOrdinal: placement.roomOrdinal,
          center: cloneDungeonAugmentationValue(placement.center),
          facing: cloneDungeonAugmentationValue(placement.facing),
          entryDistanceMeters: placement.entryDistanceMeters,
          exitDistanceMeters: placement.exitDistanceMeters,
        })),
      })),
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
  const externalSpinePaths = [];
  for (const option of selectedState.options) {
    const fromStationNodeIndex = stationNodeIndexByOrdinal.get(option.gapOrdinal);
    const toStationNodeIndex = stationNodeIndexByOrdinal.get(option.gapOrdinal + 1);
    const roomNodeIndices = option.roomPlacements.map(({ roomOrdinal }) => (
      roomNodeIndexByOrdinal.get(roomOrdinal)
    ));
    if (roomNodeIndices.length === 0) {
      const binding = {
        fromIndex: fromStationNodeIndex,
        toIndex: toStationNodeIndex,
        fromLocalSocketId: option.fromLocalSocketId,
        toLocalSocketId: option.toLocalSocketId,
      };
      requiredSocketBindings.push(binding);
      externalSpinePaths.push({
        ...binding,
        path: cloneDungeonAugmentationValue(option.routePath),
      });
      continue;
    }
    const firstBinding = {
      fromIndex: fromStationNodeIndex,
      toIndex: roomNodeIndices[0],
      fromLocalSocketId: option.fromLocalSocketId,
      toLocalSocketId: 'entry',
    };
    requiredSocketBindings.push(firstBinding);
    externalSpinePaths.push({
      ...firstBinding,
      path: sliceDungeonPolylineByDistance(
        option.routePath,
        0,
        option.roomPlacements[0].entryDistanceMeters,
      ),
    });
    for (let roomIndex = 1; roomIndex < roomNodeIndices.length; roomIndex += 1) {
      const binding = {
        fromIndex: roomNodeIndices[roomIndex - 1],
        toIndex: roomNodeIndices[roomIndex],
        fromLocalSocketId: 'exit',
        toLocalSocketId: 'entry',
      };
      requiredSocketBindings.push(binding);
      externalSpinePaths.push({
        ...binding,
        path: sliceDungeonPolylineByDistance(
          option.routePath,
          option.roomPlacements[roomIndex - 1].exitDistanceMeters,
          option.roomPlacements[roomIndex].entryDistanceMeters,
        ),
      });
    }
    const finalBinding = {
      fromIndex: roomNodeIndices.at(-1),
      toIndex: toStationNodeIndex,
      fromLocalSocketId: 'exit',
      toLocalSocketId: option.toLocalSocketId,
    };
    requiredSocketBindings.push(finalBinding);
    externalSpinePaths.push({
      ...finalBinding,
      path: sliceDungeonPolylineByDistance(
        option.routePath,
        option.roomPlacements.at(-1).exitDistanceMeters,
        option.routeLengthMeters,
      ),
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
    externalSpinePaths: cloneDungeonAugmentationValue(externalSpinePaths),
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

export function ordinaryRouteNetworkSocketGapMeters(
  connectorGapMeters = ROUTE_NETWORK_SOCKET_APPROACH_METERS,
  socketApproachMeters = ROUTE_NETWORK_SOCKET_APPROACH_METERS,
) {
  // Each ordinary endpoint owns two exterior approach cells. Unlike the typed
  // coincident junction threshold, two unrelated seams may not overlap, so the
  // centerline between socket thresholds must contain both complete leads.
  return Math.max(
    Number(connectorGapMeters),
    Number(socketApproachMeters) * 2,
  );
}

export function orderCoverageRoomIndicesForArc(
  roomNodeIndices = [],
  endpointNodeIndices = [],
) {
  const rooms = [...roomNodeIndices].sort((first, second) => first - second);
  const endpoints = [...new Set(endpointNodeIndices)]
    .sort((first, second) => first - second);
  if (rooms.length < 2 || endpoints.length < 3) return rooms;
  const intervals = Array.from(
    { length: endpoints.length - 1 },
    (_, ordinal) => ({
      ordinal,
      rooms: rooms.filter((index) => (
        index > endpoints[ordinal] && index < endpoints[ordinal + 1]
      )),
    }),
  );
  const roomiestInterval = [...intervals].sort((first, second) => (
    second.rooms.length - first.rooms.length
      || first.ordinal - second.ordinal
  ))[0];
  if (!roomiestInterval || roomiestInterval.rooms.length === 0) return rooms;
  // Allocate the ordered challenge -> elevation pair to the roomiest
  // interval. The compact payoff can then occupy a constrained one-room bay.
  // Physical indices within the selected interval stay ascending because the
  // authored rise/return balancer binds riseIndex < descentIndex.
  const roomiestSet = new Set(roomiestInterval.rooms);
  return [
    ...roomiestInterval.rooms,
    ...rooms.filter((index) => !roomiestSet.has(index)),
  ];
}

export function interleavedCartesianIndexPairs(firstCount, secondCount) {
  const firstLength = Math.max(0, Math.trunc(Number(firstCount) || 0));
  const secondLength = Math.max(0, Math.trunc(Number(secondCount) || 0));
  if (firstLength === 0 || secondLength === 0) return [];
  const pairs = [];
  const seen = new Set();
  const add = (firstIndex, secondIndex) => {
    const key = `${firstIndex}:${secondIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ firstIndex, secondIndex });
  };
  // Exercise both independent family orders before the bounded solver can
  // spend its window on near-identical neighbors from one axis.
  for (let ordinal = 0; ordinal < Math.max(firstLength, secondLength); ordinal += 1) {
    add(ordinal % firstLength, ordinal % secondLength);
  }
  for (let diagonal = 0;
    diagonal < firstLength + secondLength - 1;
    diagonal += 1) {
    for (let firstIndex = 0; firstIndex < firstLength; firstIndex += 1) {
      const secondIndex = diagonal - firstIndex;
      if (secondIndex < 0 || secondIndex >= secondLength) continue;
      add(firstIndex, secondIndex);
    }
  }
  return pairs;
}

export function coverageTraversalBranchBindings({
  nodeCount = 0,
  endpointNodeIndices = [],
  traversalConnectorIndices = [],
  keepPayoffOnMainChain = false,
  preferredBranchRoomIndex = null,
  requirePreferredBranchRoom = false,
  branchRouteRole = 'route-network-payoff-branch',
} = {}) {
  const endpointSet = new Set(endpointNodeIndices);
  const traversalIndex = [...traversalConnectorIndices]
    .sort((first, second) => first - second)[0];
  if (!Number.isInteger(traversalIndex)) return null;
  const eligibleBranchRoomIndices = Array.from(
    { length: Math.max(0, Number(nodeCount)) },
    (_, index) => index,
  ).filter((index) => (
    !endpointSet.has(index)
      && index !== traversalIndex
      && index > traversalIndex
  ));
  const requestedBranchRoomIndex = preferredBranchRoomIndex == null
    ? null
    : Number(preferredBranchRoomIndex);
  if (requirePreferredBranchRoom
    && !eligibleBranchRoomIndices.includes(requestedBranchRoomIndex)) return null;
  const branchRoomIndex = keepPayoffOnMainChain
    ? null
    : eligibleBranchRoomIndices.includes(requestedBranchRoomIndex)
      ? requestedBranchRoomIndex
      : eligibleBranchRoomIndices.at(-1);
  if (!keepPayoffOnMainChain && !Number.isInteger(branchRoomIndex)) return null;
  const mainIndices = Array.from(
    { length: Math.max(0, Number(nodeCount)) },
    (_, index) => index,
  ).filter((index) => index !== branchRoomIndex);
  const mainBindings = mainIndices.slice(0, -1).map((fromIndex, ordinal) => {
    const toIndex = mainIndices[ordinal + 1];
    return {
      fromIndex,
      toIndex,
      fromLocalSocketId: endpointSet.has(fromIndex) ? null : 'exit',
      toLocalSocketId: endpointSet.has(toIndex) ? null : 'entry',
    };
  });
  return {
    traversalIndex,
    branchRoomIndex,
    bindings: [
      ...mainBindings,
      ...(!keepPayoffOnMainChain ? [{
        fromIndex: traversalIndex,
        toIndex: branchRoomIndex,
        fromLocalSocketId: 'right',
        toLocalSocketId: 'entry',
        routeRole: branchRouteRole,
      }] : []),
    ],
  };
}

export function coveragePayoffGrammarIdsForStationBay({
  grammarPool = [],
  grammars = {},
  stationSeparationMeters = Number.POSITIVE_INFINITY,
  connectorEndpointGapMeters = ordinaryRouteNetworkSocketGapMeters(),
} = {}) {
  const maximumTraversalMeters = Number(stationSeparationMeters)
    - Number(connectorEndpointGapMeters);
  const entryExitTraversalMeters = (grammar) => {
    const entry = grammar.sockets?.find(({ id }) => id === 'entry');
    const exit = grammar.sockets?.find(({ id }) => id === 'exit');
    if (!entry?.localPosition || !exit?.localPosition) {
      return Number(grammar.size?.depth ?? Number.POSITIVE_INFINITY);
    }
    return Math.abs(
      Number(exit.localPosition.x) - Number(entry.localPosition.x),
    ) + Math.abs(
      Number(exit.localPosition.z) - Number(entry.localPosition.z),
    );
  };
  return grammarPool
    .map(({ id }) => grammars[id])
    .filter((grammar) => (
      grammar
        && String(grammar.selectionConstraints?.routeNetworkModuleKind ?? '') === 'room'
        && grammar.selectionConstraints?.routeNetworkContentRoles?.includes('reward')
        && Math.abs(Number(
          grammar.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
        )) <= 1e-6
        && entryExitTraversalMeters(grammar) <= maximumTraversalMeters + 1e-6
    ))
    .map(({ id }) => String(id));
}

export function selectCoverageTraversalConnectorIndices({
  nodeCount = 0,
  endpointNodeIndices = [],
  minimumRoomCount = 2,
} = {}) {
  const normalizedNodeCount = Math.max(0, Math.trunc(Number(nodeCount) || 0));
  const endpointIndices = [...new Set(endpointNodeIndices.map(Number))]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < normalizedNodeCount)
    .sort((first, second) => first - second);
  const nonEndpointCount = normalizedNodeCount - endpointIndices.length;
  if (endpointIndices.length < 3
    || nonEndpointCount <= Math.max(0, Math.trunc(Number(minimumRoomCount) || 0))) return [];
  const constrainedBay = endpointIndices
    .slice(0, -1)
    .map((fromIndex, ordinal) => ({
      fromIndex,
      toIndex: endpointIndices[ordinal + 1],
    }))
    .find(({ fromIndex, toIndex }) => toIndex - fromIndex === 2);
  return constrainedBay ? [constrainedBay.fromIndex + 1] : [];
}

export function minimumVerticalRouteFeaturelessSpanMeters(deltaX, deltaZ) {
  // One real elevation transition resets featureless travel once. Even with an
  // ideally placed transfer, at least half of the complete planar Manhattan
  // route remains on one side of that reset. Returning min(dx,dz)—or zero for
  // a straight run—admits physically impossible 80m+ slopes into exact search.
  return (Math.abs(Number(deltaX)) + Math.abs(Number(deltaZ))) * 0.5;
}
const ROUTE_NETWORK_VERTICAL_MINIMUM_RUN_METERS = Object.freeze({
  // These are raw straight-run distances. The connector renderer reserves
  // two flat clearance cells at both ends before selecting its safe span,
  // leaving exactly 13/7/10 usable cells for slope/ladder/lift respectively.
  slope: 44.8,
  ladder: 28,
  lift: 36.4,
});

function appendDistinctRoutePoint(points, point) {
  const candidate = toDungeonPoint(point);
  if (points.length > 0) {
    const last = points.at(-1);
    const deltaX = Number(last.x) - Number(candidate.x);
    const deltaY = Number(last.y) - Number(candidate.y);
    const deltaZ = Number(last.z) - Number(candidate.z);
    if (deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ <= 1e-12) return;
  }
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
    const singleOccupiedAxis = (delta) => {
      const x = Math.abs(delta.x) > 1e-6;
      const y = Math.abs(delta.y) > 1e-6;
      const z = Math.abs(delta.z) > 1e-6;
      if (Number(x) + Number(y) + Number(z) !== 1) return null;
      return x ? 'x' : y ? 'y' : 'z';
    };
    const incomingAxis = singleOccupiedAxis(incoming);
    const outgoingAxis = singleOccupiedAxis(outgoing);
    if (incomingAxis
      && incomingAxis === outgoingAxis
      && incoming[incomingAxis] * outgoing[outgoingAxis] > 0) {
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

// Planning must use the same station-reset rule as finalized physical
// validation. A connector blueprint is not a reset by name alone; it becomes
// one only when its committed topology is guaranteed to expose three arms.
export function routeNetworkNodeResetsFeaturelessDistance(node) {
  return !node?.connectorOwned
    || Number(node.plannedMinimumGraphDegree ?? 0) >= 3;
}

export function closestPlacementCandidatesPerFacing(validCandidates = [], target = {}) {
  const candidatesByFacing = new Map();
  for (const candidate of validCandidates) {
    const key = `${Number(candidate.facing?.x ?? 0).toFixed(0)}:${Number(
      candidate.facing?.z ?? 0,
    ).toFixed(0)}`;
    const existing = candidatesByFacing.get(key);
    const distance = Math.hypot(
      Number(candidate.center?.x) - Number(target.x),
      Number(candidate.center?.z) - Number(target.z),
    );
    const existingDistance = existing ? Math.hypot(
      Number(existing.center?.x) - Number(target.x),
      Number(existing.center?.z) - Number(target.z),
    ) : Number.POSITIVE_INFINITY;
    if (!existing
      || distance < existingDistance - 1e-6
      || (Math.abs(distance - existingDistance) <= 1e-6
        && Number(candidate.displacement ?? 0) < Number(existing.displacement ?? 0))) {
      candidatesByFacing.set(key, candidate);
    }
  }
  return [...candidatesByFacing.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([, candidate]) => candidate);
}

export function closestPlacementCandidate(validCandidates = [], target = {}) {
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of validCandidates) {
    const distance = Math.hypot(
      Number(candidate.center?.x) - Number(target.x),
      Number(candidate.center?.z) - Number(target.z),
    );
    const displacement = Number(candidate.displacement ?? 0);
    const closestDisplacement = Number(closest?.displacement ?? 0);
    if (!closest
      || distance < closestDistance - 1e-12
      || (Math.abs(distance - closestDistance) <= 1e-12
        && displacement < closestDisplacement)) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closest;
}

export function mergeReservedPlacementCandidates(
  currentCandidates = [],
  reservedCandidates = [],
  limit = currentCandidates.length,
) {
  const boundedLimit = Math.max(0, Math.trunc(Number(limit) || 0));
  const merged = [];
  const seen = new Set();
  for (const candidate of [...reservedCandidates, ...currentCandidates]) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    merged.push(candidate);
    if (merged.length >= boundedLimit) break;
  }
  return merged;
}

export function shouldAttemptCorrelatedPlacementRepair({
  orderedEdges = [],
  failedFirstIndex = null,
  failedSecondIndex = null,
  alreadyAttempted = false,
} = {}) {
  if (alreadyAttempted
    || failedFirstIndex == null
    || failedSecondIndex == null
    || !Number.isSafeInteger(Number(failedFirstIndex))
    || !Number.isSafeInteger(Number(failedSecondIndex))) return false;
  const normalizedEdges = orderedEdges.map(({ fromIndex, toIndex }) => ({
    fromIndex: Number(fromIndex),
    toIndex: Number(toIndex),
  }));
  const participatingNodeIndices = new Set(normalizedEdges.flatMap(({ fromIndex, toIndex }) => [
    fromIndex,
    toIndex,
  ]));
  // A tree can exhaust on a non-edge pair when a locally valid branch room
  // consumes another endpoint's reserved parent approach. That is still a
  // correlated placement failure and must be repaired from the complete
  // candidate pools, not reported as if the branch had no legal geometry.
  return normalizedEdges.length > 0
    && participatingNodeIndices.has(Number(failedFirstIndex))
    && participatingNodeIndices.has(Number(failedSecondIndex));
}

export function orientOrderedCandidateChainAtFailure(
  orderedEdges = [],
  failedFirstIndex = null,
  failedSecondIndex = null,
) {
  const normalizedEdges = orderedEdges.map(({ fromIndex, toIndex }) => ({
    fromIndex: Number(fromIndex),
    toIndex: Number(toIndex),
  }));
  const failedEdgeOrdinal = normalizedEdges.findIndex(({ fromIndex, toIndex }) => (
    (fromIndex === Number(failedFirstIndex) && toIndex === Number(failedSecondIndex))
      || (fromIndex === Number(failedSecondIndex) && toIndex === Number(failedFirstIndex))
  ));
  if (failedEdgeOrdinal < 0 || failedEdgeOrdinal < normalizedEdges.length * 0.5) {
    return normalizedEdges;
  }
  return normalizedEdges.reverse().map(({ fromIndex, toIndex }) => ({
    fromIndex: toIndex,
    toIndex: fromIndex,
  }));
}

export function orientOrderedCandidateTreeAtFailure(
  orderedEdges = [],
  failedFirstIndex = null,
  failedSecondIndex = null,
) {
  const normalizedEdges = orderedEdges.map(({ fromIndex, toIndex }) => ({
    fromIndex: Number(fromIndex),
    toIndex: Number(toIndex),
  }));
  if (normalizedEdges.length === 0) return [];
  const adjacency = new Map();
  const append = (fromIndex, toIndex, edgeOrdinal) => {
    const records = adjacency.get(fromIndex) ?? [];
    records.push({ toIndex, edgeOrdinal });
    adjacency.set(fromIndex, records);
  };
  normalizedEdges.forEach(({ fromIndex, toIndex }, edgeOrdinal) => {
    append(fromIndex, toIndex, edgeOrdinal);
    append(toIndex, fromIndex, edgeOrdinal);
  });
  const requestedRoot = Number(failedSecondIndex);
  const rootIndex = adjacency.has(requestedRoot)
    ? requestedRoot
    : normalizedEdges[0].fromIndex;
  const result = [];
  const visited = new Set([rootIndex]);
  const visit = (fromIndex) => {
    const neighbors = [...(adjacency.get(fromIndex) ?? [])]
      .sort((first, second) => first.edgeOrdinal - second.edgeOrdinal
        || first.toIndex - second.toIndex);
    for (const { toIndex } of neighbors) {
      if (visited.has(toIndex)) continue;
      visited.add(toIndex);
      result.push({ fromIndex, toIndex });
      visit(toIndex);
    }
  };
  visit(rootIndex);
  return result.length === normalizedEdges.length ? result : normalizedEdges;
}

export function reserveOrderedCandidateTree({
  candidateGroups = [],
  orderedEdges = [],
  pairIsCompatible,
  pairCompatibilityIsKnown = () => false,
  pairClearsAssignedCandidates = () => true,
  pairPassesCheapBounds = () => true,
  prefixIsCompatible = () => true,
  prefilterEdgeCandidates = (candidates) => candidates,
  candidateKey = (candidate) => candidate,
  maxPairEvaluations = 256,
  maxCheapPairEvaluations = 32768,
  candidateWindowSize = 128,
  maximumLayerCandidates = 96,
} = {}) {
  const exactEvaluationLimit = Math.max(0, Math.trunc(Number(maxPairEvaluations) || 0));
  const cheapEvaluationLimit = Math.max(
    0,
    Math.trunc(Number(maxCheapPairEvaluations) || 0),
  );
  const boundedCandidateWindowSize = Math.max(
    1,
    Math.trunc(Number(candidateWindowSize) || 0),
  );
  const boundedMaximumLayerCandidates = Math.max(
    1,
    Math.trunc(Number(maximumLayerCandidates) || 0),
  );
  const groupByIndex = new Map(candidateGroups.map((group) => [Number(group.index), group]));
  const normalizedEdges = orderedEdges.map(({ fromIndex, toIndex }) => ({
    fromIndex: Number(fromIndex),
    toIndex: Number(toIndex),
  }));
  const rootIndex = normalizedEdges[0]?.fromIndex;
  const introduced = new Set(Number.isSafeInteger(rootIndex) ? [rootIndex] : []);
  const isOrderedTree = normalizedEdges.length > 0
    && normalizedEdges.every(({ fromIndex, toIndex }) => {
      if (!introduced.has(fromIndex) || introduced.has(toIndex)
        || !groupByIndex.has(fromIndex) || !groupByIndex.has(toIndex)) return false;
      introduced.add(toIndex);
      return true;
    })
    && introduced.size === normalizedEdges.length + 1
    && typeof pairIsCompatible === 'function';
  if (!isOrderedTree) {
    return {
      status: 'unsupported-tree',
      pairEvaluations: 0,
      exactPairEvaluations: 0,
      cheapPairEvaluations: 0,
      cheapPairCount: 0,
      prunedCandidateCount: 0,
      reservedByIndex: new Map(),
    };
  }
  const completePoolByIndex = new Map(candidateGroups.map((group) => {
    const seen = new Set();
    const candidates = [];
    for (const candidate of [...(group.candidates ?? []), ...(group.candidatePool ?? [])]) {
      if (!candidate) continue;
      const key = candidateKey(candidate, Number(group.index));
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
    return [Number(group.index), candidates];
  }));
  const rootCandidates = completePoolByIndex.get(rootIndex) ?? [];
  let prefixes = rootCandidates
    .slice(0, boundedMaximumLayerCandidates)
    .map((candidate) => new Map([[rootIndex, candidate]]));
  let cheapPairEvaluations = 0;
  let cheapPairCount = 0;
  let cheapBudgetExhausted = false;
  for (let edgeOrdinal = 0; edgeOrdinal < normalizedEdges.length; edgeOrdinal += 1) {
    const { fromIndex, toIndex } = normalizedEdges[edgeOrdinal];
    const nextPrefixes = [];
    const supportQuota = Math.max(
      1,
      Math.ceil(boundedCandidateWindowSize / Math.max(1, prefixes.length)),
    );
    for (const prefix of prefixes) {
      const fromCandidate = prefix.get(fromIndex);
      if (!fromCandidate) continue;
      const candidates = prefilterEdgeCandidates(
        completePoolByIndex.get(toIndex) ?? [],
        fromCandidate,
        fromIndex,
        toIndex,
        edgeOrdinal,
      ) ?? [];
      let retainedForPrefix = 0;
      for (const toCandidate of candidates) {
        let cheapClear = true;
        for (const [assignedIndex, assignedCandidate] of prefix) {
          if (cheapPairEvaluations >= cheapEvaluationLimit) {
            cheapBudgetExhausted = true;
            cheapClear = false;
            break;
          }
          cheapPairEvaluations += 1;
          if (!pairPassesCheapBounds(
            assignedCandidate,
            assignedIndex,
            toCandidate,
            toIndex,
          )) {
            cheapClear = false;
            break;
          }
        }
        if (cheapBudgetExhausted) break;
        if (!cheapClear || !pairClearsAssignedCandidates(
          fromCandidate,
          fromIndex,
          toCandidate,
          toIndex,
          prefix,
        )) continue;
        const extended = new Map(prefix);
        extended.set(toIndex, toCandidate);
        if (!prefixIsCompatible(extended)) continue;
        nextPrefixes.push(extended);
        cheapPairCount += 1;
        retainedForPrefix += 1;
        if (retainedForPrefix >= supportQuota
          || nextPrefixes.length >= boundedCandidateWindowSize) break;
      }
      if (cheapBudgetExhausted || nextPrefixes.length >= boundedCandidateWindowSize) break;
    }
    prefixes = nextPrefixes.slice(0, boundedMaximumLayerCandidates);
    if (cheapBudgetExhausted || prefixes.length === 0) break;
  }
  const orderedNodeIndices = [rootIndex, ...normalizedEdges.map(({ toIndex }) => toIndex)];
  const prunedCandidateCount = orderedNodeIndices.reduce((count, index) => (
    count + Math.max(
      0,
      Number(completePoolByIndex.get(index)?.length ?? 0)
        - Number(new Set(prefixes.map((prefix) => prefix.get(index)).filter(Boolean)).size),
    )
  ), 0);
  if (cheapBudgetExhausted || prefixes.length === 0) {
    return {
      status: cheapBudgetExhausted ? 'cheap-budget-exhausted' : 'not-found',
      pairEvaluations: 0,
      exactPairEvaluations: 0,
      cheapPairEvaluations,
      cheapPairCount,
      prunedCandidateCount,
      reservedByIndex: new Map(),
    };
  }
  let exactPairEvaluations = 0;
  let exactBudgetExhausted = false;
  for (const prefix of prefixes) {
    let exactClear = true;
    for (const { fromIndex, toIndex } of normalizedEdges) {
      const fromCandidate = prefix.get(fromIndex);
      const toCandidate = prefix.get(toIndex);
      if (!pairCompatibilityIsKnown(
        fromCandidate,
        fromIndex,
        toCandidate,
        toIndex,
      )) {
        if (exactPairEvaluations >= exactEvaluationLimit) {
          exactBudgetExhausted = true;
          exactClear = false;
          break;
        }
        exactPairEvaluations += 1;
      }
      if (!pairIsCompatible(fromCandidate, fromIndex, toCandidate, toIndex)) {
        exactClear = false;
        break;
      }
    }
    if (exactClear) {
      return {
        status: 'reserved',
        pairEvaluations: exactPairEvaluations,
        exactPairEvaluations,
        cheapPairEvaluations,
        cheapPairCount,
        prunedCandidateCount,
        reservedByIndex: new Map(prefix),
      };
    }
    if (exactBudgetExhausted) break;
  }
  return {
    status: exactBudgetExhausted ? 'exact-budget-exhausted' : 'not-found',
    pairEvaluations: exactPairEvaluations,
    exactPairEvaluations,
    cheapPairEvaluations,
    cheapPairCount,
    prunedCandidateCount,
    reservedByIndex: new Map(),
  };
}

export function reserveOrderedCandidateChain({
  candidateGroups = [],
  orderedEdges = [],
  pairIsCompatible,
  pairCompatibilityIsKnown = () => false,
  pairClearsAssignedCandidates = () => true,
  pairPassesCheapBounds = () => true,
  prefixIsCompatible = () => true,
  prefilterEdgeCandidates = (candidates) => candidates,
  compareEdgeCandidates = () => 0,
  candidateKey = (candidate) => candidate,
  maxPairEvaluations = 256,
  maxCheapPairEvaluations = 32768,
  candidateWindowSize = 128,
  maximumLayerCandidates = 96,
} = {}) {
  const exactEvaluationLimit = Math.max(
    0,
    Math.trunc(Number(maxPairEvaluations) || 0),
  );
  const cheapEvaluationLimit = Math.max(
    0,
    Math.trunc(Number(maxCheapPairEvaluations) || 0),
  );
  const boundedCandidateWindowSize = Math.max(
    1,
    Math.trunc(Number(candidateWindowSize) || 0),
  );
  const boundedMaximumLayerCandidates = Math.max(
    1,
    Math.trunc(Number(maximumLayerCandidates) || 0),
  );
  const groupByIndex = new Map(candidateGroups.map((group) => [
    Number(group.index),
    group,
  ]));
  const normalizedEdges = orderedEdges.map(({ fromIndex, toIndex }) => ({
    fromIndex: Number(fromIndex),
    toIndex: Number(toIndex),
  }));
  const chainNodeIndices = normalizedEdges.length > 0
    ? [
      normalizedEdges[0].fromIndex,
      ...normalizedEdges.map(({ toIndex }) => toIndex),
    ]
    : [];
  const isSimpleDirectedChain = normalizedEdges.length > 0
    && normalizedEdges.every((edge, edgeOrdinal) => (
      edgeOrdinal === 0
        || edge.fromIndex === normalizedEdges[edgeOrdinal - 1].toIndex
    ))
    && new Set(chainNodeIndices).size === chainNodeIndices.length
    && chainNodeIndices.every((index) => groupByIndex.has(index));
  if (!isSimpleDirectedChain || typeof pairIsCompatible !== 'function') {
    return {
      status: 'unsupported-chain',
      pairEvaluations: 0,
      exactPairEvaluations: 0,
      cheapPairEvaluations: 0,
      cheapPairCount: 0,
      prunedCandidateCount: 0,
      reservedByIndex: new Map(),
    };
  }

  const completePoolByIndex = new Map(candidateGroups.map((group) => {
    const seen = new Set();
    const candidates = [];
    for (const candidate of [
      ...(group.candidates ?? []),
      ...(group.candidatePool ?? []),
    ]) {
      if (!candidate) continue;
      const key = candidateKey(candidate, Number(group.index));
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
    return [Number(group.index), candidates];
  }));
  const firstGroup = groupByIndex.get(chainNodeIndices[0]);
  const firstCandidates = firstGroup.candidates ?? [];
  const completePoolOrdinalByIndex = new Map([...completePoolByIndex].map(([
    index,
    candidates,
  ]) => [index, new Map(candidates.map((candidate, ordinal) => [candidate, ordinal]))]));
  const edgeCandidateGraph = [];
  let reachableCandidates = [...firstCandidates];
  let reachablePrefixesByCandidate = new Map(firstCandidates.map((candidate) => [
    candidate,
    [new Map([[chainNodeIndices[0], candidate]])],
  ]));
  let cheapPairEvaluations = 0;
  let cheapPairCount = 0;
  let cheapBudgetExhausted = false;

  for (let edgeOrdinal = 0; edgeOrdinal < normalizedEdges.length; edgeOrdinal += 1) {
    const { fromIndex, toIndex } = normalizedEdges[edgeOrdinal];
    const toGroup = groupByIndex.get(toIndex);
    const boundedCandidates = new Set(toGroup.candidates ?? []);
    const completeToPool = completePoolByIndex.get(toIndex) ?? [];
    const supportsByFromCandidate = new Map();
    const supportCountByToCandidate = new Map();
    const prefixesByToCandidate = new Map();
    let retainedLayerSupportCount = 0;
    for (let fromOrdinal = 0; fromOrdinal < reachableCandidates.length; fromOrdinal += 1) {
      const fromCandidate = reachableCandidates[fromOrdinal];
      const remainingFromCount = reachableCandidates.length - fromOrdinal;
      const remainingLayerSupportSlots = Math.max(
        0,
        boundedCandidateWindowSize - retainedLayerSupportCount,
      );
      const supportQuota = Math.max(
        1,
        Math.ceil(remainingLayerSupportSlots / remainingFromCount),
      );
      const supports = [];
      // Filter before ranking. Sorting the complete 2,500-candidate pool for
      // every predecessor was both unbounded by the cheap-evaluation budget
      // and could discard the only seam-valid continuation outside the first
      // distance-ranked window. The pool is already deterministic with the
      // bounded domain first, so scan it once, retain only legal supports, and
      // rank that much smaller set afterwards.
      const prefilteredToPool = prefilterEdgeCandidates(
        completeToPool,
        fromCandidate,
        fromIndex,
        toIndex,
        edgeOrdinal,
      ) ?? [];
      // The complete pool already carries the bounded domain first. A caller
      // may return a stricter deterministic order (for example, cached exact
      // witnesses before unknown pairs), which must remain authoritative here
      // or the only correlated continuation can be hidden behind the quota.
      const scanOrder = [...prefilteredToPool];
      for (const toCandidate of scanOrder) {
        if (cheapPairEvaluations >= cheapEvaluationLimit) {
          cheapBudgetExhausted = true;
          break;
        }
        cheapPairEvaluations += 1;
        if (!pairPassesCheapBounds(
          fromCandidate,
          fromIndex,
          toCandidate,
          toIndex,
        )) continue;
        const extendingPrefixes = [];
        for (const prefix of reachablePrefixesByCandidate.get(fromCandidate) ?? []) {
          let prefixCompatible = true;
          for (const [assignedIndex, assignedCandidate] of prefix) {
            if (assignedIndex === fromIndex) continue;
            if (cheapPairEvaluations >= cheapEvaluationLimit) {
              cheapBudgetExhausted = true;
              prefixCompatible = false;
              break;
            }
            cheapPairEvaluations += 1;
            if (!pairPassesCheapBounds(
              assignedCandidate,
              assignedIndex,
              toCandidate,
              toIndex,
            )) {
              prefixCompatible = false;
              break;
            }
          }
          if (cheapBudgetExhausted) break;
          if (!prefixCompatible || !pairClearsAssignedCandidates(
            fromCandidate,
            fromIndex,
            toCandidate,
            toIndex,
            prefix,
          )) continue;
          const extendedPrefix = new Map(prefix);
          extendedPrefix.set(toIndex, toCandidate);
          if (!prefixIsCompatible(extendedPrefix)) continue;
          extendingPrefixes.push(extendedPrefix);
          // Two deterministic prefixes preserve an alternate predecessor
          // without turning the 32-node beam back into a Cartesian search.
          if (extendingPrefixes.length >= 2) break;
        }
        if (cheapBudgetExhausted) break;
        if (extendingPrefixes.length === 0) continue;
        cheapPairCount += 1;
        supports.push(toCandidate);
        const knownPrefixes = prefixesByToCandidate.get(toCandidate) ?? [];
        prefixesByToCandidate.set(
          toCandidate,
          [...knownPrefixes, ...extendingPrefixes].slice(0, 2),
        );
        supportCountByToCandidate.set(
          toCandidate,
          Number(supportCountByToCandidate.get(toCandidate) ?? 0) + 1,
        );
        if (supports.length >= supportQuota) break;
      }
      supports.sort((first, second) => (
        Number(compareEdgeCandidates(
          first,
          second,
          fromCandidate,
          fromIndex,
          toIndex,
          edgeOrdinal,
        ) ?? 0)
          || (completePoolOrdinalByIndex.get(toIndex)?.get(first) ?? 0)
            - (completePoolOrdinalByIndex.get(toIndex)?.get(second) ?? 0)
      ));
      supportsByFromCandidate.set(
        fromCandidate,
        supports.slice(0, supportQuota),
      );
      retainedLayerSupportCount += Math.min(supports.length, supportQuota);
      if (cheapBudgetExhausted) break;
    }
    if (cheapBudgetExhausted) break;
    const reachableToCandidates = [...supportCountByToCandidate]
      .sort(([first, firstSupportCount], [second, secondSupportCount]) => (
        Number(!boundedCandidates.has(first)) - Number(!boundedCandidates.has(second))
          || secondSupportCount - firstSupportCount
          || (completePoolOrdinalByIndex.get(toIndex)?.get(first) ?? 0)
            - (completePoolOrdinalByIndex.get(toIndex)?.get(second) ?? 0)
      ))
      .slice(0, boundedMaximumLayerCandidates)
      .map(([candidate]) => candidate);
    const reachableToCandidateSet = new Set(reachableToCandidates);
    for (const [fromCandidate, supports] of supportsByFromCandidate) {
      supportsByFromCandidate.set(
        fromCandidate,
        supports.filter((candidate) => reachableToCandidateSet.has(candidate)),
      );
    }
    edgeCandidateGraph.push({
      fromIndex,
      toIndex,
      supportsByFromCandidate,
    });
    reachableCandidates = reachableToCandidates;
    reachablePrefixesByCandidate = new Map(reachableToCandidates.map((candidate) => [
      candidate,
      prefixesByToCandidate.get(candidate) ?? [],
    ]));
    if (reachableCandidates.length === 0) break;
  }

  if (cheapBudgetExhausted || edgeCandidateGraph.length !== normalizedEdges.length
    || reachableCandidates.length === 0) {
    return {
      status: cheapBudgetExhausted ? 'cheap-budget-exhausted' : 'not-found',
      pairEvaluations: 0,
      exactPairEvaluations: 0,
      cheapPairEvaluations,
      cheapPairCount,
      prunedCandidateCount: 0,
      reservedByIndex: new Map(),
    };
  }

  const viableCandidatesByIndex = new Map([[
    chainNodeIndices.at(-1),
    new Set(reachableCandidates),
  ]]);
  for (let edgeOrdinal = edgeCandidateGraph.length - 1; edgeOrdinal >= 0; edgeOrdinal -= 1) {
    const { fromIndex, toIndex, supportsByFromCandidate } = edgeCandidateGraph[edgeOrdinal];
    const viableToCandidates = viableCandidatesByIndex.get(toIndex) ?? new Set();
    const viableFromCandidates = new Set();
    for (const [fromCandidate, supports] of supportsByFromCandidate) {
      const viableSupports = supports.filter((candidate) => viableToCandidates.has(candidate));
      supportsByFromCandidate.set(fromCandidate, viableSupports);
      if (viableSupports.length > 0) viableFromCandidates.add(fromCandidate);
    }
    viableCandidatesByIndex.set(fromIndex, viableFromCandidates);
  }
  const prunedCandidateCount = chainNodeIndices.reduce((count, index) => (
    count + Math.max(
      0,
      Number(completePoolByIndex.get(index)?.length ?? 0)
        - Number(viableCandidatesByIndex.get(index)?.size ?? 0),
    )
  ), 0);
  if ((viableCandidatesByIndex.get(chainNodeIndices[0])?.size ?? 0) === 0) {
    return {
      status: 'not-found',
      pairEvaluations: 0,
      exactPairEvaluations: 0,
      cheapPairEvaluations,
      cheapPairCount,
      prunedCandidateCount,
      reservedByIndex: new Map(),
    };
  }

  const selectedByIndex = new Map();
  let exactPairEvaluations = 0;
  let exactBudgetExhausted = false;

  const visitEdge = (edgeOrdinal) => {
    if (edgeOrdinal >= normalizedEdges.length) return true;
    const { fromIndex, toIndex } = normalizedEdges[edgeOrdinal];
    const fromCandidate = selectedByIndex.get(fromIndex);
    if (!fromCandidate) return false;
    const graphEdge = edgeCandidateGraph[edgeOrdinal];
    const viableToCandidates = viableCandidatesByIndex.get(toIndex) ?? new Set();
    const candidates = (graphEdge.supportsByFromCandidate.get(fromCandidate) ?? [])
      .filter((candidate) => viableToCandidates.has(candidate));
    const nonEdgeAssignedEntries = [...selectedByIndex.entries()]
      .filter(([index]) => index !== fromIndex);
    for (const candidate of candidates) {
      if (!nonEdgeAssignedEntries.every(([assignedIndex, assignedCandidate]) => (
        pairPassesCheapBounds(
          assignedCandidate,
          assignedIndex,
          candidate,
          toIndex,
        )
      ))) continue;
      if (!pairClearsAssignedCandidates(
        fromCandidate,
        fromIndex,
        candidate,
        toIndex,
        selectedByIndex,
      )) continue;
      const compatibilityIsKnown = pairCompatibilityIsKnown(
        fromCandidate,
        fromIndex,
        candidate,
        toIndex,
      );
      if (!compatibilityIsKnown) {
        if (exactPairEvaluations >= exactEvaluationLimit) {
          exactBudgetExhausted = true;
          return false;
        }
        exactPairEvaluations += 1;
      }
      if (!pairIsCompatible(
        fromCandidate,
        fromIndex,
        candidate,
        toIndex,
      )) continue;
      selectedByIndex.set(toIndex, candidate);
      if (!prefixIsCompatible(selectedByIndex)) {
        selectedByIndex.delete(toIndex);
        continue;
      }
      if (visitEdge(edgeOrdinal + 1)) return true;
      selectedByIndex.delete(toIndex);
      if (exactBudgetExhausted) return false;
    }
    return false;
  };

  for (const candidate of firstCandidates) {
    if (!viableCandidatesByIndex.get(chainNodeIndices[0])?.has(candidate)) continue;
    selectedByIndex.set(chainNodeIndices[0], candidate);
    if (visitEdge(0)) {
      return {
        status: 'reserved',
        pairEvaluations: exactPairEvaluations,
        exactPairEvaluations,
        cheapPairEvaluations,
        cheapPairCount,
        prunedCandidateCount,
        reservedByIndex: new Map(selectedByIndex),
      };
    }
    selectedByIndex.clear();
    if (exactBudgetExhausted) break;
  }
  return {
    status: exactBudgetExhausted ? 'exact-budget-exhausted' : 'not-found',
    pairEvaluations: exactPairEvaluations,
    exactPairEvaluations,
    cheapPairEvaluations,
    cheapPairCount,
    prunedCandidateCount,
    reservedByIndex: new Map(),
  };
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
    // A level connector has no meaningful station between its endpoint
    // modules, so a planar run longer than the featureless contract can never
    // become legal. A vertical connector has exactly one real transition and
    // can reset the counter once; more than twice the limit is likewise
    // impossible regardless of which legal transfer tile is selected. Prune
    // those shapes before expanding transfer placements and self-overlap
    // witnesses—the same-facing U family otherwise manufactures hundreds of
    // provably unusable candidates for every socket pair.
    const planarLengthMeters = measureDungeonPolyline(planarPath);
    const changesElevation = Math.abs(Number(end.y) - Number(start.y)) > 1e-6;
    if ((!changesElevation
        && planarLengthMeters > ROUTE_NETWORK_MAXIMUM_FEATURELESS_SPAN_METERS + 1e-6)
      || (changesElevation
        && planarLengthMeters
          > ROUTE_NETWORK_MAXIMUM_FEATURELESS_SPAN_METERS * 2 + 1e-6)) return;
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
  // This predicate sits on the innermost placement/route loops. Avoiding an
  // axis array, callback, and temporary closure matters here: a dense V4
  // coverage solve evaluates the same primitive millions of times before its
  // higher-level pair caches can answer. Keep the exact strict-overlap
  // semantics (including the 1e-6 separating tolerance) while short-circuiting
  // the most selective planning axes first.
  if (Math.abs(Number(first.center.x) - Number(second.center.x))
    >= (Number(first.size.x) + Number(second.size.x)) * 0.5 - 1e-6) return false;
  if (Math.abs(Number(first.center.z) - Number(second.center.z))
    >= (Number(first.size.z) + Number(second.size.z)) * 0.5 - 1e-6) return false;
  return Math.abs(Number(first.center.y) - Number(second.center.y))
    < (Number(first.size.y) + Number(second.size.y)) * 0.5 - 1e-6;
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

export function routeNetworkPlanningOverlapIsGranted(first, second, overlapGrants = []) {
  if (overlapGrants.length === 0) return false;
  const applicableGrants = overlapGrants.filter((grant) => (
    !grant?.parentOwnerId || [first, second].some((volume) => (
      [volume?.ownerId, volume?.logicalConnectionId, volume?.physicalConnectionId]
        .some((ownerId) => String(ownerId ?? '') === String(grant.parentOwnerId))
        || String(volume?.id ?? '') === String(grant.parentOwnerId)
        || String(volume?.id ?? '').startsWith(`${String(grant.parentOwnerId)}:`)
        // Base-draft normalization intentionally strips auxiliary provenance
        // fields, but the immutable projected-column ID still carries the
        // exact physical connection owner. Recognize only that exact prefix;
        // the overlap must still fit wholly inside the endpoint seam below.
        || String(volume?.id ?? '').startsWith(
          `base:connection:${String(grant.parentOwnerId)}:`,
        )
    ))
  ));
  return dungeonVolumeOverlapWithinGrants(first, second, applicableGrants);
}

const planningOverlapIsGranted = routeNetworkPlanningOverlapIsGranted;

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
  let score = 0;
  for (const volume of volumes) {
    for (const obstacle of avoidanceVolumes) {
      if (planningVolumesOverlap(volume, obstacle)) score += 1;
    }
  }
  return score;
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

function routeEndpointPlanningLandingVolume(endpoint, point, landingDepthMeters = 5.6) {
  const widthMeters = ROUTE_NETWORK_CORRIDOR_WIDTH_METERS;
  const facing = toDungeonFacing(endpoint?.facing);
  const horizontal = Math.abs(facing.x) > Math.abs(facing.z);
  return {
    center: {
      x: Number(point.x),
      y: Number(point.y) + 1.4,
      z: Number(point.z),
    },
    size: {
      x: horizontal ? Number(landingDepthMeters) : widthMeters,
      y: 2.8,
      z: horizontal ? widthMeters : Number(landingDepthMeters),
    },
    purpose: 'supplement-connector-landing-clearance',
  };
}

/**
 * Mirrors the complete V4 volume set emitted by createSegment. Candidate
 * selection must reserve the two endpoint landings as well as the path body;
 * otherwise a route can pass the early solve and fail only after serialization.
 */
function routeSegmentPlanningCollisionVolumes(
  path,
  from,
  to,
  heightMeters = 5.6,
  landingDepthMeters = 5.6,
) {
  if (!Array.isArray(path) || path.length < 2) return [];
  return [
    ...routePathPlanningVolumes(path, heightMeters),
    routeEndpointPlanningLandingVolume(from, path[0], landingDepthMeters),
    routeEndpointPlanningLandingVolume(to, path.at(-1), landingDepthMeters),
  ];
}

function pathPlanningCollisionScore(
  path,
  avoidanceVolumes,
  heightMeters = 5.6,
  overlapGrants = [],
) {
  return planningRouteVolumesCollisionScore(
    routePathPlanningVolumes(path, heightMeters),
    avoidanceVolumes,
    overlapGrants,
  );
}

function planningRouteVolumesCollisionScore(
  pathVolumes,
  avoidanceVolumes,
  overlapGrants = [],
) {
  let score = 0;
  const hasOverlapGrants = overlapGrants.length > 0;
  for (const volume of pathVolumes) {
    for (const obstacle of avoidanceVolumes) {
      if (!planningVolumesOverlap(volume, obstacle)) continue;
      if (!hasOverlapGrants || !planningOverlapIsGranted(
        volume,
        obstacle,
        overlapGrants,
      )) score += 1;
    }
  }
  return score;
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

function planningVolumeIntersection(first, second) {
  if (!first?.center || !first?.size || !second?.center || !second?.size) return null;
  const minimum = {};
  const maximum = {};
  for (const axis of ['x', 'y', 'z']) {
    minimum[axis] = Math.max(
      Number(first.center[axis]) - Number(first.size[axis]) * 0.5,
      Number(second.center[axis]) - Number(second.size[axis]) * 0.5,
    );
    maximum[axis] = Math.min(
      Number(first.center[axis]) + Number(first.size[axis]) * 0.5,
      Number(second.center[axis]) + Number(second.size[axis]) * 0.5,
    );
    if (maximum[axis] <= minimum[axis] + 1e-6) return null;
  }
  return {
    center: Object.fromEntries(['x', 'y', 'z'].map((axis) => (
      [axis, (minimum[axis] + maximum[axis]) * 0.5]
    ))),
    size: Object.fromEntries(['x', 'y', 'z'].map((axis) => (
      [axis, maximum[axis] - minimum[axis]]
    ))),
    purpose: 'route-network-shared-endpoint-seam-intersection',
  };
}

function routePathExteriorSocketApproachDiagnostic(
  path,
  socket,
  reverse = false,
  endpointSeam = null,
) {
  if (!Array.isArray(path) || path.length < 2 || !socket?.position || !socket?.facing) {
    return {
      accepted: false,
      code: 'route-network-seam-exterior-lead-mismatch',
      reason: 'missing-path-or-socket-transform',
    };
  }
  const facing = toDungeonCardinalFacing(socket.facing);
  const ordered = reverse ? [...path].reverse() : path;
  if (dungeonPointDistance(ordered[0], socket.position) > 1e-4) {
    return {
      accepted: false,
      code: 'route-network-seam-exterior-lead-mismatch',
      reason: 'path-does-not-start-at-socket',
      expectedStart: cloneDungeonAugmentationValue(socket.position),
      actualStart: cloneDungeonAugmentationValue(ordered[0]),
    };
  }
  const expectedOutsideCells = (endpointSeam?.orderedCells ?? [])
    .filter(({ lane, signedDepthTiles }) => (
      Number(lane) === 0 && [1, 2].includes(Number(signedDepthTiles))
    ))
    .sort((first, second) => Number(first.signedDepthTiles) - Number(second.signedDepthTiles));
  if (endpointSeam) {
    const latticeInspection = inspectDungeonRouteEndpointSeamGridLattice(endpointSeam);
    if (!latticeInspection.accepted) {
      return {
        accepted: false,
        code: DUNGEON_ROUTE_ENDPOINT_SEAM_GRID_LATTICE_DIAGNOSTIC,
        ...latticeInspection,
      };
    }
  }
  if (endpointSeam && expectedOutsideCells.length !== 2) {
    return {
      accepted: false,
      code: 'route-network-seam-exterior-lead-mismatch',
      reason: 'seam-missing-two-center-lane-exterior-cells',
      seamId: endpointSeam.id ?? null,
      exteriorCellCount: expectedOutsideCells.length,
    };
  }
  let distanceMeters = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const start = ordered[index - 1];
    const end = ordered[index];
    const deltaX = Number(end.x) - Number(start.x);
    const deltaY = Number(end.y) - Number(start.y);
    const deltaZ = Number(end.z) - Number(start.z);
    const horizontalLength = Math.hypot(deltaX, deltaZ);
    if (Math.abs(deltaY) > 1e-6 || horizontalLength <= 1e-6) {
      return {
        accepted: false,
        code: 'route-network-seam-exterior-lead-mismatch',
        reason: 'non-flat-or-degenerate-exterior-lead',
        seamId: endpointSeam?.id ?? null,
      };
    }
    const projection = deltaX * facing.x + deltaZ * facing.z;
    const lateral = Math.abs(deltaX * facing.z - deltaZ * facing.x);
    if (projection <= 1e-6 || lateral > 1e-6 * Math.max(1, horizontalLength)) {
      return {
        accepted: false,
        code: 'route-network-seam-exterior-lead-mismatch',
        reason: projection <= 1e-6 ? 'lead-reverses-into-endpoint' : 'lead-turns-before-two-cells',
        seamId: endpointSeam?.id ?? null,
      };
    }
    distanceMeters += horizontalLength;
    if (distanceMeters >= ROUTE_NETWORK_SOCKET_APPROACH_METERS - 1e-6) {
      const expectedPositions = expectedOutsideCells.map(({ position }) => position);
      const exactCellIdentity = expectedPositions.every((position, cellIndex) => {
        const expectedDistance = (cellIndex + 1) * Number(endpointSeam?.tileSize ?? 2.8);
        return Math.abs(Number(position.x) - (
          Number(socket.position.x) + facing.x * expectedDistance
        )) <= 1e-4 && Math.abs(Number(position.z) - (
          Number(socket.position.z) + facing.z * expectedDistance
        )) <= 1e-4 && Math.abs(Number(position.y) - Number(socket.position.y)) <= 1e-4;
      });
      if (endpointSeam && !exactCellIdentity) {
        return {
          accepted: false,
          code: 'route-network-seam-exterior-lead-mismatch',
          reason: 'seam-exterior-cell-transform-mismatch',
          seamId: endpointSeam.id ?? null,
        };
      }
      return {
        accepted: true,
        code: null,
        seamId: endpointSeam?.id ?? null,
        exteriorCellIds: expectedOutsideCells.map(({ id }) => id),
        distanceMeters,
      };
    }
  }
  return {
    accepted: false,
    code: 'route-network-seam-exterior-lead-mismatch',
    reason: 'lead-shorter-than-two-cells',
    seamId: endpointSeam?.id ?? null,
    distanceMeters,
  };
}

function routePathWithAuthoritativeSeamEndpoints(path, endpointSeams = []) {
  if (!Array.isArray(path) || path.length < 2 || endpointSeams.length !== 2) return path;
  const thresholdCenter = (seam) => (seam?.orderedCells ?? []).find(({ lane, signedDepthTiles }) => (
    Number(lane) === 0 && Number(signedDepthTiles) === 0
  ))?.position ?? null;
  const result = path.map((point) => cloneDungeonAugmentationValue(point));
  const replacements = [
    { pathIndex: 0, seam: endpointSeams[0] },
    { pathIndex: result.length - 1, seam: endpointSeams[1] },
  ];
  for (const { pathIndex, seam } of replacements) {
    const threshold = thresholdCenter(seam);
    if (!threshold || dungeonPointDistance(result[pathIndex], threshold) > 1e-4) continue;
    // Half-grid authored coordinates (for example 43.39999999999999) must not
    // choose a different cell from the stabilized 15-cell seam record. The
    // accepted path therefore serializes the seam threshold identity itself.
    result[pathIndex] = cloneDungeonAugmentationValue(threshold);
  }
  return result;
}

function routePathHasExteriorSocketApproach(
  path,
  socket,
  reverse = false,
  endpointSeam = null,
) {
  return routePathExteriorSocketApproachDiagnostic(
    path,
    socket,
    reverse,
    endpointSeam,
  ).accepted;
}

function routePlanningVolumesRespectEndpointNodeMask(pathVolumes, node, seamOrSeams) {
  if (!node) return true;
  // `occupiedVolumes` are the row-merged projection of the blueprint's exact
  // authored floor masks. Clearance volumes are placement envelopes, not
  // physical room ownership; treating them as floor made every legal exterior
  // lead overlap its endpoint outside the 3x5 seam.
  const endpointVolumes = node.occupiedVolumes ?? [];
  const seams = (Array.isArray(seamOrSeams) ? seamOrSeams : [seamOrSeams])
    .filter(Boolean);
  const overlapEnvelopes = seams.map(({ overlapEnvelope }) => {
    const { parentOwnerId: omittedParentOwnerId, ...nodeLocalEnvelope } = overlapEnvelope;
    // This predicate already has the exact endpoint node in hand. It can use
    // the geometric seam directly while the serialized envelope retains its
    // authored-parent owner for segment/base validation parity.
    return nodeLocalEnvelope;
  });
  return pathVolumes.every((pathVolume) => (
    endpointVolumes.every((nodeVolume) => (
      !planningVolumesOverlap(pathVolume, nodeVolume)
        || planningOverlapIsGranted(pathVolume, nodeVolume, overlapEnvelopes)
    ))
  ));
}

function routePathRespectsEndpointNodeMask(path, node, seam) {
  return routePlanningVolumesRespectEndpointNodeMask(
    routePathPlanningVolumes(path),
    node,
    seam,
  );
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
  reserveLandingVolumes = false,
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
    const collisionVolumes = reserveLandingVolumes
      ? routeSegmentPlanningCollisionVolumes(path, from, to, 3.6, 5.6)
      : pathVolumes;
    return {
      ordinal,
      path,
      pathVolumes,
      collisionVolumes,
      envelope: volumeEnvelope(collisionVolumes),
      lengthMeters: measureDungeonPolyline(path),
    };
  }).sort((first, second) => (
    first.lengthMeters - second.lengthMeters
      || first.ordinal - second.ordinal
  ));
  const candidateEnvelope = volumeEnvelope(candidates.flatMap(({ collisionVolumes }) => (
    collisionVolumes
  )));
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
    for (const volume of candidate.collisionVolumes) {
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

export function planRouteNetwork({
  region,
  grant,
  operationOrdinal,
  moduleCount,
  topologyTemplateId,
  junctionBag,
  elevationMode,
  selectionBags = null,
  topologySelection = null,
  topologyLegalIds = null,
  junctionSelection = null,
  elevationSelection = null,
  elevationLegalIds = null,
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
  // Exact occupied/landing volume emission remains specific to authored
  // objective coverage. Endpoint seam identity is a separate V4 route
  // contract and applies to every ordinary route-network segment, including
  // the pyramid loop.
  const enforceExactEmittedCoverageVolumes = grant.kind === 'objective-route-coverage';
  const requireAuthoritativeEndpointSeams = profile?.id === 'industrial-supplement-preview-v4'
    && Number(profile?.revision ?? 0) >= 5;
  const endpointSeamSharedOwnerId = (socket, node = null) => {
    const directSocketId = String(socket?.id ?? socket?.socketId ?? '');
    const parentSocketId = node?.exactParentEndpoint
      ? String(node.parentEndpointSocketId ?? '')
      : '';
    const overlap = (grant.socketLandingOverlapGrants ?? []).find(({ socketId }) => (
      String(socketId ?? '') === directSocketId
        || (parentSocketId && String(socketId ?? '') === parentSocketId)
    ));
    // `parentOwnerId` names only an authored host owner. Supplemental-node
    // ownership is represented by the separate node-bound copy of the seam
    // envelope, never by overloading this field with the node ID.
    return overlap?.parentOwnerId ?? null;
  };
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
  let coverageTraversalConnectorIndices = new Set();
  const refreshCoverageTraversalConnectorIndices = () => {
    coverageTraversalConnectorIndices = new Set();
    if (grant.kind !== 'objective-route-coverage' || endpointNodeIndexSet.size < 3) return;
    // A one-slot bay between exact corridor stations cannot hold a curated
    // room plus both authoritative seams. Realize that slot as a compact
    // three-arm station and move one curated content room onto its branch.
    // Preserve at least two full rooms for the challenge/elevation and reward
    // contracts.
    coverageTraversalConnectorIndices = new Set(selectCoverageTraversalConnectorIndices({
      nodeCount: physicalModuleCount,
      endpointNodeIndices: [...endpointNodeIndexSet],
      minimumRoomCount: 2,
    }));
  };
  refreshCoverageTraversalConnectorIndices();
  let junctionModuleIndex = 0;
  let topologySupportConnectorIndex = null;
  const refreshTopologySupportConnectorIndex = () => {
    topologySupportConnectorIndex = resolveStackedInterchangeSupportAllocation({
      routeNetworkKind: grant.kind,
      topologyTemplateId,
      physicalModuleCount,
      endpointNodeIndices: [...endpointNodeIndexSet],
    }).supportConnectorIndex;
  };
  refreshTopologySupportConnectorIndex();
  const selectCoverageJunctionModuleIndex = (placement) => {
    const endpointNodeIndices = [...(placement?.endpointNodeIndices ?? [])]
      .sort((first, second) => first - second);
    if (endpointNodeIndices.length === 0) return 0;
    const topologyKitGrammar = routeNetworkTopologyKitGrammarForTemplate(
      profile,
      grammars,
      topologyTemplateId,
    );
    if (String(
      topologyKitGrammar?.selectionConstraints?.routeNetworkModuleKind ?? '',
    ) === 'connector-module') {
      const terminalEndpointIndices = endpointNodeIndices.filter((index) => (
        index === 0 || index === Number(placement?.centers?.length ?? mainNodeCount) - 1
      ));
      if (terminalEndpointIndices.length > 0) {
        // Reserve a stable terminal contract before any geometry-dependent
        // interval ranking. A promotable kit is itself the junction; a
        // non-promotable crossover occupies the last terminal and leaves the
        // first terminal's Through-T as the qualifying junction. Without this
        // rule the two refinement passes could swap junction and kit forever.
        const supportsJunctionPromotion =
          topologyKitGrammar.selectionConstraints?.supportsJunctionPromotion !== false;
        return supportsJunctionPromotion
          ? terminalEndpointIndices.at(-1)
          : terminalEndpointIndices[0];
      }
    }
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
    ).filter((index) => (
      !endpointNodeIndexSet.has(index)
        && !coverageTraversalConnectorIndices.has(index)
        && index !== topologySupportConnectorIndex
    ));
    const semanticRoomNodeIndices = grant.kind === 'objective-route-coverage'
      ? orderCoverageRoomIndicesForArc(roomNodeIndices, [...endpointNodeIndexSet])
      : roomNodeIndices;
    const roomRoleByIndex = new Map(semanticRoomNodeIndices.map((index, roomOrdinal) => {
      if (roomOrdinal === 0) return [index, 'challenge'];
      if (roomOrdinal === semanticRoomNodeIndices.length - 1) return [index, 'reward'];
      // The first intermediate room owns the required authored vertical
      // traversal. Elevation blueprints can also carry a local mechanism, while
      // a generic control room cannot substitute for a physical tier change.
      return [index, ['elevation', 'mechanism', 'trap'][(roomOrdinal - 1) % 3]];
    }));
    return Array.from({ length: physicalModuleCount }, (_, index) => {
      if (endpointNodeIndexSet.has(index)) {
        return index === junctionModuleIndex ? 'junction' : 'connector';
      }
      if (coverageTraversalConnectorIndices.has(index)) return 'connector';
      if (index === topologySupportConnectorIndex) return 'junction';
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
        || coverageTraversalConnectorIndices.has(index)
        || index === topologySupportConnectorIndex
  ) ? 'connector-module' : 'room';
  const junctionSelectionBag = selectionBags?.junction ?? {
    order: [...junctionBag],
    cycle: 0,
    consumedIds: [],
  };
  const candidateJunctionBag = junctionSelectionBag.order.filter((kind) => {
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
  let provisionalJunctionBag = junctionSelectionBag;
  const baseJunctionKinds = Array.from({ length: physicalModuleCount }, (_, index) => {
    if (moduleKindForIndex(index) !== 'connector-module') return candidateJunctionBag[0];
    const candidates = dungeonSelectionBagCandidates(
      provisionalJunctionBag,
      candidateJunctionBag,
    );
    const selected = candidates.find(({ id }) => id === junctionSelection?.id)
      ?? candidates[0];
    if (!selected) return candidateJunctionBag[0];
    provisionalJunctionBag = selected.state;
    return selected.id;
  });
  let junctionKinds = [...baseJunctionKinds];
  let topologyKitModuleIndex = null;
  const roomLayoutLegalIdsByIndex = new Map();
  let roomLayoutSelectionResult = {
    bag: selectionBags?.roomLayout ?? { order: [], cycle: 0, consumedIds: [] },
    selections: [],
    witnesses: [],
  };
  const selectCurrentRoomLayouts = (candidateGrammars) => {
    roomLayoutSelectionResult = selectRouteNetworkRoomLayouts({
      profile,
      grammars,
      selectedGrammars: candidateGrammars,
      contentRoles: plannedContentRoles,
      moduleKinds: Array.from(
        { length: physicalModuleCount },
        (_, index) => moduleKindForIndex(index),
      ),
      topologyKitModuleIndex,
      roomLayoutBag: selectionBags?.roomLayout,
      legalGrammarIdsByIndex: roomLayoutLegalIdsByIndex,
      selectionAlternativeOrdinal: searchVariant,
    });
    return roomLayoutSelectionResult.selectedGrammars;
  };
  const assignRouteNetworkGrammars = (candidateJunctionKinds) => {
    const moduleKinds = Array.from(
      { length: physicalModuleCount },
      (_, index) => moduleKindForIndex(index),
    );
    const assignment = resolveRouteNetworkGrammarAssignments({
      profile,
      grammars,
      routeNetworkKind: grant.kind,
      topologyTemplateId,
      junctionKinds: candidateJunctionKinds,
      contentRoles: plannedContentRoles,
      moduleKinds,
      junctionModuleIndex,
      topologySupportConnectorIndex,
      operationOrdinal,
      searchVariant,
      elevationMode,
    });
    junctionKinds = assignment.junctionKinds;
    topologyKitModuleIndex = assignment.topologyKitModuleIndex;
    if (grant.kind === 'objective-route-coverage') {
      const endpointThroughT = grammars['supplement-route-connector-through-t-v1'];
      const branchEntryThroughT = grammars[
        'supplement-route-connector-through-t-branch-entry-v1'
      ];
      if (endpointThroughT) {
        const topologyKitGrammar = assignment.topologyKitGrammar;
        const topologyKitModuleKind = String(
          topologyKitGrammar?.selectionConstraints?.routeNetworkModuleKind ?? '',
        );
        // A connector topology kit cannot occupy an interior exact station:
        // that station already needs three at-grade arms (parent plus both
        // spine directions). A terminal exact station needs only parent + one
        // spine arm, leaving the kit's authored topology sockets available for
        // its return leg. Relocate the kit deterministically instead of
        // overwriting it with a Through-T and later attempting an impossible
        // chord between ordinary two-socket rooms.
        const topologyKitSupportsJunctionPromotion =
          topologyKitGrammar?.selectionConstraints?.supportsJunctionPromotion !== false;
        const terminalEndpointIndices = [...endpointNodeIndexSet]
          .filter((index) => index === 0 || index === physicalModuleCount - 1)
          .sort((first, second) => first - second);
        const legalTopologyKitTerminalIndices = terminalEndpointIndices.filter((index) => (
          topologyKitSupportsJunctionPromotion || index !== junctionModuleIndex
        ));
        let preservedTopologyKitIndex = assignment.topologyKitModuleIndex;
        if (topologyKitGrammar && topologyKitModuleKind === 'connector-module') {
          preservedTopologyKitIndex = topologyKitSupportsJunctionPromotion
            ? legalTopologyKitTerminalIndices.at(-1) ?? null
            : legalTopologyKitTerminalIndices.at(-1) ?? null;
          if (preservedTopologyKitIndex != null) {
            assignment.selectedGrammars[preservedTopologyKitIndex] = topologyKitGrammar;
            assignment.junctionKinds[preservedTopologyKitIndex] = String(
              topologyKitGrammar.selectionConstraints?.routeNetworkJunctionKind
                ?? assignment.junctionKinds[preservedTopologyKitIndex]
                ?? '',
            );
            assignment.topologyKitModuleIndex = preservedTopologyKitIndex;
            assignment.topologyKitDeferred = false;
            topologyKitModuleIndex = preservedTopologyKitIndex;
          }
        }
        for (const endpointNodeIndex of endpointNodeIndexSet) {
          if (endpointNodeIndex === preservedTopologyKitIndex) continue;
          // An interior exact station has a parent attachment plus two ordered
          // supplemental neighbors. Use the authored branch-entry T so those
          // neighbor arms remain a collinear through pair. Terminal stations
          // retain the parent-through T and its outward decision arm.
          const interiorEndpoint = endpointNodeIndex > 0
            && endpointNodeIndex < physicalModuleCount - 1;
          const leadsIntoTraversalBranch = coverageTraversalConnectorIndices.has(
            endpointNodeIndex + 1,
          );
          assignment.selectedGrammars[endpointNodeIndex] = interiorEndpoint
            || leadsIntoTraversalBranch
            ? branchEntryThroughT ?? endpointThroughT
            : endpointThroughT;
          assignment.junctionKinds[endpointNodeIndex] = 'through-t';
        }
        for (const traversalConnectorIndex of coverageTraversalConnectorIndices) {
          if (traversalConnectorIndex === preservedTopologyKitIndex) continue;
          // A constrained one-slot bay becomes the branch point for its
          // curated challenge room. The branch-entry kit supplies the two ordered spine
          // arms plus the authored right arm; all three must be realized by
          // exact socket bindings before this station may reset featureless
          // distance. The ordinary Through-T has a 16.8 m collinear core; at
          // perpendicular exact stations that leaves no legal exterior lead
          // inside the 33.6 m featureless cap.
          assignment.selectedGrammars[traversalConnectorIndex] =
            branchEntryThroughT ?? endpointThroughT;
          assignment.junctionKinds[traversalConnectorIndex] = 'through-t';
        }
        if (endpointNodeIndexSet.has(assignment.topologyKitModuleIndex)) {
          const selectedTopologyKit = assignment.selectedGrammars[
            assignment.topologyKitModuleIndex
          ];
          if (String(
            selectedTopologyKit?.selectionConstraints?.routeNetworkTopologyTemplateId ?? '',
          ) !== String(topologyTemplateId)) {
            assignment.topologyKitModuleIndex = null;
            assignment.topologyKitDeferred = Boolean(assignment.topologyKitGrammar);
            topologyKitModuleIndex = null;
          }
        }
      }
    }
    return selectCurrentRoomLayouts(assignment.selectedGrammars);
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
  const balanceCoverageElevationIntervals = () => {
    const challengeBranchRoomIndex = plannedContentRoles.findIndex((contentRole, index) => (
      contentRole === 'challenge'
        && !endpointNodeIndexSet.has(index)
        && !coverageTraversalConnectorIndices.has(index)
    ));
    const branchLayout = coverageTraversalBranchBindings({
      nodeCount: physicalModuleCount,
      endpointNodeIndices: [...endpointNodeIndexSet],
      traversalConnectorIndices: [...coverageTraversalConnectorIndices],
      preferredBranchRoomIndex: challengeBranchRoomIndex,
      requirePreferredBranchRoom: true,
      branchRouteRole: 'route-network-challenge-branch',
    });
    return balanceObjectiveRouteGrammarIntervals({
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
      excludedNodeIndices: Number.isInteger(branchLayout?.branchRoomIndex)
        ? [branchLayout.branchRoomIndex]
        : [],
      legalGrammarIdsByIndex: roomLayoutLegalIdsByIndex,
    });
  };
  const connectorGapMeters = Number(profile.connectorGapMeters ?? 5.6);
  const connectorEndpointGapMeters = ordinaryRouteNetworkSocketGapMeters(
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
  const refreshCoveragePayoffLayoutConstraint = () => {
    roomLayoutLegalIdsByIndex.clear();
    if (grant.kind !== 'objective-route-coverage'
      || coverageTraversalConnectorIndices.size === 0) return null;
    const challengeBranchRoomIndex = plannedContentRoles.findIndex((contentRole, index) => (
      contentRole === 'challenge'
        && !endpointNodeIndexSet.has(index)
        && !coverageTraversalConnectorIndices.has(index)
    ));
    const mainPayoffRoomIndex = plannedContentRoles.findIndex((contentRole, index) => (
      contentRole === 'reward'
        && index !== challengeBranchRoomIndex
        && !endpointNodeIndexSet.has(index)
        && !coverageTraversalConnectorIndices.has(index)
    ));
    const orderedEndpointIndices = [...endpointNodeIndexSet]
      .sort((first, second) => first - second);
    const adjacentEndpointPair = orderedEndpointIndices
      .slice(0, -1)
      .map((firstIndex, ordinal) => ({
        firstIndex,
        secondIndex: orderedEndpointIndices[ordinal + 1],
      }))
      .find(({ firstIndex, secondIndex }) => (
        mainPayoffRoomIndex > firstIndex && mainPayoffRoomIndex < secondIndex
      ));
    const firstStationCenter = coveragePlacement?.centers?.[
      adjacentEndpointPair?.firstIndex
    ];
    const secondStationCenter = coveragePlacement?.centers?.[
      adjacentEndpointPair?.secondIndex
    ];
    if (challengeBranchRoomIndex < 0
      || mainPayoffRoomIndex < 0
      || !firstStationCenter
      || !secondStationCenter) {
      return {
        error: 'route-network-coverage-payoff-layout-unavailable',
        context: {
          grantId: grant.id,
          challengeBranchRoomIndex,
          mainPayoffRoomIndex,
          endpointNodeIndices: orderedEndpointIndices,
        },
      };
    }
    const stationSeparationMeters = Math.abs(
      Number(secondStationCenter.x) - Number(firstStationCenter.x),
    ) + Math.abs(
      Number(secondStationCenter.z) - Number(firstStationCenter.z),
    );
    // Once the challenge leaves the serial spine, the payoff is the sole
    // curated room between the final pair of authored stations. Its exact
    // socket-to-socket traverse plus both exterior seam leads must fit that
    // station interval. Shell half-cells are not traversal and must not be
    // counted a second time; exact routing below remains authoritative for
    // footprint clearance and both approach directions.
    const legalPayoffGrammarIds = coveragePayoffGrammarIdsForStationBay({
      grammarPool: profile.grammarPool,
      grammars,
      stationSeparationMeters,
      connectorEndpointGapMeters,
    });
    if (legalPayoffGrammarIds.length === 0) {
      return {
        error: 'route-network-coverage-payoff-layout-unavailable',
        context: {
          grantId: grant.id,
          mainPayoffRoomIndex,
          stationSeparationMeters,
          connectorEndpointGapMeters,
        },
      };
    }
    roomLayoutLegalIdsByIndex.set(mainPayoffRoomIndex, legalPayoffGrammarIds);
    return null;
  };
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
        // External connector spines may share only the authored socket
        // threshold. `socketModuleOverlapGrants` belong exclusively to the
        // supplemental node-versus-parent placement check; admitting them
        // here lets a route tunnel through the authored parent footprint.
        planningOverlapGrants: grant.socketLandingOverlapGrants ?? [],
        diagnostics: objectiveExternalDiagnostics,
      },
    );
    endpointNodeIndexSet = new Set(coveragePlacement.endpointNodeIndices);
    refreshCoverageTraversalConnectorIndices();
    refreshTopologySupportConnectorIndex();
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
    const exactCoverageStationCenter = (endpoint, grammar) => {
      const facing = toDungeonCardinalFacing(endpoint.facing);
      const entrySocket = grammar?.sockets?.find(({ id }) => id === 'entry');
      if (!entrySocket?.localPosition) {
        return routeNetworkOuterPoint(
          endpoint,
          Number(grammar?.size?.depth ?? 0) * 0.5 + 2.8,
        );
      }
      const rotatedEntry = transformDungeonLocalPoint(
        entrySocket.localPosition,
        {
          center: { x: 0, y: 0, z: 0 },
          rotationQuarterTurns: rotationQuarterTurnsForFacing(facing),
        },
      );
      const desiredEntry = addDungeonPoints(
        endpoint.position,
        scaleDungeonPoint(facing, Math.max(
          ROUTE_NETWORK_SOCKET_APPROACH_METERS,
          Number(endpoint.widthMeters ?? 8.4) * 0.5,
        )),
      );
      return {
        x: Number(desiredEntry.x) - Number(rotatedEntry.x),
        y: Number(desiredEntry.y) - Number(rotatedEntry.y),
        z: Number(desiredEntry.z) - Number(rotatedEntry.z),
      };
    };
    for (let coverageRefinementPass = 0;
      coverageRefinementPass < 3;
      coverageRefinementPass += 1) {
    placementPath = endpoints.map((endpoint, endpointOrdinal) => {
      const nodeIndex = coveragePlacement.endpointNodeIndices[endpointOrdinal];
      return exactCoverageStationCenter(endpoint, selectedGrammars[nodeIndex]);
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
    const serialCoverageRoomEntries = selectedGrammars
      .map((grammar, index) => ({ grammar, index }))
      .filter(({ index }) => moduleKindForIndex(index) === 'room');
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
        contentRoomDepthMeters: serialCoverageRoomEntries
          .map(({ grammar }) => grammarEntryExitTraversalMeters(grammar)),
        contentRoomEntryElevationMeters: serialCoverageRoomEntries
          .map(({ grammar }) => Number(grammar.sockets.find(({ id }) => id === 'entry')
            ?.localPosition?.y ?? 0)),
        contentRoomExitElevationMeters: serialCoverageRoomEntries
          .map(({ grammar }) => Number(grammar.sockets.find(({ id }) => id === 'exit')
            ?.localPosition?.y ?? 0)),
        contentRoomEntryLocalPositions: serialCoverageRoomEntries
          .map(({ grammar }) => cloneDungeonAugmentationValue(
            grammar.sockets.find(({ id }) => id === 'entry')?.localPosition ?? null,
          )),
        contentRoomSizes: serialCoverageRoomEntries
          .map(({ grammar }) => cloneDungeonAugmentationValue(grammar.size)),
        contentRoomPlanningVolumes: serialCoverageRoomEntries
          .map(({ grammar }) => cloneDungeonAugmentationValue(
            [
              ...(grammar.occupiedVolumes ?? []),
              ...(grammar.clearanceVolumes ?? []),
            ],
          )),
        minimumApproachMeters: ROUTE_NETWORK_SOCKET_APPROACH_METERS,
        maximumFeaturelessSpanMeters: Number(
          profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
        ),
        searchVariant,
        planningAvoidanceVolumes,
        planningOverlapGrants: grant.socketLandingOverlapGrants ?? [],
        diagnostics: objectiveExternalDiagnostics,
      },
    );
    if (topologySupportConnectorIndex != null) {
      const compoundDiagnostics = {};
      const compoundPlacement = composeStackedInterchangeSupportCompound({
        placement: coveragePlacement,
        selectedGrammars,
        physicalModuleCount,
        endpointNodeIndices: [...endpointNodeIndexSet],
        topologyKitModuleIndex,
        supportConnectorIndex: topologySupportConnectorIndex,
        endpoints,
        diagnostics: compoundDiagnostics,
      });
      if (!compoundPlacement) {
        return {
          error: 'route-network-stacked-interchange-compound-unavailable',
          context: {
            grantId: grant.id,
            topologyTemplateId,
            topologyKitModuleIndex,
            topologySupportConnectorIndex,
            endpointNodeIndices: [...endpointNodeIndexSet],
            planningPhaseTimings: cloneDungeonAugmentationValue(
              objectiveExternalDiagnostics.planningPhaseTimings ?? null,
            ),
            objectiveExternalDiagnostics: cloneDungeonAugmentationValue(
              objectiveExternalDiagnostics,
            ),
            compoundDiagnostics,
            coveragePlacementShape: {
              centerCount: coveragePlacement?.centers?.length ?? 0,
              endpointNodeIndices: cloneDungeonAugmentationValue(
                coveragePlacement?.endpointNodeIndices ?? [],
              ),
              requiredSocketBindingCount:
                coveragePlacement?.requiredSocketBindings?.length ?? 0,
              externalSpinePathCount: coveragePlacement?.externalSpinePaths?.length ?? 0,
            },
          },
        };
      }
      coveragePlacement = compoundPlacement;
    }
    endpointNodeIndexSet = new Set(coveragePlacement.endpointNodeIndices);
    refreshCoverageTraversalConnectorIndices();
    refreshTopologySupportConnectorIndex();
    junctionModuleIndex = selectCoverageJunctionModuleIndex(coveragePlacement);
    plannedContentRoles = buildPlannedContentRoles();
    const coveragePayoffLayoutError = refreshCoveragePayoffLayoutConstraint();
    if (coveragePayoffLayoutError) return coveragePayoffLayoutError;
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
    const unresolvedConstrainedLayout = [...roomLayoutLegalIdsByIndex]
      .find(([index, legalIds]) => !legalIds.includes(String(
        selectedGrammars[index]?.id ?? '',
      )));
    if (unresolvedConstrainedLayout) {
      const [nodeIndex, legalGrammarIds] = unresolvedConstrainedLayout;
      return {
        error: 'route-network-coverage-payoff-layout-unavailable',
        context: {
          grantId: grant.id,
          nodeIndex,
          legalGrammarIds,
          selectedGrammarId: selectedGrammars[nodeIndex]?.id ?? null,
        },
      };
    }
    // Only objective-route coverage has a grammar/layout dependency that
    // needs fixed-point refinement. Other supplemental networks already have
    // their final placement after this rebuild; repeating the pass three
    // times wastes work and can leave centers derived from the preceding
    // grammar assignment.
    if (grant.kind !== 'objective-route-coverage') break;
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
        if (coverageRefinementPass < 2) {
          balancedCoverageLayoutSignature = refinedLayoutSignature;
          continue;
        }
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
        const thresholdLeadMeters = Math.max(
          ROUTE_NETWORK_SOCKET_APPROACH_METERS,
          Number(endpoint.widthMeters ?? 8.4) * 0.5,
        );
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
      break;
    }
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
  if (grant.kind === 'objective-route-coverage'
    && coverageTraversalConnectorIndices.size > 0) {
    const challengeBranchRoomIndex = plannedContentRoles.findIndex((contentRole, index) => (
      contentRole === 'challenge'
        && !endpointNodeIndexSet.has(index)
        && !coverageTraversalConnectorIndices.has(index)
    ));
    const branchLayout = coverageTraversalBranchBindings({
      nodeCount: physicalModuleCount,
      endpointNodeIndices: [...endpointNodeIndexSet],
      traversalConnectorIndices: [...coverageTraversalConnectorIndices],
      preferredBranchRoomIndex: challengeBranchRoomIndex,
      requirePreferredBranchRoom: true,
      branchRouteRole: 'route-network-challenge-branch',
    });
    if (!branchLayout) {
      return {
        error: 'route-network-coverage-traversal-branch-unavailable',
        context: {
          grantId: grant.id,
          endpointNodeIndices: [...endpointNodeIndexSet],
          traversalConnectorIndices: [...coverageTraversalConnectorIndices],
        },
      };
    }
    coveragePlacement.requiredSocketBindings = branchLayout.bindings;
    if (Number.isInteger(branchLayout.branchRoomIndex)) {
      // The branch room was initially composed on the serial station-to-
      // station route. Seed it from the constrained station's authored right
      // socket instead. The global solver may still
      // translate and rotate both modules, but starting from their exact
      // socket relationship keeps the legal branch pair inside its bounded
      // candidate window instead of spending that window around the stale
      // main-chain position.
      const traversalCenter = coveragePlacement.centers?.[
        branchLayout.traversalIndex
      ];
      const branchCenter = coveragePlacement.centers?.[
        branchLayout.branchRoomIndex
      ];
      const traversalGrammar = selectedGrammars[branchLayout.traversalIndex];
      const branchGrammar = selectedGrammars[branchLayout.branchRoomIndex];
      const traversalRightSocket = traversalGrammar?.sockets?.find(({ id }) => (
        id === 'right'
      ));
      const branchEntrySocket = branchGrammar?.sockets?.find(({ id }) => (
        id === 'entry'
      ));
      const incomingBinding = branchLayout.bindings.find(({ toIndex, fromIndex }) => (
        toIndex === branchLayout.traversalIndex
          && fromIndex !== branchLayout.branchRoomIndex
      ));
      const incomingCenter = coveragePlacement.centers?.[incomingBinding?.fromIndex];
      const traversalFacing = coveragePlacement.nodeFacings?.[
        branchLayout.traversalIndex
      ] ?? (incomingCenter && traversalCenter
        ? toDungeonCardinalFacing({
          x: Number(traversalCenter.x) - Number(incomingCenter.x),
          z: Number(traversalCenter.z) - Number(incomingCenter.z),
        })
        : null);
      if (traversalCenter
        && branchCenter
        && traversalFacing
        && traversalRightSocket?.localPosition
        && traversalRightSocket?.localFacing
        && branchEntrySocket?.localPosition) {
        const traversalPlacement = {
          center: traversalCenter,
          rotationQuarterTurns: rotationQuarterTurnsForFacing(traversalFacing),
        };
        const branchFacing = toDungeonCardinalFacing(transformDungeonLocalFacing(
          traversalRightSocket.localFacing,
          traversalPlacement,
        ));
        const traversalRightPosition = transformDungeonLocalPoint(
          traversalRightSocket.localPosition,
          traversalPlacement,
        );
        const rotatedBranchEntry = transformDungeonLocalPoint(
          branchEntrySocket.localPosition,
          {
            center: { x: 0, y: 0, z: 0 },
            rotationQuarterTurns: rotationQuarterTurnsForFacing(branchFacing),
          },
        );
        const desiredBranchEntry = addDungeonPoints(
          traversalRightPosition,
          scaleDungeonPoint(branchFacing, connectorEndpointGapMeters),
        );
        coveragePlacement.centers[branchLayout.branchRoomIndex] = {
          x: Number(desiredBranchEntry.x) - Number(rotatedBranchEntry.x),
          y: Number(desiredBranchEntry.y) - Number(rotatedBranchEntry.y),
          z: Number(desiredBranchEntry.z) - Number(rotatedBranchEntry.z),
        };
        coveragePlacement.nodeFacings ??= Array.from(
          { length: physicalModuleCount },
          () => null,
        );
        coveragePlacement.nodeFacings[branchLayout.branchRoomIndex] = branchFacing;
        coveragePlacement.placementOutwardFacings ??= Array.from(
          { length: physicalModuleCount },
          () => null,
        );
        coveragePlacement.placementOutwardFacings[
          branchLayout.branchRoomIndex
        ] = branchFacing;
        coveragePlacement.anchorEndpointOrdinals ??= Array.from(
          { length: physicalModuleCount },
          () => null,
        );
        coveragePlacement.anchorEndpointOrdinals[branchLayout.branchRoomIndex] = null;
      }
      coveragePlacement.coverageTraversalBranch = {
        traversalNodeIndex: branchLayout.traversalIndex,
        branchRoomIndex: branchLayout.branchRoomIndex,
      };
      delete coveragePlacement.coverageTraversalGallery;
    } else {
      delete coveragePlacement.coverageTraversalBranch;
      coveragePlacement.coverageTraversalGallery = {
        traversalNodeIndex: branchLayout.traversalIndex,
      };
    }
  }
  if (grant.kind === 'objective-route-coverage') {
    const authoredExitDeltas = selectedGrammars.map((grammar) => Number(
      grammar?.selectionConstraints?.authoredExitElevationDeltaMeters ?? 0,
    ));
    const hasAuthoredElevationModule = selectedGrammars.some((grammar) => (
      (grammar?.selectionConstraints?.authoredTransferKinds ?? []).length > 0
    ));
    const authoredExitDelta = authoredExitDeltas.reduce((sum, delta) => sum + delta, 0);
    // A self-contained elevation room can rise and return between level exits.
    // Its net authored exit delta is zero by design; the physical transfer
    // records, not a nonzero handoff to the next module, prove that the
    // required elevation traversal exists.
    if (!hasAuthoredElevationModule) {
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
  roomLayoutSelectionResult = recordAcceptedRouteNetworkRoomLayouts({
    profile,
    grammars,
    selectedGrammars,
    contentRoles: plannedContentRoles,
    moduleKinds: Array.from(
      { length: physicalModuleCount },
      (_, index) => moduleKindForIndex(index),
    ),
    topologyKitModuleIndex,
    roomLayoutBag: selectionBags?.roomLayout,
    legalGrammarIdsByIndex: roomLayoutLegalIdsByIndex,
  });
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
    if (endpointNodeIndexSet.has(index) || index === topologySupportConnectorIndex) continue;
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
      sourceApproachMeters: [ROUTE_NETWORK_SOCKET_APPROACH_METERS],
      destinationApproachMeters: [ROUTE_NETWORK_SOCKET_APPROACH_METERS],
      minimumApproachMeters: ROUTE_NETWORK_SOCKET_APPROACH_METERS,
    }
    : {};
  const socketRouteCandidateCache = new Map();
  const socketRouteMinimumLevelSpanCache = new Map();
  const socketRouteTransformKey = (socket) => [
    Number(socket?.position?.x),
    Number(socket?.position?.y),
    Number(socket?.position?.z),
    Number(socket?.facing?.x),
    Number(socket?.facing?.z),
  ].join(',');
  const socketRouteOptionsKey = (options = {}) => [
    String(options.connectorFamily ?? 'service-gallery'),
    String(options.preferXFirst ?? true),
    (options.sourceApproachMeters ?? []).map(Number).join(','),
    (options.destinationApproachMeters ?? []).map(Number).join(','),
    (options.detourOffsetsMeters ?? []).map(Number).join(','),
    Number(options.minimumApproachMeters ?? ROUTE_NETWORK_SOCKET_APPROACH_METERS),
  ].join(';');
  const socketRouteCacheKey = (from, to, options = {}) => [
    socketRouteTransformKey(from),
    socketRouteTransformKey(to),
    socketRouteOptionsKey(options),
  ].join('>');
  const cachedSocketRouteCandidates = (from, to, options = {}) => {
    const cacheKey = socketRouteCacheKey(from, to, options);
    if (!socketRouteCandidateCache.has(cacheKey)) {
      socketRouteCandidateCache.set(
        cacheKey,
        facingAwareSocketRouteCandidates(from, to, options),
      );
    }
    return socketRouteCandidateCache.get(cacheKey);
  };
  const cachedMinimumSocketRouteLevelSpan = (from, to, options = {}) => {
    const cacheKey = socketRouteCacheKey(from, to, options);
    if (!socketRouteMinimumLevelSpanCache.has(cacheKey)) {
      const paths = cachedSocketRouteCandidates(from, to, options);
      socketRouteMinimumLevelSpanCache.set(
        cacheKey,
        paths.length > 0
          ? Math.min(...paths.map(maximumContinuousLevelRouteSpan))
          : Number.POSITIVE_INFINITY,
      );
    }
    return socketRouteMinimumLevelSpanCache.get(cacheKey);
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
    .some((grammar) => (
      (grammar?.selectionConstraints?.authoredTransferKinds ?? []).length > 0
    ));
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
    if (routeNetworkNodeResetsFeaturelessDistance(node)) return 0;
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
        ROUTE_NETWORK_SOCKET_APPROACH_METERS,
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
  const createRouteNetworkNode = (index, center, facing, planningOnly = false) => {
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
      planningOnly,
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
    } else if (coverageTraversalConnectorIndices.has(index)) {
      node.connectorOwnershipId = node.id;
      // A constrained one-slot bay owns its curated-content branch as well as
      // its two ordered spine arms. Planning must therefore realize all three exact
      // bindings; validation still derives the effective degree from the
      // committed physical graph and will reject a capped or missing arm.
      node.plannedMinimumGraphDegree = 3;
    } else if (index === topologySupportConnectorIndex) {
      node.connectorOwnershipId = node.id;
      node.plannedMinimumGraphDegree = 3;
    }
    return node;
  };
  const facingForMainNode = (index) => {
    if (grant.kind !== 'landmark-perimeter-loop') {
      const endpointOrdinal = coveragePlacement.endpointNodeIndices.indexOf(index);
      if (endpointOrdinal >= 0) return endpoints[endpointOrdinal].facing;
      if (index === topologySupportConnectorIndex
        && coveragePlacement.nodeFacings?.[index]) {
        // The stacked-interchange composer solves the Through-T branch socket
        // orientation exactly against the selected terminal kit socket. The
        // generic chain tangent below describes traversal order, not that
        // branch identity, and rotating to it destroys every legal compound
        // pair before placement begins.
        return coveragePlacement.nodeFacings[index];
      }
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
        // An exact authored-corridor station cannot rotate its supplemental
        // arm to follow the later chain tangent. When this room immediately
        // follows such a station, align the room's entry to that immutable
        // incoming seam and let the gallery after the room own any bend toward
        // the next module. Preferring the outgoing binding here used to point
        // both endpoint normals away from one another, leaving no legal
        // <=33.6 m facing-aware route even though the room centers were close.
        const incomingSourceIsExactEndpoint = incomingBinding
          && endpointNodeIndexSet.has(Number(incomingBinding.fromIndex));
        const preferredBinding = incomingSourceIsExactEndpoint
          ? incomingBinding
          : outgoingBinding ?? incomingBinding;
        const preferredBindingIsOutgoing = preferredBinding === outgoingBinding;
        const adjacentCenter = preferredBindingIsOutgoing
          ? centers[preferredBinding?.toIndex]
          : centers[preferredBinding?.fromIndex];
        if (adjacentCenter) {
          const delta = preferredBindingIsOutgoing
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
    // The host socket remains exact, but the connector-owned station may sit
    // farther out on that socket's own ray. The original width/2 seed is only
    // 4.2 m from an 8.4 m aperture and cannot satisfy the strict 5.6 m exterior
    // approach. Enumerate tile-aligned outward translations only: no tangent
    // drift, reverse placement, or host-side movement is legal here.
    const movableDenseCoverageEndpointStation = exactCoverageEndpointStation
      && grant.kind === 'objective-route-coverage';
    const precomposedObjectiveExternalRoom = parentSocket == null
      && grant.kind === 'objective-route-coverage'
      && Array.isArray(coveragePlacement?.externalRoutePaths);
    const planarCandidates = exactCoverageEndpointStation
      ? movableDenseCoverageEndpointStation
        ? Array.from({ length: 11 }, (_, offsetTiles) => (
          addDungeonPoints(
            baseCenter,
            scaleDungeonPoint(
              toDungeonCardinalFacing(outward),
              offsetTiles * 2.8,
            ),
          )
        ))
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
    const solveEndpointOrientation = candidatesOnly
      && grant.kind === 'objective-route-coverage'
      && exactCoverageEndpointStation;
    const orientationCandidates = solveInteriorOrientation || solveEndpointOrientation
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
    const stableCandidateNodeId = createDungeonSupplementId({
      parentRegionId: region.id,
      operationType: 'routeNetwork',
      operationOrdinal,
      kind: 'node',
      ordinal: index,
      sourceId,
    });
    const parentLocalSocketId = grant.kind === 'landmark-perimeter-loop'
      && index === mainCenters.length - 1
      ? 'exit'
      : 'entry';
    const parentOverlapGrants = parentSocket
      ? (grant.socketLandingOverlapGrants ?? []).filter(({ socketId }) => (
        String(socketId) === String(parentSocket.id)
      ))
      : [];
    // The candidate node ID, avoidance set, and exact parent seam do not
    // change while its center/orientation candidates are evaluated. Hoisting
    // this filter avoids rescanning every authored and globally reserved
    // volume for every candidate in the hottest placement loop.
    const parentRouteAvoidanceVolumes = parentSocket
      ? avoidanceVolumes.filter((volume) => (
        !planningVolumeOwnedBy(volume, stableCandidateNodeId)
          && !isGrantedParentGalleryThresholdVolume(volume, parentOverlapGrants[0])
      ))
      : [];
    const parentRouteEndpoint = parentSocket ? {
      position: parentSocket.position,
      facing: parentSocket.facing,
    } : null;
    const candidates = random.fork(`node-placement:${index}`).shuffle(
      orientedPlacementCandidates,
    ).map(({ center, candidateFacing, orientationOrdinal }) => {
      const node = createRouteNetworkNode(
        index,
        center,
        candidateFacing,
        true,
      );
      const parentNodeSocket = getNodeSocket(node, parentLocalSocketId);
      const parentConnectorFamily = parentSocket && Math.abs(
        Number(parentNodeSocket.position.y) - Number(parentSocket.position.y),
      ) > 1e-6 ? verticalFamily : 'service-gallery';
      const parentDistanceMeters = parentSocket
        ? cachedMinimumSocketRouteLevelSpan(
          parentRouteEndpoint,
          parentNodeSocket,
          {
            connectorFamily: parentConnectorFamily,
            sourceApproachMeters: [ROUTE_NETWORK_SOCKET_APPROACH_METERS],
            destinationApproachMeters: [ROUTE_NETWORK_SOCKET_APPROACH_METERS],
            minimumApproachMeters: ROUTE_NETWORK_SOCKET_APPROACH_METERS,
          },
        )
        : 0;
      const parentRouteCandidates = parentSocket
        && grant.kind === 'landmark-perimeter-loop'
        ? cachedSocketRouteCandidates(
          parentRouteEndpoint,
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
    const committedNode = createRouteNetworkNode(
      index,
      selected.center,
      selected.facing,
    );
    centers[index] = selected.center;
    localPlacementAvoidanceVolumes.push(
      ...committedNode.occupiedVolumes,
      ...committedNode.clearanceVolumes,
    );
    return committedNode;
  };
  const mainNodes = Array.from({ length: mainCenters.length }, () => null);
  let preselectedCoverageSpinePairs = null;
  let preselectedCoverageParentAttachmentPaths = null;
  let physicalPlanningPhaseTimings = null;
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
        const committedNode = createRouteNetworkNode(
          index,
          candidate.center,
          candidate.facing,
        );
        centers[index] = candidate.center;
        mainNodes[index] = committedNode;
        localPlacementAvoidanceVolumes.push(
          ...(committedNode.occupiedVolumes ?? []),
          ...(committedNode.clearanceVolumes ?? []),
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
    const planningNowMilliseconds = () => (
      globalThis.performance?.now?.() ?? Date.now()
    );
    const physicalPlanningStartedAt = planningNowMilliseconds();
    physicalPlanningPhaseTimings = {
      candidateGenerationMs: 0,
      staticCollisionScoringMs: 0,
      staticCollisionScoringCalls: 0,
      pairCompatibilityMs: 0,
      pairCompatibilityEvaluations: 0,
      recursiveCompositionMs: 0,
      totalMs: 0,
    };
    const physicalPlanningTimingSnapshot = () => {
      physicalPlanningPhaseTimings.totalMs = planningNowMilliseconds()
        - physicalPlanningStartedAt;
      return cloneDungeonAugmentationValue(physicalPlanningPhaseTimings);
    };
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
    const indexedStaticPathVolumesHaveCollision = (pathVolumes) => {
      const startedAt = planningNowMilliseconds();
      const result = pathVolumes.some((pathVolume) => (
        [...nearbyStaticAvoidanceVolumes(pathVolume)].some((obstacle) => (
          planningVolumesOverlap(pathVolume, obstacle)
        ))
      ));
      physicalPlanningPhaseTimings.staticCollisionScoringMs +=
        planningNowMilliseconds() - startedAt;
      physicalPlanningPhaseTimings.staticCollisionScoringCalls += 1;
      return result;
    };
    const indexedStaticNodeCollisionScore = (node, overlapGrants = []) => {
      const startedAt = planningNowMilliseconds();
      const result = [...(node?.occupiedVolumes ?? []), ...(node?.clearanceVolumes ?? [])]
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
        ), 0);
      physicalPlanningPhaseTimings.staticCollisionScoringMs +=
        planningNowMilliseconds() - startedAt;
      physicalPlanningPhaseTimings.staticCollisionScoringCalls += 1;
      return result;
    };
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
        const parentEndpointSeam = createDungeonRouteEndpointSeam(parentSocket, {
          id: `${operationId}:planning-parent-endpoint-seam:${nodeIndex}`,
          operationId,
          networkId: operationId,
          nodeId: parentSocket.nodeId ?? parentSocket.roomId ?? null,
          socketId: parentSocket.id,
          localSocketId: parentSocket.localSocketId ?? null,
          role: 'from',
          elevationBand: grant.progressionBandId ?? null,
          parentOwnerId: landingOverlapGrant?.parentOwnerId ?? null,
        });
        return [nodeIndex, {
          endpointOrdinal,
          parentSocket,
          parentEndpointSeam,
          routeAvoidanceVolumes: staticAvoidanceVolumes.filter((volume) => (
            !isGrantedParentGalleryThresholdVolume(
              volume,
              parentEndpointSeam.overlapEnvelope,
            )
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
      const { parentSocket, parentEndpointSeam, routeAvoidanceVolumes } = attachmentContext;
      const nodeSocket = getNodeSocket(candidate.node, 'entry');
      const nodeSeam = createDungeonRouteEndpointSeam(nodeSocket, {
        id: `${operationId}:planning-parent-attachment:${candidate.node.id}:endpoint-seam`,
        operationId,
        networkId: operationId,
        nodeId: candidate.node.id,
        socketId: nodeSocket.id,
        localSocketId: nodeSocket.localSocketId,
        role: 'to',
        elevationBand: candidate.node.progressionBandId ?? grant.progressionBandId ?? null,
        parentOwnerId: endpointSeamSharedOwnerId(nodeSocket, candidate.node),
      });
      const parentAttachmentOverlapGrants = [
        parentEndpointSeam.overlapEnvelope,
        nodeSeam.overlapEnvelope,
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
        ROUTE_NETWORK_SOCKET_APPROACH_METERS,
        true,
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
      const parentApproachDiagnostic = routePathExteriorSocketApproachDiagnostic(
        path,
        parentSocket,
        false,
        parentEndpointSeam,
      );
      const nodeApproachDiagnostic = routePathExteriorSocketApproachDiagnostic(
        path,
        nodeSocket,
        true,
        nodeSeam,
      );
      const nodeMaskCompatible = routePathRespectsEndpointNodeMask(
        path,
        candidate.node,
        nodeSeam,
      );
      if (!parentApproachDiagnostic.accepted
        || !nodeApproachDiagnostic.accepted
        || !nodeMaskCompatible) {
        return {
          compatible: false,
          path: null,
          pathVolumes: [],
          collisionScore: Number.POSITIVE_INFINITY,
          distanceMeters: Number.POSITIVE_INFINITY,
          routeAvoidanceVolumes,
          overlapGrants: parentAttachmentOverlapGrants,
          rejectionCode: !parentApproachDiagnostic.accepted
            || !nodeApproachDiagnostic.accepted
            ? 'route-network-seam-exterior-lead-mismatch'
            : 'route-network-endpoint-overlap-outside-seam',
          parentApproachDiagnostic,
          nodeApproachDiagnostic,
          nodeMaskCompatible,
        };
      }
      const collisionScore = selectedParentAttachment.collisionScore;
      const distanceMeters = featurelessPathDistance(path);
      return {
        compatible: collisionScore === 0 && distanceMeters <= maximumSpan + 1e-6,
        path,
        pathVolumes: selectedParentAttachment.pathVolumes,
        collisionVolumes: selectedParentAttachment.collisionVolumes,
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
    ) => {
      let minimum = Number.POSITIVE_INFINITY;
      const firstSockets = availableSpineSockets(firstNode, firstIndex, secondIndex);
      const secondSockets = availableSpineSockets(secondNode, secondIndex, firstIndex);
      for (const firstSocket of firstSockets) {
        for (const secondSocket of secondSockets) {
          const deltaX = Math.abs(
            Number(secondSocket.position.x) - Number(firstSocket.position.x),
          );
          const deltaY = Math.abs(
            Number(secondSocket.position.y) - Number(firstSocket.position.y),
          );
          const deltaZ = Math.abs(
            Number(secondSocket.position.z) - Number(firstSocket.position.z),
          );
          // A real elevation-changing connector is a meaningful reset. Its
          // best possible placement splits total planar travel evenly; exact
          // routing still enforces approach, transfer-run, and collision
          // constraints after this admissible lower bound.
          const distance = deltaY > 1e-6
            ? minimumVerticalRouteFeaturelessSpanMeters(deltaX, deltaZ)
            : deltaX + deltaZ;
          if (distance < minimum) minimum = distance;
        }
      }
      return minimum;
    };
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
        && grant.kind === 'objective-route-coverage';
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
        // Socket orientation is part of the physical candidate. Retaining only
        // one distance-tied rotation can keep a route witness whose room mask
        // overlaps the endpoint while discarding the equally positioned
        // outward-facing module that clears it. Preserve one candidate per
        // facing at this uniquely important target; the overall domain remains
        // capped below.
        for (const closest of closestPlacementCandidatesPerFacing(
          validCandidates,
          preferredAdjacentEndpointTarget,
        )) selected.add(closest);
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
          const closest = closestPlacementCandidate(
            validCandidates,
            { x: targetX, z: targetZ },
          );
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
          const closest = closestPlacementCandidate(
            validCandidates,
            { x: targetX, z: targetZ },
          );
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
          const closest = closestPlacementCandidate(
            validCandidates,
            { x: targetX, z: targetZ },
          );
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
    const candidateGenerationStartedAt = planningNowMilliseconds();
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
      let candidatePool;
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
                overlapGrants: cloneDungeonAugmentationValue(attachment.overlapGrants ?? []),
                rejectionCode: attachment.rejectionCode ?? null,
                parentApproachDiagnostic: cloneDungeonAugmentationValue(
                  attachment.parentApproachDiagnostic ?? null,
                ),
                nodeApproachDiagnostic: cloneDungeonAugmentationValue(
                  attachment.nodeApproachDiagnostic ?? null,
                ),
                nodeMaskCompatible: attachment.nodeMaskCompatible ?? null,
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
        candidatePool = compatibleCandidates;
      } else {
        candidates = selectBoundedPlacementCandidates(
          nodeValidCandidates,
          false,
          centers[index],
          selectedGrammars[index],
          inputs.outward,
          preferredAdjacentEndpointTargets,
        );
        candidatePool = nodeValidCandidates;
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
        candidatePool,
        endpoint: endpointNodeIndexSet.has(index),
        diagnostics: {
          facing: cloneDungeonAugmentationValue(inputs.facing),
          outward: cloneDungeonAugmentationValue(inputs.outward),
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
    physicalPlanningPhaseTimings.candidateGenerationMs +=
      planningNowMilliseconds() - candidateGenerationStartedAt;
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
          planningPhaseTimings: physicalPlanningTimingSnapshot(),
        },
      };
    }
    // Objective coverage contributes one bidirectional external gameplay
    // path. Most layouts use numeric adjacency; authored compounds may supply
    // a different ordered chain (for example reward -> support -> terminal
    // stacked kit). Consume that binding order directly rather than silently
    // reconnecting the old serial indices and stranding the reserved module.
    const declaredCoverageBindings = coveragePlacement?.requiredSocketBindings ?? [];
    const coverageRequiredEdges = (
      declaredCoverageBindings.length === Math.max(0, mainCenters.length - 1)
        ? declaredCoverageBindings
        : Array.from(
          { length: Math.max(0, mainCenters.length - 1) },
          (_, edgeOrdinal) => ({
            fromIndex: edgeOrdinal,
            toIndex: edgeOrdinal + 1,
          }),
        )
    ).map((binding, edgeOrdinal) => ({
      edgeOrdinal,
      fromIndex: Number(binding.fromIndex),
      toIndex: Number(binding.toIndex),
      routeRole: binding.routeRole ?? 'route-network-spine',
      requiredSocketBinding: binding,
    }));
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
        lastSocketPairDiagnostics: [],
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
    const physicalPairRouteShapeCache = new Map();
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
        eligibleSocketPairCandidateCounts: [],
        routeStageTotals: {
          socketPairCount: 0,
          rawRouteCandidateCount: 0,
          exteriorApproachEligibleCount: 0,
          fromNodeMaskEligibleCount: 0,
          toNodeMaskEligibleCount: 0,
          positiveLengthCount: 0,
          withinFeaturelessSpanCount: 0,
          routeOptionCount: 0,
          staticCollisionFreeCount: 0,
          exactRouteOptionStaticCollisionFreeCount: 0,
          indexedStaticCollisionCount: 0,
          pinnedAttachmentCollisionCount: 0,
        },
      }));
    const candidatePhysicalKeyCache = new WeakMap();
    const candidatePhysicalKey = (candidate, index) => {
      if (!candidatePhysicalKeyCache.has(candidate)) {
        candidatePhysicalKeyCache.set(candidate, [
          index,
          Number(candidate.center.x).toFixed(3),
          Number(candidate.center.y).toFixed(3),
          Number(candidate.center.z).toFixed(3),
          Number(candidate.facing?.x ?? 0).toFixed(3),
          Number(candidate.facing?.z ?? 0).toFixed(3),
        ].join(':'));
      }
      return candidatePhysicalKeyCache.get(candidate);
    };
    const physicalPairCacheKey = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      const ordered = firstIndex <= secondIndex
        ? [firstCandidate, firstIndex, secondCandidate, secondIndex]
        : [secondCandidate, secondIndex, firstCandidate, firstIndex];
      const [fromCandidate, fromIndex, toCandidate, toIndex] = ordered;
      return `${candidatePhysicalKey(fromCandidate, fromIndex)}>${candidatePhysicalKey(
        toCandidate,
        toIndex,
      )}`;
    };
    const candidatePairNodeCollisionCache = new Map();
    const candidatePairNodeCollisionScore = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      const cacheKey = physicalPairCacheKey(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      );
      if (!candidatePairNodeCollisionCache.has(cacheKey)) {
        candidatePairNodeCollisionCache.set(
          cacheKey,
          nodePlanningCollisionScore(
            firstCandidate.node,
            candidateNodeVolumes(secondCandidate),
          ),
        );
      }
      return candidatePairNodeCollisionCache.get(cacheKey);
    };
    const candidatePairMinimumSpineDistanceCache = new Map();
    const candidatePairMinimumSpineDistance = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      const cacheKey = physicalPairCacheKey(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      );
      if (!candidatePairMinimumSpineDistanceCache.has(cacheKey)) {
        candidatePairMinimumSpineDistanceCache.set(
          cacheKey,
          minimumSpineDistance(
            firstCandidate.node,
            firstIndex,
            secondCandidate.node,
            secondIndex,
          ),
        );
      }
      return candidatePairMinimumSpineDistanceCache.get(cacheKey);
    };
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
        (staticParentAttachmentForCandidate(candidates[0], index).pathVolumes ?? [])
          .map((volume) => ({
            ...volume,
            pinnedEndpointNodeIndex: index,
            pinnedEndpointNodeId: candidates[0]?.node?.id ?? null,
          }))
      ));
    const socketPositionKey = (socket) => [
      Number(socket.position.x).toFixed(3),
      Number(socket.position.y).toFixed(3),
      Number(socket.position.z).toFixed(3),
      Number(socket.facing?.x ?? 0).toFixed(3),
      Number(socket.facing?.z ?? 0).toFixed(3),
    ].join(':');
    const externalSpinePathKey = (
      fromIndex,
      fromLocalSocketId,
      toIndex,
      toLocalSocketId,
    ) => `${fromIndex}:${String(fromLocalSocketId ?? '')}>${toIndex}:${String(
      toLocalSocketId ?? '',
    )}`;
    const externalSpinePathBySocketPair = new Map();
    for (const record of coveragePlacement?.externalSpinePaths ?? []) {
      const path = cloneDungeonAugmentationValue(record.path ?? []);
      externalSpinePathBySocketPair.set(externalSpinePathKey(
        record.fromIndex,
        record.fromLocalSocketId,
        record.toIndex,
        record.toLocalSocketId,
      ), path);
      externalSpinePathBySocketPair.set(externalSpinePathKey(
        record.toIndex,
        record.toLocalSocketId,
        record.fromIndex,
        record.fromLocalSocketId,
      ), [...path].reverse());
    }
    const matchingExternalSpinePath = (
      fromSocket,
      toSocket,
      fromNode,
      toNode,
    ) => {
      const path = externalSpinePathBySocketPair.get(externalSpinePathKey(
        fromNode?.ordinal,
        fromSocket?.localSocketId,
        toNode?.ordinal,
        toSocket?.localSocketId,
      ));
      if (!Array.isArray(path) || path.length < 2
        || dungeonPointDistance(path[0], fromSocket?.position) > 1e-4
        || dungeonPointDistance(path.at(-1), toSocket?.position) > 1e-4) return null;
      return path;
    };
    const planningEndpointSeamCache = new Map();
    const planningEndpointSeam = (socket, node, role) => {
      // Placement candidates intentionally reuse the logical node/socket IDs
      // so the accepted plan remains stable. Their transforms are different,
      // however, and a seam is a physical record. Caching by identity alone
      // reused the first candidate's 15 cells and overlap envelope for every
      // translated/rotated candidate, falsely reporting endpoint-floor
      // overlap outside the seam. Include the exact candidate transform in
      // the cache key; the selected endpoint still derives one authoritative
      // record from its final socket.
      const key = `${String(node?.id ?? socket?.nodeId ?? '')}:${String(
        socket?.id ?? socket?.socketId ?? '',
      )}:${socketPositionKey(socket)}:${role}`;
      if (!planningEndpointSeamCache.has(key)) {
        const parentOverlap = (grant.socketLandingOverlapGrants ?? []).find((overlap) => (
          String(overlap.socketId ?? '') === String(socket?.id ?? socket?.socketId ?? '')
        ));
        planningEndpointSeamCache.set(key, createDungeonRouteEndpointSeam(socket, {
          id: `${operationId}:planning-endpoint-seam:${key}`,
          operationId,
          networkId: operationId,
          nodeId: node?.id ?? socket?.nodeId ?? socket?.roomId ?? null,
          socketId: socket?.id ?? socket?.socketId ?? null,
          localSocketId: socket?.localSocketId ?? null,
          role,
          elevationBand: node?.progressionBandId ?? grant.progressionBandId ?? null,
          parentOwnerId: enforceExactEmittedCoverageVolumes
            ? endpointSeamSharedOwnerId(socket, node)
            : parentOverlap?.parentOwnerId ?? null,
        }));
      }
      return planningEndpointSeamCache.get(key);
    };
    const routeOptionRespectsEndpointSeams = (
      routeOption,
      fromSocket,
      toSocket,
      fromNode,
      toNode,
    ) => {
      if (routeOption?.sharedEndpointFootprint?.kind === 'shared-junction-threshold') {
        return true;
      }
      if (!routePathHasExteriorSocketApproach(routeOption?.path, fromSocket, false)
        || !routePathHasExteriorSocketApproach(routeOption?.path, toSocket, true)) {
        return false;
      }
      const endpointRecords = [
        { node: fromNode, seam: planningEndpointSeam(fromSocket, fromNode, 'from') },
        { node: toNode, seam: planningEndpointSeam(toSocket, toNode, 'to') },
      ];
      if (!routePathHasExteriorSocketApproach(
        routeOption?.path,
        fromSocket,
        false,
        endpointRecords[0].seam,
      ) || !routePathHasExteriorSocketApproach(
        routeOption?.path,
        toSocket,
        true,
        endpointRecords[1].seam,
      )) return false;
      const collisionVolumes = routeSegmentPlanningCollisionVolumes(
        routeOption.path,
        fromSocket,
        toSocket,
        5.6,
        5.6,
      );
      return endpointRecords.every(({ node, seam }) => (
        routePlanningVolumesRespectEndpointNodeMask(collisionVolumes, node, seam)
      ));
    };
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
      )}:${String(fromNode?.id ?? '')}>${String(toNode?.id ?? '')}:${preferXFirst ? 'x' : 'z'}:${sharedThreshold
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
      const preselectedExternalPath = matchingExternalSpinePath(
        fromSocket,
        toSocket,
        fromNode,
        toNode,
      );
      const candidateOptions = [
        ...(sharedThreshold ? [sharedThreshold] : []),
        ...(preselectedExternalPath ? [{
          path: preselectedExternalPath,
          ordinal: -3,
          distanceMeters: featurelessPathDistance(preselectedExternalPath),
          pathVolumes: routePathPlanningVolumes(preselectedExternalPath),
          preselectedExternalPath: true,
        }] : []),
        ...paths.map((path, ordinal) => ({
        path,
        ordinal,
        distanceMeters: featurelessPathDistance(path),
        pathVolumes: routePathPlanningVolumes(path),
        })),
      ].map((routeOption) => {
        if (routeOption.sharedEndpointFootprint) return routeOption;
        const endpointSeams = [
          planningEndpointSeam(fromSocket, fromNode, 'from'),
          planningEndpointSeam(toSocket, toNode, 'to'),
        ];
        return {
          ...routeOption,
          endpointSeams,
          endpointSeamEnvelopes: endpointSeams.map(({ overlapEnvelope }) => (
            overlapEnvelope
          )),
          collisionVolumes: routeSegmentPlanningCollisionVolumes(
            routeOption.path,
            fromSocket,
            toSocket,
            5.6,
            5.6,
          ),
        };
      });
      const exteriorApproachEligible = candidateOptions.filter((routeOption) => (
        routeOption?.sharedEndpointFootprint?.kind === 'shared-junction-threshold'
          || (routePathHasExteriorSocketApproach(
            routeOption?.path,
            fromSocket,
            false,
            routeOption.endpointSeams?.[0],
          ) && routePathHasExteriorSocketApproach(
            routeOption?.path,
            toSocket,
            true,
            routeOption.endpointSeams?.[1],
          ))
      ));
      const fromNodeMaskEligible = exteriorApproachEligible.filter((routeOption) => (
        routeOption?.sharedEndpointFootprint?.kind === 'shared-junction-threshold'
          || routePlanningVolumesRespectEndpointNodeMask(
            routeOption.collisionVolumes ?? routeOption.pathVolumes,
            fromNode,
            routeOption.endpointSeams?.[0],
          )
      ));
      const toNodeMaskEligible = fromNodeMaskEligible.filter((routeOption) => (
        routeOption?.sharedEndpointFootprint?.kind === 'shared-junction-threshold'
          || routePlanningVolumesRespectEndpointNodeMask(
            routeOption.collisionVolumes ?? routeOption.pathVolumes,
            toNode,
            routeOption.endpointSeams?.[1],
          )
      ));
      const positiveLengthOptions = toNodeMaskEligible.filter(({
        path,
        sharedEndpointFootprint,
      }) => (
        sharedEndpointFootprint || measureDungeonPolyline(path) > 1e-6
      ));
      const withinFeaturelessSpanOptions = positiveLengthOptions.filter(({
        distanceMeters,
      }) => distanceMeters <= maximumSpan + 1e-6);
      // These staged predicates are the authoritative seam checks, retained
      // separately so a rejected solve identifies the exact stage without
      // evaluating every floor-mask overlap twice.
      const orderedPaths = withinFeaturelessSpanOptions.sort((first, second) => (
        first.distanceMeters - second.distanceMeters
          || first.ordinal - second.ordinal
      ));
      orderedPaths.routeSelectionDiagnostics = {
        rawRouteCandidateCount: paths.length,
        candidateOptionCount: candidateOptions.length,
        exteriorApproachEligibleCount: exteriorApproachEligible.length,
        fromNodeMaskEligibleCount: fromNodeMaskEligible.length,
        toNodeMaskEligibleCount: toNodeMaskEligible.length,
        positiveLengthCount: positiveLengthOptions.length,
        withinFeaturelessSpanCount: withinFeaturelessSpanOptions.length,
        routeOptionCount: orderedPaths.length,
      };
      socketRouteOptionsCache.set(cacheKey, orderedPaths);
      return orderedPaths;
    };
    const routeOptionHasStaticCollision = (routeOption, overlapGrants = []) => {
      const routeVolumes = routeOption.collisionVolumes ?? routeOption.pathVolumes ?? [];
      const authoritativeOverlapGrants = [
        ...(routeOption.endpointSeamEnvelopes ?? []),
        ...overlapGrants,
      ];
      if (authoritativeOverlapGrants.length === 0) {
        if (!staticRouteOptionCollisionCache.has(routeOption)) {
          staticRouteOptionCollisionCache.set(
            routeOption,
            indexedStaticPathVolumesHaveCollision(routeVolumes)
              || routeVolumes.some((pathVolume) => (
                pinnedParentAttachmentPathVolumes.some((attachmentVolume) => (
                  planningVolumesOverlap(pathVolume, attachmentVolume)
                ))
              )),
          );
        }
        return staticRouteOptionCollisionCache.get(routeOption);
      }
      return routeVolumes.some((pathVolume) => (
        [...nearbyStaticAvoidanceVolumes(pathVolume), ...pinnedParentAttachmentPathVolumes]
          .some((obstacle) => (
          planningVolumesOverlap(pathVolume, obstacle)
            && !planningOverlapIsGranted(
              pathVolume,
              obstacle,
              authoritativeOverlapGrants,
            )
          ))
      ));
    };
    const routeOptionStaticCollisionDiagnostics = (routeOption, overlapGrants = []) => {
      const routeVolumes = routeOption.collisionVolumes ?? routeOption.pathVolumes ?? [];
      const authoritativeOverlapGrants = [
        ...(routeOption.endpointSeamEnvelopes ?? []),
        ...overlapGrants,
      ];
      const indexedStaticCollisions = routeVolumes.flatMap((pathVolume) => (
        [...nearbyStaticAvoidanceVolumes(pathVolume)].filter((obstacle) => (
          planningVolumesOverlap(pathVolume, obstacle)
            && !planningOverlapIsGranted(
              pathVolume,
              obstacle,
              authoritativeOverlapGrants,
            )
        ))
      ));
      const pinnedAttachmentCollisions = routeVolumes.flatMap((pathVolume) => (
        pinnedParentAttachmentPathVolumes.filter((obstacle) => (
          planningVolumesOverlap(pathVolume, obstacle)
            && !planningOverlapIsGranted(
              pathVolume,
              obstacle,
              authoritativeOverlapGrants,
            )
        ))
      ));
      return {
        indexedStaticCollisionCount: indexedStaticCollisions.length,
        indexedStaticCollisionIds: [...new Set(indexedStaticCollisions.map((obstacle) => (
          String(obstacle.id ?? obstacle.ownerId ?? 'unknown')
        )))].slice(0, 12),
        pinnedAttachmentCollisionCount: pinnedAttachmentCollisions.length,
        pinnedEndpointNodeIndices: [...new Set(pinnedAttachmentCollisions.map((obstacle) => (
          Number(obstacle.pinnedEndpointNodeIndex)
        )))].filter(Number.isFinite).sort((first, second) => first - second),
      };
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
      ).find((routeOption) => !routeOptionHasStaticCollision(routeOption)) ?? null;
      staticSocketRouteWitnessCache.set(cacheKey, witness);
      return witness;
    };
    const endpointFeaturelessPrefixMeters = (candidate, index, throughLocalSocketId) => {
      const node = candidate?.node;
      if (routeNetworkNodeResetsFeaturelessDistance(node)) return 0;
      const parentAttachment = staticParentAttachmentForCandidate(candidate, index);
      if (!parentAttachment?.compatible) return Number.POSITIVE_INFINITY;
      return Number(parentAttachment.distanceMeters ?? 0)
        + connectorModuleCoreTraversalDistance(node, 'entry', throughLocalSocketId);
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
      const cacheKey = physicalPairCacheKey(
        fromCandidate,
        fromIndex,
        toCandidate,
        toIndex,
      );
      if (physicalPairCompatibilityCache.has(cacheKey)) {
        return physicalPairCompatibilityCache.get(cacheKey);
      }
      const pairCompatibilityStartedAt = planningNowMilliseconds();
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
          const declaredExternalSpinePath = externalSpinePathBySocketPair.get(
            externalSpinePathKey(
              fromCandidate.node?.ordinal,
              fromSocket.localSocketId,
              toCandidate.node?.ordinal,
              toSocket.localSocketId,
            ),
          ) ?? null;
          const routeOptions = orderedSocketRouteOptions(
            fromSocket,
            toSocket,
            true,
            fromCandidate.node,
            toCandidate.node,
          );
          const routeSelectionDiagnostics = routeOptions.routeSelectionDiagnostics ?? {
            rawRouteCandidateCount,
            candidateOptionCount: rawRouteCandidateCount,
            exteriorApproachEligibleCount: null,
            fromNodeMaskEligibleCount: null,
            toNodeMaskEligibleCount: null,
            positiveLengthCount: null,
            withinFeaturelessSpanCount: null,
            routeOptionCount: routeOptions.length,
          };
          const routeOptionCount = routeOptions.length;
          const optionCollisionDiagnostics = routeOptions.map((routeOption) => ({
            distanceMeters: routeOption.distanceMeters,
            ...routeOptionStaticCollisionDiagnostics(routeOption),
          }));
          const exactRouteOptionStaticCollisionFreeCount = optionCollisionDiagnostics
            .filter((diagnostics) => (
              diagnostics.indexedStaticCollisionCount === 0
                && diagnostics.pinnedAttachmentCollisionCount === 0
            )).length;
          const endpointPrefixMeters = endpointFeaturelessPrefixMeters(
            fromCandidate,
            fromIndex,
            fromSocket.localSocketId,
          ) + endpointFeaturelessPrefixMeters(
            toCandidate,
            toIndex,
            toSocket.localSocketId,
          );
          const socketPairDiagnostics = {
              fromLocalSocketId: fromSocket.localSocketId,
              toLocalSocketId: toSocket.localSocketId,
              connectorFamily,
              rawRouteCandidateCount,
              routeOptionCount,
              routeSelectionDiagnostics,
              endpointPrefixMeters,
              accumulatedFeaturelessDistancesMeters: routeOptions.slice(0, 8)
                .map(({ distanceMeters }) => distanceMeters + endpointPrefixMeters),
              exactRouteOptionStaticCollisionFreeCount,
              optionCollisionDiagnostics: optionCollisionDiagnostics.slice(0, 8),
              declaredExternalSpinePath: Boolean(declaredExternalSpinePath),
              externalSpineStartDeltaMeters: declaredExternalSpinePath
                ? dungeonPointDistance(declaredExternalSpinePath[0], fromSocket.position)
                : null,
              externalSpineEndDeltaMeters: declaredExternalSpinePath
                ? dungeonPointDistance(declaredExternalSpinePath.at(-1), toSocket.position)
                : null,
              fromPosition: cloneDungeonAugmentationValue(fromSocket.position),
              toPosition: cloneDungeonAugmentationValue(toSocket.position),
              fromFacing: cloneDungeonAugmentationValue(fromSocket.facing),
              toFacing: cloneDungeonAugmentationValue(toSocket.facing),
              minimumRawFeaturelessDistanceMeters: rawRouteCandidates.length > 0
                ? Math.min(...rawRouteCandidates.map(featurelessPathDistance))
                : null,
            };
          if (edgeDiagnostics.socketPairCandidateCounts.length < 16) {
            edgeDiagnostics.socketPairCandidateCounts.push(socketPairDiagnostics);
          }
          if (routeOptionCount > 0
            && edgeDiagnostics.eligibleSocketPairCandidateCounts.length < 16) {
            edgeDiagnostics.eligibleSocketPairCandidateCounts.push(socketPairDiagnostics);
          }
          edgeDiagnostics.routeStageTotals.socketPairCount += 1;
          for (const key of [
            'rawRouteCandidateCount',
            'exteriorApproachEligibleCount',
            'fromNodeMaskEligibleCount',
            'toNodeMaskEligibleCount',
            'positiveLengthCount',
            'withinFeaturelessSpanCount',
            'routeOptionCount',
          ]) {
            const count = Number(routeSelectionDiagnostics[key]);
            if (Number.isFinite(count)) edgeDiagnostics.routeStageTotals[key] += count;
          }
          edgeDiagnostics.routeStageTotals.exactRouteOptionStaticCollisionFreeCount +=
            exactRouteOptionStaticCollisionFreeCount;
          edgeDiagnostics.routeStageTotals.indexedStaticCollisionCount +=
            optionCollisionDiagnostics.reduce((sum, diagnostics) => (
              sum + diagnostics.indexedStaticCollisionCount
            ), 0);
          edgeDiagnostics.routeStageTotals.pinnedAttachmentCollisionCount +=
            optionCollisionDiagnostics.reduce((sum, diagnostics) => (
              sum + diagnostics.pinnedAttachmentCollisionCount
            ), 0);
          const witness = staticSocketRouteWitness(
            fromSocket,
            toSocket,
            true,
            fromIndex,
            toIndex,
            fromCandidate.node,
            toCandidate.node,
          );
          const accumulatedFeaturelessDistanceMeters = witness
            ? Number(witness.distanceMeters) + endpointPrefixMeters
            : Number.POSITIVE_INFINITY;
          if (witness
            && accumulatedFeaturelessDistanceMeters <= maximumSpan + 1e-6) {
            edgeDiagnostics.routeStageTotals.staticCollisionFreeCount += 1;
            bestRoute = {
              path: witness.path,
              collisionScore: 0,
              distanceMeters: witness.distanceMeters,
              accumulatedFeaturelessDistanceMeters,
            };
            compatible = true;
            break;
          }
          const blockedRoute = routeOptions
            .map((routeOption) => ({
              path: routeOption.path,
              distanceMeters: routeOption.distanceMeters,
              collisionScore: planningRouteVolumesCollisionScore(
                routeOption.collisionVolumes ?? routeOption.pathVolumes ?? [],
                staticAvoidanceVolumes,
                routeOption.endpointSeamEnvelopes ?? [],
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
      physicalPlanningPhaseTimings.pairCompatibilityMs +=
        planningNowMilliseconds() - pairCompatibilityStartedAt;
      physicalPlanningPhaseTimings.pairCompatibilityEvaluations += 1;
      return compatible;
    };
    const adjacentPairHasRouteShape = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      const ordered = firstIndex <= secondIndex
        ? [firstCandidate, firstIndex, secondCandidate, secondIndex]
        : [secondCandidate, secondIndex, firstCandidate, firstIndex];
      const [fromCandidate, fromIndex, toCandidate, toIndex] = ordered;
      if (!coverageRequiredEdgeForPair(fromIndex, toIndex)) return false;
      const cacheKey = physicalPairCacheKey(
        fromCandidate,
        fromIndex,
        toCandidate,
        toIndex,
      );
      if (physicalPairRouteShapeCache.has(cacheKey)) {
        return physicalPairRouteShapeCache.get(cacheKey);
      }
      // This cache is deliberately geometry-only. Static obstacle collision
      // belongs to the bounded exact stage; evaluating it while scanning the
      // complete candidate pool bypasses the solver's cheap/exact budgets and
      // made a single repair perform tens of thousands of full route tests.
      const hasRouteShape = availableSpineSockets(
        fromCandidate.node,
        fromIndex,
        toIndex,
      ).some((fromSocket) => availableSpineSockets(
        toCandidate.node,
        toIndex,
        fromIndex,
      ).some((toSocket) => orderedSocketRouteOptions(
        fromSocket,
        toSocket,
        true,
        fromCandidate.node,
        toCandidate.node,
      ).length > 0));
      physicalPairRouteShapeCache.set(cacheKey, hasRouteShape);
      return hasRouteShape;
    };
    const adjacentCandidatesCompatible = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      return candidatePairNodeCollisionScore(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      ) === 0
        && candidatePairMinimumSpineDistance(
          firstCandidate,
          firstIndex,
          secondCandidate,
          secondIndex,
        ) <= maximumSpan + 1e-6
        && adjacentPairHasPhysicalRoute(
          firstCandidate,
          firstIndex,
          secondCandidate,
          secondIndex,
        );
    };
    const stackedCompoundPairIndices = coveragePlacement?.stackedInterchangeCompound
      ? new Set([
        Number(coveragePlacement.stackedInterchangeCompound.kitNodeIndex),
        Number(coveragePlacement.stackedInterchangeCompound.supportNodeIndex),
      ])
      : null;
    const isStackedCompoundPair = (firstIndex, secondIndex) => (
      stackedCompoundPairIndices?.size === 2
        && stackedCompoundPairIndices.has(Number(firstIndex))
        && stackedCompoundPairIndices.has(Number(secondIndex))
    );
    const routeHorizontalBendCount = (path = []) => {
      const directions = [];
      for (let index = 1; index < path.length; index += 1) {
        const deltaX = Number(path[index].x) - Number(path[index - 1].x);
        const deltaZ = Number(path[index].z) - Number(path[index - 1].z);
        if (Math.hypot(deltaX, deltaZ) <= 1e-6) continue;
        const direction = toDungeonCardinalFacing({ x: deltaX, z: deltaZ });
        const previous = directions.at(-1);
        if (!previous
          || Math.abs(previous.x - direction.x) > 1e-6
          || Math.abs(previous.z - direction.z) > 1e-6) directions.push(direction);
      }
      return Math.max(0, directions.length - 1);
    };
    const stackedCompoundCompatibilityCache = new Map();
    const stackedCompoundCandidatesCompatible = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      if (!isStackedCompoundPair(firstIndex, secondIndex)) return true;
      const compound = coveragePlacement.stackedInterchangeCompound;
      const kitIsFirst = Number(firstIndex) === Number(compound.kitNodeIndex);
      const kitCandidate = kitIsFirst ? firstCandidate : secondCandidate;
      const supportCandidate = kitIsFirst ? secondCandidate : firstCandidate;
      const cacheKey = `${candidatePhysicalKey(
        kitCandidate,
        compound.kitNodeIndex,
      )}>${candidatePhysicalKey(supportCandidate, compound.supportNodeIndex)}`;
      if (stackedCompoundCompatibilityCache.has(cacheKey)) {
        return stackedCompoundCompatibilityCache.get(cacheKey);
      }
      const pairCompatibilityStartedAt = planningNowMilliseconds();
      const kitSocket = getNodeSocket(kitCandidate.node, compound.kitLocalSocketId);
      const supportSocket = getNodeSocket(
        supportCandidate.node,
        compound.supportLocalSocketId,
      );
      const compatible = Boolean(kitSocket && supportSocket) && orderedSocketRouteOptions(
        kitSocket,
        supportSocket,
        true,
        kitCandidate.node,
        supportCandidate.node,
      ).some((routeOption) => (
        routeHorizontalBendCount(routeOption.path) <= 1
          && !routeOptionHasStaticCollision(routeOption)
      ));
      stackedCompoundCompatibilityCache.set(cacheKey, compatible);
      physicalPlanningPhaseTimings.pairCompatibilityMs +=
        planningNowMilliseconds() - pairCompatibilityStartedAt;
      physicalPlanningPhaseTimings.pairCompatibilityEvaluations += 1;
      return compatible;
    };
    const stackedCompoundCandidatesMeetCheapBounds = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      if (!isStackedCompoundPair(firstIndex, secondIndex)) return true;
      const compound = coveragePlacement.stackedInterchangeCompound;
      const kitCandidate = Number(firstIndex) === Number(compound.kitNodeIndex)
        ? firstCandidate
        : secondCandidate;
      const supportCandidate = Number(firstIndex) === Number(compound.supportNodeIndex)
        ? firstCandidate
        : secondCandidate;
      const kitSocket = getNodeSocket(kitCandidate.node, compound.kitLocalSocketId);
      const supportSocket = getNodeSocket(
        supportCandidate.node,
        compound.supportLocalSocketId,
      );
      if (!kitSocket || !supportSocket) return false;
      if (dungeonPointDistance(kitSocket.position, supportSocket.position)
        > ROUTE_NETWORK_SOCKET_APPROACH_METERS * 4 + 1e-6) return false;
      // Preserve the cheap/exact split while applying the complete authored
      // compound route shape here. Static collision remains an exact check,
      // but pairs which cannot align the named sockets with at most one bend
      // must never consume the 32-check collision budget.
      return orderedSocketRouteOptions(
        kitSocket,
        supportSocket,
        true,
        kitCandidate.node,
        supportCandidate.node,
      ).some((routeOption) => routeHorizontalBendCount(routeOption.path) <= 1);
    };
    const adjacentCandidatesMeetCheapBounds = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      const cachedCompatibility = physicalPairCompatibilityCache.get(
        physicalPairCacheKey(
          firstCandidate,
          firstIndex,
          secondCandidate,
          secondIndex,
        ),
      );
      return candidatePairNodeCollisionScore(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      ) === 0
        && cachedCompatibility !== false
        && candidatePairMinimumSpineDistance(
          firstCandidate,
          firstIndex,
          secondCandidate,
          secondIndex,
        ) <= maximumSpan + 1e-6
        // The correlated reservoir is deliberately allowed only 32 exact
        // collision checks. Apply the same authoritative seam/mask route-shape
        // predicate here (without static collision) so that budget is never
        // spent on pairs which cannot produce a physical path at all.
        && adjacentPairHasRouteShape(
          firstCandidate,
          firstIndex,
          secondCandidate,
          secondIndex,
        );
    };
    const candidatePairSatisfiesPlacementConstraints = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      if (candidatePairNodeCollisionScore(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      ) > 0) return false;
      if (!candidatePairRespectsParentAttachments(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      )) return false;
      if (!stackedCompoundCandidatesCompatible(
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
    // Every coverage chain needs the same global candidate correlation. A
    // numeric 0 -> 1 -> 2 -> 3 -> 4 chain can lose its only valid continuation
    // to the 64-candidate per-node sweep just as a rewired compound can.
    const requiresCorrelatedPlacementReservation = coverageRequiredEdges.length > 0;
    const boundedPlacementCandidatesByIndex = new Map(
      placementCandidateGroups.map(({ index, candidates }) => [index, [...candidates]]),
    );
    let correlatedPlacementReservation = {
      status: requiresCorrelatedPlacementReservation ? 'not-invoked' : 'not-required',
      pairEvaluations: 0,
      exactPairEvaluations: 0,
      cheapPairEvaluations: 0,
      cheapPairCount: 0,
      prunedCandidateCount: 0,
      reservedByIndex: new Map(),
    };
    const correlatedCheapStageDiagnostics = new Map();
    const correlatedPairPassesCheapBounds = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
    ) => {
      const edgeKey = `${firstIndex}>${secondIndex}`;
      const diagnostics = correlatedCheapStageDiagnostics.get(edgeKey) ?? {
        edgeKey,
        evaluatedCount: 0,
        nodeCollisionPassCount: 0,
        parentAttachmentPassCount: 0,
        compoundShapePassCount: 0,
        adjacentShapePassCount: 0,
      };
      diagnostics.evaluatedCount += 1;
      correlatedCheapStageDiagnostics.set(edgeKey, diagnostics);
      if (candidatePairNodeCollisionScore(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      ) > 0) return false;
      diagnostics.nodeCollisionPassCount += 1;
      if (!candidatePairRespectsParentAttachments(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      )) return false;
      diagnostics.parentAttachmentPassCount += 1;
      if (!stackedCompoundCandidatesMeetCheapBounds(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      )) return false;
      diagnostics.compoundShapePassCount += 1;
      if (coverageRequiredEdgeForPair(firstIndex, secondIndex)
        && !adjacentCandidatesMeetCheapBounds(
          firstCandidate,
          firstIndex,
          secondCandidate,
          secondIndex,
        )) return false;
      diagnostics.adjacentShapePassCount += 1;
      return true;
    };
    const correlatedPairClearsAssignedCandidates = (
      firstCandidate,
      firstIndex,
      secondCandidate,
      secondIndex,
      assignedCandidates,
    ) => {
      const otherCandidateVolumes = [...assignedCandidates.entries()]
        .filter(([index]) => index !== firstIndex && index !== secondIndex)
        .flatMap(([, candidate]) => candidateNodeVolumes(candidate));
       return availableSpineSockets(
        firstCandidate.node,
        firstIndex,
        secondIndex,
      ).some((fromSocket) => availableSpineSockets(
        secondCandidate.node,
        secondIndex,
        firstIndex,
      ).some((toSocket) => orderedSocketRouteOptions(
        fromSocket,
        toSocket,
        true,
        firstCandidate.node,
        secondCandidate.node,
       ).some((routeOption) => (
         !routeOptionHasStaticCollision(routeOption)
          && (routeOption.collisionVolumes ?? routeOption.pathVolumes ?? [])
            .every((pathVolume) => (
            otherCandidateVolumes.every((obstacle) => (
              !planningVolumesOverlap(pathVolume, obstacle)
            ))
            ))
      ))));
    };
    const correlatedPrefixSocketAssignmentCache = new Map();
    const correlatedPrefixHasInjectiveSocketAssignment = (assignedCandidates) => {
      const assignedEdges = coverageRequiredEdges.filter(({ fromIndex, toIndex }) => (
        assignedCandidates.has(fromIndex) && assignedCandidates.has(toIndex)
      ));
      if (assignedEdges.length <= 1) return true;
      const cacheKey = [...assignedCandidates.entries()]
        .sort((first, second) => first[0] - second[0])
        .map(([index, candidate]) => candidatePhysicalKey(candidate, index))
        .join('|socket-prefix|');
      if (correlatedPrefixSocketAssignmentCache.has(cacheKey)) {
        return correlatedPrefixSocketAssignmentCache.get(cacheKey);
      }
      const socketClaimsByConstraint = assignedEdges.map(({ fromIndex, toIndex }) => {
        const fromCandidate = assignedCandidates.get(fromIndex);
        const toCandidate = assignedCandidates.get(toIndex);
        const pairKeys = new Set();
        const pairs = [];
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
            const hasStaticClearRoute = orderedSocketRouteOptions(
              fromSocket,
              toSocket,
              true,
              fromCandidate.node,
              toCandidate.node,
            ).some((routeOption) => (
              !routeOptionHasStaticCollision(routeOption)
            ));
            if (!hasStaticClearRoute) continue;
            const pairKey = `${String(fromSocket.localSocketId)}>${String(
              toSocket.localSocketId,
            )}`;
            if (pairKeys.has(pairKey)) continue;
            pairKeys.add(pairKey);
            pairs.push({ claims: [
              { nodeIndex: fromIndex, localSocketId: String(fromSocket.localSocketId) },
              { nodeIndex: toIndex, localSocketId: String(toSocket.localSocketId) },
            ] });
          }
        }
        return pairs;
      });
      if (socketClaimsByConstraint.some((pairs) => pairs.length === 0)) {
        correlatedPrefixSocketAssignmentCache.set(cacheKey, false);
        return false;
      }
      const edgeOrdinals = socketClaimsByConstraint
        .map((pairs, edgeOrdinal) => ({ edgeOrdinal, pairCount: pairs.length }))
        .sort((first, second) => first.pairCount - second.pairCount
          || first.edgeOrdinal - second.edgeOrdinal)
        .map(({ edgeOrdinal }) => edgeOrdinal);
      const usedSocketIdsByNodeIndex = new Map(
        [...assignedCandidates.keys()].map((nodeIndex) => [
          nodeIndex,
          new Set(endpointNodeIndexSet.has(nodeIndex) ? ['entry'] : []),
        ]),
      );
      const visitEdge = (ordinal) => {
        if (ordinal >= edgeOrdinals.length) return true;
        for (const { claims } of socketClaimsByConstraint[edgeOrdinals[ordinal]]) {
          if (claims.some(({ nodeIndex, localSocketId }) => (
            usedSocketIdsByNodeIndex.get(nodeIndex).has(localSocketId)
          ))) continue;
          for (const { nodeIndex, localSocketId } of claims) {
            usedSocketIdsByNodeIndex.get(nodeIndex).add(localSocketId);
          }
          if (visitEdge(ordinal + 1)) return true;
          for (const { nodeIndex, localSocketId } of claims) {
            usedSocketIdsByNodeIndex.get(nodeIndex).delete(localSocketId);
          }
        }
        return false;
      };
      const compatible = visitEdge(0);
      correlatedPrefixSocketAssignmentCache.set(cacheKey, compatible);
      return compatible;
    };
    const correlatedCandidateGroupByIndex = new Map(
      placementCandidateGroups.map((group) => [Number(group.index), group]),
    );
    const correlatedFutureSupportCache = new Map();
    const candidateHasBoundedFutureSupport = (
      candidate,
      candidateIndex,
      futureIndex,
    ) => {
      const cacheKey = `${candidatePhysicalKey(candidate, candidateIndex)}>${futureIndex}`;
      if (correlatedFutureSupportCache.has(cacheKey)) {
        return correlatedFutureSupportCache.get(cacheKey);
      }
      const futureGroup = correlatedCandidateGroupByIndex.get(Number(futureIndex));
      const supported = (futureGroup?.candidates ?? []).some((futureCandidate) => (
        candidatePairNodeCollisionScore(
          candidate,
          candidateIndex,
          futureCandidate,
          futureIndex,
        ) === 0
          && candidatePairMinimumSpineDistance(
            candidate,
            candidateIndex,
            futureCandidate,
            futureIndex,
          ) <= maximumSpan + 1e-6
          && (!futureGroup?.endpoint || adjacentPairHasRouteShape(
            candidate,
            candidateIndex,
            futureCandidate,
            futureIndex,
          ))
      ));
      correlatedFutureSupportCache.set(cacheKey, supported);
      return supported;
    };
    const attemptCorrelatedPlacementReservation = (
      failedFirstIndex,
      failedSecondIndex,
    ) => {
      const orientedEdges = orientOrderedCandidateChainAtFailure(
        coverageRequiredEdges,
        failedFirstIndex,
        failedSecondIndex,
      );
      const prefilterEdgeCandidatesForOrder = (edgeOrder) => (
        candidates,
        fromCandidate,
        fromIndex,
        toIndex,
        edgeOrdinal,
      ) => {
        const nextEdge = edgeOrder[edgeOrdinal + 1] ?? null;
        const ranked = Array.from({ length: 6 }, () => []);
        for (const toCandidate of candidates) {
          if (candidatePairMinimumSpineDistance(
            fromCandidate,
            fromIndex,
            toCandidate,
            toIndex,
          ) > maximumSpan + 1e-6) continue;
          const compatibility = physicalPairCompatibilityCache.get(
            physicalPairCacheKey(
              fromCandidate,
              fromIndex,
              toCandidate,
              toIndex,
            ),
          );
          const futureSupported = !nextEdge || nextEdge.fromIndex !== toIndex
            || candidateHasBoundedFutureSupport(
              toCandidate,
              toIndex,
              nextEdge.toIndex,
            );
          const compatibilityRank = compatibility === true
            ? 0
            : compatibility === false ? 2 : 1;
          ranked[compatibilityRank * 2 + Number(!futureSupported)].push(toCandidate);
        }
        return ranked.flat();
      };
      const reservationOptions = {
      candidateGroups: placementCandidateGroups,
      candidateKey: candidatePhysicalKey,
      maxPairEvaluations: 32,
      maxCheapPairEvaluations: 16384,
      // Retain at most two continuations for each 32-node layer. A single
      // continuation could be static-clear yet cross the already paired
      // compound kit; 96 per predecessor overfilled the fixed cheap budget.
      candidateWindowSize: 64,
      maximumLayerCandidates: 32,
      pairPassesCheapBounds: correlatedPairPassesCheapBounds,
      pairClearsAssignedCandidates: correlatedPairClearsAssignedCandidates,
      prefixIsCompatible: correlatedPrefixHasInjectiveSocketAssignment,
      prefilterEdgeCandidates: prefilterEdgeCandidatesForOrder(orientedEdges),
      pairIsCompatible: candidatePairSatisfiesPlacementConstraints,
      pairCompatibilityIsKnown: (
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      ) => physicalPairCompatibilityCache.has(physicalPairCacheKey(
        firstCandidate,
        firstIndex,
        secondCandidate,
        secondIndex,
      )),
      compareEdgeCandidates: (
        firstCandidate,
        secondCandidate,
        fromCandidate,
        fromIndex,
        toIndex,
      ) => {
        const firstCachedCompatibility = physicalPairCompatibilityCache.get(
          physicalPairCacheKey(
            fromCandidate,
            fromIndex,
            firstCandidate,
            toIndex,
          ),
        );
        const secondCachedCompatibility = physicalPairCompatibilityCache.get(
          physicalPairCacheKey(
            fromCandidate,
            fromIndex,
            secondCandidate,
            toIndex,
          ),
        );
        const compatibilityRank = (compatibility) => (
          compatibility === true ? 0 : compatibility === false ? 2 : 1
        );
        return compatibilityRank(firstCachedCompatibility)
          - compatibilityRank(secondCachedCompatibility)
          || candidatePairMinimumSpineDistance(
          fromCandidate,
          fromIndex,
          firstCandidate,
          toIndex,
        ) - candidatePairMinimumSpineDistance(
          fromCandidate,
          fromIndex,
          secondCandidate,
          toIndex,
        )
          || Number(firstCandidate.displacement ?? 0)
            - Number(secondCandidate.displacement ?? 0)
          || Number(firstCandidate.center.x) - Number(secondCandidate.center.x)
          || Number(firstCandidate.center.y) - Number(secondCandidate.center.y)
          || Number(firstCandidate.center.z) - Number(secondCandidate.center.z)
          || Number(firstCandidate.facing?.x ?? 0) - Number(secondCandidate.facing?.x ?? 0)
          || Number(firstCandidate.facing?.z ?? 0) - Number(secondCandidate.facing?.z ?? 0);
      },
    };
      const chainReservation = reserveOrderedCandidateChain({
        ...reservationOptions,
        orderedEdges: orientedEdges,
      });
      if (chainReservation.status !== 'unsupported-chain') return chainReservation;
      const orientedTreeEdges = orientOrderedCandidateTreeAtFailure(
        coverageRequiredEdges,
        failedFirstIndex,
        failedSecondIndex,
      );
      return reserveOrderedCandidateTree({
        ...reservationOptions,
        orderedEdges: orientedTreeEdges,
        prefilterEdgeCandidates: prefilterEdgeCandidatesForOrder(orientedTreeEdges),
      });
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
    const summarizePlacementPairRejections = (
      firstGroup,
      secondGroup,
      firstCandidates,
      secondCandidates,
    ) => {
      const summary = {
        candidatePairCount: firstCandidates.length * secondCandidates.length,
        compatibleCount: 0,
        nodeCollisionRejectedCount: 0,
        parentAttachmentRejectedCount: 0,
        stackedCompoundRejectedCount: 0,
        minimumSpineDistanceRejectedCount: 0,
        exactPhysicalRouteRejectedCount: 0,
        exactPhysicalRouteNotEvaluatedCount: 0,
      };
      const requiredEdge = coverageRequiredEdgeForPair(firstGroup.index, secondGroup.index);
      for (const firstCandidate of firstCandidates) {
        for (const secondCandidate of secondCandidates) {
          if (candidatePairNodeCollisionScore(
            firstCandidate,
            firstGroup.index,
            secondCandidate,
            secondGroup.index,
          ) > 0) {
            summary.nodeCollisionRejectedCount += 1;
            continue;
          }
          if (!candidatePairRespectsParentAttachments(
            firstCandidate,
            firstGroup.index,
            secondCandidate,
            secondGroup.index,
          )) {
            summary.parentAttachmentRejectedCount += 1;
            continue;
          }
          if (!stackedCompoundCandidatesCompatible(
            firstCandidate,
            firstGroup.index,
            secondCandidate,
            secondGroup.index,
          )) {
            summary.stackedCompoundRejectedCount += 1;
            continue;
          }
          if (!requiredEdge) {
            summary.compatibleCount += 1;
            continue;
          }
          if (candidatePairMinimumSpineDistance(
            firstCandidate,
            firstGroup.index,
            secondCandidate,
            secondGroup.index,
          ) > maximumSpan + 1e-6) {
            summary.minimumSpineDistanceRejectedCount += 1;
            continue;
          }
          const routeState = physicalPairCompatibilityCache.get(physicalPairCacheKey(
            firstCandidate,
            firstGroup.index,
            secondCandidate,
            secondGroup.index,
          ));
          if (routeState === true) summary.compatibleCount += 1;
          else if (routeState === false) summary.exactPhysicalRouteRejectedCount += 1;
          else summary.exactPhysicalRouteNotEvaluatedCount += 1;
        }
      }
      return summary;
    };
    // Arc-consistency covers both neighboring spine modules and every binary
    // endpoint-to-module pair. The latter is essential: a non-adjacent room
    // can otherwise consume an endpoint's only clear two-tile parent approach,
    // leaving the expensive full-layout solver to discover the conflict late.
    const initialPlacementCandidateCounts = placementCandidateGroups.map(({ index, candidates }) => ({
      nodeIndex: index,
      count: candidates.length,
    }));
    const arcConsistencyHistory = [];
    let arcIteration = 0;
    let correlatedRepairAttempted = false;
    const finalizeCorrelatedCandidateDiagnostics = () => {
      for (const group of placementCandidateGroups) {
        group.diagnostics.correlatedCandidatePoolCount = group.candidatePool?.length ?? 0;
        group.diagnostics.correlatedCandidateReserved =
          correlatedPlacementReservation.reservedByIndex.has(group.index);
        group.diagnostics.correlatedCandidateReservationStatus =
          correlatedPlacementReservation.status;
        delete group.candidatePool;
      }
    };
    arcConsistencyPass:
    while (true) {
      let arcChanged = true;
      while (arcChanged) {
        arcChanged = false;
        const currentArcIteration = arcIteration;
        arcIteration += 1;
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
          arcConsistencyHistory.push({
            iteration: currentArcIteration,
            firstNodeIndex: firstGroup.index,
            secondNodeIndex: secondGroup.index,
            adjacent,
            parentAttachment,
            beforeFirstCount: originalFirstCandidates.length,
            afterFirstCount: firstCandidates.length,
            beforeSecondCount: originalSecondCandidates.length,
            afterSecondCount: secondCandidates.length,
          });
        }
        if (firstCandidates.length === 0 || secondCandidates.length === 0) {
          if (requiresCorrelatedPlacementReservation
            && shouldAttemptCorrelatedPlacementRepair({
              orderedEdges: coverageRequiredEdges,
              failedFirstIndex: firstGroup.index,
              failedSecondIndex: secondGroup.index,
              alreadyAttempted: correlatedRepairAttempted,
            })) {
            correlatedRepairAttempted = true;
            const failedPlacementCandidatesByIndex = new Map(
              placementCandidateGroups.map(({ index, candidates }) => [index, candidates]),
            );
            for (const group of placementCandidateGroups) {
              group.candidates = [
                ...(boundedPlacementCandidatesByIndex.get(group.index) ?? []),
              ];
            }
            correlatedPlacementReservation = attemptCorrelatedPlacementReservation(
              firstGroup.index,
              secondGroup.index,
            );
            correlatedPlacementReservation.cheapStageDiagnostics = [
              ...correlatedCheapStageDiagnostics.values(),
            ];
            if (correlatedPlacementReservation.status === 'reserved') {
              for (const group of placementCandidateGroups) {
                const reservedCandidate =
                  correlatedPlacementReservation.reservedByIndex.get(group.index);
                if (!reservedCandidate) continue;
                group.candidates = mergeReservedPlacementCandidates(
                  group.candidates,
                  [reservedCandidate],
                  group.candidates.length,
                );
              }
              arcConsistencyHistory.push({
                iteration: currentArcIteration,
                kind: 'correlated-chain-domain-restart',
                exactPairEvaluations:
                  correlatedPlacementReservation.exactPairEvaluations,
                cheapPairEvaluations:
                  correlatedPlacementReservation.cheapPairEvaluations,
                reservedNodeIndices: [
                  ...correlatedPlacementReservation.reservedByIndex.keys(),
                ].sort((first, second) => first - second),
              });
              continue arcConsistencyPass;
            }
            for (const group of placementCandidateGroups) {
              group.candidates = failedPlacementCandidatesByIndex.get(group.index) ?? [];
            }
            arcConsistencyHistory.push({
              iteration: currentArcIteration,
              kind: 'correlated-chain-domain-repair-failed',
              status: correlatedPlacementReservation.status,
              exactPairEvaluations:
                correlatedPlacementReservation.exactPairEvaluations,
              cheapPairEvaluations:
                correlatedPlacementReservation.cheapPairEvaluations,
              cheapPairCount: correlatedPlacementReservation.cheapPairCount,
              prunedCandidateCount:
                correlatedPlacementReservation.prunedCandidateCount,
              cheapStageDiagnostics:
                correlatedPlacementReservation.cheapStageDiagnostics,
            });
          }
          finalizeCorrelatedCandidateDiagnostics();
          const closestRejectedPairs = originalFirstCandidates.flatMap((firstCandidate) => (
            originalSecondCandidates.map((secondCandidate) => {
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
                nodeCollisionScore: candidatePairNodeCollisionScore(
                  firstCandidate,
                  firstGroup.index,
                  secondCandidate,
                  secondGroup.index,
                ),
                minimumSpineDistanceMeters: candidatePairMinimumSpineDistance(
                  firstCandidate,
                  firstGroup.index,
                  secondCandidate,
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
              objectiveExternalDiagnostics: cloneDungeonAugmentationValue(
                objectiveExternalDiagnostics,
              ),
              externalSpinePathCount: coveragePlacement?.externalSpinePaths?.length ?? 0,
              externalSpinePathBindings: (coveragePlacement?.externalSpinePaths ?? [])
                .map((record) => ({
                  fromIndex: record.fromIndex,
                  fromLocalSocketId: record.fromLocalSocketId,
                  toIndex: record.toIndex,
                  toLocalSocketId: record.toLocalSocketId,
                })),
              requiredSocketBindings: cloneDungeonAugmentationValue(
                coveragePlacement?.requiredSocketBindings ?? [],
              ),
              planningPhaseTimings: physicalPlanningTimingSnapshot(),
              initialPlacementCandidateCounts,
              arcConsistencyHistory,
              failedPairRejectionSummary: summarizePlacementPairRejections(
                firstGroup,
                secondGroup,
                originalFirstCandidates,
                originalSecondCandidates,
              ),
              closestRejectedPairs,
              physicalPairEdgeDiagnostics,
              correlatedPlacementReservationDiagnostics: {
                status: correlatedPlacementReservation.status,
                exactPairEvaluations:
                  correlatedPlacementReservation.exactPairEvaluations,
                cheapPairEvaluations:
                  correlatedPlacementReservation.cheapPairEvaluations,
                cheapPairCount: correlatedPlacementReservation.cheapPairCount,
                prunedCandidateCount:
                  correlatedPlacementReservation.prunedCandidateCount,
                reservedNodeIndices: [
                  ...correlatedPlacementReservation.reservedByIndex.keys(),
                ].sort((first, second) => first - second),
              },
            },
          };
        }
      }
      }
      break;
    }
    if (requiresCorrelatedPlacementReservation
      && !correlatedRepairAttempted
      && coverageRequiredEdges.length > 0) {
      correlatedRepairAttempted = true;
      const firstEdge = coverageRequiredEdges[0];
      correlatedPlacementReservation = attemptCorrelatedPlacementReservation(
        firstEdge.fromIndex,
        firstEdge.toIndex,
      );
      correlatedPlacementReservation.cheapStageDiagnostics = [
        ...correlatedCheapStageDiagnostics.values(),
      ];
      if (correlatedPlacementReservation.status === 'reserved') {
        for (const group of placementCandidateGroups) {
          const reservedCandidate = correlatedPlacementReservation.reservedByIndex.get(
            group.index,
          );
          if (!reservedCandidate) continue;
          group.candidates = mergeReservedPlacementCandidates(
            group.candidates,
            [reservedCandidate],
            group.candidates.length,
          );
        }
      }
      arcConsistencyHistory.push({
        iteration: arcIteration,
        kind: 'correlated-global-domain-reservation',
        status: correlatedPlacementReservation.status,
        exactPairEvaluations: correlatedPlacementReservation.exactPairEvaluations,
        cheapPairEvaluations: correlatedPlacementReservation.cheapPairEvaluations,
        cheapPairCount: correlatedPlacementReservation.cheapPairCount,
        reservedNodeIndices: [
          ...correlatedPlacementReservation.reservedByIndex.keys(),
        ].sort((first, second) => first - second),
      });
    }
    finalizeCorrelatedCandidateDiagnostics();
    const candidateCompatibleWithSelection = (candidate, index) => {
      const selectedEntries = [...selectedPlacementCandidates.entries()];
      const selectedVolumes = selectedEntries.flatMap(([, selected]) => [
        ...(selected.node.occupiedVolumes ?? []),
        ...(selected.node.clearanceVolumes ?? []),
      ]);
      if (nodePlanningCollisionScore(candidate.node, selectedVolumes) > 0) return false;
      const candidatePrefix = new Map(selectedPlacementCandidates);
      candidatePrefix.set(index, candidate);
      if (!correlatedPrefixHasInjectiveSocketAssignment(candidatePrefix)) return false;
      return selectedEntries.every(([selectedIndex, selected]) => (
        candidatePairRespectsParentAttachments(
          candidate,
          index,
          selected,
          selectedIndex,
        ) && stackedCompoundCandidatesCompatible(
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
      const candidatePrefix = new Map(selectedPlacementCandidates);
      candidatePrefix.set(index, candidate);
      if (!correlatedPrefixHasInjectiveSocketAssignment(candidatePrefix)) return false;
      return selectedEntries.every(([selectedIndex, selected]) => (
        candidatePairNodeCollisionScore(
          candidate,
          index,
          selected,
          selectedIndex,
        ) === 0
          && candidatePairRespectsParentAttachments(
            candidate,
            index,
            selected,
            selectedIndex,
          )
          && stackedCompoundCandidatesMeetCheapBounds(
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
      const parentAttachmentEndpointSeamByNodeIndex = new Map();
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
        const attachmentCollisionVolumes = attachment.collisionVolumes
          ?? attachment.pathVolumes;
        const collisionScore = attachmentCollisionVolumes.reduce((score, pathVolume) => (
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
        parentAttachmentPathVolumes.push(...attachmentCollisionVolumes);
        parentAttachmentDistanceByNodeIndex.set(nodeIndex, distanceMeters);
        parentAttachmentEndpointSeamByNodeIndex.set(
          nodeIndex,
          planningEndpointSeam(nodeSocket, node, 'to'),
        );
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
      const routeOptionIntersectsVolumes = (
        routeOption,
        obstacleVolumes,
        overlapGrants = [],
      ) => {
        const routeVolumes = routeOption.collisionVolumes ?? routeOption.pathVolumes ?? [];
        const authoritativeOverlapGrants = [
          ...(routeOption.endpointSeamEnvelopes ?? []),
          ...overlapGrants,
        ];
        return routeVolumes.some((pathVolume) => obstacleVolumes.some((obstacle) => (
          planningVolumesOverlap(pathVolume, obstacle)
            && !planningOverlapIsGranted(
              pathVolume,
              obstacle,
              authoritativeOverlapGrants,
            )
        )));
      };
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
                  !routeOptionHasStaticCollision(routeOption)
                    && (() => {
                      const sharedParentSeams = [fromIndex, toIndex].map((nodeIndex) => {
                        const parentSeam = parentAttachmentEndpointSeamByNodeIndex.get(nodeIndex);
                        const routeSeam = nodeIndex === fromIndex
                          ? routeOption.endpointSeams?.[0]
                          : routeOption.endpointSeams?.[1];
                        return planningVolumeIntersection(
                          parentSeam?.overlapEnvelope,
                          routeSeam?.overlapEnvelope,
                        );
                      }).filter(Boolean);
                      return !routeOptionIntersectsVolumes(
                        routeOption,
                        fixedObstacles,
                        sharedParentSeams,
                      );
                    })()
                )),
            }))
          ));
        });
      const committedSpineRouteVolumes = [];
      const routeOptionClearsCommittedSpine = (routeOption) => {
        const previousPair = pairs.at(-1);
        const sharedEndpointSeam = previousPair
          ? planningVolumeIntersection(
            previousPair.endpointSeams?.[1]?.overlapEnvelope,
            routeOption.endpointSeams?.[0]?.overlapEnvelope,
          )
          : null;
        return !routeOptionIntersectsVolumes(
          routeOption,
          committedSpineRouteVolumes,
          sharedEndpointSeam ? [sharedEndpointSeam] : [],
        );
      };
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
              if (routeNetworkNodeResetsFeaturelessDistance(node)) return sum;
              const parentAttachmentDistance = node.exactParentEndpoint
                ? Number(
                  parentAttachmentDistanceByNodeIndex.get(nodeIndex)
                    ?? Number.POSITIVE_INFINITY,
                )
                : 0;
              return sum
                + parentAttachmentDistance
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
              collisionVolumes: witness.collisionVolumes,
              endpointSeams: witness.endpointSeams,
              endpointSeamEnvelopes: witness.endpointSeamEnvelopes,
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
        edgeDiagnostics.lastSocketPairDiagnostics = socketPairs.map(({
          fromSocket,
          toSocket,
          routeOptions,
        }) => ({
          fromLocalSocketId: fromSocket.localSocketId,
          toLocalSocketId: toSocket.localSocketId,
          fromPosition: cloneDungeonAugmentationValue(fromSocket.position),
          toPosition: cloneDungeonAugmentationValue(toSocket.position),
          fromFacing: cloneDungeonAugmentationValue(fromSocket.facing),
          toFacing: cloneDungeonAugmentationValue(toSocket.facing),
          routeSelectionDiagnostics: cloneDungeonAugmentationValue(
            orderedSocketRouteOptions(
              fromSocket,
              toSocket,
              true,
              fromNode,
              toNode,
            ).routeSelectionDiagnostics ?? null,
          ),
        }));
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
          committedSpineRouteVolumes.push(...(
            candidate.collisionVolumes ?? candidate.pathVolumes ?? []
          ));
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
    const recursiveCompositionStartedAt = planningNowMilliseconds();
    visitPlacementCandidates();
    physicalPlanningPhaseTimings.recursiveCompositionMs +=
      planningNowMilliseconds() - recursiveCompositionStartedAt;
    physicalPlanningPhaseTimings.totalMs = planningNowMilliseconds()
      - physicalPlanningStartedAt;
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
          planningPhaseTimings: cloneDungeonAugmentationValue(
            physicalPlanningPhaseTimings,
          ),
          objectiveExternalDiagnostics,
          requiredSocketBindings: cloneDungeonAugmentationValue(
            coveragePlacement?.requiredSocketBindings ?? [],
          ),
          endpointNodeIndices: [...endpointNodeIndexSet]
            .sort((first, second) => first - second),
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
      const committedNode = createRouteNetworkNode(
        index,
        selected.center,
        selected.facing,
      );
      centers[index] = selected.center;
      mainNodes[index] = committedNode;
      localPlacementAvoidanceVolumes.push(
        ...committedNode.occupiedVolumes,
        ...committedNode.clearanceVolumes,
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
    const parentLandingOverlapGrant = routeRole === 'parent-station-attachment'
      ? (grant.socketLandingOverlapGrants ?? []).find(({ socketId }) => (
        String(socketId) === String(from.socketId ?? from.id)
      )) ?? null
      : null;
    const parentAttachmentOverlapGrants = [
      parentLandingOverlapGrant,
    ].filter(Boolean);
    const endpointNodeAndSocket = (endpoint) => {
      for (const [node, localSocketId] of nodeSockets) {
        const socket = getNodeSocket(node, localSocketId);
        if (String(socket?.id ?? '') === String(endpoint?.socketId ?? endpoint?.id ?? '')) {
          return { node, socket };
        }
      }
      return { node: null, socket: endpoint };
    };
    const endpointSeams = [from, to].map((endpoint, endpointIndex) => {
      const { node, socket } = endpointNodeAndSocket(endpoint);
      const matchingParentOverlap = (grant.socketLandingOverlapGrants ?? []).find((overlap) => (
        String(overlap.socketId ?? '') === String(endpoint?.socketId ?? endpoint?.id ?? '')
      ));
      return createDungeonRouteEndpointSeam(socket ?? endpoint, {
        id: `${segmentId}:${endpointIndex === 0 ? 'from' : 'to'}-endpoint-seam`,
        segmentId,
        operationId,
        networkId: operationId,
        nodeId: node?.id ?? endpoint?.nodeId ?? null,
        socketId: endpoint?.socketId ?? endpoint?.id ?? socket?.id ?? null,
        localSocketId: socket?.localSocketId ?? endpoint?.localSocketId ?? null,
        role: endpointIndex === 0 ? 'from' : 'to',
        elevationBand: node?.progressionBandId ?? grant.progressionBandId ?? null,
        // A connector-owned station at an exact host endpoint inherits that
        // endpoint's authored physical owner. It may overlap that owner only
        // inside this seam; ownership of the supplemental node itself remains
        // represented by the node-bound envelope below.
        parentOwnerId: enforceExactEmittedCoverageVolumes
          ? endpointSeamSharedOwnerId(socket ?? endpoint, node)
          : matchingParentOverlap?.parentOwnerId ?? null,
      });
    });
    if (requireAuthoritativeEndpointSeams) {
      const malformedSeamIndex = endpointSeams.findIndex((seam) => (
        !inspectDungeonRouteEndpointSeamGridLattice(seam).accepted
      ));
      if (malformedSeamIndex >= 0) {
        lastSegmentFailureDiagnostics = {
          code: DUNGEON_ROUTE_ENDPOINT_SEAM_GRID_LATTICE_DIAGNOSTIC,
          segmentId,
          routeRole,
          endpointRole: malformedSeamIndex === 0 ? 'from' : 'to',
          ...inspectDungeonRouteEndpointSeamGridLattice(
            endpointSeams[malformedSeamIndex],
          ),
        };
        return null;
      }
    }
    const endpointSeamOverlapGrants = endpointSeams.map(({ overlapEnvelope }) => (
      overlapEnvelope
    ));
    const endpointNodeOverlapGrants = endpointSeams.flatMap((seam, endpointIndex) => {
      const { node } = endpointNodeAndSocket([from, to][endpointIndex]);
      return node ? [{
        ...seam.overlapEnvelope,
        id: `${seam.overlapEnvelope.id}:node-owner`,
        parentOwnerId: node.id,
      }] : [];
    });
    const routeAvoidanceVolumes = localPlacementAvoidanceVolumes.filter((volume) => (
      // The host explicitly grants this exact three-tile threshold footprint
      // to the attachment. Ignore only obstacles wholly inside that bounded
      // landing; every endpoint module remains present for seam-only pruning.
      !isGrantedParentGalleryThresholdVolume(volume, parentLandingOverlapGrant)
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
          [...parentAttachmentOverlapGrants, ...endpointSeamOverlapGrants],
          connectorFamily,
          ROUTE_NETWORK_SOCKET_APPROACH_METERS,
          false,
          enforceExactEmittedCoverageVolumes,
        );
      } else {
        segmentPath = cachedSocketRouteCandidates(from, to, {
          preferXFirst,
          connectorFamily,
          ...coverageModuleRouteOptions,
        }).map((path, ordinal) => {
          const collisionVolumes = enforceExactEmittedCoverageVolumes
            ? routeSegmentPlanningCollisionVolumes(path, from, to, 5.6, 5.6)
            : routePathPlanningVolumes(path, 5.6);
          return {
            path,
            ordinal,
            collisionScore: planningRouteVolumesCollisionScore(
              collisionVolumes,
              routeAvoidanceVolumes,
              [...endpointSeamOverlapGrants, ...endpointNodeOverlapGrants],
            ),
            lengthMeters: measureDungeonPolyline(path),
            maximumLevelSpanMeters: maximumContinuousLevelRouteSpan(path),
          };
        }).filter(({ path, collisionScore, maximumLevelSpanMeters }) => (
          collisionScore === 0
            && routePathHasExteriorSocketApproach(
              path,
              from,
              false,
              requireAuthoritativeEndpointSeams ? endpointSeams[0] : null,
            )
            && routePathHasExteriorSocketApproach(
              path,
              to,
              true,
              requireAuthoritativeEndpointSeams ? endpointSeams[1] : null,
            )
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
    if (requireAuthoritativeEndpointSeams && Array.isArray(segmentPath)) {
      segmentPath = routePathWithAuthoritativeSeamEndpoints(segmentPath, endpointSeams);
    }
    const segmentFeaturelessDistance = Array.isArray(segmentPath)
      ? maximumContinuousLevelRouteSpan(segmentPath)
      : Number.POSITIVE_INFINITY;
    const endpointModulePrefixMeters = routeRole === 'parent-station-attachment'
      ? 0
      : nodeSockets.reduce((sum, [node, throughLocalSocketId]) => {
        if (!node?.connectorOwned || !node?.exactParentEndpoint) return sum;
        if (routeNetworkNodeResetsFeaturelessDistance(node)) return sum;
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
      || measureDungeonPolyline(segmentPath) <= 1e-6) {
      lastSegmentFailureDiagnostics = {
        code: 'route-network-segment-path-missing',
        segmentId,
        routeRole,
      };
      return null;
    }
    const endpointApproachDiagnostics = [
      routePathExteriorSocketApproachDiagnostic(
        segmentPath,
        from,
        false,
        requireAuthoritativeEndpointSeams ? endpointSeams[0] : null,
      ),
      routePathExteriorSocketApproachDiagnostic(
        segmentPath,
        to,
        true,
        requireAuthoritativeEndpointSeams ? endpointSeams[1] : null,
      ),
    ];
    const rejectedEndpointApproachIndex = endpointApproachDiagnostics.findIndex((diagnostic) => (
      diagnostic.accepted !== true
    ));
    if (rejectedEndpointApproachIndex >= 0) {
      lastSegmentFailureDiagnostics = {
        ...cloneDungeonAugmentationValue(
          endpointApproachDiagnostics[rejectedEndpointApproachIndex],
        ),
        segmentId,
        routeRole,
        endpointRole: rejectedEndpointApproachIndex === 0 ? 'from' : 'to',
      };
      return null;
    }
    const plannedCollisionVolumes = enforceExactEmittedCoverageVolumes
      ? routeSegmentPlanningCollisionVolumes(
        segmentPath,
        from,
        to,
        routeRole === 'parent-station-attachment' ? 3.6 : 5.6,
        5.6,
      )
      : routePathPlanningVolumes(
        segmentPath,
        routeRole === 'parent-station-attachment' ? 3.6 : 5.6,
      );
    const rejectedEndpointMaskIndex = [from, to].findIndex((endpoint, endpointIndex) => {
      const { node } = endpointNodeAndSocket(endpoint);
      return !routePlanningVolumesRespectEndpointNodeMask(
        plannedCollisionVolumes,
        node,
        endpointSeams[endpointIndex],
      );
    });
    if (rejectedEndpointMaskIndex >= 0) {
      const rejectedEndpoint = [from, to][rejectedEndpointMaskIndex];
      const { node } = endpointNodeAndSocket(rejectedEndpoint);
      lastSegmentFailureDiagnostics = {
        code: 'route-network-endpoint-overlap-outside-seam',
        segmentId,
        routeRole,
        endpointRole: rejectedEndpointMaskIndex === 0 ? 'from' : 'to',
        nodeId: node?.id ?? rejectedEndpoint?.nodeId ?? null,
        seamId: endpointSeams[rejectedEndpointMaskIndex]?.id ?? null,
      };
      return null;
    }
    if (segmentFeaturelessDistance > Number(
        profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
      ) + 1e-6
      || segmentFeaturelessDistance + endpointModulePrefixMeters > Number(
        profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
      ) + 1e-6) {
      lastSegmentFailureDiagnostics = {
        code: 'route-network-segment-featureless-span-exceeded',
        segmentId,
        routeRole,
        segmentFeaturelessDistance,
        endpointModulePrefixMeters,
      };
      return null;
    }
    const plannedOverlapGrants = [
      ...parentAttachmentOverlapGrants,
      ...endpointSeamOverlapGrants,
      ...endpointNodeOverlapGrants,
    ];
    const rejectedPlannedOverlap = routeRole === 'parent-station-attachment'
      ? plannedCollisionVolumes.flatMap((volume) => (
        routeAvoidanceVolumes.map((obstacle) => ({ volume, obstacle }))
      )).find(({ volume, obstacle }) => (
        planningVolumesOverlap(volume, obstacle)
          && !planningOverlapIsGranted(volume, obstacle, plannedOverlapGrants)
      ))
      : null;
    if (rejectedPlannedOverlap) {
      lastSegmentFailureDiagnostics = {
        code: 'route-network-parent-attachment-overlap-outside-seam',
        segmentId,
        routeRole,
        volume: cloneDungeonAugmentationValue(rejectedPlannedOverlap.volume),
        obstacle: cloneDungeonAugmentationValue(rejectedPlannedOverlap.obstacle),
        overlapGrants: cloneDungeonAugmentationValue(plannedOverlapGrants),
      };
      return null;
    }
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
    segment.endpointSeams = cloneDungeonAugmentationValue(endpointSeams);
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
      ...endpointSeamOverlapGrants,
      ...endpointNodeOverlapGrants,
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
        context: {
          grantId: grant.id,
          socketId: socket.id,
          endpointOrdinal: index,
          segmentFailureDiagnostics: cloneDungeonAugmentationValue(
            lastSegmentFailureDiagnostics,
          ),
        },
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
      requiresExternalVerticalTransfer && wingNodeIndex === elevationNodeIndex
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
      if (requiresExternalVerticalTransfer && wingNodeIndex === elevationNodeIndex) {
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
        const committedWingNode = createRouteNetworkNode(
          wingNodeIndex,
          candidate.center,
          candidate.facing,
        );
        const candidateVolumes = [
          ...(committedWingNode.occupiedVolumes ?? []),
          ...(committedWingNode.clearanceVolumes ?? []),
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
          to: nodeEndpoint(committedWingNode, 'entry'),
          routeRole: 'pyramid-loop-content-wing',
          nodeSockets: [
            [wingParent, decisionSocket.localSocketId],
            [committedWingNode, 'entry'],
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
        nodes.push(committedWingNode);
        pyramidWingConnection = {
          parentNode: wingParent,
          parentLocalSocketId: decisionSocket.localSocketId,
          wingNode: committedWingNode,
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
    const routeAvoidanceVolumes = localPlacementAvoidanceVolumes;
    const seamForAvailableSocket = (socket, node, role) => (
      createDungeonRouteEndpointSeam(socket, {
        id: `${operationId}:available-socket:${node.id}:${socket.id}:${role}:endpoint-seam`,
        operationId,
        networkId: operationId,
        nodeId: node.id,
        socketId: socket.id,
        localSocketId: socket.localSocketId ?? null,
        role,
        elevationBand: node.progressionBandId ?? grant.progressionBandId ?? null,
        parentOwnerId: enforceExactEmittedCoverageVolumes
          ? endpointSeamSharedOwnerId(socket, node)
          : null,
      })
    );
    const rawCandidates = fromSockets.flatMap((fromSocket) => toSockets.flatMap((toSocket) => {
      const connectorFamily = Math.abs(
        Number(toSocket.position.y) - Number(fromSocket.position.y),
      ) > 1e-6 ? verticalFamily : 'service-gallery';
      // The exact seams are properties of this socket pair, not of each route
      // candidate. Some elevation families enumerate hundreds of transfer
      // positions for one pair; rebuilding both 15-cell records per path was
      // pure work and obscured stage-specific rejection diagnostics.
      const endpointSeams = [
        seamForAvailableSocket(fromSocket, fromNode, 'from'),
        seamForAvailableSocket(toSocket, toNode, 'to'),
      ];
      const endpointSeamEnvelopes = endpointSeams.map(({ overlapEnvelope }) => (
        overlapEnvelope
      ));
      const endpointPlanningOverlapGrants = endpointSeams.flatMap((seam, endpointIndex) => ([
        seam.overlapEnvelope,
        {
          ...seam.overlapEnvelope,
          id: `${seam.overlapEnvelope.id}:node-owner`,
          parentOwnerId: [fromNode, toNode][endpointIndex].id,
        },
      ]));
      return cachedSocketRouteCandidates(fromSocket, toSocket, {
        preferXFirst: segments.length % 2 === 0,
        connectorFamily,
        ...coverageModuleRouteOptions,
      }).map((path) => {
        const pathVolumes = routePathPlanningVolumes(path);
        const collisionVolumes = enforceExactEmittedCoverageVolumes
          ? routeSegmentPlanningCollisionVolumes(path, fromSocket, toSocket, 5.6, 5.6)
          : pathVolumes;
        const fromApproachCompatible = routePathHasExteriorSocketApproach(
          path,
          fromSocket,
          false,
          endpointSeams[0],
        );
        const toApproachCompatible = routePathHasExteriorSocketApproach(
          path,
          toSocket,
          true,
          endpointSeams[1],
        );
        const approachCompatible = fromApproachCompatible && toApproachCompatible;
        const sharedEndpointNode = String(fromNode.id) === String(toNode.id);
        const fromEndpointMaskCompatible = approachCompatible
          && routePlanningVolumesRespectEndpointNodeMask(
            collisionVolumes,
            fromNode,
            sharedEndpointNode ? endpointSeams : endpointSeams[0],
          );
        const toEndpointMaskCompatible = approachCompatible
          && routePlanningVolumesRespectEndpointNodeMask(
            collisionVolumes,
            toNode,
            sharedEndpointNode ? endpointSeams : endpointSeams[1],
          );
        const endpointSeamCompatible = fromEndpointMaskCompatible
          && toEndpointMaskCompatible;
        return {
          fromLocalSocketId: fromSocket.localSocketId,
          toLocalSocketId: toSocket.localSocketId,
          path,
          pathVolumes,
          collisionVolumes,
          endpointSeams,
          endpointSeamEnvelopes,
          fromApproachCompatible,
          toApproachCompatible,
          approachCompatible,
          fromEndpointMaskCompatible,
          toEndpointMaskCompatible,
          endpointSeamCompatible,
          collisionScore: endpointSeamCompatible
            ? planningRouteVolumesCollisionScore(
              collisionVolumes,
              routeAvoidanceVolumes,
              endpointPlanningOverlapGrants,
            )
            : Number.POSITIVE_INFINITY,
          distanceMeters: maximumContinuousLevelRouteSpan(path),
          physicalLengthMeters: measureDungeonPolyline(path),
          endpointPrefixMeters: [
          [fromNode, fromSocket],
          [toNode, toSocket],
        ].reduce((sum, [candidateNode, throughSocket]) => {
          if (!candidateNode?.exactParentEndpoint
            || routeNetworkNodeResetsFeaturelessDistance(candidateNode)) return sum;
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
        };
      });
    }));
    const physicallyEligibleCandidates = rawCandidates.filter(({
      collisionScore,
      physicalLengthMeters,
      endpointSeamCompatible,
    }) => endpointSeamCompatible && collisionScore === 0 && physicalLengthMeters > 1e-6);
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
      const finiteCollisionScores = rawCandidates
        .map(({ collisionScore }) => collisionScore)
        .filter(Number.isFinite);
      const socketPairStageCounts = [...new Set(rawCandidates.map((candidate) => (
        `${candidate.fromLocalSocketId}>${candidate.toLocalSocketId}`
      )))].slice(0, 12).map((pairKey) => {
        const candidates = rawCandidates.filter((candidate) => (
          `${candidate.fromLocalSocketId}>${candidate.toLocalSocketId}` === pairKey
        ));
        return {
          fromLocalSocketId: candidates[0]?.fromLocalSocketId ?? null,
          toLocalSocketId: candidates[0]?.toLocalSocketId ?? null,
          rawCandidateCount: candidates.length,
          approachCandidateCount: candidates.filter(({ approachCompatible }) => (
            approachCompatible
          )).length,
          fromEndpointMaskCandidateCount: candidates.filter(({
            fromEndpointMaskCompatible,
          }) => fromEndpointMaskCompatible).length,
          toEndpointMaskCandidateCount: candidates.filter(({
            toEndpointMaskCompatible,
          }) => toEndpointMaskCompatible).length,
          exactSeamCandidateCount: candidates.filter(({ endpointSeamCompatible }) => (
            endpointSeamCompatible
          )).length,
          collisionFreeCandidateCount: candidates.filter(({
            endpointSeamCompatible,
            collisionScore,
          }) => endpointSeamCompatible && collisionScore === 0).length,
          featurelessCandidateCount: candidates.filter((candidate) => (
            candidate.endpointSeamCompatible
              && candidate.collisionScore === 0
              && candidate.physicalLengthMeters > 1e-6
              && candidate.distanceMeters + candidate.endpointPrefixMeters
                <= maximumFeaturelessSpanMeters + 1e-6
          )).length,
        };
      });
      Object.assign(diagnostics, {
        fromNodeId: fromNode.id,
        toNodeId: toNode.id,
        fromCenter: cloneDungeonAugmentationValue(fromNode.placement?.center),
        toCenter: cloneDungeonAugmentationValue(toNode.placement?.center),
        fromSocketCount: fromSockets.length,
        toSocketCount: toSockets.length,
        routeCandidateCount: rawCandidates.length,
        approachEligibleCandidateCount: rawCandidates.filter(({
          approachCompatible,
        }) => approachCompatible).length,
        endpointMaskEligibleCandidateCount: rawCandidates.filter(({
          endpointSeamCompatible,
        }) => endpointSeamCompatible).length,
        physicallyEligibleCandidateCount: physicallyEligibleCandidates.length,
        featurelessEligibleCandidateCount: eligibleCandidates.length,
        socketPairStageCounts,
        featurelessEligibleSocketPairs: eligibleCandidates.slice(0, 8).map((candidate) => ({
          fromLocalSocketId: candidate.fromLocalSocketId,
          toLocalSocketId: candidate.toLocalSocketId,
          distanceMeters: candidate.accumulatedFeaturelessDistanceMeters,
        })),
        minimumCollisionScore: finiteCollisionScores.length > 0
          ? Math.min(...finiteCollisionScores)
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
        const candidates = availableSocketPairs(
          fromNode,
          toNode,
          edgeDiagnostics,
        ).filter((candidate) => (
          !fromUsed.has(candidate.fromLocalSocketId)
            && !toUsed.has(candidate.toLocalSocketId)
            && (() => {
              const previousPair = selectedPairs.at(-1);
              const sharedEndpointSeam = previousPair
                ? planningVolumeIntersection(
                  previousPair.endpointSeamEnvelopes?.[1],
                  candidate.endpointSeamEnvelopes?.[0],
                )
                : null;
              return pathPlanningCollisionScore(
                candidate.path,
                previouslySelectedRouteVolumes,
                5.6,
                sharedEndpointSeam ? [sharedEndpointSeam] : [],
              ) === 0;
            })()
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
        selectedGrammarIds: selectedGrammars.map(({ id }) => id),
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
    let lastTopologyReturnDiagnostics = null;
    const connectTopologyChord = (
      fromIndex,
      toIndex,
      routeRole,
      {
        fromLocalSocketId = null,
        toLocalSocketId = null,
        diagnostics = null,
      } = {},
    ) => {
      if (fromIndex === toIndex && (
        !fromLocalSocketId
          || !toLocalSocketId
          || String(fromLocalSocketId) === String(toLocalSocketId)
      )) {
        if (diagnostics) Object.assign(diagnostics, {
          rejected: 'same-node-without-distinct-explicit-sockets',
        });
        return false;
      }
      const availablePairDiagnostics = {};
      const socketPairs = availableSocketPairs(
        nodes[fromIndex],
        nodes[toIndex],
        availablePairDiagnostics,
      )
        .filter((pair) => (
          (!fromLocalSocketId || pair.fromLocalSocketId === fromLocalSocketId)
            && (!toLocalSocketId || pair.toLocalSocketId === toLocalSocketId)
        ));
      const attemptedPairs = [];
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
        attemptedPairs.push({
          fromLocalSocketId: pair.fromLocalSocketId,
          toLocalSocketId: pair.toLocalSocketId,
          physicalLengthMeters: pair.physicalLengthMeters,
          accumulatedFeaturelessDistanceMeters:
            pair.accumulatedFeaturelessDistanceMeters,
          accepted: Boolean(chordSegment),
          ...(chordSegment || !lastSegmentFailureDiagnostics ? {} : {
            segmentFailure: cloneDungeonAugmentationValue(
              lastSegmentFailureDiagnostics,
            ),
          }),
        });
        if (chordSegment) {
          if (diagnostics) Object.assign(diagnostics, {
            fromIndex,
            toIndex,
            routeRole,
            requestedFromLocalSocketId: fromLocalSocketId,
            requestedToLocalSocketId: toLocalSocketId,
            availablePairDiagnostics,
            attemptedPairs: attemptedPairs.slice(0, 8),
            accepted: true,
          });
          return true;
        }
      }
      if (diagnostics) Object.assign(diagnostics, {
        fromIndex,
        toIndex,
        routeRole,
        requestedFromLocalSocketId: fromLocalSocketId,
        requestedToLocalSocketId: toLocalSocketId,
        availablePairDiagnostics,
        attemptedPairs: attemptedPairs.slice(0, 8),
        accepted: false,
      });
      return false;
    };
    const connectAuthoredTopologySockets = (kitNodeIndex, routeRole) => {
      const kitNode = nodes[kitNodeIndex];
      const topologySocketIds = (
        kitNode?.selectionConstraints?.routeNetworkTopologySocketIds ?? []
      ).map(String);
      const topologyDiagnostics = {
        kitNodeIndex,
        routeRole,
        kitNodeId: kitNode?.id ?? null,
        kitGrammarId: kitNode?.grammarId ?? null,
        topologySocketIds,
        kitSockets: (kitNode?.sockets ?? []).map((socket) => ({
          localSocketId: socket.localSocketId,
          state: socket.state,
          position: cloneDungeonAugmentationValue(socket.position),
          facing: cloneDungeonAugmentationValue(socket.facing),
        })),
        targetAttempts: [],
      };
      lastTopologyReturnDiagnostics = topologyDiagnostics;
      if (!kitNode || topologySocketIds.length === 0) {
        topologyDiagnostics.rejected = !kitNode
          ? 'missing-kit-node'
          : 'missing-topology-socket-ids';
        return false;
      }
      const pendingSocketIds = topologySocketIds.filter((localSocketId) => (
        getNodeSocket(kitNode, localSocketId)?.state === 'capped'
      ));
      topologyDiagnostics.pendingSocketIds = [...pendingSocketIds];
      if (pendingSocketIds.length === 0) {
        topologyDiagnostics.accepted = true;
        return true;
      }
      if (pendingSocketIds.length === 2) {
        const localReturnDiagnostics = {};
        const firstPendingSocket = getNodeSocket(kitNode, pendingSocketIds[0]);
        const secondPendingSocket = getNodeSocket(kitNode, pendingSocketIds[1]);
        // Opposite outward sockets on the same module need two exterior leads
        // plus the expanded crossbar outside both leads. For the 22.4 m
        // stacked kit this is 44.8 m before any obstacle detour, so generating
        // U candidates can never satisfy the 33.6 m featureless gate.
        const minimumLocalReturnMeters = firstPendingSocket && secondPendingSocket
          ? dungeonPointDistance(
            firstPendingSocket.position,
            secondPendingSocket.position,
          ) + ROUTE_NETWORK_SOCKET_APPROACH_METERS * 4
          : Number.POSITIVE_INFINITY;
        const localReturnConnected = minimumLocalReturnMeters
          <= Number(profile.routeNetworkPlanning.maximumFeaturelessSpanMeters) + 1e-6
          && connectTopologyChord(
            kitNodeIndex,
            kitNodeIndex,
            `${routeRole}:local-return`,
            {
              fromLocalSocketId: pendingSocketIds[0],
              toLocalSocketId: pendingSocketIds[1],
              diagnostics: localReturnDiagnostics,
            },
          );
        if (minimumLocalReturnMeters
          > Number(profile.routeNetworkPlanning.maximumFeaturelessSpanMeters) + 1e-6) {
          Object.assign(localReturnDiagnostics, {
            accepted: false,
            rejected: 'geometric-featureless-lower-bound',
            minimumLocalReturnMeters,
            maximumFeaturelessSpanMeters: Number(
              profile.routeNetworkPlanning.maximumFeaturelessSpanMeters,
            ),
          });
        }
        topologyDiagnostics.localReturnAttempt = localReturnDiagnostics;
        if (localReturnConnected) {
          topologyDiagnostics.accepted = true;
          return true;
        }
      }
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
        const targetAttempt = { targetIndices: [...targetIndices], chords: [] };
        let connected = true;
        for (const [ordinal, localSocketId] of pendingSocketIds.entries()) {
          const chordDiagnostics = {};
          const chordConnected = connectTopologyChord(
            kitNodeIndex,
            targetIndices[ordinal],
            `${routeRole}:${localSocketId}`,
            { fromLocalSocketId: localSocketId, diagnostics: chordDiagnostics },
          );
          targetAttempt.chords.push(chordDiagnostics);
          if (!chordConnected) {
            connected = false;
            break;
          }
        }
        targetAttempt.accepted = connected;
        if (topologyDiagnostics.targetAttempts.length < 12) {
          topologyDiagnostics.targetAttempts.push(targetAttempt);
        }
        if (connected) {
          topologyDiagnostics.accepted = true;
          return true;
        }
        segments.length = transaction.segmentCount;
        localPlacementAvoidanceVolumes.length = transaction.avoidanceVolumeCount;
        nextSegmentOrdinal = transaction.nextSegmentOrdinal;
        for (const socketState of transaction.sockets) {
          socketState.socket.state = socketState.state;
          socketState.socket.segmentId = socketState.segmentId;
          socketState.socket.capRole = socketState.capRole;
        }
      }
      topologyDiagnostics.accepted = false;
      return false;
    };
    if (topologyTemplateId === 'parallel-gallery-loop') {
      connectTopologyChord(0, 1, 'parallel-gallery-loop:return-leg');
    } else if (topologyTemplateId === 'split-level-ring') {
      const middle = Math.max(0, Math.floor(nodes.length * 0.5) - 1);
      connectTopologyChord(middle, Math.min(nodes.length - 1, middle + 1), 'split-level-ring:return-leg');
    } else if (topologyTemplateId === 'over-under-loop') {
      const directReturnDiagnostics = {};
      const upperRouteConnected = topologyKitModuleIndex == null
        ? connectTopologyChord(0, 1, 'over-under-loop:upper-return-leg', {
          diagnostics: directReturnDiagnostics,
        })
        : connectAuthoredTopologySockets(
          topologyKitModuleIndex,
          'over-under-loop:upper-return-leg',
        );
      if (topologyKitModuleIndex == null) {
        lastTopologyReturnDiagnostics = directReturnDiagnostics;
      }
      if (!upperRouteConnected) {
        return {
          error: 'route-network-topology-kit-return-leg-unrealizable',
          context: {
            grantId: grant.id,
            topologyTemplateId,
            topologyKitModuleIndex,
            planningPhaseTimings: cloneDungeonAugmentationValue(
              physicalPlanningPhaseTimings,
            ),
            topologyReturnDiagnostics: cloneDungeonAugmentationValue(
              lastTopologyReturnDiagnostics,
            ),
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
      const directReturnDiagnostics = {};
      const upperRouteConnected = topologyKitModuleIndex == null
        ? connectTopologyChord(
          middle,
          Math.min(nodes.length - 1, middle + 1),
          'stacked-interchange:upper-arm',
          { diagnostics: directReturnDiagnostics },
        )
        : connectAuthoredTopologySockets(
          topologyKitModuleIndex,
          'stacked-interchange:upper-arm',
        );
      if (topologyKitModuleIndex == null) {
        lastTopologyReturnDiagnostics = directReturnDiagnostics;
      }
      if (!upperRouteConnected) {
        return {
          error: 'route-network-topology-kit-return-leg-unrealizable',
          context: {
            grantId: grant.id,
            topologyTemplateId,
            topologyKitModuleIndex,
            planningPhaseTimings: cloneDungeonAugmentationValue(
              physicalPlanningPhaseTimings,
            ),
            topologyReturnDiagnostics: cloneDungeonAugmentationValue(
              lastTopologyReturnDiagnostics,
            ),
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
  // Edge-local checks cannot prove the V4 station-to-station contract: two
  // individually legal galleries can still exceed the limit when joined by
  // a degree-two connector core. Rebuild the finalized physical graph after
  // socket commitment and semantic promotion, then run the exact evaluator
  // used by release validation before this operation can leave planning.
  const finalizedNodeById = new Map(nodes.map((node) => [String(node.id), node]));
  const finalizedOperationNodeIds = new Set(finalizedNodeById.keys());
  const finalizedGraphAdjacency = new Map(
    [...finalizedOperationNodeIds].map((nodeId) => [nodeId, []]),
  );
  const finalizedExternalKeys = new Set();
  const externalKeyForEndpoint = (endpoint, segmentId, role) => (
    `external:${String(
      endpoint?.socketId ?? endpoint?.id ?? endpoint?.nodeId ?? `${segmentId}:${role}`,
    )}`
  );
  for (const segment of segments) {
    const fromNodeId = String(segment?.from?.nodeId ?? '');
    const toNodeId = String(segment?.to?.nodeId ?? '');
    const fromInternal = finalizedOperationNodeIds.has(fromNodeId);
    const toInternal = finalizedOperationNodeIds.has(toNodeId);
    if (!fromInternal && !toInternal) continue;
    const graphFrom = fromInternal
      ? fromNodeId
      : externalKeyForEndpoint(segment.from, segment.id, 'from');
    const graphTo = toInternal
      ? toNodeId
      : externalKeyForEndpoint(segment.to, segment.id, 'to');
    if (!fromInternal) finalizedExternalKeys.add(graphFrom);
    if (!toInternal) finalizedExternalKeys.add(graphTo);
    if (!finalizedGraphAdjacency.has(graphFrom)) finalizedGraphAdjacency.set(graphFrom, []);
    if (!finalizedGraphAdjacency.has(graphTo)) finalizedGraphAdjacency.set(graphTo, []);
    const lengthMeters = Array.isArray(segment.path) && segment.path.length >= 2
      ? maximumContinuousLevelRouteSpan(segment.path)
      : dungeonPointDistance(segment.from?.position, segment.to?.position);
    finalizedGraphAdjacency.get(graphFrom).push({
      id: String(segment.id),
      to: graphTo,
      lengthMeters,
      fromPosition: segment.from?.position ?? null,
      toPosition: segment.to?.position ?? null,
    });
    finalizedGraphAdjacency.get(graphTo).push({
      id: String(segment.id),
      to: graphFrom,
      lengthMeters,
      fromPosition: segment.to?.position ?? null,
      toPosition: segment.from?.position ?? null,
    });
  }
  const finalizedRealJunctionNodeIds = new Set(nodes
    .filter((node) => (
      node.connectorOwned === true
        && node.countsAsMeaningfulStation === true
        && Number(node.graphDegree ?? 0) >= 3
    ))
    .map(({ id }) => String(id)));
  const finalizedFeaturelessGraph = evaluateDungeonRouteNetworkFeaturelessGraph({
    operation: { id: operationId, topologyTemplateId },
    operationNodeIds: finalizedOperationNodeIds,
    graphAdjacency: finalizedGraphAdjacency,
    nodeById: finalizedNodeById,
    externalKeys: finalizedExternalKeys,
    realJunctionNodeIds: finalizedRealJunctionNodeIds,
    maximum: maximumFeaturelessSpanMeters,
  });
  const accumulatedFeaturelessViolation = finalizedFeaturelessGraph.overlongSpans[0];
  if (accumulatedFeaturelessViolation) {
    return {
      error: 'route-network-accumulated-featureless-span-exceeded',
      context: {
        grantId: grant.id,
        ...accumulatedFeaturelessViolation,
      },
    };
  }
  const featurelessCycle = finalizedFeaturelessGraph.featurelessCycles[0];
  if (featurelessCycle) {
    return {
      error: 'route-network-featureless-cycle-without-station',
      context: { grantId: grant.id, ...featurelessCycle },
    };
  }
  const featurelessSpans = [...authoredFeaturelessSpans, ...physicalFeaturelessSpans];
  let finalJunctionSelectionBag = junctionSelectionBag;
  const junctionSelections = [];
  const junctionBagWitnesses = [];
  for (const node of nodes) {
    const nodeOrdinal = Number(node.ordinal);
    if (moduleKindForIndex(nodeOrdinal) !== 'connector-module') continue;
    const junctionKind = String(
      junctionKinds[nodeOrdinal]
        ?? node.selectionConstraints?.routeNetworkJunctionKind
        ?? '',
    );
    if (!junctionKind) continue;
    const legalJunctionKinds = candidateJunctionBag.includes(junctionKind)
      ? candidateJunctionBag
      : [junctionKind];
    const beforeJunctionBag = finalJunctionSelectionBag;
    let selectedLegalJunctionKinds = legalJunctionKinds;
    let selected = dungeonSelectionBagCandidates(
      finalJunctionSelectionBag,
      legalJunctionKinds,
    ).find(({ id }) => id === junctionKind);
    // Exact endpoint topology can force Through-T even while another general
    // junction family remains in the bag. At that node the forced kit is the
    // complete legal set, so consume it through a role-scoped decision.
    if (!selected) {
      selectedLegalJunctionKinds = [junctionKind];
      [selected] = dungeonSelectionBagCandidates(
        finalJunctionSelectionBag,
        [junctionKind],
      );
    }
    if (!selected) continue;
    finalJunctionSelectionBag = selected.state;
    junctionBagWitnesses.push(createDungeonSelectionBagWitness({
      family: 'junction',
      bag: beforeJunctionBag,
      legalIds: selectedLegalJunctionKinds,
      selection: selected,
    }));
    junctionSelections.push({
      nodeOrdinal,
      junctionKind,
      cycle: selected.state.cycle,
      refilled: selected.refilled,
      realized: Number(node.graphDegree) >= 3,
    });
  }
  const encounterSelectionResult = selectRouteNetworkEncounters(
    nodes,
    selectionBags?.encounter,
  );
  const roomLayoutSelections = nodes
    .filter(({ kind }) => kind === 'supplementRoom')
    .map((node) => {
      const selected = roomLayoutSelectionResult.selections.find(({ nodeOrdinal }) => (
        nodeOrdinal === Number(node.ordinal)
      ));
      return selected ?? {
        nodeOrdinal: Number(node.ordinal),
        grammarId: String(node.grammarId),
        contentRole: String(node.contentRole ?? ''),
        cycle: Number(roomLayoutSelectionResult.bag?.cycle ?? 0),
        refilled: false,
        topologyKit: Number(node.ordinal) === topologyKitModuleIndex,
      };
    });
  const normalizedSemanticSignature = canonicalStringify({
    topologyTemplateId,
    elevationMode,
    junctions: junctionSelections.map(({ nodeOrdinal, junctionKind }) => ({
      nodeOrdinal,
      junctionKind,
    })),
    roomLayouts: roomLayoutSelections.map(({
      nodeOrdinal,
      grammarId,
      contentRole,
      topologyKit,
    }) => ({ nodeOrdinal, grammarId, contentRole, topologyKit })),
    encounters: encounterSelectionResult.selections.map(({
      nodeOrdinal,
      encounterProfileId,
    }) => ({ nodeOrdinal, encounterProfileId })),
  });
  const topologyBagWitness = createDungeonSelectionBagWitness({
    family: 'topology',
    bag: selectionBags?.topology,
    legalIds: topologyLegalIds ?? selectionBags?.topology?.order ?? [topologyTemplateId],
    selection: topologySelection,
  });
  const elevationBagWitness = createDungeonSelectionBagWitness({
    family: 'elevation',
    bag: selectionBags?.elevation,
    legalIds: elevationLegalIds ?? selectionBags?.elevation?.order ?? [elevationMode],
    selection: elevationSelection,
  });
  const selectionManifest = {
    schema: 'ruindivex-dungeon-route-network-selection-manifest/v1',
    topology: {
      id: topologyTemplateId,
      cycle: Number(topologySelection?.state?.cycle ?? selectionBags?.topology?.cycle ?? 0),
      refilled: Boolean(topologySelection?.refilled),
    },
    elevation: {
      id: elevationMode,
      cycle: Number(elevationSelection?.state?.cycle ?? selectionBags?.elevation?.cycle ?? 0),
      refilled: Boolean(elevationSelection?.refilled),
    },
    junctions: junctionSelections,
    roomLayouts: roomLayoutSelections,
    encounters: encounterSelectionResult.selections,
    bagWitnesses: {
      topology: [topologyBagWitness],
      junction: junctionBagWitnesses,
      elevation: [elevationBagWitness],
      encounter: encounterSelectionResult.witnesses,
      roomLayout: roomLayoutSelectionResult.witnesses,
    },
    normalizedSemanticSignature,
  };
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
    selectionManifest,
    normalizedSemanticSignature,
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
  return {
    operation,
    nodes,
    segments,
    // Planner-only evidence for profiling and debug tooling. The attempt
    // assembler intentionally consumes only the deterministic operation,
    // nodes, segments, signatures, and bag state below, so elapsed timing can
    // never enter a plan hash or alter replay output.
    planningPhaseTimings: physicalPlanningPhaseTimings
      ? cloneDungeonAugmentationValue(physicalPlanningPhaseTimings)
      : null,
    normalizedSemanticSignature,
    selectionBags: {
      ...selectionBags,
      junction: finalJunctionSelectionBag,
      roomLayout: roomLayoutSelectionResult.bag,
      encounter: encounterSelectionResult.bag,
    },
    signatureAlternativesExhausted: [
      Boolean(topologySelection?.refilled),
      Boolean(elevationSelection?.refilled),
      ...junctionSelections.map(({ refilled }) => refilled),
      ...roomLayoutSelections.map(({ refilled }) => refilled),
      ...encounterSelectionResult.selections.map(({ refilled }) => refilled),
    ].every(Boolean),
  };
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
  const roomLayoutFamilyIds = profile.grammarPool
    .map(({ id }) => grammars[id])
    .filter((grammar) => (
      grammar
        && String(grammar.selectionConstraints?.routeNetworkModuleKind ?? 'room') === 'room'
    ))
    .map(({ id }) => id);
  const initialSelectionBags = {
    topology: createDungeonSelectionBag(
      random.fork('topology-bag'),
      settings.topologyTemplates,
    ),
    junction: createDungeonSelectionBag(
      random.fork('junction-bag'),
      settings.junctionKinds,
    ),
    elevation: createDungeonSelectionBag(
      random.fork('elevation-bag'),
      settings.elevationModes,
    ),
    encounter: createDungeonSelectionBag(
      random.fork('selection-bag:encounter'),
      ROUTE_NETWORK_ENCOUNTER_PROFILE_IDS,
    ),
    roomLayout: createDungeonSelectionBag(
      random.fork('selection-bag:room-layout'),
      roomLayoutFamilyIds,
    ),
  };
  const topologyBag = initialSelectionBags.topology.order;
  const junctionBag = initialSelectionBags.junction.order;
  const elevationBag = initialSelectionBags.elevation.order;
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
    profile?.requiredVariety?.elevationModeCount ?? 1,
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
        // Three or four exact stations split the supplemental arc into at
        // least two independently balanced intervals. Five modules can leave
        // one interval with no substantive room capable of owning its
        // transfer, so it is semantically impossible before placement begins.
        Number(grants[operationOrdinal].grant.endpointSockets?.length ?? 0) >= 3
          ? 6
          : 0,
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
  const candidateAttemptTrace = [];
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
    const requestedElevationModes = mustConsumeUnusedElevationMode
      ? legalElevationModes.filter((mode) => !previouslyUsedElevationModes.has(mode))
      : legalElevationModes;
    const elevationSelections = dungeonSelectionBagCandidates(
      state.selectionBags.elevation,
      requestedElevationModes,
    );
    const elevationModes = elevationSelections.map(({ id }) => id);
    if (elevationSelections.length === 0) {
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
      for (const elevationMode of elevationModes) {
        for (const moduleCount of primaryModuleCounts) {
          addCandidateSignature(moduleCount, elevationMode);
        }
      }
      for (const moduleCount of moduleCounts.slice(primaryModuleCounts.length)) {
        for (const elevationMode of elevationModes) {
          addCandidateSignature(moduleCount, elevationMode);
        }
      }
    }
    const legalTopologyIds = topologyBag.filter((topologyTemplateId) => (
      routeNetworkTopologyIsLegalForGrant(topologyTemplateId, grant)
    ));
    const topologySelections = dungeonSelectionBagCandidates(
      state.selectionBags.topology,
      legalTopologyIds,
    );
    const junctionSelections = dungeonSelectionBagCandidates(
      state.selectionBags.junction,
      junctionBag,
    );
    const familyChoices = [];
    for (let diagonal = 0;
      diagonal < topologySelections.length + junctionSelections.length - 1;
      diagonal += 1) {
      // Iterate junction first so the topology index advances immediately:
      // (T0,J0), (T1,J0), (T0,J1), ... . The former topology-major flatten
      // could spend an entire required-network candidate budget retrying one
      // physically impossible topology with different junction labels.
      for (let junctionIndex = 0;
        junctionIndex < junctionSelections.length;
        junctionIndex += 1) {
        const topologyIndex = diagonal - junctionIndex;
        if (topologyIndex < 0 || topologyIndex >= topologySelections.length) continue;
        familyChoices.push({
          topologySelection: topologySelections[topologyIndex],
          junctionSelection: junctionSelections[junctionIndex],
        });
      }
    }
    const familyCandidateSignatures = [];
    for (const {
      firstIndex: signatureIndex,
      secondIndex: familyChoiceIndex,
    } of interleavedCartesianIndexPairs(
      candidateSignatures.length,
      familyChoices.length,
    )) {
      const physicalSignature = candidateSignatures[signatureIndex];
      const { topologySelection, junctionSelection } = familyChoices[familyChoiceIndex];
      if (!routeNetworkTopologySupportsModuleCount(
        topologySelection.id,
        grant,
        physicalSignature.moduleCount,
      )) continue;
      familyCandidateSignatures.push({
        ...physicalSignature,
        topologySelection,
        junctionSelection,
        elevationSelection: elevationSelections.find(({ id }) => (
          id === physicalSignature.elevationMode
        )),
      });
    }
    const candidateLimit = grant.required
      ? grant.kind === 'landmark-perimeter-loop'
        ? Math.min(24, familyCandidateSignatures.length)
        : Math.min(denseMultiStationCoverage ? 8 : 12, familyCandidateSignatures.length)
      : Math.min(1, familyCandidateSignatures.length);
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
      const candidateSignature = familyCandidateSignatures[candidateOrdinal];
      if (!candidateSignature?.topologySelection
        || !candidateSignature?.elevationSelection) continue;
      const {
        moduleCount,
        elevationMode,
        topologySelection,
        junctionSelection,
        elevationSelection,
      } = candidateSignature;
      const candidateRandom = candidateOrdinal === 0
        ? random.fork(`network:${grant.id}`)
        : random.fork(`network:${grant.id}:global-solver:${candidateOrdinal}`);
      const candidatePlanningStartedAt = globalThis.performance?.now?.() ?? Date.now();
      const planned = planRouteNetwork({
        region,
        grant,
        operationOrdinal,
        moduleCount,
        topologyTemplateId: topologySelection.id,
        junctionBag,
        elevationMode,
        selectionBags: state.selectionBags,
        topologySelection,
        topologyLegalIds: legalTopologyIds,
        junctionSelection,
        elevationSelection,
        elevationLegalIds: requestedElevationModes,
        random: candidateRandom,
        profile,
        grammars,
        progressionOrderStart: state.progressionOrder,
        planningAvoidanceVolumes,
        moduleCapacity: maximumModules,
        searchVariant: candidateSignature.placementVariant ?? candidateOrdinal,
      });
      const candidateAttemptRecord = {
        operationOrdinal,
        candidateOrdinal,
        grantId: grant.id,
        moduleCount,
        elevationMode,
        topologyTemplateId: topologySelection.id,
        junctionKind: junctionSelection.id,
        status: planned.error ? 'failed' : 'planned',
        error: planned.error ?? null,
        reason: planned.context?.reason ?? null,
      };
      candidateAttemptTrace.push(candidateAttemptRecord);
      if (globalThis.__DUNGEON_AUGMENTATION_ROUTE_CANDIDATE_DEBUG__ === true) {
        const candidatePlanningElapsedMs = (globalThis.performance?.now?.() ?? Date.now())
          - candidatePlanningStartedAt;
        console.error(JSON.stringify({
          ...candidateAttemptRecord,
          searchVariant: candidateSignature.placementVariant ?? candidateOrdinal,
          planningElapsedMs: Number(candidatePlanningElapsedMs.toFixed(3)),
          planningPhaseTimings: planned.context?.planningPhaseTimings
            ?? planned.planningPhaseTimings
            ?? null,
          plannedNodeCount: planned.nodes?.length ?? 0,
          substantiveModuleCount: planned.operation?.substantiveModuleCount ?? null,
          context: planned.context ?? null,
        }));
      }
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
      if ((state.usedCompleteSignatures ?? []).includes(
        planned.normalizedSemanticSignature,
      ) && planned.signatureAlternativesExhausted !== true) {
        if (grant.required) {
          recordRequiredFailure({
            error: 'route-network-complete-signature-repeated-before-exhaustion',
            context: {
              grantId: grant.id,
              normalizedSemanticSignature: planned.normalizedSemanticSignature,
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
        selectionBags: {
          ...planned.selectionBags,
          topology: topologySelection.state,
          elevation: elevationSelection.state,
        },
        usedCompleteSignatures: [
          ...(state.usedCompleteSignatures ?? []),
          planned.normalizedSemanticSignature,
        ],
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
    selectionBags: initialSelectionBags,
    usedCompleteSignatures: [],
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
          candidateAttemptTrace: candidateAttemptTrace.slice(-32),
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
