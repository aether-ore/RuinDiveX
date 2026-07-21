import {
  clonePlanData,
  deepFreezePlan,
  isSerializablePlanValue,
} from './DungeonPlanV2Contract.js';

export const CANONICAL_NATIVE_V1_GOLDEN_CONNECTION_REVISION_V2 = 2;

const FACTORY_PACK_ID = 'placement.semantic-room-pack.factory-corkscrew';
const WATER_PACK_ID = 'placement.semantic-room-pack.waterworks-freight-sump';
const UNDERCROFT_PACK_ID = 'placement.semantic-room-pack.undercroft';
const ROUTE_CLEARANCE = 0.65;
const PORTAL_THROAT_DEPTH = 4;
const VERTICAL_LANDING_RUN = 3.2;
const EPSILON = 1e-6;

const native = (placementKey, socketSuffix) => ({
  kind: 'native', placementKey, socketSuffix,
});
const pack = (placementId, socketId) => ({ kind: 'pack', placementId, socketId });

/**
 * The stable Golden portal ledger. These are physical endpoint bindings, not
 * suggestions: changing one requires a revision and fixture review.
 */
export const CANONICAL_NATIVE_V1_GOLDEN_PORTAL_BINDINGS_V2 = deepFreezePlan([
  binding('portal.security-assembly', native('security', 'ground.south-center'), native('machine', 'ground.south-east-bucket')),
  binding('portal.assembly-server', native('security', 'ground.east-south-bucket'), native('server', 'ground.south-east-bucket')),
  binding('portal.server-freight', native('server', 'ladder.ceiling-east-catwalk'), native('machine', 'catwalk.north-center')),
  binding('portal.freight-security-shortcut', native('server', 'catwalk.north-center'), native('security', 'lift.west-south-bucket'), {
    activationEndpoint: 'from',
  }),
  binding('portal.security-sorting-alpha', native('security', 'ground.north-center'), native('conveyor', 'ground.north-east-bucket'), {
    activationEndpoint: 'from',
  }),
  binding('portal.sorting-freight-sump', native('conveyor', 'catwalk.west-south-bucket'), pack(WATER_PACK_ID, 'entry_south')),
  binding('portal.freight-sump-reservoir', pack(WATER_PACK_ID, 'drain_tunnel_east'), native('coolant', 'pipe.east-center')),
  binding('portal.reservoir-gantry-sump', pack(WATER_PACK_ID, 'gantry_exit_west'), native('coolant', 'catwalk.north-east-bucket')),
  binding('portal.gantry-sump-salvage', pack(WATER_PACK_ID, 'exit_north'), native('coolant', 'ground.south-west-bucket')),
  binding('portal.salvage-sorting-shortcut', native('coolant', 'lift.west-center'), native('conveyor', 'pipe.east-north-bucket'), {
    activationEndpoint: 'from',
  }),
  binding('portal.sorting-credential-beta', native('conveyor', 'lift.south-west-bucket'), native('credential', 'lift.east-north-bucket'), {
    activationEndpoint: 'from',
  }),
  binding('portal.credential-parts', native('credential', 'ground.south-east-bucket'), native('parts', 'ground.south-east-bucket')),
  binding('portal.parts-corkscrew-service', native('parts', 'lift.east-south-bucket'), pack(FACTORY_PACK_ID, 'entry_south')),
  binding('portal.parts-nest', native('parts', 'ladder.ceiling-west-north'), native('nest', 'ladder.ceiling-rear')),
  // The obsolete credential-loop barrier is retired. Its stable portal ID now
  // owns the permanent Undercroft-to-Hazard lift return.
  binding('portal.corkscrew-credential-loop', pack(UNDERCROFT_PACK_ID, 'exit_north'), native('hazard', 'lift.east-center'), {
    retireGateId: 'Gate_Credential_Loop',
  }),
  binding('portal.corkscrew-hazard-intake', pack(FACTORY_PACK_ID, 'exit_north_high'), native('hazard', 'ground.south-east-bucket')),
  binding('portal.hazard-intake-core', native('hazard', 'lower.intentional-west'), pack(UNDERCROFT_PACK_ID, 'entry_south')),
  binding('portal.hazard-core-credential-return', pack(FACTORY_PACK_ID, 'exit_east_mid'), native('credential', 'ground.north-west-bucket'), {
    activationEndpoint: 'from',
  }),
  binding('portal.corkscrew-machine-core-gamma', pack(FACTORY_PACK_ID, 'exit_west_top'), native('core', 'ground.west-south-bucket'), {
    activationEndpoint: 'from',
  }),
  binding('portal.machine-core-extraction-shrine', native('core', 'gear.north-upper'), native('shrine', 'catwalk.north-east-bucket'), {
    activationEndpoint: 'from',
  }),
  binding('portal.assembly-freight-drop', native('machine', 'lower.freight-catchment'), {
    kind: 'native-catchment', placementKey: 'machine', regionId: 'freight', depth: 5.4,
  }),
]);

function binding(portalId, from, to, options = {}) {
  return { portalId, from, to, ...options };
}

function vector(x, y, z) {
  return { x: Number(x), y: Number(y), z: Number(z) };
}

function centerOf(bounds) {
  return vector(
    (bounds.min.x + bounds.max.x) * 0.5,
    (bounds.min.y + bounds.max.y) * 0.5,
    (bounds.min.z + bounds.max.z) * 0.5,
  );
}

function sideFromFacing(facing) {
  if (Math.abs(facing.x) >= Math.abs(facing.z)) return facing.x >= 0 ? 'east' : 'west';
  return facing.z >= 0 ? 'south' : 'north';
}

function sideDirection(side, fallback = null) {
  if (side === 'north') return vector(0, 0, -1);
  if (side === 'south') return vector(0, 0, 1);
  if (side === 'east') return vector(1, 0, 0);
  if (side === 'west') return vector(-1, 0, 0);
  if (fallback && Math.hypot(fallback.x ?? 0, fallback.z ?? 0) > EPSILON) {
    const length = Math.hypot(fallback.x, fallback.z);
    return vector(fallback.x / length, 0, fallback.z / length);
  }
  return vector(1, 0, 0);
}

function openingCenter(anchor, side, height) {
  return ['floor', 'ceiling'].includes(side)
    ? vector(anchor.x, anchor.y, anchor.z)
    : vector(anchor.x, anchor.y + height * 0.5, anchor.z);
}

function assertMutablePlan(plan) {
  if (!plan || plan.fixtureKind !== 'golden-complex' || Object.isFrozen(plan)) {
    throw new TypeError('Canonical Golden connection coordination requires a mutable Golden plan.');
  }
  for (const key of [
    'portals', 'spatialCells', 'structuralBoundaries', 'walkableSurfaces',
    'traversalLinks', 'structuralFixtures', 'semanticRoomPackPlacements',
  ]) {
    if (!Array.isArray(plan[key]) || Object.isFrozen(plan[key])) {
      throw new TypeError(`Canonical Golden connection coordination requires mutable plan.${key}.`);
    }
  }
}

function stablePortalIds() {
  return CANONICAL_NATIVE_V1_GOLDEN_PORTAL_BINDINGS_V2.map(({ portalId }) => portalId);
}

function isStaleConnectorRecord(record) {
  return record?.connector === true
    || record?.portalConnector === true
    || /(?:^|[.:])connector(?:[.:]|$)/u.test(record?.id ?? '');
}

