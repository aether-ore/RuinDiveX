/**
 * Deterministic traversal contracts for the authored V1 dungeon's inter-room
 * connections. This module deliberately has no renderer or random-number
 * dependency: a connection's identity and geometry fully determine its result.
 */

export const DUNGEON_CONNECTOR_VARIANT_SCHEMA = 'ruindivex.dungeon-connector-variant/v1';

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

export const DUNGEON_CONNECTOR_CLEARANCE = Object.freeze({
  tileSizeMeters: 2.8,
  minimumContinuousGalleryWidthTiles: 3,
  minimumContinuousGalleryWidthMeters: 8.4,
  minimumPathTiles: 9,
  minimumStraightRunTiles: 7,
  minimumLandingWidthMeters: 5.6,
  minimumLandingDepthMeters: 4.2,
  minimumHeadroomMeters: 3.6,
  minimumApertureWidthMeters: 2.4,
  minimumApertureDepthMeters: 2.8,
  transferElevationMeters: 4.2,
  // Keep the car and all four guide posts inside one 2.8 m structural shaft
  // cell. Boarding/dismount space is supplied by separate 2x2 landings.
  liftPlatformWidthMeters: 2.2,
  liftPlatformDepthMeters: 2.2,
  liftPlayerClearanceMeters: 3.6,
  maximumSlopeRisePerTileMeters: 0.5,
  endpointFlatBufferTiles: 2,
});

const EXTERIOR_ROOM_IDS = new Set(['hubTown', 'expeditionCamp']);
const EPSILON = 1e-6;
const GALLERY_LANE_OFFSET_OPTIONS = Object.freeze([
  Object.freeze([-1, 0, 1]),
  Object.freeze([0, 1, 2]),
  Object.freeze([-2, -1, 0]),
]);

const VARIANT_DESCRIPTORS = {
  [DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY]: {
    traversalKind: 'walk',
    visualFamily: 'offset_pipe_service_gallery',
    elevationChange: false,
    automatic: false,
    decorativeArchFamily: 'v1_connector_cylinder_arch',
    decorativeArchSpacingTiles: 3,
  },
  [DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE]: {
    traversalKind: 'slope',
    visualFamily: 'supported_crest_gallery',
    elevationChange: true,
    automatic: false,
    decorativeArchFamily: 'v1_connector_cylinder_arch',
    decorativeArchSpacingTiles: 3,
  },
  [DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY]: {
    traversalKind: 'ladder',
    visualFamily: 'twin_ladder_transfer_gallery',
    elevationChange: true,
    automatic: false,
    decorativeArchFamily: 'v1_connector_cylinder_arch',
    decorativeArchSpacingTiles: 3,
  },
  [DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT]: {
    traversalKind: 'automatic_lift',
    visualFamily: 'automatic_freight_lift_gallery',
    elevationChange: true,
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
  if (Number(plan.level ?? 0) !== 0 || Math.abs(Number(plan.elevation ?? 0)) > EPSILON) return false;
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

function makeEndpointLandings(plan, path, tileSize, baseElevation, facing) {
  const firstPoint = path[0];
  const lastPoint = path[path.length - 1];
  return [
    makeLanding({
      id: `${plan.id}:landing:entry`,
      role: 'entry',
      point: firstPoint,
      elevation: baseElevation,
      facing,
      tileSize,
      purpose: 'room_connector_transition',
    }),
    makeLanding({
      id: `${plan.id}:landing:exit`,
      role: 'exit',
      point: lastPoint,
      elevation: baseElevation,
      facing: { x: -facing.x, z: -facing.z },
      tileSize,
      purpose: 'room_connector_transition',
    }),
  ];
}

function createServiceGalleryContract(plan, context) {
  const { path, run, tileSize, baseElevation, facing } = context;
  const landings = makeEndpointLandings(plan, path, tileSize, baseElevation, facing);
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
    },
  };
}

