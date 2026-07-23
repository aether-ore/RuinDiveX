const TRACK_TRAP_SCHEMA = 'ruindivex.connector-track-trap/v1';
const TRACK_TRAP_OVERLAY_ID = 'rotating_ceiling_track_v1';
const DEFAULT_TILE_SIZE_METERS = 2.8;
const DEFAULT_MAXIMUM_TRAPPED_FRACTION = 0.4;
const DEFAULT_MAXIMUM_TRAPS_PER_CONNECTOR = 3;
const DEFAULT_MINIMUM_LONGITUDINAL_SPACING_TILES = 3;
const DEFAULT_GALLERY_WIDTH_METERS = 8.4;
const DEFAULT_ROTOR_RADIUS_METERS = 1.1;
const DEFAULT_TRACK_END_MARGIN_METERS = 1.1;
const DEFAULT_WARNING_HEIGHT_METERS = 3.15;
const DEFAULT_CONTACT_OFFSET_METERS = Object.freeze({ x: 0, y: -6.165572557081793, z: 0 });
const EPSILON = 0.000001;

const FORBIDDEN_BAY_TAGS = Object.freeze([
  'door',
  'turn',
  'ramp',
  'ramp-flight',
  'slope',
  'ladder',
  'ladder-aperture',
  'lift',
  'lift-aperture',
  'lift-shaft',
  'shaft',
  'control',
  'landing',
  'arch',
  'clearance',
]);

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function freezeSerializable(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeSerializable(child);
  return Object.freeze(value);
}