function purgeStaleConnectorGeometry(plan) {
  const oldRouteIds = new Set(plan.portals.flatMap(({ physicalRoute = {} }) => [
    ...(physicalRoute.cellIds ?? []),
    ...(physicalRoute.boundaryIds ?? []),
    ...(physicalRoute.surfaceIds ?? []),
  ]));
  const removed = { cellIds: [], boundaryIds: [], surfaceIds: [], traversalLinkIds: [] };
  const filter = (collection, key) => collection.filter((record) => {
    const stale = oldRouteIds.has(record.id) || isStaleConnectorRecord(record);
    if (stale) removed[key].push(record.id);
    return !stale;
  });
  plan.spatialCells = filter(plan.spatialCells, 'cellIds');
  plan.structuralBoundaries = filter(plan.structuralBoundaries, 'boundaryIds');
  plan.walkableSurfaces = filter(plan.walkableSurfaces, 'surfaceIds');
  plan.traversalLinks = plan.traversalLinks.filter((record) => {
    const stale = isStaleConnectorRecord(record)
      || stablePortalIds().includes(record.portalId)
      || stablePortalIds().includes(record.proofPortalId)
      || oldRouteIds.has(record.fromSurfaceId)
      || oldRouteIds.has(record.toSurfaceId)
      || oldRouteIds.has(record.viaSurfaceId);
    if (stale) removed.traversalLinkIds.push(record.id);
    return !stale;
  });
  for (const portal of plan.portals) delete portal.physicalRoute;
  for (const placement of plan.semanticRoomPackPlacements) {
    placement.connectorCellIds = [];
    placement.connectorBoundaryIds = [];
    placement.connectorSurfaceIds = [];
  }
  return removed;
}

function bundleFor(context, placementKey) {
  const bundle = context.bundles.find(({ placement }) => (
    placement.key === placementKey || placement.id === `placement.${placementKey}`
  ));
  if (!bundle) throw new Error(`Canonical connector cannot resolve native placement ${placementKey}.`);
  return bundle;
}

function socketBySuffix(bundle, suffix) {
  const localMatches = bundle.module.extensionSockets.filter(({ id }) => id.endsWith(`.${suffix}`));
  if (localMatches.length !== 1) {
    throw new Error(`${bundle.placement.id} expected exactly one socket ending .${suffix}; received ${localMatches.length}.`);
  }
  const local = localMatches[0];
  const compiled = bundle.compiled.portals.find(({ localId }) => localId === local.id);
  if (!compiled) throw new Error(`${bundle.placement.id} did not compile ${local.id}.`);
  return { local, compiled };
}

function replaceOpening(boundary, portalId, endpointName, socketId, center, dimensions) {
  boundary.openings ??= [];
  const prior = boundary.openings.find(({ portalId: candidate, descriptorSocketId, nativeSocketPortalId }) => (
    candidate === socketId || descriptorSocketId === socketId || nativeSocketPortalId === socketId
  ));
  const opening = {
    ...(prior ?? {}),
    id: `opening.canonical.${portalId.replace('portal.', '')}.${endpointName}`,
    portalId,
    center: clonePlanData(center),
    dimensions: clonePlanData(dimensions),
    descriptorSocketId: socketId,
    nativeSocketPortalId: socketId,
    declarationOnly: true,
  };
  boundary.openings = boundary.openings.filter((candidate) => candidate !== prior
    && candidate.portalId !== portalId);
  boundary.openings.push(opening);
  boundary.kind = 'portal-frame';
  return opening;
}

function nearestApproachSurface(plan, surfaceIds, anchor, elevation) {
  const candidates = surfaceIds.map((id) => plan.walkableSurfaces.find((surface) => surface.id === id)).filter(Boolean);
  const level = candidates.filter(({ bounds }) => Math.abs(bounds.max.y - elevation) <= 0.08);
  return (level.length ? level : candidates).sort((left, right) => {
    const distance = (surface) => {
      const center = centerOf(surface.bounds);
      return Math.hypot(center.x - anchor.x, center.z - anchor.z);
    };
    return distance(left) - distance(right) || left.id.localeCompare(right.id);
  })[0] ?? null;
}

function bindNativeEndpoint(plan, context, ref, portalId, endpointName) {
  const bundle = bundleFor(context, ref.placementKey);
  const { local, compiled: socket } = socketBySuffix(bundle, ref.socketSuffix);
  const side = socket.boundarySide === 'interior-floor' ? 'floor' : socket.boundarySide;
  const socketBoundary = bundle.boundaries.find(({ openings = [] }) => (
    openings.some(({ portalId: candidate, descriptorSocketId }) => (
      candidate === socket.id || descriptorSocketId === socket.id
    ))
  )) ?? bundle.boundaries.filter(({ side: candidate }) => candidate === side).sort((left, right) => {
    const distance = (boundary) => {
      const center = centerOf(boundary.bounds);
      return Math.hypot(center.x - socket.anchor.x, center.y - socket.anchor.y, center.z - socket.anchor.z);
    };
    return distance(left) - distance(right);
  })[0];
  if (!socketBoundary) throw new Error(`${socket.id} has no exact native boundary.`);
  const boundary = plan.structuralBoundaries.find(({ id }) => id === socketBoundary.id);
  const cell = plan.spatialCells.find(({ id }) => id === boundary?.cellId);
  if (!boundary || !cell) throw new Error(`${socket.id} boundary/cell was discarded before coordination.`);
  const surface = nearestApproachSurface(plan, socket.approachSurfaceIds, socket.anchor, socket.anchor.y);
  if (!surface) throw new Error(`${socket.id} has no surviving authored approach surface.`);
  const center = openingCenter(socket.anchor, side, socket.opening.height);
  const dimensions = ['floor', 'ceiling'].includes(side)
    ? { width: socket.opening.width, height: 0.22, depth: socket.opening.width }
    : { width: socket.opening.width, height: socket.opening.height, depth: 1.2 };
  const opening = replaceOpening(boundary, portalId, endpointName, socket.id, center, dimensions);
  const surfaceCenter = centerOf(surface.bounds);
  const landingDelta = vector(surfaceCenter.x - socket.anchor.x, 0, surfaceCenter.z - socket.anchor.z);
  const landingLength = Math.hypot(landingDelta.x, landingDelta.z);
  const outward = sideDirection(side, landingLength > EPSILON ? {
    x: -landingDelta.x / landingLength,
    z: -landingDelta.z / landingLength,
  } : socket.facing);
  return {
    endpoint: {
      regionId: cell.regionId,
      cellId: cell.id,
      boundaryId: boundary.id,
      openingId: opening.id,
      side,
      center,
      elevation: socket.anchor.y,
      placementBucket: `native-${ref.socketSuffix}`,
      dimensions,
      nativeFixedRoomSocketId: socket.id,
      nativeLandingSurfaceId: surface.id,
      nativeLandingDirection: landingLength > EPSILON
        ? vector(landingDelta.x / landingLength, 0, landingDelta.z / landingLength)
        : vector(-outward.x, 0, -outward.z),
    },
    surfaceId: surface.id,
    outward,
    source: { kind: 'native', placementId: bundle.placement.id, socketId: local.id },
  };
}

function packPlacement(plan, placementId) {
  const placement = plan.semanticRoomPackPlacements.find((candidate) => (
    (candidate.placementId ?? candidate.id) === placementId
  ));
  if (!placement) throw new Error(`Canonical connector cannot resolve semantic pack ${placementId}.`);
  return placement;
}

function packBoundaryForSocket(plan, placement, socket, bindingRecord) {
  const direct = plan.structuralBoundaries.find(({ id }) => id === bindingRecord?.boundaryId);
  if (direct) return direct;
  const side = sideFromFacing(socket.worldForward);
  const candidates = plan.structuralBoundaries.filter(({ id, side: candidateSide }) => (
    id.startsWith(`${placement.placementId}:boundary:SHELL_DOOR_HEADER_`)
      && candidateSide === side
  ));
  return candidates.sort((left, right) => {
    const distance = (boundary) => {
      const center = centerOf(boundary.bounds);
      return Math.hypot(center.x - socket.worldPosition.x, center.z - socket.worldPosition.z);
    };
    return distance(left) - distance(right);
  })[0] ?? null;
}

