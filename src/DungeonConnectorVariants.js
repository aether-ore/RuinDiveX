/**
 * Deterministic traversal contracts for the authored V1 dungeon's inter-room
 * connections. This module deliberately has no renderer or random-number
 * dependency: a connection's identity and geometry fully determine its result.
 */

export const DUNGEON_CONNECTOR_VARIANT_SCHEMA = 'ruindivex.dungeon-connector-variant/v2';

export const DUNGEON_CONNECTOR_VARIANT_IDS = Object.freeze({
  SERVICE_GALLERY: 'service_gallery_v1',
  CRESTED_SLOPE: 'crested_slope_v1',
  LADDER_GALLERY: 'ladder_gallery_v1',
  AUTOMATIC_LIFT: 'automatic_lift_gallery_v1',
});

export const DUNGEON_CONNECTOR_VARIANT_ORDER = Object.freeze([
  DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
  DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
  DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
  DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
]);

const ELEVATION_CONNECTOR_VARIANT_ORDER = Object.freeze([
  DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE,
  DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY,
  DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT,
]);

export const DUNGEON_CONNECTOR_ELEVATION_POLICY = Object.freeze({
  minimumElevationConnectorCount: 3,
  maximumElevationConnectorCount: 5,
  transferElevationMeters: 14,
  maximumDungeonVerticalSpanMeters: 56,
  maximumElevationTransfersPerRootPath: 4,
  slopeFlightCount: 2,
  slopeSegmentsPerFlight: 13,
  slopeRisePerFlightMeters: 7,
});

export const DUNGEON_CONNECTOR_CLEARANCE = Object.freeze({
  tileSizeMeters: 2.8,
  minimumContinuousGalleryWidthTiles: 3,
  minimumContinuousGalleryWidthMeters: 8.4,
  minimumPathTiles: 9,
  minimumStraightRunTiles: 7,
  // A switchback flight owns thirteen distinct ramp segments. Shorter legacy
  // spans may still use ladders/lifts, but must never be labelled as slopes.
  minimumSlopeStraightRunTiles: 13,
  minimumLiftStraightRunTiles: 10,
  minimumLandingWidthMeters: 8.4,
  minimumLandingDepthMeters: 8.4,
  minimumHeadroomMeters: 3.6,
  minimumApertureWidthMeters: 2.4,
  minimumApertureDepthMeters: 2.8,
  transferElevationMeters: DUNGEON_CONNECTOR_ELEVATION_POLICY.transferElevationMeters,
  slopeFlightCount: DUNGEON_CONNECTOR_ELEVATION_POLICY.slopeFlightCount,
  slopeSegmentsPerFlight: DUNGEON_CONNECTOR_ELEVATION_POLICY.slopeSegmentsPerFlight,
  slopeRisePerFlightMeters: DUNGEON_CONNECTOR_ELEVATION_POLICY.slopeRisePerFlightMeters,
  liftPlatformWidthMeters: 8.4,
  liftPlatformDepthMeters: 8.4,
  liftShaftWidthMeters: 11.2,
  liftShaftDepthMeters: 11.2,
  liftPlayerClearanceMeters: 3.6,
  maximumSlopeRisePerTileMeters: Number((7 / 13).toFixed(6)),
  endpointFlatBufferTiles: 2,
});

const EXTERIOR_ROOM_IDS = new Set(['hubTown', 'expeditionCamp']);
const EPSILON = 1e-6;
const GALLERY_LANE_OFFSET_OPTIONS = Object.freeze([
  Object.freeze([-1, 0, 1]),
  Object.freeze([0, 1, 2]),
  Object.freeze([-2, -1, 0]),
]);

export const DUNGEON_CONNECTOR_FOOTPRINT_RESERVATION_SCHEMA =
  'ruindivex.dungeon-connector-footprint-reservation/v1';

const FAMILY_RESERVATION_HALF_WIDTH_TILES = Object.freeze({
  [DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY]: 2,
  [DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE]: 7,
  [DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY]: 2,
  [DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT]: 3,
  unvaried: 2,
});

const VARIANT_DESCRIPTORS = {
  [DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY]: {
    traversalKind: 'walk',
    visualFamily: 'offset_pipe_service_gallery',
    elevationChange: false,
    allowedDirections: Object.freeze(['level']),
    automatic: false,
    decorativeArchFamily: 'v1_connector_cylinder_arch',
    decorativeArchSpacingTiles: 3,
  },
  [DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE]: {
    traversalKind: 'slope',
    visualFamily: 'supported_crest_gallery',
    elevationChange: true,
    allowedDirections: Object.freeze(['ascending', 'descending']),
    automatic: false,
    decorativeArchFamily: 'v1_connector_cylinder_arch',
    decorativeArchSpacingTiles: 3,
  },
  [DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY]: {
    traversalKind: 'ladder',
    visualFamily: 'single_ladder_transfer_gallery',
    elevationChange: true,
    allowedDirections: Object.freeze(['ascending', 'descending']),
    automatic: false,
    decorativeArchFamily: 'v1_connector_cylinder_arch',
    decorativeArchSpacingTiles: 3,
  },
  [DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT]: {
    traversalKind: 'automatic_lift',
    visualFamily: 'automatic_freight_lift_gallery',
    elevationChange: true,
    allowedDirections: Object.freeze(['ascending', 'descending']),
    automatic: true,
    decorativeArchFamily: 'v1_connector_cylinder_arch',
    decorativeArchSpacingTiles: 3,
  },
};

for (const descriptor of Object.values(VARIANT_DESCRIPTORS)) {
  Object.freeze(descriptor);
}

export const DUNGEON_CONNECTOR_VARIANTS = Object.freeze(VARIANT_DESCRIPTORS);

function clonePoint(point = {}) {
  return {
    x: Number(point.x ?? 0),
    z: Number(point.z ?? 0),
    ...(Number.isFinite(point.y) ? { y: Number(point.y) } : {}),
  };
}

function cloneSocket(socket = null) {
  return socket ? { ...socket } : null;
}

function stableHash(value = '') {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function canonicalConnectionGeometry(plan = {}) {
  const path = plan.bridgePath ?? plan.fullPath ?? [];
  return [
    plan.id ?? '',
    plan.logicalConnectionId ?? '',
    plan.fromRoomId ?? '',
    plan.toRoomId ?? '',
    plan.connectorType ?? '',
    Number(plan.level ?? 0),
    Number(plan.elevation ?? 0),
    path.map((point) => `${Number(point.x ?? 0)},${Number(point.z ?? 0)}`).join(';'),
    `${Number(plan.fromSocket?.x ?? 0)},${Number(plan.fromSocket?.z ?? 0)}`,
    `${Number(plan.toSocket?.x ?? 0)},${Number(plan.toSocket?.z ?? 0)}`,
  ].join('|');
}

export function computeDungeonConnectorStableHash(plan) {
  return stableHash(canonicalConnectionGeometry(plan));
}

function pointsAreCardinalNeighbors(a, b) {
  return Math.abs(Number(a.x) - Number(b.x)) + Math.abs(Number(a.z) - Number(b.z)) === 1;
}

export function findLongestConnectorStraightRun(path = []) {
  if (!Array.isArray(path) || path.length === 0) {
    return null;
  }
  if (path.length === 1) {
    return {
      startIndex: 0,
      endIndex: 0,
      lengthTiles: 1,
      axis: 'x',
      direction: 1,
    };
  }

  let best = null;
  let runStart = 0;
  let axis = null;
  let direction = 1;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    const nextAxis = Number(previous.x) !== Number(current.x) ? 'x' : 'z';
    const nextDirection = Math.sign(Number(current[nextAxis]) - Number(previous[nextAxis])) || 1;
    const contiguous = pointsAreCardinalNeighbors(previous, current);
    if (!contiguous || (axis !== null && (nextAxis !== axis || nextDirection !== direction))) {
      const endIndex = index - 1;
      const candidate = {
        startIndex: runStart,
        endIndex,
        lengthTiles: endIndex - runStart + 1,
        axis: axis ?? nextAxis,
        direction,
      };
      if (!best || candidate.lengthTiles > best.lengthTiles) best = candidate;
      runStart = contiguous ? index - 1 : index;
    }
    axis = nextAxis;
    direction = nextDirection;
  }

  const candidate = {
    startIndex: runStart,
    endIndex: path.length - 1,
    lengthTiles: path.length - runStart,
    axis: axis ?? 'x',
    direction,
  };
  if (!best || candidate.lengthTiles > best.lengthTiles) best = candidate;
  return best;
}

function normalizeRoomFootprint(footprint = {}) {
  if (
    Number.isFinite(footprint.minX)
    && Number.isFinite(footprint.maxX)
    && Number.isFinite(footprint.minZ)
    && Number.isFinite(footprint.maxZ)
  ) {
    return {
      roomId: footprint.roomId ?? footprint.id ?? null,
      minX: Number(footprint.minX),
      maxX: Number(footprint.maxX),
      minZ: Number(footprint.minZ),
      maxZ: Number(footprint.maxZ),
    };
  }
  if (
    Number.isFinite(footprint.x)
    && Number.isFinite(footprint.z)
    && Number.isFinite(footprint.width)
    && Number.isFinite(footprint.depth)
  ) {
    const halfWidth = Math.floor(Number(footprint.width) * 0.5);
    const halfDepth = Math.floor(Number(footprint.depth) * 0.5);
    return {
      roomId: footprint.roomId ?? footprint.id ?? null,
      minX: Number(footprint.x) - halfWidth,
      maxX: Number(footprint.x) + halfWidth,
      minZ: Number(footprint.z) - halfDepth,
      maxZ: Number(footprint.z) + halfDepth,
    };
  }
  return null;
}

function isPointInsideFootprint(point, footprint) {
  return Number(point.x) >= footprint.minX
    && Number(point.x) <= footprint.maxX
    && Number(point.z) >= footprint.minZ
    && Number(point.z) <= footprint.maxZ;
}

function collectEndpointBufferIndexes(path, exteriorMask, count, reverse = false) {
  const indexes = [];
  const start = reverse ? path.length - 1 : 0;
  const step = reverse ? -1 : 1;
  for (let index = start; index >= 0 && index < path.length; index += step) {
    if (!exteriorMask[index]) {
      if (indexes.length) break;
      continue;
    }
    if (indexes.length) {
      const previousIndex = indexes[indexes.length - 1];
      if (Math.abs(previousIndex - index) !== 1
        || !pointsAreCardinalNeighbors(path[previousIndex], path[index])) {
        break;
      }
    }
    indexes.push(index);
    if (indexes.length >= count) break;
  }
  return reverse ? indexes.reverse() : indexes;
}

/**
 * Finds a straight connector span that is guaranteed to remain outside every
 * authored room footprint. Two exterior tiles next to each room socket are
 * reserved as untouched, level threshold landings before any variant begins.
 * Returned indexes always refer to the original bridgePath.
 */
