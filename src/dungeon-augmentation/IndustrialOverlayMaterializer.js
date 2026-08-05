import {
  DUNGEON_CONNECTOR_VARIANT_IDS,
  createDungeonConnectorVariantContract,
} from '../DungeonConnectorVariants.js';
import {
  createDungeonJunctionGeometryRecord,
  createDungeonSocketLandingOverlapVolume,
  dungeonRouteEndpointGridCoordinate,
  transformDungeonLocalPoint,
} from './geometry.js';
import {
  DUNGEON_ROUTE_ENDPOINT_SEAM_GRID_LATTICE_DIAGNOSTIC,
  inspectDungeonRouteEndpointSeamGridLattice,
} from './endpointSeamLattice.js';
import {
  INDUSTRIAL_SUPPLEMENT_MODULE_MANIFEST_SCHEMA,
  resolveIndustrialSupplementEncounterRecipe,
  resolveIndustrialSupplementHazardRecipe,
  resolveIndustrialSupplementMechanismRecipe,
  resolveIndustrialSupplementModuleManifest,
  resolveIndustrialSupplementRewardRecipe,
} from './IndustrialSupplementContent.js';
import {
  INDUSTRIAL_SUPPLEMENT_BLUEPRINT_SCHEMA,
  resolveIndustrialSupplementBlueprint,
} from './IndustrialSupplementBlueprintCatalog.js';
import {
  inspectIndustrialSupplementManifestStructuralQuality,
  inspectIndustrialSupplementRealizedStructuralQuality,
} from './IndustrialSupplementStructuralQuality.js';
import { canonicalStringify, stableHashText } from './canonical.js';
import {
  objectiveCoverageGrantForOperationStationSide,
} from './objectiveCoverageStationSide.js';
import { inspectConnectorOnlyParentAnchoredProjection } from './parentAnchoredConnectorForest.js';

const CONNECTOR_ELEVATION_EPSILON = 0.000001;
const INDUSTRIAL_SUPPLEMENT_V4_PROFILE_ID = 'industrial-supplement-preview-v4';
const INDUSTRIAL_SUPPLEMENT_CONTENT_CONTRACT_ERROR =
  'DUNGEON_SUPPLEMENT_CONTENT_CONTRACT_REJECTED';
const INDUSTRIAL_SUPPLEMENT_PRESENTATION_RECORD_SCHEMA =
  'ruindivex-industrial-supplement-presentation-record/v1';
const INDUSTRIAL_SUPPLEMENT_PROTECTED_SIGHTLINE_SCHEMA =
  'ruindivex-industrial-supplement-protected-sightline/v1';
const INDUSTRIAL_SUPPLEMENT_STORY_SELECTION_NAMESPACE =
  'ruindivex-industrial-supplement-story-marking-selection/v1';
const V4_CONNECTOR_SPINE_DIAGNOSTICS = Object.freeze({
  SEAM_GRID_LATTICE_INVALID: DUNGEON_ROUTE_ENDPOINT_SEAM_GRID_LATTICE_DIAGNOSTIC,
  WRONG_SEAM_SIDE: 'DUNGEON_AUGMENTATION_ROUTE_WRONG_SEAM_SIDE',
  MISSING_CENTERLINE_FLOOR: 'DUNGEON_AUGMENTATION_ROUTE_CENTERLINE_FLOOR_MISSING',
  FORWARD_TRAVERSAL_REJECTED: 'DUNGEON_AUGMENTATION_ROUTE_FORWARD_TRAVERSAL_REJECTED',
  REVERSE_TRAVERSAL_REJECTED: 'DUNGEON_AUGMENTATION_ROUTE_REVERSE_TRAVERSAL_REJECTED',
});