function createSlopeContract(plan, context) {
  const { path, run, tileSize, baseElevation, facing } = context;
  // Split the straight run into ascent, crest, and descent. A shorter eligible
  // gallery uses a lower crest instead of exceeding the grounded-step envelope.
  const availableRampTilesPerSide = Math.max(2, Math.floor((run.lengthTiles - 1) * 0.5));
  const transferElevation = Math.min(
    DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters,
    availableRampTilesPerSide * DUNGEON_CONNECTOR_CLEARANCE.maximumSlopeRisePerTileMeters,
  );
  const rampTileCount = Math.ceil(
    transferElevation / DUNGEON_CONNECTOR_CLEARANCE.maximumSlopeRisePerTileMeters,
  );
  const midpointIndex = Math.floor((run.startIndex + run.endIndex) * 0.5);
  const crestPoint = pointAt(path, midpointIndex);
  const landings = [
    ...makeEndpointLandings(plan, path, tileSize, baseElevation, facing),
    makeLanding({
      id: `${plan.id}:landing:crest`,
      role: 'slope_crest',
      point: crestPoint,
      elevation: baseElevation + transferElevation,
      facing,
      tileSize,
      purpose: 'elevated_connector_overlook',
    }),
  ];
  return {
    landings,
    headroomVolumes: landings.map((landing) => makeHeadroomVolume(landing, run.axis)),
    apertures: [],
    sweptVolumes: [],
    mechanisms: [],
    construction: {
      ascent: {
        startPathIndex: run.startIndex,
        endPathIndex: midpointIndex,
        riseMeters: transferElevation,
        minimumRunTiles: rampTileCount,
        maximumRisePerTileMeters: DUNGEON_CONNECTOR_CLEARANCE.maximumSlopeRisePerTileMeters,
      },
      descent: {
        startPathIndex: midpointIndex,
        endPathIndex: run.endIndex,
        riseMeters: -transferElevation,
        minimumRunTiles: rampTileCount,
        maximumRisePerTileMeters: DUNGEON_CONNECTOR_CLEARANCE.maximumSlopeRisePerTileMeters,
      },
      surfaceStyle: 'v1_tiled_industrial_ramp',
      supportStyle: 'v1_girder_and_post_supports',
      noFloatingSlabs: true,
      continuousWithLandings: true,
    },
  };
}

function createLadderContract(plan, context) {
  const { path, run, tileSize, baseElevation, facing } = context;
  const upperElevation = baseElevation + DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters;
  // Keep one complete base-floor row behind each ladder and two complete
  // upper-floor rows in front of it. On the minimum seven-tile safe span this
  // places the apertures four indexes apart, so neither 2x2 top landing can
  // ever cover the other ladder opening.
  const firstIndex = run.startIndex + 1;
  const secondIndex = run.endIndex - 1;
  const firstPoint = pointAt(path, firstIndex);
  const secondPoint = pointAt(path, secondIndex);
  const endpointLandings = makeEndpointLandings(plan, path, tileSize, baseElevation, facing);
  const transferLandings = [
    makeLanding({ id: `${plan.id}:landing:ladder-a-bottom`, role: 'ladder_bottom', point: firstPoint, elevation: baseElevation, facing, tileSize, purpose: 'clear_ladder_mount' }),
    makeLanding({ id: `${plan.id}:landing:ladder-a-top`, role: 'ladder_top', point: firstPoint, elevation: upperElevation, facing, tileSize, purpose: 'clear_ladder_dismount' }),
    makeLanding({ id: `${plan.id}:landing:ladder-b-top`, role: 'ladder_top', point: secondPoint, elevation: upperElevation, facing: { x: -facing.x, z: -facing.z }, tileSize, purpose: 'clear_ladder_mount' }),
    makeLanding({ id: `${plan.id}:landing:ladder-b-bottom`, role: 'ladder_bottom', point: secondPoint, elevation: baseElevation, facing: { x: -facing.x, z: -facing.z }, tileSize, purpose: 'clear_ladder_dismount' }),
  ];
  const landings = [...endpointLandings, ...transferLandings];
  const ladderSpecs = [
    { suffix: 'a', pathIndex: firstIndex, point: firstPoint, bottomLandingId: transferLandings[0].id, topLandingId: transferLandings[1].id, ladderFacing: facing },
    { suffix: 'b', pathIndex: secondIndex, point: secondPoint, bottomLandingId: transferLandings[3].id, topLandingId: transferLandings[2].id, ladderFacing: { x: -facing.x, z: -facing.z } },
  ];
  const apertures = ladderSpecs.map((ladder) => makeAperture({
    id: `${plan.id}:aperture:ladder-${ladder.suffix}`,
    point: ladder.point,
    elevation: upperElevation,
    facing: ladder.ladderFacing,
    tileSize,
    role: 'ladder_top_opening',
  }));
  const sweptVolumes = ladderSpecs.map((ladder) => makeVolume({
    id: `${plan.id}:swept:ladder-${ladder.suffix}`,
    center: worldPoint(ladder.point, baseElevation + (DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters + DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters) * 0.5, tileSize),
    axis: run.axis,
    length: DUNGEON_CONNECTOR_CLEARANCE.minimumApertureDepthMeters,
    width: DUNGEON_CONNECTOR_CLEARANCE.minimumApertureWidthMeters,
    height: DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters + DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters,
    purpose: 'ladder_player_sweep',
  }));
  return {
    landings,
    headroomVolumes: landings.map((landing) => makeHeadroomVolume(landing, run.axis)),
    apertures,
    sweptVolumes,
    mechanisms: ladderSpecs.map((ladder) => ({
      id: `${plan.id}:ladder:${ladder.suffix}`,
      type: 'ladder',
      animationId: 'climbingLadder',
      pathIndex: ladder.pathIndex,
      gridPoint: clonePoint(ladder.point),
      bottomElevation: baseElevation,
      topElevation: upperElevation,
      facing: { ...ladder.ladderFacing },
      bottomLandingId: ladder.bottomLandingId,
      topLandingId: ladder.topLandingId,
      snapPlayerToLadderPlane: true,
      alignPlayerFacingOnMount: true,
      allowTopAndBottomMount: true,
      clearDismountDistanceMeters: 2.1,
    })),
    construction: {
      elevatedBridgeElevation: upperElevation,
      supportStyle: 'v1_catwalk_posts_and_cross_braces',
      railingStyle: 'v1_industrial_railing',
      closeLowerBypass: true,
      removeTilesAboveEveryLadder: true,
      preserveClearBottomLanding: true,
    },
  };
}