function packSurfaceForSocket(plan, placement, socket, bindingRecord) {
  const direct = plan.walkableSurfaces.find(({ id }) => id === bindingRecord?.surfaceId);
  if (direct) return direct;
  const ids = new Set(placement.placedRecordIds?.walkableSurfaceIds ?? []);
  return plan.walkableSurfaces.filter(({ id }) => ids.has(id)).sort((left, right) => {
    const distance = (surface) => {
      const center = centerOf(surface.bounds);
      return Math.hypot(
        center.x - socket.worldPosition.x,
        (surface.bounds.max.y - socket.worldElevation) * 1.5,
        center.z - socket.worldPosition.z,
      );
    };
    return distance(left) - distance(right) || left.id.localeCompare(right.id);
  })[0] ?? null;
}

function bindPackEndpoint(plan, ref, portalId, endpointName) {
  const placement = packPlacement(plan, ref.placementId);
  const socket = placement.sockets.find(({ id, localId }) => id === ref.socketId || localId === ref.socketId);
  const bindingRecord = placement.socketBindings?.find(({ socketId }) => socketId === ref.socketId);
  if (!socket) throw new Error(`${ref.placementId} has no authored socket ${ref.socketId}.`);
  const boundary = packBoundaryForSocket(plan, placement, socket, bindingRecord);
  const surface = packSurfaceForSocket(plan, placement, socket, bindingRecord);
  const cell = plan.spatialCells.find(({ id }) => id === boundary?.cellId);
  if (!boundary || !surface || !cell) {
    throw new Error(`${ref.placementId}:${ref.socketId} has no physical boundary, surface, or cell.`);
  }
  if (bindingRecord?.capId) {
    plan.structuralBoundaries = plan.structuralBoundaries.filter(({ id }) => id !== bindingRecord.capId);
    plan.structuralFixtures = plan.structuralFixtures.filter(({ id }) => id !== bindingRecord.capId);
  }
  const side = sideFromFacing(socket.worldForward);
  const dimensions = { width: socket.aperture.width, height: socket.aperture.height, depth: 1.2 };
  const center = openingCenter(socket.worldPosition, side, socket.aperture.height);
  const opening = replaceOpening(boundary, portalId, endpointName, socket.worldId, center, dimensions);
  if (bindingRecord) {
    bindingRecord.status = 'bound';
    bindingRecord.portalId = portalId;
    bindingRecord.boundaryId = boundary.id;
    bindingRecord.surfaceId = surface.id;
    bindingRecord.capId = null;
  }
  return {
    endpoint: {
      regionId: cell.regionId,
      cellId: cell.id,
      boundaryId: boundary.id,
      openingId: opening.id,
      side,
      center,
      elevation: socket.worldElevation,
      placementBucket: `authored-socket-${ref.socketId}`,
      dimensions,
      semanticRoomPackSocketId: socket.worldId,
    },
    surfaceId: surface.id,
    outward: sideDirection(side, socket.worldForward),
    source: { kind: 'pack', placementId: ref.placementId, socketId: ref.socketId },
  };
}

function createNativeCatchment(plan, context, ref, portalId, endpointName) {
  const bundle = bundleFor(context, ref.placementKey);
  const source = socketBySuffix(bundle, 'lower.freight-catchment').compiled;
  const half = Math.max(2.2, source.opening.width * 0.75);
  const top = source.anchor.y;
  const bottom = top - Number(ref.depth ?? 5.4);
  const cellId = 'cell.canonical.freight-catchment';
  const surfaceId = 'surface.canonical.freight-catchment';
  const cellBounds = {
    min: vector(source.anchor.x - half, bottom, source.anchor.z - half),
    max: vector(source.anchor.x + half, top, source.anchor.z + half),
  };
  const cell = {
    id: cellId,
    regionId: ref.regionId,
    bounds: cellBounds,
    playable: true,
    interior: true,
    cameraContained: true,
    occupiedVolume: true,
    canonicalCatchment: true,
  };
  plan.spatialCells.push(cell);
  const boundaryIds = [];
  const boundaryBounds = (side) => {
    const t = 0.4;
    if (side === 'north') return { min: vector(cellBounds.min.x, bottom, cellBounds.min.z - t), max: vector(cellBounds.max.x, top, cellBounds.min.z) };
    if (side === 'south') return { min: vector(cellBounds.min.x, bottom, cellBounds.max.z), max: vector(cellBounds.max.x, top, cellBounds.max.z + t) };
    if (side === 'west') return { min: vector(cellBounds.min.x - t, bottom, cellBounds.min.z), max: vector(cellBounds.min.x, top, cellBounds.max.z) };
    if (side === 'east') return { min: vector(cellBounds.max.x, bottom, cellBounds.min.z), max: vector(cellBounds.max.x + t, top, cellBounds.max.z) };
    if (side === 'floor') return { min: vector(cellBounds.min.x, bottom - t, cellBounds.min.z), max: vector(cellBounds.max.x, bottom, cellBounds.max.z) };
    return { min: vector(cellBounds.min.x, top, cellBounds.min.z), max: vector(cellBounds.max.x, top + t, cellBounds.max.z) };
  };
  let ceilingBoundary = null;
  for (const side of ['north', 'south', 'east', 'west', 'floor', 'ceiling']) {
    const boundary = {
      id: `boundary.canonical.freight-catchment.${side}`,
      cellId,
      regionId: ref.regionId,
      side,
      kind: side === 'ceiling' ? 'portal-frame' : 'solid',
      bounds: boundaryBounds(side),
      openings: [],
      materialProfileId: 'connector.intentional-drop',
      visualProfile: `connector.intentional-drop:${side}`,
      collider: true,
      collision: 'static',
      opaque: true,
      canonicalCatchment: true,
    };
    plan.structuralBoundaries.push(boundary);
    boundaryIds.push(boundary.id);
    if (side === 'ceiling') ceilingBoundary = boundary;
  }
  const surface = {
    id: surfaceId,
    regionId: ref.regionId,
    cellId,
    bounds: {
      min: vector(cellBounds.min.x + 0.4, bottom - 0.12, cellBounds.min.z + 0.4),
      max: vector(cellBounds.max.x - 0.4, bottom, cellBounds.max.z - 0.4),
    },
    center: vector(source.anchor.x, bottom, source.anchor.z),
    purpose: 'damage-free playable freight catchment and permanent-return landing',
    supportBoundaryIds: [`boundary.canonical.freight-catchment.floor`],
    supportProfile: 'visible-reinforced-catchment-support',
    visualProfile: 'factory-floor-v2',
    collision: 'static',
    createsLedgeCandidates: false,
  };
  plan.walkableSurfaces.push(surface);
  const center = vector(source.anchor.x, top, source.anchor.z);
  const dimensions = { width: source.opening.width, height: 0.22, depth: source.opening.width };
  const opening = replaceOpening(ceilingBoundary, portalId, endpointName, `${cellId}:ceiling-aperture`, center, dimensions);
  return {
    endpoint: {
      regionId: ref.regionId,
      cellId,
      boundaryId: ceilingBoundary.id,
      openingId: opening.id,
      side: 'ceiling',
      center,
      elevation: top,
      placementBucket: 'playable-lower-catchment',
      dimensions,
    },
    surfaceId,
    outward: vector(1, 0, 0),
    source: { kind: 'native-catchment', placementId: bundle.placement.id, socketId: 'lower.freight-catchment' },
    boundaryIds,
  };
}

function bindEndpoint(plan, context, ref, portalId, endpointName) {
  if (ref.kind === 'native') return bindNativeEndpoint(plan, context, ref, portalId, endpointName);
  if (ref.kind === 'pack') return bindPackEndpoint(plan, ref, portalId, endpointName);
  if (ref.kind === 'native-catchment') return createNativeCatchment(plan, context, ref, portalId, endpointName);
  throw new Error(`${portalId}:${endpointName} has unsupported endpoint kind ${ref.kind}.`);
}