const SUPPLEMENT_CONNECTOR_FAMILY_VARIANTS = Object.freeze({
  'service-gallery': DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
  service_gallery: DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
  serviceGallery: DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
  [DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY]:
    DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
  slope: DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
  [DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE]:
    DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
  ladder: DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
  [DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY]:
    DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
  lift: DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  automatic_lift: DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  automaticLift: DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  [DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT]:
    DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  'shortcut-lift': DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  shortcutLift: DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
  'drop-ladder': DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
  dropLadder: DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableIdPart(value, fallback = 'unnamed') {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function supplementShortcutMechanismId(operationId, connectionId) {
  return [
    'supplementShortcutMechanism',
    operationId,
    connectionId,
  ].map((part) => stableIdPart(part)).join('__');
}

function supplementConnectorFamily(segment = {}) {
  return String(segment.connectorFamily ?? segment.family ?? 'service-gallery');
}

function connectorVariantIdForFamily(family) {
  return SUPPLEMENT_CONNECTOR_FAMILY_VARIANTS[family] ?? null;
}

function connectorMaterializationError(segment, message, cause = null) {
  const error = new Error(`Supplement segment ${segment?.id ?? '(unnamed)'} ${message}.`, {
    cause: cause ?? undefined,
  });
  error.code = 'DUNGEON_SUPPLEMENT_CONNECTOR_CONTRACT_REJECTED';
  error.segmentId = segment?.id ?? null;
  error.connectorFamily = supplementConnectorFamily(segment);
  return error;
}

function routeNetworkMaterializationFailure(error, {
  operationId = null,
  grantId = null,
  segmentId = null,
  connectorFamily = null,
} = {}) {
  const resolvedSegmentId = error?.segmentId ?? segmentId;
  const resolvedGrantId = grantId == null ? null : String(grantId);
  if (
    error?.code !== 'DUNGEON_SUPPLEMENT_CONNECTOR_CONTRACT_REJECTED'
    || resolvedSegmentId == null
    || resolvedGrantId == null
  ) return null;
  return {
    code: error.code,
    diagnosticCode: error?.diagnosticCode ?? null,
    message: error?.message ?? String(error),
    operationId: operationId == null ? null : String(operationId),
    grantId: resolvedGrantId,
    entityKind: 'segment',
    segmentId: String(resolvedSegmentId),
    connectorFamily: String(
      error?.connectorFamily ?? connectorFamily ?? 'service-gallery',
    ),
  };
}

function connectorSpineMaterializationError(segment, diagnosticCode, message, details = null) {
  const error = connectorMaterializationError(
    segment,
    `[${diagnosticCode}] ${message}`,
  );
  error.diagnosticCode = diagnosticCode;
  error.details = details == null ? null : clonePlainValue(details);
  return error;
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

function stableV4GridPoint(value, tileSize) {
  const point = pointOf(value);
  const coordinate = (metric) => Math.round(Number((
    Number(metric.toFixed(6)) / tileSize
  ).toFixed(6)));
  return {
    x: coordinate(point.x),
    z: coordinate(point.z),
  };
}

function routeEndpointGridPoint(value, tileSize) {
  const point = pointOf(value);
  return {
    x: dungeonRouteEndpointGridCoordinate(point.x, tileSize),
    z: dungeonRouteEndpointGridCoordinate(point.z, tileSize),
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

function gridPath(rawPath, tileSize, pointResolver = gridPoint) {
  const raw = (Array.isArray(rawPath) ? rawPath : []).map((point) => (
    pointResolver(point, tileSize)
  ));
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
  return operation?.type ?? operation?.operationType ?? operation?.kind ?? null;
}

function isRouteNetworkOperation(operation) {
  return operationType(operation) === 'routeNetwork';
}

function isSupplementConnectorJunctionNode(node = {}) {
  return ['supplementConnectorJunction', 'supplementConnectorModule'].includes(node.kind)
    || ['supplementConnectorJunction', 'supplementConnectorModule'].includes(node.nodeKind)
    || node.isSupplementConnectorJunction === true
    || node.isSupplementConnectorModule === true;
}

function pointsApproximatelyEqual(first, second, tolerance = 0.001) {
  const a = pointOf(first);
  const b = pointOf(second);
  return Math.abs(a.x - b.x) <= tolerance
    && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.z - b.z) <= tolerance;
}

function facingsEqual(first, second) {
  const a = cardinalFacingOf(first);
  const b = cardinalFacingOf(second);
  return Boolean(a && b && a.x === b.x && a.z === b.z);
}

function routeNetworkGrantIndex(extensionRegions = []) {
  const result = new Map();
  for (const region of extensionRegions) {
    const attachmentById = new Map((region.attachmentSockets ?? []).map((socket) => (
      [String(socket.id), socket]
    )));
    for (const grant of region.routeNetworkGrants ?? []) {
      const endpointSockets = (grant.endpointSockets ?? grant.sockets ?? []).map((entry) => (
        typeof entry === 'string' ? attachmentById.get(entry) : entry
      )).filter(Boolean);
      result.set(String(grant.id), {
        ...grant,
        parentRegionId: grant.parentRegionId ?? region.id,
        themeBinding: grant.themeBinding ?? region.themeBinding ?? null,
        endpointSockets,
      });
    }
  }
  return result;
}

function isAuthoredCorridorStationSocket(socket = {}) {
  return socket.routeNetworkSocketKind === 'authored-corridor-station'
    || socket.socketKind === 'authored-corridor-station'
    || socket.kind === 'authored-corridor-station';
}

function routeStationRoomId(operation, socket) {
  const suffix = String(socket.id).replace(/[^A-Za-z0-9_.-]+/g, '_');
  return `${operation.id}:route-station:${suffix}`;
}

function findParentRoutePlan(socket, connectionPlans) {
  const routeId = socket.parentRouteId
    ?? socket.logicalEdgeId
    ?? socket.logicalConnectionId
    ?? socket.nodeId
    ?? null;
  return connectionPlans.find((plan) => [
    plan.id,
    plan.logicalConnectionId,
    plan.logicalEdgeId,
  ].some((candidate) => String(candidate ?? '') === String(routeId ?? ''))) ?? null;
}

function createCorridorStationRooms({
  operations,
  grantsById,
  connectionPlans,
  tileSize,
}) {
  const stations = [];
  const bySocketId = new Map();
  const errors = [];
  for (const operation of operations.filter(isRouteNetworkOperation)) {
    const grant = objectiveCoverageGrantForOperationStationSide(
      grantsById.get(String(operation.grantId)),
      operation,
    );
    if (!grant) continue;
    const selected = new Set(routeNetworkEndpointSocketIds(operation, grant));
    for (const socket of grant.endpointSockets ?? []) {
      if (!selected.has(String(socket.id)) || !isAuthoredCorridorStationSocket(socket)) continue;
      const parentPlan = findParentRoutePlan(socket, connectionPlans);
      if (!parentPlan) {
        errors.push(
          `Route network ${operation.id} corridor station ${socket.id} cannot resolve its authored parent route.`,
        );
        continue;
      }
      const centerlinePosition = pointOf(
        socket.sourceCenterlinePosition ?? socket.centerlinePosition ?? socket.position ?? socket,
      );
      const stationGrid = gridPoint(centerlinePosition, tileSize);
      const parentPath = parentPlan.fullPath ?? parentPlan.bridgePath ?? [];
      const nearestIndex = parentPath.reduce((bestIndex, point, index) => {
        const candidate = { x: number(point.x), z: number(point.z) };
        const best = parentPath[bestIndex] ?? candidate;
        return distanceSquared(stationGrid, candidate) < distanceSquared(stationGrid, best)
          ? index
          : bestIndex;
      }, 0);
      const nearest = parentPath[nearestIndex];
      if (!nearest || distanceSquared(stationGrid, nearest) > 0.26) {
        errors.push(
          `Route network ${operation.id} corridor station ${socket.id} is not centered on its authored parent route.`,
        );
        continue;
      }
      const neighbor = parentPath[nearestIndex + 1] ?? parentPath[nearestIndex - 1] ?? nearest;
      const alongX = Math.abs(number(neighbor.x) - number(nearest.x))
        >= Math.abs(number(neighbor.z) - number(nearest.z));
      const id = routeStationRoomId(operation, socket);
      parentPlan.hasDungeonSupplementRouteStation = true;
      parentPlan.dungeonSupplementRouteStationIds = [...new Set([
        ...(parentPlan.dungeonSupplementRouteStationIds ?? []),
        id,
      ])];
      const junction = createDungeonJunctionGeometryRecord({
        id: `${id}:junction`,
        nodeId: id,
        junctionKind: socket.junctionKind ?? 'through-t',
        center: centerlinePosition,
        elevation: centerlinePosition.y,
        tileSize,
        throughSocketPairs: [['parent-route-source', 'parent-route-destination']],
        decisionSocketIds: [String(socket.id)],
        activeSocketIds: ['parent-route-source', 'parent-route-destination', String(socket.id)],
        operationId: operation.id,
        accessDomainId: operation.accessDomainId ?? grant.accessDomainId,
        progressionBandId: operation.progressionBandId ?? grant.progressionBandId,
      });
      const room = {
        id,
        type: 'supplement',
        tileType: 'floor',
        x: stationGrid.x,
        z: stationGrid.z,
        // This is a graph identity for an aperture cut into an already-owned
        // authored corridor, not a generated room. Giving it a 5x7 footprint
        // stamped extra floors, walls, ceilings, and isolated columns which
        // could masquerade as substantive augmentation. Its exact physical
        // footing remains the parent gallery plus the attached connector.
        width: alongX ? 7 : 5,
        depth: alongX ? 5 : 7,
        plannedBaseElevation: centerlinePosition.y,
        baseElevation: centerlinePosition.y,
        ceilingHeight: Math.max(5.6, number(socket.heightMeters, 5.6)),
        archetype: 'supplement',
        archetypeId: 'supplement-authored-corridor-station-v1',
        purpose: 'route_network_corridor_station',
        mood: 'inherited_parent_region',
        environmentalStory: null,
        exitSockets: [],
        augmentationNodeId: id,
        augmentationOperationId: operation.id,
        augmentationOperationType: 'routeNetwork',
        augmentationGrantId: operation.grantId,
        augmentationThemeBinding: operation.themeBinding ?? grant.themeBinding ?? null,
        augmentationNetworkRole: 'authored-corridor-station',
        augmentationContentRole: 'junction',
        augmentationTopologyTemplateId: operation.topologyTemplateId ?? null,
        augmentationAccessDomainId: operation.accessDomainId ?? grant.accessDomainId ?? null,
        augmentationProgressionBandId: operation.progressionBandId
          ?? grant.progressionBandId
          ?? null,
        augmentationJunction: junction,
        junctionKind: junction?.junctionKind ?? 'through-t',
        countsAsMeaningfulStation: true,
        parentRouteId: parentPlan.id,
        parentLogicalEdgeId: parentPlan.logicalConnectionId ?? parentPlan.logicalEdgeId ?? null,
        routeNetworkSocketId: String(socket.id),
        routeNetworkSocketKind: 'authored-corridor-station',
        allowedParentOverlapVolume: clonePlainValue(
          socket.junctionFootprint
            ?? socket.allowedOverlapVolume
            ?? junction?.clearCoreVolume
            ?? null,
        ),
        isDungeonSupplement: false,
        isRouteStationProxy: true,
        isConnectorJunctionProxy: true,
        suppressRoomGeometry: true,
      };
      const station = { room, socket, operation, grant, parentPlan, nearestIndex };
      stations.push(station);
      bySocketId.set(String(socket.id), station);
    }
  }
  return { stations, bySocketId, errors };
}

function routeNetworkEndpointSocketIds(operation, grant) {
  const declared = operation.endpointSocketIds ?? grant?.endpointSocketIds;
  if (Array.isArray(declared) && declared.length > 0) return declared.map(String);
  return (grant?.endpointSockets ?? []).map((socket) => String(socket.id));
}

function endpointSocketId(endpoint) {
  return endpoint?.socketId ?? endpoint?.id ?? endpoint?.sourceSocketId ?? null;
}

function exactRouteNetworkEndpoint({
  endpoint,
  role,
  operation,
  grant,
  overlayNodeById,
  corridorStationBySocketId,
  oppositeEndpoint = null,
  segment = null,
}) {
  const nodeId = endpointNodeId(endpoint);
  const socketId = endpointSocketId(endpoint);
  if (!nodeId || !socketId) {
    throw new Error(
      `Route network ${operation.id} ${role} endpoint must name an exact nodeId and socketId.`,
    );
  }

  const supplementNode = overlayNodeById.get(String(nodeId));
  if (supplementNode) {
    const socket = (supplementNode.sockets ?? []).find((candidate) => (
      String(candidate.id) === String(socketId)
    ));
    if (!socket) {
      throw new Error(
        `Route network ${operation.id} ${role} endpoint references missing supplement socket ${socketId}.`,
      );
    }
    if (endpoint.position && !pointsApproximatelyEqual(endpoint.position, socket.position)) {
      throw new Error(
        `Route network ${operation.id} ${role} endpoint position does not match supplement socket ${socketId}.`,
      );
    }
    if (endpoint.facing && socket.facing && !facingsEqual(endpoint, socket)) {
      throw new Error(
        `Route network ${operation.id} ${role} endpoint facing does not match supplement socket ${socketId}.`,
      );
    }
    return {
      ...clonePlainValue(endpoint),
      kind: 'supplementSocket',
      id: String(socketId),
      socketId: String(socketId),
      nodeId: String(nodeId),
      position: clonePlainValue(socket.position),
      facing: clonePlainValue(socket.facing),
      exactSocketBinding: true,
    };
  }

  const permittedIds = new Set(routeNetworkEndpointSocketIds(operation, grant));
  if (!permittedIds.has(String(socketId))) {
    throw new Error(
      `Route network ${operation.id} ${role} endpoint socket ${socketId} is not granted.`,
    );
  }
  const socket = (grant?.endpointSockets ?? []).find((candidate) => (
    String(candidate.id) === String(socketId)
  ));
  if (!socket) {
    throw new Error(
      `Route network ${operation.id} cannot resolve granted endpoint socket ${socketId}.`,
    );
  }
  const grantedNodeId = String(socket.nodeId ?? socket.roomId ?? '');
  if (!grantedNodeId || String(nodeId) !== grantedNodeId) {
    throw new Error(
      `Route network ${operation.id} ${role} endpoint node ${nodeId} does not own granted socket ${socketId}.`,
    );
  }
  const corridorStation = corridorStationBySocketId?.get(String(socketId)) ?? null;
  const physicalSocketPosition = socket.position;
  if (endpoint.position && !pointsApproximatelyEqual(endpoint.position, physicalSocketPosition)) {
    throw new Error(
      `Route network ${operation.id} ${role} endpoint position does not match granted socket ${socketId}.`,
    );
  }
  if (endpoint.facing && socket.facing && !facingsEqual(endpoint, socket)) {
    throw new Error(
      `Route network ${operation.id} ${role} endpoint facing does not match granted socket ${socketId}.`,
    );
  }
  return {
    ...clonePlainValue(endpoint),
    ...clonePlainValue(socket),
    kind: 'parentSocket',
    id: String(socketId),
    socketId: String(socketId),
    nodeId: corridorStation?.room.id ?? grantedNodeId,
    roomId: corridorStation?.room.id ?? String(socket.roomId ?? grantedNodeId),
    sourceParentNodeId: grantedNodeId,
    parentRouteId: corridorStation?.parentPlan.id ?? socket.parentRouteId ?? null,
    routeNetworkSocketKind: corridorStation
      ? 'authored-corridor-station'
      : socket.routeNetworkSocketKind ?? socket.socketKind ?? 'parent-room-wall',
    position: clonePlainValue(physicalSocketPosition),
    authoredSocketPosition: clonePlainValue(socket.position),
    exactSocketBinding: true,
    routeNetworkGrantId: operation.grantId,
  };
}

function normalizeRouteNetworkSegment(
  segment,
  operation,
  grant,
  overlayNodeById,
  corridorStationBySocketId,
) {
  const fromEndpoint = endpointOf(segment, 'from');
  const toEndpoint = endpointOf(segment, 'to');
  return {
    ...clonePlainValue(segment),
    operationId: operation.id,
    from: exactRouteNetworkEndpoint({
      endpoint: fromEndpoint,
      role: 'from',
      operation,
      grant,
      overlayNodeById,
      corridorStationBySocketId,
      oppositeEndpoint: toEndpoint,
      segment,
    }),
    to: exactRouteNetworkEndpoint({
      endpoint: toEndpoint,
      role: 'to',
      operation,
      grant,
      overlayNodeById,
      corridorStationBySocketId,
      oppositeEndpoint: fromEndpoint,
      segment,
    }),
  };
}

function routeNetworkSegmentGate(segment = {}) {
  const gate = segment.localGate ?? segment.gate ?? segment.sourceGate ?? null;
  const gateRecord = gate && typeof gate === 'object' ? gate : {};
  const doorId = segment.doorId
    ?? segment.gateId
    ?? gateRecord.doorId
    ?? gateRecord.gateId
    ?? gateRecord.id
    ?? null;
  const requiresEncounterId = segment.requiresEncounterId
    ?? gateRecord.requiresEncounterId
    ?? gateRecord.encounterId
    ?? null;
  const requiredKeycardId = segment.requiredKeycardId
    ?? gateRecord.requiredKeycardId
    ?? gateRecord.credentialId
    ?? null;
  const requiredCredentialIds = [...new Set([
    ...(segment.requiredCredentialIds ?? []),
    ...(gateRecord.requiredCredentialIds ?? []),
    ...(requiredKeycardId ? [requiredKeycardId] : []),
  ].filter(Boolean).map(String))];
  const resolvedRequiredKeycardId = requiredKeycardId ?? requiredCredentialIds[0] ?? null;
  const sourceGateSocketId = segment.sourceGateSocketId
    ?? gateRecord.sourceGateSocketId
    ?? null;
  const gateEndpointRole = segment.gateEndpointRole
    ?? gateRecord.gateEndpointRole
    ?? null;
  return doorId || requiresEncounterId || resolvedRequiredKeycardId ? {
    doorId: doorId == null ? null : String(doorId),
    requiresEncounterId: requiresEncounterId == null ? null : String(requiresEncounterId),
    requiredKeycardId: resolvedRequiredKeycardId == null
      ? null
      : String(resolvedRequiredKeycardId),
    requiredCredentialIds,
    sourceGateSocketId: sourceGateSocketId == null ? null : String(sourceGateSocketId),
    gateEndpointRole: gateEndpointRole == null ? null : String(gateEndpointRole),
    supplementalIdentity: gateRecord.supplementalIdentity === true,
  } : null;
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

function plainValuesEqual(first, second) {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first)
      && Array.isArray(second)
      && first.length === second.length
      && first.every((value, index) => plainValuesEqual(value, second[index]));
  }
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object') {
    return false;
  }
  const firstKeys = Object.keys(first).sort();
  const secondKeys = Object.keys(second).sort();
  return firstKeys.length === secondKeys.length
    && firstKeys.every((key, index) => (
      key === secondKeys[index] && plainValuesEqual(first[key], second[key])
    ));
}

function supplementContentContractError(node, message, cause = null) {
  const error = new Error(`Supplement room ${node?.id ?? '(unnamed)'} ${message}.`, {
    cause: cause ?? undefined,
  });
  error.code = INDUSTRIAL_SUPPLEMENT_CONTENT_CONTRACT_ERROR;
  error.nodeId = node?.id ?? null;
  error.grammarId = node?.grammarId ?? null;
  error.contentRole = node?.contentRole ?? null;
  return error;
}

function assertSupplementContentContract(condition, node, message) {
  if (!condition) throw supplementContentContractError(node, message);
}

function exactStringIdSet(records, node, label) {
  const ids = (records ?? []).map(({ id }) => String(id ?? ''));
  assertSupplementContentContract(
    ids.every(Boolean) && new Set(ids).size === ids.length,
    node,
    `has invalid or duplicate ${label} ids`,
  );
  return new Set(ids);
}

function validatedManifestMaskRows(mask, dimensions, legend, node, label) {
  const width = Number(dimensions?.width);
  const depth = Number(dimensions?.depth);
  assertSupplementContentContract(
    Number.isInteger(width) && width > 0 && Number.isInteger(depth) && depth > 0,
    node,
    'has invalid manifest tile dimensions',
  );
  assertSupplementContentContract(
    Array.isArray(mask) && mask.length === depth,
    node,
    `${label} depth does not match its manifest dimensions`,
  );
  const rows = mask.map((row) => String(row ?? ''));
  assertSupplementContentContract(
    rows.every((row) => row.length === width),
    node,
    `${label} width does not match its manifest dimensions`,
  );
  const symbols = new Set(Object.keys(legend ?? {}));
  assertSupplementContentContract(
    symbols.has('#')
      && symbols.has('.')
      && rows.every((row) => [...row].every((symbol) => symbols.has(symbol))),
    node,
    `${label} uses an incomplete or incompatible floor-mask legend`,
  );
  return rows;
}

function manifestMaskCells(rows, origin = {}) {
  const cells = [];
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < rows[row].length; column += 1) {
      if (rows[row][column] !== '#') continue;
      cells.push({
        x: number(origin.x, -Math.floor(rows[row].length / 2)) + column,
        z: number(origin.z, -Math.floor(rows.length / 2)) + row,
        row,
        column,
      });
    }
  }
  return cells;
}

function assertConnectedManifestMask(rows, origin, node, label) {
  const cells = manifestMaskCells(rows, origin);
  assertSupplementContentContract(cells.length > 0, node, `${label} has no walkable cells`);
  const keys = new Set(cells.map(({ x, z }) => `${x},${z}`));
  const pending = [cells[0]];
  const visited = new Set();
  while (pending.length > 0) {
    const cell = pending.pop();
    const key = `${cell.x},${cell.z}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const [offsetX, offsetZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighborKey = `${cell.x + offsetX},${cell.z + offsetZ}`;
      if (keys.has(neighborKey) && !visited.has(neighborKey)) {
        pending.push({ x: cell.x + offsetX, z: cell.z + offsetZ });
      }
    }
  }
  assertSupplementContentContract(
    visited.size === cells.length,
    node,
    `${label} is not four-neighbor connected`,
  );
}

function industrialSupplementBlueprintId(node = {}) {
  const id = node.blueprintId ?? node.moduleBlueprintId ?? node.physicalBlueprintId ?? null;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function industrialSupplementBlueprintCanonicalTurns(node = {}) {
  const turns = number(
    node.blueprintCanonicalRotationQuarterTurns
      ?? node.structure?.blueprintCanonicalRotationQuarterTurns
      ?? node.selectionConstraints?.blueprintCanonicalRotationQuarterTurns,
  );
  return ((Math.trunc(turns) % 4) + 4) % 4;
}

function industrialSupplementSemanticManifestId(node, blueprint) {
  const role = String(node?.contentRole ?? '');
  if (['challenge', 'encounter'].includes(role)) return 'challenge';
  if (['elevation', 'vertical-maintenance'].includes(role)) return 'vertical-maintenance';
  if (['reward', 'treasure', 'payoff'].includes(role)) return 'reward-vault';
  if (['calm', 'discovery'].includes(role)) return 'calm-discovery';
  if (['hazard', 'trap', 'control', 'terminal'].includes(role)) return 'hazard-control';
  if (role === 'mechanism') {
    const hasAuthoredHazard = (blueprint?.zones ?? []).some(({ type }) => type === 'hazard')
      || (blueprint?.features ?? []).some(({ type }) => type === 'hazard');
    return hasAuthoredHazard ? 'hazard-control' : 'vertical-maintenance';
  }
  return null;
}

function rotateBlueprintLocalPoint(point, rotationQuarterTurns) {
  return transformDungeonLocalPoint(point, {
    center: { x: 0, y: 0, z: 0 },
    rotationQuarterTurns,
  });
}

function blueprintMaskLegend() {
  return { '#': 'walkable-floor', '.': 'void' };
}

function blueprintSocketLocalPosition(socket, dimensions, tileSize) {
  const halfWidth = (number(dimensions?.width) - 1) * tileSize * 0.5;
  const halfDepth = (number(dimensions?.depth) - 1) * tileSize * 0.5;
  const center = number(socket?.center) * tileSize;
  if (socket?.side === 'N') return { x: center, y: number(socket.y), z: -halfDepth };
  if (socket?.side === 'S') return { x: center, y: number(socket.y), z: halfDepth };
  if (socket?.side === 'W') return { x: -halfWidth, y: number(socket.y), z: center };
  return { x: halfWidth, y: number(socket?.y), z: center };
}

function blueprintSocketLocalFacing(socket) {
  if (socket?.side === 'N') return { x: 0, y: 0, z: -1 };
  if (socket?.side === 'S') return { x: 0, y: 0, z: 1 };
  if (socket?.side === 'W') return { x: -1, y: 0, z: 0 };
  return { x: 1, y: 0, z: 0 };
}

function blueprintNodeSocketId(socket = {}) {
  return socket.blueprintSocketId
    ?? socket.localBlueprintSocketId
    ?? socket.physicalSocketId
    ?? socket.localSocketId
    ?? null;
}

function approximatelyEqualNumber(first, second, tolerance = 0.0001) {
  return Math.abs(number(first, NaN) - number(second, NaN)) <= tolerance;
}

function blueprintSocketMatchesLocalGeometry(
  node,
  nodeSocket,
  blueprintSocket,
  dimensions,
  tileSize,
) {
  const canonicalTurns = industrialSupplementBlueprintCanonicalTurns(node);
  const expectedPosition = rotateBlueprintLocalPoint(
    blueprintSocketLocalPosition(blueprintSocket, dimensions, tileSize),
    canonicalTurns,
  );
  const expectedFacing = rotateBlueprintLocalPoint(
    blueprintSocketLocalFacing(blueprintSocket),
    canonicalTurns,
  );
  const actualPosition = pointOf(nodeSocket.localPosition ?? {});
  const actualFacing = nodeSocket.localFacing ?? {};
  return pointsApproximatelyEqual(actualPosition, expectedPosition, 0.0001)
    && approximatelyEqualNumber(actualFacing.x, expectedFacing.x)
    && approximatelyEqualNumber(actualFacing.y, expectedFacing.y)
    && approximatelyEqualNumber(actualFacing.z, expectedFacing.z);
}

function resolveBlueprintSocketBindings(node, blueprint, tileSize) {
  const blueprintById = new Map((blueprint.sockets ?? []).map((socket) => (
    [String(socket.id), socket]
  )));
  const usedBlueprintIds = new Set();
  const bindings = [];
  for (const nodeSocket of node.sockets ?? []) {
    const requestedId = blueprintNodeSocketId(nodeSocket);
    let blueprintSocket = requestedId == null ? null : blueprintById.get(String(requestedId));
    if (!blueprintSocket) {
      const geometricMatches = (blueprint.sockets ?? []).filter((candidate) => (
        !usedBlueprintIds.has(String(candidate.id))
        && blueprintSocketMatchesLocalGeometry(
          node,
          nodeSocket,
          candidate,
          blueprint.dimensionsTiles,
          tileSize,
        )
      ));
      if (geometricMatches.length === 1) [blueprintSocket] = geometricMatches;
    }
    assertSupplementContentContract(
      Boolean(blueprintSocket),
      node,
      `socket ${nodeSocket.localSocketId ?? nodeSocket.id} cannot bind an exact blueprint aperture`,
    );
    assertSupplementContentContract(
      !usedBlueprintIds.has(String(blueprintSocket.id)),
      node,
      `binds blueprint socket ${blueprintSocket.id} more than once`,
    );
    assertSupplementContentContract(
      blueprintSocketMatchesLocalGeometry(
        node,
        nodeSocket,
        blueprintSocket,
        blueprint.dimensionsTiles,
        tileSize,
      ),
      node,
      `socket ${nodeSocket.localSocketId ?? nodeSocket.id} does not match blueprint socket ${blueprintSocket.id}`,
    );
    usedBlueprintIds.add(String(blueprintSocket.id));
    bindings.push({ nodeSocket, blueprintSocket });
  }
  assertSupplementContentContract(
    usedBlueprintIds.size === (blueprint.sockets ?? []).length,
    node,
    'does not materialize every authored blueprint socket',
  );
  return bindings;
}

function validateIndustrialSupplementBlueprint({
  node,
  operation,
  blueprint,
  tileSize,
}) {
  assertSupplementContentContract(Boolean(blueprint), node, 'has no resolvable physical blueprint');
  assertSupplementContentContract(
    blueprint.schema === INDUSTRIAL_SUPPLEMENT_BLUEPRINT_SCHEMA,
    node,
    'resolved an incompatible physical-blueprint schema',
  );
  assertSupplementContentContract(
    isRouteNetworkOperation(operation),
    node,
    'uses an authored supplement blueprint outside a route network',
  );
  assertSupplementContentContract(
    node.themeBinding
      && operation?.themeBinding
      && plainValuesEqual(node.themeBinding, operation.themeBinding),
    node,
    'does not preserve the exact operation theme binding for its blueprint',
  );
  assertSupplementContentContract(
    approximatelyEqualNumber(blueprint.floorCellMeters, tileSize)
      && approximatelyEqualNumber(blueprint.tileSizeMeters, tileSize),
    node,
    'uses a blueprint whose planning grid differs from the dungeon grid',
  );
  const dimensions = blueprint.dimensionsTiles;
  const width = Number(dimensions?.width);
  const depth = Number(dimensions?.depth);
  const widthMeters = number(node.size?.x ?? node.size?.width ?? node.size?.widthMeters, NaN);
  const depthMeters = number(node.size?.z ?? node.size?.depth ?? node.size?.depthMeters, NaN);
  const canonicalSwapsAxes = industrialSupplementBlueprintCanonicalTurns(node) % 2 === 1;
  const expectedWidthMeters = (canonicalSwapsAxes ? depth : width) * tileSize;
  const expectedDepthMeters = (canonicalSwapsAxes ? width : depth) * tileSize;
  assertSupplementContentContract(
    Number.isInteger(width)
      && width > 0
      && Number.isInteger(depth)
      && depth > 0
      && approximatelyEqualNumber(widthMeters, expectedWidthMeters)
      && approximatelyEqualNumber(depthMeters, expectedDepthMeters),
    node,
    'planned footprint does not match its authored blueprint dimensions',
  );
  const baseRows = validatedManifestMaskRows(
    blueprint.baseMask ?? blueprint.mask,
    dimensions,
    blueprintMaskLegend(),
    node,
    'blueprint base floor mask',
  );
  assertConnectedManifestMask(
    baseRows,
    blueprint.floorTiers?.[0]?.maskOriginTile,
    node,
    'blueprint base floor mask',
  );
  const baseTiers = (blueprint.floorTiers ?? []).filter((tier) => (
    approximatelyEqualNumber(tier.elevation, 0)
  ));
  assertSupplementContentContract(
    baseTiers.length === 1
      && plainValuesEqual(
        baseTiers[0].floorMask,
        blueprint.baseMask ?? blueprint.mask,
      ),
    node,
    'must define exactly one elevation-zero base tier whose exact cells equal the base mask',
  );
  const tierIds = exactStringIdSet(blueprint.floorTiers, node, 'blueprint floor-tier');
  for (const tier of blueprint.floorTiers ?? []) {
    const rows = validatedManifestMaskRows(
      tier.floorMask,
      dimensions,
      blueprintMaskLegend(),
      node,
      `blueprint floor tier ${tier.id}`,
    );
    assertConnectedManifestMask(rows, tier.maskOriginTile, node, `blueprint floor tier ${tier.id}`);
  }
  exactStringIdSet(blueprint.sockets, node, 'blueprint socket');
  const validSides = new Set(['N', 'E', 'S', 'W']);
  for (const socket of blueprint.sockets ?? []) {
    assertSupplementContentContract(
      validSides.has(socket.side)
        && number(socket.width, NaN) === 3
        && Number.isFinite(Number(socket.center))
        && Number.isFinite(Number(socket.y))
        && (blueprint.floorTiers ?? []).some((tier) => (
          approximatelyEqualNumber(tier.elevation, socket.y)
        )),
      node,
      `blueprint socket ${socket.id} is not an exact three-tile tier aperture`,
    );
  }
  resolveBlueprintSocketBindings(node, blueprint, tileSize);

  const featureIds = exactStringIdSet(blueprint.features ?? [], node, 'blueprint feature');
  for (const [routeOrdinal, route] of (blueprint.routes ?? []).entries()) {
    assertSupplementContentContract(
      tierIds.has(String(route.tier ?? 'base'))
        && Array.isArray(route.points)
        && route.points.length >= 2
        && route.points.every((point) => (
          Array.isArray(point)
            && point.length >= 2
            && Number.isFinite(Number(point[0]))
            && Number.isFinite(Number(point[1]))
        )),
      node,
      `blueprint route ${routeOrdinal} has an invalid tier or polyline`,
    );
  }
  exactStringIdSet(blueprint.zones ?? [], node, 'blueprint zone');
  exactStringIdSet(blueprint.voids ?? [], node, 'blueprint void');
  const validTransferForms = new Set(['ramp', 'stairs', 'lift', 'ladder', 'landing', 'step']);
  for (const transfer of blueprint.physicalTransfers ?? []) {
    const footprint = transfer.footprintTiles ?? {};
    const range = transfer.elevationRangeMeters ?? {};
    assertSupplementContentContract(
      featureIds.has(String(transfer.id))
        && validTransferForms.has(String(transfer.form))
        && Number.isFinite(Number(footprint.x))
        && Number.isFinite(Number(footprint.z))
        && Number.isInteger(Number(footprint.width))
        && Number(footprint.width) > 0
        && Number.isInteger(Number(footprint.depth))
        && Number(footprint.depth) > 0
        && Number.isFinite(Number(range.min))
        && Number.isFinite(Number(range.max))
        && Number(range.min) <= Number(range.max)
        && tierIds.has(String(transfer.tier ?? 'base')),
      node,
      `blueprint transfer ${transfer.id} has an invalid physical traversal contract`,
    );
  }
  const socketElevations = (blueprint.sockets ?? []).map(({ y }) => number(y));
  const hasDifferentExitElevations = socketElevations.some((elevation) => (
    !approximatelyEqualNumber(elevation, socketElevations[0])
  ));
  if (hasDifferentExitElevations) {
    const sectionRoute = blueprint.sectionRoute ?? [];
    const hasPrimaryVerticalTransfer = (blueprint.physicalTransfers ?? []).some(({ form }) => (
      ['ramp', 'stairs', 'lift', 'ladder'].includes(String(form))
    ));
    const socketCountsByElevation = new Map();
    for (const elevation of socketElevations) {
      const key = elevation.toFixed(6);
      socketCountsByElevation.set(key, (socketCountsByElevation.get(key) ?? 0) + 1);
    }
    const isDisjointTierCrossover = !hasPrimaryVerticalTransfer
      && socketCountsByElevation.size >= 2
      && [...socketCountsByElevation.values()].every((count) => count >= 2);
    const sectionIsExecutable = sectionRoute.length >= 2
      && approximatelyEqualNumber(sectionRoute[0]?.[1], socketElevations[0])
      && socketElevations.some((elevation) => (
        approximatelyEqualNumber(sectionRoute.at(-1)?.[1], elevation)
      ));
    assertSupplementContentContract(
      isDisjointTierCrossover
        || (hasPrimaryVerticalTransfer && (sectionRoute.length === 0 || sectionIsExecutable)),
      node,
      'does not physically realize its differing socket elevations',
    );
  }
  return blueprint;
}

function validateIndustrialSupplementManifest({
  node,
  operation,
  manifest,
  tileSize,
  physicalBlueprint = null,
}) {
  assertSupplementContentContract(Boolean(manifest), node, 'has no compatible V4 module manifest');
  assertSupplementContentContract(
    isRouteNetworkOperation(operation) && node?.kind === 'supplementRoom',
    node,
    'is not a substantive V4 route-network room',
  );
  assertSupplementContentContract(
    manifest.schema === INDUSTRIAL_SUPPLEMENT_MODULE_MANIFEST_SCHEMA
      && manifest.profileId === INDUSTRIAL_SUPPLEMENT_V4_PROFILE_ID,
    node,
    'resolved an incompatible module-manifest schema or profile',
  );
  assertSupplementContentContract(
    (physicalBlueprint || manifest.compatibleGrammarIds?.includes(node.grammarId))
      && manifest.compatibleModuleKinds?.includes(node.moduleKind)
      && manifest.contentRoles?.includes(node.contentRole),
    node,
    'resolved a semantic manifest incompatible with its module kind or content role',
  );
  assertSupplementContentContract(
    node.themeBinding
      && operation?.themeBinding
      && plainValuesEqual(node.themeBinding, operation.themeBinding),
    node,
    'does not preserve the exact operation theme binding',
  );

  const stableRuntimeStateIds = operation.stableRuntimeStateIds;
  const requiredStateKinds = ['encounter', 'mechanism', 'reward', 'shortcut'];
  assertSupplementContentContract(
    stableRuntimeStateIds
      && requiredStateKinds.every((kind) => (
        typeof stableRuntimeStateIds[kind] === 'string'
          && stableRuntimeStateIds[kind].length > 0
      ))
      && new Set(requiredStateKinds.map((kind) => stableRuntimeStateIds[kind])).size
        === requiredStateKinds.length,
    node,
    'does not carry the complete stable V4 runtime-state identity set',
  );

  const dimensions = manifest.layout?.dimensionsTiles;
  const widthMeters = number(node.size?.x ?? node.size?.width ?? node.size?.widthMeters, NaN);
  const depthMeters = number(node.size?.z ?? node.size?.depth ?? node.size?.depthMeters, NaN);
  assertSupplementContentContract(
    (physicalBlueprint || (
      Number.isFinite(widthMeters)
        && Number.isFinite(depthMeters)
        && Math.abs(widthMeters / tileSize - Number(dimensions?.width)) <= 0.000001
        && Math.abs(depthMeters / tileSize - Number(dimensions?.depth)) <= 0.000001
    ))
      && Math.abs(number(manifest.floorCellMeters, NaN) - tileSize) <= 0.000001,
    node,
    'semantic manifest floor dimensions are invalid or incompatible with its legacy footprint',
  );
  const baseRows = validatedManifestMaskRows(
    manifest.floorMask,
    dimensions,
    manifest.floorMaskLegend,
    node,
    'base floor mask',
  );
  assertConnectedManifestMask(baseRows, {
    x: -Math.floor(Number(dimensions.width) / 2),
    z: -Math.floor(Number(dimensions.depth) / 2),
  }, node, 'base floor mask');

  const floorTierIds = exactStringIdSet(manifest.floorTiers, node, 'floor-tier');
  const clearRouteIds = exactStringIdSet(manifest.clearRoutes, node, 'clear-route');
  const zoneIds = exactStringIdSet(manifest.zones, node, 'zone');
  const anchorIds = exactStringIdSet(manifest.anchors, node, 'anchor');
  exactStringIdSet(manifest.cover, node, 'cover');
  exactStringIdSet(manifest.landmarks, node, 'landmark');
  exactStringIdSet(manifest.lighting ?? [], node, 'lighting');
  const baseTiers = (manifest.floorTiers ?? []).filter(({ elevation }) => (
    Math.abs(number(elevation)) <= CONNECTOR_ELEVATION_EPSILON
  ));
  assertSupplementContentContract(
    baseTiers.length === 1 && plainValuesEqual(baseTiers[0].floorMask, manifest.floorMask),
    node,
    'must have one base floor tier whose mask exactly matches the authoritative floor mask',
  );
  for (const tier of manifest.floorTiers ?? []) {
    const rows = validatedManifestMaskRows(
      tier.floorMask,
      dimensions,
      manifest.floorMaskLegend,
      node,
      `floor tier ${tier.id}`,
    );
    assertConnectedManifestMask(rows, tier.maskOriginTile, node, `floor tier ${tier.id}`);
    assertSupplementContentContract(
      (tier.zoneIds ?? []).every((id) => zoneIds.has(String(id)))
        && (tier.accessRouteIds ?? []).every((id) => clearRouteIds.has(String(id))),
      node,
      `floor tier ${tier.id} references a missing zone or clear route`,
    );
  }
  const localSocketIds = new Set((node.sockets ?? []).map((socket) => (
    String(socket.localSocketId ?? socket.id ?? '')
  )).filter(Boolean));
  for (const route of manifest.clearRoutes ?? []) {
    assertSupplementContentContract(
      (route.floorTierIds ?? []).length > 0
        && (route.floorTierIds ?? []).every((id) => floorTierIds.has(String(id)))
        && (physicalBlueprint
          || (route.fromSocketIds ?? []).every((id) => localSocketIds.has(String(id))))
        && [route.fromZoneId, route.toZoneId, ...(route.viaZoneIds ?? []),
          ...(route.excludedZoneIds ?? [])]
          .filter(Boolean)
          .every((id) => zoneIds.has(String(id)))
        && (!route.toAnchorId || anchorIds.has(String(route.toAnchorId))),
      node,
      `clear route ${route.id} references missing physical content`,
    );
  }
  for (const zone of manifest.zones ?? []) {
    const bounds = zone.tileBounds;
    assertSupplementContentContract(
      bounds
        && Number.isFinite(Number(bounds.minX))
        && Number.isFinite(Number(bounds.maxX))
        && Number.isFinite(Number(bounds.minZ))
        && Number.isFinite(Number(bounds.maxZ))
        && Number(bounds.minX) <= Number(bounds.maxX)
        && Number(bounds.minZ) <= Number(bounds.maxZ)
        && (zone.excludesZoneIds ?? []).every((id) => zoneIds.has(String(id))),
      node,
      `zone ${zone.id} has invalid bounds or references`,
    );
  }
  for (const cover of manifest.cover ?? []) {
    assertSupplementContentContract(
      cover.localTile
        && (cover.validFloorZoneIds ?? []).every((id) => zoneIds.has(String(id))),
      node,
      `cover ${cover.id} has invalid physical placement or zone references`,
    );
  }
  for (const anchor of manifest.anchors ?? []) {
    assertSupplementContentContract(
      anchor.localTile && (!anchor.floorZoneId || zoneIds.has(String(anchor.floorZoneId))),
      node,
      `anchor ${anchor.id} has invalid physical placement or zone reference`,
    );
  }
  const structuralQuality = inspectIndustrialSupplementManifestStructuralQuality(manifest, {
    structure: node.structure,
    clearanceVolumes: node.clearanceVolumes,
  });
  assertSupplementContentContract(
    structuralQuality.accepted,
    node,
    `failed structural-quality acceptance: ${structuralQuality.errors.join(', ')}`,
  );
  return manifest;
}

function manifestRuntimeStateId(anchor, stableRuntimeStateIds = {}) {
  const kind = String(anchor?.kind ?? '');
  if (['encounter', 'enemyEncounter'].includes(kind)) {
    return stableRuntimeStateIds.encounter ?? null;
  }
  if (['reward', 'discovery'].includes(kind)) return stableRuntimeStateIds.reward ?? null;
  if (['progression', 'mechanism', 'control', 'trap', 'hazard', 'environmentalHazard']
    .includes(kind)) {
    return stableRuntimeStateIds.mechanism ?? null;
  }
  if (kind === 'platform') return stableRuntimeStateIds.shortcut ?? null;
  return null;
}

function manifestAnchorRequiresRuntimeState(anchor) {
  return [
    'encounter', 'enemyEncounter', 'reward', 'discovery', 'progression', 'mechanism',
    'control', 'trap', 'hazard', 'environmentalHazard', 'platform',
  ].includes(String(anchor?.kind ?? ''));
}

function manifestRecipeForAnchor(anchor, {
  node,
  operation,
  manifest,
  difficulty,
  physicalBlueprint = null,
}) {
  if (anchor.encounterProfileId) {
    const encounterContext = physicalBlueprint ? {
      moduleManifestId: manifest.id,
      semanticModuleKind: manifest.id,
      physicalModuleKind: node.moduleKind,
      contentRole: node.contentRole,
      topology: operation?.topologyTemplateId ?? node.topology,
      difficulty,
    } : {
      grammarId: node.grammarId,
      moduleKind: node.moduleKind,
      contentRole: node.contentRole,
      topology: operation?.topologyTemplateId ?? node.topology,
      difficulty,
    };
    return {
      kind: 'encounter',
      field: 'encounterRecipe',
      recipe: resolveIndustrialSupplementEncounterRecipe(
        anchor.encounterProfileId,
        encounterContext,
      ),
    };
  }
  if (anchor.rewardProfileId) {
    return {
      kind: 'reward',
      field: 'rewardRecipe',
      recipe: resolveIndustrialSupplementRewardRecipe(anchor.rewardProfileId),
    };
  }
  if (anchor.mechanismProfileId) {
    return {
      kind: 'mechanism',
      field: 'mechanismRecipe',
      recipe: resolveIndustrialSupplementMechanismRecipe(anchor.mechanismProfileId),
    };
  }
  if (anchor.hazardProfileId) {
    return {
      kind: 'hazard',
      field: 'hazardRecipe',
      recipe: resolveIndustrialSupplementHazardRecipe(anchor.hazardProfileId),
    };
  }
  if (anchor.discoveryId) {
    return {
      kind: 'discovery',
      field: null,
      recipe: {
        id: String(anchor.discoveryId),
        discoveryId: String(anchor.discoveryId),
        profileId: manifest.profileId,
        moduleKinds: [manifest.id],
        deterministic: true,
      },
    };
  }
  return null;
}

function decorateManifestRecipe(recipe, {
  node,
  anchorId,
  recipeInstanceId,
  runtimeStateId,
  themeBinding,
}) {
  const decorated = {
    ...clonePlainValue(recipe),
    catalogRecipeId: recipe.id,
    recipeInstanceId,
    runtimeStateId,
    nodeId: node.id,
    anchorId,
    themeBinding: clonePlainValue(themeBinding),
  };
  if (decorated.clearState) {
    decorated.clearState = {
      ...decorated.clearState,
      stateId: runtimeStateId,
      runtimeStateId,
    };
  }
  if (decorated.stateMachine) {
    decorated.stateMachine = {
      ...decorated.stateMachine,
      stateId: runtimeStateId,
      runtimeStateId,
    };
  }
  return decorated;
}

function createIndustrialSupplementManifestAnchors({
  node,
  operation,
  manifest,
  center,
  rotationQuarterTurns,
  tileSize,
  difficulty = 1,
  requireManifest = false,
  physicalBlueprint = null,
}) {
  if (!manifest) return [];
  const themeBinding = node.themeBinding ?? operation?.themeBinding ?? null;
  const stableRuntimeStateIds = operation?.stableRuntimeStateIds
    ?? node.stableRuntimeStateIds
    ?? {};
  return (manifest.anchors ?? []).map((anchor) => {
    const localTile = anchor.localTile ?? {};
    const position = transformDungeonLocalPoint({
      x: number(localTile.x) * tileSize,
      y: number(localTile.elevation ?? anchor.elevation),
      z: number(localTile.z) * tileSize,
    }, {
      center,
      rotationQuarterTurns,
    });
    const id = `${node.id}:content-anchor:${stableIdPart(anchor.id)}`;
    const runtimeStateId = manifestRuntimeStateId(anchor, stableRuntimeStateIds);
    const resolved = manifestRecipeForAnchor(anchor, {
      node,
      operation,
      manifest,
      difficulty,
      physicalBlueprint,
    });
    if (requireManifest && manifestAnchorRequiresRuntimeState(anchor) && !runtimeStateId) {
      throw supplementContentContractError(
        node,
        `anchor ${anchor.id} cannot resolve its stable runtime-state id`,
      );
    }
    if (requireManifest && resolved && !resolved.recipe) {
      throw supplementContentContractError(
        node,
        `anchor ${anchor.id} cannot resolve recipe ${anchor.encounterProfileId
          ?? anchor.rewardProfileId
          ?? anchor.mechanismProfileId
          ?? anchor.hazardProfileId
          ?? anchor.discoveryId}`,
      );
    }
    if (requireManifest && resolved?.recipe) {
      assertSupplementContentContract(
        resolved.recipe.profileId === INDUSTRIAL_SUPPLEMENT_V4_PROFILE_ID
          && (!Array.isArray(resolved.recipe.moduleKinds)
            || resolved.recipe.moduleKinds.includes(manifest.id)),
        node,
        `anchor ${anchor.id} resolved a recipe incompatible with manifest ${manifest.id}`,
      );
    }
    const catalogRecipeId = resolved?.recipe?.id ?? null;
    const recipeInstanceId = catalogRecipeId
      ? `${node.id}:content-recipe:${stableIdPart(resolved.kind)}:${stableIdPart(anchor.id)}:${stableIdPart(catalogRecipeId)}`
      : null;
    const recipe = resolved?.recipe ? decorateManifestRecipe(resolved.recipe, {
      node,
      anchorId: id,
      recipeInstanceId,
      runtimeStateId,
      themeBinding,
    }) : null;
    return {
      ...clonePlainValue(anchor),
      id,
      localAnchorId: anchor.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      moduleManifestId: manifest.id,
      moduleManifestSchema: manifest.schema,
      position,
      worldPosition: clonePlainValue(position),
      grid: {
        x: Math.round(position.x / tileSize),
        z: Math.round(position.z / tileSize),
      },
      themeBinding: clonePlainValue(themeBinding),
      runtimeStateId,
      ...(catalogRecipeId ? {
        recipeKind: resolved.kind,
        recipeId: catalogRecipeId,
        catalogRecipeId,
        recipeInstanceId,
      } : {}),
      ...(recipe && resolved.field ? { [resolved.field]: recipe } : {}),
      ...(recipe && !resolved.field ? { discoveryRecipe: recipe } : {}),
    };
  });
}

function manifestWorldPoint(localTile, {
  center,
  rotationQuarterTurns,
  tileSize,
  tileCoordinates = true,
}) {
  return transformDungeonLocalPoint({
    x: number(localTile?.x) * (tileCoordinates ? tileSize : 1),
    y: number(localTile?.elevation ?? localTile?.y),
    z: number(localTile?.z) * (tileCoordinates ? tileSize : 1),
  }, {
    center,
    rotationQuarterTurns,
  });
}

function rasterizedManifestSightlineCells(from, to) {
  let x = Math.round(number(from?.x));
  let z = Math.round(number(from?.z));
  const targetX = Math.round(number(to?.x));
  const targetZ = Math.round(number(to?.z));
  const deltaX = Math.abs(targetX - x);
  const deltaZ = Math.abs(targetZ - z);
  const stepX = x < targetX ? 1 : -1;
  const stepZ = z < targetZ ? 1 : -1;
  let error = deltaX - deltaZ;
  const cells = [];
  while (true) {
    cells.push({ x, z });
    if (x === targetX && z === targetZ) break;
    const doubled = error * 2;
    if (doubled > -deltaZ) {
      error -= deltaZ;
      x += stepX;
    }
    if (doubled < deltaX) {
      error += deltaX;
      z += stepZ;
    }
  }
  return cells;
}

function manifestSightlineBoundaryOrigins(baseCells, boundary) {
  if (baseCells.length === 0) return [];
  const coordinate = boundary === 'south'
    ? Math.min(...baseCells.map(({ z }) => z))
    : boundary === 'north'
      ? Math.max(...baseCells.map(({ z }) => z))
      : boundary === 'west'
        ? Math.min(...baseCells.map(({ x }) => x))
        : Math.max(...baseCells.map(({ x }) => x));
  return baseCells.filter((cell) => (
    ['south', 'north'].includes(boundary)
      ? cell.z === coordinate
      : cell.x === coordinate
  )).sort((left, right) => left.x - right.x || left.z - right.z);
}

function realizeManifestProtectedSightlines({
  node,
  operation,
  manifest,
  center,
  rotationQuarterTurns,
  tileSize,
  themeBinding,
}) {
  const quality = manifest?.structuralQuality;
  if (!quality?.requiredSightlines?.length) return [];
  const baseCells = manifestMaskCells(manifest.floorMask ?? []);
  const targetById = new Map([
    ...(manifest.landmarks ?? []),
    ...(manifest.anchors ?? []),
  ].map((record) => [String(record.id), record]));
  const routeById = new Map((manifest.clearRoutes ?? []).map((route) => (
    [String(route.id), route]
  )));
  const blockingCover = (manifest.cover ?? []).filter(({ blocksLineOfSight }) => (
    blocksLineOfSight === true
  ));
  return quality.requiredSightlines.flatMap((sightline) => {
    const sightlineId = String(sightline.id ?? 'required-sightline');
    const targetId = String(
      sightline.targetLandmarkId ?? sightline.targetAnchorId ?? '',
    );
    const targetRecord = targetById.get(targetId);
    const target = targetRecord?.localTile ?? targetRecord?.localPosition ?? null;
    const requiredClearRouteIds = [...new Set(
      (sightline.requiredClearRouteIds ?? []).map(String),
    )].sort();
    const routeReferencesAccepted = requiredClearRouteIds.length > 0
      && requiredClearRouteIds.every((routeId) => routeById.get(routeId)?.required === true);
    const sourceRouteAccepted = requiredClearRouteIds.some((routeId) => (
      (routeById.get(routeId)?.fromSocketIds ?? []).map(String)
        .includes(String(sightline.fromSocketId ?? ''))
    ));
    if (!target || !routeReferencesAccepted || !sourceRouteAccepted) return [];
    const visibleRays = manifestSightlineBoundaryOrigins(
      baseCells,
      sightline.fromBoundary,
    ).map((origin) => ({
      origin,
      cells: rasterizedManifestSightlineCells(origin, target),
    })).filter(({ origin, cells }) => !blockingCover.some((cover) => {
      const point = cover.localTile ?? cover.localPosition ?? null;
      return point
        && !(number(point.x) === number(target.x) && number(point.z) === number(target.z))
        && !(number(point.x) === number(origin.x) && number(point.z) === number(origin.z))
        && cells.some((cell) => (
          cell.x === Math.round(number(point.x))
            && cell.z === Math.round(number(point.z))
        ));
    }));
    const minimumVisibleOrigins = Math.max(
      1,
      Math.trunc(number(sightline.minimumVisibleOrigins, 1)),
    );
    const protectedRays = visibleRays.slice(0, minimumVisibleOrigins);
    if (protectedRays.length < minimumVisibleOrigins) return [];
    const localRayCells = [...new Map(protectedRays.flatMap(({ cells }) => cells)
      .map((cell) => [`${cell.x},${cell.z}`, cell])).values()]
      .sort((left, right) => left.x - right.x || left.z - right.z);
    const runtimeId = `${node.id}:protected-sightline:${stableIdPart(sightlineId)}`;
    return [{
      id: runtimeId,
      runtimeId,
      schema: INDUSTRIAL_SUPPLEMENT_PROTECTED_SIGHTLINE_SCHEMA,
      sightlineId,
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      moduleManifestId: manifest.id,
      fromSocketId: String(sightline.fromSocketId ?? ''),
      fromBoundary: sightline.fromBoundary ?? null,
      targetId,
      requiredClearRouteIds,
      minimumVisibleOrigins,
      protectedOriginCount: protectedRays.length,
      localOrigins: protectedRays.map(({ origin }) => ({
        x: number(origin.x),
        z: number(origin.z),
      })),
      localTarget: {
        x: number(target.x),
        z: number(target.z),
        elevation: number(target.elevation ?? target.y),
      },
      localRayCells,
      worldCells: localRayCells.map((cell) => {
        const position = manifestWorldPoint({
          ...cell,
          elevation: 0,
        }, {
          center,
          rotationQuarterTurns,
          tileSize,
        });
        return {
          id: `${runtimeId}:cell:${stableIdPart(cell.x)}:${stableIdPart(cell.z)}`,
          localTile: { ...cell, elevation: 0 },
          grid: stableV4GridPoint(position, tileSize),
          position,
          worldPosition: clonePlainValue(position),
          widthMeters: tileSize,
          depthMeters: tileSize,
        };
      }),
      protectionKind: 'required-sightline',
      authoritative: true,
      preRender: true,
      themeBinding: clonePlainValue(themeBinding),
    }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function realizeManifestFloorTiers({
  node,
  operation,
  manifest,
  blueprint = null,
  center,
  rotationQuarterTurns,
  tileSize,
  themeBinding,
}) {
  const physicalDefinition = blueprint ?? manifest;
  return (physicalDefinition?.floorTiers ?? []).map((tier) => {
    const rows = (tier.floorMask ?? []).map((row) => String(row ?? ''));
    const origin = tier.maskOriginTile ?? {
      x: -Math.floor(Math.max(...rows.map((row) => row.length)) / 2),
      z: -Math.floor(rows.length / 2),
    };
    const runtimeId = `${node.id}:floor-tier:${stableIdPart(tier.id)}`;
    const worldElevation = number(center.y) + number(tier.elevation);
    const worldCells = manifestMaskCells(rows, origin).map((cell) => {
      const localTile = {
        x: cell.x,
        z: cell.z,
        elevation: number(tier.elevation),
      };
      const position = manifestWorldPoint(localTile, {
        center,
        rotationQuarterTurns,
        tileSize,
      });
      const id = `${runtimeId}:cell:${stableIdPart(cell.x)}:${stableIdPart(cell.z)}`;
      // Blueprint centers and rotated cells can land on exact half-grid
      // metrics represented with a small negative floating tail (for example
      // 74.19999999999999 m). Quantize the metric first so adjacent authored
      // cells cannot collapse onto one grid identity and leave a false hole.
      const grid = stableV4GridPoint(position, tileSize);
      return {
        id,
        roomId: node.id,
        nodeId: node.id,
        operationId: operation?.id ?? nodeOperationId(node),
        moduleManifestId: manifest?.id ?? null,
        blueprintId: blueprint?.id ?? null,
        floorTierId: tier.id,
        floorTierRuntimeId: runtimeId,
        localTile,
        sourceMask: { row: cell.row, column: cell.column, symbol: '#' },
        grid,
        position,
        worldPosition: clonePlainValue(position),
        localElevation: number(tier.elevation),
        elevation: worldElevation,
        worldElevation,
        floorKey: `${grid.x},${grid.z}@y${worldElevation.toFixed(3)}`,
        collisionId: `${id}:collision`,
        walkable: true,
        authoritative: true,
        preRender: true,
        themeBinding: clonePlainValue(themeBinding),
      };
    });
    const cellByLocalKey = new Map(worldCells.map((cell) => (
      [`${cell.localTile.x},${cell.localTile.z}`, cell]
    )));
    const worldConnectivityEdges = [];
    for (const cell of worldCells) {
      for (const [offsetX, offsetZ] of [[1, 0], [0, 1]]) {
        const neighbor = cellByLocalKey.get(
          `${cell.localTile.x + offsetX},${cell.localTile.z + offsetZ}`,
        );
        if (!neighbor) continue;
        worldConnectivityEdges.push({
          id: `${runtimeId}:edge:${stableIdPart(cell.localTile.x)}:${stableIdPart(cell.localTile.z)}:${stableIdPart(neighbor.localTile.x)}:${stableIdPart(neighbor.localTile.z)}`,
          roomId: node.id,
          nodeId: node.id,
          operationId: operation?.id ?? nodeOperationId(node),
          floorTierId: tier.id,
          floorTierRuntimeId: runtimeId,
          fromCellId: cell.id,
          toCellId: neighbor.id,
          traversal: 'four-neighbor-floor',
          bidirectional: true,
          elevation: worldElevation,
          authoritative: true,
          preRender: true,
          themeBinding: clonePlainValue(themeBinding),
        });
      }
    }
    return {
      ...clonePlainValue(tier),
      localTierId: tier.id,
      runtimeId,
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      moduleManifestId: manifest?.id ?? null,
      blueprintId: blueprint?.id ?? null,
      localElevation: number(tier.elevation),
      worldElevation,
      worldCells,
      worldConnectivityEdges,
      themeBinding: clonePlainValue(themeBinding),
      authoritative: true,
      preRender: true,
    };
  });
}

function blueprintTierById(floorTiers, tierId = 'base') {
  return (floorTiers ?? []).find((tier) => String(tier.id) === String(tierId))
    ?? floorTiers?.[0]
    ?? null;
}

function blueprintRecordFootprint(record = {}) {
  return {
    center: { x: number(record.x), z: number(record.z) },
    widthTiles: Math.max(1, Math.trunc(number(record.w ?? record.width, 1))),
    depthTiles: Math.max(1, Math.trunc(number(record.d ?? record.depth, 1))),
  };
}

function blueprintFeatureKind(feature = {}) {
  if (feature.type === 'spawn') return 'spatial-role';
  if (feature.type === 'control') return 'blueprint-control-position';
  if (feature.type === 'reward') return 'blueprint-reward-position';
  if (feature.type === 'hazard') return 'blueprint-hazard-position';
  return `blueprint-${stableIdPart(feature.type ?? 'feature')}`;
}

function blueprintSpawnRole(feature = {}) {
  const id = String(feature.id ?? '').toLowerCase();
  if (id.includes('frontline')) return 'frontline';
  if (id.includes('perch')) return 'perch';
  if (id.includes('flank')) return 'flank';
  return String(feature.label ?? 'spawn').toLowerCase();
}

function realizeBlueprintStateRecords(node, blueprint) {
  return (blueprint?.persistentStateIds ?? blueprint?.stateIds ?? []).map((localStateId) => {
    const normalized = String(localStateId);
    const stateKind = /encounter|enemy/i.test(normalized)
      ? 'encounter-cleared'
      : /reward|cache|claimed/i.test(normalized)
        ? 'reward-claimed'
        : /lift/i.test(normalized)
          ? 'lift-state'
          : /ladder/i.test(normalized)
            ? 'ladder-state'
            : 'mechanism-state';
    return {
      id: `${node.id}:blueprint-state:${stableIdPart(normalized)}`,
      runtimeStateId: `${node.id}:blueprint-state:${stableIdPart(normalized)}`,
      localStateId: normalized,
      stateKind,
      nodeId: node.id,
      blueprintId: blueprint.id,
      persistent: true,
      namespaced: true,
    };
  });
}

function blueprintStateForFeature(feature, stateRecords) {
  const type = String(feature?.type ?? '');
  const patterns = type === 'reward'
    ? [/reward|cache|claimed/i]
    : type === 'spawn'
      ? [/encounter|enemy/i]
      : type === 'control'
        ? [/mechanism|control|activated|enabled|disabled|stopped|lift|ladder|deployed/i]
        : [];
  return patterns.flatMap((pattern) => (
    stateRecords.filter(({ localStateId }) => pattern.test(localStateId))
  ))[0] ?? null;
}

const BLUEPRINT_ANCHORED_FEATURE_TYPES = new Set([
  'control',
  'hazard',
  'reward',
  'spawn',
]);

const BLUEPRINT_REQUIRED_SUPPORT_FEATURE_TYPES = new Set([
  ...BLUEPRINT_ANCHORED_FEATURE_TYPES,
  'cover',
]);

function exactBlueprintTierById(floorTiers, tierId) {
  return (floorTiers ?? []).find((tier) => String(tier.id) === String(tierId)) ?? null;
}

function blueprintSupportCellKey(cell) {
  return [
    number(cell.localTile?.x).toFixed(6),
    number(cell.localTile?.z).toFixed(6),
    number(cell.localElevation ?? cell.localTile?.elevation).toFixed(6),
  ].join(',');
}

function uniqueBlueprintSupportCells(cells) {
  const ordered = [...(cells ?? [])].sort((left, right) => (
    Number(left.supportKind !== 'physical-transfer-cell')
      - Number(right.supportKind !== 'physical-transfer-cell')
      || String(left.supportCellId).localeCompare(String(right.supportCellId))
  ));
  return [...new Map(ordered.map((cell) => [blueprintSupportCellKey(cell), cell])).values()];
}

function blueprintFeatureSupportCells({
  feature,
  footprint,
  floorTiers,
  transfers,
}) {
  const featureType = String(feature.type ?? 'feature');
  const declaredTier = feature.tier == null
    ? null
    : exactBlueprintTierById(floorTiers, feature.tier);
  const defaultMachineTier = featureType === 'machine' && feature.tier == null
    ? exactBlueprintTierById(floorTiers, 'base') ?? floorTiers?.[0] ?? null
    : null;
  const candidateTiers = declaredTier
    ? [declaredTier]
    : defaultMachineTier
      ? [defaultMachineTier]
      : floorTiers;
  const candidateTransfers = featureType === 'transfer'
    ? (transfers ?? []).filter(({ localTransferId }) => (
      String(localTransferId) === String(feature.id)
    ))
    : transfers;
  const cellsForFootprint = (candidateFootprint) => uniqueBlueprintSupportCells([
    ...(candidateTiers ?? []).flatMap((tier) => (
      cellsInsideBlueprintFootprint(tier, candidateFootprint).map((cell) => ({
        ...cell,
        supportKind: 'floor-tier-cell',
        supportCellId: cell.id,
        floorCellId: cell.id,
        floorTierId: tier.id,
        floorTierRuntimeId: tier.runtimeId,
        sourceTransferId: null,
        sourceTransferRuntimeId: null,
      }))
    )),
    ...(candidateTransfers ?? []).flatMap((transfer) => (
      cellsInsideBlueprintFootprint({ worldCells: transfer.worldCells }, candidateFootprint)
        .filter((cell) => (
          !declaredTier
            || approximatelyEqualNumber(cell.localElevation, declaredTier.localElevation)
        ))
        .map((cell) => ({
          ...cell,
          supportKind: 'physical-transfer-cell',
          supportCellId: cell.id,
          floorCellId: null,
          floorTierId: null,
          floorTierRuntimeId: null,
          sourceTransferId: transfer.localTransferId,
          sourceTransferRuntimeId: transfer.id,
        }))
    )),
  ]);
  let supportCells = cellsForFootprint(footprint);
  let supportAttachment = 'direct';
  if (supportCells.length === 0 && featureType === 'cover') {
    supportAttachment = 'adjacent-edge';
    supportCells = cellsForFootprint({
      center: clonePlainValue(footprint.center),
      widthTiles: footprint.widthTiles + 2,
      depthTiles: footprint.depthTiles + 2,
    });
  }
  return {
    declaredTier,
    supportAttachment,
    supportCells,
  };
}

function validateBlueprintSupportCell(node, feature, supportCell) {
  const localTile = supportCell?.localTile ?? {};
  const position = supportCell?.position ?? {};
  assertSupplementContentContract(
    supportCell?.roomId === node.id
      && supportCell?.nodeId === node.id
      && supportCell?.walkable !== false
      && supportCell?.authoritative === true
      && Number.isFinite(Number(localTile.x))
      && Number.isFinite(Number(localTile.z))
      && Number.isFinite(Number(localTile.elevation))
      && Number.isFinite(Number(position.x))
      && Number.isFinite(Number(position.y))
      && Number.isFinite(Number(position.z)),
    node,
    `blueprint feature ${feature.id} resolved to support outside its owned walkable realization`,
  );
}

function nearestBlueprintFeatureSupport(
  feature,
  footprint,
  supportCells,
  node,
  rejectVerticalAmbiguity = false,
) {
  if (supportCells.length === 0) return null;
  const ranked = [...supportCells].sort((left, right) => (
    ((number(left.localTile?.x) - footprint.center.x) ** 2
      + (number(left.localTile?.z) - footprint.center.z) ** 2)
      - ((number(right.localTile?.x) - footprint.center.x) ** 2
        + (number(right.localTile?.z) - footprint.center.z) ** 2)
      || number(left.localElevation ?? left.localTile?.elevation)
        - number(right.localElevation ?? right.localTile?.elevation)
      || String(left.supportCellId).localeCompare(String(right.supportCellId))
  ));
  const nearestDistance = (
    (number(ranked[0].localTile?.x) - footprint.center.x) ** 2
      + (number(ranked[0].localTile?.z) - footprint.center.z) ** 2
  );
  const equidistant = ranked.filter((cell) => Math.abs((
    (number(cell.localTile?.x) - footprint.center.x) ** 2
      + (number(cell.localTile?.z) - footprint.center.z) ** 2
  ) - nearestDistance) <= CONNECTOR_ELEVATION_EPSILON);
  const nearestElevations = new Set(equidistant.map((cell) => (
    number(cell.localElevation ?? cell.localTile?.elevation).toFixed(6)
  )));
  if (rejectVerticalAmbiguity) {
    assertSupplementContentContract(
      nearestElevations.size === 1,
      node,
      `blueprint anchor ${feature.id} is vertically ambiguous across authored support cells`,
    );
  }
  return equidistant[0];
}

function blueprintFeatureCollisionSegments(feature, footprint, supportCells) {
  if (feature.solid !== true || !['cover', 'machine'].includes(String(feature.type))) {
    return [];
  }
  const cellsByElevation = new Map();
  for (const cell of supportCells) {
    const key = number(cell.localElevation ?? cell.localTile?.elevation).toFixed(6);
    if (!cellsByElevation.has(key)) cellsByElevation.set(key, []);
    cellsByElevation.get(key).push(cell);
  }
  if (cellsByElevation.size <= 1) return [];
  return [...cellsByElevation.entries()]
    .sort(([left], [right]) => number(left) - number(right))
    .map(([elevationKey, cells]) => {
      const xs = cells.map(({ localTile }) => number(localTile.x));
      const zs = cells.map(({ localTile }) => number(localTile.z));
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      const widthTiles = Math.min(
        footprint.widthTiles,
        Math.max(1, Math.round(maxX - minX + 1)),
      );
      const depthTiles = Math.min(
        footprint.depthTiles,
        Math.max(1, Math.round(maxZ - minZ + 1)),
      );
      return {
        localElevation: number(elevationKey),
        localFootprint: {
          center: {
            x: footprint.widthTiles === 1 ? footprint.center.x : (minX + maxX) * 0.5,
            z: footprint.depthTiles === 1 ? footprint.center.z : (minZ + maxZ) * 0.5,
          },
          widthTiles,
          depthTiles,
        },
        supportCells: cells,
      };
    });
}

function blueprintSolidPositionOnCommittedFloorGrid(
  projectedPosition,
  supportCells,
  tileSize,
) {
  const occupiedGridCells = (supportCells ?? []).filter((cell) => (
    Number.isFinite(Number(cell?.grid?.x))
      && Number.isFinite(Number(cell?.grid?.z))
  ));
  if (occupiedGridCells.length === 0) return projectedPosition;

  const gridXs = occupiedGridCells.map((cell) => Number(cell.grid.x));
  const gridZs = occupiedGridCells.map((cell) => Number(cell.grid.z));
  return {
    ...projectedPosition,
    // Runtime floor stamping consumes the authoritative integer support grid,
    // not the pre-quantization metric projection. Blueprint feature centers
    // can intentionally use the opposite half-grid parity from their room
    // center (for example, an even-depth cover in an odd-width room), so one
    // module-wide snap cannot align every physical solid. Center each direct
    // floor-supported solid on the bounds of the exact cells it occupies.
    // Transfer-supported solids stay in authored metric space so dividers on
    // continuous ramps are not pulled onto one of the traversable lanes.
    x: (Math.min(...gridXs) + Math.max(...gridXs)) * 0.5 * tileSize,
    z: (Math.min(...gridZs) + Math.max(...gridZs)) * 0.5 * tileSize,
  };
}

function realizeBlueprintFeatureRecords({
  node,
  operation,
  blueprint,
  center,
  rotationQuarterTurns,
  tileSize,
  themeBinding,
  floorTiers,
  transfers = [],
  stateRecords = [],
}) {
  const normalizedRotationQuarterTurns = (
    (Math.trunc(number(rotationQuarterTurns)) % 4) + 4
  ) % 4;
  const collisionSwapsHorizontalAxes = normalizedRotationQuarterTurns % 2 === 1;
  const records = (blueprint.features ?? []).flatMap((feature) => {
    const localFootprint = blueprintRecordFootprint(feature);
    const {
      declaredTier,
      supportAttachment,
      supportCells,
    } = blueprintFeatureSupportCells({
      feature,
      footprint: localFootprint,
      floorTiers,
      transfers,
    });
    if (feature.tier != null) {
      assertSupplementContentContract(
        Boolean(declaredTier),
        node,
        `blueprint feature ${feature.id} references missing floor tier ${feature.tier}`,
      );
    }
    for (const supportCell of supportCells) {
      validateBlueprintSupportCell(node, feature, supportCell);
    }
    const featureType = String(feature.type ?? 'feature');
    const supportRequired = BLUEPRINT_REQUIRED_SUPPORT_FEATURE_TYPES.has(featureType);
    assertSupplementContentContract(
      !supportRequired || supportCells.length > 0,
      node,
      `blueprint feature ${feature.id} has no owned reachable floor or transfer support`,
    );
    const nearestSupport = nearestBlueprintFeatureSupport(
      feature,
      localFootprint,
      supportCells,
      node,
      BLUEPRINT_ANCHORED_FEATURE_TYPES.has(featureType),
    );
    const fallbackTier = declaredTier
      ?? blueprintTierById(floorTiers, feature.tier ?? 'base');
    const collisionSegments = blueprintFeatureCollisionSegments(
      feature,
      localFootprint,
      supportCells,
    );
    const recordDefinitions = collisionSegments.length > 0
      ? collisionSegments
      : [{
        localElevation: number(
          nearestSupport?.localElevation
            ?? nearestSupport?.localTile?.elevation
            ?? fallbackTier?.localElevation,
        ),
        localFootprint,
        supportCells: BLUEPRINT_ANCHORED_FEATURE_TYPES.has(featureType) && nearestSupport
          ? [nearestSupport]
          : supportCells,
      }];
    const sourceRuntimeId = `${node.id}:blueprint-feature:${stableIdPart(feature.id)}`;
    const stateRecord = blueprintStateForFeature(feature, stateRecords);
    const authoredLocalElevation = number(
      nearestSupport?.localElevation
        ?? nearestSupport?.localTile?.elevation
        ?? fallbackTier?.localElevation,
    );
    const authoredLocalTile = {
      x: number(localFootprint.center.x),
      z: number(localFootprint.center.z),
      elevation: authoredLocalElevation,
    };
    const authoredWorldPosition = manifestWorldPoint(authoredLocalTile, {
      center,
      rotationQuarterTurns,
      tileSize,
    });
    const authoredHeightMeters = featureType === 'cover'
      ? 1.2
      : featureType === 'story'
        ? 0.035
        : 3.6;
    return recordDefinitions.map((definition, segmentOrdinal) => {
      const segmentSupportCells = definition.supportCells ?? [];
      const segmentSupport = nearestBlueprintFeatureSupport(
        feature,
        definition.localFootprint,
        segmentSupportCells,
        node,
      ) ?? nearestSupport;
      const segmentTier = segmentSupport?.floorTierRuntimeId
        ? exactBlueprintTierById(floorTiers, segmentSupport.floorTierId)
        : null;
      const runtimeId = collisionSegments.length > 0
        ? `${sourceRuntimeId}:support-segment:${segmentOrdinal}`
        : sourceRuntimeId;
      const localTile = {
        x: number(definition.localFootprint.center.x),
        z: number(definition.localFootprint.center.z),
        elevation: number(definition.localElevation),
      };
      const projectedPosition = manifestWorldPoint(localTile, {
        center,
        rotationQuarterTurns,
        tileSize,
      });
      const hasAuthoredSolidFloorOccupancy = feature.solid === true
        && ['cover', 'machine'].includes(featureType);
      const occupiedSupportCellIds = hasAuthoredSolidFloorOccupancy
        && supportAttachment === 'direct'
        ? [...new Set(segmentSupportCells
            .map(({ supportCellId }) => supportCellId)
            .filter(Boolean)
            .map(String))].sort((left, right) => left.localeCompare(right))
        : [];
      const usesCommittedFloorGridPosition = hasAuthoredSolidFloorOccupancy
        && supportAttachment === 'direct'
        && occupiedSupportCellIds.length > 0
        && segmentSupportCells.every((cell) => (
          cell.supportKind === 'floor-tier-cell'
            && cell.floorCellId != null
        ));
      const position = usesCommittedFloorGridPosition
        ? blueprintSolidPositionOnCommittedFloorGrid(
            projectedPosition,
            segmentSupportCells,
            tileSize,
          )
        : projectedPosition;
      return {
        ...clonePlainValue(feature),
        id: runtimeId,
        localFeatureId: String(feature.id),
        runtimeId,
        sourceFeatureRuntimeId: sourceRuntimeId,
        collisionSegmentOrdinal: collisionSegments.length > 0 ? segmentOrdinal : null,
        collisionSegmentCount: collisionSegments.length || 1,
        roomId: node.id,
        nodeId: node.id,
        operationId: operation?.id ?? nodeOperationId(node),
        blueprintId: blueprint.id,
        blueprintFeatureType: featureType,
        floorTierId: segmentTier?.id ?? declaredTier?.id ?? null,
        floorTierRuntimeId: segmentTier?.runtimeId ?? declaredTier?.runtimeId ?? null,
        localTile,
        localFootprint: clonePlainValue(definition.localFootprint),
        authoredLocalFootprint: clonePlainValue(localFootprint),
        authoredLocalTile: clonePlainValue(authoredLocalTile),
        authoredWorldPosition: clonePlainValue(authoredWorldPosition),
        authoredRotationQuarterTurns: normalizedRotationQuarterTurns,
        authoredRotationY: -normalizedRotationQuarterTurns * Math.PI * 0.5,
        authoredFootprintMeters: {
          width: localFootprint.widthTiles * tileSize,
          height: authoredHeightMeters,
          depth: localFootprint.depthTiles * tileSize,
        },
        authoredWorldFootprintMeters: {
          width: (
            collisionSwapsHorizontalAxes
              ? localFootprint.depthTiles
              : localFootprint.widthTiles
          ) * tileSize,
          height: authoredHeightMeters,
          depth: (
            collisionSwapsHorizontalAxes
              ? localFootprint.widthTiles
              : localFootprint.depthTiles
          ) * tileSize,
        },
        position,
        worldPosition: clonePlainValue(position),
        grid: {
          x: Math.round(position.x / tileSize),
          z: Math.round(position.z / tileSize),
        },
        worldElevation: position.y,
        collisionFootprint: {
          // Feature centers are already projected into world space above.
          // Keep their axis-aligned collision extents in that same space:
          // a cardinal quarter-turn swaps authored width and depth.
          widthMeters: (
            collisionSwapsHorizontalAxes
              ? definition.localFootprint.depthTiles
              : definition.localFootprint.widthTiles
          ) * tileSize,
          depthMeters: (
            collisionSwapsHorizontalAxes
              ? definition.localFootprint.widthTiles
              : definition.localFootprint.depthTiles
          ) * tileSize,
          heightMeters: feature.type === 'cover' ? 1.2 : 3.6,
        },
        collisionId: `${runtimeId}:collision`,
        runtimeStateId: stateRecord?.runtimeStateId ?? null,
        localStateId: stateRecord?.localStateId ?? null,
        supportRequired,
        supportReachable: segmentSupportCells.length > 0,
        supportAttachment,
        supportKind: segmentSupport?.supportKind ?? null,
        supportCellId: segmentSupport?.supportCellId ?? null,
        supportCellIds: segmentSupportCells.map(({ supportCellId }) => supportCellId),
        // `supportCellIds` describes what physically supports a feature and
        // can therefore name adjacent-edge cells. This separate inventory is
        // the authoritative set of floor/transfer cells the solid actually
        // occupies; an explicit empty array means the feature occupies no
        // authored walkable cell centers.
        ...(hasAuthoredSolidFloorOccupancy ? { occupiedSupportCellIds } : {}),
        supportFloorCellId: segmentSupport?.floorCellId ?? null,
        sourceTransferId: segmentSupport?.sourceTransferId ?? null,
        sourceTransferRuntimeId: segmentSupport?.sourceTransferRuntimeId ?? null,
        blocking: feature.solid === true,
        themeBinding: clonePlainValue(themeBinding),
        authoritative: true,
        preRender: true,
      };
    });
  });
  return {
    all: records,
    cover: records.filter(({ blueprintFeatureType }) => blueprintFeatureType === 'cover'),
    landmarks: records.filter(({ blueprintFeatureType }) => (
      ['machine'].includes(blueprintFeatureType)
    )),
    anchorPositions: records.filter(({ blueprintFeatureType }) => (
      ['control', 'reward', 'spawn', 'hazard', 'story'].includes(blueprintFeatureType)
    )).map((record) => ({
      ...record,
      id: `${record.runtimeId}:anchor`,
      runtimeId: `${record.runtimeId}:anchor`,
      localAnchorId: record.localFeatureId,
      sourceFeatureRuntimeId: record.runtimeId,
      sourceFeatureId: record.localFeatureId,
      kind: blueprintFeatureKind(record),
      spatialRole: record.blueprintFeatureType === 'spawn'
        ? blueprintSpawnRole(record)
        : null,
      collisionId: `${record.runtimeId}:anchor:collision`,
    })),
  };
}

function cellsInsideBlueprintFootprint(tier, footprint) {
  const minX = number(footprint.center?.x) - number(footprint.widthTiles, 1) * 0.5;
  const maxX = number(footprint.center?.x) + number(footprint.widthTiles, 1) * 0.5;
  const minZ = number(footprint.center?.z) - number(footprint.depthTiles, 1) * 0.5;
  const maxZ = number(footprint.center?.z) + number(footprint.depthTiles, 1) * 0.5;
  return (tier?.worldCells ?? []).filter(({ localTile }) => (
    localTile.x >= minX - CONNECTOR_ELEVATION_EPSILON
      && localTile.x < maxX - CONNECTOR_ELEVATION_EPSILON
      && localTile.z >= minZ - CONNECTOR_ELEVATION_EPSILON
      && localTile.z < maxZ - CONNECTOR_ELEVATION_EPSILON
  ));
}

function realizeBlueprintZones({
  node,
  operation,
  blueprint,
  center,
  rotationQuarterTurns,
  tileSize,
  themeBinding,
  floorTiers,
  transfers = [],
}) {
  return (blueprint.zones ?? []).map((zone) => {
    const localFootprint = blueprintRecordFootprint(zone);
    const candidateTiers = zone.tier
      ? [blueprintTierById(floorTiers, zone.tier)].filter(Boolean)
      : floorTiers;
    const sourceCells = [
      ...candidateTiers.flatMap((tier) => (
        cellsInsideBlueprintFootprint(tier, localFootprint).map((cell) => ({
          ...cell,
          floorCellId: cell.id,
          floorTierId: tier.id,
          floorTierRuntimeId: tier.runtimeId,
          sourceKind: 'floor-tier-cell',
        }))
      )),
      ...transfers.flatMap((transfer) => (
        cellsInsideBlueprintFootprint({ worldCells: transfer.worldCells }, localFootprint)
          .map((cell) => ({
            ...cell,
            transferCellId: cell.id,
            transferId: transfer.id,
            localTransferId: transfer.localTransferId,
            sourceKind: 'physical-transfer-cell',
          }))
      )),
    ];
    const uniqueSourceCells = [...new Map(sourceCells.map((cell) => [cell.id, cell])).values()];
    const worldCells = uniqueSourceCells.map((cell) => ({
      id: `${node.id}:blueprint-zone:${stableIdPart(zone.id)}:cell:${stableIdPart(cell.id)}`,
      floorCellId: cell.floorCellId ?? null,
      floorTierId: cell.floorTierId ?? null,
      floorTierRuntimeId: cell.floorTierRuntimeId ?? null,
      transferCellId: cell.transferCellId ?? null,
      transferId: cell.transferId ?? null,
      localTransferId: cell.localTransferId ?? null,
      sourceKind: cell.sourceKind,
      localTile: clonePlainValue(cell.localTile),
      grid: clonePlainValue(cell.grid),
      localElevation: number(cell.localElevation ?? cell.localTile?.elevation),
      elevation: cell.elevation,
      position: clonePlainValue(cell.position),
    }));
    const nearestSourceCell = [...uniqueSourceCells].sort((left, right) => (
      ((number(left.localTile?.x) - localFootprint.center.x) ** 2
        + (number(left.localTile?.z) - localFootprint.center.z) ** 2)
        - ((number(right.localTile?.x) - localFootprint.center.x) ** 2
          + (number(right.localTile?.z) - localFootprint.center.z) ** 2)
        || number(left.localElevation ?? left.localTile?.elevation)
          - number(right.localElevation ?? right.localTile?.elevation)
        || String(left.id).localeCompare(String(right.id))
    ))[0] ?? null;
    const fallbackTier = blueprintTierById(floorTiers, zone.tier ?? 'base');
    const localElevation = number(
      nearestSourceCell?.localElevation
        ?? nearestSourceCell?.localTile?.elevation
        ?? fallbackTier?.localElevation,
    );
    const centerPosition = manifestWorldPoint({
      x: localFootprint.center.x,
      z: localFootprint.center.z,
      elevation: localElevation,
    }, {
      center,
      rotationQuarterTurns,
      tileSize,
    });
    const runtimeId = `${node.id}:blueprint-zone:${stableIdPart(zone.id)}`;
    const cellsByElevation = new Map();
    for (const cell of worldCells) {
      const key = number(cell.localElevation).toFixed(3);
      if (!cellsByElevation.has(key)) cellsByElevation.set(key, []);
      cellsByElevation.get(key).push(cell);
    }
    const worldBoundsByElevation = [...cellsByElevation.entries()].map(([key, cells]) => {
      const gridXs = cells.map(({ grid }) => grid.x);
      const gridZs = cells.map(({ grid }) => grid.z);
      const elevation = number(key);
      return {
        localElevation: elevation,
        worldElevation: number(center.y) + elevation,
        minGridX: Math.min(...gridXs),
        maxGridX: Math.max(...gridXs),
        minGridZ: Math.min(...gridZs),
        maxGridZ: Math.max(...gridZs),
      };
    });
    const resolvedTier = candidateTiers.length === 1 ? candidateTiers[0] : null;
    return {
      ...clonePlainValue(zone),
      id: String(zone.id),
      localZoneId: String(zone.id),
      runtimeId,
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      blueprintId: blueprint.id,
      zoneKind: String(zone.type ?? 'clear'),
      floorTierId: resolvedTier?.id ?? null,
      floorTierRuntimeId: resolvedTier?.runtimeId ?? null,
      localElevation,
      worldElevation: centerPosition.y,
      position: centerPosition,
      worldPosition: clonePlainValue(centerPosition),
      localFootprint,
      worldCells,
      worldElevations: worldBoundsByElevation.map(({ worldElevation }) => worldElevation),
      worldBoundsByElevation,
      validFor: zone.type === 'encounter'
        ? ['encounter', 'enemy-spawn']
        : zone.type === 'hazard'
          ? ['hazard']
          : ['player-traversal', 'clear-route'],
      themeBinding: clonePlainValue(themeBinding),
      authoritative: true,
      preRender: true,
    };
  });
}

function nearestBlueprintTierCell(tier, localPoint) {
  return [...(tier?.worldCells ?? [])].sort((left, right) => (
    ((left.localTile.x - number(localPoint.x)) ** 2
      + (left.localTile.z - number(localPoint.z)) ** 2)
      - ((right.localTile.x - number(localPoint.x)) ** 2
        + (right.localTile.z - number(localPoint.z)) ** 2)
      || left.id.localeCompare(right.id)
  ))[0] ?? null;
}

function blueprintTierDistanceSquared(floorTiers, localPoint, elevation) {
  const tier = (floorTiers ?? []).find(({ localElevation }) => (
    approximatelyEqualNumber(localElevation, elevation)
  ));
  if (!tier?.worldCells?.length) return Number.POSITIVE_INFINITY;
  return tier.worldCells.reduce((minimum, cell) => Math.min(
    minimum,
    (number(cell.localTile?.x) - number(localPoint?.x)) ** 2
      + (number(cell.localTile?.z) - number(localPoint?.z)) ** 2,
  ), Number.POSITIVE_INFINITY);
}

export function orientBlueprintTransferChoice({
  choice,
  previousPoint,
  floorTiers,
  fromElevation,
  toElevation,
}) {
  const distanceFromPrevious = (point) => (
    (point.x - number(previousPoint?.x, point.x)) ** 2
      + (point.z - number(previousPoint?.z, point.z)) ** 2
  );
  const firstDistance = distanceFromPrevious(choice.first);
  const secondDistance = distanceFromPrevious(choice.second);
  const forwardTierDistance = blueprintTierDistanceSquared(
    floorTiers,
    choice.first,
    fromElevation,
  ) + blueprintTierDistanceSquared(
    floorTiers,
    choice.second,
    toElevation,
  );
  const reverseTierDistance = blueprintTierDistanceSquared(
    floorTiers,
    choice.second,
    fromElevation,
  ) + blueprintTierDistanceSquared(
    floorTiers,
    choice.first,
    toElevation,
  );
  const hasTierPreference = Number.isFinite(forwardTierDistance)
    && Number.isFinite(reverseTierDistance)
    && Math.abs(forwardTierDistance - reverseTierDistance) > 0.000001;
  const reversed = hasTierPreference
    ? reverseTierDistance < forwardTierDistance
    : secondDistance < firstDistance;
  return {
    ...choice,
    from: reversed ? choice.second : choice.first,
    to: reversed ? choice.first : choice.second,
    distance: Math.min(firstDistance, secondDistance),
    tierDistance: Math.min(forwardTierDistance, reverseTierDistance),
    reversed,
    orientationSource: hasTierPreference ? 'floor-tier-alignment' : 'entry-proximity',
  };
}

function realizeBlueprintClearRoutes({
  node,
  operation,
  blueprint,
  themeBinding,
  floorTiers,
}) {
  return (blueprint.routes ?? []).map((route, routeOrdinal) => {
    const tier = blueprintTierById(floorTiers, route.tier ?? 'base');
    const localPoints = (route.points ?? []).map(([x, z]) => ({
      x: number(x),
      z: number(z),
      elevation: number(tier?.localElevation),
    }));
    const sampledCells = [];
    const seenCellIds = new Set();
    for (let pointOrdinal = 0; pointOrdinal < localPoints.length - 1; pointOrdinal += 1) {
      const from = localPoints[pointOrdinal];
      const to = localPoints[pointOrdinal + 1];
      const stepCount = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.z - from.z)) * 4),
      );
      for (let step = 0; step <= stepCount; step += 1) {
        const progress = step / stepCount;
        const cell = nearestBlueprintTierCell(tier, {
          x: from.x + (to.x - from.x) * progress,
          z: from.z + (to.z - from.z) * progress,
        });
        if (cell && !seenCellIds.has(cell.id)) {
          seenCellIds.add(cell.id);
          sampledCells.push(cell);
        }
      }
    }
    const runtimeId = `${node.id}:blueprint-route:${routeOrdinal}`;
    const selectedEdgeIds = (tier?.worldConnectivityEdges ?? []).filter((edge) => (
      seenCellIds.has(edge.fromCellId) && seenCellIds.has(edge.toCellId)
    )).map(({ id }) => id);
    return {
      ...clonePlainValue(route),
      id: `blueprint-route-${routeOrdinal}`,
      localRouteId: `blueprint-route-${routeOrdinal}`,
      runtimeId,
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      blueprintId: blueprint.id,
      floorTierIds: tier ? [tier.id] : [],
      floorTierRuntimeIds: tier ? [tier.runtimeId] : [],
      localPoints,
      worldPoints: localPoints.map((localPoint) => clonePlainValue(
        nearestBlueprintTierCell(tier, localPoint)?.position ?? null,
      )).filter(Boolean),
      worldCellIds: sampledCells.map(({ id }) => id),
      worldConnectivityEdgeIds: selectedEdgeIds,
      minimumClearWidthTiles: 1,
      traversal: 'authored-blueprint-polyline',
      routeCollisionId: `${runtimeId}:collision`,
      themeBinding: clonePlainValue(themeBinding),
      authoritative: true,
      preRender: true,
    };
  });
}

function realizeBlueprintVoids({
  node,
  operation,
  blueprint,
  center,
  rotationQuarterTurns,
  tileSize,
  themeBinding,
}) {
  return (blueprint.voids ?? []).map((record) => {
    const localFootprint = blueprintRecordFootprint(record);
    const position = manifestWorldPoint({
      x: localFootprint.center.x,
      z: localFootprint.center.z,
      elevation: number(record.elevation),
    }, {
      center,
      rotationQuarterTurns,
      tileSize,
    });
    return {
      ...clonePlainValue(record),
      id: String(record.id),
      localVoidId: String(record.id),
      runtimeId: `${node.id}:blueprint-void:${stableIdPart(record.id)}`,
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      blueprintId: blueprint.id,
      localFootprint,
      position,
      worldPosition: clonePlainValue(position),
      grid: {
        x: Math.round(position.x / tileSize),
        z: Math.round(position.z / tileSize),
      },
      collisionId: `${node.id}:blueprint-void:${stableIdPart(record.id)}:collision`,
      blocking: false,
      walkable: false,
      reservedVoid: true,
      themeBinding: clonePlainValue(themeBinding),
      authoritative: true,
      preRender: true,
    };
  });
}

function realizeBlueprintSocketRecords({
  node,
  operation,
  blueprint,
  center,
  rotationQuarterTurns,
  tileSize,
  themeBinding,
  floorTiers,
}) {
  const bindings = resolveBlueprintSocketBindings(node, blueprint, tileSize);
  return bindings.map(({ nodeSocket, blueprintSocket }) => {
    const tier = (floorTiers ?? []).find(({ localElevation }) => (
      approximatelyEqualNumber(localElevation, blueprintSocket.y)
    ));
    const dimensions = blueprint.dimensionsTiles;
    const boundaryCoordinate = blueprintSocket.side === 'N'
      ? -(number(dimensions.depth) - 1) * 0.5
      : blueprintSocket.side === 'S'
        ? (number(dimensions.depth) - 1) * 0.5
        : blueprintSocket.side === 'W'
          ? -(number(dimensions.width) - 1) * 0.5
          : (number(dimensions.width) - 1) * 0.5;
    const apertureLocalTiles = [-1, 0, 1].map((offset) => (
      ['N', 'S'].includes(blueprintSocket.side)
        ? {
          x: number(blueprintSocket.center) + offset,
          z: boundaryCoordinate,
          elevation: number(blueprintSocket.y),
        }
        : {
          x: boundaryCoordinate,
          z: number(blueprintSocket.center) + offset,
          elevation: number(blueprintSocket.y),
        }
    ));
    const apertureCells = apertureLocalTiles.map((localTile) => (
      (tier?.worldCells ?? []).find((cell) => (
        approximatelyEqualNumber(cell.localTile.x, localTile.x)
          && approximatelyEqualNumber(cell.localTile.z, localTile.z)
      ))
    )).filter(Boolean);
    assertSupplementContentContract(
      apertureCells.length === 3,
      node,
      `blueprint socket ${blueprintSocket.id} does not resolve three physical floor cells`,
    );
    const blueprintLocalPosition = blueprintSocketLocalPosition(
      blueprintSocket,
      dimensions,
      tileSize,
    );
    const blueprintLocalFacing = blueprintSocketLocalFacing(blueprintSocket);
    const localPosition = rotateBlueprintLocalPoint(
      blueprintLocalPosition,
      industrialSupplementBlueprintCanonicalTurns(node),
    );
    const localFacing = rotateBlueprintLocalPoint(
      blueprintLocalFacing,
      industrialSupplementBlueprintCanonicalTurns(node),
    );
    const expectedWorldPosition = transformDungeonLocalPoint(blueprintLocalPosition, {
      center,
      rotationQuarterTurns,
    });
    assertSupplementContentContract(
      pointsApproximatelyEqual(nodeSocket.position, expectedWorldPosition),
      node,
      `blueprint socket ${blueprintSocket.id} differs from its planned socket`,
    );
    const runtimeId = `${node.id}:blueprint-socket:${stableIdPart(blueprintSocket.id)}`;
    return {
      ...clonePlainValue(blueprintSocket),
      id: runtimeId,
      runtimeId,
      localSocketId: String(blueprintSocket.id),
      plannedSocketId: String(nodeSocket.id),
      plannedLocalSocketId: String(nodeSocket.localSocketId ?? nodeSocket.id),
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      blueprintId: blueprint.id,
      blueprintLocalPosition,
      blueprintLocalFacing,
      localPosition,
      localFacing,
      position: clonePlainValue(nodeSocket.position),
      worldPosition: clonePlainValue(nodeSocket.position),
      facing: clonePlainValue(nodeSocket.facing),
      worldFacing: clonePlainValue(nodeSocket.facing),
      localElevation: number(blueprintSocket.y),
      elevation: number(nodeSocket.position?.y),
      worldElevation: number(nodeSocket.position?.y),
      floorTierId: tier?.id ?? null,
      floorTierRuntimeId: tier?.runtimeId ?? null,
      apertureWidthTiles: 3,
      apertureWidthMeters: 3 * tileSize,
      apertureLocalTiles,
      apertureFloorCellIds: apertureCells.map(({ id }) => id),
      apertureWorldCells: apertureCells.map((cell) => ({
        floorCellId: cell.id,
        localTile: clonePlainValue(cell.localTile),
        grid: clonePlainValue(cell.grid),
        position: clonePlainValue(cell.position),
        elevation: cell.elevation,
      })),
      state: nodeSocket.state ?? 'capped',
      segmentId: nodeSocket.segmentId ?? null,
      connectionId: nodeSocket.connectionId ?? null,
      reservedOpening: true,
      authoritative: true,
      preRender: true,
      themeBinding: clonePlainValue(themeBinding),
    };
  });
}

function sectionPoint(value, fallbackProgress = 0) {
  if (Array.isArray(value)) {
    return { progress: number(value[0], fallbackProgress), elevation: number(value[1]) };
  }
  return {
    progress: number(value?.progress ?? value?.t, fallbackProgress),
    elevation: number(value?.elevation ?? value?.y),
  };
}

function blueprintTransferSection(blueprint, transfer, transferOrdinal) {
  const sectionRoute = (blueprint.sectionRoute ?? []).map(sectionPoint);
  if (sectionRoute.length >= 2) {
    const sections = sectionRoute.slice(0, -1).map((from, index) => ({
      from,
      to: sectionRoute[index + 1],
      changesElevation: !approximatelyEqualNumber(from.elevation, sectionRoute[index + 1].elevation),
    }));
    const wantsFlat = String(transfer.form) === 'landing';
    const compatible = sections.filter(({ from, to, changesElevation }) => (
      wantsFlat
        ? !changesElevation && from.progress > 0 && to.progress < 1
        : changesElevation
    ));
    const matchingTransferOrdinal = (blueprint.physicalTransfers ?? [])
      .slice(0, transferOrdinal)
      .filter((candidate) => (String(candidate.form) === 'landing') === wantsFlat)
      .length;
    const selected = compatible[matchingTransferOrdinal] ?? compatible.at(-1);
    if (selected) return [selected.from, selected.to];
  }
  let fromElevation = number(
    transfer.endpoints?.from?.elevation ?? transfer.elevationRangeMeters?.min,
  );
  let toElevation = number(
    transfer.endpoints?.to?.elevation ?? transfer.elevationRangeMeters?.max,
  );
  if (approximatelyEqualNumber(fromElevation, toElevation)
      && ['ramp', 'stairs', 'step'].includes(String(transfer.form))) {
    const tierElevations = (blueprint.floorTiers ?? []).map(({ elevation }) => number(elevation));
    const farElevation = tierElevations.sort((left, right) => (
      Math.abs(right - fromElevation) - Math.abs(left - fromElevation)
    ))[0];
    if (Number.isFinite(farElevation)) toElevation = farElevation;
  }
  return [
    { progress: 0, elevation: fromElevation },
    { progress: 1, elevation: toElevation },
  ];
}

function interpolateTransferElevation(sectionRoute, progress) {
  const sections = sectionRoute.length >= 2
    ? sectionRoute
    : [{ progress: 0, elevation: 0 }, { progress: 1, elevation: 0 }];
  const from = sections[0];
  const to = sections.at(-1);
  const span = to.progress - from.progress;
  if (Math.abs(span) <= CONNECTOR_ELEVATION_EPSILON) {
    return progress < 0.5 ? from.elevation : to.elevation;
  }
  const resolvedProgress = from.progress + span * progress;
  for (let index = 0; index < sections.length - 1; index += 1) {
    const first = sections[index];
    const second = sections[index + 1];
    if (resolvedProgress > second.progress + CONNECTOR_ELEVATION_EPSILON) continue;
    const localSpan = second.progress - first.progress;
    if (Math.abs(localSpan) <= CONNECTOR_ELEVATION_EPSILON) return second.elevation;
    const localProgress = (resolvedProgress - first.progress) / localSpan;
    return first.elevation + (second.elevation - first.elevation) * localProgress;
  }
  return to.elevation;
}

function transferEndpointRecord({
  node,
  transfer,
  role,
  localTile,
  worldCells,
  center,
  rotationQuarterTurns,
  tileSize,
}) {
  const elevation = number(localTile.elevation);
  const endpointContract = transfer.endpoints?.[role] ?? null;
  const authoredTransferCell = endpointContract?.localTransferCell ?? null;
  assertSupplementContentContract(
    authoredTransferCell
      && Number.isFinite(Number(authoredTransferCell.x))
      && Number.isFinite(Number(authoredTransferCell.z))
      && approximatelyEqualNumber(endpointContract.localElevation, elevation),
    node,
    `blueprint transfer ${transfer.id} ${role} endpoint has no exact authored identity`,
  );
  const matchingTransferCells = (worldCells ?? []).filter(({ localTile: cellLocalTile }) => (
    approximatelyEqualNumber(cellLocalTile?.x, authoredTransferCell.x)
      && approximatelyEqualNumber(cellLocalTile?.z, authoredTransferCell.z)
  ));
  assertSupplementContentContract(
    matchingTransferCells.length === 1,
    node,
    `blueprint transfer ${transfer.id} ${role} endpoint does not resolve one exact transfer cell`,
  );
  const transferCell = matchingTransferCells[0];
  // The authored endpoint cell is the physical identity. This is especially
  // important for even-width lifts, whose geometric center lies between four
  // cells and must never be rounded or reused as a synthetic boarding point.
  const exactLocalTile = {
    x: number(authoredTransferCell.x),
    z: number(authoredTransferCell.z),
    elevation,
  };
  const position = manifestWorldPoint(exactLocalTile, {
    center,
    rotationQuarterTurns,
    tileSize,
  });
  return {
    role,
    socketId: endpointContract?.socketId ?? null,
    floorCellId: null,
    floorTierRuntimeId: null,
    transferCellId: transferCell.id,
    adjacentTransferCellId: null,
    supportCellId: null,
    supportKind: endpointContract.localSupportRef?.kind ?? null,
    localSupportRef: clonePlainValue(endpointContract.localSupportRef),
    authoredLocalTransferCell: clonePlainValue(authoredTransferCell),
    localTile: clonePlainValue(exactLocalTile),
    grid: {
      x: Math.round(position.x / tileSize),
      z: Math.round(position.z / tileSize),
    },
    position: clonePlainValue(position),
    elevation: position.y,
    localElevation: elevation,
  };
}

function resolveExactBlueprintTransferEndpointSupport({
  node,
  endpoint,
  floorTiers,
  transferByLocalId,
}) {
  const support = endpoint.localSupportRef ?? null;
  assertSupplementContentContract(
    support
      && Number.isFinite(Number(support.localTile?.x))
      && Number.isFinite(Number(support.localTile?.z)),
    node,
    `blueprint transfer endpoint ${endpoint.role} has no exact support reference`,
  );
  if (support.kind === 'floor-cell') {
    const tier = (floorTiers ?? []).find(({ id }) => (
      String(id) === String(support.floorTierId)
    ));
    const matchingFloorCells = (tier?.worldCells ?? []).filter(({ localTile }) => (
      approximatelyEqualNumber(localTile?.x, support.localTile.x)
        && approximatelyEqualNumber(localTile?.z, support.localTile.z)
    ));
    assertSupplementContentContract(
      tier
        && approximatelyEqualNumber(tier.localElevation, endpoint.localElevation)
        && matchingFloorCells.length === 1,
      node,
      `blueprint transfer endpoint ${endpoint.role} does not resolve one exact floor support cell`,
    );
    const floorCell = matchingFloorCells[0];
    endpoint.floorCellId = floorCell.id;
    endpoint.floorTierRuntimeId = tier.runtimeId;
    endpoint.supportCellId = floorCell.id;
    endpoint.supportCellIds = [floorCell.id];
    endpoint.supportRef = { kind: 'floor-cell', id: floorCell.id };
    endpoint.supportReachable = floorCell.walkable !== false;
    endpoint.supportLocalTile = clonePlainValue(floorCell.localTile);
    endpoint.supportGrid = clonePlainValue(floorCell.grid);
    endpoint.supportPosition = clonePlainValue(floorCell.position);
    endpoint.supportElevation = floorCell.elevation;
    return;
  }
  if (support.kind === 'transfer-cell') {
    const supportingTransfer = transferByLocalId.get(String(support.transferId));
    const matchingTransferCells = (supportingTransfer?.worldCells ?? []).filter(({ localTile }) => (
      approximatelyEqualNumber(localTile?.x, support.localTile.x)
        && approximatelyEqualNumber(localTile?.z, support.localTile.z)
        && approximatelyEqualNumber(localTile?.elevation, endpoint.localElevation)
    ));
    assertSupplementContentContract(
      supportingTransfer
        && supportingTransfer.id !== endpoint.transferId
        && matchingTransferCells.length === 1,
      node,
      `blueprint transfer endpoint ${endpoint.role} does not resolve one exact transfer support cell`,
    );
    const transferCell = matchingTransferCells[0];
    endpoint.adjacentTransferCellId = transferCell.id;
    endpoint.adjacentTransferRuntimeId = supportingTransfer.id;
    endpoint.supportCellId = transferCell.id;
    endpoint.supportCellIds = [transferCell.id];
    endpoint.supportRef = { kind: 'transfer-cell', id: transferCell.id };
    endpoint.supportReachable = transferCell.walkable !== false;
    endpoint.supportLocalTile = clonePlainValue(transferCell.localTile);
    endpoint.supportGrid = clonePlainValue(transferCell.grid);
    endpoint.supportPosition = clonePlainValue(transferCell.position);
    endpoint.supportElevation = transferCell.elevation;
    return;
  }
  assertSupplementContentContract(
    false,
    node,
    `blueprint transfer endpoint ${endpoint.role} has an unknown support kind`,
  );
}

function realizeBlueprintTransfers({
  node,
  operation,
  blueprint,
  center,
  rotationQuarterTurns,
  tileSize,
  themeBinding,
  floorTiers,
  stateRecords = [],
}) {
  const entrySocket = (blueprint.sockets ?? []).find(({ role }) => (
    String(role).includes('entry')
  )) ?? blueprint.sockets?.[0];
  const socketBoundaryPoint = (socket) => {
    const halfWidth = (number(blueprint.dimensionsTiles?.width) - 1) * 0.5;
    const halfDepth = (number(blueprint.dimensionsTiles?.depth) - 1) * 0.5;
    if (socket?.side === 'N') return { x: number(socket.center), z: -halfDepth };
    if (socket?.side === 'S') return { x: number(socket.center), z: halfDepth };
    if (socket?.side === 'W') return { x: -halfWidth, z: number(socket.center) };
    return { x: halfWidth, z: number(socket?.center) };
  };
  let previousTransferLocalPoint = socketBoundaryPoint(entrySocket);
  const transfers = (blueprint.physicalTransfers ?? []).map((transfer, transferOrdinal) => {
    const footprint = transfer.footprintTiles ?? {};
    const widthTiles = Math.max(1, Math.trunc(number(
      transfer.widthTiles ?? footprint.width,
      1,
    )));
    const depthTiles = Math.max(1, Math.trunc(number(
      transfer.depthTiles ?? footprint.depth,
      1,
    )));
    const centerX = number(footprint.x);
    const centerZ = number(footprint.z);
    const sectionRoute = blueprintTransferSection(blueprint, transfer, transferOrdinal);
    const verticalDevice = ['lift', 'ladder'].includes(String(transfer.form));
    const axisChoices = verticalDevice ? [] : [
      ...(widthTiles > 1 ? [{
        axis: 'x',
        first: { x: centerX - (widthTiles - 1) * 0.5, z: centerZ },
        second: { x: centerX + (widthTiles - 1) * 0.5, z: centerZ },
        span: widthTiles,
      }] : []),
      ...(depthTiles > 1 ? [{
        axis: 'z',
        first: { x: centerX, z: centerZ - (depthTiles - 1) * 0.5 },
        second: { x: centerX, z: centerZ + (depthTiles - 1) * 0.5 },
        span: depthTiles,
      }] : []),
    ];
    const fromElevation = number(sectionRoute[0]?.elevation);
    const toElevation = number(sectionRoute.at(-1)?.elevation);
    const explicitlyAuthoredAxis = ['x', 'z'].includes(String(transfer.axis))
      ? String(transfer.axis)
      : null;
    const orientedChoices = axisChoices.map((choice) => orientBlueprintTransferChoice({
      choice,
      previousPoint: previousTransferLocalPoint ?? { x: centerX, z: centerZ },
      floorTiers,
      fromElevation,
      toElevation,
    })).sort((left, right) => (
      Number(Boolean(explicitlyAuthoredAxis && right.axis === explicitlyAuthoredAxis))
        - Number(Boolean(explicitlyAuthoredAxis && left.axis === explicitlyAuthoredAxis))
        || right.span - left.span
        || left.tierDistance - right.tierDistance
        || left.distance - right.distance
        || left.axis.localeCompare(right.axis)
    ));
    const orientation = orientedChoices[0] ?? {
      axis: widthTiles >= depthTiles ? 'x' : 'z',
      from: { x: centerX, z: centerZ },
      to: { x: centerX, z: centerZ },
      reversed: false,
      orientationSource: 'vertical-device',
    };
    const variesAlongX = orientation.axis === 'x';
    const runtimeId = `${node.id}:blueprint-transfer:${stableIdPart(transfer.id)}`;
    const worldCells = [];
    for (let zOrdinal = 0; zOrdinal < depthTiles; zOrdinal += 1) {
      for (let xOrdinal = 0; xOrdinal < widthTiles; xOrdinal += 1) {
        const axisOrdinal = variesAlongX ? xOrdinal : zOrdinal;
        const axisCount = variesAlongX ? widthTiles : depthTiles;
        const axisProgress = axisCount <= 1 ? 0.5 : axisOrdinal / (axisCount - 1);
        const progress = verticalDevice
          ? 0
          : orientation.reversed ? 1 - axisProgress : axisProgress;
        const localTile = {
          x: centerX - (widthTiles - 1) * 0.5 + xOrdinal,
          z: centerZ - (depthTiles - 1) * 0.5 + zOrdinal,
          elevation: interpolateTransferElevation(sectionRoute, progress),
        };
        const position = manifestWorldPoint(localTile, {
          center,
          rotationQuarterTurns,
          tileSize,
        });
        worldCells.push({
          id: `${runtimeId}:cell:${xOrdinal}:${zOrdinal}`,
          roomId: node.id,
          nodeId: node.id,
          operationId: operation?.id ?? nodeOperationId(node),
          blueprintId: blueprint.id,
          transferId: runtimeId,
          localTransferId: String(transfer.id),
          localTile,
          grid: {
            x: Math.round(position.x / tileSize),
            z: Math.round(position.z / tileSize),
          },
          position,
          worldPosition: clonePlainValue(position),
          localElevation: localTile.elevation,
          elevation: position.y,
          worldElevation: position.y,
          collisionId: `${runtimeId}:cell:${xOrdinal}:${zOrdinal}:collision`,
          walkable: true,
          authoritative: true,
          preRender: true,
          themeBinding: clonePlainValue(themeBinding),
        });
      }
    }
    const fromLocalTile = {
      x: orientation.from.x,
      z: orientation.from.z,
      elevation: fromElevation,
    };
    const toLocalTile = {
      x: orientation.to.x,
      z: orientation.to.z,
      elevation: toElevation,
    };
    previousTransferLocalPoint = { x: toLocalTile.x, z: toLocalTile.z };
    const worldEndpoints = {
      from: transferEndpointRecord({
        node,
        transfer,
        role: 'from',
        localTile: fromLocalTile,
        worldCells,
        center,
        rotationQuarterTurns,
        tileSize,
      }),
      to: transferEndpointRecord({
        node,
        transfer,
        role: 'to',
        localTile: toLocalTile,
        worldCells,
        center,
        rotationQuarterTurns,
        tileSize,
      }),
    };
    for (const endpoint of Object.values(worldEndpoints)) {
      const cell = worldCells.find(({ id }) => id === endpoint.transferCellId);
      if (cell) {
        cell.endpointRoles = [...new Set([...(cell.endpointRoles ?? []), endpoint.role])];
        cell.endpointRole = endpoint.role;
      }
    }
    return {
      ...clonePlainValue(transfer),
      id: runtimeId,
      runtimeId,
      localTransferId: String(transfer.id),
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      blueprintId: blueprint.id,
      form: String(transfer.form),
      kind: String(transfer.form),
      traversalKind: String(transfer.form),
      localElevationRange: { from: fromElevation, to: toElevation },
      worldElevationRange: {
        from: number(center.y) + fromElevation,
        to: number(center.y) + toElevation,
      },
      fromElevation: number(center.y) + fromElevation,
      toElevation: number(center.y) + toElevation,
      localFootprint: {
        center: { x: centerX, z: centerZ },
        widthTiles,
        depthTiles,
      },
      localTraversalAxis: orientation.axis,
      localTraversalReversed: orientation.reversed,
      localTraversalOrientationSource: orientation.orientationSource,
      worldCells,
      worldEndpoints,
      sectionRoute: sectionRoute.map(({ progress, elevation }) => ({
        progress,
        elevation,
        worldElevation: number(center.y) + elevation,
      })),
      blueprintSectionRoute: (blueprint.sectionRoute ?? []).map((point, ordinal) => {
        const resolved = sectionPoint(point, ordinal);
        return {
          ...resolved,
          worldElevation: number(center.y) + resolved.elevation,
        };
      }),
      bidirectional: true,
      localStateIds: stateRecords.map(({ localStateId }) => localStateId),
      stateIds: stateRecords.map(({ runtimeStateId }) => runtimeStateId),
      stateRecords: clonePlainValue(stateRecords),
      collisionId: `${runtimeId}:collision`,
      authoritative: true,
      preRender: true,
      themeBinding: clonePlainValue(themeBinding),
    };
  });
  const transferByLocalId = new Map(transfers.map((transfer) => (
    [String(transfer.localTransferId), transfer]
  )));
  for (const transfer of transfers) {
    for (const endpoint of Object.values(transfer.worldEndpoints)) {
      endpoint.transferId = transfer.id;
      resolveExactBlueprintTransferEndpointSupport({
        node,
        endpoint,
        floorTiers,
        transferByLocalId,
      });
    }
  }
  return transfers;
}

function blueprintZoneAnchorTarget(zone, tileSize) {
  if (!zone) return null;
  const center = zone.localFootprint?.center ?? {};
  const supportCell = [...(zone.worldCells ?? [])].sort((left, right) => (
    ((number(left.localTile?.x) - number(center.x)) ** 2
      + (number(left.localTile?.z) - number(center.z)) ** 2)
      - ((number(right.localTile?.x) - number(center.x)) ** 2
        + (number(right.localTile?.z) - number(center.z)) ** 2)
      || String(left.id).localeCompare(String(right.id))
  ))[0] ?? null;
  const position = supportCell?.position ?? zone.position;
  return {
    id: supportCell?.id ?? zone.runtimeId,
    roomId: zone.roomId,
    nodeId: zone.nodeId,
    localTile: clonePlainValue(supportCell?.localTile ?? {
      x: number(center.x),
      z: number(center.z),
      elevation: number(zone.localElevation),
    }),
    position: clonePlainValue(position),
    worldPosition: clonePlainValue(position),
    grid: {
      x: Math.round(number(position?.x) / tileSize),
      z: Math.round(number(position?.z) / tileSize),
    },
    floorTierId: supportCell?.floorTierId ?? zone.floorTierId,
    floorTierRuntimeId: supportCell?.floorTierRuntimeId ?? zone.floorTierRuntimeId,
    sourceTransferId: supportCell?.localTransferId ?? null,
    sourceTransferRuntimeId: supportCell?.transferId ?? null,
    sourceZoneId: zone.localZoneId,
    sourceZoneRuntimeId: zone.runtimeId,
    supportKind: supportCell?.sourceKind ?? null,
    supportCellId: supportCell?.floorCellId ?? supportCell?.transferCellId ?? null,
    supportCellIds: supportCell
      ? [supportCell.floorCellId ?? supportCell.transferCellId].filter(Boolean)
      : [],
    supportReachable: Boolean(supportCell),
  };
}

function blueprintZoneCellAnchorTargets(zones) {
  const candidates = (zones ?? []).flatMap((zone) => (
    (zone.worldCells ?? []).map((cell) => {
      const supportCellId = cell.floorCellId ?? cell.transferCellId ?? null;
      return {
        id: `${zone.runtimeId}:anchor-cell:${stableIdPart(supportCellId ?? cell.id)}`,
        roomId: zone.roomId,
        nodeId: zone.nodeId,
        localTile: clonePlainValue(cell.localTile),
        position: clonePlainValue(cell.position),
        worldPosition: clonePlainValue(cell.position),
        grid: clonePlainValue(cell.grid),
        floorTierId: cell.floorTierId ?? null,
        floorTierRuntimeId: cell.floorTierRuntimeId ?? null,
        sourceTransferId: cell.localTransferId ?? null,
        sourceTransferRuntimeId: cell.transferId ?? null,
        sourceZoneId: zone.localZoneId,
        sourceZoneRuntimeId: zone.runtimeId,
        supportKind: cell.sourceKind,
        supportCellId,
        supportCellIds: supportCellId ? [supportCellId] : [],
        supportReachable: Boolean(supportCellId),
        sourceZoneCenter: clonePlainValue(zone.localFootprint?.center ?? null),
      };
    })
  ));
  return [...new Map(candidates.map((candidate) => (
    [candidate.supportCellId ?? candidate.id, candidate]
  ))).values()];
}

function blueprintTransferAnchorTarget(transfer, anchorId, tileSize) {
  if (!transfer) return null;
  const normalizedId = String(anchorId ?? '').toLowerCase();
  if (normalizedId.includes('lower')) return {
    ...clonePlainValue(transfer.worldEndpoints.from),
    id: transfer.worldEndpoints.from.supportCellId
      ?? transfer.worldEndpoints.from.transferCellId
      ?? `${transfer.id}:from`,
    sourceTransferId: transfer.localTransferId,
    sourceTransferRuntimeId: transfer.id,
  };
  if (normalizedId.includes('upper')) return {
    ...clonePlainValue(transfer.worldEndpoints.to),
    id: transfer.worldEndpoints.to.supportCellId
      ?? transfer.worldEndpoints.to.transferCellId
      ?? `${transfer.id}:to`,
    sourceTransferId: transfer.localTransferId,
    sourceTransferRuntimeId: transfer.id,
  };
  const midpointElevation = (
    transfer.localElevationRange.from + transfer.localElevationRange.to
  ) * 0.5;
  const cell = [...(transfer.worldCells ?? [])].sort((left, right) => (
    Math.abs(left.localElevation - midpointElevation)
      - Math.abs(right.localElevation - midpointElevation)
    || left.id.localeCompare(right.id)
  ))[0];
  return cell ? {
    id: cell.id,
    localTile: clonePlainValue(cell.localTile),
    position: clonePlainValue(cell.position),
    worldPosition: clonePlainValue(cell.position),
    grid: clonePlainValue(cell.grid),
    floorTierId: null,
    floorTierRuntimeId: null,
    sourceTransferId: transfer.localTransferId,
    sourceTransferRuntimeId: transfer.id,
  } : {
    id: `${transfer.id}:mid`,
    localTile: {
      x: transfer.localFootprint.center.x,
      z: transfer.localFootprint.center.z,
      elevation: midpointElevation,
    },
    position: {
      x: number(transfer.worldEndpoints.from.position?.x),
      y: (number(transfer.worldEndpoints.from.position?.y)
        + number(transfer.worldEndpoints.to.position?.y)) * 0.5,
      z: number(transfer.worldEndpoints.from.position?.z),
    },
    grid: {
      x: Math.round(number(transfer.worldEndpoints.from.position?.x) / tileSize),
      z: Math.round(number(transfer.worldEndpoints.from.position?.z) / tileSize),
    },
    sourceTransferId: transfer.localTransferId,
    sourceTransferRuntimeId: transfer.id,
  };
}

function relocateManifestAnchorsToBlueprint({
  node,
  manifestAnchors,
  blueprintAnchorPositions,
  blueprintZones,
  blueprintTransfers,
  tileSize,
  requireManifest,
}) {
  const spawnTargets = blueprintAnchorPositions.filter(({ blueprintFeatureType }) => (
    blueprintFeatureType === 'spawn'
  ));
  const controlTargets = blueprintAnchorPositions.filter(({ blueprintFeatureType }) => (
    blueprintFeatureType === 'control'
  ));
  const rewardTargets = blueprintAnchorPositions.filter(({ blueprintFeatureType }) => (
    blueprintFeatureType === 'reward'
  ));
  const discoveryTargets = blueprintAnchorPositions.filter(({ blueprintFeatureType }) => (
    blueprintFeatureType === 'story'
  ));
  const encounterZones = blueprintZones.filter(({ zoneKind }) => zoneKind === 'encounter');
  const hazardZones = blueprintZones.filter(({ zoneKind }) => zoneKind === 'hazard');
  const requiredSpatialAnchorIds = new Set(manifestAnchors.flatMap((anchor) => (
    anchor.encounterRecipe?.spatialRoles ?? []
  )).flatMap(({ anchorIds = [] }) => anchorIds.map(String)));
  const spawnZoneTargets = blueprintZoneCellAnchorTargets(
    encounterZones.length > 0 ? encounterZones : hazardZones,
  );
  const consumedSpawnTargetIds = new Set();
  const consumedSpawnPositions = [];
  let platformOrdinal = 0;
  const spawnTargetId = (target) => target?.supportCellId ?? target?.id ?? null;
  const consumeSpawnTarget = (role) => {
    const consume = (target) => {
      const targetId = spawnTargetId(target);
      if (!target || !targetId || consumedSpawnTargetIds.has(targetId)) return null;
      consumedSpawnTargetIds.add(targetId);
      consumedSpawnPositions.push(target.position);
      return target;
    };
    const exact = role ? spawnTargets.find((target) => (
      target.spatialRole === role && !consumedSpawnTargetIds.has(spawnTargetId(target))
    )) : null;
    if (exact) return consume(exact);
    const authoredFallback = spawnTargets.find((target) => (
      !consumedSpawnTargetIds.has(spawnTargetId(target))
    ));
    if (authoredFallback) return consume(authoredFallback);
    const availableZoneTargets = spawnZoneTargets.filter((target) => (
      !consumedSpawnTargetIds.has(spawnTargetId(target))
    ));
    if (availableZoneTargets.length === 0) return null;
    const selected = [...availableZoneTargets].sort((left, right) => {
      if (consumedSpawnPositions.length === 0) {
        const leftCenter = left.sourceZoneCenter ?? {};
        const rightCenter = right.sourceZoneCenter ?? {};
        const leftDistance = (number(left.localTile?.x) - number(leftCenter.x)) ** 2
          + (number(left.localTile?.z) - number(leftCenter.z)) ** 2;
        const rightDistance = (number(right.localTile?.x) - number(rightCenter.x)) ** 2
          + (number(right.localTile?.z) - number(rightCenter.z)) ** 2;
        return leftDistance - rightDistance || String(left.id).localeCompare(String(right.id));
      }
      const minimumDistance = (candidate) => Math.min(...consumedSpawnPositions.map((point) => (
        (number(candidate.position?.x) - number(point?.x)) ** 2
          + (number(candidate.position?.z) - number(point?.z)) ** 2
      )));
      return minimumDistance(right) - minimumDistance(left)
        || String(left.id).localeCompare(String(right.id));
    })[0];
    return consume(selected);
  };
  const validateOwnedSpawnTarget = (anchor, target) => {
    assertSupplementContentContract(
      Boolean(target)
        && target.roomId === node.id
        && target.nodeId === node.id
        && target.supportReachable === true
        && Boolean(target.supportCellId),
      node,
      `spatial anchor ${anchor.localAnchorId ?? anchor.id} has no distinct owned reachable spawn support`,
    );
  };
  const targetForAnchor = (anchor) => {
    const kind = String(anchor.kind ?? '');
    const localId = String(anchor.localAnchorId ?? anchor.id ?? '').toLowerCase();
    if (kind === 'spatial-role') {
      // Manifests expose reusable role candidates for their recipe catalog,
      // but only anchors referenced by this room's resolved encounter recipe
      // are live spawn slots. A calm room or reward vault must not fail
      // realization merely because its inactive catalog candidates have no
      // authored spawn markers in the selected physical blueprint.
      const requiredForResolvedEncounter = requiredSpatialAnchorIds.has(String(
        anchor.localAnchorId ?? anchor.id ?? '',
      ));
      if (!requiredForResolvedEncounter) return null;
      const role = localId.includes('frontline')
        ? 'frontline'
        : localId.includes('perch')
          ? 'perch'
          : localId.includes('flank')
            ? 'flank'
            : null;
      const selected = consumeSpawnTarget(role);
      if (requireManifest && requiredForResolvedEncounter) {
        validateOwnedSpawnTarget(anchor, selected);
      }
      return selected;
    }
    if (['encounter', 'enemyEncounter'].includes(kind)) {
      return blueprintZoneAnchorTarget(encounterZones[0], tileSize) ?? spawnTargets[0] ?? null;
    }
    if (['trap', 'hazard', 'environmentalHazard'].includes(kind)) {
      return blueprintZoneAnchorTarget(hazardZones[0], tileSize)
        ?? blueprintAnchorPositions.find(({ blueprintFeatureType }) => (
          blueprintFeatureType === 'hazard'
        ))
        ?? null;
    }
    if (['progression', 'mechanism', 'control'].includes(kind)) {
      return controlTargets[0] ?? null;
    }
    if (kind === 'reward') return rewardTargets[0] ?? null;
    // A physical blueprint can author a dedicated story position alongside a
    // reward. Keep those semantic anchors on their corresponding authored
    // supports before falling back to older control/reward-only blueprints.
    if (kind === 'discovery') {
      return discoveryTargets[0] ?? controlTargets[0] ?? rewardTargets[0] ?? null;
    }
    if (kind === 'platform') {
      const transfer = blueprintTransfers[
        Math.min(platformOrdinal, Math.max(blueprintTransfers.length - 1, 0))
      ];
      platformOrdinal += 1;
      return blueprintTransferAnchorTarget(transfer, localId, tileSize);
    }
    return null;
  };
  return manifestAnchors.map((anchor) => {
    const target = targetForAnchor(anchor);
    if (requireManifest && manifestAnchorRequiresRuntimeState(anchor)) {
      assertSupplementContentContract(
        Boolean(target),
        node,
        `semantic anchor ${anchor.localAnchorId ?? anchor.id} has no authored blueprint target`,
      );
    }
    if (!target) return anchor;
    return {
      ...anchor,
      semanticLocalTile: clonePlainValue(anchor.localTile ?? null),
      localTile: clonePlainValue(target.localTile ?? null),
      position: clonePlainValue(target.position),
      worldPosition: clonePlainValue(target.worldPosition ?? target.position),
      grid: clonePlainValue(target.grid),
      floorTierId: target.floorTierId ?? null,
      floorTierRuntimeId: target.floorTierRuntimeId ?? null,
      blueprintTargetId: target.id ?? null,
      blueprintFeatureId: target.sourceFeatureId ?? null,
      blueprintZoneId: target.sourceZoneId ?? null,
      blueprintTransferId: target.sourceTransferId ?? null,
      blueprintTransferRuntimeId: target.sourceTransferRuntimeId ?? null,
      supportKind: target.supportKind ?? null,
      supportCellId: target.supportCellId ?? null,
      supportCellIds: clonePlainValue(target.supportCellIds ?? []),
      supportReachable: target.supportReachable ?? null,
      authoritativeBlueprintPlacement: true,
    };
  });
}

function realizeManifestZones({
  node,
  operation,
  manifest,
  center,
  rotationQuarterTurns,
  tileSize,
  themeBinding,
  floorTiers,
}) {
  const tierCellKeysByElevation = new Map();
  for (const tier of floorTiers ?? []) {
    const key = number(tier.localElevation).toFixed(6);
    const cells = tierCellKeysByElevation.get(key) ?? new Set();
    for (const cell of tier.worldCells ?? []) {
      cells.add(`${cell.localTile.x},${cell.localTile.z}`);
    }
    tierCellKeysByElevation.set(key, cells);
  }
  const zoneById = new Map((manifest.zones ?? []).map((zone) => [String(zone.id), zone]));
  const zoneIncludesElevation = (zone, elevation) => {
    const elevations = Array.isArray(zone?.elevations) && zone.elevations.length > 0
      ? zone.elevations
      : [zone?.elevation ?? 0];
    return elevations.some((candidate) => (
      Math.abs(number(candidate) - elevation) <= CONNECTOR_ELEVATION_EPSILON
    ));
  };
  return (manifest.zones ?? []).map((zone) => {
    const bounds = zone.tileBounds ?? {};
    const localElevations = Array.isArray(zone.elevations) && zone.elevations.length > 0
      ? zone.elevations.map((elevation) => number(elevation))
      : [number(zone.elevation)];
    const runtimeId = `${node.id}:zone:${stableIdPart(zone.id)}`;
    const worldCells = [];
    for (const elevation of localElevations) {
      const walkableCellKeys = tierCellKeysByElevation.get(elevation.toFixed(6)) ?? new Set();
      for (let z = number(bounds.minZ); z <= number(bounds.maxZ); z += 1) {
        for (let x = number(bounds.minX); x <= number(bounds.maxX); x += 1) {
          if (!walkableCellKeys.has(`${x},${z}`)) continue;
          const excluded = (zone.excludesZoneIds ?? []).some((zoneId) => {
            const excludedZone = zoneById.get(String(zoneId));
            const excludedBounds = excludedZone?.tileBounds;
            return excludedBounds
              && zoneIncludesElevation(excludedZone, elevation)
              && x >= number(excludedBounds.minX)
              && x <= number(excludedBounds.maxX)
              && z >= number(excludedBounds.minZ)
              && z <= number(excludedBounds.maxZ);
          });
          if (excluded) continue;
          const position = manifestWorldPoint({ x, z, elevation }, {
            center,
            rotationQuarterTurns,
            tileSize,
          });
          worldCells.push({
            id: `${runtimeId}:cell:${stableIdPart(x)}:${stableIdPart(z)}:y${stableIdPart(elevation)}`,
            localTile: { x, z, elevation },
            grid: {
              x: Math.round(position.x / tileSize),
              z: Math.round(position.z / tileSize),
            },
            elevation: position.y,
            position,
          });
        }
      }
    }
    const worldBoundsByElevation = localElevations.map((localElevation) => {
      const cells = worldCells.filter(({ localTile }) => (
        Math.abs(localTile.elevation - localElevation) <= CONNECTOR_ELEVATION_EPSILON
      ));
      const gridXs = cells.map(({ grid }) => grid.x);
      const gridZs = cells.map(({ grid }) => grid.z);
      return {
        localElevation,
        worldElevation: number(center.y) + localElevation,
        minGridX: Math.min(...gridXs),
        maxGridX: Math.max(...gridXs),
        minGridZ: Math.min(...gridZs),
        maxGridZ: Math.max(...gridZs),
      };
    });
    return {
      ...clonePlainValue(zone),
      localZoneId: zone.id,
      runtimeId,
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      moduleManifestId: manifest.id,
      worldElevations: localElevations.map((elevation) => number(center.y) + elevation),
      worldElevation: number(center.y) + localElevations[0],
      worldCells,
      worldBoundsByElevation,
      themeBinding: clonePlainValue(themeBinding),
      authoritative: true,
    };
  });
}

function realizeManifestPointRecords(records, category, {
  node,
  operation,
  manifest,
  center,
  rotationQuarterTurns,
  tileSize,
  themeBinding,
}) {
  return (records ?? []).map((record) => {
    const usesTileCoordinates = Boolean(record.localTile);
    const localPoint = record.localTile
      ?? record.localPosition
      ?? record.position
      ?? {};
    const position = manifestWorldPoint({
      ...localPoint,
      elevation: localPoint.elevation ?? localPoint.y ?? record.elevation,
    }, {
      center,
      rotationQuarterTurns,
      tileSize,
      tileCoordinates: usesTileCoordinates,
    });
    const runtimeId = `${node.id}:${stableIdPart(category)}:${stableIdPart(record.id)}`;
    return {
      ...clonePlainValue(record),
      [`local${category[0].toUpperCase()}${category.slice(1)}Id`]: record.id,
      runtimeId,
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      moduleManifestId: manifest.id,
      position,
      worldPosition: clonePlainValue(position),
      grid: {
        x: Math.round(position.x / tileSize),
        z: Math.round(position.z / tileSize),
      },
      worldElevation: position.y,
      collisionId: `${runtimeId}:collision`,
      themeBinding: clonePlainValue(themeBinding),
      authoritative: true,
    };
  });
}

function realizeManifestClearRoutes({
  node,
  operation,
  manifest,
  floorTiers,
  zones,
  anchors,
  themeBinding,
}) {
  const socketByLocalId = new Map((node.sockets ?? []).map((socket) => (
    [String(socket.localSocketId ?? socket.id), socket]
  )));
  const tierById = new Map(floorTiers.map((tier) => [String(tier.id), tier]));
  const zoneById = new Map(zones.map((zone) => [String(zone.id), zone]));
  const anchorByLocalId = new Map(anchors.map((anchor) => (
    [String(anchor.localAnchorId ?? anchor.id), anchor]
  )));
  return (manifest.clearRoutes ?? []).map((route) => {
    const referencedTiers = (route.floorTierIds ?? []).map((id) => tierById.get(String(id)))
      .filter(Boolean);
    const fromSocketBindings = (route.fromSocketIds ?? []).map((id) => {
      const socket = socketByLocalId.get(String(id));
      return {
        localSocketId: String(id),
        socketId: String(socket?.id ?? id),
        nodeId: node.id,
        position: clonePlainValue(socket?.position ?? null),
        facing: clonePlainValue(socket?.facing ?? null),
      };
    });
    const requiredRuntimeStateId = route.requiredState
      ? operation?.stableRuntimeStateIds?.mechanism ?? null
      : null;
    return {
      ...clonePlainValue(route),
      localRouteId: route.id,
      runtimeId: `${node.id}:clear-route:${stableIdPart(route.id)}`,
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      moduleManifestId: manifest.id,
      resolvedFromSocketIds: fromSocketBindings.map(({ socketId }) => socketId),
      fromSocketBindings,
      fromZoneRuntimeId: route.fromZoneId
        ? zoneById.get(String(route.fromZoneId))?.runtimeId ?? null
        : null,
      toZoneRuntimeId: route.toZoneId
        ? zoneById.get(String(route.toZoneId))?.runtimeId ?? null
        : null,
      viaZoneRuntimeIds: (route.viaZoneIds ?? []).map((id) => (
        zoneById.get(String(id))?.runtimeId ?? null
      )).filter(Boolean),
      excludedZoneRuntimeIds: (route.excludedZoneIds ?? []).map((id) => (
        zoneById.get(String(id))?.runtimeId ?? null
      )).filter(Boolean),
      toAnchorRuntimeId: route.toAnchorId
        ? anchorByLocalId.get(String(route.toAnchorId))?.id ?? null
        : null,
      floorTierRuntimeIds: referencedTiers.map(({ runtimeId }) => runtimeId),
      worldCellIds: referencedTiers.flatMap(({ worldCells }) => (
        worldCells.map(({ id }) => id)
      )),
      worldConnectivityEdgeIds: referencedTiers.flatMap(({ worldConnectivityEdges }) => (
        worldConnectivityEdges.map(({ id }) => id)
      )),
      requiredRuntimeStateId,
      routeCollisionId: `${node.id}:clear-route:${stableIdPart(route.id)}:collision`,
      themeBinding: clonePlainValue(themeBinding),
      authoritative: true,
    };
  });
}

function createManifestCollisionRecords({
  node,
  operation,
  manifest,
  blueprint = null,
  floorTiers,
  zones,
  clearRoutes,
  cover,
  landmarks,
  lighting,
  anchors,
  transfers = [],
  voids = [],
  socketRecords = [],
  tileSize,
  themeBinding,
}) {
  const shared = (sourceKind, sourceId) => ({
    roomId: node.id,
    nodeId: node.id,
    operationId: operation?.id ?? nodeOperationId(node),
    moduleManifestId: manifest?.id ?? null,
    blueprintId: blueprint?.id ?? null,
    sourceKind,
    sourceId,
    preRender: true,
    authoritative: true,
    themeBinding: clonePlainValue(themeBinding),
  });
  const floorRecords = floorTiers.flatMap((tier) => tier.worldCells.map((cell) => ({
    id: cell.collisionId,
    ...shared('floor-tier-cell', cell.id),
    collisionKind: 'walkable-floor-surface',
    floorTierId: tier.id,
    floorTierRuntimeId: tier.runtimeId,
    grid: clonePlainValue(cell.grid),
    center: clonePlainValue(cell.position),
    size: { x: tileSize, y: 0.2, z: tileSize },
    elevation: cell.elevation,
    floorKey: cell.floorKey,
    blocking: false,
    walkable: true,
  })));
  const zoneRecords = zones.flatMap((zone) => zone.worldBoundsByElevation.map((bounds) => ({
    id: `${zone.runtimeId}:collision:y${stableIdPart(bounds.localElevation)}`,
    ...shared('zone', zone.id),
    collisionKind: 'authored-zone-occupancy',
    zoneId: zone.id,
    zoneRuntimeId: zone.runtimeId,
    bounds: clonePlainValue(bounds),
    validFor: clonePlainValue(zone.validFor ?? []),
    blocking: false,
  })));
  const routeRecords = clearRoutes.map((route) => ({
    id: route.routeCollisionId,
    ...shared('clear-route', route.id),
    collisionKind: 'clear-route-reservation',
    clearRouteId: route.id,
    clearRouteRuntimeId: route.runtimeId,
    worldCellIds: [...route.worldCellIds],
    minimumClearWidthTiles: number(route.minimumClearWidthTiles, 1),
    traversal: route.traversal,
    blocking: false,
    mustRemainClear: true,
  }));
  const coverRecords = cover.map((record) => ({
    id: record.collisionId,
    ...shared('cover', record.id),
    collisionKind: record.blocksLineOfSight
      ? 'solid-line-of-sight-cover'
      : 'solid-waist-high-cover',
    coverId: record.id,
    coverRuntimeId: record.runtimeId,
    center: clonePlainValue(record.position),
    grid: clonePlainValue(record.grid),
    size: {
      x: number(record.collisionFootprint?.widthMeters, tileSize * 0.42),
      y: number(
        record.collisionFootprint?.heightMeters,
        record.blocksLineOfSight ? 3.6 : 1.2,
      ),
      z: number(record.collisionFootprint?.depthMeters, tileSize * 0.42),
    },
    blocksLineOfSight: Boolean(record.blocksLineOfSight),
    ...(Array.isArray(record.occupiedSupportCellIds) ? {
      occupiedSupportCellIds: [...record.occupiedSupportCellIds],
    } : {}),
    // Cover is physical even when the player can see over it. Treating
    // waist-high props as a non-blocking reservation made authored flank
    // lanes and encounter choreography visually present but collisionless.
    blocking: record.blocksMovement !== false,
  }));
  const pointRecords = [
    ...landmarks.map((record) => ['landmark', record]),
    ...lighting.map((record) => ['lighting', record]),
    ...anchors.map((record) => ['anchor', record]),
  ].map(([sourceKind, record]) => ({
    id: record.collisionId ?? `${record.runtimeId ?? record.id}:collision`,
    ...shared(sourceKind, record.id),
    collisionKind: blueprint && record.blocking
      ? `solid-blueprint-${sourceKind}`
      : `${sourceKind}-reservation`,
    center: clonePlainValue(record.position),
    grid: clonePlainValue(record.grid),
    size: record.collisionFootprint ? {
      x: number(record.collisionFootprint.widthMeters, tileSize),
      y: number(record.collisionFootprint.heightMeters, 3.6),
      z: number(record.collisionFootprint.depthMeters, tileSize),
    } : undefined,
    ...(Array.isArray(record.occupiedSupportCellIds) ? {
      occupiedSupportCellIds: [...record.occupiedSupportCellIds],
    } : {}),
    blocking: blueprint ? record.blocking === true : false,
  }));
  const transferRecords = transfers.map((transfer) => ({
    id: transfer.collisionId,
    ...shared('physical-transfer', transfer.localTransferId ?? transfer.id),
    collisionKind: 'authored-transfer-footprint',
    transferId: transfer.id,
    localTransferId: transfer.localTransferId,
    traversalKind: transfer.traversalKind,
    worldCellIds: transfer.worldCells.map(({ id }) => id),
    worldEndpoints: clonePlainValue(transfer.worldEndpoints),
    localFootprint: clonePlainValue(transfer.localFootprint),
    blocking: false,
    walkable: true,
    bidirectional: transfer.bidirectional !== false,
  }));
  const voidRecords = voids.map((record) => ({
    id: record.collisionId,
    ...shared('blueprint-void', record.localVoidId ?? record.id),
    collisionKind: 'authored-floor-void',
    center: clonePlainValue(record.position),
    grid: clonePlainValue(record.grid),
    localFootprint: clonePlainValue(record.localFootprint),
    size: {
      x: number(record.localFootprint?.widthTiles, 1) * tileSize,
      y: Math.max(3.6, number(node.size?.y ?? node.size?.height, 5.6)),
      z: number(record.localFootprint?.depthTiles, 1) * tileSize,
    },
    blocking: false,
    walkable: false,
    excludesFloor: true,
    reservedVoid: true,
  }));
  const socketRecordsForCollision = socketRecords.map((record) => ({
    id: `${record.runtimeId}:collision`,
    ...shared('blueprint-socket', record.localSocketId),
    collisionKind: 'reserved-socket-opening',
    socketId: record.plannedSocketId,
    blueprintSocketId: record.localSocketId,
    apertureFloorCellIds: [...record.apertureFloorCellIds],
    center: clonePlainValue(record.position),
    blocking: false,
    reservedOpening: true,
  }));
  return [
    ...floorRecords,
    ...zoneRecords,
    ...routeRecords,
    ...coverRecords,
    ...pointRecords,
    ...transferRecords,
    ...voidRecords,
    ...socketRecordsForCollision,
  ];
}

function blueprintFeaturePresentationContract(featureType) {
  switch (String(featureType ?? 'feature')) {
    case 'cover':
      return {
        semanticRole: 'gameplay-cover',
        themeRole: 'gameplayCover',
        presentationOwner: 'supplement-assembler',
        realizationKind: 'theme-object-root',
      };
    case 'machine':
      return {
        semanticRole: 'machinery-landmark',
        themeRole: 'machineryLandmark',
        presentationOwner: 'supplement-assembler',
        realizationKind: 'theme-object-root',
      };
    case 'story':
      return {
        semanticRole: 'story-marking',
        themeRole: 'storyMarking',
        presentationOwner: 'supplement-assembler',
        realizationKind: 'theme-object-root',
      };
    case 'control':
      return {
        semanticRole: 'gameplay-control',
        themeRole: null,
        presentationOwner: 'gameplay-runtime',
        realizationKind: 'gameplay-anchor',
      };
    case 'hazard':
      return {
        semanticRole: 'gameplay-hazard',
        themeRole: null,
        presentationOwner: 'gameplay-runtime',
        realizationKind: 'gameplay-anchor',
      };
    case 'reward':
      return {
        semanticRole: 'gameplay-reward',
        themeRole: null,
        presentationOwner: 'gameplay-runtime',
        realizationKind: 'gameplay-anchor',
      };
    case 'spawn':
      return {
        semanticRole: 'encounter-spawn',
        themeRole: null,
        presentationOwner: 'gameplay-runtime',
        realizationKind: 'gameplay-anchor',
      };
    case 'transfer':
      return {
        semanticRole: 'traversal-transfer',
        themeRole: null,
        presentationOwner: 'supplement-connector-assembler',
        realizationKind: 'physical-transfer',
      };
    default:
      return {
        semanticRole: `authored-${stableIdPart(featureType ?? 'feature')}`,
        themeRole: null,
        presentationOwner: 'gameplay-runtime',
        realizationKind: 'gameplay-anchor',
      };
  }
}

function createBlueprintPresentationRecords({
  node,
  operation,
  blueprint,
  blueprintFeatures,
  anchors = [],
  transfers = [],
  collisionRecords = [],
  tileSize,
  themeBinding,
}) {
  if (!blueprint) return [];
  const collisionRecordIds = new Set(collisionRecords.map(({ id }) => String(id)));
  const featureRecordsBySourceId = new Map();
  for (const record of blueprintFeatures?.all ?? []) {
    const sourceId = String(record.sourceFeatureRuntimeId ?? record.runtimeId ?? record.id);
    const records = featureRecordsBySourceId.get(sourceId) ?? [];
    records.push(record);
    featureRecordsBySourceId.set(sourceId, records);
  }
  const activeSpatialAnchorIds = new Set(anchors.flatMap((anchor) => (
    anchor.encounterRecipe?.spatialRoles ?? []
  )).flatMap(({ anchorIds = [] }) => anchorIds.map(String)));
  const anchorIsActiveRuntimeConsumer = (anchor) => Boolean(
    anchor.encounterRecipe
      || anchor.rewardRecipe
      || anchor.mechanismRecipe
      || anchor.hazardRecipe
      || anchor.discoveryRecipe
      || (
        String(anchor.kind ?? '') === 'spatial-role'
          && activeSpatialAnchorIds.has(String(anchor.localAnchorId ?? anchor.id ?? ''))
      )
  );

  const records = (blueprint.features ?? []).map((sourceFeature) => {
    const localFeatureId = String(sourceFeature.id);
    const sourceFeatureRuntimeId = `${node.id}:blueprint-feature:${stableIdPart(localFeatureId)}`;
    const realizedFeatures = featureRecordsBySourceId.get(sourceFeatureRuntimeId) ?? [];
    assertSupplementContentContract(
      realizedFeatures.length > 0,
      node,
      `blueprint feature ${localFeatureId} has no source presentation identity`,
    );
    const representative = realizedFeatures[0];
    const featureType = String(sourceFeature.type ?? representative.blueprintFeatureType ?? 'feature');
    const contract = blueprintFeaturePresentationContract(featureType);
    const relatedAnchors = anchors.filter((anchor) => (
      String(anchor.sourceFeatureId ?? '') === localFeatureId
        || String(anchor.blueprintFeatureId ?? '') === localFeatureId
        || String(anchor.sourceFeatureRuntimeId ?? '') === sourceFeatureRuntimeId
    ));
    const relatedAnchorIds = new Set(relatedAnchors.map(({ id }) => String(id)));
    const canonicalAnchorIds = [...new Set((blueprintFeatures?.anchorPositions ?? [])
      .filter((anchor) => (
        String(anchor.sourceFeatureId ?? anchor.localFeatureId ?? '') === localFeatureId
          && String(anchor.sourceFeatureRuntimeId ?? '') === sourceFeatureRuntimeId
      ))
      .map(({ id }) => String(id)))]
      .sort();
    const runtimeConsumerBindingIds = [...new Set(relatedAnchors
      .filter((anchor) => !canonicalAnchorIds.includes(String(anchor.id)))
      .filter(anchorIsActiveRuntimeConsumer)
      .map(({ id }) => String(id)))]
      .sort();
    const relatedTransfers = transfers.filter((transfer) => (
      String(transfer.localTransferId ?? '') === localFeatureId
        || String(transfer.sourceFeatureId ?? '') === localFeatureId
    ));
    const relatedTransferIds = new Set(relatedTransfers.flatMap((transfer) => [
      String(transfer.id),
      String(transfer.localTransferId ?? ''),
    ]).filter(Boolean));
    const physicalTransferBindingIds = [...new Set(relatedTransfers
      .filter((transfer) => String(transfer.localTransferId ?? '') === localFeatureId)
      .map(({ id }) => String(id)))]
      .sort();
    const relatedSourceIds = new Set([
      localFeatureId,
      sourceFeatureRuntimeId,
      ...realizedFeatures.flatMap((record) => [
        String(record.id),
        String(record.runtimeId ?? ''),
        String(record.collisionId ?? ''),
      ]),
      ...relatedAnchorIds,
      ...relatedTransferIds,
    ].filter(Boolean));
    const associatedCollisionRecordIds = new Set(realizedFeatures
      .map(({ collisionId }) => String(collisionId ?? ''))
      .filter((id) => id && collisionRecordIds.has(id)));
    for (const record of collisionRecords) {
      const recordId = String(record.id ?? '');
      const sourceId = String(record.sourceId ?? '');
      if (
        relatedSourceIds.has(sourceId)
        || relatedSourceIds.has(recordId)
        || (record.sourceKind === 'physical-transfer'
          && String(record.localTransferId ?? record.sourceId ?? '') === localFeatureId)
      ) {
        associatedCollisionRecordIds.add(recordId);
      }
    }

    const authoredFootprint = representative.authoredLocalFootprint
      ?? blueprintRecordFootprint(sourceFeature);
    const authoredMeters = representative.authoredFootprintMeters ?? {
      width: number(authoredFootprint.widthTiles, 1) * tileSize,
      height: featureType === 'cover' ? 1.2 : featureType === 'story' ? 0.035 : 3.6,
      depth: number(authoredFootprint.depthTiles, 1) * tileSize,
    };
    const worldMeters = representative.authoredWorldFootprintMeters ?? authoredMeters;
    const usesCommittedSolidPosition = ['cover', 'machine'].includes(featureType)
      && representative.blocking === true
      && Array.isArray(representative.occupiedSupportCellIds)
      && representative.occupiedSupportCellIds.length > 0
      && representative.supportKind === 'floor-tier-cell'
      && representative.supportFloorCellId != null;
    const position = clonePlainValue(
      usesCommittedSolidPosition
        ? representative.worldPosition ?? representative.position
        : representative.authoredWorldPosition
          ?? representative.worldPosition
          ?? representative.position,
    );
    const optional = featureType === 'story';
    const selectedForRendering = Boolean(contract.themeRole) && !optional;
    const ownerBindingIds = contract.presentationOwner === 'gameplay-runtime'
      ? canonicalAnchorIds
      : contract.presentationOwner === 'supplement-connector-assembler'
        ? physicalTransferBindingIds
        : [];
    if (contract.presentationOwner !== 'supplement-assembler') {
      assertSupplementContentContract(
        ownerBindingIds.length === 1,
        node,
        `blueprint feature ${localFeatureId} has ${ownerBindingIds.length} canonical ${contract.presentationOwner} owner bindings`,
      );
    }
    const runtimeActivation = contract.presentationOwner === 'gameplay-runtime'
      ? runtimeConsumerBindingIds.length > 0 ? 'active' : 'dormant'
      : optional
        ? 'optional-not-selected'
        : 'not-applicable';
    return {
      id: `${sourceFeatureRuntimeId}:presentation`,
      schema: INDUSTRIAL_SUPPLEMENT_PRESENTATION_RECORD_SCHEMA,
      roomId: node.id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      blueprintId: blueprint.id,
      sourceFeatureId: localFeatureId,
      sourceFeatureRuntimeId,
      sourceFeatureType: featureType,
      sourceFeature: clonePlainValue(sourceFeature),
      sourceRealizationIds: realizedFeatures.map(({ id }) => String(id)).sort(),
      collisionRecordIds: [...associatedCollisionRecordIds].sort(),
      transform: {
        position: clonePlainValue(position),
        rotationQuarterTurns: number(representative.authoredRotationQuarterTurns),
        rotationY: number(representative.authoredRotationY),
        scale: { x: 1, y: 1, z: 1 },
      },
      position: clonePlainValue(position),
      rotationY: number(representative.authoredRotationY),
      authoredFootprint: {
        coordinateSpace: 'blueprint-local-tiles',
        localTile: clonePlainValue(representative.authoredLocalTile),
        center: clonePlainValue(authoredFootprint.center),
        widthTiles: number(authoredFootprint.widthTiles, 1),
        depthTiles: number(authoredFootprint.depthTiles, 1),
        widthMeters: number(authoredMeters.width),
        heightMeters: number(authoredMeters.height),
        depthMeters: number(authoredMeters.depth),
      },
      worldFootprint: {
        coordinateSpace: 'world-meters-axis-aligned',
        widthMeters: number(worldMeters.width),
        heightMeters: number(worldMeters.height),
        depthMeters: number(worldMeters.depth),
      },
      widthMeters: number(authoredMeters.width),
      heightMeters: number(authoredMeters.height),
      depthMeters: number(authoredMeters.depth),
      semanticRole: contract.semanticRole,
      themeRole: contract.themeRole,
      presentationAssetRole: contract.themeRole,
      presentationOwner: contract.presentationOwner,
      realizationOwner: contract.presentationOwner,
      realizationKind: contract.realizationKind,
      ownerBindingIds,
      runtimeConsumerBindingIds,
      runtimeActivation,
      required: !optional,
      optional,
      nonblocking: optional,
      selectedForRendering,
      renderingRequired: selectedForRendering,
      // Every source presentation receives exactly one realization ledger
      // disposition. Optionality controls rendering, not audit coverage.
      realizationRequired: true,
      renderedBySupplementAssembler: selectedForRendering,
      presentationSurface: optional ? 'floor-flush-decal' : 'authored-volume',
      selectionStatus: optional ? 'pending-network-selection' : 'required',
      preservesAuthoritativeCollision: true,
      themeBinding: clonePlainValue(themeBinding),
      authoritative: true,
      preRender: true,
    };
  });
  assertSupplementContentContract(
    records.length === (blueprint.features ?? []).length
      && new Set(records.map(({ sourceFeatureId }) => sourceFeatureId)).size === records.length,
    node,
    'blueprint presentation records do not map source features one-to-one',
  );
  const delegatedOwnerBindings = records.flatMap((record) => (
    record.realizationOwner === 'supplement-assembler'
      ? []
      : record.ownerBindingIds.map((ownerBindingId) => (
        `${record.realizationOwner}:${ownerBindingId}`
      ))
  ));
  assertSupplementContentContract(
    delegatedOwnerBindings.length === new Set(delegatedOwnerBindings).size,
    node,
    'blueprint presentation records share delegated owner bindings',
  );
  return records;
}

function manifestRecipeRecords(anchors = []) {
  return anchors.flatMap((anchor) => [
    anchor.encounterRecipe,
    anchor.rewardRecipe,
    anchor.mechanismRecipe,
    anchor.hazardRecipe,
    anchor.discoveryRecipe,
  ].filter(Boolean).map((recipe) => ({
    recipeKind: anchor.recipeKind,
    recipeId: anchor.recipeId,
    catalogRecipeId: anchor.catalogRecipeId,
    recipeInstanceId: anchor.recipeInstanceId,
    runtimeStateId: anchor.runtimeStateId,
    anchorId: anchor.id,
    recipe: clonePlainValue(recipe),
  })));
}

function createSupplementRoom(node, tileSize, operation = null, {
  requireManifest = false,
  requireBlueprint = false,
  difficulty = 1,
} = {}) {
  const center = pointOf(node.placement?.center ?? node.center ?? node.position);
  const size = node.size ?? node.placement?.size ?? {};
  const rotationQuarterTurns = ((Math.trunc(number(node.placement?.rotationQuarterTurns)) % 4) + 4) % 4;
  const blueprintCanonicalRotationQuarterTurns =
    industrialSupplementBlueprintCanonicalTurns(node);
  const blueprintRotationQuarterTurns = (
    rotationQuarterTurns + blueprintCanonicalRotationQuarterTurns
  ) % 4;
  const swapsHorizontalAxes = rotationQuarterTurns % 2 === 1;
  const unrotatedWidth = size.x ?? size.width ?? size.widthMeters;
  const unrotatedDepth = size.z ?? size.depth ?? size.depthMeters;
  const realizedWidth = swapsHorizontalAxes ? unrotatedDepth : unrotatedWidth;
  const realizedDepth = swapsHorizontalAxes ? unrotatedWidth : unrotatedDepth;
  const operationIsRouteNetwork = isRouteNetworkOperation(operation);
  const blueprintId = industrialSupplementBlueprintId(node);
  const physicalBlueprint = blueprintId
    ? resolveIndustrialSupplementBlueprint(blueprintId)
    : null;
  if (blueprintId && !physicalBlueprint) {
    throw supplementContentContractError(
      node,
      `references unknown physical blueprint ${blueprintId}`,
    );
  }
  if (requireBlueprint) {
    validateIndustrialSupplementBlueprint({
      node,
      operation,
      blueprint: physicalBlueprint,
      tileSize,
    });
  } else if (physicalBlueprint) {
    validateIndustrialSupplementBlueprint({
      node,
      operation,
      blueprint: physicalBlueprint,
      tileSize,
    });
  }
  const moduleManifest = operationIsRouteNetwork && node.kind === 'supplementRoom'
    ? resolveIndustrialSupplementModuleManifest(physicalBlueprint ? {
      semanticModuleKind: industrialSupplementSemanticManifestId(node, physicalBlueprint),
      physicalModuleKind: node.moduleKind,
      contentRole: node.contentRole,
    } : {
      grammarId: node.grammarId,
      moduleKind: node.moduleKind,
      contentRole: node.contentRole,
    })
    : null;
  if (requireManifest) {
    validateIndustrialSupplementManifest({
      node,
      operation,
      manifest: moduleManifest,
      tileSize,
      physicalBlueprint,
    });
  }
  const themeBinding = node.themeBinding ?? operation?.themeBinding ?? null;
  const plannedAnchors = (node.anchors ?? []).map((anchor) => {
    const position = pointOf(anchor.position ?? anchor.worldPosition ?? anchor);
    const id = String(anchor.id ?? `${node.id}:planned-anchor:${stableIdPart(anchor.kind)}`);
    return {
      ...clonePlainValue(anchor),
      id,
      runtimeId: id,
      nodeId: node.id,
      operationId: operation?.id ?? nodeOperationId(node),
      moduleManifestId: moduleManifest?.id ?? null,
      blueprintId: physicalBlueprint?.id ?? null,
      position,
      worldPosition: clonePlainValue(position),
      grid: {
        x: Math.round(position.x / tileSize),
        z: Math.round(position.z / tileSize),
      },
      collisionId: `${id}:collision`,
      themeBinding: clonePlainValue(themeBinding),
    };
  });
  const manifestAnchors = createIndustrialSupplementManifestAnchors({
    node,
    operation,
    manifest: moduleManifest,
    center,
    rotationQuarterTurns,
    tileSize,
    difficulty,
    requireManifest,
    physicalBlueprint,
  });
  const physicalRotationQuarterTurns = physicalBlueprint
    ? blueprintRotationQuarterTurns
    : rotationQuarterTurns;
  const hasAuthoredPhysicalDefinition = Boolean(physicalBlueprint || moduleManifest);
  const floorTiers = hasAuthoredPhysicalDefinition ? realizeManifestFloorTiers({
    node,
    operation,
    manifest: moduleManifest,
    blueprint: physicalBlueprint,
    center,
    rotationQuarterTurns: physicalRotationQuarterTurns,
    tileSize,
    themeBinding,
  }) : [];
  const blueprintSocketRecords = physicalBlueprint ? realizeBlueprintSocketRecords({
    node,
    operation,
    blueprint: physicalBlueprint,
    center,
    rotationQuarterTurns: physicalRotationQuarterTurns,
    tileSize,
    themeBinding,
    floorTiers,
  }) : [];
  const blueprintStateRecords = physicalBlueprint
    ? realizeBlueprintStateRecords(node, physicalBlueprint)
    : [];
  const blueprintTransfers = physicalBlueprint ? realizeBlueprintTransfers({
    node,
    operation,
    blueprint: physicalBlueprint,
    center,
    rotationQuarterTurns: physicalRotationQuarterTurns,
    tileSize,
    themeBinding,
    floorTiers,
    stateRecords: blueprintStateRecords,
  }) : [];
  const blueprintFeatures = physicalBlueprint ? realizeBlueprintFeatureRecords({
    node,
    operation,
    blueprint: physicalBlueprint,
    center,
    rotationQuarterTurns: physicalRotationQuarterTurns,
    tileSize,
    themeBinding,
    floorTiers,
    transfers: blueprintTransfers,
    stateRecords: blueprintStateRecords,
  }) : { all: [], cover: [], landmarks: [], anchorPositions: [] };
  const blueprintZones = physicalBlueprint ? realizeBlueprintZones({
    node,
    operation,
    blueprint: physicalBlueprint,
    center,
    rotationQuarterTurns: physicalRotationQuarterTurns,
    tileSize,
    themeBinding,
    floorTiers,
    transfers: blueprintTransfers,
  }) : [];
  const blueprintVoids = physicalBlueprint ? realizeBlueprintVoids({
    node,
    operation,
    blueprint: physicalBlueprint,
    center,
    rotationQuarterTurns: physicalRotationQuarterTurns,
    tileSize,
    themeBinding,
  }) : [];
  const physicalManifestAnchors = physicalBlueprint
    ? relocateManifestAnchorsToBlueprint({
      node,
      manifestAnchors,
      blueprintAnchorPositions: blueprintFeatures.anchorPositions,
      blueprintZones,
      blueprintTransfers,
      tileSize,
      requireManifest,
    })
    : manifestAnchors;
  const presentationAnchors = plannedAnchors.filter((anchor) => (
    ['doorway-frame', 'light-fixture'].includes(String(anchor.kind ?? ''))
  ));
  const anchors = physicalBlueprint ? [
    ...presentationAnchors,
    ...blueprintFeatures.anchorPositions,
    ...physicalManifestAnchors,
  ] : moduleManifest ? [
    ...presentationAnchors,
    ...physicalManifestAnchors,
  ] : plannedAnchors;
  const zones = physicalBlueprint ? blueprintZones : moduleManifest ? realizeManifestZones({
    node,
    operation,
    manifest: moduleManifest,
    center,
    rotationQuarterTurns,
    tileSize,
    themeBinding,
    floorTiers,
  }) : [];
  const cover = physicalBlueprint ? blueprintFeatures.cover : moduleManifest ? realizeManifestPointRecords(
    moduleManifest.cover,
    'cover',
    {
      node,
      operation,
      manifest: moduleManifest,
      center,
      rotationQuarterTurns,
      tileSize,
      themeBinding,
    },
  ) : [];
  const landmarks = physicalBlueprint ? blueprintFeatures.landmarks : moduleManifest ? realizeManifestPointRecords(
    moduleManifest.landmarks,
    'landmark',
    {
      node,
      operation,
      manifest: moduleManifest,
      center,
      rotationQuarterTurns,
      tileSize,
      themeBinding,
    },
  ) : [];
  const lighting = physicalBlueprint ? [] : moduleManifest ? realizeManifestPointRecords(
    moduleManifest.lighting,
    'lighting',
    {
      node,
      operation,
      manifest: moduleManifest,
      center,
      rotationQuarterTurns,
      tileSize,
      themeBinding,
    },
  ) : [];
  const protectedSightlines = moduleManifest ? realizeManifestProtectedSightlines({
    node,
    operation,
    manifest: moduleManifest,
    center,
    rotationQuarterTurns,
    tileSize,
    themeBinding,
  }) : [];
  const authoredClearRoutes = physicalBlueprint ? realizeBlueprintClearRoutes({
    node,
    operation,
    blueprint: physicalBlueprint,
    themeBinding,
    floorTiers,
  }) : moduleManifest ? realizeManifestClearRoutes({
    node,
    operation,
    manifest: moduleManifest,
    floorTiers,
    zones,
    anchors,
    themeBinding,
  }) : [];
  const sectionClearRoute = physicalBlueprint?.sectionRoute?.length >= 2 ? {
    id: 'blueprint-section-route',
    localRouteId: 'blueprint-section-route',
    runtimeId: `${node.id}:blueprint-section-route`,
    roomId: node.id,
    nodeId: node.id,
    operationId: operation?.id ?? nodeOperationId(node),
    blueprintId: physicalBlueprint.id,
    floorTierIds: floorTiers.map(({ id }) => id),
    floorTierRuntimeIds: floorTiers.map(({ runtimeId }) => runtimeId),
    sectionRoute: physicalBlueprint.sectionRoute.map((point, ordinal) => {
      const resolved = sectionPoint(point, ordinal);
      return {
        ...resolved,
        worldElevation: number(center.y) + resolved.elevation,
      };
    }),
    worldCellIds: blueprintTransfers.flatMap(({ worldCells }) => (
      worldCells.map(({ id }) => id)
    )),
    worldConnectivityEdgeIds: [],
    minimumClearWidthTiles: 1,
    traversal: 'authored-blueprint-elevation-section',
    routeCollisionId: `${node.id}:blueprint-section-route:collision`,
    themeBinding: clonePlainValue(themeBinding),
    authoritative: true,
    preRender: true,
  } : null;
  const clearRoutes = sectionClearRoute
    ? [...authoredClearRoutes, sectionClearRoute]
    : authoredClearRoutes;
  const collisionRecords = hasAuthoredPhysicalDefinition ? createManifestCollisionRecords({
    node,
    operation,
    manifest: moduleManifest,
    blueprint: physicalBlueprint,
    floorTiers,
    zones,
    clearRoutes,
    cover,
    landmarks,
    lighting,
    anchors,
    transfers: blueprintTransfers,
    voids: blueprintVoids,
    socketRecords: blueprintSocketRecords,
    tileSize,
    themeBinding,
  }) : [];
  const presentationRecords = physicalBlueprint ? createBlueprintPresentationRecords({
    node,
    operation,
    blueprint: physicalBlueprint,
    blueprintFeatures,
    anchors,
    transfers: blueprintTransfers,
    collisionRecords,
    tileSize,
    themeBinding,
  }) : [];
  const recipeRecords = manifestRecipeRecords(anchors);
  const sourceStructure = clonePlainValue(node.structure ?? null);
  const highestFloorElevation = Math.max(
    0,
    ...floorTiers.map(({ localElevation }) => number(localElevation)),
  );
  const ceilingHeight = Math.max(
    5.6,
    highestFloorElevation + 3.6,
    number(size.y ?? size.height, 5.6),
  );
  const semanticStructuralQualityReport = moduleManifest
    ? inspectIndustrialSupplementManifestStructuralQuality(moduleManifest, {
      structure: node.structure,
      clearanceVolumes: node.clearanceVolumes,
    })
    : null;
  const structuralQualityReport = physicalBlueprint ? {
    accepted: semanticStructuralQualityReport?.accepted !== false,
    phase: 'authored-blueprint-realization',
    blueprintId: physicalBlueprint.id,
    blueprintSchema: physicalBlueprint.schema,
    semanticModuleManifestId: moduleManifest?.id ?? null,
    semanticManifestAccepted: semanticStructuralQualityReport?.accepted ?? null,
    errors: [...(semanticStructuralQualityReport?.errors ?? [])],
    metrics: {
      floorTierCount: floorTiers.length,
      floorCellCount: floorTiers.reduce((sum, tier) => sum + tier.worldCells.length, 0),
      socketCount: blueprintSocketRecords.length,
      routeCount: clearRoutes.length,
      zoneCount: zones.length,
      featureCount: blueprintFeatures.all.length,
      voidCount: blueprintVoids.length,
      transferCount: blueprintTransfers.length,
    },
  } : moduleManifest ? inspectIndustrialSupplementRealizedStructuralQuality({
      augmentationModuleManifest: moduleManifest,
      augmentationFloorMask: moduleManifest.floorMask,
      augmentationFloorTiers: floorTiers,
      augmentationClearRoutes: clearRoutes,
      augmentationZones: zones,
      augmentationCover: cover,
      augmentationLandmarks: landmarks,
      augmentationLighting: lighting,
      augmentationAnchors: anchors,
      augmentationStructure: { sourceStructure },
      ceilingHeight,
    }, {
      clearanceVolumes: node.clearanceVolumes,
    })
    : null;
  if (hasAuthoredPhysicalDefinition) {
    assertSupplementContentContract(
      structuralQualityReport.accepted,
      node,
      `failed realized structural-quality acceptance: ${structuralQualityReport.errors.join(', ')}`,
    );
  }
  const structureMetadata = hasAuthoredPhysicalDefinition ? {
    id: `${node.id}:structure-metadata`,
    roomId: node.id,
    nodeId: node.id,
    operationId: operation?.id ?? nodeOperationId(node),
    profileId: moduleManifest?.profileId ?? INDUSTRIAL_SUPPLEMENT_V4_PROFILE_ID,
    grammarId: node.grammarId,
    grammarRevision: node.grammarRevision ?? null,
    moduleTemplateId: node.moduleTemplateId ?? physicalBlueprint?.id ?? node.grammarId ?? null,
    physicalModuleKind: node.moduleKind ?? null,
    contentRole: node.contentRole ?? null,
    moduleManifestId: moduleManifest?.id ?? null,
    moduleManifestSchema: moduleManifest?.schema ?? null,
    blueprintId: physicalBlueprint?.id ?? null,
    blueprintSchema: physicalBlueprint?.schema ?? null,
    blueprintCanonicalRotationQuarterTurns,
    blueprintWorldRotationQuarterTurns: physicalBlueprint
      ? blueprintRotationQuarterTurns
      : null,
    physicalRealizationId: `${node.id}:physical-realization`,
    coordinateSpace: physicalBlueprint
      ? 'authored-blueprint-local-tiles-with-world-projection'
      : 'manifest-local-tiles-with-world-projection',
    structuralQualityReport: clonePlainValue(structuralQualityReport),
    themeBinding: clonePlainValue(themeBinding),
    authoritative: true,
    preRender: true,
  } : null;
  const physicalFloorMask = physicalBlueprint?.baseMask
    ?? physicalBlueprint?.mask
    ?? moduleManifest?.floorMask
    ?? null;
  const augmentationStructure = hasAuthoredPhysicalDefinition ? {
    ...(sourceStructure ?? {}),
    ...clonePlainValue(structureMetadata),
    id: sourceStructure?.id ?? `${node.id}:structure`,
    runtimeId: `${node.id}:structure`,
    structureMetadata: clonePlainValue(structureMetadata),
    structuralQualityReport: clonePlainValue(structuralQualityReport),
    sourceStructure: clonePlainValue(sourceStructure),
    blueprintId: physicalBlueprint?.id ?? null,
    blueprintSchema: physicalBlueprint?.schema ?? null,
    floorMask: clonePlainValue(physicalFloorMask),
    floorTiers: clonePlainValue(floorTiers),
    clearRoutes: clonePlainValue(clearRoutes),
    zones: clonePlainValue(zones),
    cover: clonePlainValue(cover),
    landmarks: clonePlainValue(landmarks),
    lighting: clonePlainValue(lighting),
    protectedSightlines: clonePlainValue(protectedSightlines),
    sockets: clonePlainValue(blueprintSocketRecords),
    transfers: clonePlainValue(blueprintTransfers),
    features: clonePlainValue(blueprintFeatures.all),
    voids: clonePlainValue(blueprintVoids),
    stateRecords: clonePlainValue(blueprintStateRecords),
    collisionRecords: clonePlainValue(collisionRecords),
    presentationRecords: clonePlainValue(presentationRecords),
    anchorRecords: clonePlainValue(anchors),
    recipeRecords: clonePlainValue(recipeRecords),
  } : node.structure ?? null;
  const physicalRealization = hasAuthoredPhysicalDefinition ? {
    id: `${node.id}:physical-realization`,
    schema: 'ruindivex-industrial-supplement-physical-realization/v1',
    roomId: node.id,
    nodeId: node.id,
    operationId: operation?.id ?? nodeOperationId(node),
    profileId: moduleManifest?.profileId ?? INDUSTRIAL_SUPPLEMENT_V4_PROFILE_ID,
    moduleManifestId: moduleManifest?.id ?? null,
    moduleManifestSchema: moduleManifest?.schema ?? null,
    blueprintId: physicalBlueprint?.id ?? null,
    blueprintSchema: physicalBlueprint?.schema ?? null,
    blueprintCanonicalRotationQuarterTurns,
    blueprintWorldRotationQuarterTurns: physicalBlueprint
      ? blueprintRotationQuarterTurns
      : null,
    grammarId: node.grammarId,
    contentRole: node.contentRole,
    floorMask: clonePlainValue(physicalFloorMask),
    floorTiers: clonePlainValue(floorTiers),
    clearRoutes: clonePlainValue(clearRoutes),
    zones: clonePlainValue(zones),
    cover: clonePlainValue(cover),
    landmarks: clonePlainValue(landmarks),
    lighting: clonePlainValue(lighting),
    protectedSightlines: clonePlainValue(protectedSightlines),
    anchors: clonePlainValue(anchors),
    socketRecords: clonePlainValue(blueprintSocketRecords),
    sockets: clonePlainValue(blueprintSocketRecords),
    transfers: clonePlainValue(blueprintTransfers),
    features: clonePlainValue(blueprintFeatures.all),
    voids: clonePlainValue(blueprintVoids),
    stateRecords: clonePlainValue(blueprintStateRecords),
    localStateIds: blueprintStateRecords.map(({ localStateId }) => localStateId),
    stateIds: blueprintStateRecords.map(({ runtimeStateId }) => runtimeStateId),
    collisionRecords: clonePlainValue(collisionRecords),
    presentationRecords: clonePlainValue(presentationRecords),
    recipeRecords: clonePlainValue(recipeRecords),
    structureMetadata: clonePlainValue(structureMetadata),
    structuralQualityReport: clonePlainValue(structuralQualityReport),
    stableRuntimeStateIds: clonePlainValue(
      operation?.stableRuntimeStateIds ?? node.stableRuntimeStateIds ?? {},
    ),
    themeBinding: clonePlainValue(themeBinding),
    authoritative: true,
    preRender: true,
  } : null;
  const nodeJunction = node.junction ?? node.junctionContract ?? null;
  const connectedSocketIds = (node.sockets ?? [])
    .filter((socket) => ['connected', 'paired', 'used', 'open'].includes(
      String(socket.state ?? socket.status ?? ''),
    ) || socket.segmentId || socket.connectionId)
    .map((socket) => String(socket.id));
  const activeSocketIds = Array.isArray(nodeJunction?.activeSocketIds)
    ? [...new Set(nodeJunction.activeSocketIds.map(String))]
    : connectedSocketIds;
  const generatedJunction = nodeJunction
    ? createDungeonJunctionGeometryRecord({
      id: nodeJunction.id ?? `${node.id}:junction`,
      nodeId: node.id,
      junctionKind: nodeJunction.junctionKind ?? node.junctionKind,
      center,
      elevation: center.y,
      heightMeters: nodeJunction.clearanceHeightMeters ?? 3.6,
      tileSize,
      throughSocketPairs: nodeJunction.throughSocketPairs,
      decisionSocketIds: nodeJunction.decisionSocketIds,
      activeSocketIds,
      operationId: nodeOperationId(node),
      accessDomainId: node.accessDomainId ?? operation?.accessDomainId,
      progressionBandId: node.progressionBandId ?? operation?.progressionBandId,
    })
    : null;
  const junction = generatedJunction ? {
    ...clonePlainValue(nodeJunction),
    ...generatedJunction,
    clearCoreVolume: clonePlainValue(
      nodeJunction.clearCoreVolume ?? generatedJunction.clearCoreVolume,
    ),
    countsAsMeaningfulStation: nodeJunction.countsAsMeaningfulStation
      ?? node.countsAsMeaningfulStation
      ?? generatedJunction.countsAsMeaningfulStation,
  } : null;
  const manifestDimensions = moduleManifest?.layout?.dimensionsTiles ?? null;
  const manifestWidth = manifestDimensions
    ? Number(swapsHorizontalAxes ? manifestDimensions.depth : manifestDimensions.width)
    : null;
  const manifestDepth = manifestDimensions
    ? Number(swapsHorizontalAxes ? manifestDimensions.width : manifestDimensions.depth)
    : null;
  const blueprintDimensions = physicalBlueprint?.dimensionsTiles ?? null;
  const blueprintSwapsWorldAxes = blueprintRotationQuarterTurns % 2 === 1;
  const blueprintWidth = blueprintDimensions
    ? Number(blueprintSwapsWorldAxes ? blueprintDimensions.depth : blueprintDimensions.width)
    : null;
  const blueprintDepth = blueprintDimensions
    ? Number(blueprintSwapsWorldAxes ? blueprintDimensions.width : blueprintDimensions.depth)
    : null;
  return {
    id: String(node.id),
    kind: node.kind ?? 'supplementRoom',
    type: 'supplement',
    tileType: 'floor',
    x: Math.round(center.x / tileSize),
    z: Math.round(center.z / tileSize),
    width: blueprintWidth ?? manifestWidth ?? oddTileSpan(realizedWidth, tileSize),
    depth: blueprintDepth ?? manifestDepth ?? oddTileSpan(realizedDepth, tileSize),
    plannedBaseElevation: center.y,
    baseElevation: center.y,
    ceilingHeight,
    archetype: 'supplement',
    archetypeId: node.grammarId ?? node.moduleId ?? 'dungeon-supplement',
    purpose: physicalBlueprint?.purpose ?? moduleManifest?.purpose ?? (
      operationIsRouteNetwork
        ? operation.routeNetworkKind ?? operation.networkRole ?? 'supplement_route_network'
        : node.topology ?? 'optional_exploration'
    ),
    mood: hasAuthoredPhysicalDefinition
      ? 'industrial_authored_supplement'
      : 'inherited_parent_region',
    environmentalStory: physicalBlueprint?.gameplay
      ?? physicalBlueprint?.traversal
      ?? moduleManifest?.story
      ?? null,
    exitSockets: [],
    augmentationNodeId: node.id,
    augmentationOperationId: nodeOperationId(node),
    augmentationThemeBinding: clonePlainValue(themeBinding),
    augmentationAnchors: anchors,
    augmentationStructure,
    augmentationStructureMetadata: clonePlainValue(structureMetadata),
    augmentationStructuralQualityReport: clonePlainValue(structuralQualityReport),
    augmentationPhysicalRealization: physicalRealization,
    augmentationCollisionRecords: collisionRecords,
    augmentationPresentationRecords: presentationRecords,
    augmentationRecipeRecords: recipeRecords,
    augmentationModuleTemplateId: node.moduleTemplateId
      ?? physicalBlueprint?.id
      ?? node.grammarId
      ?? null,
    augmentationModuleKind: moduleManifest?.moduleKind ?? node.moduleKind ?? null,
    augmentationPhysicalModuleKind: node.moduleKind ?? null,
    augmentationModuleManifest: clonePlainValue(moduleManifest),
    augmentationBlueprintId: physicalBlueprint?.id ?? null,
    augmentationBlueprintSchema: physicalBlueprint?.schema ?? null,
    augmentationBlueprint: clonePlainValue(physicalBlueprint),
    augmentationFloorMask: clonePlainValue(physicalFloorMask),
    augmentationFloorTiers: floorTiers,
    augmentationSocketRecords: blueprintSocketRecords,
    augmentationTransfers: blueprintTransfers,
    augmentationBlueprintFeatures: blueprintFeatures.all,
    augmentationVoids: blueprintVoids,
    augmentationBlueprintStateRecords: blueprintStateRecords,
    augmentationBlueprintStateIds: blueprintStateRecords.map(({ runtimeStateId }) => (
      runtimeStateId
    )),
    augmentationClearRoutes: clearRoutes,
    augmentationZones: zones,
    augmentationCover: cover,
    augmentationLandmarks: landmarks,
    augmentationLighting: lighting,
    augmentationProtectedSightlines: protectedSightlines,
    augmentationRotationQuarterTurns: physicalRotationQuarterTurns,
    augmentationPlacementRotationQuarterTurns: rotationQuarterTurns,
    augmentationBlueprintCanonicalRotationQuarterTurns:
      blueprintCanonicalRotationQuarterTurns,
    augmentationPhysicalRotationQuarterTurns: physicalRotationQuarterTurns,
    ...(junction ? {
      augmentationJunction: junction,
      junctionKind: junction.junctionKind ?? null,
      countsAsMeaningfulStation: junction.countsAsMeaningfulStation
        ?? node.countsAsMeaningfulStation
        ?? false,
    } : {}),
    ...(operationIsRouteNetwork ? {
      augmentationOperationType: 'routeNetwork',
      augmentationGrantId: operation.grantId ?? null,
      augmentationNetworkRole: node.networkRole ?? node.contentRole ?? operation.networkRole ?? null,
      augmentationContentRole: node.contentRole ?? node.networkRole ?? null,
      augmentationTopologyTemplateId: node.topologyTemplateId
        ?? operation.topologyTemplateId
        ?? null,
      augmentationAccessDomainId: node.accessDomainId ?? operation.accessDomainId ?? null,
      augmentationProgressionBandId: node.progressionBandId
        ?? operation.progressionBandId
        ?? null,
      augmentationStableRuntimeStateIds: clonePlainValue(
        operation.stableRuntimeStateIds ?? node.stableRuntimeStateIds ?? {},
      ),
    } : {}),
    isDungeonSupplement: true,
  };
}

function createSupplementConnectorJunctionProxy(
  node,
  tileSize,
  operation = null,
  options = {},
) {
  const proxy = createSupplementRoom(node, tileSize, operation, options);
  const connectorKind = node.kind === 'supplementConnectorModule'
    ? 'supplementConnectorModule'
    : 'supplementConnectorJunction';
  const exactParentStationComposite = node.exactParentEndpoint === true
    && node.parentEndpointSocketKind === 'authored-corridor-station'
    && Number(node.parentThroughRouteDegreeContribution ?? 0) === 1;
  const minimumPhysicalArmCount = connectorKind === 'supplementConnectorJunction'
    ? (exactParentStationComposite ? 2 : 3)
    : 2;
  return {
    ...proxy,
    kind: connectorKind,
    archetype: 'supplement-connector-junction',
    archetypeId: node.grammarId ?? node.moduleId ?? 'dungeon-supplement-connector-junction',
    purpose: 'supplement_connector_junction',
    augmentationAnchors: (proxy.augmentationAnchors ?? []).filter((anchor) => {
      const kind = String(anchor.kind ?? anchor.type ?? anchor.anchorKind ?? '');
      return ![
        'encounter', 'enemyEncounter', 'enemySpawn', 'spawn',
        'reward', 'chest', 'mechanism', 'control', 'terminal',
        'door', 'gate', 'keycard', 'progressionKey', 'progression', 'objective',
        'platform', 'trap', 'hazard', 'environmentalHazard', 'safeInteractable',
      ].includes(kind);
    }),
    connectorJunctionSockets: clonePlainValue(node.sockets ?? []),
    isDungeonSupplement: false,
    isSupplementConnectorJunction: connectorKind === 'supplementConnectorJunction',
    isSupplementConnectorModule: connectorKind === 'supplementConnectorModule',
    isConnectorJunctionProxy: true,
    suppressRoomGeometry: true,
    stampConnectorJunctionFloor: true,
    countsAsMeaningfulStation: connectorKind === 'supplementConnectorJunction',
    exactParentEndpoint: node.exactParentEndpoint === true,
    parentEndpointSocketId: node.parentEndpointSocketId ?? null,
    parentEndpointSocketKind: node.parentEndpointSocketKind ?? null,
    parentThroughRouteDegreeContribution: Number(
      node.parentThroughRouteDegreeContribution ?? 0,
    ),
    parentThroughPhysicalArmId: node.parentThroughPhysicalArmId ?? null,
    isExactParentStationComposite: exactParentStationComposite,
    minimumPhysicalArmCount,
    minimumPhysicalConnectorArms: minimumPhysicalArmCount,
  };
}

function createConnectorJunctionProgressionCandidates({
  nodes = [],
  segments = [],
  connectorOnlyParentAnchoredProjection = {
    proxyIds: new Set(),
    collapseRoomIdBySegmentId: new Map(),
  },
} = {}) {
  const connectorIds = new Set(nodes
    .filter(isSupplementConnectorJunctionNode)
    .map(({ id }) => String(id)));
  const roomIds = new Set(nodes
    .filter((node) => !isSupplementConnectorJunctionNode(node))
    .map(({ id }) => String(id)));
  const adjacency = new Map();
  const physicalArmIdsByProxyId = new Map([...connectorIds].map((id) => [id, new Set()]));
  const connect = (fromId, toId) => {
    if (!fromId || !toId) return;
    const from = String(fromId);
    const to = String(toId);
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };
  for (const [segmentOrdinal, segment] of segments.entries()) {
    const fromId = endpointNodeId(endpointOf(segment, 'from'));
    const toId = endpointNodeId(endpointOf(segment, 'to'));
    connect(fromId, toId);
    connect(toId, fromId);
    const segmentId = String(segment.id ?? `segment:${segmentOrdinal}`);
    if (connectorIds.has(String(fromId))) physicalArmIdsByProxyId.get(String(fromId)).add(segmentId);
    if (connectorIds.has(String(toId))) physicalArmIdsByProxyId.get(String(toId)).add(segmentId);
  }
  // A host corridor station is a physical through route. Its one overlay
  // attachment edge represents one parent arm; the authored continuation is
  // the third arm that makes the supplemental branch a real T junction.
  for (const node of nodes) {
    const nodeId = String(node?.id ?? '');
    if (!connectorIds.has(nodeId)
      || node?.exactParentEndpoint !== true
      || node?.parentEndpointSocketKind !== 'authored-corridor-station') continue;
    const contribution = Math.min(
      1,
      Math.max(0, Number(node?.parentThroughRouteDegreeContribution ?? 0)),
    );
    for (let index = 0; index < contribution; index += 1) {
      // Current planner nodes carry the exact synthetic physical-arm identity
      // used by their realized degree and junction records. Older overlay
      // fixtures did not serialize that field, so retain their established ID
      // as a compatibility fallback instead of rewriting replay identities.
      physicalArmIdsByProxyId.get(nodeId).add(String(
        node.parentThroughPhysicalArmId ?? `${nodeId}:authored-through:${index}`,
      ));
    }
  }

  const candidatesByProxyId = new Map();
  const errors = [];
  for (const proxyId of [...connectorIds].sort()) {
    const queue = [{ id: proxyId, distance: 0 }];
    const visited = new Set([proxyId]);
    const candidates = [];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const neighborId of [...(adjacency.get(current.id) ?? [])].sort()) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const distance = current.distance + 1;
        if (roomIds.has(neighborId)) {
          candidates.push({ roomId: neighborId, distance });
        } else if (connectorIds.has(neighborId)) {
          queue.push({ id: neighborId, distance });
        }
      }
    }
    candidates.sort((left, right) => (
      left.distance - right.distance || left.roomId.localeCompare(right.roomId)
    ));
    candidatesByProxyId.set(proxyId, candidates);
    const node = nodes.find(({ id }) => String(id) === proxyId);
    const minimumPhysicalArmCount = node?.kind === 'supplementConnectorJunction' ? 3 : 2;
    const physicalArmCount = physicalArmIdsByProxyId.get(proxyId)?.size ?? 0;
    if (physicalArmCount < minimumPhysicalArmCount) {
      errors.push(
        `Connector proxy ${proxyId} has ${physicalArmCount} physical arms; ${minimumPhysicalArmCount} are required.`,
      );
    }
    if (candidates.length === 0
      && !connectorOnlyParentAnchoredProjection.proxyIds.has(proxyId)) {
      errors.push(`Connector junction proxy ${proxyId} cannot reach a substantive supplemental room.`);
    }
  }
  return {
    candidatesByProxyId,
    physicalArmIdsByProxyId,
    collapseRoomIdBySegmentId:
      connectorOnlyParentAnchoredProjection.collapseRoomIdBySegmentId,
    errors,
  };
}

function selectProgressionCandidate(candidates = [], excludedRoomId = null) {
  return candidates.find(({ roomId }) => roomId !== excludedRoomId)
    ?? candidates[0]
    ?? null;
}

function selectProgressionCandidatePair(fromCandidates = [], toCandidates = []) {
  const pairs = [];
  for (const from of fromCandidates) {
    for (const to of toCandidates) {
      pairs.push({ from, to, selfEdge: from.roomId === to.roomId });
    }
  }
  pairs.sort((left, right) => (
    Number(left.selfEdge) - Number(right.selfEdge)
      || left.from.distance + left.to.distance - right.from.distance - right.to.distance
      || left.from.distance - right.from.distance
      || left.to.distance - right.to.distance
      || left.from.roomId.localeCompare(right.from.roomId)
      || left.to.roomId.localeCompare(right.to.roomId)
  ));
  return pairs[0] ?? null;
}

function applyConnectorJunctionProgressionHints(
  plan,
  candidatesByProxyId,
  collapseRoomId = null,
) {
  const fromProxyId = candidatesByProxyId.has(String(plan.fromRoomId))
    ? String(plan.fromRoomId)
    : null;
  const toProxyId = candidatesByProxyId.has(String(plan.toRoomId))
    ? String(plan.toRoomId)
    : null;
  let fromProgressionRoomId = collapseRoomId
    ?? plan.progressionFromRoomId
    ?? plan.fromRoomId;
  let toProgressionRoomId = collapseRoomId
    ?? plan.progressionToRoomId
    ?? plan.toRoomId;

  if (collapseRoomId) {
    plan.routeNetworkProgressionProjectionMode =
      'parent-anchored-component-physical-only';
  } else if (fromProxyId && toProxyId) {
    const pair = selectProgressionCandidatePair(
      candidatesByProxyId.get(fromProxyId),
      candidatesByProxyId.get(toProxyId),
    );
    fromProgressionRoomId = pair?.from.roomId ?? fromProgressionRoomId;
    toProgressionRoomId = pair?.to.roomId ?? toProgressionRoomId;
  } else if (fromProxyId) {
    fromProgressionRoomId = selectProgressionCandidate(
      candidatesByProxyId.get(fromProxyId),
      toProgressionRoomId,
    )?.roomId ?? fromProgressionRoomId;
  } else if (toProxyId) {
    toProgressionRoomId = selectProgressionCandidate(
      candidatesByProxyId.get(toProxyId),
      fromProgressionRoomId,
    )?.roomId ?? toProgressionRoomId;
  }

  plan.progressionFromRoomId = fromProgressionRoomId;
  plan.progressionToRoomId = toProgressionRoomId;
  plan.progressionCollapsedSelfEdge = fromProgressionRoomId === toProgressionRoomId;
  if (plan.fromSocket) {
    plan.fromSocket.progressionRoomId = fromProgressionRoomId;
    if (fromProxyId) plan.fromSocket.connectorJunctionProxyId = fromProxyId;
  }
  if (plan.toSocket) {
    plan.toSocket.progressionRoomId = toProgressionRoomId;
    if (toProxyId) plan.toSocket.connectorJunctionProxyId = toProxyId;
  }
  return plan;
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

function clonePlainValue(value, active = new WeakMap(), path = '$') {
  if (!value || typeof value !== 'object') return value;
  const firstPath = active.get(value);
  if (firstPath) {
    throw new TypeError(
      `Industrial supplement plain-data cycle at ${path}; first seen at ${firstPath}.`,
    );
  }
  active.set(value, path);
  const cloned = Array.isArray(value)
    ? value.map((child, index) => clonePlainValue(child, active, `${path}[${index}]`))
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      clonePlainValue(child, active, `${path}.${key}`),
    ]));
  active.delete(value);
  return cloned;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function connectionPlanSnapshotSource(plan) {
  if (!Array.isArray(plan?.ladderContracts)) return plan;
  return {
    ...plan,
    ladderContracts: plan.ladderContracts.map((contract) => {
      if (!contract || typeof contract !== 'object') return contract;
      // DungeonGenerator attaches the live Three.js ladder group to the
      // accepted traversal descriptor. That object owns child/parent cycles
      // and is presentation state, not part of the immutable authored-plan
      // snapshot. Keep it on the effective runtime plan while omitting it from
      // the diagnostic/replay snapshot copied below.
      const snapshotContract = { ...contract };
      delete snapshotContract.object;
      return snapshotContract;
    }),
  };
}

function immutableConnectionPlanSnapshot(plan) {
  return deepFreeze(clonePlainValue(connectionPlanSnapshotSource(plan)));
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
  sourceEndpoint = null,
  exactSocketBinding = false,
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
    ...(exactSocketBinding ? {
      sourceSocketId: sourceEndpoint?.socketId ?? sourceEndpoint?.id ?? id,
      attachmentSocketId: sourceEndpoint?.kind === 'parentSocket'
        ? sourceEndpoint?.socketId ?? sourceEndpoint?.id ?? null
        : null,
      exactSocketBinding: true,
      routeNetworkGrantId: sourceEndpoint?.routeNetworkGrantId ?? null,
      routeNetworkSocketKind: sourceEndpoint?.routeNetworkSocketKind ?? null,
      parentRouteId: sourceEndpoint?.parentRouteId ?? null,
      progressionRoomId: sourceEndpoint?.sourceParentNodeId ?? roomId,
      // Progression collapsing may later retarget progressionRoomId from a
      // connector proxy to a substantive room. Preserve the exact physical
      // owner used by the accepted endpoint seam independently of that graph
      // facade so runtime seam validation cannot drift after materialization.
      authoritativeSeamNodeId: sourceEndpoint?.sourceParentNodeId ?? roomId,
      connectorJunctionProxyId: sourceEndpoint?.routeNetworkSocketKind
        === 'authored-corridor-station'
        ? roomId
        : null,
      grantedWorldPosition: pointOf(sourceEndpoint?.position ?? sourceEndpoint),
      grantedGridPosition: {
        x: number(sourceEndpoint?.position?.x ?? sourceEndpoint?.x) / tileSize,
        z: number(sourceEndpoint?.position?.z ?? sourceEndpoint?.z) / tileSize,
      },
    } : {}),
    roomId,
    role,
    x: point.x,
    z: point.z,
    level: 0,
    elevation,
    facingX: directionX,
    facingZ: directionZ,
    connectorType: 'ground_corridor',
    landingWidth: number(
      sourceEndpoint?.landingWidth
        ?? sourceEndpoint?.widthMeters
        ?? (sourceEndpoint?.landingWidthTiles == null
          ? undefined
          : number(sourceEndpoint.landingWidthTiles) * tileSize),
      tileSize * 3,
    ),
    clearanceHeight: number(
      sourceEndpoint?.clearanceHeight
        ?? sourceEndpoint?.clearanceHeightMeters
        ?? sourceEndpoint?.heightMeters,
      3.6,
    ),
    floorKey: `${point.x},${point.z}@y${Number(elevation).toFixed(3)}`,
  };
}

function v4TraversalFloorKey(x, z, elevation) {
  return `${Number(x)},${Number(z)}@y${Number(elevation).toFixed(3)}`;
}

function createV4AuthoritativeLevelTraversalSpine(plan, segment) {
  const path = plan.bridgePath ?? plan.fullPath ?? [];
  const [fromSeam, toSeam] = plan.endpointSeams ?? [];
  for (const [role, seam] of [['from', fromSeam], ['to', toSeam]]) {
    const latticeInspection = inspectDungeonRouteEndpointSeamGridLattice(seam);
    if (!latticeInspection.accepted) {
      throw connectorSpineMaterializationError(
        segment,
        V4_CONNECTOR_SPINE_DIAGNOSTICS.SEAM_GRID_LATTICE_INVALID,
        `${role} endpoint seam has a malformed grid lattice`,
        { role, ...latticeInspection },
      );
    }
  }
  const seamCenterCell = (seam, signedDepthTiles) => (
    (seam?.orderedCells ?? []).find((cell) => (
      Number(cell.lane) === 0
        && Number(cell.signedDepthTiles) === signedDepthTiles
    )) ?? null
  );
  const expectedLead = (seam, depths) => depths.map((signedDepthTiles) => {
    const cell = seamCenterCell(seam, signedDepthTiles);
    return cell ? { x: Number(cell.gridX), z: Number(cell.gridZ), cell } : null;
  });
  const fromLead = expectedLead(fromSeam, [0, 1, 2]);
  const toLead = expectedLead(toSeam, [2, 1, 0]);
  const leadMatches = (actual, expected) => Boolean(
    actual
      && expected
      && Number(actual.x) === expected.x
      && Number(actual.z) === expected.z
  );
  if (fromLead.some((expected, index) => !leadMatches(path[index], expected))) {
    throw connectorSpineMaterializationError(
      segment,
      V4_CONNECTOR_SPINE_DIAGNOSTICS.WRONG_SEAM_SIDE,
      'authoritative path does not leave its from socket through both exterior seam cells',
      {
        role: 'from',
        seamId: fromSeam?.id ?? null,
        expectedGridPath: fromLead.map((entry) => entry == null
          ? null
          : ({ x: entry.x, z: entry.z })),
        actualGridPath: path.slice(0, 3).map(({ x, z }) => ({ x, z })),
      },
    );
  }
  const toOffset = path.length - toLead.length;
  if (toOffset < 0 || toLead.some((expected, index) => (
    !leadMatches(path[toOffset + index], expected)
  ))) {
    throw connectorSpineMaterializationError(
      segment,
      V4_CONNECTOR_SPINE_DIAGNOSTICS.WRONG_SEAM_SIDE,
      'authoritative path does not enter its to socket through both exterior seam cells',
      {
        role: 'to',
        seamId: toSeam?.id ?? null,
        expectedGridPath: toLead.map((entry) => entry == null
          ? null
          : ({ x: entry.x, z: entry.z })),
        actualGridPath: path.slice(Math.max(0, path.length - 3)).map(({ x, z }) => ({ x, z })),
      },
    );
  }

  const sourceElevation = Number(plan.sourceElevation ?? plan.elevation ?? 0);
  const destinationElevation = Number(plan.destinationElevation ?? sourceElevation);
  if (!Number.isFinite(sourceElevation)
    || !Number.isFinite(destinationElevation)
    || Math.abs(destinationElevation - sourceElevation) > CONNECTOR_ELEVATION_EPSILON) {
    throw connectorSpineMaterializationError(
      segment,
      V4_CONNECTOR_SPINE_DIAGNOSTICS.MISSING_CENTERLINE_FLOOR,
      'level connector spine has no single authoritative floor elevation',
      { sourceElevation, destinationElevation },
    );
  }

  const seamCellsByGridKey = new Map();
  for (const seam of [fromSeam, toSeam]) {
    for (const cell of seam?.orderedCells ?? []) {
      if (Number(cell.lane) !== 0) continue;
      const key = `${Number(cell.gridX)},${Number(cell.gridZ)}`;
      const records = seamCellsByGridKey.get(key) ?? [];
      records.push({
        seamId: String(seam.id),
        seamCellId: String(cell.id),
        side: String(cell.side),
        signedDepthTiles: Number(cell.signedDepthTiles),
      });
      seamCellsByGridKey.set(key, records);
    }
  }
  const orderedCells = path.map((point, ordinal) => {
    const x = Number(point?.x);
    const z = Number(point?.z);
    if (!Number.isInteger(x) || !Number.isInteger(z)) {
      throw connectorSpineMaterializationError(
        segment,
        V4_CONNECTOR_SPINE_DIAGNOSTICS.MISSING_CENTERLINE_FLOOR,
        `authoritative centerline cell ${ordinal} has no exact grid identity`,
        { ordinal, point: clonePlainValue(point) },
      );
    }
    const seamCells = seamCellsByGridKey.get(`${x},${z}`) ?? [];
    const floorKey = v4TraversalFloorKey(x, z, sourceElevation);
    return {
      id: `${plan.id}:authoritative-centerline-floor:${ordinal}`,
      ordinal,
      grid: { x, z },
      elevation: sourceElevation,
      floorKey,
      ownerId: String(plan.id),
      ownerKind: 'connector-segment',
      seamCellIds: seamCells.map(({ seamCellId }) => seamCellId),
      seamIds: [...new Set(seamCells.map(({ seamId }) => seamId))],
      supportKind: seamCells.length > 0
        ? 'endpoint-seam-floor'
        : 'connector-centerline-floor',
      required: true,
      walkableIntent: true,
    };
  });

  const outgoing = new Map(orderedCells.map(({ id }) => [id, new Set()]));
  for (let index = 1; index < orderedCells.length; index += 1) {
    const previous = orderedCells[index - 1];
    const current = orderedCells[index];
    const distance = Math.abs(current.grid.x - previous.grid.x)
      + Math.abs(current.grid.z - previous.grid.z);
    if (distance !== 1) {
      const step = {
        x: Math.sign(current.grid.x - previous.grid.x),
        z: Math.sign(current.grid.z - previous.grid.z),
      };
      const firstMissingGrid = distance > 1 && Math.abs(step.x) + Math.abs(step.z) === 1
        ? { x: previous.grid.x + step.x, z: previous.grid.z + step.z }
        : null;
      throw connectorSpineMaterializationError(
        segment,
        V4_CONNECTOR_SPINE_DIAGNOSTICS.MISSING_CENTERLINE_FLOOR,
        `authoritative centerline has no floor between ordinals ${index - 1} and ${index}`,
        {
          fromFloorKey: previous.floorKey,
          toFloorKey: current.floorKey,
          firstMissingFloorKey: firstMissingGrid
            ? v4TraversalFloorKey(firstMissingGrid.x, firstMissingGrid.z, sourceElevation)
            : null,
        },
      );
    }
    outgoing.get(previous.id).add(current.id);
    // Ordinary gallery floors have no one-way traversal semantics. Build the
    // reverse edge explicitly so precommit validates the return route rather
    // than inferring it from a successful source-to-destination search.
    outgoing.get(current.id).add(previous.id);
  }
  const reachable = (startId, adjacency) => {
    const visited = new Set(startId ? [startId] : []);
    const queue = startId ? [startId] : [];
    for (let index = 0; index < queue.length; index += 1) {
      for (const nextId of adjacency.get(queue[index]) ?? []) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        queue.push(nextId);
      }
    }
    return visited;
  };
  const sourceCellId = orderedCells[0]?.id ?? null;
  const destinationCellId = orderedCells.at(-1)?.id ?? null;
  const forwardReachable = reachable(sourceCellId, outgoing);
  const reverseReachable = reachable(destinationCellId, outgoing);
  if (!destinationCellId || !forwardReachable.has(destinationCellId)) {
    throw connectorSpineMaterializationError(
      segment,
      V4_CONNECTOR_SPINE_DIAGNOSTICS.FORWARD_TRAVERSAL_REJECTED,
      'authoritative centerline has no precommit traversal from source to destination',
      { sourceCellId, destinationCellId },
    );
  }
  if (!sourceCellId || !reverseReachable.has(sourceCellId)) {
    throw connectorSpineMaterializationError(
      segment,
      V4_CONNECTOR_SPINE_DIAGNOSTICS.REVERSE_TRAVERSAL_REJECTED,
      'authoritative centerline has no precommit traversal from destination to source',
      { sourceCellId, destinationCellId },
    );
  }

  return {
    schema: 'ruindivex-dungeon-authoritative-traversal-spine/v1',
    id: `${plan.id}:authoritative-traversal-spine`,
    segmentId: String(plan.id),
    operationId: plan.augmentationOperationId == null
      ? null
      : String(plan.augmentationOperationId),
    endpointSeamIds: [fromSeam.id, toSeam.id].map(String),
    floorStampOrder: [
      { kind: 'endpoint-seam', id: String(fromSeam.id) },
      { kind: 'endpoint-seam', id: String(toSeam.id) },
      { kind: 'ordered-centerline', id: `${plan.id}:authoritative-centerline` },
    ],
    orderedCells,
    requiredFloorKeys: orderedCells.map(({ floorKey }) => floorKey),
    sourceCellId,
    destinationCellId,
    directedEdges: orderedCells.flatMap(({ id }) => [...(outgoing.get(id) ?? [])]
      .sort()
      .map((toCellId) => ({ fromCellId: id, toCellId }))),
    precommitTraversal: {
      derivedFromAuthoritativeFloorIntent: true,
      forwardAccepted: true,
      reverseAccepted: true,
      forwardReachableCellCount: forwardReachable.size,
      reverseReachableCellCount: reverseReachable.size,
      missingFloorDiagnosticCode:
        V4_CONNECTOR_SPINE_DIAGNOSTICS.MISSING_CENTERLINE_FLOOR,
      forwardFailureDiagnosticCode:
        V4_CONNECTOR_SPINE_DIAGNOSTICS.FORWARD_TRAVERSAL_REJECTED,
      reverseFailureDiagnosticCode:
        V4_CONNECTOR_SPINE_DIAGNOSTICS.REVERSE_TRAVERSAL_REJECTED,
    },
    finalCollisionVerificationRequired: true,
    authoritative: true,
    preRender: true,
  };
}

function createSupplementConnectionPlan(
  segment,
  rooms,
  tileSize,
  allFootprints,
  {
    routeNetworkOperation = null,
    routeNetworkGrant = null,
    requireEndpointSeams = false,
    allowExactQuantizedElevationDelta = false,
  } = {},
) {
  const fromEndpoint = endpointOf(segment, 'from');
  const toEndpoint = endpointOf(segment, 'to');
  const fromPosition = endpointPosition(segment, 'from');
  const toPosition = endpointPosition(segment, 'to');
  const exactRouteBinding = Boolean(routeNetworkOperation);
  const fromRoomId = exactRouteBinding
    ? endpointNodeId(fromEndpoint)
    : endpointRoomId(fromEndpoint, fromPosition, rooms, tileSize);
  const toRoomId = exactRouteBinding
    ? endpointNodeId(toEndpoint)
    : endpointRoomId(toEndpoint, toPosition, rooms, tileSize);
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  if (exactRouteBinding && (!roomById.has(fromRoomId) || !roomById.has(toRoomId))) {
    throw new Error(
      `Route network segment ${segment.id} references an endpoint node that is not present in the effective room graph.`,
    );
  }
  const exactSeamThresholdPoint = (role) => {
    if (!exactRouteBinding || !requireEndpointSeams) return null;
    const seam = (segment.endpointSeams ?? []).find((candidate) => (
      String(candidate?.role ?? '') === role
    ));
    const threshold = (seam?.orderedCells ?? []).find((cell) => (
      Number(cell.lane) === 0 && Number(cell.signedDepthTiles) === 0
    ));
    return Number.isInteger(Number(threshold?.gridX))
      && Number.isInteger(Number(threshold?.gridZ))
      ? { x: Number(threshold.gridX), z: Number(threshold.gridZ) }
      : null;
  };
  const fromPoint = exactRouteBinding
    ? exactSeamThresholdPoint('from') ?? gridPoint(fromPosition, tileSize)
    : roomBoundaryGridPoint(
      fromPosition,
      fromEndpoint,
      roomById.get(fromRoomId),
      tileSize,
    );
  const toPoint = exactRouteBinding
    ? exactSeamThresholdPoint('to') ?? gridPoint(toPosition, tileSize)
    : roomBoundaryGridPoint(
      toPosition,
      toEndpoint,
      roomById.get(toRoomId),
      tileSize,
    );
  const fromFacing = cardinalFacingOf(fromEndpoint);
  const toFacing = cardinalFacingOf(toEndpoint);
  const endpointFlatBufferTiles = exactRouteBinding ? 2 : 1;
  const fromApproaches = fromFacing
    ? Array.from({ length: endpointFlatBufferTiles }, (_, index) => ({
      x: fromPoint.x + fromFacing.x * (index + 1),
      z: fromPoint.z + fromFacing.z * (index + 1),
    }))
    : [];
  const toApproaches = toFacing
    ? Array.from({ length: endpointFlatBufferTiles }, (_, index) => ({
      x: toPoint.x + toFacing.x * (endpointFlatBufferTiles - index),
      z: toPoint.z + toFacing.z * (endpointFlatBufferTiles - index),
    }))
    : [];
  const sourcePath = segment.path ?? segment.polyline ?? [];
  // Planning serializes an accepted orthogonal polyline, while Industrial's
  // floor stamper consumes one grid cell per step. Expand that same polyline
  // once here and preserve the resulting ordered centerline as both the
  // physical plan and V4's authoritative floor intent. This makes omitted
  // realized floors visible to final collision verification without changing
  // the route shape or V1-V3's established waypoint behavior.
  const rawPath = gridPath(
    sourcePath,
    tileSize,
    exactRouteBinding && requireEndpointSeams ? routeEndpointGridPoint : gridPoint,
  );
  if (exactRouteBinding && requireEndpointSeams && rawPath.length > 0) {
    // The seam is the physical transform authority. Route endpoints copied
    // from the host can contain binary float tails (43.39999999999999) that
    // otherwise round to the neighboring tile even though the seam's stable
    // 43.4 m identity correctly resolves the granted threshold.
    rawPath[0] = { ...fromPoint };
    rawPath[rawPath.length - 1] = { ...toPoint };
  }
  const sharedEndpointFootprint = segment?.sharedEndpointFootprint ?? null;
  const sharedJunctionThreshold = sharedEndpointFootprint?.kind
    === 'shared-junction-threshold';
  if (sharedEndpointFootprint && !sharedJunctionThreshold) {
    throw new Error(
      `Route network segment ${segment.id} requests unsupported shared endpoint footprint ${sharedEndpointFootprint.kind ?? '(missing)'}.`,
    );
  }
  if (sharedJunctionThreshold) {
    const sourceFacing = cardinalFacingOf(fromEndpoint);
    const destinationFacing = cardinalFacingOf(toEndpoint);
    const thresholdRooms = [roomById.get(fromRoomId), roomById.get(toRoomId)];
    const sourceNormalAlongX = Math.abs(number(sourceFacing?.x)) > 0;
    const expectedFootprintSize = {
      x: sourceNormalAlongX ? tileSize : tileSize * 3,
      y: tileSize * 2,
      z: sourceNormalAlongX ? tileSize * 3 : tileSize,
    };
    const footprintSizeValid = ['x', 'y', 'z'].every((axis) => (
      Math.abs(number(sharedEndpointFootprint?.size?.[axis]) - expectedFootprintSize[axis])
        <= 1e-4
    ));
    const oppositeFacings = sourceFacing
      && destinationFacing
      && sourceFacing.x === -destinationFacing.x
      && sourceFacing.z === -destinationFacing.z;
    const segmentPath = Array.isArray(segment.path) ? segment.path : [];
    const noCorridorVolumes = ['occupiedVolumes', 'clearanceVolumes', 'landingVolumes']
      .every((field) => Array.isArray(segment?.[field]) && segment[field].length === 0);
    if (fromEndpoint.kind !== 'supplementSocket'
      || toEndpoint.kind !== 'supplementSocket'
      || routeNetworkOperation?.routeNetworkKind !== 'objective-route-coverage'
      || thresholdRooms.some((room) => (
        room?.isSupplementConnectorJunction !== true
          || room?.junctionKind !== 'through-t'
      ))
      || !pointsApproximatelyEqual(fromPosition, toPosition)
      || segmentPath.length !== 2
      || !pointsApproximatelyEqual(segmentPath[0], segmentPath[1])
      || !pointsApproximatelyEqual(sharedEndpointFootprint.center, fromPosition)
      || !oppositeFacings
      || !footprintSizeValid
      || !Array.isArray(sharedEndpointFootprint.nodeIds)
      || sharedEndpointFootprint.nodeIds.length !== 2
      || !plainValuesEqual(
        sharedEndpointFootprint.nodeIds.map(String),
        [String(fromEndpoint.nodeId), String(toEndpoint.nodeId)],
      )
      || !Array.isArray(sharedEndpointFootprint.socketIds)
      || sharedEndpointFootprint.socketIds.length !== 2
      || !plainValuesEqual(
        sharedEndpointFootprint.socketIds.map(String),
        [String(endpointSocketId(fromEndpoint)), String(endpointSocketId(toEndpoint))],
      )
      || !Array.isArray(segment.localApproachWitnesses)
      || segment.localApproachWitnesses.length !== 2
      || !noCorridorVolumes) {
      throw new Error(
        `Route network segment ${segment.id} has an invalid shared-junction threshold realization contract.`,
      );
    }
  } else if (rawPath.length < 2) {
    throw new Error(
      `Route network segment ${segment.id} collapses to a shared threshold without an exact shared-junction contract.`,
    );
  }
  const intermediatePath = rawPath.length > 2 ? rawPath.slice(1, -1) : [];
  const path = [fromPoint];
  const endpointDelta = {
    x: toPoint.x - fromPoint.x,
    z: toPoint.z - fromPoint.z,
  };
  const directAxisAligned = endpointDelta.x === 0 || endpointDelta.z === 0;
  const directFacingAligned = Boolean(
    directAxisAligned
      && fromFacing
      && toFacing
      && endpointDelta.x * fromFacing.x + endpointDelta.z * fromFacing.z
        > 0
      && -(endpointDelta.x * toFacing.x + endpointDelta.z * toFacing.z)
        > 0
      && rawPath.every((point) => (
        endpointDelta.x === 0 ? point.x === fromPoint.x : point.z === fromPoint.z
      )),
  );
  if (sharedJunctionThreshold) {
    // Both exact world-space sockets occupy the same wall plane, but each
    // owning junction core retains its own boundary floor cell. Keep those
    // two adjacent cells as the traversal witness; no ordinary gallery floor
    // or clearance body is stamped between them.
    appendManhattanSpan(path, toPoint, endpointDelta.x !== 0);
  } else if (exactRouteBinding) {
    // Route-network planning has already produced and collision-validated the
    // authoritative width-aware centerline. Rebuilding endpoint approaches
    // here can walk forward, backtrack through an authored floor mask, then
    // walk forward again at short sockets or bends. Preserve the exact
    // accepted grid path and reject any materialization whose snapped
    // endpoints no longer match its bound sockets.
    if (!sameGridPoint(rawPath[0], fromPoint)
      || !sameGridPoint(rawPath.at(-1), toPoint)) {
      throw connectorMaterializationError(
        segment,
        'authoritative route-network path does not terminate at its exact sockets',
      );
    }
    path.length = 0;
    for (const point of rawPath) appendGridPoint(path, point);
  } else if (directFacingAligned) {
    // The same flat vestibule can serve both opposing sockets. Expanding two
    // independent approach lists would walk to the far endpoint, backtrack to
    // the near one, then walk forward again, creating duplicate floors and a
    // false connector proxy. Preserve the one monotonic physical corridor.
    appendManhattanSpan(path, toPoint, endpointDelta.x !== 0);
  } else {
    for (const approach of fromApproaches) appendGridPoint(path, approach);
    for (const [index, point] of intermediatePath.entries()) {
      if (sameGridPoint(point, fromPoint) || sameGridPoint(point, toPoint)) continue;
      appendManhattanSpan(path, point, index % 2 === 0);
    }
    appendManhattanSpan(path, toApproaches[0] ?? toPoint, false);
    for (const approach of toApproaches.slice(1)) appendGridPoint(path, approach);
    appendGridPoint(path, toPoint);
  }
  const rawSourceElevation = number(fromPosition.y);
  const fromSocket = createSocket({
    id: exactRouteBinding ? String(endpointSocketId(fromEndpoint)) : `${segment.id}:from`,
    roomId: fromRoomId,
    role: 'exit',
    point: path[0],
    outside: path[1] ?? path[0],
    elevation: rawSourceElevation,
    tileSize,
    fallbackFacing: fromEndpoint?.facing,
    sourceEndpoint: fromEndpoint,
    exactSocketBinding: exactRouteBinding,
  });
  const toSocket = createSocket({
    id: exactRouteBinding ? String(endpointSocketId(toEndpoint)) : `${segment.id}:to`,
    roomId: toRoomId,
    role: 'entrance',
    point: path.at(-1),
    outside: path.at(-2) ?? path.at(-1),
    elevation: number(toPosition.y, rawSourceElevation),
    tileSize,
    fallbackFacing: toEndpoint?.facing,
    sourceEndpoint: toEndpoint,
    exactSocketBinding: exactRouteBinding,
  });
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  const connectorFamily = supplementConnectorFamily(segment);
  const connectorVariantId = connectorVariantIdForFamily(connectorFamily);
  if (!connectorVariantId) {
    throw connectorMaterializationError(
      segment,
      `requests unsupported connector family ${connectorFamily}`,
    );
  }
  const rawDestinationElevation = number(toPosition.y, rawSourceElevation);
  const shortcutMode = segment.shortcutMode
    ?? segment.shortcut?.kind
    ?? segment.traversal?.shortcutMode
    ?? (['shortcut-lift', 'drop-ladder'].includes(String(segment.connectorFamily))
      ? String(segment.connectorFamily)
      : null);
  const sourceGate = exactRouteBinding ? routeNetworkSegmentGate(segment) : null;
  if (sourceGate && segment.gatePlacementSide && segment.gatePlacementSide !== 'source') {
    throw new Error(
      `Route network segment ${segment.id} places a gate away from its source entrance.`,
    );
  }
  const gateEndpointRole = sourceGate?.gateEndpointRole ?? 'from';
  if (sourceGate && !['from', 'to'].includes(gateEndpointRole)) {
    throw new Error(
      `Route network segment ${segment.id} has an invalid source-gate endpoint role.`,
    );
  }
  const gateEndpoint = gateEndpointRole === 'to' ? toEndpoint : fromEndpoint;
  const exactParentSourceGateRequired = Boolean(sourceGate
    && (sourceGate.sourceGateSocketId
      || routeNetworkOperation?.routeNetworkKind === 'cross-band-shortcut'));
  if (exactParentSourceGateRequired && (gateEndpoint?.kind !== 'parentSocket'
    || String(endpointSocketId(gateEndpoint) ?? '')
      !== String(sourceGate.sourceGateSocketId ?? ''))) {
    throw new Error(
      `Route network segment ${segment.id} does not place its source gate at the exact shallow parent socket.`,
    );
  }
  if (sourceGate && routeNetworkOperation?.routeNetworkKind === 'cross-band-shortcut') {
    const shallowSocketIds = new Set(
      (routeNetworkOperation?.shallowEndpointSocketIds ?? []).map(String),
    );
    if (!sourceGate.supplementalIdentity
      || !shallowSocketIds.has(String(sourceGate.sourceGateSocketId ?? ''))
      || sourceGate.requiredCredentialIds.length === 0) {
      throw new Error(
        `Cross-band route ${routeNetworkOperation.id} has an invalid shallow source-gate contract.`,
      );
    }
  }
  // The renderer and progression runtime define a locked corridor gate at the
  // connection plan's `from` threshold. Preserve the overlay segment identity,
  // but orient the authoritative physical plan from the exact shallow socket
  // when the topology happened to emit that socket as its `to` endpoint.
  const reverseForSourceGate = Boolean(sourceGate && gateEndpointRole === 'to');
  const planFromEndpoint = reverseForSourceGate ? toEndpoint : fromEndpoint;
  const planToEndpoint = reverseForSourceGate ? fromEndpoint : toEndpoint;
  const planFromRoomId = reverseForSourceGate ? toRoomId : fromRoomId;
  const planToRoomId = reverseForSourceGate ? fromRoomId : toRoomId;
  const planFromSocket = reverseForSourceGate
    ? { ...toSocket, role: 'exit', matchingSocketId: fromSocket.id }
    : fromSocket;
  const planToSocket = reverseForSourceGate
    ? { ...fromSocket, role: 'entrance', matchingSocketId: toSocket.id }
    : toSocket;
  const planPath = reverseForSourceGate ? [...path].reverse() : path;
  const elevation = reverseForSourceGate ? rawDestinationElevation : rawSourceElevation;
  const destinationElevation = reverseForSourceGate
    ? rawSourceElevation
    : rawDestinationElevation;
  const elevationDelta = destinationElevation - elevation;
  const sourceEndpointSeams = segment.endpointSeams ?? [];
  if (exactRouteBinding && requireEndpointSeams) {
    if (sharedJunctionThreshold && sourceEndpointSeams.length !== 0) {
      throw connectorMaterializationError(
        segment,
        'shared-junction threshold must not carry ordinary endpoint seams',
      );
    }
    if (!sharedJunctionThreshold && (
      sourceEndpointSeams.length !== 2
      || sourceEndpointSeams[0]?.role !== 'from'
      || sourceEndpointSeams[1]?.role !== 'to'
    )) {
      throw connectorMaterializationError(
        segment,
        'ordinary route-network segment must carry ordered from/to endpoint seams',
      );
    }
  }
  const orientEndpointSeam = (sourceSeam, role, socket, sourceRole) => {
    if (!sourceSeam) return null;
    const seam = clonePlainValue(sourceSeam);
    seam.sourceRole = sourceRole;
    seam.role = role;
    seam.materializedRole = role;
    // Authored-corridor stations are materialized through a synthetic
    // connector-junction proxy, but that presentation/progression facade must
    // never replace the authoritative host owner recorded by the accepted
    // seam. Ordinary parent-room and supplemental sockets have the same
    // progression and physical owner, so this remains an exact identity check
    // for every other endpoint kind.
    const authoritativeNodeId = socket.authoritativeSeamNodeId
      ?? socket.progressionRoomId
      ?? socket.roomId;
    if (
      seam.schema !== 'ruindivex-dungeon-route-endpoint-seam/v1'
      || String(seam.segmentId ?? '') !== String(segment.id)
      || String(seam.socketId ?? '') !== String(socket.id)
      || String(seam.nodeId ?? '') !== String(authoritativeNodeId)
      || !Array.isArray(seam.orderedCells)
      || seam.orderedCells.length !== 15
    ) {
      throw connectorMaterializationError(
        segment,
        `${sourceRole} endpoint seam identity changed during materialization`,
      );
    }
    // A supplemental socket on an exact parent station can inherit the
    // authored corridor owner through its node even though the serialized
    // endpoint itself has no parentRouteId. Carry the accepted seam owner as
    // a stable physical identity; progression/socket rewrites must not infer
    // or erase it later.
    socket.authoritativeSeamParentOwnerId =
      seam.overlapEnvelope?.parentOwnerId ?? null;
    const facing = {
      x: Math.sign(number(seam.facing?.x)),
      z: Math.sign(number(seam.facing?.z)),
    };
    if (facing.x !== Math.sign(number(socket.facingX))
      || facing.z !== Math.sign(number(socket.facingZ))) {
      throw requireEndpointSeams
        ? connectorSpineMaterializationError(
            segment,
            V4_CONNECTOR_SPINE_DIAGNOSTICS.WRONG_SEAM_SIDE,
            `${sourceRole} endpoint seam facing disagrees with its exact socket/path leg`,
            {
              role: sourceRole,
              seamId: seam.id,
              seamFacing: facing,
              pathFacing: {
                x: Math.sign(number(socket.facingX)),
                z: Math.sign(number(socket.facingZ)),
              },
            },
          )
        : connectorMaterializationError(
            segment,
            `${sourceRole} endpoint seam facing disagrees with its exact socket`,
          );
    }
    return seam;
  };
  const endpointSeams = sharedJunctionThreshold || !exactRouteBinding || sourceEndpointSeams.length === 0
    ? []
    : reverseForSourceGate
      ? [
          orientEndpointSeam(sourceEndpointSeams[1], 'from', planFromSocket, 'to'),
          orientEndpointSeam(sourceEndpointSeams[0], 'to', planToSocket, 'from'),
        ]
      : [
          orientEndpointSeam(sourceEndpointSeams[0], 'from', planFromSocket, 'from'),
          orientEndpointSeam(sourceEndpointSeams[1], 'to', planToSocket, 'to'),
        ];
  // V4 segment/node sharing is authorized exclusively by endpointSeams. The
  // older landing volume remains a legacy materialization helper and is never
  // copied onto an exact route-network connection plan.
  const landingOverlapGrants = exactRouteBinding && !requireEndpointSeams
    ? [fromEndpoint, toEndpoint]
      .filter((endpoint) => endpoint.kind === 'parentSocket')
      .map((endpoint) => createDungeonSocketLandingOverlapVolume(endpoint, {
        tileSize,
        operationId: routeNetworkOperation.id,
        grantId: routeNetworkOperation.grantId,
      }))
    : [];
  const plan = {
    id: String(segment.id),
    logicalConnectionId: String(segment.logicalConnectionId ?? segment.logicalEdgeId ?? segment.id),
    fromRoomId: planFromRoomId,
    toRoomId: planToRoomId,
    progressionFromRoomId: planFromEndpoint.sourceParentNodeId ?? planFromRoomId,
    progressionToRoomId: planToEndpoint.sourceParentNodeId ?? planToRoomId,
    doorId: sourceGate?.doorId ?? null,
    ...(sourceGate ? {
      logicalGateId: sourceGate.doorId,
      gatePlacementSide: 'source',
      gateSourceRoomId: planFromRoomId,
      gateSourceSocketId: sourceGate.sourceGateSocketId,
      gateEndpointRole: 'from',
      overlayGateEndpointRole: gateEndpointRole,
      supplementalGateIdentity: sourceGate.supplementalIdentity,
      requiresEncounterId: sourceGate.requiresEncounterId,
      requiredKeycardId: sourceGate.requiredKeycardId,
      requiredCredentialIds: [...sourceGate.requiredCredentialIds],
      credentialRequirement: sourceGate.requiredKeycardId,
      gateRequirement: {
        requiredCredentialIds: [...sourceGate.requiredCredentialIds],
        requiredKeycardId: sourceGate.requiredKeycardId,
      },
      hostsLogicalGate: true,
    } : {}),
    level: 0,
    elevation,
    sourceElevation: elevation,
    destinationElevation,
    elevationDelta,
    direction: elevationDelta > CONNECTOR_ELEVATION_EPSILON
      ? 'ascending'
      : elevationDelta < -CONNECTOR_ELEVATION_EPSILON
        ? 'descending'
        : 'level',
    connectorType: 'ground_corridor',
    connectorFamily,
    connectorVariantId: null,
    connectorVariant: null,
    requiredForProgression: false,
    purpose: exactRouteBinding
      ? `supplement_route_network:${routeNetworkOperation.routeNetworkKind ?? 'coverage'}`
      : 'supplement_optional_branch',
    routeClassification: exactRouteBinding ? 'route_network' : 'optional_branch',
    fullPath: planPath,
    bridgePath: [...planPath],
    fromSocket: planFromSocket,
    toSocket: planToSocket,
    endpointSeams,
    isDungeonSupplement: true,
    isSharedThresholdConnection: sharedJunctionThreshold,
    ...(sharedJunctionThreshold ? {
      sharedEndpointFootprint: clonePlainValue(sharedEndpointFootprint),
      localApproachWitnesses: clonePlainValue(segment.localApproachWitnesses),
      sharedThresholdRealization: 'adjacent-junction-core-floors',
    } : segment.localApproachWitnesses ? {
      localApproachWitnesses: clonePlainValue(segment.localApproachWitnesses),
    } : {}),
    augmentationOperationId: segmentOperationId(segment),
    ...(exactRouteBinding ? {
      augmentationOperationType: 'routeNetwork',
      routeNetworkGrantId: routeNetworkOperation.grantId ?? null,
      routeNetworkKind: routeNetworkOperation.routeNetworkKind ?? null,
      topologyTemplateId: routeNetworkOperation.topologyTemplateId ?? null,
      accessDomainId: routeNetworkOperation.accessDomainId ?? null,
      progressionBandId: routeNetworkOperation.progressionBandId ?? null,
      elevationModes: [...(routeNetworkOperation.elevationModes ?? [])].map(String),
      landingOverlapGrants,
      augmentationThemeBinding: clonePlainValue(routeNetworkOperation.themeBinding ?? null),
      shortcutMode,
      shortcutStateId: segment.shortcutStateId
        ?? segment.shortcut?.stateId
        ?? segment.stableRuntimeStateId
        ?? segment.traversal?.stateId
        ?? null,
      shortcutMechanismId: shortcutMode
        ? segment.shortcutMechanismId
          ?? supplementShortcutMechanismId(routeNetworkOperation.id, String(segment.id))
        : null,
      shortcutActivationSide: shortcutMode ? 'far-side' : null,
      shortcutInitialState: segment.shortcut?.initialState
        ?? (shortcutMode === 'shortcut-lift'
          ? 'unavailable'
          : shortcutMode === 'drop-ladder' ? 'retracted' : null),
      shortcutActivatedState: segment.shortcut?.activatedState ?? null,
      shortcutPersistent: segment.shortcut?.persistent === true,
      shortcutActivationSideDeclared: segment.shortcut?.activationSide ?? null,
      oneSideActivatedShortcut: Boolean(shortcutMode),
    } : {}),
    connectorVariantConstraints: {
      roomFootprints: allFootprints,
      endpointFlatBufferTiles: exactRouteBinding ? 2 : 2,
      reservedFootprintHalfWidthTiles: 2,
      reservedFootprintColumnCount: sharedJunctionThreshold ? 0 : planPath.length * 5,
      footprintRoomCollisionCount: 0,
      footprintConnectorCollisionCount: 0,
      ...(sharedJunctionThreshold ? {
        noCorridorStamp: true,
        sharedEndpointFootprint: clonePlainValue(sharedEndpointFootprint),
      } : {}),
      blockedLanePoints: [],
      ...(exactRouteBinding ? {
        exactEndpointSocketIds: [planFromSocket.id, planToSocket.id],
        endpointSeamIds: endpointSeams.map(({ id }) => String(id)),
        socketLandingOverlapGrants: requireEndpointSeams
          ? []
          : clonePlainValue(
            routeNetworkGrant?.socketLandingOverlapGrants ?? landingOverlapGrants,
          ),
      } : {}),
    },
  };
  if (connectorVariantId === DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY) {
    if (Math.abs(elevationDelta) > CONNECTOR_ELEVATION_EPSILON) {
      throw connectorMaterializationError(
        segment,
        `cannot realize level service gallery between elevations ${elevation} and ${destinationElevation}`,
      );
    }
    if (exactRouteBinding && requireEndpointSeams && !sharedJunctionThreshold) {
      plan.authoritativeTraversalSpine = createV4AuthoritativeLevelTraversalSpine(
        plan,
        segment,
      );
      plan.connectorVariantConstraints.authoritativeTraversalSpineId =
        plan.authoritativeTraversalSpine.id;
      plan.connectorVariantConstraints.authoritativeTraversalFloorKeys = [
        ...plan.authoritativeTraversalSpine.requiredFloorKeys,
      ];
      plan.connectorVariantConstraints.finalCollisionSpineVerificationRequired = true;
    }
    // Keep the v1/v2 service-gallery realization byte-for-byte compatible:
    // their parent Industrial shell remains the sole source of presentation
    // and no authored variant contract is introduced retroactively.
    plan.direction = 'level';
    return plan;
  }

  try {
    plan.connectorVariantId = connectorVariantId;
    plan.connectorVariant = createDungeonConnectorVariantContract(
      plan,
      connectorVariantId,
      {
        tileSize,
        sourceElevation: elevation,
        destinationElevation,
        direction: plan.direction,
        allowExactQuantizedElevationDelta,
        switchbackSideSign: segment.slopeSwitchbackSideSign == null
          ? null
          : Number(segment.slopeSwitchbackSideSign) * (reverseForSourceGate ? -1 : 1),
      },
    );
  } catch (error) {
    throw connectorMaterializationError(
      segment,
      `cannot realize ${connectorFamily} contract: ${error?.message ?? String(error)}`,
      error,
    );
  }
  return plan;
}

function createCorridorStationGraphPlan(station, tileSize, allFootprints) {
  const { room, parentPlan, nearestIndex, operation, socket } = station;
  const parentPath = (parentPlan.fullPath ?? parentPlan.bridgePath ?? []).map((point) => ({
    x: number(point.x),
    z: number(point.z),
  }));
  const path = parentPath.slice(nearestIndex);
  if (path.length === 0) path.push({ x: room.x, z: room.z });
  const destinationPoint = parentPlan.toSocket
    ? { x: number(parentPlan.toSocket.x), z: number(parentPlan.toSocket.z) }
    : path.at(-1);
  appendManhattanSpan(path, destinationPoint, false);
  const next = path[1] ?? path[0];
  const fromFacing = {
    x: Math.sign(number(next.x) - number(path[0].x)),
    z: Math.sign(number(next.z) - number(path[0].z)),
  };
  const fromSocket = createSocket({
    id: `${room.id}:parent-route-destination`,
    roomId: room.id,
    role: 'route-station-link',
    point: path[0],
    outside: next,
    elevation: room.baseElevation,
    tileSize,
    fallbackFacing: fromFacing,
  });
  const toSocket = parentPlan.toSocket ? { ...parentPlan.toSocket } : createSocket({
    id: `${room.id}:parent-route-destination-end`,
    roomId: parentPlan.toRoomId,
    role: 'route-station-link',
    point: path.at(-1),
    outside: path.at(-2) ?? path.at(-1),
    elevation: parentPlan.destinationElevation ?? parentPlan.elevation ?? room.baseElevation,
    tileSize,
  });
  fromSocket.matchingSocketId = toSocket.id;
  toSocket.matchingSocketId = fromSocket.id;
  return {
    id: `${room.id}:parent-route-link`,
    logicalConnectionId: String(
      parentPlan.logicalConnectionId ?? parentPlan.logicalEdgeId ?? parentPlan.id,
    ),
    parentConnectionId: parentPlan.id,
    parentLogicalEdgeId: parentPlan.logicalConnectionId ?? parentPlan.logicalEdgeId ?? null,
    fromRoomId: room.id,
    toRoomId: parentPlan.toRoomId,
    doorId: null,
    level: number(parentPlan.level),
    elevation: number(room.baseElevation),
    sourceElevation: number(room.baseElevation),
    destinationElevation: number(
      parentPlan.toSocket?.elevation,
      number(parentPlan.destinationElevation, number(parentPlan.elevation)),
    ),
    elevationDelta: 0,
    direction: 'level',
    connectorType: parentPlan.connectorType ?? 'ground_corridor',
    connectorFamily: 'service-gallery',
    connectorVariantId: null,
    connectorVariant: null,
    requiredForProgression: false,
    purpose: 'supplement_parent_route_station_link',
    routeClassification: 'route_network_station_link',
    fullPath: path,
    bridgePath: [...path],
    fromSocket,
    toSocket,
    isDungeonSupplement: true,
    isSupplementGraphConnection: true,
    parentRouteStationLink: true,
    isRouteNetworkConnection: true,
    augmentationOperationId: operation.id,
    augmentationOperationType: 'routeNetwork',
    routeNetworkGrantId: operation.grantId,
    routeNetworkKind: operation.routeNetworkKind ?? station.grant.routeNetworkKind ?? null,
    routeNetworkSocketId: String(socket.id),
    accessDomainId: operation.accessDomainId ?? station.grant.accessDomainId ?? null,
    progressionBandId: operation.progressionBandId ?? station.grant.progressionBandId ?? null,
    connectorVariantConstraints: {
      roomFootprints: allFootprints,
      endpointFlatBufferTiles: 2,
      reservedFootprintHalfWidthTiles: 2,
      reservedFootprintColumnCount: 0,
      footprintRoomCollisionCount: 0,
      footprintConnectorCollisionCount: 0,
      blockedLanePoints: [],
      graphOnly: true,
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

function horizontalPresentationBounds(position, width, depth, dilation = 0) {
  const halfWidth = Math.max(0, number(width)) * 0.5 + Math.max(0, number(dilation));
  const halfDepth = Math.max(0, number(depth)) * 0.5 + Math.max(0, number(dilation));
  return {
    minX: number(position?.x) - halfWidth,
    maxX: number(position?.x) + halfWidth,
    minZ: number(position?.z) - halfDepth,
    maxZ: number(position?.z) + halfDepth,
  };
}

function horizontalPresentationBoundsOverlap(first, second) {
  return first.minX < second.maxX - CONNECTOR_ELEVATION_EPSILON
    && first.maxX > second.minX + CONNECTOR_ELEVATION_EPSILON
    && first.minZ < second.maxZ - CONNECTOR_ELEVATION_EPSILON
    && first.maxZ > second.minZ + CONNECTOR_ELEVATION_EPSILON;
}

export function inspectIndustrialSupplementStoryPresentationLegality({
  room,
  record,
  effectiveConnections = [],
  tileSize,
}) {
  const candidate = horizontalPresentationBounds(
    record.transform?.position ?? record.position,
    record.worldFootprint?.widthMeters ?? record.widthMeters,
    record.worldFootprint?.depthMeters ?? record.depthMeters,
  );
  const reasons = new Set();
  const associatedCollisionIds = new Set((record.collisionRecordIds ?? []).map(String));
  const intersects = (bounds, reason) => {
    if (horizontalPresentationBoundsOverlap(candidate, bounds)) reasons.add(reason);
  };

  for (const collision of room.augmentationCollisionRecords ?? []) {
    if (associatedCollisionIds.has(String(collision.id))) continue;
    const protectedCollision = collision.blocking === true
      || collision.mustRemainClear === true
      || collision.excludesFloor === true
      || collision.reservedOpening === true
      || ['anchor', 'physical-transfer', 'blueprint-socket'].includes(collision.sourceKind);
    if (!protectedCollision || !collision.center || !collision.size) continue;
    intersects(horizontalPresentationBounds(
      collision.center,
      collision.size.x,
      collision.size.z,
    ), `collision:${collision.id}`);
  }

  for (const sightline of room.augmentationProtectedSightlines ?? []) {
    if (sightline.authoritative === false
      || sightline.protectionKind !== 'required-sightline') continue;
    for (const cell of sightline.worldCells ?? []) {
      intersects(horizontalPresentationBounds(
        cell.position ?? cell.worldPosition,
        number(cell.widthMeters, tileSize),
        number(cell.depthMeters, tileSize),
      ), `protected-sightline:${sightline.sightlineId ?? sightline.id}`);
    }
  }

  // Route/landing/encounter zones are already projected onto exact authored
  // cells. A one-tile dilation reserves the readable travel and sightline
  // envelope without consuming planner RNG or inventing new collision.
  for (const zone of room.augmentationZones ?? []) {
    if (!['clear', 'encounter', 'hazard'].includes(String(zone.zoneKind ?? ''))) continue;
    for (const cell of zone.worldCells ?? []) {
      intersects(horizontalPresentationBounds(
        cell.position,
        tileSize,
        tileSize,
        tileSize,
      ), `dilated-zone:${zone.runtimeId ?? zone.id}`);
    }
  }
  for (const transfer of room.augmentationTransfers ?? []) {
    for (const cell of transfer.worldCells ?? []) {
      intersects(horizontalPresentationBounds(
        cell.position,
        tileSize,
        tileSize,
        tileSize,
      ), `dilated-transfer:${transfer.id}`);
    }
  }
  for (const anchor of room.augmentationAnchors ?? []) {
    const kind = String(anchor.kind ?? anchor.type ?? '');
    const ownsStoryPresentationIdentity = Boolean(
      String(record.sourceFeatureRuntimeId ?? '')
        && String(anchor.sourceFeatureRuntimeId ?? '')
          === String(record.sourceFeatureRuntimeId)
        && /story/i.test(kind),
    );
    // A story feature's canonical blueprint anchor is its source identity, not
    // a separate gameplay reservation. Its associated collision is already
    // excluded above; excluding the matching nonblocking story anchor keeps
    // that same source record from vetoing its own decal. Controls, rewards,
    // spawns, mechanisms, hazards, and every foreign anchor remain protected.
    if (ownsStoryPresentationIdentity) continue;
    if (!(
      anchor.sourceFeatureId
      || anchor.blueprintFeatureId
      || /spawn|encounter|control|mechanism|reward|hazard|trap/i.test(kind)
    )) continue;
    intersects(horizontalPresentationBounds(
      anchor.position ?? anchor.worldPosition,
      tileSize,
      tileSize,
      tileSize * 0.5,
    ), `anchor:${anchor.id}`);
  }
  for (const socket of room.augmentationSocketRecords ?? []) {
    intersects(horizontalPresentationBounds(
      socket.position ?? socket.worldPosition,
      number(socket.widthMeters, tileSize),
      tileSize,
      tileSize,
    ), `socket-landing:${socket.runtimeId ?? socket.id}`);
  }
  for (const plan of effectiveConnections) {
    if (String(plan.augmentationOperationId ?? plan.operationId ?? '')
      !== String(record.operationId ?? '')) continue;
    for (const seam of plan.endpointSeams ?? []) {
      for (const cell of seam.orderedCells ?? []) {
        intersects(horizontalPresentationBounds(
          { x: number(cell.gridX) * tileSize, z: number(cell.gridZ) * tileSize },
          tileSize,
          tileSize,
          tileSize,
        ), `endpoint-seam:${seam.id}`);
      }
    }
  }
  return {
    legal: reasons.size === 0,
    reasons: [...reasons].sort(),
  };
}

function synchronizeRoomPresentationRecords(room) {
  const records = room.augmentationPresentationRecords ?? [];
  if (room.augmentationStructure) {
    room.augmentationStructure = {
      ...room.augmentationStructure,
      presentationRecords: clonePlainValue(records),
    };
  }
  if (room.augmentationPhysicalRealization) {
    room.augmentationPhysicalRealization = {
      ...room.augmentationPhysicalRealization,
      presentationRecords: clonePlainValue(records),
    };
  }
}

function selectOptionalV4StoryPresentation({
  supplementRooms,
  effectiveConnections,
  tileSize,
  enabled = true,
}) {
  const recordsByOperationId = new Map();
  for (const room of supplementRooms) {
    for (const record of room.augmentationPresentationRecords ?? []) {
      if (record.semanticRole !== 'story-marking') continue;
      const operationId = String(record.operationId ?? room.augmentationOperationId ?? '');
      const candidates = recordsByOperationId.get(operationId) ?? [];
      candidates.push({ room, record });
      recordsByOperationId.set(operationId, candidates);
    }
  }
  for (const [operationId, candidates] of recordsByOperationId) {
    const inspected = candidates.map((candidate) => ({
      ...candidate,
      inspection: inspectIndustrialSupplementStoryPresentationLegality({
        room: candidate.room,
        record: candidate.record,
        effectiveConnections,
        tileSize,
      }),
    }));
    const legal = inspected.filter(({ inspection }) => inspection.legal)
      .sort((left, right) => String(left.record.id).localeCompare(String(right.record.id)));
    const selectionHash = stableHashText(canonicalStringify({
      operationId,
      candidateIds: legal.map(({ record }) => record.id),
    }), INDUSTRIAL_SUPPLEMENT_STORY_SELECTION_NAMESPACE);
    const hashLane = Number.parseInt(selectionHash.slice(3, 11), 16) >>> 0;
    const selected = enabled && legal.length > 0 ? legal[hashLane % legal.length] : null;
    for (const candidate of inspected) {
      const isSelected = candidate === selected;
      candidate.record.selectedForRendering = isSelected;
      candidate.record.renderingRequired = isSelected;
      candidate.record.realizationRequired = true;
      candidate.record.renderedBySupplementAssembler = isSelected;
      candidate.record.runtimeActivation = isSelected
        ? 'not-applicable'
        : 'optional-not-selected';
      candidate.record.storySelectionHash = selectionHash;
      candidate.record.storySelectionCandidateCount = legal.length;
      candidate.record.storyPlacementLegal = candidate.inspection.legal;
      candidate.record.storyPlacementRejectionReasons = candidate.inspection.reasons;
      candidate.record.selectionStatus = !enabled
        ? 'optional-decoration-disabled'
        : isSelected
          ? 'selected-by-isolated-stable-hash'
          : candidate.inspection.legal
            ? 'not-selected'
            : 'illegal-placement';
    }
  }
  for (const room of supplementRooms) synchronizeRoomPresentationRecords(room);
}

function createIndustrialAssemblyOverlayPlan(overlayPlan, supplementRooms) {
  const roomByNodeId = new Map(supplementRooms.map((room) => (
    [String(room.augmentationNodeId ?? room.id), room]
  )));
  const assemblyOverlayPlan = clonePlainValue(overlayPlan);
  assemblyOverlayPlan.nodes = (assemblyOverlayPlan.nodes ?? []).map((node) => {
    const room = roomByNodeId.get(String(node.id));
    if (!room?.augmentationPhysicalRealization) return node;
    const presentationRoleForLandmark = (landmark) => {
      const kind = String(landmark.kind ?? '');
      if (/marking|map|board/i.test(kind)) return 'decal';
      if (/hazard|emitter/i.test(kind)) return 'hazard';
      if (/control|terminal/i.test(kind)) return 'control';
      return 'prop';
    };
    const hasAuthoredBlueprintPresentation = Boolean(room.augmentationBlueprintId);
    const authoritativeV4BlueprintPresentation = Boolean(
      hasAuthoredBlueprintPresentation
        && (
          overlayPlan?.profileId === INDUSTRIAL_SUPPLEMENT_V4_PROFILE_ID
            || room.augmentationPhysicalRealization?.profileId
              === INDUSTRIAL_SUPPLEMENT_V4_PROFILE_ID
            || room.augmentationStructureMetadata?.profileId
              === INDUSTRIAL_SUPPLEMENT_V4_PROFILE_ID
        )
    );
    const assemblyAnchors = (room.augmentationAnchors ?? []).filter((anchor) => (
      !(
        authoritativeV4BlueprintPresentation
          && String(anchor?.kind ?? anchor?.type ?? '') === 'doorway-frame'
      )
    ));
    const manifestPresentationAnchors = [
      ...(hasAuthoredBlueprintPresentation ? [] : (room.augmentationCover ?? [])).map((cover) => ({
        ...clonePlainValue(cover),
        id: `${cover.id}:presentation`,
        sourceRecordId: cover.id,
        kind: 'prop',
        assetRole: 'prop',
        isManifestCover: true,
      })),
      ...(hasAuthoredBlueprintPresentation ? [] : (room.augmentationLandmarks ?? [])).map((landmark) => ({
        ...clonePlainValue(landmark),
        id: `${landmark.id}:presentation`,
        sourceRecordId: landmark.id,
        kind: 'prop',
        assetRole: presentationRoleForLandmark(landmark),
        isManifestLandmark: true,
      })),
      ...(room.augmentationLighting ?? []).map((lighting) => ({
        ...clonePlainValue(lighting),
        id: `${lighting.id}:presentation`,
        sourceRecordId: lighting.id,
        kind: 'light-fixture',
        assetRole: 'lightFixture',
        isManifestLighting: true,
      })),
    ];
    return {
      ...node,
      themeBinding: clonePlainValue(room.augmentationThemeBinding),
      anchors: clonePlainValue([
        // V4 parent-socket boundary indicators are the only threshold
        // markers. Keep doorway-frame records in the authoritative
        // materialization ledger, but do not send their old per-module render
        // path to the assembler. V1-V3 and non-blueprint assembly are
        // deliberately outside this filter.
        ...assemblyAnchors,
        ...manifestPresentationAnchors,
      ]),
      structure: clonePlainValue(room.augmentationStructure),
      moduleManifest: clonePlainValue(room.augmentationModuleManifest),
      moduleManifestId: room.augmentationModuleManifest?.id ?? null,
      moduleManifestSchema: room.augmentationModuleManifest?.schema ?? null,
      blueprintId: room.augmentationBlueprintId ?? null,
      blueprintSchema: room.augmentationBlueprintSchema ?? null,
      blueprint: clonePlainValue(room.augmentationBlueprint),
      floorMask: clonePlainValue(room.augmentationFloorMask),
      floorTiers: clonePlainValue(room.augmentationFloorTiers),
      socketRecords: clonePlainValue(room.augmentationSocketRecords),
      transfers: clonePlainValue(room.augmentationTransfers),
      features: clonePlainValue(room.augmentationBlueprintFeatures),
      presentationRecords: clonePlainValue(room.augmentationPresentationRecords),
      voids: clonePlainValue(room.augmentationVoids),
      blueprintStateRecords: clonePlainValue(room.augmentationBlueprintStateRecords),
      blueprintStateIds: clonePlainValue(room.augmentationBlueprintStateIds),
      clearRoutes: clonePlainValue(room.augmentationClearRoutes),
      zones: clonePlainValue(room.augmentationZones),
      cover: clonePlainValue(room.augmentationCover),
      landmarks: clonePlainValue(room.augmentationLandmarks),
      lighting: clonePlainValue(room.augmentationLighting),
      protectedSightlines: clonePlainValue(room.augmentationProtectedSightlines),
      collisionRecords: clonePlainValue(room.augmentationCollisionRecords),
      recipeRecords: clonePlainValue(room.augmentationRecipeRecords),
      physicalRealization: clonePlainValue(room.augmentationPhysicalRealization),
      structureMetadata: clonePlainValue(room.augmentationStructureMetadata),
      structuralQualityReport: clonePlainValue(room.augmentationStructuralQualityReport),
      stableRuntimeStateIds: clonePlainValue(room.augmentationStableRuntimeStateIds ?? {}),
      authoritativeManifestRealization: true,
      authoritativeBlueprintRealization: Boolean(room.augmentationBlueprintId),
      assemblyOnly: true,
    };
  });
  assemblyOverlayPlan.sourceAugmentationPlanHash = overlayPlan.augmentationPlanHash ?? null;
  assemblyOverlayPlan.authoritativeManifestRealization = true;
  assemblyOverlayPlan.authoritativeBlueprintRealization = supplementRooms.some((room) => (
    Boolean(room.augmentationBlueprintId)
  ));
  assemblyOverlayPlan.assemblyOnly = true;
  return assemblyOverlayPlan;
}

function atomicIndustrialMaterializationRejection({
  rooms,
  connectionPlans,
  overlayPlan,
  errors,
  materializationFailures = [],
  reason = 'materialization-failed',
}) {
  const normalizedErrors = errors.map((error) => error?.message ?? String(error));
  const contentContractErrors = errors.filter((error) => (
    error?.code === INDUSTRIAL_SUPPLEMENT_CONTENT_CONTRACT_ERROR
  )).map((error) => ({
    code: error.code,
    nodeId: error.nodeId ?? null,
    grammarId: error.grammarId ?? null,
    contentRole: error.contentRole ?? null,
    message: error.message,
  }));
  return {
    rooms,
    connectorJunctionProxies: [],
    connectionPlans,
    assemblyOverlayPlan: null,
    supplementalRoomIds: [],
    supplementalConnectorJunctionIds: [],
    supplementalConnectionIds: [],
    supplementalPhysicalConnectionIds: [],
    supplementalGraphOnlyConnectionIds: [],
    diagnostics: {
      accepted: false,
      reason,
      errors: normalizedErrors,
      materializationFailures: clonePlainValue(materializationFailures),
      contentContractErrors,
      atomicRejected: true,
      profileId: overlayPlan?.profileId ?? null,
      roomCount: 0,
      connectorJunctionProxyCount: 0,
      supplementConnectorJunctionProxyCount: 0,
      supplementConnectorModuleProxyCount: 0,
      connectionCount: 0,
      totalConnectionRecordCount: 0,
      physicalConnectionCount: 0,
      graphOnlyConnectionCount: 0,
      paddingConnectionCount: 0,
      routeNetworkConnectionCount: 0,
      routeStationGraphConnectionCount: 0,
      routeStationGraphConnectionIds: [],
      optionalConnectionCount: 0,
      paddedLogicalConnectionCount: 0,
      paddedConnections: [],
      routeNetworkCount: 0,
      routeNetworks: [],
    },
  };
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
      connectorJunctionProxies: [],
      connectionPlans,
      assemblyOverlayPlan: null,
      supplementalRoomIds: [],
      supplementalConnectorJunctionIds: [],
      supplementalConnectionIds: [],
      supplementalPhysicalConnectionIds: [],
      supplementalGraphOnlyConnectionIds: [],
      diagnostics: { accepted: false, reason: 'missing-overlay-plan', errors: [] },
    };
  }

  const operations = overlayPlan.operations ?? [];
  const segments = overlayPlan.segments ?? [];
  const operationById = new Map(operations.map((operation) => [String(operation.id), operation]));
  const overlayNodeById = new Map((overlayPlan.nodes ?? []).map((node) => [String(node.id), node]));
  const strictV4ContentContract = overlayPlan.profileId === INDUSTRIAL_SUPPLEMENT_V4_PROFILE_ID;
  const strictV4ReleaseContract = strictV4ContentContract
    && Number(overlayPlan.profileRevision ?? 0) >= 5;
  const authoredV4ContentContract = strictV4ContentContract
    && overlayPlan.generationMode === 'authored-artifact'
    && Number(overlayPlan.profileRevision ?? 0) === 6;
  const supportsParentAnchoredForest = overlayPlan.schema
    === 'ruindivex-dungeon-augmentation-overlay/v2'
    && (
      Number(overlayPlan.profileRevision ?? 0) === 5
      || authoredV4ContentContract
    );
  const supplementRoomNodes = (overlayPlan.nodes ?? []).filter((node) => (
    !isSupplementConnectorJunctionNode(node)
  ));
  const supplementConnectorJunctionNodes = (overlayPlan.nodes ?? []).filter(
    isSupplementConnectorJunctionNode,
  );
  const strictRoomByNodeId = new Map();
  const strictConnectorByNodeId = new Map();
  if (strictV4ContentContract) {
    const contentErrors = [];
    for (const node of supplementRoomNodes) {
      const operation = operationById.get(String(nodeOperationId(node)));
      try {
        strictRoomByNodeId.set(String(node.id), createSupplementRoom(
          node,
          tileSize,
          operation,
          {
            requireManifest: true,
            requireBlueprint: Boolean(industrialSupplementBlueprintId(node)),
            difficulty: overlayPlan.difficulty,
          },
        ));
      } catch (error) {
        contentErrors.push(error);
      }
    }
    for (const node of supplementConnectorJunctionNodes) {
      const operation = operationById.get(String(nodeOperationId(node)));
      try {
        if (!isRouteNetworkOperation(operation)
          || !node.themeBinding
          || !operation?.themeBinding
          || !plainValuesEqual(node.themeBinding, operation.themeBinding)) {
          throw supplementContentContractError(
            node,
            'connector infrastructure does not preserve its exact V4 operation theme binding',
          );
        }
        strictConnectorByNodeId.set(String(node.id), createSupplementConnectorJunctionProxy(
          node,
          tileSize,
          operation,
          {
            requireBlueprint: Boolean(industrialSupplementBlueprintId(node)),
            difficulty: overlayPlan.difficulty,
          },
        ));
      } catch (error) {
        contentErrors.push(error);
      }
    }
    if (contentErrors.length > 0) {
      return atomicIndustrialMaterializationRejection({
        rooms,
        connectionPlans,
        overlayPlan,
        errors: contentErrors,
        reason: 'content-contract-rejected',
      });
    }
  }
  const grantsById = routeNetworkGrantIndex(extensionRegions);
  const corridorStations = createCorridorStationRooms({
    operations,
    grantsById,
    connectionPlans,
    tileSize,
  });
  const effectiveRooms = rooms.map((room) => ({
    ...room,
    exitSockets: (room.exitSockets ?? []).map((socket) => ({ ...socket })),
  }));
  const supplementRooms = supplementRoomNodes.map((node) => (
    strictRoomByNodeId.get(String(node.id)) ?? createSupplementRoom(
      node,
      tileSize,
      operationById.get(String(nodeOperationId(node))),
    )
  ));
  const supplementConnectorJunctionProxies = supplementConnectorJunctionNodes.map((node) => (
    strictConnectorByNodeId.get(String(node.id)) ?? createSupplementConnectorJunctionProxy(
      node,
      tileSize,
      operationById.get(String(nodeOperationId(node))),
    )
  ));
  const connectorJunctionProxies = [
    ...corridorStations.stations.map((station) => station.room),
    ...supplementConnectorJunctionProxies,
  ];
  const connectorOnlyParentAnchoredProjection =
    inspectConnectorOnlyParentAnchoredProjection({
    overlayPlan,
    nodes: overlayPlan.nodes ?? [],
    segments,
    isConnectorNode: isSupplementConnectorJunctionNode,
  });
  const connectorJunctionProgression = createConnectorJunctionProgressionCandidates({
    nodes: overlayPlan.nodes ?? [],
    segments,
    connectorOnlyParentAnchoredProjection,
  });
  for (const proxy of supplementConnectorJunctionProxies) {
    const physicalArmIds = [...(
      connectorJunctionProgression.physicalArmIdsByProxyId.get(String(proxy.id)) ?? []
    )].sort();
    proxy.physicalArmIds = physicalArmIds;
    proxy.physicalArmCount = physicalArmIds.length;
  }
  effectiveRooms.push(...supplementRooms);
  // Connector-owned junctions are assembly identities, not rooms. Keep them
  // in the materialization graph so exact physical sockets can resolve while
  // exposing them through a dedicated facade that cannot leak into room
  // rendering, minimap discovery, encounters, rewards, or progression bands.
  const materializationRooms = [...effectiveRooms, ...connectorJunctionProxies];
  const roomById = new Map(materializationRooms.map((room) => [room.id, room]));
  const footprints = effectiveRooms
    .filter((room) => !room.suppressRoomGeometry && !room.isConnectorJunctionProxy)
    .map((room) => ({
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
  // Authored connector variants were selected and accepted against the base
  // room footprints before augmentation. Preserve that immutable construction
  // domain: adding supplemental rooms here can retroactively invalidate a V1
  // slope/lift side even though the planner kept those rooms clear of the
  // connector's exact protected volumes. Newly materialized supplemental plans
  // receive the complete effective footprint set in their own factories below.
  const routeStationGraphPlans = corridorStations.stations.map((station) => (
    createCorridorStationGraphPlan(station, tileSize, footprints)
  ));
  effectiveConnections.push(...routeStationGraphPlans);

  const paddingOperationIds = new Set(operations
    .filter((operation) => operationType(operation) === 'edgePadding')
    .map((operation) => operation.id));
  const errors = [];
  const materializationFailures = [];
  const recordMaterializationError = (error, context = {}) => {
    errors.push(error?.message ?? String(error));
    const failure = routeNetworkMaterializationFailure(error, context);
    if (failure) materializationFailures.push(failure);
  };
  errors.push(...corridorStations.errors);
  errors.push(...connectorJunctionProgression.errors);
  const materializedPaddingConnectionIds = [];
  const materializedOptionalConnectionIds = [];
  const materializedRouteNetworkConnectionIds = [];
  const materializedRouteStationGraphConnectionIds = routeStationGraphPlans.map((plan) => plan.id);
  const paddedConnections = [];
  const routeNetworks = [];

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
    const physicalPlans = [];
    let contractRejected = false;
    for (const [physicalOrdinal, segment] of operationSegments.entries()) {
      try {
        const physicalPlan = createSupplementConnectionPlan(
          segment,
          materializationRooms,
          tileSize,
          footprints,
        );
        const logicalGateId = operation.originalLogicalEdge?.gateId ?? plan.doorId ?? null;
        const segmentRequestsAuthoredVariant = physicalPlan.connectorVariantId != null;
        physicalPlans.push({
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
          // Existing flat v1/v2 padding continues to inherit the authored
          // parent's variant metadata. A future explicitly vertical segment
          // keeps the contract materialized from its own family and endpoints.
          connectorVariantId: segmentRequestsAuthoredVariant
            ? physicalPlan.connectorVariantId
            : plan.connectorVariantId ?? null,
          connectorVariant: segmentRequestsAuthoredVariant
            ? physicalPlan.connectorVariant
            : plan.connectorVariant ? clonePlainValue(plan.connectorVariant) : null,
          isPaddedByDungeonSupplement: true,
          isDungeonSupplement: true,
          // The parent logical plan owns Industrial's combined physical gallery.
          // These records expose the inserted room graph to navigation/minimap
          // consumers without assembling a second overlapping gallery shell.
          isSupplementGraphConnection: true,
          hostsLogicalGate: false,
          originalEdgeSnapshot: clonePlainValue(operation.originalEdgeSnapshot ?? null),
        });
      } catch (error) {
        recordMaterializationError(error);
        contractRejected = true;
        break;
      }
    }
    if (contractRejected) continue;
    const logicalGateId = operation.originalLogicalEdge?.gateId ?? plan.doorId ?? null;
    const gatePlacementSide = logicalGateId ? 'source' : null;
    if (logicalGateId) {
      // Every lock belongs at the corridor entrance so the player learns that
      // its objective is incomplete before committing to a padded route.
      const gateHost = physicalPlans.find((physicalPlan) => (
        physicalPlan.fromRoomId === plan.fromRoomId
      )) ?? physicalPlans[0];
      if (gateHost) {
        gateHost.doorId = logicalGateId;
        gateHost.hostsLogicalGate = true;
        gateHost.gatePlacementSide = gatePlacementSide;
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
    plan.augmentationOperationType = operation.type ?? null;
    plan.routeNetworkGrantId = operation.grantId ?? null;
    plan.isPaddedByDungeonSupplement = true;
    plan.logicalGateId = operation.originalLogicalEdge?.gateId ?? plan.doorId ?? null;
    plan.gatePlacementSide = gatePlacementSide;
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

  const routeNetworkOperations = operations.filter(isRouteNetworkOperation);
  const routeNetworkOperationIds = new Set(routeNetworkOperations.map((operation) => (
    String(operation.id)
  )));
  for (const operation of routeNetworkOperations) {
    const parentAnchoredForest = supportsParentAnchoredForest
      && operation?.realizationMode === 'parent-anchored-forest';
    if (operation?.realizationMode != null && !parentAnchoredForest) {
      errors.push(`Route network ${operation.id} declares unsupported realization mode ${operation.realizationMode}.`);
      continue;
    }
    const grant = objectiveCoverageGrantForOperationStationSide(
      grantsById.get(String(operation.grantId)),
      operation,
    );
    if (!operation.grantId || !grant) {
      errors.push(`Route network ${operation.id} references missing grant ${operation.grantId ?? '(none)'}.`);
      continue;
    }
    const declaredSegmentIds = new Set((operation.segmentIds ?? []).map(String));
    const operationSegments = segments.filter((segment) => (
      String(segmentOperationId(segment)) === String(operation.id)
      || declaredSegmentIds.has(String(segment.id))
    )).sort((first, second) => (
      number(first.physicalOrdinal) - number(second.physicalOrdinal)
      || String(first.id).localeCompare(String(second.id))
    ));
    if (operationSegments.length === 0) {
      errors.push(`Route network ${operation.id} has no physical segments.`);
      continue;
    }

    const expectedEndpointSocketIds = new Set(routeNetworkEndpointSocketIds(operation, grant));
    const minimumEndpointCount = parentAnchoredForest ? 1 : 2;
    if (expectedEndpointSocketIds.size < minimumEndpointCount) {
      errors.push(`Route network ${operation.id} must bind at least ${minimumEndpointCount} exact granted endpoint socket${minimumEndpointCount === 1 ? '' : 's'}.`);
      continue;
    }
    const normalizedSegments = [];
    const usedEndpointSocketCounts = new Map();
    let rejected = false;
    for (const segment of operationSegments) {
      try {
        const normalized = normalizeRouteNetworkSegment(
          segment,
          operation,
          grant,
          overlayNodeById,
          corridorStations.bySocketId,
        );
        for (const endpoint of [normalized.from, normalized.to]) {
          if (endpoint.kind === 'parentSocket') {
            const socketId = String(endpoint.socketId);
            usedEndpointSocketCounts.set(
              socketId,
              (usedEndpointSocketCounts.get(socketId) ?? 0) + 1,
            );
          }
        }
        normalizedSegments.push(normalized);
      } catch (error) {
        recordMaterializationError(error, {
          operationId: operation.id,
          grantId: operation.grantId,
          segmentId: segment.id,
          connectorFamily: supplementConnectorFamily(segment),
        });
        rejected = true;
        break;
      }
    }
    if (rejected) continue;
    const missingEndpointSocketIds = [...expectedEndpointSocketIds].filter((id) => (
      !usedEndpointSocketCounts.has(id)
    ));
    const ungrantedEndpointSocketIds = [...usedEndpointSocketCounts.keys()].filter((id) => (
      !expectedEndpointSocketIds.has(id)
    ));
    const duplicateEndpointSocketIds = [...usedEndpointSocketCounts]
      .filter(([, count]) => count !== 1)
      .map(([id]) => id);
    if (missingEndpointSocketIds.length > 0
      || ungrantedEndpointSocketIds.length > 0
      || duplicateEndpointSocketIds.length > 0) {
      errors.push(
        `Route network ${operation.id} endpoint binding mismatch (missing: ${missingEndpointSocketIds.join(', ') || 'none'}; ungranted: ${ungrantedEndpointSocketIds.join(', ') || 'none'}; repeated: ${duplicateEndpointSocketIds.join(', ') || 'none'}).`,
      );
      continue;
    }

    const physicalPlans = [];
    const componentBySegmentId = new Map((operation?.parentAnchoredComponents ?? [])
      .flatMap((component) => (component?.segmentIds ?? []).map((segmentId) => (
        [String(segmentId), component]
      ))));
    for (const segment of normalizedSegments) {
      try {
        const plan = applyConnectorJunctionProgressionHints(createSupplementConnectionPlan(
          segment,
          materializationRooms,
          tileSize,
          footprints,
          {
            routeNetworkOperation: operation,
            routeNetworkGrant: grant,
            requireEndpointSeams: strictV4ReleaseContract,
            allowExactQuantizedElevationDelta: strictV4ReleaseContract,
          },
        ), connectorJunctionProgression.candidatesByProxyId,
        connectorJunctionProgression.collapseRoomIdBySegmentId.get(String(segment.id)) ?? null);
        physicalPlans.push({
          ...plan,
          routeNetworkGrantId: operation.grantId,
          routeNetworkKind: operation.routeNetworkKind ?? grant.routeNetworkKind ?? null,
          topologyTemplateId: operation.topologyTemplateId ?? null,
          accessDomainId: operation.accessDomainId ?? grant.accessDomainId ?? null,
          progressionBandId: number(
            operation.progressionBandId,
            number(grant.progressionBandId),
          ),
          networkRole: segment.networkRole ?? segment.routeRole ?? null,
          routeNetworkRealizationMode: operation.realizationMode ?? null,
          routeNetworkLocalProgressionArcRealized:
            operation.localProgressionArcRealized ?? null,
          parentAnchoredDeclaredComponentIds: (operation.parentAnchoredComponents ?? [])
            .map(({ id }) => String(id)),
          parentAnchoredComponentId:
            componentBySegmentId.get(String(segment.id))?.id ?? null,
          parentAnchoredAttachmentSocketId:
            componentBySegmentId.get(String(segment.id))?.attachmentSocketId ?? null,
          parentAnchoredAttachmentSocketIds: clonePlainValue(
            componentBySegmentId.get(String(segment.id))?.attachmentSocketIds ?? [],
          ),
          parentAnchoredDeclaredNodeIds: clonePlainValue(
            componentBySegmentId.get(String(segment.id))?.nodeIds ?? [],
          ),
          parentAnchoredDeclaredSegmentIds: clonePlainValue(
            componentBySegmentId.get(String(segment.id))?.segmentIds ?? [],
          ),
          isRouteNetworkConnection: true,
          isPyramidPerimeterLoop: (
            operation.routeNetworkKind ?? grant.routeNetworkKind
          ) === 'landmark-perimeter-loop',
          cycleRankDelta: number(operation.cycleRankDelta),
          requiredForProgression: false,
        });
      } catch (error) {
        recordMaterializationError(error, {
          operationId: operation.id,
          grantId: operation.grantId,
          segmentId: segment.id,
          connectorFamily: supplementConnectorFamily(segment),
        });
        rejected = true;
        break;
      }
    }
    if (rejected) continue;

    effectiveConnections.push(...physicalPlans);
    for (const plan of physicalPlans) {
      addRoomSocket(roomById, plan.fromRoomId, plan.fromSocket, plan.id, plan.purpose);
      addRoomSocket(roomById, plan.toRoomId, plan.toSocket, plan.id, plan.purpose);
      materializedRouteNetworkConnectionIds.push(plan.id);
    }
    routeNetworks.push({
      operationId: operation.id,
      grantId: operation.grantId,
      routeNetworkKind: operation.routeNetworkKind ?? grant.routeNetworkKind ?? null,
      endpointSocketIds: [...expectedEndpointSocketIds],
      omittedEndpointSocketIds: [...(operation.omittedEndpointSocketIds ?? [])],
      realizationMode: operation.realizationMode ?? null,
      localProgressionArcRealized: operation.localProgressionArcRealized ?? null,
      parentAnchoredComponents: clonePlainValue(operation.parentAnchoredComponents ?? []),
      physicalConnectionIds: physicalPlans.map((plan) => plan.id),
      nodeIds: [...(operation.nodeIds ?? [])],
      topologyTemplateId: operation.topologyTemplateId ?? null,
      junctionKinds: [...(operation.junctionKinds ?? [])],
      elevationModes: [...(operation.elevationModes ?? [])],
      progressionBandId: operation.progressionBandId ?? grant.progressionBandId ?? null,
      accessDomainId: operation.accessDomainId ?? grant.accessDomainId ?? null,
      cycleRankDelta: number(operation.cycleRankDelta),
    });
  }

  const optionalSegments = segments.filter((segment) => !paddingOperationIds.has(
    segmentOperationId(segment),
  ) && !routeNetworkOperationIds.has(String(segmentOperationId(segment))));
  for (const segment of optionalSegments) {
    let plan = null;
    try {
      plan = applyConnectorJunctionProgressionHints(
        createSupplementConnectionPlan(segment, materializationRooms, tileSize, footprints),
        connectorJunctionProgression.candidatesByProxyId,
      );
    } catch (error) {
      recordMaterializationError(error);
      continue;
    }
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
    ...materializedRouteNetworkConnectionIds,
    ...materializedRouteStationGraphConnectionIds,
    ...materializedOptionalConnectionIds,
  ];
  const supplementalConnectionIdSet = new Set(supplementalConnectionIds.map(String));
  const supplementalPhysicalConnectionIds = effectiveConnections
    .filter((plan) => (
      supplementalConnectionIdSet.has(String(plan.id))
      && plan.isSupplementGraphConnection !== true
      && plan.graphOnly !== true
      && plan.connectorVariantConstraints?.graphOnly !== true
    ))
    .map((plan) => plan.id);
  const supplementalGraphOnlyConnectionIds = supplementalConnectionIds.filter((connectionId) => (
    !supplementalPhysicalConnectionIds.includes(connectionId)
  ));

  if (strictV4ContentContract && errors.length > 0) {
    return atomicIndustrialMaterializationRejection({
      rooms,
      connectionPlans,
      overlayPlan,
      errors,
      materializationFailures,
    });
  }
  selectOptionalV4StoryPresentation({
    supplementRooms,
    effectiveConnections,
    tileSize,
    enabled: overlayPlan.optionalPresentationEnabled !== false
      && overlayPlan.presentation?.optionalDecorationsEnabled !== false,
  });
  const assemblyOverlayPlan = createIndustrialAssemblyOverlayPlan(
    overlayPlan,
    [...supplementRooms, ...supplementConnectorJunctionProxies],
  );

  return {
    rooms: effectiveRooms,
    connectorJunctionProxies,
    connectionPlans: effectiveConnections,
    assemblyOverlayPlan,
    supplementalRoomIds: supplementRooms.map((room) => room.id),
    supplementalConnectorJunctionIds: supplementConnectorJunctionProxies.map(({ id }) => id),
    supplementalConnectionIds,
    supplementalPhysicalConnectionIds,
    supplementalGraphOnlyConnectionIds,
    diagnostics: {
      accepted: errors.length === 0,
      reason: errors.length === 0 ? 'materialized' : 'materialization-failed',
      errors,
      materializationFailures,
      roomCount: supplementRooms.length,
      connectorJunctionProxyCount: connectorJunctionProxies.length,
      supplementConnectorJunctionProxyCount: supplementConnectorJunctionProxies.filter(
        ({ kind }) => kind === 'supplementConnectorJunction',
      ).length,
      supplementConnectorModuleProxyCount: supplementConnectorJunctionProxies.filter(
        ({ kind }) => kind === 'supplementConnectorModule',
      ).length,
      connectionCount: supplementalPhysicalConnectionIds.length,
      totalConnectionRecordCount: supplementalConnectionIds.length,
      physicalConnectionCount: supplementalPhysicalConnectionIds.length,
      graphOnlyConnectionCount: supplementalGraphOnlyConnectionIds.length,
      paddingConnectionCount: materializedPaddingConnectionIds.length,
      routeNetworkConnectionCount: materializedRouteNetworkConnectionIds.length,
      routeStationGraphConnectionCount: materializedRouteStationGraphConnectionIds.length,
      routeStationGraphConnectionIds: materializedRouteStationGraphConnectionIds,
      optionalConnectionCount: materializedOptionalConnectionIds.length,
      paddedLogicalConnectionCount: paddedConnections.length,
      paddedConnections,
      routeNetworkCount: routeNetworks.length,
      routeNetworks,
    },
  };
}

export function createIndustrialSupplementRewardTiles(rooms = [], tileSize = 2.8) {
  return rooms.flatMap((room) => (room.augmentationAnchors ?? [])
    .filter((anchor) => ['reward', 'discovery'].includes(String(anchor.kind ?? '')))
    .map((anchor) => ({
      roomId: room.id,
      x: Math.round(number(anchor.position?.x, room.x * tileSize) / tileSize),
      elevation: number(anchor.position?.y, room.baseElevation),
      z: Math.round(number(anchor.position?.z, room.z * tileSize) / tileSize),
      id: String(anchor.id ?? `${room.id}:reward`),
      kind: String(anchor.kind ?? 'reward'),
      runtimeStateId: anchor.runtimeStateId ?? null,
      rewardProfileId: anchor.rewardProfileId ?? anchor.rewardRecipe?.rewardProfileId ?? null,
      rewardRecipe: clonePlainValue(anchor.rewardRecipe ?? anchor.discoveryRecipe ?? null),
      stateRecords: clonePlainValue(anchor.stateRecords ?? []),
      runtimeConsumerDescriptor: clonePlainValue(anchor.runtimeConsumerDescriptor ?? null),
      liveStateConsumers: clonePlainValue(anchor.liveStateConsumers ?? []),
    })));
}
