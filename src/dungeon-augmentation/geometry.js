import { cloneDungeonAugmentationValue } from './canonical.js';

const EPSILON = 1e-6;

export const DUNGEON_SUPPLEMENT_JUNCTION_GEOMETRY = Object.freeze({
  'through-t': Object.freeze({
    widthTiles: 5,
    depthTiles: 7,
    clearCoreWidthTiles: 3,
    clearCoreDepthTiles: 3,
    minimumActiveSocketCount: 3,
    graphAdjacency: 'at-grade-junction',
  }),
  crossroads: Object.freeze({
    widthTiles: 7,
    depthTiles: 7,
    clearCoreWidthTiles: 3,
    clearCoreDepthTiles: 3,
    minimumActiveSocketCount: 4,
    graphAdjacency: 'at-grade-junction',
  }),
  'staggered-cross': Object.freeze({
    widthTiles: 5,
    depthTiles: 13,
    clearCoreWidthTiles: 3,
    clearCoreDepthTiles: 9,
    minimumActiveSocketCount: 4,
    lateralSeparationTiles: 6,
    graphAdjacency: 'at-grade-junction',
  }),
  'fork-merge': Object.freeze({
    widthTiles: 5,
    depthTiles: 7,
    clearCoreWidthTiles: 3,
    clearCoreDepthTiles: 3,
    minimumActiveSocketCount: 3,
    graphAdjacency: 'paired-at-grade-junction',
  }),
  'stacked-interchange': Object.freeze({
    widthTiles: 9,
    depthTiles: 13,
    clearCoreWidthTiles: 3,
    clearCoreDepthTiles: 3,
    minimumActiveSocketCount: 3,
    transferHeightMeters: 5.6,
    graphAdjacency: 'explicit-vertical-transfer',
  }),
  'over-under': Object.freeze({
    widthTiles: 7,
    depthTiles: 7,
    clearCoreWidthTiles: 3,
    clearCoreDepthTiles: 3,
    minimumActiveSocketCount: 4,
    graphAdjacency: 'separate-elevations',
  }),
});

const DUNGEON_SUPPLEMENT_JUNCTION_ALIASES = Object.freeze({
  t: 'through-t',
  tee: 'through-t',
  throughT: 'through-t',
  'through-t': 'through-t',
  cross: 'crossroads',
  crossroads: 'crossroads',
  'cross-junction': 'crossroads',
  staggeredCross: 'staggered-cross',
  'staggered-cross': 'staggered-cross',
  forkMerge: 'fork-merge',
  'fork-merge': 'fork-merge',
  stackedInterchange: 'stacked-interchange',
  'stacked-interchange': 'stacked-interchange',
  overUnder: 'over-under',
  'over-under': 'over-under',
  'over-under-crossover': 'over-under',
});

export function normalizeDungeonJunctionKind(value) {
  return DUNGEON_SUPPLEMENT_JUNCTION_ALIASES[String(value ?? '')] ?? null;
}

export function toDungeonPoint(value = {}, fallbackY = 0) {
  const source = value?.position ?? value?.center ?? value ?? {};
  return {
    x: Number(source.x ?? 0),
    y: Number(source.y ?? source.elevation ?? value?.elevation ?? fallbackY ?? 0),
    z: Number(source.z ?? 0),
  };
}

export function toDungeonFacing(value = {}) {
  const source = value?.facing ?? value ?? {};
  const rawX = Number(source.x ?? source.facingX ?? value?.facingX ?? 0);
  const rawY = Number(source.y ?? source.facingY ?? value?.facingY ?? 0);
  const rawZ = Number(source.z ?? source.facingZ ?? value?.facingZ ?? 1);
  const horizontalLength = Math.hypot(rawX, rawZ);
  if (horizontalLength <= EPSILON) return { x: 0, y: rawY, z: 1 };
  return { x: rawX / horizontalLength, y: rawY, z: rawZ / horizontalLength };
}