function endpointFloorPoint(endpoint) {
  return vector(endpoint.center.x, endpoint.elevation, endpoint.center.z);
}

function pointOutward(point, direction, distance = PORTAL_THROAT_DEPTH) {
  return vector(point.x + direction.x * distance, point.y, point.z + direction.z * distance);
}

function overlaps2d(left, right) {
  return left.min.x < right.max.x - EPSILON && left.max.x > right.min.x + EPSILON
    && left.min.z < right.max.z - EPSILON && left.max.z > right.min.z + EPSILON;
}

function overlaps3d(left, right) {
  return left.min.x < right.max.x - EPSILON && left.max.x > right.min.x + EPSILON
    && left.min.y < right.max.y - EPSILON && left.max.y > right.min.y + EPSILON
    && left.min.z < right.max.z - EPSILON && left.max.z > right.min.z + EPSILON;
}

function overlapsVerticalBand(bounds, minimumY, maximumY) {
  return bounds.min.y < maximumY - EPSILON && bounds.max.y > minimumY + EPSILON;
}

function expandedFootprint(bounds, margin) {
  return {
    min: { x: bounds.min.x - margin, z: bounds.min.z - margin },
    max: { x: bounds.max.x + margin, z: bounds.max.z + margin },
  };
}

function pointInFootprint(point, bounds) {
  return point.x > bounds.min.x + EPSILON && point.x < bounds.max.x - EPSILON
    && point.z > bounds.min.z + EPSILON && point.z < bounds.max.z - EPSILON;
}

function segmentFootprint(from, to, halfWidth) {
  return {
    min: { x: Math.min(from.x, to.x) - halfWidth, z: Math.min(from.z, to.z) - halfWidth },
    max: { x: Math.max(from.x, to.x) + halfWidth, z: Math.max(from.z, to.z) + halfWidth },
  };
}

function canonicalObstacles(plan, halfWidth, minimumY, maximumY, reservations = [], portalId = null) {
  return plan.spatialCells.filter((cell) => (
    cell.occupiedVolume !== false
      && !cell.canonicalCatchment
      && overlapsVerticalBand(cell.bounds, minimumY, maximumY)
  )).map(({ bounds }) => expandedFootprint(bounds, halfWidth + ROUTE_CLEARANCE)).concat(
    reservations
      .filter((reservation) => reservation.portalId !== portalId)
      // The reservation already contains the future route's throat radius.
      // Expand it once more by the route currently being planned so the two
      // *volumes*, rather than only their centrelines, remain disjoint.
      .map(({ footprint }) => expandedFootprint(footprint, halfWidth + ROUTE_CLEARANCE)),
  );
}

function shortestOrthogonalPath(start, end, obstacles, halfWidth) {
  if (Math.abs(start.x - end.x) <= 0.01 && Math.abs(start.z - end.z) <= 0.01) return [start, end];
  const all = obstacles.flatMap((bounds) => [bounds.min.x, bounds.max.x]);
  const allZ = obstacles.flatMap((bounds) => [bounds.min.z, bounds.max.z]);
  const xs = [...new Set([start.x, end.x, ...all, Math.min(start.x, end.x, ...all) - 30, Math.max(start.x, end.x, ...all) + 30])].sort((a, b) => a - b);
  const zs = [...new Set([start.z, end.z, ...allZ, Math.min(start.z, end.z, ...allZ) - 30, Math.max(start.z, end.z, ...allZ) + 30])].sort((a, b) => a - b);
  const nodes = [];
  const byKey = new Map();
  const key = (x, z) => `${x.toFixed(6)},${z.toFixed(6)}`;
  for (const x of xs) for (const z of zs) {
    const point = { x, z };
    if (obstacles.some((bounds) => pointInFootprint(point, bounds))) continue;
    const node = { x, z, key: key(x, z) };
    nodes.push(node);
    byKey.set(node.key, node);
  }
  const startNode = byKey.get(key(start.x, start.z));
  const endNode = byKey.get(key(end.x, end.z));
  if (!startNode || !endNode) throw new Error('Canonical connector endpoints are buried in occupied space.');
  // Obstacles are already expanded by the connector half-width. Test the
  // centreline here; expanding both sides would double-count player/camera
  // clearance and make valid lanes appear blocked.
  const clear = (left, right) => !obstacles.some((bounds) => overlaps2d(
    segmentFootprint(left, right, 0), bounds,
  ));
  const adjacency = new Map(nodes.map(({ key: nodeKey }) => [nodeKey, []]));
  const rows = new Map();
  const columns = new Map();
  for (const node of nodes) {
    const row = rows.get(node.z) ?? [];
    row.push(node);
    rows.set(node.z, row);
    const column = columns.get(node.x) ?? [];
    column.push(node);
    columns.set(node.x, column);
  }
  const connectNeighbours = (groups, axis) => {
    for (const group of groups.values()) {
      group.sort((a, b) => a[axis] - b[axis]);
      for (let index = 1; index < group.length; index += 1) {
        const left = group[index - 1];
        const right = group[index];
        if (!clear(left, right)) continue;
        const cost = Math.abs(right[axis] - left[axis]);
        adjacency.get(left.key).push({ node: right, cost });
        adjacency.get(right.key).push({ node: left, cost });
      }
    }
  };
  connectNeighbours(rows, 'x');
  connectNeighbours(columns, 'z');
  const distances = new Map([[startNode.key, 0]]);
  const previous = new Map();
  const pending = new Set(nodes.map(({ key: nodeKey }) => nodeKey));
  while (pending.size) {
    let currentKey = null;
    let currentDistance = Infinity;
    for (const candidate of pending) {
      const distance = distances.get(candidate) ?? Infinity;
      if (distance < currentDistance) {
        currentDistance = distance;
        currentKey = candidate;
      }
    }
    if (!currentKey || !Number.isFinite(currentDistance)) break;
    pending.delete(currentKey);
    if (currentKey === endNode.key) break;
    for (const edge of adjacency.get(currentKey)) {
      if (!pending.has(edge.node.key)) continue;
      const candidate = currentDistance + edge.cost;
      if (candidate + EPSILON < (distances.get(edge.node.key) ?? Infinity)) {
        distances.set(edge.node.key, candidate);
        previous.set(edge.node.key, currentKey);
      }
    }
  }
  if (!distances.has(endNode.key)) {
    throw new Error(`No collision-free orthogonal connector route exists from ${start.x},${start.z} to ${end.x},${end.z} across ${obstacles.length} occupied footprints.`);
  }
  const path = [];
  for (let cursor = endNode.key; cursor; cursor = previous.get(cursor)) {
    const node = byKey.get(cursor);
    path.push(vector(node.x, start.y, node.z));
    if (cursor === startNode.key) break;
  }
  return path.reverse();
}

function endpointExteriorPoint(plan, endpoint, outward, halfWidth) {
  const point = endpointFloorPoint(endpoint);
  if (['floor', 'ceiling'].includes(endpoint.side)) {
    return pointOutward(point, outward, PORTAL_THROAT_DEPTH);
  }
  const cell = plan.spatialCells.find(({ id }) => id === endpoint.cellId);
  if (!cell) throw new Error(`${endpoint.cellId} is missing while reserving its canonical socket throat.`);
  const clearance = halfWidth + ROUTE_CLEARANCE + 0.2;
  let distance = PORTAL_THROAT_DEPTH;
  if (outward.x > 0.5) distance = Math.max(distance, cell.bounds.max.x + clearance - point.x);
  else if (outward.x < -0.5) distance = Math.max(distance, point.x - (cell.bounds.min.x - clearance));
  else if (outward.z > 0.5) distance = Math.max(distance, cell.bounds.max.z + clearance - point.z);
  else if (outward.z < -0.5) distance = Math.max(distance, point.z - (cell.bounds.min.z - clearance));
  return pointOutward(point, outward, distance);
}