export function deriveDungeonConnectorSafeSpan(plan = {}, {
  roomFootprints = plan.connectorVariantConstraints?.roomFootprints ?? [],
  blockedLanePoints = plan.connectorVariantConstraints?.blockedLanePoints ?? [],
  endpointBufferTiles = plan.connectorVariantConstraints?.endpointFlatBufferTiles
    ?? DUNGEON_CONNECTOR_CLEARANCE.endpointFlatBufferTiles,
} = {}) {
  const path = plan.bridgePath ?? [];
  if (!Array.isArray(path) || path.length === 0) return null;
  const footprints = roomFootprints.map(normalizeRoomFootprint).filter(Boolean);
  const blockedLaneKeys = new Set(blockedLanePoints.map((point) => (
    `${Number(point.x)},${Number(point.z)}`
  )));
  const exteriorMask = path.map((point) => (
    !footprints.some((footprint) => isPointInsideFootprint(point, footprint))
  ));
  const bufferCount = Math.max(2, Math.floor(Number(endpointBufferTiles) || 0));
  const sourceBufferIndexes = collectEndpointBufferIndexes(path, exteriorMask, bufferCount, false);
  const destinationBufferIndexes = collectEndpointBufferIndexes(path, exteriorMask, bufferCount, true);
  if (sourceBufferIndexes.length < bufferCount || destinationBufferIndexes.length < bufferCount) {
    return null;
  }

  const firstCandidateIndex = sourceBufferIndexes[sourceBufferIndexes.length - 1] + 1;
  const lastCandidateIndex = destinationBufferIndexes[0] - 1;
  if (firstCandidateIndex > lastCandidateIndex) return null;

  let best = null;
  let chunkStart = null;
  const finishChunk = (chunkEnd) => {
    if (chunkStart === null || chunkEnd < chunkStart) return;
    const chunkPath = path.slice(chunkStart, chunkEnd + 1);
    const localRun = findLongestConnectorStraightRun(chunkPath);
    if (!localRun) return;
    const straightRun = {
      ...localRun,
      startIndex: chunkStart + localRun.startIndex,
      endIndex: chunkStart + localRun.endIndex,
    };
    const axisBetween = (a, b) => (
      Number(a?.x) !== Number(b?.x) ? 'x' : 'z'
    );
    if (straightRun.startIndex > 0
      && axisBetween(path[straightRun.startIndex - 1], path[straightRun.startIndex])
        !== straightRun.axis) {
      straightRun.startIndex += 2;
    }
    if (straightRun.endIndex < path.length - 1
      && axisBetween(path[straightRun.endIndex], path[straightRun.endIndex + 1])
        !== straightRun.axis) {
      straightRun.endIndex -= 2;
    }
    straightRun.lengthTiles = straightRun.endIndex - straightRun.startIndex + 1;
    if (straightRun.lengthTiles <= 0) return;
    const lateral = straightRun.axis === 'x'
      ? { x: 0, z: 1 }
      : { x: 1, z: 0 };
    let candidate = null;
    for (const laneOffsets of GALLERY_LANE_OFFSET_OPTIONS) {
      let segmentStart = null;
      const finishSegment = (segmentEnd) => {
        if (segmentStart === null || segmentEnd < segmentStart) return;
        const widthSafeRun = {
          ...straightRun,
          startIndex: segmentStart,
          endIndex: segmentEnd,
          lengthTiles: segmentEnd - segmentStart + 1,
          laneOffsets: [...laneOffsets],
        };
        if (!candidate
          || widthSafeRun.lengthTiles > candidate.lengthTiles
          || (widthSafeRun.lengthTiles === candidate.lengthTiles
            && widthSafeRun.startIndex < candidate.startIndex)) {
          candidate = widthSafeRun;
        }
      };
      for (let index = straightRun.startIndex; index <= straightRun.endIndex + 1; index += 1) {
        const point = path[index];
        const hasThreeLaneClearance = index <= straightRun.endIndex
          && laneOffsets.every((offset) => (
            !blockedLaneKeys.has(`${point.x + lateral.x * offset},${point.z + lateral.z * offset}`)
            && !footprints.some((footprint) => isPointInsideFootprint({
              x: point.x + lateral.x * offset,
              z: point.z + lateral.z * offset,
            }, footprint))
          ));
        if (hasThreeLaneClearance) {
          if (segmentStart === null) segmentStart = index;
        } else {
          finishSegment(index - 1);
          segmentStart = null;
        }
      }
    }
    if (!candidate) return;
    if (!best
      || candidate.lengthTiles > best.lengthTiles
      || (candidate.lengthTiles === best.lengthTiles && candidate.startIndex < best.startIndex)) {
      best = candidate;
    }
  };

  for (let index = firstCandidateIndex; index <= lastCandidateIndex + 1; index += 1) {
    const isExteriorCandidate = index <= lastCandidateIndex && exteriorMask[index];
    const followsPrevious = isExteriorCandidate && (
      chunkStart === null
      || (index > chunkStart && pointsAreCardinalNeighbors(path[index - 1], path[index]))
    );
    if (isExteriorCandidate && followsPrevious) {
      if (chunkStart === null) chunkStart = index;
      continue;
    }
    finishChunk(index - 1);
    chunkStart = isExteriorCandidate ? index : null;
  }
  if (!best) return null;

  const selectedSafePath = path.slice(best.startIndex, best.endIndex + 1).map(clonePoint);
  return freezeSerializable({
    selectedSafePath,
    selectedStraightRun: { ...best },
    selectedLaneOffsets: [...(best.laneOffsets ?? [-1, 0, 1])],
    sourceFlatBufferPath: sourceBufferIndexes.map((index) => clonePoint(path[index])),
    destinationFlatBufferPath: destinationBufferIndexes.map((index) => clonePoint(path[index])),
    sourceFlatBufferIndexes: [...sourceBufferIndexes],
    destinationFlatBufferIndexes: [...destinationBufferIndexes],
    endpointFlatBufferTiles: bufferCount,
    roomFootprints: footprints.map((footprint) => ({ ...footprint })),
    blockedLanePoints: blockedLanePoints.map(clonePoint),
  });
}

export function isDungeonConnectorVariantEligible(plan, {
  minimumPathTiles = DUNGEON_CONNECTOR_CLEARANCE.minimumPathTiles,
  minimumStraightRunTiles = DUNGEON_CONNECTOR_CLEARANCE.minimumStraightRunTiles,
} = {}) {
  if (!plan || plan.connectorType !== 'ground_corridor') return false;
  if (Number(plan.level ?? 0) !== 0 || !Number.isFinite(Number(plan.elevation ?? 0))) return false;
  if (plan.allowConnectorVariant === false) return false;
  if (EXTERIOR_ROOM_IDS.has(plan.fromRoomId) || EXTERIOR_ROOM_IDS.has(plan.toRoomId)) return false;
  const path = plan.bridgePath ?? [];
  if (!Array.isArray(path) || path.length < minimumPathTiles) return false;
  const run = deriveDungeonConnectorSafeSpan(plan)?.selectedStraightRun;
  return Boolean(run && run.lengthTiles >= minimumStraightRunTiles);
}

function freezeSerializable(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeSerializable(child);
  return Object.freeze(value);
}

function worldPoint(point, elevation, tileSize) {
  return {
    x: Number(point.x) * tileSize,
    y: elevation,
    z: Number(point.z) * tileSize,
  };
}

function directionForRun(run) {
  return run.axis === 'x'
    ? { x: run.direction, z: 0 }
    : { x: 0, z: run.direction };
}

function makeVolume({ id, center, axis, length, width, height, purpose }) {
  return {
    id,
    purpose,
    center: { ...center },
    size: {
      x: axis === 'x' ? length : width,
      y: height,
      z: axis === 'z' ? length : width,
    },
  };
}

function pointAt(path, index) {
  return clonePoint(path[Math.max(0, Math.min(path.length - 1, index))]);
}

function offsetGridPoint(point, facing, longitudinal = 0, lateral = 0) {
  return {
    x: Number(point.x) + Number(facing.x) * longitudinal - Number(facing.z) * lateral,
    z: Number(point.z) + Number(facing.z) * longitudinal + Number(facing.x) * lateral,
  };
}

function makeLanding({ id, role, point, elevation, facing, tileSize, purpose }) {
  return {
    id,
    role,
    purpose,
    gridPoint: clonePoint(point),
    center: worldPoint(point, elevation, tileSize),
    elevation,
    facing: { ...facing },
    widthMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumLandingWidthMeters,
    depthMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumLandingDepthMeters,
    clearHeightMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters,
    mustRemainFreeOfProps: true,
  };
}

function makeHeadroomVolume(landing, axis) {
  const clearHeight = landing.clearHeightMeters;
  return makeVolume({
    id: `${landing.id}:headroom`,
    center: {
      x: landing.center.x,
      y: landing.elevation + clearHeight * 0.5,
      z: landing.center.z,
    },
    axis,
    length: landing.depthMeters,
    width: landing.widthMeters,
    height: clearHeight,
    purpose: 'player_headroom',
  });
}

function makeAperture({ id, point, elevation, facing, tileSize, role }) {
  return {
    id,
    role,
    gridPoint: clonePoint(point),
    center: worldPoint(point, elevation, tileSize),
    facing: { ...facing },
    widthMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumApertureWidthMeters,
    depthMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumApertureDepthMeters,
    clearHeightMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters,
    requiresFloorOpening: true,
    requiresCeilingOpening: true,
    prohibitCoveringTile: true,
  };
}

function makeEndpointLandings(
  plan,
  path,
  tileSize,
  sourceElevation,
  destinationElevation,
  facing,
) {
  const firstPoint = path[0];
  const lastPoint = path[path.length - 1];
  return [
    makeLanding({
      id: `${plan.id}:landing:entry`,
      role: 'entry',
      point: firstPoint,
      elevation: sourceElevation,
      facing,
      tileSize,
      purpose: 'room_connector_transition',
    }),
    makeLanding({
      id: `${plan.id}:landing:exit`,
      role: 'exit',
      point: lastPoint,
      elevation: destinationElevation,
      facing: { x: -facing.x, z: -facing.z },
      tileSize,
      purpose: 'room_connector_transition',
    }),
  ];
}

function createServiceGalleryContract(plan, context) {
  const {
    path,
    run,
    tileSize,
    sourceElevation,
    destinationElevation,
    facing,
  } = context;
  const landings = makeEndpointLandings(
    plan,
    path,
    tileSize,
    sourceElevation,
    destinationElevation,
    facing,
  );
  return {
    landings,
    headroomVolumes: landings.map((landing) => makeHeadroomVolume(landing, run.axis)),
    apertures: [],
    sweptVolumes: [],
    mechanisms: [],
    construction: {
      galleryWidthTiles: 3,
      centerlineOffsetTiles: 1,
      sideAlcoves: true,
      overheadPipeClearanceMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters,
      supportStyle: 'v1_catwalk_posts_and_cross_braces',
      railingStyle: 'v1_industrial_railing',
      sourceElevation,
      destinationElevation,
      elevationDelta: 0,
    },
  };
}

function createSlopeContract(plan, context) {
  const {
    path,
    run,
    tileSize,
    sourceElevation,
    destinationElevation,
    elevationDelta,
    direction,
    facing,
  } = context;
  const signedFlightRise = elevationDelta / DUNGEON_CONNECTOR_CLEARANCE.slopeFlightCount;
  const intermediateElevation = sourceElevation + signedFlightRise;
  const segmentCount = DUNGEON_CONNECTOR_CLEARANCE.slopeSegmentsPerFlight;
  const firstFlightStart = pointAt(path, run.startIndex);
  const firstFlightEnd = offsetGridPoint(firstFlightStart, facing, segmentCount - 1, 0);
  const roomFootprints = plan.connectorVariantConstraints?.roomFootprints ?? [];
  const pointIntersectsRoom = (point) => roomFootprints.some((footprint) => (
    point.x >= footprint.minX
    && point.x <= footprint.maxX
    && point.z >= footprint.minZ
    && point.z <= footprint.maxZ
  ));
  const switchbackSideSign = [1, -1].find((sign) => {
    for (let longitudinal = -1; longitudinal <= run.endIndex - run.startIndex; longitudinal += 1) {
      for (let lateral = -1; lateral <= 7; lateral += 1) {
        if (pointIntersectsRoom(offsetGridPoint(
          firstFlightStart,
          facing,
          longitudinal,
          lateral * sign,
        ))) return false;
      }
    }
    return true;
  }) ?? null;
  const realizedSideSign = switchbackSideSign ?? 1;
  const lateralFlightSeparationTiles = 3;
  const switchbackLandingOrigin = offsetGridPoint(
    firstFlightStart,
    facing,
    segmentCount,
    0,
  );
  const switchbackLandingCenter = offsetGridPoint(
    switchbackLandingOrigin,
    facing,
    0,
    realizedSideSign * 1.5,
  );
  const secondFlightStart = offsetGridPoint(
    firstFlightStart,
    facing,
    segmentCount - 1,
    realizedSideSign * lateralFlightSeparationTiles,
  );
  const secondFlightEnd = offsetGridPoint(
    firstFlightStart,
    facing,
    0,
    realizedSideSign * lateralFlightSeparationTiles,
  );
  const destinationLandingOrigin = offsetGridPoint(
    firstFlightStart,
    facing,
    -1,
    realizedSideSign * lateralFlightSeparationTiles,
  );
  const destinationLandingCenter = offsetGridPoint(
    destinationLandingOrigin,
    facing,
    0,
    realizedSideSign * 1.5,
  );
  const destinationLaneOffsetTiles = realizedSideSign * 6;
  const destinationCrossoverOrigin = offsetGridPoint(
    firstFlightStart,
    facing,
    run.endIndex - run.startIndex,
    0,
  );
  const landings = [
    ...makeEndpointLandings(
      plan,
      path,
      tileSize,
      sourceElevation,
      destinationElevation,
      facing,
    ),
    makeLanding({
      id: `${plan.id}:landing:switchback`,
      role: 'slope_switchback',
      point: switchbackLandingCenter,
      elevation: intermediateElevation,
      facing: { x: -facing.x, z: -facing.z },
      tileSize,
      purpose: 'clear_switchback_turn',
    }),
    makeLanding({
      id: `${plan.id}:landing:slope-arrival`,
      role: 'slope_arrival',
      point: destinationLandingCenter,
      elevation: destinationElevation,
      facing,
      tileSize,
      purpose: 'clear_destination_transition',
    }),
  ];
  for (const landing of landings.filter((candidate) => (
    candidate.role === 'slope_switchback' || candidate.role === 'slope_arrival'
  ))) {
    if (run.axis === 'x') {
      landing.widthMeters = tileSize * 3;
      landing.depthMeters = tileSize * 4;
    } else {
      landing.widthMeters = tileSize * 4;
      landing.depthMeters = tileSize * 3;
    }
  }
  const makeFlight = ({ id, order, startPoint, endPoint, startElevation, endElevation }) => ({
    id,
    order,
    widthTiles: DUNGEON_CONNECTOR_CLEARANCE.minimumContinuousGalleryWidthTiles,
    segmentCount,
    riseMeters: endElevation - startElevation,
    risePerSegmentMeters: Number(((endElevation - startElevation)
      / segmentCount).toFixed(6)),
    startGridPoint: clonePoint(startPoint),
    endGridPoint: clonePoint(endPoint),
    start: worldPoint(startPoint, startElevation, tileSize),
    end: worldPoint(endPoint, endElevation, tileSize),
    startElevation,
    endElevation,
  });
  const flights = [
    makeFlight({
      id: `${plan.id}:slope-flight:a`,
      order: 0,
      startPoint: firstFlightStart,
      endPoint: firstFlightEnd,
      startElevation: sourceElevation,
      endElevation: intermediateElevation,
    }),
    makeFlight({
      id: `${plan.id}:slope-flight:b`,
      order: 1,
      startPoint: secondFlightStart,
      endPoint: secondFlightEnd,
      startElevation: intermediateElevation,
      endElevation: destinationElevation,
    }),
  ];
  return {
    landings,
    headroomVolumes: landings.map((landing) => makeHeadroomVolume(landing, run.axis)),
    apertures: [],
    sweptVolumes: [],
    mechanisms: [],
    construction: {
      direction,
      switchback: true,
      flights,
      flightCount: flights.length,
      segmentsPerFlight: segmentCount,
      risePerFlightMeters: DUNGEON_CONNECTOR_CLEARANCE.slopeRisePerFlightMeters,
      signedRisePerFlightMeters: signedFlightRise,
      switchbackSideSign,
      sourceFlightDirection: { ...facing },
      returnFlightDirection: { x: -facing.x, z: -facing.z },
      lateralCenterlineSeparationTiles: lateralFlightSeparationTiles,
      switchbackLandingOriginGridPoint: switchbackLandingOrigin,
      destinationLandingOriginGridPoint: destinationLandingOrigin,
      destinationLaneOffsetTiles,
      destinationCrossoverOriginGridPoint: destinationCrossoverOrigin,
      sourceElevation,
      intermediateElevation,
      destinationElevation,
      returnsToSourceElevation: false,
      destinationApproachRequired: true,
      surfaceStyle: 'v1_tiled_industrial_ramp',
      supportStyle: 'v1_girder_and_post_supports',
      noFloatingSlabs: true,
      continuousWithLandings: true,
    },
  };
}