function stableHash(value = '') {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function point3(source, fallback = null) {
  if (!source || typeof source !== 'object') return fallback;
  const x = Number(source.x);
  const y = Number(source.y);
  const z = Number(source.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : fallback;
}

function normalizeHorizontalDirection(source) {
  if (!source || typeof source !== 'object') return null;
  const x = finiteOr(source.x, 0);
  const z = finiteOr(source.z, 0);
  const length = Math.hypot(x, z);
  if (length <= EPSILON) return null;
  return { x: x / length, z: z / length };
}

function canonicalTag(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('_', '-')
    .replaceAll(' ', '-');
}

function collectCandidateTags(candidate) {
  const values = [
    candidate.kind,
    candidate.role,
    candidate.surfaceKind,
    candidate.reservedFor,
    ...(Array.isArray(candidate.blockedBy) ? candidate.blockedBy : []),
    ...(Array.isArray(candidate.overlaps) ? candidate.overlaps : []),
    ...(Array.isArray(candidate.exclusionTags) ? candidate.exclusionTags : []),
  ];
  return values.map(canonicalTag).filter(Boolean);
}

function tagIsForbidden(tag) {
  return FORBIDDEN_BAY_TAGS.some((forbidden) => (
    tag === forbidden || tag.startsWith(`${forbidden}-`) || tag.endsWith(`-${forbidden}`)
  ));
}

function normalizeVolume(source, fallbackId = null) {
  if (!source || typeof source !== 'object') return null;
  const minimum = point3(source.min ?? source.minimum);
  const maximum = point3(source.max ?? source.maximum);
  if (minimum && maximum) {
    return {
      id: String(source.id ?? fallbackId ?? 'volume'),
      min: {
        x: Math.min(minimum.x, maximum.x),
        y: Math.min(minimum.y, maximum.y),
        z: Math.min(minimum.z, maximum.z),
      },
      max: {
        x: Math.max(minimum.x, maximum.x),
        y: Math.max(minimum.y, maximum.y),
        z: Math.max(minimum.z, maximum.z),
      },
    };
  }

  const center = point3(source.center);
  if (!center) return null;
  const size = point3(source.size);
  const halfSize = point3(source.halfSize ?? source.halfExtents);
  const halfWidth = halfSize?.x
    ?? Math.max(0, finiteOr(source.halfWidth, finiteOr(source.widthMeters, size?.x ?? 0) * 0.5));
  const halfHeight = halfSize?.y
    ?? Math.max(0, finiteOr(source.halfHeight, finiteOr(source.clearHeightMeters, size?.y ?? 0) * 0.5));
  const halfDepth = halfSize?.z
    ?? Math.max(0, finiteOr(source.halfDepth, finiteOr(source.depthMeters, size?.z ?? 0) * 0.5));
  if (halfWidth <= 0 || halfHeight <= 0 || halfDepth <= 0) return null;
  const adjustedCenter = source.elevation !== undefined && !Number.isFinite(Number(source.center?.y))
    ? { ...center, y: finiteOr(source.elevation, center.y) + halfHeight }
    : center;
  return {
    id: String(source.id ?? fallbackId ?? 'volume'),
    min: {
      x: adjustedCenter.x - halfWidth,
      y: adjustedCenter.y - halfHeight,
      z: adjustedCenter.z - halfDepth,
    },
    max: {
      x: adjustedCenter.x + halfWidth,
      y: adjustedCenter.y + halfHeight,
      z: adjustedCenter.z + halfDepth,
    },
  };
}

function volumesOverlap(first, second) {
  return first.min.x < second.max.x - EPSILON
    && first.max.x > second.min.x + EPSILON
    && first.min.y < second.max.y - EPSILON
    && first.max.y > second.min.y + EPSILON
    && first.min.z < second.max.z - EPSILON
    && first.max.z > second.min.z + EPSILON;
}

function getCollectionEntry(source, id, plan) {
  if (typeof source === 'function') return source(id, plan) ?? [];
  if (source instanceof Map) return source.get(id) ?? [];
  if (source && typeof source === 'object') return source[id] ?? [];
  return [];
}

function getBayCandidates(plan, source) {
  const supplied = getCollectionEntry(source, plan.id, plan);
  if (Array.isArray(supplied) && supplied.length) return supplied;
  const embedded = plan.connectorTrapBayCandidates
    ?? plan.connectorVariant?.trapBayCandidates
    ?? plan.connectorVariant?.flatBayCandidates;
  return Array.isArray(embedded) ? embedded : [];
}

function getExtraExclusionVolumes(plan, source) {
  const supplied = getCollectionEntry(source, plan.id, plan);
  return Array.isArray(supplied) ? supplied : [];
}

/**
 * Builds the per-connection world exclusion set consumed by the pure trap
 * planner. A trap is local to one connector, but its swept head can still hit
 * a room shell, another connector, or another mechanism's required clearance;
 * those global contracts therefore have to participate in bay acceptance.
 */
export function createDungeonConnectorTrackTrapGlobalExclusions(
  connectionPlans = [],
  rooms = [],
  { tileSizeMeters = DEFAULT_TILE_SIZE_METERS } = {},
) {
  if (!Array.isArray(connectionPlans)) throw new TypeError('connectionPlans must be an array.');
  if (!Array.isArray(rooms)) throw new TypeError('rooms must be an array.');
  const tileSize = Math.max(EPSILON, finiteOr(tileSizeMeters, DEFAULT_TILE_SIZE_METERS));
  const roomVolumes = rooms.flatMap((room) => {
    const widthTiles = Number(room?.width);
    const depthTiles = Number(room?.depth);
    const x = Number(room?.x);
    const z = Number(room?.z);
    const minY = Number(room?.minY ?? room?.baseElevation ?? room?.plannedBaseElevation ?? 0);
    const maxY = Number(
      room?.maxY
        ?? room?.ceilingY
        ?? (minY + finiteOr(room?.ceilingHeight, 11.2)),
    );
    if (![widthTiles, depthTiles, x, z, minY, maxY].every(Number.isFinite)
      || widthTiles <= 0
      || depthTiles <= 0
      || maxY <= minY + EPSILON) {
      return [];
    }
    return [{
      id: `global-room-volume:${String(room.id ?? 'room')}`,
      purpose: 'global_room_structural_exclusion',
      center: {
        x: x * tileSize,
        y: (minY + maxY) * 0.5,
        z: z * tileSize,
      },
      size: {
        x: widthTiles * tileSize,
        y: maxY - minY,
        z: depthTiles * tileSize,
      },
    }];
  });
  const result = new Map();
  for (const targetPlan of connectionPlans) {
    const exclusions = [...roomVolumes];
    for (const otherPlan of connectionPlans) {
      if (otherPlan === targetPlan || otherPlan.id === targetPlan.id) continue;
      const sources = [
        ...(otherPlan.occupiedStructuralVolumes ?? []),
        ...(otherPlan.clearanceVolumes ?? []),
        ...(otherPlan.connectorVariant?.occupiedVolumes ?? []),
      ];
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        exclusions.push({
          ...source,
          id: `global-connector-volume:${otherPlan.id}:${source?.id ?? index}`,
        });
      }
    }
    result.set(targetPlan.id, exclusions);
  }
  return result;
}

function landingVolume(landing, index) {
  const center = point3(landing?.center);
  if (!center) return null;
  const clearHeight = Math.max(0, finiteOr(landing.clearHeightMeters, 0));
  return normalizeVolume({
    id: landing.id ?? `landing-${index}`,
    center: {
      x: center.x,
      y: finiteOr(landing.elevation, center.y) + clearHeight * 0.5,
      z: center.z,
    },
    size: {
      x: finiteOr(landing.widthMeters, 0),
      y: clearHeight,
      z: finiteOr(landing.depthMeters, 0),
    },
  });
}

function apertureVolume(aperture, index) {
  const center = point3(aperture?.center);
  if (!center) return null;
  const clearHeight = Math.max(0, finiteOr(aperture.clearHeightMeters, 0));
  return normalizeVolume({
    id: aperture.id ?? `aperture-${index}`,
    center: {
      x: center.x,
      y: center.y + clearHeight * 0.5,
      z: center.z,
    },
    size: {
      x: finiteOr(aperture.widthMeters, 0),
      y: clearHeight,
      z: finiteOr(aperture.depthMeters, 0),
    },
  });
}

function collectExclusionVolumes(plan, extraSource) {
  const contract = plan.connectorVariant ?? {};
  // A damaging ceiling head must sweep through the ordinary walkable lane or
  // it could never contact the player.  Those per-floor volumes document the
  // gallery's baseline traversal envelope; they are not mechanism reservation
  // bays.  Keep every authored/swept/landing/control clearance volume in the
  // exclusion set, but do not reject a flat trap bay merely because its head
  // enters the lane it is intentionally guarding.
  const reservedClearanceVolumes = (plan.clearanceVolumes ?? []).filter((volume) => (
    volume?.purpose !== 'walkable_connector_player_clearance'
  ));
  return [
    ...(contract.occupiedVolumes ?? []),
    ...reservedClearanceVolumes,
    ...(plan.doorVolumes ?? []),
    ...(plan.turnVolumes ?? []),
    ...(plan.rampFlightVolumes ?? []),
    ...(plan.apertureVolumes ?? []),
    ...(plan.shaftVolumes ?? []),
    ...(plan.controlVolumes ?? []),
    ...(plan.archVolumes ?? []),
    ...getExtraExclusionVolumes(plan, extraSource),
    ...(contract.landings ?? []).map(landingVolume),
    ...(contract.apertures ?? []).map(apertureVolume),
  ]
    .map((volume, index) => normalizeVolume(volume, `${plan.id}:exclusion:${index}`))
    .filter(Boolean);
}

function candidateCenter(candidate, tileSizeMeters) {
  const explicit = point3(candidate.center ?? candidate.worldCenter);
  if (explicit) return explicit;
  const gridPoint = candidate.gridPoint;
  if (!gridPoint) return null;
  const floorElevation = Number(candidate.floorElevation ?? candidate.elevation);
  if (!Number.isFinite(floorElevation)) return null;
  return {
    x: finiteOr(gridPoint.x, 0) * tileSizeMeters,
    y: floorElevation,
    z: finiteOr(gridPoint.z, 0) * tileSizeMeters,
  };
}

function makeTrackGeometry(candidate, options) {
  const center = candidateCenter(candidate, options.tileSizeMeters);
  const floorElevation = Number(candidate.floorElevation ?? candidate.elevation ?? center?.y);
  const ceilingY = Number(candidate.ceilingY ?? candidate.ceilingElevation);
  const along = normalizeHorizontalDirection(
    candidate.longitudinalDirection
      ?? candidate.pathDirection
      ?? candidate.facing,
  );
  if (!center || !Number.isFinite(floorElevation) || !Number.isFinite(ceilingY) || !along) {
    return null;
  }
  const transverse = { x: -along.z, z: along.x };
  const galleryWidthMeters = Math.max(
    0,
    finiteOr(candidate.galleryWidthMeters, options.galleryWidthMeters),
  );
  const trackHalfLength = Math.max(
    0,
    galleryWidthMeters * 0.5 - options.trackEndMarginMeters,
  );
  if (trackHalfLength <= options.rotorRadiusMeters + EPSILON) return null;
  const explicitStart = point3(candidate.trackStart);
  const explicitEnd = point3(candidate.trackEnd);
  const trackStart = explicitStart ?? {
    x: center.x - transverse.x * trackHalfLength,
    y: ceilingY,
    z: center.z - transverse.z * trackHalfLength,
  };
  const trackEnd = explicitEnd ?? {
    x: center.x + transverse.x * trackHalfLength,
    y: ceilingY,
    z: center.z + transverse.z * trackHalfLength,
  };
  const trackDelta = {
    x: trackEnd.x - trackStart.x,
    y: trackEnd.y - trackStart.y,
    z: trackEnd.z - trackStart.z,
  };
  const trackLength = Math.hypot(trackDelta.x, trackDelta.y, trackDelta.z);
  const transverseDot = trackDelta.x * along.x + trackDelta.z * along.z;
  if (trackLength <= EPSILON || Math.abs(transverseDot) > 0.01) return null;

  const contactOffsetMeters = point3(candidate.contactOffsetMeters, options.contactOffsetMeters);
  const occupiedMinY = Math.min(
    trackStart.y,
    trackEnd.y,
    trackStart.y + contactOffsetMeters.y,
    trackEnd.y + contactOffsetMeters.y,
  ) - options.rotorRadiusMeters;
  const occupiedMaxY = Math.max(trackStart.y, trackEnd.y) + options.rotorRadiusMeters;
  const occupiedVolume = normalizeVolume(candidate.occupiedVolume) ?? {
    id: `${String(candidate.id ?? 'bay')}:trap-occupied`,
    min: {
      x: Math.min(trackStart.x, trackEnd.x) - options.rotorRadiusMeters,
      y: occupiedMinY,
      z: Math.min(trackStart.z, trackEnd.z) - options.rotorRadiusMeters,
    },
    max: {
      x: Math.max(trackStart.x, trackEnd.x) + options.rotorRadiusMeters,
      y: occupiedMaxY,
      z: Math.max(trackStart.z, trackEnd.z) + options.rotorRadiusMeters,
    },
  };
  const halfLongitudinal = Math.max(
    options.tileSizeMeters * 0.5,
    finiteOr(candidate.warningLengthMeters, options.tileSizeMeters) * 0.5,
  );
  const halfTransverse = galleryWidthMeters * 0.5;
  const warningVolume = {
    center: {
      x: center.x,
      y: floorElevation + options.warningHeightMeters * 0.5,
      z: center.z,
    },
    halfSize: {
      x: Math.abs(along.x) * halfLongitudinal + Math.abs(transverse.x) * halfTransverse,
      y: options.warningHeightMeters * 0.5,
      z: Math.abs(along.z) * halfLongitudinal + Math.abs(transverse.z) * halfTransverse,
    },
  };
  return {
    center,
    floorElevation,
    ceilingY,
    along,
    transverse,
    trackStart,
    trackEnd,
    trackLength,
    galleryWidthMeters,
    contactOffsetMeters,
    occupiedVolume,
    warningVolume,
  };
}

function isDestinationCandidate(candidate) {
  const role = canonicalTag(candidate.role ?? candidate.side);
  return candidate.destinationSide === true
    || role === 'destination'
    || role === 'destination-approach'
    || role === 'exit-approach';
}

function evaluateCandidate(plan, candidate, index, options, exclusionVolumes) {
  const id = String(candidate?.id ?? `${plan.id}:bay:${index}`);
  const reasons = [];
  if (!candidate || typeof candidate !== 'object') {
    return { id, candidate, index, legal: false, reasons: ['candidate-not-object'] };
  }
  const surfaceKind = canonicalTag(candidate.surfaceKind);
  if (candidate.flat !== true && !['flat', 'flat-gallery', 'flat-approach'].includes(surfaceKind)) {
    reasons.push('not-authored-flat-bay');
  }
  if (candidate.clearanceVerified !== true && candidate.clearOfExclusions !== true) {
    reasons.push('unverified-clearance');
  }
  const forbiddenTags = collectCandidateTags(candidate).filter(tagIsForbidden);
  if (forbiddenTags.length) reasons.push(`forbidden-overlap:${[...new Set(forbiddenTags)].join(',')}`);
  if (candidate.hasDoor
    || candidate.isTurn
    || candidate.overlapsRampFlight
    || candidate.overlapsAperture
    || candidate.overlapsShaft
    || candidate.overlapsControl
    || candidate.overlapsLanding
    || candidate.overlapsArch
    || candidate.overlapsClearanceVolume) {
    reasons.push('explicit-exclusion-overlap');
  }
  const longitudinalIndex = Number(candidate.longitudinalIndex ?? candidate.pathIndex);
  if (!Number.isFinite(longitudinalIndex)) reasons.push('missing-longitudinal-index');
  const geometry = makeTrackGeometry(candidate, options);
  if (!geometry) reasons.push('invalid-or-non-transverse-track-geometry');
  if (geometry) {
    const overlap = exclusionVolumes.find((volume) => volumesOverlap(geometry.occupiedVolume, volume));
    if (overlap) reasons.push(`occupied-volume-overlap:${overlap.id}`);
  }
  return {
    id,
    candidate,
    index,
    longitudinalIndex,
    destinationSide: isDestinationCandidate(candidate),
    geometry,
    legal: reasons.length === 0,
    reasons,
  };
}

function makeDescriptor(plan, connectionPlanIndex, evaluated, trapIndex, options) {
  const { candidate, geometry } = evaluated;
  const id = `${plan.id}:track-trap:${evaluated.id}`;
  const initialHash = stableHash(`${options.seed}|${id}|initial`);
  return freezeSerializable({
    schema: TRACK_TRAP_SCHEMA,
    id,
    overlayId: TRACK_TRAP_OVERLAY_ID,
    connectionId: plan.id,
    logicalConnectionId: plan.logicalConnectionId ?? `${plan.fromRoomId}_${plan.toRoomId}`,
    connectionPlanIndex,
    connectorVariantId: plan.connectorVariantId ?? plan.connectorVariant?.variantId ?? null,
    connectorDirection: plan.direction ?? plan.connectorVariant?.direction ?? null,
    bayId: evaluated.id,
    trapIndex,
    longitudinalIndex: evaluated.longitudinalIndex,
    destinationSide: evaluated.destinationSide,
    floorElevation: geometry.floorElevation,
    ceilingY: geometry.ceilingY,
    trackStart: { ...geometry.trackStart },
    trackEnd: { ...geometry.trackEnd },
    contactOffsetMeters: { ...geometry.contactOffsetMeters },
    warningVolume: {
      center: { ...geometry.warningVolume.center },
      halfSize: { ...geometry.warningVolume.halfSize },
    },
    occupiedVolume: {
      id: geometry.occupiedVolume.id,
      min: { ...geometry.occupiedVolume.min },
      max: { ...geometry.occupiedVolume.max },
    },
    initialTrackRatio: Number(((initialHash % 10001) / 10000).toFixed(4)),
    initialDirection: (initialHash & 1) === 0 ? 'toward-end' : 'toward-start',
    patrolSpeedMetersPerSecond: 0.7,
    alertSpeedMetersPerSecond: 3.2,
    spinRadiansPerSecond: 3.2,
    hitRadiusMeters: options.rotorRadiusMeters,
    damage: 12,
    reactionTier: 2,
    pushStrength: 0.72,
    rearmSeconds: 0.8,
    placement: {
      transverseToConnector: true,
      clearanceVerified: true,
      galleryWidthMeters: geometry.galleryWidthMeters,
      minimumLongitudinalSpacingTiles: options.minimumLongitudinalSpacingTiles,
      floorSpecificWarningVolume: true,
      preference: evaluated.destinationSide ? 'destination-side-approach' : 'flat-approach',
    },
  });
}

function plansAreConsecutive(first, second) {
  if (Math.abs(first.index - second.index) <= 1) return true;
  const firstRooms = new Set([first.plan.fromRoomId, first.plan.toRoomId].filter(Boolean));
  return [second.plan.fromRoomId, second.plan.toRoomId]
    .filter(Boolean)
    .some((roomId) => firstRooms.has(roomId));
}

function selectSpacedCandidates(evaluated, maximumCount, minimumSpacingTiles, seed, planId) {
  const ordered = [...evaluated]
    .filter((candidate) => candidate.legal)
    .sort((first, second) => (
      Number(second.destinationSide) - Number(first.destinationSide)
      || stableHash(`${seed}|${planId}|${first.id}`) - stableHash(`${seed}|${planId}|${second.id}`)
      || first.longitudinalIndex - second.longitudinalIndex
      || first.id.localeCompare(second.id)
    ));
  const selected = [];
  for (const candidate of ordered) {
    if (selected.some((entry) => (
      Math.abs(entry.longitudinalIndex - candidate.longitudinalIndex) < minimumSpacingTiles
    ))) continue;
    selected.push(candidate);
    if (selected.length >= maximumCount) break;
  }
  return selected;
}

/**
 * Deterministically plans rotating-trap overlays without mutating connector
 * contracts. Bay candidates must be authored world-space records whose
 * `clearanceVerified` flag certifies the complete forbidden-volume audit.
 */
export function planDungeonConnectorTrackTraps(connectionPlans = [], {
  seed = '',
  bayCandidatesByConnectionId = null,
  extraExclusionVolumesByConnectionId = null,
  tileSizeMeters = DEFAULT_TILE_SIZE_METERS,
  maximumTrappedFraction = DEFAULT_MAXIMUM_TRAPPED_FRACTION,
  maximumTrapsPerConnector = DEFAULT_MAXIMUM_TRAPS_PER_CONNECTOR,
  minimumLongitudinalSpacingTiles = DEFAULT_MINIMUM_LONGITUDINAL_SPACING_TILES,
  galleryWidthMeters = DEFAULT_GALLERY_WIDTH_METERS,
  rotorRadiusMeters = DEFAULT_ROTOR_RADIUS_METERS,
  trackEndMarginMeters = DEFAULT_TRACK_END_MARGIN_METERS,
  warningHeightMeters = DEFAULT_WARNING_HEIGHT_METERS,
  contactOffsetMeters = DEFAULT_CONTACT_OFFSET_METERS,
} = {}) {
  if (!Array.isArray(connectionPlans)) throw new TypeError('connectionPlans must be an array.');
  const options = {
    seed: String(seed),
    tileSizeMeters: Math.max(EPSILON, finiteOr(tileSizeMeters, DEFAULT_TILE_SIZE_METERS)),
    maximumTrappedFraction: clamp(
      finiteOr(maximumTrappedFraction, DEFAULT_MAXIMUM_TRAPPED_FRACTION),
      0,
      DEFAULT_MAXIMUM_TRAPPED_FRACTION,
    ),
    maximumTrapsPerConnector: clamp(
      Math.trunc(finiteOr(maximumTrapsPerConnector, DEFAULT_MAXIMUM_TRAPS_PER_CONNECTOR)),
      1,
      DEFAULT_MAXIMUM_TRAPS_PER_CONNECTOR,
    ),
    minimumLongitudinalSpacingTiles: Math.max(
      DEFAULT_MINIMUM_LONGITUDINAL_SPACING_TILES,
      finiteOr(minimumLongitudinalSpacingTiles, DEFAULT_MINIMUM_LONGITUDINAL_SPACING_TILES),
    ),
    galleryWidthMeters: Math.max(0, finiteOr(galleryWidthMeters, DEFAULT_GALLERY_WIDTH_METERS)),
    rotorRadiusMeters: Math.max(EPSILON, finiteOr(rotorRadiusMeters, DEFAULT_ROTOR_RADIUS_METERS)),
    trackEndMarginMeters: Math.max(0, finiteOr(trackEndMarginMeters, DEFAULT_TRACK_END_MARGIN_METERS)),
    warningHeightMeters: Math.max(EPSILON, finiteOr(warningHeightMeters, DEFAULT_WARNING_HEIGHT_METERS)),
    contactOffsetMeters: point3(contactOffsetMeters, DEFAULT_CONTACT_OFFSET_METERS),
  };
  const elevationPlans = connectionPlans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => (
      plan?.connectorVariant?.elevationChange === true
      || Math.abs(finiteOr(plan?.elevationDelta, 0)) > EPSILON
    ));
  const selectionCap = Math.floor(elevationPlans.length * options.maximumTrappedFraction + EPSILON);
  const candidateRejections = [];
  const records = elevationPlans.map(({ plan, index }) => {
    const globalExclusionVolumeCount = getExtraExclusionVolumes(
      plan,
      extraExclusionVolumesByConnectionId,
    ).length;
    const exclusionVolumes = collectExclusionVolumes(plan, extraExclusionVolumesByConnectionId);
    const evaluated = getBayCandidates(plan, bayCandidatesByConnectionId)
      .map((candidate, candidateIndex) => evaluateCandidate(
        plan,
        candidate,
        candidateIndex,
        options,
        exclusionVolumes,
      ));
    for (const candidate of evaluated.filter((entry) => !entry.legal)) {
      candidateRejections.push({
        connectionId: plan.id,
        bayId: candidate.id,
        reasons: [...candidate.reasons],
      });
    }
    const selectedCandidates = selectSpacedCandidates(
      evaluated,
      options.maximumTrapsPerConnector,
      options.minimumLongitudinalSpacingTiles,
      options.seed,
      plan.id,
    );
    return {
      plan,
      index,
      evaluated,
      selectedCandidates,
      exclusionVolumes,
      globalExclusionVolumeCount,
    };
  });
  const eligibleRecords = records
    .filter((record) => record.selectedCandidates.length > 0)
    .sort((first, second) => (
      stableHash(`${options.seed}|${first.plan.id}|connector`)
        - stableHash(`${options.seed}|${second.plan.id}|connector`)
      || first.index - second.index
      || String(first.plan.id).localeCompare(String(second.plan.id))
    ));
  const selectedRecords = [];
  for (const record of eligibleRecords) {
    if (selectedRecords.length >= selectionCap) break;
    if (selectedRecords.some((selected) => plansAreConsecutive(selected, record))) continue;
    selectedRecords.push(record);
  }

  const connectorTrackTraps = [];
  const trappedAlternates = [];
  const selectedTrapExclusionChecks = [];
  const selectedTrapExclusionErrors = [];
  for (const record of selectedRecords.sort((first, second) => first.index - second.index)) {
    const trapDescriptors = record.selectedCandidates.map((candidate, trapIndex) => (
      makeDescriptor(record.plan, record.index, candidate, trapIndex, options)
    ));
    for (const descriptor of trapDescriptors) {
      const occupiedVolume = normalizeVolume(descriptor.occupiedVolume, `${descriptor.id}:occupied`);
      const overlap = occupiedVolume
        ? record.exclusionVolumes.find((volume) => volumesOverlap(occupiedVolume, volume))
        : null;
      selectedTrapExclusionChecks.push({
        trapId: descriptor.id,
        connectionId: record.plan.id,
        accepted: !overlap,
        overlappingVolumeId: overlap?.id ?? null,
      });
      if (overlap) {
        selectedTrapExclusionErrors.push(
          `${descriptor.id} selected despite overlapping exclusion volume ${overlap.id}.`,
        );
      }
    }
    connectorTrackTraps.push(...trapDescriptors);
    trappedAlternates.push(freezeSerializable({
      connectionId: record.plan.id,
      connectionPlanIndex: record.index,
      overlayId: TRACK_TRAP_OVERLAY_ID,
      trapIds: trapDescriptors.map((trap) => trap.id),
    }));
  }

  const errors = [...selectedTrapExclusionErrors];
  if (eligibleRecords.length > 0 && selectionCap < 1) {
    errors.push('The elevation-plan count cannot guarantee one trapped alternate under the 40% cap.');
  }
  if (selectionCap >= 1 && eligibleRecords.length > 0 && selectedRecords.length === 0) {
    errors.push('A legal trap bay exists but no non-consecutive connector selection was produced.');
  }
  const diagnostics = freezeSerializable({
    accepted: errors.length === 0,
    errors,
    seed: options.seed,
    elevationConnectorCount: elevationPlans.length,
    legalConnectorCount: eligibleRecords.length,
    selectionCap,
    trappedConnectorCount: selectedRecords.length,
    trappedConnectionIds: selectedRecords
      .sort((first, second) => first.index - second.index)
      .map((record) => record.plan.id),
    trapCount: connectorTrackTraps.length,
    maximumTrappedFraction: options.maximumTrappedFraction,
    minimumLongitudinalSpacingTiles: options.minimumLongitudinalSpacingTiles,
    globalExclusionVolumeCountByConnectionId: Object.fromEntries(records.map((record) => [
      record.plan.id,
      record.globalExclusionVolumeCount,
    ])),
    selectedTrapExclusionChecks,
    candidateRejections,
  });
  return freezeSerializable({
    connectorTrackTraps,
    trappedAlternates,
    diagnostics,
  });
}

export const DUNGEON_CONNECTOR_TRACK_TRAP_PLANNING_DEFAULTS = freezeSerializable({
  schema: TRACK_TRAP_SCHEMA,
  overlayId: TRACK_TRAP_OVERLAY_ID,
  maximumTrappedFraction: DEFAULT_MAXIMUM_TRAPPED_FRACTION,
  maximumTrapsPerConnector: DEFAULT_MAXIMUM_TRAPS_PER_CONNECTOR,
  minimumLongitudinalSpacingTiles: DEFAULT_MINIMUM_LONGITUDINAL_SPACING_TILES,
  galleryWidthMeters: DEFAULT_GALLERY_WIDTH_METERS,
  rotorRadiusMeters: DEFAULT_ROTOR_RADIUS_METERS,
  warningHeightMeters: DEFAULT_WARNING_HEIGHT_METERS,
  contactOffsetMeters: DEFAULT_CONTACT_OFFSET_METERS,
  forbiddenBayTags: FORBIDDEN_BAY_TAGS,
});