export function addDungeonPoints(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scaleDungeonPoint(point, scalar) {
  return { x: point.x * scalar, y: point.y * scalar, z: point.z * scalar };
}

export function dungeonPointDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function rotationQuarterTurnsForFacing(facing) {
  const normalized = toDungeonFacing(facing);
  if (Math.abs(normalized.x) > Math.abs(normalized.z)) return normalized.x >= 0 ? 1 : 3;
  return normalized.z >= 0 ? 0 : 2;
}

export function rotateDungeonLocalPoint(point, quarterTurns = 0) {
  const normalized = ((Math.round(quarterTurns) % 4) + 4) % 4;
  const local = toDungeonPoint(point);
  if (normalized === 1) return { x: local.z, y: local.y, z: -local.x };
  if (normalized === 2) return { x: -local.x, y: local.y, z: -local.z };
  if (normalized === 3) return { x: -local.z, y: local.y, z: local.x };
  return local;
}

export function transformDungeonLocalPoint(localPoint, placement) {
  return addDungeonPoints(
    toDungeonPoint(placement?.center),
    rotateDungeonLocalPoint(localPoint, placement?.rotationQuarterTurns),
  );
}

export function transformDungeonLocalFacing(localFacing, placement) {
  return toDungeonFacing(rotateDungeonLocalPoint(localFacing, placement?.rotationQuarterTurns));
}

export function transformDungeonVolume(volume, placement, idPrefix = '') {
  const turns = ((Math.round(placement?.rotationQuarterTurns ?? 0) % 4) + 4) % 4;
  const sourceSize = volume?.size ?? {};
  // Grammar records intentionally use author-facing width/height/depth names,
  // while planned overlay volumes use renderer-neutral x/y/z axes. Accept
  // both spellings here so an authored room body cannot silently collapse to
  // a zero-sized volume before overlap validation.
  const sourceX = sourceSize.x ?? sourceSize.width ?? 0;
  const sourceY = sourceSize.y ?? sourceSize.height ?? 0;
  const sourceZ = sourceSize.z ?? sourceSize.depth ?? 0;
  const size = {
    x: Number(turns % 2 === 0 ? sourceX : sourceZ),
    y: Number(sourceY),
    z: Number(turns % 2 === 0 ? sourceZ : sourceX),
  };
  return {
    ...cloneDungeonAugmentationValue(volume),
    id: `${idPrefix}${volume?.id ?? 'volume'}`,
    center: transformDungeonLocalPoint(volume?.center, placement),
    size,
  };
}

function volumeFromBounds(bounds, fallbackId) {
  const minimum = bounds?.min ?? bounds?.minimum;
  const maximum = bounds?.max ?? bounds?.maximum;
  if (!minimum || !maximum) return null;
  const min = toDungeonPoint(minimum);
  const max = toDungeonPoint(maximum);
  return {
    id: String(bounds.id ?? fallbackId),
    ownerId: bounds.ownerId ?? null,
    center: { x: (min.x + max.x) * 0.5, y: (min.y + max.y) * 0.5, z: (min.z + max.z) * 0.5 },
    size: { x: Math.abs(max.x - min.x), y: Math.abs(max.y - min.y), z: Math.abs(max.z - min.z) },
    purpose: String(bounds.purpose ?? 'base-draft-protected'),
  };
}

export function normalizeDungeonVolume(volume, fallbackId = 'volume') {
  if (!volume || typeof volume !== 'object') return null;
  if (volume.min || volume.minimum) return volumeFromBounds(volume, fallbackId);
  const sizeSource = volume.size ?? volume.halfSize;
  if (!sizeSource) return null;
  const multiplier = volume.halfSize && !volume.size ? 2 : 1;
  const normalized = {
    id: String(volume.id ?? fallbackId),
    ownerId: volume.ownerId ?? null,
    center: toDungeonPoint(volume.center ?? volume),
    size: {
      x: Math.max(0, Number(sizeSource.x ?? sizeSource.width ?? 0) * multiplier),
      y: Math.max(0, Number(sizeSource.y ?? sizeSource.height ?? 0) * multiplier),
      z: Math.max(0, Number(sizeSource.z ?? sizeSource.depth ?? 0) * multiplier),
    },
    purpose: String(volume.purpose ?? 'base-draft-protected'),
  };
  return Object.values(normalized.size).every(Number.isFinite) ? normalized : null;
}

/**
 * Produces the renderer-neutral contract shared by planning, validation, and
 * assembly for V4 decision nodes. The record describes a clear walkable core;
 * it intentionally does not select materials or create Three.js objects.
 */
export function createDungeonJunctionGeometryRecord({
  id,
  nodeId = null,
  junctionKind,
  center = null,
  elevation = null,
  heightMeters = 3.6,
  tileSize = 2.8,
  throughSocketPairs = [],
  decisionSocketIds = [],
  activeSocketIds = [],
  operationId = null,
  accessDomainId = null,
  progressionBandId = null,
} = {}) {
  const normalizedKind = normalizeDungeonJunctionKind(junctionKind);
  if (!normalizedKind) return null;
  const specification = DUNGEON_SUPPLEMENT_JUNCTION_GEOMETRY[normalizedKind];
  const resolvedCenter = toDungeonPoint(center ?? {}, Number(elevation ?? 0));
  const resolvedHeight = Math.max(0, Number(heightMeters) || 3.6);
  const resolvedTileSize = Math.max(EPSILON, Number(tileSize) || 2.8);
  const normalizedPairs = (Array.isArray(throughSocketPairs) ? throughSocketPairs : [])
    .map((pair) => (Array.isArray(pair) ? pair.map(String) : []))
    .filter((pair) => pair.length === 2);
  const normalizedDecisionIds = [...new Set(
    (Array.isArray(decisionSocketIds) ? decisionSocketIds : []).map(String),
  )];
  const normalizedActiveIds = [...new Set(
    (Array.isArray(activeSocketIds) ? activeSocketIds : []).map(String),
  )];
  return {
    schema: 'ruindivex-dungeon-supplement-junction/v1',
    id: String(id ?? `${nodeId ?? 'junction'}:${normalizedKind}`),
    nodeId: nodeId == null ? null : String(nodeId),
    operationId: operationId == null ? null : String(operationId),
    junctionKind: normalizedKind,
    widthTiles: specification.widthTiles,
    depthTiles: specification.depthTiles,
    minimumActiveSocketCount: specification.minimumActiveSocketCount,
    lateralSeparationTiles: specification.lateralSeparationTiles ?? null,
    transferHeightMeters: specification.transferHeightMeters ?? null,
    graphAdjacency: specification.graphAdjacency,
    throughSocketPairs: normalizedPairs,
    decisionSocketIds: normalizedDecisionIds,
    activeSocketIds: normalizedActiveIds,
    countsAsMeaningfulStation:
      normalizedActiveIds.length >= specification.minimumActiveSocketCount,
    clearCoreVolume: {
      id: String(`${id ?? nodeId ?? 'junction'}:clear-core`),
      ownerId: nodeId == null ? null : String(nodeId),
      center: {
        x: resolvedCenter.x,
        y: resolvedCenter.y + resolvedHeight * 0.5,
        z: resolvedCenter.z,
      },
      size: {
        x: specification.clearCoreWidthTiles * resolvedTileSize,
        y: resolvedHeight,
        z: specification.clearCoreDepthTiles * resolvedTileSize,
      },
      purpose: 'junction-walkable-clear-core',
    },
    accessDomainId: accessDomainId == null ? null : String(accessDomainId),
    progressionBandId: progressionBandId == null ? null : Number(progressionBandId),
  };
}

/**
 * The only parent-room overlap a route network may claim at an attachment is
 * a three-tile doorway landing spanning one tile inward and one tile outward.
 */
export function createDungeonSocketLandingOverlapVolume(socket = {}, {
  id = null,
  tileSize = 2.8,
  widthTiles = 3,
  inwardTiles = 1,
  outwardTiles = 1,
  clearanceHeightMeters = 3.6,
  operationId = null,
  grantId = null,
} = {}) {
  const resolvedTileSize = Math.max(EPSILON, Number(tileSize) || 2.8);
  const position = toDungeonPoint(socket.position ?? socket, socket.elevation ?? 0);
  const facing = toDungeonFacing(socket.facing ?? socket);
  const facingX = Math.abs(facing.x) >= Math.abs(facing.z) ? Math.sign(facing.x) : 0;
  const facingZ = facingX === 0 ? Math.sign(facing.z) || 1 : 0;
  const inward = Math.max(0, Number(inwardTiles) || 0) * resolvedTileSize;
  const outward = Math.max(0, Number(outwardTiles) || 0) * resolvedTileSize;
  const depth = inward + outward;
  const centerOffset = (outward - inward) * 0.5;
  const width = Math.max(1, Number(widthTiles) || 3) * resolvedTileSize;
  const height = Math.max(EPSILON, Number(clearanceHeightMeters) || 3.6);
  const socketId = String(socket.id ?? socket.socketId ?? 'socket');
  return {
    id: String(id ?? `${socketId}:landing-overlap`),
    ownerId: socket.nodeId ?? socket.roomId ?? null,
    socketId,
    operationId: operationId == null ? null : String(operationId),
    grantId: grantId == null ? null : String(grantId),
    center: {
      x: position.x + facingX * centerOffset,
      y: position.y + height * 0.5,
      z: position.z + facingZ * centerOffset,
    },
    size: {
      x: facingX ? depth : width,
      y: height,
      z: facingZ ? depth : width,
    },
    facing: { x: facingX, y: 0, z: facingZ },
    widthTiles: Math.max(1, Number(widthTiles) || 3),
    inwardTiles: Math.max(0, Number(inwardTiles) || 0),
    outwardTiles: Math.max(0, Number(outwardTiles) || 0),
    bounded: true,
    purpose: 'socket-landing-overlap-grant',
  };
}

/**
 * Resolves the physical host-side threshold used by a landmark perimeter
 * attachment. The authored room socket remains the grant identity, while the
 * actual segment endpoint is aligned one complete approach span behind the
 * supplemental node socket. Keeping this transform in geometry lets planning
 * and strict validation reconstruct the same threshold without trusting a
 * serialized endpoint position.
 */
export function dungeonLandmarkSharedThresholdParentPosition(
  endpoint = {},
  nodeSocket = {},
  attachmentGapMeters = 5.6,
) {
  const facing = toDungeonFacing(endpoint?.facing ?? endpoint);
  const facingX = Math.abs(facing.x) >= Math.abs(facing.z)
    ? Math.sign(facing.x) || 1
    : 0;
  const facingZ = facingX === 0 ? Math.sign(facing.z) || 1 : 0;
  return {
    x: Number(nodeSocket?.position?.x ?? endpoint?.position?.x ?? 0)
      - facingX * Number(attachmentGapMeters),
    y: Number(endpoint?.position?.y ?? nodeSocket?.position?.y ?? 0),
    z: Number(nodeSocket?.position?.z ?? endpoint?.position?.z ?? 0)
      - facingZ * Number(attachmentGapMeters),
  };
}

/**
 * Builds the V4 physical ownership record for one route-network endpoint.
 *
 * A seam is deliberately larger than the legacy landing overlap: three lanes
 * span the doorway and five depth cells reserve two complete approach tiles on
 * either side of the exact socket threshold. `signedDepthTiles` is negative
 * inside the endpoint node and positive along the socket's outward facing.
 * The stable depth-major cell order is part of the serialized V4 contract.
 */
export function createDungeonRouteEndpointSeam(socket = {}, {
  id = null,
  segmentId = null,
  operationId = null,
  networkId = operationId,
  nodeId = socket.nodeId ?? socket.roomId ?? null,
  socketId = socket.id ?? socket.socketId ?? null,
  localSocketId = socket.localSocketId ?? null,
  role = 'from',
  tileSize = 2.8,
  widthTiles = 3,
  insideDepthTiles = 2,
  thresholdDepthTiles = 1,
  outsideDepthTiles = 2,
  clearanceHeightMeters = 5.6,
  elevationBand = socket.progressionBandId ?? socket.elevationBand ?? null,
  parentOwnerId = null,
} = {}) {
  const resolvedTileSize = Math.max(EPSILON, Number(tileSize) || 2.8);
  const stableMetric = (value) => Number(Number(value).toFixed(6));
  const stableGridCoordinate = (value) => Math.round(Number((
    stableMetric(value) / resolvedTileSize
  ).toFixed(6)));
  const resolvedWidthTiles = Math.max(1, Math.floor(Number(widthTiles) || 3));
  const resolvedInsideDepthTiles = Math.max(
    0,
    Math.floor(Number(insideDepthTiles) || 0),
  );
  // V4 owns one threshold row between its two inside and two outside rows.
  // Retain the option for call-shape compatibility, but never advertise a
  // larger depth than the factory actually serializes.
  const resolvedThresholdDepthTiles = 1;
  const resolvedOutsideDepthTiles = Math.max(
    0,
    Math.floor(Number(outsideDepthTiles) || 0),
  );
  const position = toDungeonPoint(socket.position ?? socket, socket.elevation ?? 0);
  const facing = toDungeonFacing(socket.facing ?? socket);
  const facingX = Math.abs(facing.x) >= Math.abs(facing.z) ? Math.sign(facing.x) || 1 : 0;
  const facingZ = facingX === 0 ? Math.sign(facing.z) || 1 : 0;
  const lateral = { x: -facingZ, y: 0, z: facingX };
  const resolvedSocketId = String(socketId ?? 'socket');
  const resolvedSegmentId = segmentId == null ? null : String(segmentId);
  const resolvedNodeId = nodeId == null ? null : String(nodeId);
  const resolvedOperationId = operationId == null ? null : String(operationId);
  const resolvedNetworkId = networkId == null ? resolvedOperationId : String(networkId);
  const resolvedRole = role === 'to' ? 'to' : 'from';
  const resolvedId = String(
    id ?? `${resolvedSegmentId ?? resolvedNetworkId ?? 'route-network'}:${resolvedRole}-endpoint-seam`,
  );
  const minimumLane = -Math.floor(resolvedWidthTiles / 2);
  const maximumLane = minimumLane + resolvedWidthTiles - 1;
  const minimumDepth = -resolvedInsideDepthTiles;
  const maximumDepth = resolvedOutsideDepthTiles;
  // The socket threshold can intentionally lie on a half-grid wall plane.
  // Quantizing every metric cell independently makes negative half-grid ties
  // round inconsistently as floating-point tails accumulate, which can skip or
  // duplicate grid identities inside an otherwise cardinal 3x5 seam. Resolve
  // the threshold identity once, then derive the complete lattice through
  // integer cardinal offsets. Metric positions remain the presentation and
  // overlap authority; these grid identities are the traversal authority.
  const thresholdGridX = stableGridCoordinate(position.x);
  const thresholdGridZ = stableGridCoordinate(position.z);
  const orderedCells = [];
  for (let signedDepthTiles = minimumDepth;
    signedDepthTiles <= maximumDepth;
    signedDepthTiles += 1) {
    for (let lane = minimumLane; lane <= maximumLane; lane += 1) {
      const x = stableMetric(position.x
        + facingX * signedDepthTiles * resolvedTileSize
        + lateral.x * lane * resolvedTileSize);
      const z = stableMetric(position.z
        + facingZ * signedDepthTiles * resolvedTileSize
        + lateral.z * lane * resolvedTileSize);
      orderedCells.push({
        id: `${resolvedId}:cell:${signedDepthTiles}:${lane}`,
        lane,
        signedDepthTiles,
        side: signedDepthTiles < 0
          ? 'inside'
          : signedDepthTiles > 0 ? 'outside' : 'threshold',
        position: { x, y: position.y, z },
        gridX: thresholdGridX
          + facingX * signedDepthTiles
          + lateral.x * lane,
        gridZ: thresholdGridZ
          + facingZ * signedDepthTiles
          + lateral.z * lane,
      });
    }
  }
  const depthTiles = resolvedInsideDepthTiles
    + resolvedThresholdDepthTiles
    + resolvedOutsideDepthTiles;
  const depthCenterOffsetTiles = (
    resolvedOutsideDepthTiles - resolvedInsideDepthTiles
  ) * 0.5;
  const clearanceHeight = Math.max(
    EPSILON,
    Number(clearanceHeightMeters) || 5.6,
  );
  const overlapEnvelope = {
    id: `${resolvedId}:overlap-envelope`,
    ownerId: resolvedId,
    center: {
      x: stableMetric(position.x + facingX * depthCenterOffsetTiles * resolvedTileSize),
      y: stableMetric(position.y + clearanceHeight * 0.5),
      z: stableMetric(position.z + facingZ * depthCenterOffsetTiles * resolvedTileSize),
    },
    size: {
      x: stableMetric(
        facingX ? depthTiles * resolvedTileSize : resolvedWidthTiles * resolvedTileSize,
      ),
      y: stableMetric(clearanceHeight),
      z: stableMetric(
        facingZ ? depthTiles * resolvedTileSize : resolvedWidthTiles * resolvedTileSize,
      ),
    },
    purpose: 'route-network-endpoint-seam-overlap-envelope',
    ...(parentOwnerId == null ? {} : { parentOwnerId: String(parentOwnerId) }),
  };
  return {
    schema: 'ruindivex-dungeon-route-endpoint-seam/v1',
    id: resolvedId,
    segmentId: resolvedSegmentId,
    operationId: resolvedOperationId,
    networkId: resolvedNetworkId,
    nodeId: resolvedNodeId,
    socketId: resolvedSocketId,
    localSocketId: localSocketId == null ? null : String(localSocketId),
    role: resolvedRole,
    position,
    facing: { x: facingX, y: 0, z: facingZ },
    elevationBand: elevationBand == null ? null : Number(elevationBand),
    tileSize: resolvedTileSize,
    widthTiles: resolvedWidthTiles,
    insideDepthTiles: resolvedInsideDepthTiles,
    thresholdDepthTiles: resolvedThresholdDepthTiles,
    outsideDepthTiles: resolvedOutsideDepthTiles,
    depthTiles,
    orderedCells,
    overlapEnvelope,
    ownerIds: {
      seamId: resolvedId,
      segmentId: resolvedSegmentId,
      nodeId: resolvedNodeId,
      socketId: resolvedSocketId,
    },
  };
}

export function dungeonVolumeOverlapWithinGrant(first, second, grant, tolerance = 1e-4) {
  const normalizedFirst = normalizeDungeonVolume(first, 'first');
  const normalizedSecond = normalizeDungeonVolume(second, 'second');
  const normalizedGrant = normalizeDungeonVolume(grant, 'grant');
  if (!normalizedFirst || !normalizedSecond || !normalizedGrant) return false;
  if (!dungeonVolumesOverlap(normalizedFirst, normalizedSecond, tolerance)) return false;
  return ['x', 'y', 'z'].every((axis) => {
    const overlapMinimum = Math.max(
      normalizedFirst.center[axis] - normalizedFirst.size[axis] * 0.5,
      normalizedSecond.center[axis] - normalizedSecond.size[axis] * 0.5,
    );
    const overlapMaximum = Math.min(
      normalizedFirst.center[axis] + normalizedFirst.size[axis] * 0.5,
      normalizedSecond.center[axis] + normalizedSecond.size[axis] * 0.5,
    );
    const grantMinimum = normalizedGrant.center[axis] - normalizedGrant.size[axis] * 0.5;
    const grantMaximum = normalizedGrant.center[axis] + normalizedGrant.size[axis] * 0.5;
    return overlapMinimum >= grantMinimum - tolerance
      && overlapMaximum <= grantMaximum + tolerance;
  });
}

/**
 * Returns true when the exact overlap between two volumes is covered by the
 * union of several bounded grants. Route-network corridor stations use an
 * adjacent doorway-landing grant and endpoint-module grant; a widened camera
 * clearance can legitimately straddle their shared plane without fitting
 * wholly inside either box by itself.
 */
export function dungeonVolumeOverlapWithinGrants(
  first,
  second,
  grants = [],
  tolerance = 1e-4,
) {
  const normalizedFirst = normalizeDungeonVolume(first, 'first');
  const normalizedSecond = normalizeDungeonVolume(second, 'second');
  if (!normalizedFirst || !normalizedSecond
    || !dungeonVolumesOverlap(normalizedFirst, normalizedSecond, tolerance)) return false;
  const normalizedGrants = (Array.isArray(grants) ? grants : [])
    .map((grant, index) => normalizeDungeonVolume(grant, `grant:${index}`))
    .filter(Boolean);
  if (normalizedGrants.length === 0) return false;
  if (normalizedGrants.some((grant) => (
    dungeonVolumeOverlapWithinGrant(
      normalizedFirst,
      normalizedSecond,
      grant,
      tolerance,
    )
  ))) return true;

  const intersectionBounds = Object.fromEntries(['x', 'y', 'z'].map((axis) => [
    axis,
    {
      minimum: Math.max(
        normalizedFirst.center[axis] - normalizedFirst.size[axis] * 0.5,
        normalizedSecond.center[axis] - normalizedSecond.size[axis] * 0.5,
      ),
      maximum: Math.min(
        normalizedFirst.center[axis] + normalizedFirst.size[axis] * 0.5,
        normalizedSecond.center[axis] + normalizedSecond.size[axis] * 0.5,
      ),
    },
  ]));
  const cutsByAxis = Object.fromEntries(['x', 'y', 'z'].map((axis) => {
    const { minimum, maximum } = intersectionBounds[axis];
    const cuts = new Set([minimum, maximum]);
    for (const grant of normalizedGrants) {
      const grantMinimum = grant.center[axis] - grant.size[axis] * 0.5;
      const grantMaximum = grant.center[axis] + grant.size[axis] * 0.5;
      if (grantMinimum > minimum + tolerance && grantMinimum < maximum - tolerance) {
        cuts.add(grantMinimum);
      }
      if (grantMaximum > minimum + tolerance && grantMaximum < maximum - tolerance) {
        cuts.add(grantMaximum);
      }
    }
    return [axis, [...cuts].sort((left, right) => left - right)];
  }));
  const intervals = (axis) => cutsByAxis[axis].slice(1).map((maximum, index) => ({
    minimum: cutsByAxis[axis][index],
    maximum,
  })).filter(({ minimum, maximum }) => maximum - minimum > tolerance);
  for (const x of intervals('x')) {
    for (const y of intervals('y')) {
      for (const z of intervals('z')) {
        const cell = { x, y, z };
        const covered = normalizedGrants.some((grant) => (
          ['x', 'y', 'z'].every((axis) => {
            const grantMinimum = grant.center[axis] - grant.size[axis] * 0.5;
            const grantMaximum = grant.center[axis] + grant.size[axis] * 0.5;
            return cell[axis].minimum >= grantMinimum - tolerance
              && cell[axis].maximum <= grantMaximum + tolerance;
          })
        ));
        if (!covered) return false;
      }
    }
  }
  return true;
}

function collectVolumeArray(target, values, prefix) {
  for (const [index, value] of (Array.isArray(values) ? values : []).entries()) {
    const volume = normalizeDungeonVolume(value, `${prefix}:${index}`);
    if (volume) target.push(volume);
  }
}

export function collectBaseDraftVolumes(baseDraft = {}, extensionRegions = []) {
  const volumes = [];
  collectVolumeArray(volumes, baseDraft.occupiedVolumes, 'base:occupied');
  collectVolumeArray(volumes, baseDraft.connectionOccupiedVolumes, 'base:connection:occupied');
  collectVolumeArray(volumes, baseDraft.connectionClearanceVolumes, 'base:connection:clearance');
  collectVolumeArray(volumes, baseDraft.connectionLandingVolumes, 'base:connection:landing');
  collectVolumeArray(volumes, baseDraft.protectedVolumes, 'base:protected');
  for (const [roomIndex, room] of (baseDraft.rooms ?? baseDraft.nodes ?? []).entries()) {
    collectVolumeArray(volumes, room?.occupiedVolumes, `room:${room?.id ?? roomIndex}:occupied`);
    const singular = normalizeDungeonVolume(
      room?.occupiedVolume ?? room?.bounds,
      `room:${room?.id ?? roomIndex}:body`,
    );
    if (singular) volumes.push(singular);
  }
  for (const [regionIndex, region] of (Array.isArray(extensionRegions) ? extensionRegions : []).entries()) {
    collectVolumeArray(volumes, region?.protectedVolumes, `region:${region?.id ?? regionIndex}:protected`);
  }
  return volumes;
}

export function dungeonVolumesOverlap(first, second, tolerance = 1e-4) {
  if (!first?.center || !first?.size || !second?.center || !second?.size) return false;
  return ['x', 'y', 'z'].every((axis) => (
    Math.abs(first.center[axis] - second.center[axis])
      < (first.size[axis] + second.size[axis]) * 0.5 - tolerance
  ));
}

export function createDungeonPolyline(rawPoints = [], fallbackStart = null, fallbackEnd = null) {
  const points = (Array.isArray(rawPoints) ? rawPoints : []).map((point) => toDungeonPoint(point));
  if (points.length < 2 && fallbackStart && fallbackEnd) {
    return [toDungeonPoint(fallbackStart), toDungeonPoint(fallbackEnd)];
  }
  return points;
}

export function measureDungeonPolyline(points = []) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += dungeonPointDistance(points[index - 1], points[index]);
  }
  return length;
}

export function sampleDungeonPolyline(points, ratio) {
  if (!Array.isArray(points) || points.length === 0) {
    return { point: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 }, distance: 0 };
  }
  if (points.length === 1) {
    return { point: { ...points[0] }, facing: { x: 0, y: 0, z: 1 }, distance: 0 };
  }
  const total = measureDungeonPolyline(points);
  const target = Math.max(0, Math.min(1, Number(ratio) || 0)) * total;
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = dungeonPointDistance(start, end);
    if (target <= traversed + segmentLength || index === points.length - 1) {
      const amount = segmentLength > EPSILON ? (target - traversed) / segmentLength : 0;
      const point = {
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
        z: start.z + (end.z - start.z) * amount,
      };
      return { point, facing: toDungeonFacing({ x: end.x - start.x, z: end.z - start.z }), distance: target };
    }
    traversed += segmentLength;
  }
  const end = points.at(-1);
  const before = points.at(-2);
  return {
    point: { ...end },
    facing: toDungeonFacing({ x: end.x - before.x, z: end.z - before.z }),
    distance: total,
  };
}