function createLadderContract(plan, context) {
  const {
    path,
    run,
    tileSize,
    sourceElevation,
    destinationElevation,
    direction,
    facing,
  } = context;
  const bottomElevation = Math.min(sourceElevation, destinationElevation);
  const topElevation = Math.max(sourceElevation, destinationElevation);
  const ladderIndex = Math.floor((run.startIndex + run.endIndex) * 0.5);
  const ladderPoint = pointAt(path, ladderIndex);
  const endpointLandings = makeEndpointLandings(
    plan,
    path,
    tileSize,
    sourceElevation,
    destinationElevation,
    facing,
  );
  const transferLandings = [
    makeLanding({ id: `${plan.id}:landing:ladder-bottom`, role: 'ladder_bottom', point: ladderPoint, elevation: bottomElevation, facing, tileSize, purpose: 'clear_ladder_mount_and_dismount' }),
    makeLanding({ id: `${plan.id}:landing:ladder-top`, role: 'ladder_top', point: ladderPoint, elevation: topElevation, facing, tileSize, purpose: 'clear_ladder_mount_and_dismount' }),
  ];
  const landings = [...endpointLandings, ...transferLandings];
  const aperture = makeAperture({
    id: `${plan.id}:aperture:ladder`,
    point: ladderPoint,
    elevation: topElevation,
    facing,
    tileSize,
    role: 'ladder_top_opening',
  });
  const sweptVolume = makeVolume({
    id: `${plan.id}:swept:ladder`,
    center: worldPoint(
      ladderPoint,
      bottomElevation + (DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters
        + DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters) * 0.5,
      tileSize,
    ),
    axis: run.axis,
    length: DUNGEON_CONNECTOR_CLEARANCE.minimumApertureDepthMeters,
    width: DUNGEON_CONNECTOR_CLEARANCE.minimumApertureWidthMeters,
    height: DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters + DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters,
    purpose: 'ladder_player_sweep',
  });
  return {
    landings,
    headroomVolumes: landings.map((landing) => makeHeadroomVolume(landing, run.axis)),
    apertures: [aperture],
    sweptVolumes: [sweptVolume],
    mechanisms: [{
      id: `${plan.id}:ladder`,
      type: 'ladder',
      animationId: 'climbingLadder',
      direction,
      pathIndex: ladderIndex,
      gridPoint: clonePoint(ladderPoint),
      bottomElevation,
      topElevation,
      progressionSourceElevation: sourceElevation,
      progressionDestinationElevation: destinationElevation,
      facing: { ...facing },
      bottomLandingId: transferLandings[0].id,
      topLandingId: transferLandings[1].id,
      snapPlayerToLadderPlane: true,
      alignPlayerFacingOnMount: true,
      allowTopAndBottomMount: true,
      clearDismountDistanceMeters: 2.1,
    }],
    construction: {
      direction,
      sourceElevation,
      destinationElevation,
      bottomElevation,
      topElevation,
      supportStyle: 'v1_catwalk_posts_and_cross_braces',
      railingStyle: 'v1_industrial_railing',
      closeLowerBypass: true,
      removeTilesAboveEveryLadder: true,
      preserveClearBottomLanding: true,
    },
  };
}

function createLiftContract(plan, context) {
  const {
    path,
    run,
    tileSize,
    sourceElevation,
    destinationElevation,
    direction,
    facing,
  } = context;
  const bottomElevation = Math.min(sourceElevation, destinationElevation);
  const topElevation = Math.max(sourceElevation, destinationElevation);
  const liftIndex = Math.floor((run.startIndex + run.endIndex) * 0.5);
  const shaftStartPathIndex = Math.max(
    run.startIndex + 3,
    Math.min(run.endIndex - 6, liftIndex - 1),
  );
  const shaftEndPathIndex = shaftStartPathIndex + 3;
  const shaftOriginGridPoint = pointAt(path, shaftStartPathIndex);
  const shaftCenterGridPoint = offsetGridPoint(shaftOriginGridPoint, facing, 1.5, 0.5);
  const shaftCenter = worldPoint(shaftCenterGridPoint, bottomElevation, tileSize);
  const sourceLandingPathIndex = shaftStartPathIndex - 1;
  const destinationLandingPathIndex = shaftEndPathIndex + 1;
  const sourceLandingGridPoint = pointAt(path, sourceLandingPathIndex);
  const destinationLandingGridPoint = pointAt(path, destinationLandingPathIndex);
  const sourceLandingCenterGridPoint = offsetGridPoint(
    shaftOriginGridPoint,
    facing,
    -2,
    0,
  );
  const destinationLandingCenterGridPoint = offsetGridPoint(
    shaftOriginGridPoint,
    facing,
    5,
    0,
  );
  const endpointLandings = makeEndpointLandings(
    plan,
    path,
    tileSize,
    sourceElevation,
    destinationElevation,
    facing,
  );
  const sourceLanding = makeLanding({
    id: `${plan.id}:landing:lift-source`,
    role: sourceElevation === bottomElevation ? 'lift_bottom' : 'lift_top',
    point: sourceLandingCenterGridPoint,
    elevation: sourceElevation,
    facing,
    tileSize,
    purpose: 'automatic_lift_boarding_and_exit',
  });
  const destinationLanding = makeLanding({
    id: `${plan.id}:landing:lift-destination`,
    role: destinationElevation === bottomElevation ? 'lift_bottom' : 'lift_top',
    point: destinationLandingCenterGridPoint,
    elevation: destinationElevation,
    facing: { x: -facing.x, z: -facing.z },
    tileSize,
    purpose: 'automatic_lift_boarding_and_exit',
  });
  const liftLandings = sourceElevation === bottomElevation
    ? [sourceLanding, destinationLanding]
    : [destinationLanding, sourceLanding];
  const landings = [...endpointLandings, ...liftLandings];
  const aperture = makeAperture({
    id: `${plan.id}:aperture:lift`,
    point: shaftCenterGridPoint,
    elevation: topElevation,
    facing,
    tileSize,
    role: 'lift_shaft_opening',
  });
  aperture.widthMeters = DUNGEON_CONNECTOR_CLEARANCE.liftShaftWidthMeters;
  aperture.depthMeters = DUNGEON_CONNECTOR_CLEARANCE.liftShaftDepthMeters;
  const sweptVolume = makeVolume({
    id: `${plan.id}:swept:lift`,
    center: {
      x: shaftCenter.x,
      y: bottomElevation + (DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters
        + DUNGEON_CONNECTOR_CLEARANCE.liftPlayerClearanceMeters) * 0.5,
      z: shaftCenter.z,
    },
    axis: run.axis,
    length: DUNGEON_CONNECTOR_CLEARANCE.liftShaftDepthMeters,
    width: DUNGEON_CONNECTOR_CLEARANCE.liftShaftWidthMeters,
    height: DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters
      + DUNGEON_CONNECTOR_CLEARANCE.liftPlayerClearanceMeters,
    purpose: 'lift_platform_and_rider_sweep',
  });
  const platformWidthMeters = DUNGEON_CONNECTOR_CLEARANCE.liftPlatformWidthMeters;
  const platformDepthMeters = DUNGEON_CONNECTOR_CLEARANCE.liftPlatformDepthMeters;
  const shaftWidthMeters = DUNGEON_CONNECTOR_CLEARANCE.liftShaftWidthMeters;
  const shaftDepthMeters = DUNGEON_CONNECTOR_CLEARANCE.liftShaftDepthMeters;
  const landingSillDepthMeters = (shaftDepthMeters - platformDepthMeters) * 0.5;
  const sillThicknessMeters = 0.28;
  const transverse = { x: -facing.z, z: facing.x };
  const createLandingSill = ({
    progressionRole,
    elevation,
    longitudinalCenter,
    carEdgeLongitudinal,
    landingEdgeLongitudinal,
  }) => {
    const endpoint = elevation === bottomElevation ? 'bottom' : 'top';
    const centerGridPoint = offsetGridPoint(
      shaftOriginGridPoint,
      facing,
      longitudinalCenter,
      0.5,
    );
    const carEdgeGridPoint = offsetGridPoint(
      shaftOriginGridPoint,
      facing,
      carEdgeLongitudinal,
      0.5,
    );
    const landingEdgeGridPoint = offsetGridPoint(
      shaftOriginGridPoint,
      facing,
      landingEdgeLongitudinal,
      0.5,
    );
    const center = worldPoint(centerGridPoint, elevation, tileSize);
    const supportTopY = elevation - sillThicknessMeters;
    const supportBaseY = Math.min(supportTopY - 0.6, bottomElevation);
    const supportHeight = supportTopY - supportBaseY;
    const supportTransverseOffset = platformWidthMeters * 0.5 - 0.32;
    const supportPosts = [-1, 1].map((sideSign, index) => ({
      id: `${plan.id}:lift:${progressionRole}:landing-sill:support:${index}`,
      center: {
        x: center.x + transverse.x * sideSign * supportTransverseOffset,
        y: supportBaseY + supportHeight * 0.5,
        z: center.z + transverse.z * sideSign * supportTransverseOffset,
      },
      size: { x: 0.24, y: supportHeight, z: 0.24 },
      baseY: supportBaseY,
      topY: supportTopY,
      purpose: 'automatic_connector_lift_landing_sill_support',
      blocksPlayer: true,
    }));
    const alongX = Math.abs(facing.x) > 0;
    return {
      id: `${plan.id}:lift:${progressionRole}:landing-sill`,
      connectionId: plan.id,
      progressionRole,
      endpoint,
      center,
      centerGridPoint,
      carEdgeCenter: worldPoint(carEdgeGridPoint, elevation, tileSize),
      landingEdgeCenter: worldPoint(landingEdgeGridPoint, elevation, tileSize),
      halfWidth: alongX ? landingSillDepthMeters * 0.5 : platformWidthMeters * 0.5,
      halfDepth: alongX ? platformWidthMeters * 0.5 : landingSillDepthMeters * 0.5,
      topY: elevation,
      baseY: elevation - sillThicknessMeters,
      thicknessMeters: sillThicknessMeters,
      supportBaseY,
      supportPosts,
      spanMeters: platformWidthMeters,
      bridgeDepthMeters: landingSillDepthMeters,
      blocksBelow: false,
      purpose: 'automatic_connector_lift_flush_landing_sill',
      requiredTraversalAction: 'automatic_lift',
    };
  };
  const sourceLandingSill = createLandingSill({
    progressionRole: 'source',
    elevation: sourceElevation,
    longitudinalCenter: -0.25,
    carEdgeLongitudinal: 0,
    landingEdgeLongitudinal: -0.5,
  });
  const destinationLandingSill = createLandingSill({
    progressionRole: 'destination',
    elevation: destinationElevation,
    longitudinalCenter: 3.25,
    carEdgeLongitudinal: 3,
    landingEdgeLongitudinal: 3.5,
  });
  const landingSills = [sourceLandingSill, destinationLandingSill]
    .sort((first, second) => first.topY - second.topY);
  const shaftGridColumns = [];
  for (let longitudinal = 0; longitudinal < 4; longitudinal += 1) {
    for (const lateral of [-1, 0, 1, 2]) {
      shaftGridColumns.push(offsetGridPoint(
        shaftOriginGridPoint,
        facing,
        longitudinal,
        lateral,
      ));
    }
  }
  const liftShaft = {
    id: `${plan.id}:lift:shaft`,
    connectionId: plan.id,
    originGridPoint: shaftOriginGridPoint,
    centerGridPoint: shaftCenterGridPoint,
    center: {
      x: shaftCenter.x,
      y: sweptVolume.center.y,
      z: shaftCenter.z,
    },
    startPathIndex: shaftStartPathIndex,
    endPathIndex: shaftEndPathIndex,
    sourceLandingPathIndex,
    destinationLandingPathIndex,
    sourceLandingGridPoint,
    destinationLandingGridPoint,
    gridColumns: shaftGridColumns,
    widthMeters: shaftWidthMeters,
    depthMeters: shaftDepthMeters,
    bottomY: bottomElevation,
    topY: topElevation,
    ceilingY: topElevation + 4.2,
    headroomMeters: 4.2,
    apertureId: aperture.id,
    sweptVolumeId: sweptVolume.id,
  };
  const structuralVolumes = landingSills.flatMap((sill) => ([
    {
      id: `${sill.id}:structural-volume`,
      purpose: sill.purpose,
      center: {
        x: sill.center.x,
        y: sill.topY - sill.thicknessMeters * 0.5,
        z: sill.center.z,
      },
      size: {
        x: sill.halfWidth * 2,
        y: sill.thicknessMeters,
        z: sill.halfDepth * 2,
      },
    },
    ...sill.supportPosts.map((post) => ({
      id: `${post.id}:structural-volume`,
      purpose: post.purpose,
      center: { ...post.center },
      size: { ...post.size },
    })),
  ]));
  return {
    landings,
    headroomVolumes: landings.map((landing) => makeHeadroomVolume(landing, run.axis)),
    apertures: [aperture],
    sweptVolumes: [sweptVolume],
    structuralVolumes,
    liftShaft,
    landingSills,
    mechanisms: [{
      id: `${plan.id}:lift`,
      type: 'automatic_cargo_lift',
      direction,
      pathIndex: liftIndex,
      gridPoint: clonePoint(shaftCenterGridPoint),
      shaftId: liftShaft.id,
      landingSillIds: landingSills.map((sill) => sill.id),
      bottomElevation,
      topElevation,
      initialElevation: sourceElevation,
      progressionSourceElevation: sourceElevation,
      progressionDestinationElevation: destinationElevation,
      facing: { ...facing },
      platformWidthMeters,
      platformDepthMeters,
      riderClearanceMeters: DUNGEON_CONNECTOR_CLEARANCE.liftPlayerClearanceMeters,
      shaftWidthMeters,
      shaftDepthMeters,
      bottomLandingId: liftLandings.find((landing) => landing.role === 'lift_bottom').id,
      topLandingId: liftLandings.find((landing) => landing.role === 'lift_top').id,
      operation: 'automatic_continuous_shuttle',
      automatic: true,
      waitsForRiderAtLandings: true,
      recallMode: 'automatic_return_after_dwell',
      requiresConsole: false,
      requiresRecallControls: true,
      recallControlPlacement: 'beside_landing_outside_walkway',
      recallControlAnchors: [
        { id: `${plan.id}:lift-call:bottom`, landingId: liftLandings[0].id, elevation: bottomElevation },
        { id: `${plan.id}:lift-call:top`, landingId: liftLandings[1].id, elevation: topElevation },
      ],
      carrySupportedPlayer: true,
      speedMetersPerSecond: 1.8,
      dwellSeconds: 1.25,
    }],
    construction: {
      direction,
      sourceElevation,
      destinationElevation,
      bottomElevation,
      topElevation,
      supportStyle: 'v1_freight_lift_frame',
      railingStyle: 'v1_industrial_railing',
      closeLowerBypass: true,
      removeCeilingAcrossSweptVolume: true,
      shaftCeilingMode: 'enclosed_above_upper_landing',
      minimumShaftCeilingClearanceMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters,
      shaftWidthMeters: DUNGEON_CONNECTOR_CLEARANCE.liftShaftWidthMeters,
      shaftDepthMeters: DUNGEON_CONNECTOR_CLEARANCE.liftShaftDepthMeters,
      provideSlopedReturnToBaseElevation: false,
      destinationLandingMatchesRoomEntrance: true,
    },
  };
}