function routeSegmentBounds(start, end, halfWidth, headroom) {
  return {
    min: vector(
      Math.min(start.x, end.x) - halfWidth,
      Math.min(start.y, end.y),
      Math.min(start.z, end.z) - halfWidth,
    ),
    max: vector(
      Math.max(start.x, end.x) + halfWidth,
      Math.max(start.y, end.y) + headroom,
      Math.max(start.z, end.z) + halfWidth,
    ),
  };
}

function routeCollision(plan, routePoints, portal, halfWidth, reservations) {
  const headroom = Math.max(
    4.2,
    Number(portal.from.dimensions.height),
    Number(portal.to.dimensions.height),
  );
  const segments = routePoints.slice(1).map((end, index) => ({
    index,
    bounds: routeSegmentBounds(routePoints[index], end, halfWidth, headroom),
  }));
  for (const segment of segments) {
    for (const cell of plan.spatialCells) {
      if (cell.occupiedVolume === false || !overlaps3d(segment.bounds, cell.bounds)) continue;
      const endpointRoomOverlap = (segment.index === 0 && cell.id === portal.from.cellId)
        || (segment.index === segments.length - 1 && cell.id === portal.to.cellId);
      if (endpointRoomOverlap) continue;
      return { kind: 'occupied-cell', id: cell.id, segmentIndex: segment.index };
    }
    const footprint = {
      min: { x: segment.bounds.min.x, z: segment.bounds.min.z },
      max: { x: segment.bounds.max.x, z: segment.bounds.max.z },
    };
    const reservation = reservations.find((candidate) => (
      candidate.portalId !== portal.id && overlaps2d(footprint, candidate.footprint)
    ));
    if (reservation) {
      return { kind: 'reserved-socket-throat', id: reservation.id, segmentIndex: segment.index };
    }
  }
  return null;
}

function uniqueRoutePoints(points) {
  return points.filter((point, index) => index === 0 || Math.hypot(
    point.x - points[index - 1].x,
    point.y - points[index - 1].y,
    point.z - points[index - 1].z,
  ) > 0.01);
}

function endpointReservations(plan, resolvedBindings) {
  const reservations = [];
  for (const [portalId, bindingRecord] of resolvedBindings) {
    for (const endpointName of ['from', 'to']) {
      const resolved = bindingRecord.resolved[endpointName];
      const endpoint = plan.portals.find(({ id }) => id === portalId)?.[endpointName];
      if (!endpoint) continue;
      const halfWidth = Math.max(1.6, Number(endpoint.dimensions.width) * 0.5);
      const start = endpointFloorPoint(endpoint);
      const exterior = endpointExteriorPoint(plan, endpoint, resolved.outward, halfWidth);
      reservations.push({
        id: `reservation.${portalId.replace('portal.', '')}.${endpointName}`,
        portalId,
        endpointName,
        footprint: segmentFootprint(start, exterior, halfWidth + ROUTE_CLEARANCE),
      });
    }
  }
  return reservations;
}

function routeLaneCandidates(plan, portal) {
  const authoredCells = plan.spatialCells.filter(({ connector }) => connector !== true);
  const authoredCeiling = Math.max(...authoredCells.map(({ bounds }) => bounds.max.y));
  const maximumEndpoint = Math.max(portal.from.elevation, portal.to.elevation);
  const candidates = [
    maximumEndpoint,
    authoredCeiling + 1.2,
    authoredCeiling + 7.4,
    authoredCeiling + 13.6,
    authoredCeiling + 19.8,
  ];
  return [...new Set(candidates.map((value) => Number(value.toFixed(3))))];
}

function buildBandedRoute(plan, portal, endpoints, laneY, reservations) {
  const start = endpointFloorPoint(portal.from);
  const end = endpointFloorPoint(portal.to);
  const halfWidth = Math.max(1.6, portal.traversal.minimumWidth * 0.5);
  const headroom = Math.max(4.2, portal.from.dimensions.height, portal.to.dimensions.height);
  const startOut = endpointExteriorPoint(plan, portal.from, endpoints.from.outward, halfWidth);
  const endOut = endpointExteriorPoint(plan, portal.to, endpoints.to.outward, halfWidth);
  const startUsesVertical = Math.abs(laneY - start.y) > 0.01;
  const endUsesVertical = Math.abs(laneY - end.y) > 0.01;
  const startLane = startUsesVertical
    ? pointOutward(vector(startOut.x, laneY, startOut.z), endpoints.from.outward, VERTICAL_LANDING_RUN)
    : vector(startOut.x, laneY, startOut.z);
  const endLane = endUsesVertical
    ? pointOutward(vector(endOut.x, laneY, endOut.z), endpoints.to.outward, VERTICAL_LANDING_RUN)
    : vector(endOut.x, laneY, endOut.z);
  const obstacles = canonicalObstacles(
    plan,
    halfWidth,
    laneY,
    laneY + headroom,
    reservations,
    portal.id,
  );
  const middle = shortestOrthogonalPath(
    startLane,
    endLane,
    obstacles,
    halfWidth,
  ).map((point) => vector(point.x, laneY, point.z));
  const fromVerticalFirst = ['floor', 'ceiling'].includes(portal.from.side);
  const toVerticalLast = ['floor', 'ceiling'].includes(portal.to.side);
  const routePoints = uniqueRoutePoints([
    start,
    ...(fromVerticalFirst ? [vector(start.x, laneY, start.z)] : [startOut]),
    ...(!fromVerticalFirst && Math.abs(laneY - start.y) > 0.01
      ? [vector(startOut.x, laneY, startOut.z)] : []),
    ...(fromVerticalFirst ? [vector(startOut.x, laneY, startOut.z)] : []),
    ...(startUsesVertical ? [startLane] : []),
    ...middle.slice(1, -1),
    ...(endUsesVertical ? [endLane] : []),
    vector(endOut.x, laneY, endOut.z),
    ...(toVerticalLast ? [vector(end.x, laneY, end.z)]
      : Math.abs(laneY - end.y) > 0.01 ? [endOut] : []),
    end,
  ]);
  const collision = routeCollision(plan, routePoints, portal, halfWidth, reservations);
  if (collision) {
    throw new Error(`${collision.kind}:${collision.id}:segment-${collision.segmentIndex}`);
  }
  return routePoints;
}

function routeForPortal(plan, portal, endpoints, reservations = []) {
  const start = endpointFloorPoint(portal.from);
  const end = endpointFloorPoint(portal.to);
  if (portal.id === 'portal.assembly-freight-drop') {
    return {
      routePoints: [start, end],
      laneY: null,
      strategy: 'authored-intentional-drop',
      requiredApproachType: portal.approachType,
    };
  }
  const failures = [];
  for (const laneY of routeLaneCandidates(plan, portal)) {
    try {
      return {
        routePoints: buildBandedRoute(plan, portal, endpoints, laneY, reservations),
        laneY,
        strategy: laneY === Math.max(portal.from.elevation, portal.to.elevation)
          ? 'native-elevation-orthogonal'
          : 'enclosed-authored-overpass',
        // Vertical overpass shafts must use the same ladder contract consumed
        // by runtime mounting and fixture validation. A generic doorway with
        // a hidden vertical collision column is not a traversable route.
        requiredApproachType: ['ladder', 'lift', 'gear-platform'].includes(portal.approachType)
          ? portal.approachType
          : Math.abs(laneY - portal.from.elevation) > 0.01
            || Math.abs(laneY - portal.to.elevation) > 0.01
            ? 'ladder'
            : portal.approachType,
      };
    } catch (cause) {
      failures.push({ laneY, message: cause.message });
    }
  }
  throw new Error(`No collision-free 3D connector route exists (${failures.map(({ laneY, message }) => `${laneY}:${message}`).join(' | ')}).`);
}