function createLiftContract(plan, context) {
  const { path, run, tileSize, baseElevation, facing } = context;
  // Reserve one flat approach row, the shaft row, and two flat upper-landing
  // rows before beginning the continuous return slope. This makes the lift a
  // useful connector rather than a platform moving inside a one-tile hallway.
  const liftIndex = run.startIndex + 1;
  const topLandingStartPathIndex = liftIndex + 1;
  const topLandingEndPathIndex = liftIndex + 2;
  const descentStartPathIndex = liftIndex + 3;
  const descentEndPathIndex = run.endIndex - 1;
  const availableDescentTiles = Math.max(
    1,
    descentEndPathIndex - descentStartPathIndex + 1,
  );
  const liftRise = Math.min(
    DUNGEON_CONNECTOR_CLEARANCE.transferElevationMeters,
    availableDescentTiles * DUNGEON_CONNECTOR_CLEARANCE.maximumSlopeRisePerTileMeters,
  );
  const upperElevation = baseElevation + liftRise;
  const liftPoint = pointAt(path, liftIndex);
  const topLandingPoint = pointAt(path, topLandingStartPathIndex);
  const endpointLandings = makeEndpointLandings(plan, path, tileSize, baseElevation, facing);
  const liftLandings = [
    makeLanding({ id: `${plan.id}:landing:lift-bottom`, role: 'lift_bottom', point: liftPoint, elevation: baseElevation, facing, tileSize, purpose: 'automatic_lift_boarding' }),
    makeLanding({ id: `${plan.id}:landing:lift-top`, role: 'lift_top', point: topLandingPoint, elevation: upperElevation, facing, tileSize, purpose: 'automatic_lift_exit' }),
  ];
  const landings = [...endpointLandings, ...liftLandings];
  const aperture = makeAperture({
    id: `${plan.id}:aperture:lift`,
    point: liftPoint,
    elevation: upperElevation,
    facing,
    tileSize,
    role: 'lift_shaft_opening',
  });
  aperture.widthMeters = Math.max(aperture.widthMeters, DUNGEON_CONNECTOR_CLEARANCE.liftPlatformWidthMeters + 0.6);
  aperture.depthMeters = Math.max(aperture.depthMeters, DUNGEON_CONNECTOR_CLEARANCE.liftPlatformDepthMeters + 0.6);
  const sweptVolume = makeVolume({
    id: `${plan.id}:swept:lift`,
    center: worldPoint(liftPoint, baseElevation + (liftRise + DUNGEON_CONNECTOR_CLEARANCE.liftPlayerClearanceMeters) * 0.5, tileSize),
    axis: run.axis,
    length: DUNGEON_CONNECTOR_CLEARANCE.liftPlatformDepthMeters + 0.6,
    width: DUNGEON_CONNECTOR_CLEARANCE.liftPlatformWidthMeters + 0.6,
    height: liftRise + DUNGEON_CONNECTOR_CLEARANCE.liftPlayerClearanceMeters,
    purpose: 'lift_platform_and_rider_sweep',
  });
  return {
    landings,
    headroomVolumes: landings.map((landing) => makeHeadroomVolume(landing, run.axis)),
    apertures: [aperture],
    sweptVolumes: [sweptVolume],
    mechanisms: [{
      id: `${plan.id}:lift`,
      type: 'automatic_cargo_lift',
      pathIndex: liftIndex,
      gridPoint: clonePoint(liftPoint),
      bottomElevation: baseElevation,
      topElevation: upperElevation,
      facing: { ...facing },
      platformWidthMeters: DUNGEON_CONNECTOR_CLEARANCE.liftPlatformWidthMeters,
      platformDepthMeters: DUNGEON_CONNECTOR_CLEARANCE.liftPlatformDepthMeters,
      riderClearanceMeters: DUNGEON_CONNECTOR_CLEARANCE.liftPlayerClearanceMeters,
      bottomLandingId: liftLandings[0].id,
      topLandingId: liftLandings[1].id,
      operation: 'automatic_continuous_shuttle',
      automatic: true,
      waitsForRiderAtLandings: true,
      recallMode: 'automatic_return_after_dwell',
      requiresConsole: false,
      carrySupportedPlayer: true,
      speedMetersPerSecond: 1.8,
      dwellSeconds: 1.25,
    }],
    construction: {
      elevatedBridgeElevation: upperElevation,
      supportStyle: 'v1_freight_lift_frame',
      railingStyle: 'v1_industrial_railing',
      closeLowerBypass: true,
      removeCeilingAcrossSweptVolume: false,
      shaftCeilingMode: 'enclosed_above_rider_clearance',
      minimumShaftCeilingClearanceMeters: DUNGEON_CONNECTOR_CLEARANCE.minimumHeadroomMeters,
      bottomLandingStartPathIndex: run.startIndex,
      topLandingStartPathIndex,
      topLandingEndPathIndex,
      provideSlopedReturnToBaseElevation: true,
      slopedReturn: {
        startPathIndex: descentStartPathIndex,
        endPathIndex: descentEndPathIndex,
        riseMeters: -liftRise,
        minimumRunTiles: availableDescentTiles,
        maximumRisePerTileMeters: DUNGEON_CONNECTOR_CLEARANCE.maximumSlopeRisePerTileMeters,
      },
    },
  };
}