const CONTRACT_BUILDERS = {
  [DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY]: createServiceGalleryContract,
  [DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE]: createSlopeContract,
  [DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY]: createLadderContract,
  [DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT]: createLiftContract,
};

function resolveConnectorElevations(plan, variantId, {
  sourceElevation: sourceElevationOption,
  destinationElevation: destinationElevationOption,
  direction: directionOption,
} = {}) {
  const descriptor = DUNGEON_CONNECTOR_VARIANTS[variantId];
  const sourceElevation = Number(
    sourceElevationOption
      ?? plan.sourceElevation
      ?? plan.fromSocket?.elevation
      ?? plan.elevation
      ?? 0,
  );
  if (!Number.isFinite(sourceElevation)) {
    throw new TypeError(`Connection ${plan.id} has a non-finite source elevation.`);
  }
  if (!descriptor.elevationChange) {
    if (directionOption && directionOption !== 'level') {
      throw new RangeError(`Service connection ${plan.id} must use direction "level".`);
    }
    if (destinationElevationOption !== undefined
      && Math.abs(Number(destinationElevationOption) - sourceElevation) > EPSILON) {
      throw new RangeError(`Service connection ${plan.id} must have a zero elevation delta.`);
    }
    return {
      sourceElevation,
      destinationElevation: sourceElevation,
      elevationDelta: 0,
      direction: 'level',
    };
  }

  let direction = directionOption ?? plan.direction ?? plan.elevationDirection ?? null;
  const explicitDestination = destinationElevationOption ?? plan.destinationElevation;
  if (!direction && Number.isFinite(explicitDestination)) {
    direction = Number(explicitDestination) >= sourceElevation ? 'ascending' : 'descending';
  }
  direction ??= 'ascending';
  if (!descriptor.allowedDirections.includes(direction)) {
    throw new RangeError(`Connector ${plan.id} has invalid direction ${direction}.`);
  }
  const elevationDelta = direction === 'ascending'
    ? DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters
    : -DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters;
  const destinationElevation = sourceElevation + elevationDelta;
  if (explicitDestination !== undefined
    && Math.abs(Number(explicitDestination) - destinationElevation) > EPSILON) {
    throw new RangeError(
      `Connection ${plan.id} must transfer exactly ${elevationDelta} metres (${direction}).`,
    );
  }
  return { sourceElevation, destinationElevation, elevationDelta, direction };
}

function makeEndpointSummary(role, endpoint, elevation) {
  return {
    role,
    socketId: endpoint?.id ?? null,
    roomId: endpoint?.roomId ?? null,
    elevation,
    position: {
      x: Number(endpoint?.x ?? 0),
      y: elevation,
      z: Number(endpoint?.z ?? 0),
    },
  };
}

export function createDungeonConnectorVariantContract(plan, variantId, {
  tileSize = DUNGEON_CONNECTOR_CLEARANCE.tileSizeMeters,
  sourceElevation: sourceElevationOption,
  destinationElevation: destinationElevationOption,
  direction: directionOption,
} = {}) {
  if (!plan?.id) throw new TypeError('A stable connection plan id is required.');
  if (!DUNGEON_CONNECTOR_VARIANT_ORDER.includes(variantId)) {
    throw new RangeError(`Unknown dungeon connector variant: ${variantId}`);
  }
  const path = (plan.bridgePath ?? []).map(clonePoint);
  const safeSpan = deriveDungeonConnectorSafeSpan(plan);
  const run = safeSpan?.selectedStraightRun ?? null;
  if (!run || run.lengthTiles < DUNGEON_CONNECTOR_CLEARANCE.minimumStraightRunTiles) {
    throw new RangeError(`Connection ${plan.id} has no exterior straight run large enough for a connector variant.`);
  }
  const facing = directionForRun(run);
  const descriptor = DUNGEON_CONNECTOR_VARIANTS[variantId];
  if (
    descriptor.traversalKind === 'slope'
    && run.lengthTiles < DUNGEON_CONNECTOR_CLEARANCE.minimumSlopeStraightRunTiles
  ) {
    throw new RangeError(
      `Connection ${plan.id} needs ${DUNGEON_CONNECTOR_CLEARANCE.minimumSlopeStraightRunTiles} exterior straight tiles for a switchback slope.`,
    );
  }
  if (
    descriptor.traversalKind === 'automatic_lift'
    && run.lengthTiles < DUNGEON_CONNECTOR_CLEARANCE.minimumLiftStraightRunTiles
  ) {
    throw new RangeError(
      `Connection ${plan.id} needs ${DUNGEON_CONNECTOR_CLEARANCE.minimumLiftStraightRunTiles} exterior straight tiles for an automatic lift.`,
    );
  }
  const {
    sourceElevation,
    destinationElevation,
    elevationDelta,
    direction,
  } = resolveConnectorElevations(plan, variantId, {
    sourceElevation: sourceElevationOption,
    destinationElevation: destinationElevationOption,
    direction: directionOption,
  });
  const sourceEndpoint = {
    ...(cloneSocket(plan.fromSocket) ?? {}),
    elevation: sourceElevation,
    y: sourceElevation,
  };
  const destinationEndpoint = {
    ...(cloneSocket(plan.toSocket) ?? {}),
    elevation: destinationElevation,
    y: destinationElevation,
  };
  const sourceEndpointSummary = makeEndpointSummary('source', sourceEndpoint, sourceElevation);
  const destinationEndpointSummary = makeEndpointSummary(
    'destination',
    destinationEndpoint,
    destinationElevation,
  );
  const details = CONTRACT_BUILDERS[variantId](plan, {
    path,
    run,
    tileSize,
    sourceElevation,
    destinationElevation,
    elevationDelta,
    direction,
    facing,
  });
  const contract = {
    schema: DUNGEON_CONNECTOR_VARIANT_SCHEMA,
    id: `${plan.id}:variant:${variantId}`,
    connectionId: plan.id,
    logicalConnectionId: plan.logicalConnectionId ?? `${plan.fromRoomId}_${plan.toRoomId}`,
    variantId,
    traversalKind: descriptor.traversalKind,
    visualFamily: descriptor.visualFamily,
    elevationChange: descriptor.elevationChange,
    sourceElevation,
    destinationElevation,
    elevationDelta,
    direction,
    higherEndpoint: elevationDelta === 0
      ? null
      : (elevationDelta > 0 ? destinationEndpointSummary : sourceEndpointSummary),
    lowerEndpoint: elevationDelta === 0
      ? null
      : (elevationDelta > 0 ? sourceEndpointSummary : destinationEndpointSummary),
    automatic: descriptor.automatic,
    preservesRoomGeometry: true,
    preservesConnectionEndpoints: true,
    sourceSocketId: plan.fromSocket?.id ?? null,
    destinationSocketId: plan.toSocket?.id ?? null,
    sourceEndpoint,
    destinationEndpoint,
    pathContract: {
      originalFullPathLength: (plan.fullPath ?? []).length,
      originalBridgePathLength: path.length,
      selectedSafePath: safeSpan.selectedSafePath.map(clonePoint),
      orderedSourceToDestinationPath: path.map(clonePoint),
      sourceFlatBufferPath: safeSpan.sourceFlatBufferPath.map(clonePoint),
      destinationFlatBufferPath: safeSpan.destinationFlatBufferPath.map(clonePoint),
      sourceFlatBufferIndexes: [...safeSpan.sourceFlatBufferIndexes],
      destinationFlatBufferIndexes: [...safeSpan.destinationFlatBufferIndexes],
      endpointFlatBufferTiles: safeSpan.endpointFlatBufferTiles,
      selectedStraightRun: { ...run },
      selectedLaneOffsets: [...(safeSpan.selectedLaneOffsets ?? [-1, 0, 1])],
      selectedStraightRunStart: clonePoint(path[run.startIndex]),
      selectedStraightRunEnd: clonePoint(path[run.endIndex]),
      tileSizeMeters: tileSize,
      sourceElevation,
      destinationElevation,
      elevationDelta,
    },
    galleryEnvelope: {
      minimumContinuousWidthTiles: DUNGEON_CONNECTOR_CLEARANCE.minimumContinuousGalleryWidthTiles,
      minimumContinuousWidthMeters: Number((
        DUNGEON_CONNECTOR_CLEARANCE.minimumContinuousGalleryWidthTiles * tileSize
      ).toFixed(6)),
      appliesAcrossEntireTraversableLength: true,
      singleTileChokePointsPermitted: false,
    },
    decoration: {
      required: true,
      archFamily: descriptor.decorativeArchFamily,
      archSpacingTiles: descriptor.decorativeArchSpacingTiles,
      continueAcrossElevationTransitions: true,
    },
    clearance: {
      minimumLandingWidthMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumLandingWidthMeters,
      minimumLandingDepthMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumLandingDepthMeters,
      minimumHeadroomMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters,
      propExclusionRequiredAtEveryLanding: true,
    },
    occupiedVolumes: [
      ...(details.headroomVolumes ?? []),
      ...(details.sweptVolumes ?? []),
      ...(details.structuralVolumes ?? []),
    ],
    ...details,
  };
  return freezeSerializable(contract);
}