function replaceGeneratedEndpointLinks(plan, portal, endpointSurfaceIds) {
  plan.traversalLinks = plan.traversalLinks.filter((link) => link.portalId !== portal.id);
  const routeSurfaceIds = portal.physicalRoute?.surfaceIds ?? [];
  for (let index = 0; index < routeSurfaceIds.length; index += 1) {
    const surface = plan.walkableSurfaces.find(({ id }) => id === routeSurfaceIds[index]);
    if (!surface || !['stairs', 'walkable-stairs'].includes(surface.geometry?.type)) continue;
    const [start, end] = surface.geometry.path ?? [];
    const rise = start && end ? Math.abs(end.y - start.y) : Infinity;
    if (rise <= 0.05) {
      surface.geometry.type = 'walk';
      surface.geometry.maximumRiser = null;
      surface.geometry.minimumTread = null;
      continue;
    }
    surface.geometry.endpointSurfaceIds = {
      start: index === 0 ? endpointSurfaceIds.from : routeSurfaceIds[index - 1],
      end: index === routeSurfaceIds.length - 1 ? endpointSurfaceIds.to : routeSurfaceIds[index + 1],
    };
    surface.geometry.maximumEndpointHeightDelta = 0.05;
    surface.geometry.minimumEndpointOverlap = 1.2;
  }
  const common = {
    mode: portal.approachType,
    bidirectional: portal.direction !== 'forward-only',
    minimumWidth: portal.traversal.minimumWidth,
    portalId: portal.id,
    conditions: (portal.conditions ?? []).filter(({ op }) => op === 'stateEquals'),
  };
  if (routeSurfaceIds.length) {
    plan.traversalLinks.push(
      {
        id: `traversal.canonical.${portal.id.replace('portal.', '')}.from-endpoint`,
        regionId: portal.from.regionId,
        fromSurfaceId: endpointSurfaceIds.from,
        toSurfaceId: routeSurfaceIds[0],
        ...common,
      },
      {
        id: `traversal.canonical.${portal.id.replace('portal.', '')}.to-endpoint`,
        regionId: portal.to.regionId,
        fromSurfaceId: routeSurfaceIds.at(-1),
        toSurfaceId: endpointSurfaceIds.to,
        ...common,
      },
    );
  } else {
    plan.traversalLinks.push({
      id: `traversal.canonical.${portal.id.replace('portal.', '')}.direct`,
      regionId: portal.from.regionId,
      fromSurfaceId: endpointSurfaceIds.from,
      toSurfaceId: endpointSurfaceIds.to,
      ...common,
      ...(portal.approachType === 'intentional-drop' ? {
        bidirectional: false, damageFree: true, playableDestination: true,
      } : {}),
    });
  }
  portal.physicalRoute.endpointSurfaceIds = { ...endpointSurfaceIds };
}

function gateBarrierBounds(endpoint) {
  const { center, dimensions, side } = endpoint;
  const halfWidth = dimensions.width * 0.5;
  const halfHeight = dimensions.height * 0.5;
  const halfDepth = dimensions.depth * 0.5;
  if (side === 'east' || side === 'west') return {
    min: vector(center.x - halfDepth, center.y - halfHeight, center.z - halfWidth),
    max: vector(center.x + halfDepth, center.y + halfHeight, center.z + halfWidth),
  };
  if (side === 'north' || side === 'south') return {
    min: vector(center.x - halfWidth, center.y - halfHeight, center.z - halfDepth),
    max: vector(center.x + halfWidth, center.y + halfHeight, center.z + halfDepth),
  };
  return {
    min: vector(center.x - halfWidth, center.y - halfDepth, center.z - halfWidth),
    max: vector(center.x + halfWidth, center.y + halfDepth, center.z + halfWidth),
  };
}

function shiftBounds(bounds, delta) {
  if (!bounds?.min || !bounds?.max) return bounds;
  return {
    min: vector(bounds.min.x + delta.x, bounds.min.y + delta.y, bounds.min.z + delta.z),
    max: vector(bounds.max.x + delta.x, bounds.max.y + delta.y, bounds.max.z + delta.z),
  };
}

function placeGateControl(plan, gate, portal, endpointName, endpointBinding) {
  const endpoint = portal[endpointName];
  const action = plan.actions.find(({ id }) => id === gate.actionId);
  const anchor = plan.anchors.find(({ id }) => id === gate.anchorId);
  const approach = plan.walkableSurfaces.find(({ id }) => id === endpointBinding.surfaceId);
  if (!action || !anchor || !approach) throw new Error(`${gate.id} has no action, anchor, or approach surface.`);
  const laneAxis = ['north', 'south'].includes(endpoint.side) ? 'x' : 'z';
  const candidates = plan.walkableSurfaces.filter((surface) => (
    surface.cellId === endpoint.cellId
      && Math.abs(surface.bounds.max.y - endpoint.elevation) <= 0.1
      && (surface.bounds.max[laneAxis] <= endpoint.center[laneAxis] - endpoint.dimensions.width * 0.5 - 0.05
        || surface.bounds.min[laneAxis] >= endpoint.center[laneAxis] + endpoint.dimensions.width * 0.5 + 0.05)
  )).sort((left, right) => {
    const distance = (surface) => {
      const center = centerOf(surface.bounds);
      return Math.hypot(center.x - endpoint.center.x, center.z - endpoint.center.z);
    };
    return distance(left) - distance(right) || left.id.localeCompare(right.id);
  });
  const pad = candidates[0] ?? approach;
  const padCenter = centerOf(pad.bounds);
  const oldPosition = clonePlanData(anchor.position);
  anchor.regionId = endpoint.regionId;
  anchor.position = vector(padCenter.x, pad.bounds.max.y, padCenter.z);
  anchor.surfaceId = pad.id;
  anchor.safeSurfaceId = pad.id;
  anchor.approachSurfaceId = endpointBinding.surfaceId;
  anchor.forward = vector(endpoint.center.x - anchor.position.x, 0, endpoint.center.z - anchor.position.z);
  anchor.forwardX = anchor.forward.x;
  anchor.forwardZ = anchor.forward.z;
  pad.purpose = `${gate.id} static authored side-console pad`;
  pad.interactionSurfaceRole = 'side-control-pad';
  pad.createsLedgeCandidates = false;
  action.interaction.activationSide = 'either';
  const delta = vector(
    anchor.position.x - oldPosition.x,
    anchor.position.y - oldPosition.y,
    anchor.position.z - oldPosition.z,
  );
  const fixtureIds = new Set([...(action.visualFixtureIds ?? []), ...(action.colliderIds ?? [])]);
  for (const fixture of plan.structuralFixtures.filter(({ id }) => fixtureIds.has(id))) {
    fixture.bounds = shiftBounds(fixture.bounds, delta);
    fixture.colliderBounds = (fixture.colliderBounds ?? []).map((bounds) => shiftBounds(bounds, delta));
    fixture.regionId = endpoint.regionId;
    fixture.cellId = endpoint.cellId;
    fixture.supportBoundaryIds = [...(pad.supportBoundaryIds ?? [])];
    fixture.nativeSupportSurfaceId = pad.id;
  }
}