const CONTRACT_BUILDERS = {
  [DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY]: createServiceGalleryContract,
  [DUNGEON_CONNECTOR_VARIANT_IDS.CRESTED_SLOPE]: createSlopeContract,
  [DUNGEON_CONNECTOR_VARIANT_IDS.LADDER_GALLERY]: createLadderContract,
  [DUNGEON_CONNECTOR_VARIANT_IDS.AUTOMATIC_LIFT]: createLiftContract,
};

export function createDungeonConnectorVariantContract(plan, variantId, {
  tileSize = DUNGEON_CONNECTOR_CLEARANCE.tileSizeMeters,
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
  const baseElevation = Number(plan.elevation ?? 0);
  const facing = directionForRun(run);
  const descriptor = DUNGEON_CONNECTOR_VARIANTS[variantId];
  const details = CONTRACT_BUILDERS[variantId](plan, {
    path,
    run,
    tileSize,
    baseElevation,
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
    automatic: descriptor.automatic,
    preservesRoomGeometry: true,
    preservesConnectionEndpoints: true,
    sourceSocketId: plan.fromSocket?.id ?? null,
    destinationSocketId: plan.toSocket?.id ?? null,
    sourceEndpoint: cloneSocket(plan.fromSocket),
    destinationEndpoint: cloneSocket(plan.toSocket),
    pathContract: {
      originalFullPathLength: (plan.fullPath ?? []).length,
      originalBridgePathLength: path.length,
      selectedSafePath: safeSpan.selectedSafePath.map(clonePoint),
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
    ...details,
  };
  return freezeSerializable(contract);
}

function clonePlanWithVariant(plan, variantId, options) {
  const fullPath = (plan.fullPath ?? []).map(clonePoint);
  const bridgePath = (plan.bridgePath ?? []).map(clonePoint);
  const clonedPlan = {
    ...plan,
    fullPath,
    bridgePath,
    fromSocket: cloneSocket(plan.fromSocket),
    toSocket: cloneSocket(plan.toSocket),
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
    ? createDungeonConnectorVariantContract(clonedPlan, variantId, options)
    : null;
  clonedPlan.connectorVariantId = variantId ?? null;
  return clonedPlan;
}

/**
 * Returns cloned connection plans. Eligible dungeon corridors are assigned in a
 * stable, balanced cycle. Real V1 layouts usually expose only one to three
 * exterior spans, so those scarce spans rotate only through elevation-changing
 * families. A plain service gallery joins the cycle once four spans exist.
 * No external RNG is read or advanced.
 */
export function assignDungeonConnectorVariants(connectionPlans = [], options = {}) {
  if (!Array.isArray(connectionPlans)) throw new TypeError('connectionPlans must be an array.');
  const eligible = connectionPlans
    .filter((plan) => isDungeonConnectorVariantEligible(plan, options))
    .map((plan) => ({ plan, hash: computeDungeonConnectorStableHash(plan) }))
    .sort((a, b) => a.hash - b.hash || String(a.plan.id).localeCompare(String(b.plan.id)));
  const assignmentById = new Map();
  if (eligible.length > 0) {
    const collectionHash = stableHash(eligible.map(({ plan, hash }) => `${plan.id}:${hash}`).join('|'));
    const variantPool = eligible.length < DUNGEON_CONNECTOR_VARIANT_ORDER.length
      ? ELEVATION_CONNECTOR_VARIANT_ORDER
      : DUNGEON_CONNECTOR_VARIANT_ORDER;
    const rotation = collectionHash % variantPool.length;
    for (let index = 0; index < eligible.length; index += 1) {
      const variantId = variantPool[
        (index + rotation) % variantPool.length
      ];
      assignmentById.set(eligible[index].plan.id, variantId);
    }
  }
  return connectionPlans.map((plan) => clonePlanWithVariant(plan, assignmentById.get(plan.id), options));
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
    if (JSON.stringify(plan.fromSocket) !== JSON.stringify(original.fromSocket)
      || JSON.stringify(plan.toSocket) !== JSON.stringify(original.toSocket)) {
      errors.push(`${plan.id} changed a room endpoint socket.`);
    }
    const contract = plan.connectorVariant;
    if (!contract) continue;
    if (seenContractIds.has(contract.id)) errors.push(`Duplicate connector contract id ${contract.id}.`);
    seenContractIds.add(contract.id);
    if (contract.schema !== DUNGEON_CONNECTOR_VARIANT_SCHEMA) {
      errors.push(`${plan.id} has an unsupported connector contract schema.`);
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
    if (contract.traversalKind === 'ladder') {
      if (contract.apertures.length < 2 || contract.mechanisms.length < 2) {
        errors.push(`${plan.id} does not define both ladder transfers and their apertures.`);
      }
      if (contract.apertures.some((aperture) => !aperture.prohibitCoveringTile)) {
        errors.push(`${plan.id} permits a tile to cover a ladder opening.`);
      }
    }
    if (contract.traversalKind === 'automatic_lift') {
      const lift = contract.mechanisms.find((mechanism) => mechanism.type === 'automatic_cargo_lift');
      if (!lift?.automatic || lift.requiresConsole || contract.sweptVolumes.length !== 1) {
        errors.push(`${plan.id} does not define a console-free automatic lift and swept volume.`);
      }
    }
  }
  const eligibleAssigned = assignedPlans.filter((plan) => isDungeonConnectorVariantEligible(plan, optionsFromAssignments()));
  if (eligibleAssigned.length >= DUNGEON_CONNECTOR_VARIANT_ORDER.length) {
    const variants = new Set(eligibleAssigned.map((plan) => plan.connectorVariantId));
    for (const variantId of DUNGEON_CONNECTOR_VARIANT_ORDER) {
      if (!variants.has(variantId)) errors.push(`Eligible plan set is missing ${variantId}.`);
    }
  } else if (eligibleAssigned.length > 0) {
    const variants = new Set(eligibleAssigned.map((plan) => plan.connectorVariantId));
    if (variants.has(DUNGEON_CONNECTOR_VARIANT_IDS.SERVICE_GALLERY)) {
      errors.push('A scarce exterior connector span was spent on a non-elevation service gallery.');
    }
    if (variants.size !== eligibleAssigned.length) {
      errors.push('Scarce exterior connector spans did not receive distinct elevation families.');
    }
  }
  return { ok: errors.length === 0, errors };
}

function optionsFromAssignments() {
  return {
    minimumPathTiles: DUNGEON_CONNECTOR_CLEARANCE.minimumPathTiles,
    minimumStraightRunTiles: DUNGEON_CONNECTOR_CLEARANCE.minimumStraightRunTiles,
  };
}