function clonePlanWithVariant(plan, assignment, options) {
  const fullPath = (plan.fullPath ?? []).map(clonePoint);
  const bridgePath = (plan.bridgePath ?? []).map(clonePoint);
  const sourceElevation = Number(assignment?.sourceElevation ?? plan.elevation ?? 0);
  const destinationElevation = Number(assignment?.destinationElevation ?? sourceElevation);
  const variantId = assignment?.variantId ?? null;
  const clonedPlan = {
    ...plan,
    elevation: sourceElevation,
    sourceElevation,
    destinationElevation,
    elevationDelta: destinationElevation - sourceElevation,
    direction: assignment?.direction ?? 'level',
    fullPath,
    bridgePath,
    fromSocket: plan.fromSocket ? {
      ...cloneSocket(plan.fromSocket),
      elevation: sourceElevation,
      y: sourceElevation,
    } : null,
    toSocket: plan.toSocket ? {
      ...cloneSocket(plan.toSocket),
      elevation: destinationElevation,
      y: destinationElevation,
    } : null,
    ...(plan.connectorVariantConstraints ? {
      connectorVariantConstraints: {
        ...plan.connectorVariantConstraints,
        roomFootprints: (plan.connectorVariantConstraints.roomFootprints ?? [])
          .map((footprint) => ({ ...footprint })),
        blockedLanePoints: (plan.connectorVariantConstraints.blockedLanePoints ?? [])
          .map(clonePoint),
      },
    } : {}),
  };
  clonedPlan.connectorVariant = variantId
    ? createDungeonConnectorVariantContract(clonedPlan, variantId, {
      ...options,
      sourceElevation,
      destinationElevation,
      direction: assignment.direction,
    })
    : null;
  clonedPlan.connectorVariantId = variantId ?? null;
  clonedPlan.higherEndpoint = clonedPlan.connectorVariant?.higherEndpoint ?? null;
  clonedPlan.lowerEndpoint = clonedPlan.connectorVariant?.lowerEndpoint ?? null;
  return clonedPlan;
}

function connectorReservationPointKey(point) {
  return `${Number(point.x).toFixed(3)},${Number(point.z).toFixed(3)}`;
}

function connectorReservationDirectionAt(path, index) {
  const point = path[index];
  const next = path[index + 1];
  const previous = path[index - 1];
  const dx = Number(next?.x ?? point.x) - Number(point.x)
    || Number(point.x) - Number(previous?.x ?? point.x);
  const dz = Number(next?.z ?? point.z) - Number(point.z)
    || Number(point.z) - Number(previous?.z ?? point.z);
  return { x: Math.sign(dx), z: Math.sign(dz) };
}

function pointInsideConnectorFootprint(point, footprint) {
  return Number(point.x) >= Number(footprint.minX)
    && Number(point.x) <= Number(footprint.maxX)
    && Number(point.z) >= Number(footprint.minZ)
    && Number(point.z) <= Number(footprint.maxZ);
}

function makeConnectorFamilyReservation(plan) {
  const path = plan.bridgePath ?? [];
  const contract = plan.connectorVariant ?? null;
  const variantId = plan.connectorVariantId ?? contract?.variantId ?? 'unvaried';
  const halfWidthTiles = FAMILY_RESERVATION_HALF_WIDTH_TILES[variantId]
    ?? FAMILY_RESERVATION_HALF_WIDTH_TILES.unvaried;
  const sourceElevation = Number(plan.sourceElevation ?? plan.elevation ?? 0);
  const destinationElevation = Number(plan.destinationElevation ?? sourceElevation);
  const endpointRoomIds = new Set([plan.fromRoomId, plan.toRoomId]);
  const roomFootprints = plan.connectorVariantConstraints?.roomFootprints ?? [];
  const endpointFootprints = roomFootprints.filter((footprint) => (
    endpointRoomIds.has(footprint.roomId)
  ));
  const columns = new Map();
  const addColumn = (point, purpose, {
    floorElevation = sourceElevation,
    minY = Number(floorElevation) - 0.6,
    maxY = Number(floorElevation) + DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters,
    permitEndpointRoom = false,
  } = {}) => {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.z))) return;
    if (!Number.isFinite(Number(minY)) || !Number.isFinite(Number(maxY))) return;
    if (!permitEndpointRoom && endpointFootprints.some((footprint) => (
      pointInsideConnectorFootprint(point, footprint)
    ))) return;
    const resolvedMinY = Math.min(Number(minY), Number(maxY));
    const resolvedMaxY = Math.max(Number(minY), Number(maxY));
    const key = `${connectorReservationPointKey(point)}@${resolvedMinY.toFixed(3)}:${resolvedMaxY.toFixed(3)}`;
    const existing = columns.get(key);
    if (existing) {
      if (!existing.purposes.includes(purpose)) existing.purposes.push(purpose);
      return;
    }
    columns.set(key, {
      x: Number(point.x),
      z: Number(point.z),
      minY: resolvedMinY,
      maxY: resolvedMaxY,
      purposes: [purpose],
    });
  };
  const addSquare = (center, radius, purpose, options = {}) => {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        addColumn(
          { x: Number(center.x) + dx, z: Number(center.z) + dz },
          purpose,
          options,
        );
      }
    }
  };

  const traversalKind = contract?.traversalKind ?? 'walk';
  const transferRun = contract?.pathContract?.selectedStraightRun ?? null;
  const ladderMechanism = contract?.mechanisms?.find((mechanism) => mechanism.type === 'ladder');
  const liftShaft = contract?.liftShaft ?? null;
  const approachElevationAt = (index) => {
    if (traversalKind === 'walk') return sourceElevation;
    if (traversalKind === 'slope') {
      if (index < Number(transferRun?.startIndex)) return sourceElevation;
      if (index >= Number(transferRun?.endIndex)) return destinationElevation;
      return null;
    }
    if (traversalKind === 'ladder') {
      const apertureIndex = Number(ladderMechanism?.pathIndex);
      if (index < apertureIndex) return sourceElevation;
      if (index > apertureIndex) return destinationElevation;
      return null;
    }
    if (traversalKind === 'automatic_lift') {
      if (index < Number(liftShaft?.startPathIndex)) return sourceElevation;
      if (index > Number(liftShaft?.endPathIndex)) return destinationElevation;
      return null;
    }
    return sourceElevation;
  };

  // Reserve each common gallery column at its realized floor layer. A single
  // min-to-max range falsely treats the empty air beside a ladder or lift as
  // structure and rejects legal stacked V1 catwalks.
  for (let index = 0; index < path.length; index += 1) {
    const floorElevation = approachElevationAt(index);
    if (!Number.isFinite(floorElevation)) continue;
    const center = path[index];
    const facing = connectorReservationDirectionAt(path, index);
    for (let lateral = -2; lateral <= 2; lateral += 1) {
      addColumn(offsetGridPoint(center, facing, 0, lateral), 'gallery-envelope', {
        floorElevation,
      });
    }
  }

  if (variantId === DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE) {
    const run = transferRun;
    const construction = contract?.construction;
    const start = construction?.flights?.[0]?.startGridPoint;
    const facing = construction?.sourceFlightDirection;
    const sideSign = Number(construction?.switchbackSideSign);
    if (run && start && facing && [1, -1].includes(sideSign)) {
      const segmentCount = Number(construction.segmentsPerFlight ?? 13);
      const intermediateElevation = Number(construction.intermediateElevation);
      const reserveFlight = (flight, flightDirection) => {
        if (!flight?.startGridPoint || !flightDirection) return;
        for (let segment = 0; segment < segmentCount; segment += 1) {
          const ratioStart = segment / segmentCount;
          const ratioEnd = (segment + 1) / segmentCount;
          const segmentStartElevation = Number(flight.startElevation)
            + (Number(flight.endElevation) - Number(flight.startElevation)) * ratioStart;
          const segmentEndElevation = Number(flight.startElevation)
            + (Number(flight.endElevation) - Number(flight.startElevation)) * ratioEnd;
          const center = offsetGridPoint(flight.startGridPoint, flightDirection, segment, 0);
          for (let lateral = -2; lateral <= 2; lateral += 1) {
            addColumn(
              offsetGridPoint(center, flightDirection, 0, lateral),
              'switchback-slope-flight-envelope',
              {
                minY: Math.min(segmentStartElevation, segmentEndElevation) - 0.6,
                maxY: Math.max(segmentStartElevation, segmentEndElevation) + 5.2,
                permitEndpointRoom: true,
              },
            );
          }
        }
      };
      reserveFlight(construction.flights?.[0], construction.sourceFlightDirection);
      reserveFlight(construction.flights?.[1], construction.returnFlightDirection);

      const addLanding = (origin, elevation, longitudinalValues, lateralValues, purpose) => {
        if (!origin || !Number.isFinite(elevation)) return;
        for (const longitudinal of longitudinalValues) {
          for (const lateral of lateralValues) {
            addColumn(offsetGridPoint(origin, facing, longitudinal, lateral), purpose, {
              floorElevation: elevation,
              maxY: elevation + 5.2,
              permitEndpointRoom: true,
            });
          }
        }
      };
      addLanding(
        construction.switchbackLandingOriginGridPoint,
        intermediateElevation,
        [-1, 0, 1],
        [0, sideSign, sideSign * 2, sideSign * 3],
        'switchback-slope-turn-landing',
      );
      addLanding(
        construction.destinationLandingOriginGridPoint,
        destinationElevation,
        [-1, 0, 1],
        [0, sideSign, sideSign * 2, sideSign * 3],
        'switchback-slope-destination-landing',
      );
      const destinationLaneOffset = Number(construction.destinationLaneOffsetTiles);
      const runLength = Number(run.endIndex) - Number(run.startIndex);
      for (let longitudinal = -1; longitudinal <= runLength; longitudinal += 1) {
        const laneCenter = offsetGridPoint(start, facing, longitudinal, destinationLaneOffset);
        for (let lateral = -2; lateral <= 2; lateral += 1) {
          addColumn(
            offsetGridPoint(laneCenter, facing, 0, lateral),
            'switchback-slope-destination-gallery',
            { floorElevation: destinationElevation, permitEndpointRoom: true },
          );
        }
      }
      addLanding(
        construction.destinationCrossoverOriginGridPoint,
        destinationElevation,
        [-1, 0, 1],
        Array.from({ length: Math.abs(destinationLaneOffset) + 1 }, (_, index) => (
          index * sideSign
        )),
        'switchback-slope-destination-crossover',
      );
    }
  } else if (variantId === DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY) {
    const ladderPoint = ladderMechanism?.gridPoint;
    if (ladderPoint) {
      const bottomElevation = Math.min(sourceElevation, destinationElevation);
      const topElevation = Math.max(sourceElevation, destinationElevation);
      addSquare(ladderPoint, 2, 'ladder-bottom-landing', { floorElevation: bottomElevation });
      addSquare(ladderPoint, 2, 'ladder-top-landing', { floorElevation: topElevation });
      addColumn(ladderPoint, 'ladder-player-sweep', {
        minY: bottomElevation - 0.6,
        maxY: topElevation + DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters,
        permitEndpointRoom: true,
      });
    }
  } else if (variantId === DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT) {
    for (const shaftColumn of liftShaft?.gridColumns ?? []) {
      addColumn(shaftColumn, 'lift-platform-and-rider-sweep', {
        minY: Math.min(sourceElevation, destinationElevation) - 0.6,
        maxY: Math.max(sourceElevation, destinationElevation)
          + DUNGEON_CONNECTOR_CLEARANCE.liftPlayerClearanceMeters,
        permitEndpointRoom: true,
      });
    }
    for (const [point, elevation, purpose] of [
      [liftShaft?.sourceLandingGridPoint, sourceElevation, 'lift-source-landing-and-control'],
      [liftShaft?.destinationLandingGridPoint, destinationElevation, 'lift-destination-landing-and-control'],
    ]) {
      if (point) addSquare(point, 2, purpose, { floorElevation: elevation });
    }
  }

  const serializedColumns = [...columns.values()].sort((first, second) => (
    first.x - second.x || first.z - second.z || first.minY - second.minY
  ));
  const minimumY = serializedColumns.length
    ? Math.min(...serializedColumns.map((column) => column.minY))
    : Math.min(sourceElevation, destinationElevation) - 0.6;
  const maximumY = serializedColumns.length
    ? Math.max(...serializedColumns.map((column) => column.maxY))
    : Math.max(sourceElevation, destinationElevation)
      + DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters;
  return {
    schema: DUNGEON_CONNECTOR_FOOTPRINT_RESERVATION_SCHEMA,
    connectionId: plan.id,
    connectorVariantId: variantId === 'unvaried' ? null : variantId,
    traversalKind,
    halfWidthTiles,
    minY: minimumY,
    maxY: maximumY,
    columns: serializedColumns,
  };
}