function retireCredentialLoopGate(plan) {
  const gateId = 'Gate_Credential_Loop';
  const gate = plan.progression?.gateContracts?.find(({ id }) => id === gateId);
  const actionId = gate?.actionId ?? 'action.open.credential-loop';
  const anchorId = gate?.anchorId ?? 'anchor.shortcut.credential-loop';
  const fixtureIds = new Set(plan.actions.filter(({ id }) => id === actionId)
    .flatMap((action) => [...(action.visualFixtureIds ?? []), ...(action.colliderIds ?? [])]));
  plan.progression.gateContracts = plan.progression.gateContracts.filter(({ id }) => id !== gateId);
  if (plan.progression.gates !== plan.progression.gateContracts) {
    plan.progression.gates = (plan.progression.gates ?? []).filter(({ id }) => id !== gateId);
  } else {
    plan.progression.gates = plan.progression.gateContracts;
  }
  plan.actions = plan.actions.filter(({ id }) => id !== actionId);
  plan.anchors = plan.anchors.filter(({ id }) => id !== anchorId);
  plan.structuralFixtures = plan.structuralFixtures.filter(({ id }) => !fixtureIds.has(id));
  plan.structuralBoundaries = plan.structuralBoundaries.filter(({ id }) => id !== gateId);
}

function rebuildGateBarriers(plan, bindingsByPortalId) {
  const portalById = new Map(plan.portals.map((portal) => [portal.id, portal]));
  const activeGateIds = new Set((plan.progression?.gateContracts ?? []).map(({ id }) => id));
  plan.structuralBoundaries = plan.structuralBoundaries.filter((boundary) => (
    !['gate-barrier', 'movable-gate-barrier'].includes(boundary.kind)
      || !activeGateIds.has(boundary.id)
  ));
  for (const gate of plan.progression?.gateContracts ?? []) {
    const portal = portalById.get(gate.portalId);
    const bindingRecord = bindingsByPortalId.get(gate.portalId);
    if (!portal || !bindingRecord) throw new Error(`${gate.id} has no canonical portal binding.`);
    const endpointName = bindingRecord.activationEndpoint ?? 'from';
    const endpoint = portal[endpointName];
    const endpointBinding = bindingRecord.resolved[endpointName];
    const barrierId = gate.barrierBoundaryId ?? gate.barrierId ?? gate.id;
    gate.barrierId = barrierId;
    gate.barrierBoundaryId = barrierId;
    gate.fromRegionId = portal.from.regionId;
    gate.toRegionId = portal.to.regionId;
    portal.barrierId = barrierId;
    plan.structuralBoundaries.push({
      id: barrierId,
      cellId: endpoint.cellId,
      regionId: endpoint.regionId,
      side: endpoint.side,
      kind: 'movable-gate-barrier',
      bounds: gateBarrierBounds(endpoint),
      openings: [],
      materialProfileId: 'security-gate-barrier-v2',
      visualProfile: 'opaque-colliding-security-gate-v2',
      collider: true,
      collision: 'dynamic',
      opaque: true,
      movable: true,
      blocksPortalId: portal.id,
      portalId: portal.id,
      actionId: gate.actionId,
      canonicalActivationEndpoint: endpointName,
    });
    const action = plan.actions.find(({ id }) => id === gate.actionId);
    if (action) action.barrierIds = [barrierId];
    placeGateControl(plan, gate, portal, endpointName, endpointBinding);
    for (const surfaceId of new Set([
      portal.physicalRoute.endpointSurfaceIds.from,
      portal.physicalRoute.endpointSurfaceIds.to,
      ...(portal.physicalRoute.surfaceIds ?? []),
    ])) {
      const surface = plan.walkableSurfaces.find(({ id }) => id === surfaceId);
      if (!surface) continue;
      surface.createsLedgeCandidates = false;
      surface.closedGatePortalIds = [...new Set([...(surface.closedGatePortalIds ?? []), portal.id])];
    }
  }
}

function makeAuxiliaryUndercroftServiceReturn(plan, context, addConnectorSpatialContracts, reservations = []) {
  const undercroft = packPlacement(plan, UNDERCROFT_PACK_ID);
  const socketId = undercroft.sockets.some(({ id }) => id === 'service_west') ? 'service_west' : 'upper_east';
  const from = bindPackEndpoint(plan, pack(UNDERCROFT_PACK_ID, socketId), 'aux.undercroft-hazard-service-return', 'from');
  const to = bindNativeEndpoint(plan, context, native('hazard', 'pipe.west-south-bucket'), 'aux.undercroft-hazard-service-return', 'to');
  const pseudo = {
    id: 'portal.auxiliary.undercroft-hazard-service-return',
    from: from.endpoint,
    to: to.endpoint,
    connectorForm: 'overflow-tunnel',
    placementBucket: `authored-socket-${socketId}`,
    elevationBand: Math.min(from.endpoint.elevation, to.endpoint.elevation),
    elevationBands: [from.endpoint.elevation, to.endpoint.elevation],
    approachType: 'ladder',
    direction: 'bidirectional',
    barrierId: null,
    initiallyOpen: true,
    mechanismId: null,
    conditions: [],
    traversalEffects: [],
    traversal: { minimumWidth: Math.min(from.endpoint.dimensions.width, to.endpoint.dimensions.width), minimumHeadroom: 3.2, cameraClearance: 1.8 },
    connectorProfile: { enclosed: true, framed: true, supported: true, wallProfile: 'overflow-tunnel-walls-v2', ceilingProfile: 'overflow-tunnel-ceiling-v2', supportProfile: 'overflow-tunnel-supports-v2' },
    visibleDestinationRegionId: to.endpoint.regionId,
  };
  const route = routeForPortal(plan, pseudo, { from, to }, reservations);
  pseudo.authoredRoute = {
    routePoints: route.routePoints,
    laneY: route.laneY,
    routeStrategy: route.strategy,
  };
  pseudo.approachType = route.requiredApproachType;
  addConnectorSpatialContracts({
    portals: [pseudo],
    spatialCells: plan.spatialCells,
    structuralBoundaries: plan.structuralBoundaries,
    walkableSurfaces: plan.walkableSurfaces,
    traversalLinks: plan.traversalLinks,
  });
  replaceGeneratedEndpointLinks(plan, pseudo, { from: from.surfaceId, to: to.surfaceId });
  for (const link of plan.traversalLinks.filter(({ portalId, proofPortalId }) => (
    portalId === pseudo.id || proofPortalId === pseudo.id
  ))) {
    link.auxiliaryConnectionId = 'auxiliary.undercroft-hazard-service-return';
    delete link.portalId;
    delete link.proofPortalId;
  }
  return {
    id: 'auxiliary.undercroft-hazard-service-return',
    sourceSocketId: `${UNDERCROFT_PACK_ID}:${socketId}`,
    destinationSocketId: to.source.socketId,
    fromRegionId: pseudo.from.regionId,
    toRegionId: pseudo.to.regionId,
    physicalRoute: clonePlanData(pseudo.physicalRoute),
    enclosed: true,
    supported: true,
    bidirectional: true,
    portalCountContribution: 0,
  };
}