function connectorReservationVerticalRangesOverlap(first, second) {
  return first.minY < second.maxY - EPSILON
    && first.maxY > second.minY + EPSILON;
}

function isIntentionalParallelV1Pair(first, second) {
  if (first.fromRoomId !== second.fromRoomId || first.toRoomId !== second.toRoomId) return false;
  return (first.connectorType === 'upper_catwalk_bridge')
    !== (second.connectorType === 'upper_catwalk_bridge');
}

/**
 * Reserves the actual family envelope before scene assembly. The initial V1
 * route pass owns only a generic five-column gallery; this second, still-pure
 * planning pass expands slopes, ladder landings, and lift shafts/controls and
 * rejects a dungeon rather than discovering their collision after meshes and
 * mechanisms have already been instantiated.
 */
export function reserveDungeonConnectorFamilyFootprints(connectionPlans = []) {
  if (!Array.isArray(connectionPlans)) throw new TypeError('connectionPlans must be an array.');
  const reservations = connectionPlans.map(makeConnectorFamilyReservation);
  const reservationById = new Map(reservations.map((reservation) => [
    reservation.connectionId,
    reservation,
  ]));
  const roomCollisionCounts = new Map(connectionPlans.map((plan) => [plan.id, 0]));
  const connectorCollisionCounts = new Map(connectionPlans.map((plan) => [plan.id, 0]));
  const collisionPairs = [];
  const errors = [];

  for (let index = 0; index < connectionPlans.length; index += 1) {
    const plan = connectionPlans[index];
    const reservation = reservations[index];
    const unrelatedFootprints = (plan.connectorVariantConstraints?.roomFootprints ?? [])
      .filter((footprint) => (
        footprint.roomId !== plan.fromRoomId && footprint.roomId !== plan.toRoomId
      ));
    const collidingColumns = reservation.columns.filter((column) => (
      unrelatedFootprints.some((footprint) => pointInsideConnectorFootprint(column, footprint))
    ));
    roomCollisionCounts.set(plan.id, collidingColumns.length);
    if (collidingColumns.length) {
      errors.push(
        `${plan.id} family reservation intersects ${collidingColumns.length} unrelated room footprint column(s).`,
      );
    }
    if (plan.connectorVariantId === DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE
      && ![1, -1].includes(Number(plan.connectorVariant?.construction?.switchbackSideSign))) {
      errors.push(`${plan.id} has no collision-free switchback side reservation.`);
    }
  }

  for (let firstIndex = 0; firstIndex < connectionPlans.length; firstIndex += 1) {
    const firstPlan = connectionPlans[firstIndex];
    const firstReservation = reservations[firstIndex];
    const firstColumns = new Map();
    for (const column of firstReservation.columns) {
      const key = connectorReservationPointKey(column);
      const layers = firstColumns.get(key) ?? [];
      layers.push(column);
      firstColumns.set(key, layers);
    }
    for (let secondIndex = firstIndex + 1; secondIndex < connectionPlans.length; secondIndex += 1) {
      const secondPlan = connectionPlans[secondIndex];
      const secondReservation = reservations[secondIndex];
      if (isIntentionalParallelV1Pair(firstPlan, secondPlan)
        || !connectorReservationVerticalRangesOverlap(firstReservation, secondReservation)) {
        continue;
      }
      const overlappingColumns = secondReservation.columns.filter((column) => (
        (firstColumns.get(connectorReservationPointKey(column)) ?? []).some((firstColumn) => (
          connectorReservationVerticalRangesOverlap(firstColumn, column)
        ))
      ));
      if (!overlappingColumns.length) continue;
      connectorCollisionCounts.set(
        firstPlan.id,
        connectorCollisionCounts.get(firstPlan.id) + overlappingColumns.length,
      );
      connectorCollisionCounts.set(
        secondPlan.id,
        connectorCollisionCounts.get(secondPlan.id) + overlappingColumns.length,
      );
      collisionPairs.push({
        firstConnectionId: firstPlan.id,
        secondConnectionId: secondPlan.id,
        overlappingColumnCount: overlappingColumns.length,
        sampleColumn: {
          x: overlappingColumns[0].x,
          z: overlappingColumns[0].z,
        },
      });
      errors.push(
        `${firstPlan.id} and ${secondPlan.id} family reservations overlap in ${overlappingColumns.length} column(s).`,
      );
    }
  }

  const plannedConnections = connectionPlans.map((plan) => {
    const reservation = reservationById.get(plan.id);
    const familyReservation = {
      schema: reservation.schema,
      connectionId: plan.id,
      connectorVariantId: reservation.connectorVariantId,
      traversalKind: reservation.traversalKind,
      halfWidthTiles: reservation.halfWidthTiles,
      footprintColumnCount: reservation.columns.length,
      roomCollisionCount: roomCollisionCounts.get(plan.id),
      connectorCollisionCount: connectorCollisionCounts.get(plan.id),
      minY: reservation.minY,
      maxY: reservation.maxY,
    };
    return {
      ...plan,
      connectorVariantConstraints: {
        ...(plan.connectorVariantConstraints ?? {}),
        familyReservation,
      },
      familyReservedFootprintColumns: reservation.columns.map((column) => ({
        ...column,
        purposes: [...column.purposes],
      })),
    };
  });
  const uniqueErrors = [...new Set(errors)];
  return {
    connectionPlans: plannedConnections,
    diagnostics: freezeSerializable({
      schema: DUNGEON_CONNECTOR_FOOTPRINT_RESERVATION_SCHEMA,
      accepted: uniqueErrors.length === 0,
      errors: uniqueErrors,
      connectionCount: connectionPlans.length,
      collisionPairs,
      reservations: plannedConnections.map((plan) => ({
        ...plan.connectorVariantConstraints.familyReservation,
      })),
    }),
  };
}

function makeDirectedPairKey(plan) {
  return `${String(plan.fromRoomId)}\u0000${String(plan.toRoomId)}`;
}

function makeCombinations(items, count) {
  const result = [];
  const visit = (start, selected) => {
    if (selected.length === count) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= items.length - (count - selected.length); index += 1) {
      selected.push(items[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return result;
}

function isOptionalBranchConnectionPlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (plan.requiredForProgression === false) return true;
  const classification = String(
    plan.routeClassification
      ?? plan.progressionClassification
      ?? plan.purpose
      ?? '',
  ).trim().toLowerCase();
  return classification === 'optional_branch'
    || classification === 'optional-branch'
    || classification === 'optional_reward_branch'
    || classification === 'optional-reward-branch';
}

function isMainRouteConnectionPlan(plan) {
  return !isOptionalBranchConnectionPlan(plan);
}

function collectGroundPlans(connectionPlans) {
  return connectionPlans.filter((plan) => plan.connectorType === 'ground_corridor');
}

function propagateRoomElevations(connectionPlans, deltaByConnectionId, initialRoomElevations = {}) {
  const groundPlans = collectGroundPlans(connectionPlans);
  const destinationIds = new Set(groundPlans.map((plan) => plan.toRoomId));
  const elevations = new Map(
    Object.entries(initialRoomElevations).map(([roomId, elevation]) => [roomId, Number(elevation)]),
  );
  for (const plan of groundPlans) {
    if (!destinationIds.has(plan.fromRoomId) && !elevations.has(plan.fromRoomId)) {
      elevations.set(plan.fromRoomId, Number(plan.sourceElevation ?? plan.elevation ?? 0));
    }
  }
  const errors = [];
  let changed = true;
  for (let pass = 0; pass <= groundPlans.length && changed; pass += 1) {
    changed = false;
    for (const plan of groundPlans) {
      if (!elevations.has(plan.fromRoomId)) continue;
      const destinationElevation = elevations.get(plan.fromRoomId)
        + Number(deltaByConnectionId.get(plan.id) ?? 0);
      if (!elevations.has(plan.toRoomId)) {
        elevations.set(plan.toRoomId, destinationElevation);
        changed = true;
      } else if (Math.abs(elevations.get(plan.toRoomId) - destinationElevation) > EPSILON) {
        errors.push(
          `Room ${plan.toRoomId} receives conflicting elevations through connection ${plan.id}.`,
        );
      }
    }
  }
  for (const plan of groundPlans) {
    if (!elevations.has(plan.fromRoomId) || !elevations.has(plan.toRoomId)) {
      errors.push(`Connection ${plan.id} belongs to an unresolved or cyclic room-elevation graph.`);
    }
  }
  const values = [...elevations.values()];
  const minimumElevation = values.length ? Math.min(...values) : 0;
  const maximumElevation = values.length ? Math.max(...values) : 0;
  return {
    elevations,
    errors: [...new Set(errors)],
    minimumElevation,
    maximumElevation,
    verticalSpan: maximumElevation - minimumElevation,
  };
}

function countMaximumElevationTransfersOnRootPath(connectionPlans, selectedIds) {
  const groundPlans = collectGroundPlans(connectionPlans);
  const destinationIds = new Set(groundPlans.map((plan) => plan.toRoomId));
  const roots = [...new Set(groundPlans
    .map((plan) => plan.fromRoomId)
    .filter((roomId) => !destinationIds.has(roomId)))];
  const outgoing = new Map();
  for (const plan of groundPlans) {
    const entries = outgoing.get(plan.fromRoomId) ?? [];
    entries.push(plan);
    outgoing.set(plan.fromRoomId, entries);
  }
  let maximum = 0;
  const visit = (roomId, count, visitedRooms) => {
    maximum = Math.max(maximum, count);
    for (const plan of outgoing.get(roomId) ?? []) {
      // Shortcuts and direct returns deliberately close loops. A root-to-leaf
      // progression path is a simple room path; revisiting the hub must not
      // inflate the transfer count once per cycle.
      if (visitedRooms.has(plan.toRoomId)) continue;
      const nextVisited = new Set(visitedRooms);
      nextVisited.add(plan.toRoomId);
      visit(
        plan.toRoomId,
        count + (selectedIds.has(plan.id) ? 1 : 0),
        nextVisited,
      );
    }
  };
  for (const root of roots) visit(root, 0, new Set([root]));
  return maximum;
}

function chooseSignedElevationAssignments(connectionPlans, candidates, collectionHash, options) {
  const policy = DUNGEON_CONNECTOR_ELEVATION_POLICY;
  const assignmentAttempt = Math.max(0, Math.trunc(Number(options.assignmentAttempt) || 0));
  const requestedOption = options.elevationConnectorCount;
  if (requestedOption !== undefined
    && (!Number.isInteger(requestedOption)
      || requestedOption < policy.minimumElevationConnectorCount
      || requestedOption > policy.maximumElevationConnectorCount)) {
    throw new RangeError('elevationConnectorCount must be an integer from 3 through 5.');
  }
  const requestedCount = Math.min(
    candidates.length,
    requestedOption ?? (policy.minimumElevationConnectorCount
      + (collectionHash % (policy.maximumElevationConnectorCount
        - policy.minimumElevationConnectorCount + 1))),
  );
  const maximumSpan = Number(
    options.maximumDungeonVerticalSpanMeters
      ?? policy.maximumDungeonVerticalSpanMeters,
  );
  const maximumTransfers = Number(
    options.maximumElevationTransfersPerRootPath
      ?? policy.maximumElevationTransfersPerRootPath,
  );

  for (let count = requestedCount; count >= policy.minimumElevationConnectorCount; count -= 1) {
    // The first three transfers are the mandatory slope/ladder/lift set and
    // must live on progression routes. Any fourth or fifth transfer is an
    // optional embellishment; prefer authored side branches for those slots
    // without making a branch mandatory when its geometry cannot satisfy the
    // signed elevation solution.
    const rankedCombinations = makeCombinations(candidates, count)
      .filter((combination) => (
        combination.filter(({ plan }) => isMainRouteConnectionPlan(plan)).length
          >= policy.minimumElevationConnectorCount
      ))
      .sort((first, second) => {
        const firstOptionalCount = first.filter(({ plan }) => (
          isOptionalBranchConnectionPlan(plan)
        )).length;
        const secondOptionalCount = second.filter(({ plan }) => (
          isOptionalBranchConnectionPlan(plan)
        )).length;
        return secondOptionalCount - firstOptionalCount
          || stableHash(first.map(({ plan }) => plan.id).join('|'))
            - stableHash(second.map(({ plan }) => plan.id).join('|'));
      });
    if (!rankedCombinations.length) continue;
    const combinationOffset = assignmentAttempt % rankedCombinations.length;
    const combinations = [
      ...rankedCombinations.slice(combinationOffset),
      ...rankedCombinations.slice(0, combinationOffset),
    ];
    for (let combinationIndex = 0; combinationIndex < combinations.length; combinationIndex += 1) {
      const selected = combinations[combinationIndex];
      const selectedRunLengths = selected.map(({ plan }) => (
        deriveDungeonConnectorSafeSpan(plan)?.selectedStraightRun?.lengthTiles ?? 0
      ));
      const hasDistinctSlopeAndLift = selectedRunLengths.some((lengthTiles, slopeIndex) => (
        isMainRouteConnectionPlan(selected[slopeIndex].plan)
        && lengthTiles >= DUNGEON_CONNECTOR_CLEARANCE.minimumSlopeStraightRunTiles
        && selectedRunLengths.some((otherLength, liftIndex) => (
          liftIndex !== slopeIndex
          && isMainRouteConnectionPlan(selected[liftIndex].plan)
          && otherLength >= DUNGEON_CONNECTOR_CLEARANCE.minimumLiftStraightRunTiles
        ))
      ));
      if (!hasDistinctSlopeAndLift) {
        continue;
      }
      const selectedIds = new Set(selected.map(({ plan }) => plan.id));
      if (countMaximumElevationTransfersOnRootPath(connectionPlans, selectedIds) > maximumTransfers) {
        continue;
      }
      const directionPatternCount = (2 ** count) - 2;
      const directionOffset = (collectionHash + assignmentAttempt * 2654435761)
        % directionPatternCount;
      for (let patternIndex = 0; patternIndex < directionPatternCount; patternIndex += 1) {
        const mask = 1 + ((patternIndex + directionOffset) % directionPatternCount);
        const deltaByConnectionId = new Map();
        for (let index = 0; index < selected.length; index += 1) {
          deltaByConnectionId.set(
            selected[index].plan.id,
            (mask & (1 << index))
              ? policy.transferElevationMeters
              : -policy.transferElevationMeters,
          );
        }
        const propagation = propagateRoomElevations(
          connectionPlans,
          deltaByConnectionId,
          options.initialRoomElevations,
        );
        if (!propagation.errors.length && propagation.verticalSpan <= maximumSpan + EPSILON) {
          return { selected, deltaByConnectionId, propagation, requestedCount };
        }
      }
    }
  }
  return null;
}

/**
 * Produces a serializable, renderer-free assignment result without mutating
 * rooms or input connection plans. Remaining eligible V1 corridors receive a
 * level service gallery; only slope, ladder, and lift assignments alter room Y.
 */
export function planDungeonConnectorVariantAssignments(connectionPlans = [], options = {}) {
  if (!Array.isArray(connectionPlans)) throw new TypeError('connectionPlans must be an array.');
  const assignmentAttempt = Math.max(0, Math.trunc(Number(options.assignmentAttempt) || 0));
  const eligible = connectionPlans
    .filter((plan) => isDungeonConnectorVariantEligible(plan, options))
    .map((plan) => ({ plan, hash: computeDungeonConnectorStableHash(plan) }))
    .sort((a, b) => a.hash - b.hash || String(a.plan.id).localeCompare(String(b.plan.id)));
  const parallelUpperPairs = new Set(connectionPlans
    .filter((plan) => plan.connectorType === 'upper_catwalk_bridge')
    .map(makeDirectedPairKey));
  const elevationCandidates = eligible.filter(({ plan }) => !parallelUpperPairs.has(makeDirectedPairKey(plan)));
  const collectionHash = stableHash(eligible.map(({ plan, hash }) => `${plan.id}:${hash}`).join('|'));
  const errors = [];
  if (elevationCandidates.length < DUNGEON_CONNECTOR_ELEVATION_POLICY.minimumElevationConnectorCount) {
    errors.push(
      `Only ${elevationCandidates.length} elevation-safe connector spans exist; at least ${DUNGEON_CONNECTOR_ELEVATION_POLICY.minimumElevationConnectorCount} are required.`,
    );
  }
  const signedSelection = chooseSignedElevationAssignments(
    connectionPlans,
    elevationCandidates,
    collectionHash,
    options,
  );
  if (!signedSelection && elevationCandidates.length >= DUNGEON_CONNECTOR_ELEVATION_POLICY.minimumElevationConnectorCount) {
    errors.push('No signed connector assignment satisfies the room graph and vertical-span limits.');
  }

  const assignmentById = new Map();
  const selected = signedSelection?.selected ?? [];
  const selectionRunLengths = selected.map(({ plan }) => (
    deriveDungeonConnectorSafeSpan(plan)?.selectedStraightRun?.lengthTiles ?? 0
  ));
  const slopeEligibleSelectionIndexes = selected
    .map(({ plan }, index) => ({
      index,
      lengthTiles: selectionRunLengths[index],
    }))
    .filter(({ index, lengthTiles }) => (
      isMainRouteConnectionPlan(selected[index].plan)
      && lengthTiles >= DUNGEON_CONNECTOR_CLEARANCE.minimumSlopeStraightRunTiles
      && selectionRunLengths.some((otherLength, otherIndex) => (
        otherIndex !== index
        && isMainRouteConnectionPlan(selected[otherIndex].plan)
        && otherLength >= DUNGEON_CONNECTOR_CLEARANCE.minimumLiftStraightRunTiles
      ))
    ));
  const slopeSelectionIndex = slopeEligibleSelectionIndexes.length
    ? slopeEligibleSelectionIndexes[
      (collectionHash + assignmentAttempt) % slopeEligibleSelectionIndexes.length
    ].index
    : -1;
  const liftEligibleSelectionIndexes = selected
    .map((_, index) => index)
    .filter((index) => (
      index !== slopeSelectionIndex
      && isMainRouteConnectionPlan(selected[index].plan)
      && selectionRunLengths[index] >= DUNGEON_CONNECTOR_CLEARANCE.minimumLiftStraightRunTiles
    ));
  const liftSelectionIndex = liftEligibleSelectionIndexes.length
    ? liftEligibleSelectionIndexes[
      ((collectionHash >>> 3) + assignmentAttempt) % liftEligibleSelectionIndexes.length
    ]
    : -1;
  for (let index = 0; index < selected.length; index += 1) {
    const delta = signedSelection.deltaByConnectionId.get(selected[index].plan.id);
    const variantId = index === slopeSelectionIndex
      ? DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE
      : index === liftSelectionIndex
        ? DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT
        : DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY;
    assignmentById.set(selected[index].plan.id, {
      variantId,
      direction: delta > 0 ? 'ascending' : 'descending',
      elevationDelta: delta,
    });
  }
  for (const { plan } of eligible) {
    if (!assignmentById.has(plan.id)) {
      assignmentById.set(plan.id, {
        variantId: DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY,
        direction: 'level',
        elevationDelta: 0,
      });
    }
  }

  const deltaByConnectionId = new Map(
    [...assignmentById].map(([id, assignment]) => [id, assignment.elevationDelta]),
  );
  const propagation = signedSelection?.propagation ?? propagateRoomElevations(
    connectionPlans,
    deltaByConnectionId,
    options.initialRoomElevations,
  );
  errors.push(...propagation.errors);
  const roomElevations = Object.fromEntries(
    [...propagation.elevations].sort(([a], [b]) => String(a).localeCompare(String(b))),
  );

  const assignedPlans = connectionPlans.map((plan) => {
    const assignment = assignmentById.get(plan.id) ?? {
      variantId: null,
      direction: 'level',
      elevationDelta: 0,
    };
    const roomBaseOffset = plan.connectorType === 'ground_corridor' ? 0 : Number(plan.elevation ?? 0);
    const sourceElevation = Number(roomElevations[plan.fromRoomId] ?? plan.elevation ?? 0)
      + roomBaseOffset;
    const destinationElevation = plan.connectorType === 'ground_corridor'
      ? Number(roomElevations[plan.toRoomId] ?? sourceElevation)
      : Number(roomElevations[plan.toRoomId] ?? 0) + roomBaseOffset;
    return clonePlanWithVariant(plan, {
      ...assignment,
      sourceElevation,
      destinationElevation,
    }, options);
  });
  const elevationPlans = assignedPlans.filter((plan) => (
    plan.connectorVariant?.elevationChange === true
  ));
  const diagnostics = freezeSerializable({
    accepted: errors.length === 0,
    errors: [...new Set(errors)],
    collectionHash,
    assignmentAttempt,
    requestedElevationConnectorCount: signedSelection?.requestedCount ?? 0,
    selectedElevationConnectorCount: elevationPlans.length,
    elevationConnectorIds: elevationPlans.map((plan) => plan.id),
    mainRouteElevationConnectorIds: elevationPlans
      .filter(isMainRouteConnectionPlan)
      .map((plan) => plan.id),
    optionalBranchElevationConnectorIds: elevationPlans
      .filter(isOptionalBranchConnectionPlan)
      .map((plan) => plan.id),
    levelServiceConnectorIds: assignedPlans
      .filter((plan) => plan.connectorVariantId === DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY)
      .map((plan) => plan.id),
    minimumRoomElevation: propagation.minimumElevation,
    maximumRoomElevation: propagation.maximumElevation,
    verticalSpanMeters: propagation.verticalSpan,
  });
  return {
    connectionPlans: assignedPlans,
    roomElevations: freezeSerializable(roomElevations),
    diagnostics,
  };
}

export function assignDungeonConnectorVariants(connectionPlans = [], options = {}) {
  return planDungeonConnectorVariantAssignments(connectionPlans, options).connectionPlans;
}

export function validateDungeonConnectorVariantAssignments(originalPlans = [], assignedPlans = []) {
  const errors = [];
  if (!Array.isArray(originalPlans) || !Array.isArray(assignedPlans)) {
    return { ok: false, errors: ['Both originalPlans and assignedPlans must be arrays.'] };
  }
  if (originalPlans.length !== assignedPlans.length) {
    errors.push('Connector assignment changed the connection-plan count.');
  }
  const originalById = new Map(originalPlans.map((plan) => [plan.id, plan]));
  const seenContractIds = new Set();
  const stripResolvedElevation = (socket) => {
    if (!socket) return socket;
    const { elevation: _elevation, y: _y, ...stableSocket } = socket;
    return stableSocket;
  };
  for (const plan of assignedPlans) {
    const original = originalById.get(plan.id);
    if (!original) {
      errors.push(`Unexpected assigned connection plan ${plan.id}.`);
      continue;
    }
    if (JSON.stringify(plan.fullPath) !== JSON.stringify(original.fullPath)) {
      errors.push(`${plan.id} changed its fullPath.`);
    }
    if (JSON.stringify(plan.bridgePath) !== JSON.stringify(original.bridgePath)) {
      errors.push(`${plan.id} changed its bridgePath.`);
    }
    if (JSON.stringify(stripResolvedElevation(plan.fromSocket))
        !== JSON.stringify(stripResolvedElevation(original.fromSocket))
      || JSON.stringify(stripResolvedElevation(plan.toSocket))
        !== JSON.stringify(stripResolvedElevation(original.toSocket))) {
      errors.push(`${plan.id} changed a room endpoint socket outside its resolved elevation.`);
    }
    const contract = plan.connectorVariant;
    if (!contract) continue;
    if (seenContractIds.has(contract.id)) errors.push(`Duplicate connector contract id ${contract.id}.`);
    seenContractIds.add(contract.id);
    if (contract.schema !== DUNGEON_CONNECTOR_VARIANT_SCHEMA) {
      errors.push(`${plan.id} has an unsupported connector contract schema.`);
    }
    if (!Number.isFinite(contract.sourceElevation)
      || !Number.isFinite(contract.destinationElevation)
      || Math.abs(contract.destinationElevation - contract.sourceElevation
        - contract.elevationDelta) > EPSILON
      || Math.abs(Number(plan.fromSocket?.elevation) - contract.sourceElevation) > EPSILON
      || Math.abs(Number(plan.toSocket?.elevation) - contract.destinationElevation) > EPSILON) {
      errors.push(`${plan.id} has inconsistent absolute endpoint elevations.`);
    }
    if (contract.clearance.minimumLandingWidthMeters < DUNGEON_CONNECTOR_CLEARANCE.minimumLandingWidthMeters
      || contract.clearance.minimumLandingDepthMeters < DUNGEON_CONNECTOR_CLEARANCE.minimumLandingDepthMeters
      || contract.clearance.minimumHeadroomMeters < DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters) {
      errors.push(`${plan.id} violates the connector clearance contract.`);
    }
    const tileSize = Number(contract.pathContract?.tileSizeMeters);
    const minimumGalleryWidthTiles = DUNGEON_CONNECTOR_CLEARANCE.minimumContinuousGalleryWidthTiles;
    const requiredGalleryWidthMeters = tileSize * minimumGalleryWidthTiles;
    if (!Number.isFinite(tileSize)
      || Number(contract.galleryEnvelope?.minimumContinuousWidthTiles) < minimumGalleryWidthTiles
      || Number(contract.galleryEnvelope?.minimumContinuousWidthMeters) + EPSILON < requiredGalleryWidthMeters
      || contract.galleryEnvelope?.appliesAcrossEntireTraversableLength !== true
      || contract.galleryEnvelope?.singleTileChokePointsPermitted !== false) {
      errors.push(`${plan.id} violates the minimum continuous gallery width contract.`);
    }
    if (contract.decoration?.required !== true
      || typeof contract.decoration?.archFamily !== 'string'
      || !contract.decoration.archFamily.startsWith('v1_')
      || !Number.isInteger(contract.decoration?.archSpacingTiles)
      || contract.decoration.archSpacingTiles < 1
      || contract.decoration.continueAcrossElevationTransitions !== true) {
      errors.push(`${plan.id} does not declare the required V1 decorative arch treatment.`);
    }
    if (contract.landings.some((landing) => !landing.mustRemainFreeOfProps)) {
      errors.push(`${plan.id} has a landing without a prop-exclusion requirement.`);
    }
    if (contract.elevationChange) {
      if (Math.abs(Math.abs(contract.elevationDelta)
          - DUNGEON_CONNECTOR_ELEVATION_POLICY.transferElevationMeters) > EPSILON
        || !['ascending', 'descending'].includes(contract.direction)
        || !contract.higherEndpoint
        || !contract.lowerEndpoint) {
        errors.push(`${plan.id} does not define a signed 14 metre elevation transfer.`);
      }
    } else if (Math.abs(contract.elevationDelta) > EPSILON
      || contract.direction !== 'level'
      || contract.higherEndpoint !== null
      || contract.lowerEndpoint !== null) {
      errors.push(`${plan.id} changes elevation despite using a level V1 service gallery.`);
    }
    if (contract.traversalKind === 'slope') {
      const flights = contract.construction?.flights ?? [];
      const [firstFlight, secondFlight] = flights;
      const firstRunLength = firstFlight
        ? Math.abs(firstFlight.endGridPoint.x - firstFlight.startGridPoint.x)
          + Math.abs(firstFlight.endGridPoint.z - firstFlight.startGridPoint.z)
        : -1;
      const secondRunLength = secondFlight
        ? Math.abs(secondFlight.endGridPoint.x - secondFlight.startGridPoint.x)
          + Math.abs(secondFlight.endGridPoint.z - secondFlight.startGridPoint.z)
        : -1;
      const sourceDirection = contract.construction?.sourceFlightDirection;
      const returnDirection = contract.construction?.returnFlightDirection;
      if (flights.length !== DUNGEON_CONNECTOR_ELEVATION_POLICY.slopeFlightCount
        || flights.some((flight) => (
          flight.widthTiles < DUNGEON_CONNECTOR_CLEARANCE.minimumContinuousGalleryWidthTiles
          || flight.segmentCount !== DUNGEON_CONNECTOR_ELEVATION_POLICY.slopeSegmentsPerFlight
          || Math.abs(Math.abs(flight.riseMeters)
            - DUNGEON_CONNECTOR_ELEVATION_POLICY.slopeRisePerFlightMeters) > EPSILON
        ))
        || ![1, -1].includes(contract.construction?.switchbackSideSign)
        || contract.construction?.lateralCenterlineSeparationTiles !== 3
        || firstRunLength !== DUNGEON_CONNECTOR_ELEVATION_POLICY.slopeSegmentsPerFlight - 1
        || secondRunLength !== DUNGEON_CONNECTOR_ELEVATION_POLICY.slopeSegmentsPerFlight - 1
        || returnDirection?.x !== -sourceDirection?.x
        || returnDirection?.z !== -sourceDirection?.z
        || contract.construction?.returnsToSourceElevation !== false) {
        errors.push(`${plan.id} does not define the required two-flight switchback slope.`);
      }
    }
    if (contract.traversalKind === 'ladder') {
      if (contract.apertures.length !== 1 || contract.mechanisms.length !== 1) {
        errors.push(`${plan.id} does not define exactly one 14 metre ladder transfer.`);
      }
      if (contract.apertures.some((aperture) => !aperture.prohibitCoveringTile)) {
        errors.push(`${plan.id} permits a tile to cover a ladder opening.`);
      }
    }
    if (contract.traversalKind === 'automatic_lift') {
      const lift = contract.mechanisms.find((mechanism) => mechanism.type === 'automatic_cargo_lift');
      const shaft = contract.liftShaft;
      const aperture = contract.apertures[0];
      const sweep = contract.sweptVolumes[0];
      const centersAlign = shaft?.center && aperture?.center && sweep?.center
        && Math.abs(shaft.center.x - aperture.center.x) <= EPSILON
        && Math.abs(shaft.center.z - aperture.center.z) <= EPSILON
        && Math.abs(shaft.center.x - sweep.center.x) <= EPSILON
        && Math.abs(shaft.center.z - sweep.center.z) <= EPSILON;
      const landingSills = contract.landingSills ?? [];
      const sillsAreComplete = landingSills.length === 2
        && new Set(landingSills.map((sill) => sill.endpoint)).size === 2
        && landingSills.every((sill) => (
          sill.blocksBelow === false
          && Math.abs(sill.spanMeters - DUNGEON_CONNECTOR_CLEARANCE.liftPlatformWidthMeters)
            <= EPSILON
          && Math.abs(sill.bridgeDepthMeters - (
            DUNGEON_CONNECTOR_CLEARANCE.liftShaftDepthMeters
              - DUNGEON_CONNECTOR_CLEARANCE.liftPlatformDepthMeters
          ) * 0.5) <= EPSILON
          && (sill.supportPosts?.length ?? 0) === 2
          && sill.supportPosts.every((post) => post.blocksPlayer === true)
        ));
      if (!lift?.automatic
        || lift.requiresConsole
        || !lift.requiresRecallControls
        || contract.sweptVolumes.length !== 1
        || !shaft
        || shaft.gridColumns?.length !== 16
        || shaft.startPathIndex + 3 !== shaft.endPathIndex
        || shaft.apertureId !== aperture?.id
        || shaft.sweptVolumeId !== sweep?.id
        || !centersAlign
        || !sillsAreComplete
        || lift.shaftId !== shaft.id
        || lift.landingSillIds?.length !== 2
        || lift.platformWidthMeters + EPSILON < DUNGEON_CONNECTOR_CLEARANCE.liftPlatformWidthMeters
        || lift.platformDepthMeters + EPSILON < DUNGEON_CONNECTOR_CLEARANCE.liftPlatformDepthMeters
        || lift.shaftWidthMeters + EPSILON < DUNGEON_CONNECTOR_CLEARANCE.liftShaftWidthMeters
        || lift.shaftDepthMeters + EPSILON < DUNGEON_CONNECTOR_CLEARANCE.liftShaftDepthMeters
        || contract.construction?.provideSlopedReturnToBaseElevation !== false) {
        errors.push(`${plan.id} does not define the required automatic 14 metre lift and shaft.`);
      }
    }
  }
  const eligibleAssigned = assignedPlans.filter((plan) => isDungeonConnectorVariantEligible(plan, optionsFromAssignments()));
  const elevationAssigned = eligibleAssigned.filter((plan) => plan.connectorVariant?.elevationChange);
  const serviceAssigned = eligibleAssigned.filter((plan) => (
    plan.connectorVariantId === DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY
  ));
  if (eligibleAssigned.some((plan) => !plan.connectorVariant)) {
    errors.push('At least one eligible V1 connection has no connector contract.');
  }
  if (eligibleAssigned.length >= DUNGEON_CONNECTOR_ELEVATION_POLICY.minimumElevationConnectorCount) {
    if (elevationAssigned.length < DUNGEON_CONNECTOR_ELEVATION_POLICY.minimumElevationConnectorCount
      || elevationAssigned.length > DUNGEON_CONNECTOR_ELEVATION_POLICY.maximumElevationConnectorCount) {
      errors.push('The dungeon must contain three to five elevation-changing connectors.');
    }
    const elevationVariants = new Set(elevationAssigned.map((plan) => plan.connectorVariantId));
    for (const variantId of ELEVATION_CONNECTOR_VARIANT_ORDER) {
      if (!elevationVariants.has(variantId)) errors.push(`Elevation plan set is missing ${variantId}.`);
      if (!elevationAssigned.some((plan) => (
        plan.connectorVariantId === variantId && isMainRouteConnectionPlan(plan)
      ))) {
        errors.push(`Mandatory elevation family ${variantId} is not assigned to a main-route edge.`);
      }
    }
    const directions = new Set(elevationAssigned.map((plan) => plan.direction));
    if (!directions.has('ascending') || !directions.has('descending')) {
      errors.push('Elevation connectors do not include both ascending and descending progression.');
    }
    if (eligibleAssigned.length > elevationAssigned.length && serviceAssigned.length === 0) {
      errors.push('Remaining eligible V1 connections were not retained as level service galleries.');
    }
    const selectedIds = new Set(elevationAssigned.map((plan) => plan.id));
    if (countMaximumElevationTransfersOnRootPath(assignedPlans, selectedIds)
      > DUNGEON_CONNECTOR_ELEVATION_POLICY.maximumElevationTransfersPerRootPath) {
      errors.push('A root-to-leaf route contains more than four elevation transfers.');
    }
  } else if (eligibleAssigned.length > 0) {
    errors.push('Fewer than three eligible elevation connector spans were provided.');
  }
  const elevations = assignedPlans.flatMap((plan) => (
    [plan.sourceElevation, plan.destinationElevation].filter(Number.isFinite)
  ));
  if (elevations.length
    && Math.max(...elevations) - Math.min(...elevations)
      > DUNGEON_CONNECTOR_ELEVATION_POLICY.maximumDungeonVerticalSpanMeters + EPSILON) {
    errors.push('Assigned connector elevations exceed the 56 metre dungeon vertical span.');
  }
  return { ok: errors.length === 0, errors };
}

function optionsFromAssignments() {
  return {
    minimumPathTiles: DUNGEON_CONNECTOR_CLEARANCE.minimumPathTiles,
    minimumStraightRunTiles: DUNGEON_CONNECTOR_CLEARANCE.minimumStraightRunTiles,
  };
}