function updateLogicalCollections(plan) {
  const connections = plan.portals.map((portal) => ({
    id: portal.id,
    fromRegionId: portal.from.regionId,
    toRegionId: portal.to.regionId,
    barrierId: portal.barrierId ?? null,
  }));
  plan.connectionOrder = plan.portals.map(({ id }) => id);
  plan.progression.connections = clonePlanData(connections);
  plan.minimap.connections = plan.portals.map((portal) => ({
    id: portal.id,
    fromRegionId: portal.from.regionId,
    toRegionId: portal.to.regionId,
    direction: portal.direction,
    elevationBands: [portal.from.elevation, portal.to.elevation],
    barrierId: portal.barrierId ?? null,
    mechanismId: portal.mechanismId ?? null,
  }));
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Rebinds and rebuilds every live Golden portal after canonical native-room
 * installation. `addConnectorSpatialContracts` is injected from the Golden
 * authoring module so this coordinator and the original fixture share one
 * structural-cell implementation without introducing a circular import.
 */
export function rebuildCanonicalNativeV1GoldenConnectionsV2(plan, context, hooks = {}) {
  assertMutablePlan(plan);
  const addConnectorSpatialContracts = hooks.addConnectorSpatialContracts;
  if (typeof addConnectorSpatialContracts !== 'function') {
    throw new TypeError('Canonical connection coordination requires addConnectorSpatialContracts.');
  }
  const expectedPortalIds = stablePortalIds();
  const actualPortalIds = plan.portals.map(({ id }) => id);
  if (actualPortalIds.length !== expectedPortalIds.length
    || expectedPortalIds.some((id) => !actualPortalIds.includes(id))) {
    throw new Error(`Canonical Golden requires exactly ${expectedPortalIds.length} stable portals.`);
  }
  if (plan.semanticRoomPackAnnexRelocation?.status !== 'relocated-awaiting-canonical-route-rebuild'
    || plan.semanticRoomPackAnnexRelocation.canonicalRouteRebuildRequired !== true) {
    throw new Error('Semantic room-pack annex relocation must succeed before canonical connection coordination.');
  }

  // The atomic relocation API freezes each accepted descriptor placement.
  // The plan itself remains mutable; clone only these serializable records so
  // their socket-binding ledger can be updated to the rebuilt routes.
  plan.semanticRoomPackPlacements = plan.semanticRoomPackPlacements.map(clonePlanData);

  const removed = purgeStaleConnectorGeometry(plan);
  retireCredentialLoopGate(plan);
  const portalById = new Map(plan.portals.map((portal) => [portal.id, portal]));
  const resolvedBindings = new Map();
  const routeLedger = [];
  // Resolve every exact authored socket before planning any corridor. This
  // lets the route planner reserve all twenty-one physical throat volumes up
  // front, so an early route cannot silently occupy a later route's only
  // usable exit.
  for (const bindingRecord of CANONICAL_NATIVE_V1_GOLDEN_PORTAL_BINDINGS_V2) {
    const portal = portalById.get(bindingRecord.portalId);
    if (!portal) throw new Error(`Missing stable portal ${bindingRecord.portalId}.`);
    const from = bindEndpoint(plan, context, bindingRecord.from, portal.id, 'from');
    const to = bindEndpoint(plan, context, bindingRecord.to, portal.id, 'to');
    portal.from = from.endpoint;
    portal.to = to.endpoint;
    portal.visibleDestinationRegionId = to.endpoint.regionId;
    portal.placementBucket = from.endpoint.placementBucket;
    portal.elevationBand = Math.min(from.endpoint.elevation, to.endpoint.elevation);
    portal.elevationBands = [from.endpoint.elevation, to.endpoint.elevation];
    portal.traversal.minimumWidth = Math.min(from.endpoint.dimensions.width, to.endpoint.dimensions.width);
    portal.traversal.minimumHeadroom = Math.min(
      Number(portal.traversal.minimumHeadroom ?? 3.2),
      from.endpoint.dimensions.height,
      to.endpoint.dimensions.height,
    );
    if (bindingRecord.retireGateId) {
      portal.barrierId = null;
      portal.conditions = (portal.conditions ?? []).filter(({ gateId }) => gateId !== bindingRecord.retireGateId);
      portal.initiallyOpen = true;
      portal.mechanismId = null;
    }
    resolvedBindings.set(portal.id, { ...bindingRecord, resolved: { from, to } });
  }

  const reservations = endpointReservations(plan, resolvedBindings);
  for (const bindingRecord of CANONICAL_NATIVE_V1_GOLDEN_PORTAL_BINDINGS_V2) {
    const portal = portalById.get(bindingRecord.portalId);
    const resolved = resolvedBindings.get(portal.id);
    const { from, to } = resolved.resolved;
    let route;
    try {
      route = routeForPortal(plan, portal, { from, to }, reservations);
    } catch (cause) {
      throw new Error(`${portal.id} route planning failed: ${cause.message}`, { cause });
    }
    portal.authoredRoute = {
      ...(portal.authoredRoute ?? {}),
      routePoints: route.routePoints,
      laneY: route.laneY,
      routeStrategy: route.strategy,
      coordinatorRevision: CANONICAL_NATIVE_V1_GOLDEN_CONNECTION_REVISION_V2,
    };
    portal.approachType = route.requiredApproachType;
    addConnectorSpatialContracts({
      portals: [portal],
      spatialCells: plan.spatialCells,
      structuralBoundaries: plan.structuralBoundaries,
      walkableSurfaces: plan.walkableSurfaces,
      traversalLinks: plan.traversalLinks,
    });
    replaceGeneratedEndpointLinks(plan, portal, { from: from.surfaceId, to: to.surfaceId });
    portal.physicalRoute.replacementPolicy = 'canonical-native-and-pack-socket-rebuild';
    portal.physicalRoute.endpointSources = { from: from.source, to: to.source };
    routeLedger.push({
      portalId: portal.id,
      from: clonePlanData(from.source),
      to: clonePlanData(to.source),
      cellIds: [...portal.physicalRoute.cellIds],
      boundaryIds: [...portal.physicalRoute.boundaryIds],
      surfaceIds: [...portal.physicalRoute.surfaceIds],
      endpointSurfaceIds: clonePlanData(portal.physicalRoute.endpointSurfaceIds),
      routePoints: clonePlanData(portal.physicalRoute.routePoints),
      laneY: route.laneY,
      routeStrategy: route.strategy,
      enclosed: portal.physicalRoute.enclosed === true,
      supported: portal.physicalRoute.supported === true,
      continuous: portal.physicalRoute.continuous === true,
    });
  }

  const auxiliary = makeAuxiliaryUndercroftServiceReturn(
    plan,
    context,
    addConnectorSpatialContracts,
    reservations,
  );
  plan.canonicalAuxiliaryConnections = [auxiliary];
  if (typeof hooks.bindStairsToExactDeckSeams === 'function') {
    hooks.bindStairsToExactDeckSeams({
      spatialCells: plan.spatialCells,
      structuralBoundaries: plan.structuralBoundaries,
      walkableSurfaces: plan.walkableSurfaces,
      traversalLinks: plan.traversalLinks,
      structuralFixtures: plan.structuralFixtures,
    });
  }
  rebuildGateBarriers(plan, resolvedBindings);
  updateLogicalCollections(plan);

  const unresolved = routeLedger.filter((route) => (
    !route.enclosed || !route.supported || !route.continuous
      || route.cellIds.length === 0
      || route.boundaryIds.length !== route.cellIds.length * 6
  )).map(({ portalId }) => portalId);
  const routedPortalIds = routeLedger.map(({ portalId }) => portalId).sort();
  const diagnosticPayload = {
    revision: CANONICAL_NATIVE_V1_GOLDEN_CONNECTION_REVISION_V2,
    routedPortalIds,
    removed,
    routeLedger,
    auxiliaryConnections: [auxiliary],
    unresolved,
  };
  const diagnostics = {
    schemaVersion: 'canonical-native-v1-golden-connections/1',
    revision: CANONICAL_NATIVE_V1_GOLDEN_CONNECTION_REVISION_V2,
    accepted: unresolved.length === 0 && routedPortalIds.length === expectedPortalIds.length,
    physicalRouteCount: routeLedger.length,
    routedPortalIds,
    routedConnectionIds: routedPortalIds,
    unresolved,
    removedStaleRecordCounts: Object.fromEntries(Object.entries(removed).map(([key, ids]) => [key, ids.length])),
    routeLedger,
    auxiliaryConnections: [auxiliary],
    diagnosticHash: fnv1a(JSON.stringify(diagnosticPayload)),
  };
  if (!isSerializablePlanValue(diagnostics)) {
    throw new Error('Canonical Golden connection diagnostics must be strictly serializable.');
  }
  plan.canonicalNativeV1Connections = clonePlanData(diagnostics);
  return deepFreezePlan(clonePlanData(diagnostics));
}

export default rebuildCanonicalNativeV1GoldenConnectionsV2;
