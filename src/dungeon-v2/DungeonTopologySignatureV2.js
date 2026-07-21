import { hashSeed } from '../reaverbots/SeededRandom.js';

const SIDES = Object.freeze({
  west: Object.freeze({ x: -1, z: 0 }),
  east: Object.freeze({ x: 1, z: 0 }),
  north: Object.freeze({ x: 0, z: -1 }),
  south: Object.freeze({ x: 0, z: 1 }),
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rounded(value) {
  return Number(finite(value).toFixed(4));
}

function transformXZ(x, z, variant) {
  const reflectedX = variant >= 4 ? -x : x;
  const rotation = variant % 4;
  if (rotation === 1) return { x: -z, z: reflectedX };
  if (rotation === 2) return { x: -reflectedX, z: -z };
  if (rotation === 3) return { x: z, z: -reflectedX };
  return { x: reflectedX, z };
}

function normalizePoint(point, frame, variant) {
  const localX = (finite(point?.x) - frame.centerX) / frame.width;
  const localZ = (finite(point?.z) - frame.centerZ) / frame.depth;
  const transformed = transformXZ(localX, localZ, variant);
  return [
    rounded(transformed.x),
    rounded((finite(point?.y) - frame.minY) / frame.height),
    rounded(transformed.z),
  ];
}

function normalizeBounds(bounds, frame, variant) {
  if (!bounds?.min || !bounds?.max) return null;
  const corners = [
    { x: bounds.min.x, z: bounds.min.z },
    { x: bounds.min.x, z: bounds.max.z },
    { x: bounds.max.x, z: bounds.min.z },
    { x: bounds.max.x, z: bounds.max.z },
  ].map((point) => transformXZ(
    (finite(point.x) - frame.centerX) / frame.width,
    (finite(point.z) - frame.centerZ) / frame.depth,
    variant,
  ));
  return [
    rounded(Math.min(...corners.map(({ x }) => x))),
    rounded((finite(bounds.min.y) - frame.minY) / frame.height),
    rounded(Math.min(...corners.map(({ z }) => z))),
    rounded(Math.max(...corners.map(({ x }) => x))),
    rounded((finite(bounds.max.y) - frame.minY) / frame.height),
    rounded(Math.max(...corners.map(({ z }) => z))),
  ];
}

function normalizeDimensions(dimensions, frame, side) {
  const wallOnX = side === 'west' || side === 'east';
  const vertical = side === 'floor' || side === 'ceiling' || side === 'interior-floor';
  if (vertical) {
    return [
      rounded(finite(dimensions?.width) / frame.width),
      rounded(finite(dimensions?.height) / frame.height),
      rounded(finite(dimensions?.depth) / frame.depth),
    ];
  }
  return [
    rounded(finite(dimensions?.width) / (wallOnX ? frame.depth : frame.width)),
    rounded(finite(dimensions?.height) / frame.height),
    rounded(finite(dimensions?.depth) / (wallOnX ? frame.width : frame.depth)),
  ];
}

function normalizedPath(points, frame, variant) {
  if (!Array.isArray(points) || points.length < 2) return [];
  return points.map((point) => normalizePoint(point, frame, variant));
}

function surfaceForm(surface) {
  if (surface.ramp || surface.shape === 'ramp-tile') return 'ramp';
  return surface.geometry?.type
    ?? surface.form
    ?? surface.shape
    ?? (surface.collision === 'dynamic' ? 'dynamic-floor' : 'floor');
}

function surfacePath(surface) {
  return surface.geometry?.path
    ?? surface.ramp?.path
    ?? surface.path
    ?? surface.traversalRoute?.path
    ?? [];
}

function physicalPortalForm(portal) {
  const mode = portal.traversal?.mode ?? portal.approachType ?? 'walk';
  if (mode === 'stairs' || mode === 'walkable-stairs') return 'stairs';
  if (mode === 'ladder') return 'ladder';
  if (mode === 'lift') return 'lift';
  if (mode === 'intentional-drop') return 'intentional-drop';
  if (mode === 'bottom-walk') return 'bottom-walk';
  if (mode === 'moving-platform' || mode === 'gear-platform') return mode;
  if (mode === 'catwalk') return 'catwalk';
  return 'walk';
}

function transformSide(side, variant) {
  if (side === 'floor' || side === 'ceiling' || side === 'interior-floor') return side;
  const normal = SIDES[side];
  if (!normal) return 'unknown';
  const transformed = transformXZ(normal.x, normal.z, variant);
  if (Math.abs(transformed.x) > Math.abs(transformed.z)) return transformed.x < 0 ? 'west' : 'east';
  return transformed.z < 0 ? 'north' : 'south';
}

function frameForRegion(region) {
  const bounds = region?.bounds;
  if (!bounds?.min || !bounds?.max) {
    throw new TypeError(`Region ${region?.id ?? '<missing>'} requires bounds for a derived topology signature.`);
  }
  const width = finite(bounds.max.x) - finite(bounds.min.x);
  const height = finite(bounds.max.y) - finite(bounds.min.y);
  const depth = finite(bounds.max.z) - finite(bounds.min.z);
  if (!(width > 0 && height > 0 && depth > 0)) {
    throw new TypeError(`Region ${region.id} has invalid topology-signature bounds.`);
  }
  return {
    centerX: (finite(bounds.min.x) + finite(bounds.max.x)) * 0.5,
    centerZ: (finite(bounds.min.z) + finite(bounds.max.z)) * 0.5,
    minY: finite(bounds.min.y),
    width,
    height,
    depth,
  };
}

function stableSort(values) {
  return values.map((value) => JSON.stringify(value)).sort().map((value) => JSON.parse(value));
}

function stateShape(state, frame, variant) {
  return {
    stable: state.stable !== false,
    collision: state.collision !== false,
    position: state.position ? normalizePoint(state.position, frame, variant) : null,
    elevation: Number.isFinite(state.elevation)
      ? rounded((state.elevation - frame.minY) / frame.height)
      : null,
  };
}

function environmentShapes(plan, regionId, frame, variant) {
  const shapes = [];
  for (const environment of plan.environmentStates ?? []) {
    const basins = (environment.basins ?? [])
      .filter((basin) => basin.regionId === regionId)
      .map((basin) => ({
        bounds: normalizeBounds(basin.bounds, frame, variant),
        capacity: rounded(basin.capacityUnits),
        levels: stableSort((environment.stableStates ?? []).map((state) => rounded(
          state.basinLevels?.[basin.id] ?? state.levels?.[basin.id] ?? 0,
        ))),
      }));
    const surfaces = (environment.surfaces ?? [])
      .filter((surface) => surface.regionId === regionId)
      .map((surface) => ({
        size: [
          rounded(finite(surface.size?.x) / frame.width),
          rounded(finite(surface.size?.z) / frame.depth),
        ].sort((a, b) => a - b),
        offset: normalizePoint({
          x: frame.centerX + finite(surface.offset?.x),
          y: frame.minY,
          z: frame.centerZ + finite(surface.offset?.z),
        }, frame, variant),
      }));
    if (basins.length || surfaces.length) {
      shapes.push({
        type: environment.type,
        basins: stableSort(basins),
        surfaces: stableSort(surfaces),
        stableStateCount: (environment.stableStates ?? environment.phases ?? []).length,
      });
    }
  }
  return stableSort(shapes);
}

function isPortalOrInteractionSurface(surface) {
  const id = String(surface.id ?? '');
  const purpose = String(surface.purpose ?? '');
  return Boolean(
    surface.portalId
    || surface.connectorId
    || surface.cellId?.startsWith?.('cell.connector.')
    || /(?:^|\.)landing-[^.]+/.test(id)
    || /(?:^|\.)approach-[^.]+/.test(id)
    || /^surface\.connector\./.test(id)
    || /(?:supported landing for portal|physical internal approach|enclosed .* route for portal)/i.test(purpose)
    || /(?:static side-console control pad|interaction control pad)/i.test(purpose)
  );
}

function topologyEvidence(plan, region, variant, { chamberBodyOnly = false } = {}) {
  const frame = frameForRegion(region);
  const ownedCells = (plan.spatialCells ?? [])
    .filter((cell) => (
      cell.regionId === region.id
      && cell.connector !== true
      && !cell.id?.startsWith?.('cell.connector.')
    ));
  const ownedCellIds = new Set(ownedCells.map(({ id }) => id));
  const cells = ownedCells
    .map((cell) => ({
      bounds: normalizeBounds(cell.bounds, frame, variant),
      playable: cell.playable !== false,
      compound: Boolean(cell.compoundSubRegion || cell.compoundSpaceId || cell.compoundId),
    }));
  const regionSurfaces = (plan.walkableSurfaces ?? [])
    .filter((surface) => (
      surface.regionId === region.id
      && (!surface.cellId || ownedCellIds.has(surface.cellId))
      && !surface.cellId?.startsWith?.('cell.connector.')
      && (!chamberBodyOnly || !isPortalOrInteractionSurface(surface))
    ));
  const surfaceShapeById = new Map(regionSurfaces.map((surface) => [surface.id, {
      bounds: normalizeBounds(surface.bounds, frame, variant),
      form: surfaceForm(surface),
      path: normalizedPath(surfacePath(surface), frame, variant),
      dynamic: surface.collision === 'dynamic',
      hazard: Boolean(surface.hazardTag),
      mechanism: Boolean(surface.mechanismId ?? surface.controllerId),
    }]));
  const surfaces = [...surfaceShapeById.values()];
  const boundaries = (plan.structuralBoundaries ?? [])
    .filter((boundary) => (
      boundary.regionId === region.id
      && (!boundary.cellId || ownedCellIds.has(boundary.cellId))
      && !boundary.cellId?.startsWith?.('cell.connector.')
    ))
    .map((boundary) => ({
      side: transformSide(boundary.side, variant),
      bounds: normalizeBounds(boundary.bounds, frame, variant),
      barrier: Boolean(boundary.barrierId || boundary.gateId || boundary.id?.startsWith?.('Door_') || boundary.id?.startsWith?.('Gate_')),
      openings: stableSort((boundary.openings ?? [])
        .filter((opening) => !chamberBodyOnly
          || opening.pairedWithinCompound === true
          || Boolean(opening.internalPortalId))
        .map((opening) => ({
        center: normalizePoint(opening.center, frame, variant),
        dimensions: normalizeDimensions(opening.dimensions, frame, boundary.side),
        internal: opening.pairedWithinCompound === true || Boolean(opening.internalPortalId),
        }))),
    }));
  const portals = chamberBodyOnly ? [] : (plan.portals ?? []).flatMap((portal) => {
    const role = portal.from?.regionId === region.id ? 'from'
      : portal.to?.regionId === region.id ? 'to' : null;
    if (!role) return [];
    const endpoint = portal[role];
    const opposite = portal[role === 'from' ? 'to' : 'from'];
    const oneWay = portal.direction === 'forward' || portal.direction === 'forward-only';
    return [{
      role: oneWay ? role : 'bidirectional-endpoint',
      side: transformSide(endpoint.side, variant),
      center: normalizePoint(endpoint.center, frame, variant),
      dimensions: normalizeDimensions(endpoint.dimensions, frame, endpoint.side),
      form: physicalPortalForm(portal),
      oneWay,
      gated: Boolean(portal.barrierId ?? portal.barrierBoundaryId),
      elevationDelta: rounded((finite(opposite?.center?.y) - finite(endpoint.center?.y)) / frame.height),
    }];
  });
  const mechanisms = (plan.mechanisms ?? [])
    .filter((mechanism) => mechanism.regionId === region.id)
    .map((mechanism) => ({
      type: mechanism.type,
      recallable: mechanism.recallable === true,
      automatic: mechanism.automaticTravel === true,
      states: stableSort((mechanism.states ?? []).map((state) => stateShape(state, frame, variant))),
      transitions: stableSort((mechanism.transitions ?? []).map((transition) => ({
        automatic: transition.automatic === true,
        timed: Number.isFinite(transition.afterSeconds),
        wildcard: transition.fromStateId === '*',
      }))),
    }));
  const falls = (plan.falls ?? []).flatMap((fall) => {
    const portal = (plan.portals ?? []).find((candidate) => candidate.id === fall.sourcePortalId);
    const source = portal?.from?.regionId === region.id;
    const catchment = fall.targetCatchmentRegionId === region.id;
    if (!source && !catchment) return [];
    return [{
      source,
      catchment,
      trajectory: normalizeBounds(fall.trajectoryBounds, frame, variant),
      returnRequired: fall.damageFreeReturn !== false,
    }];
  });
  const internalLinks = (plan.traversalLinks ?? [])
    .filter((link) => (
      link.regionId === region.id
      && !link.portalId
      && surfaceShapeById.has(link.fromSurfaceId)
      && surfaceShapeById.has(link.toSurfaceId)
    ))
    .map((link) => ({
      mode: link.mode,
      bidirectional: link.bidirectional !== false,
      mechanism: Boolean(link.mechanismId),
      from: surfaceShapeById.get(link.fromSurfaceId) ?? null,
      to: surfaceShapeById.get(link.toSurfaceId) ?? null,
      via: surfaceShapeById.get(link.viaSurfaceId) ?? null,
      path: normalizedPath(link.waypoints ?? link.routePoints, frame, variant),
    }));

  return {
    cells: stableSort(cells),
    surfaces: stableSort(surfaces),
    boundaries: stableSort(boundaries),
    portals: stableSort(portals),
    mechanisms: stableSort(mechanisms),
    environments: environmentShapes(plan, region.id, frame, variant),
    falls: stableSort(falls),
    internalLinks: stableSort(internalLinks),
  };
}

export function deriveRegionTopologyEvidenceV2(plan, regionId) {
  const region = (plan.regions ?? []).find((entry) => entry.id === regionId);
  if (!region) throw new TypeError(`Unknown Dungeon V2 region ${regionId}.`);
  const variants = Array.from({ length: 8 }, (_, variant) => JSON.stringify(
    topologyEvidence(plan, region, variant),
  ));
  return variants.sort()[0];
}

export function deriveRegionChamberBodyEvidenceV2(plan, regionId) {
  const region = (plan.regions ?? []).find((entry) => entry.id === regionId);
  if (!region) throw new TypeError(`Unknown Dungeon V2 region ${regionId}.`);
  const variants = Array.from({ length: 8 }, (_, variant) => JSON.stringify(
    topologyEvidence(plan, region, variant, { chamberBodyOnly: true }),
  ));
  return variants.sort()[0];
}

export function deriveRegionChamberBodySignatureV2(plan, regionId) {
  const evidence = deriveRegionChamberBodyEvidenceV2(plan, regionId);
  return `body-d4:${hashSeed(evidence).toString(16).padStart(8, '0')}`;
}

function ordinalElevation(value, orderedElevations) {
  const index = orderedElevations.indexOf(value);
  return index >= 0 ? index : null;
}

export function deriveRegionChamberFamilyEvidenceV2(plan, regionId) {
  const body = JSON.parse(deriveRegionChamberBodyEvidenceV2(plan, regionId));
  const elevations = [...new Set(body.surfaces
    .map(({ bounds }) => bounds?.[1])
    .filter(Number.isFinite))]
    .sort((left, right) => left - right);
  const surfaceRoles = stableSort(body.surfaces.map((surface) => ({
    form: surface.form,
    elevationBand: ordinalElevation(surface.bounds?.[1], elevations),
    dynamic: surface.dynamic,
    hazard: surface.hazard,
    mechanism: surface.mechanism,
  })));
  const linkRoles = stableSort(body.internalLinks.map((link) => ({
    mode: link.mode,
    bidirectional: link.bidirectional,
    mechanism: link.mechanism,
    via: Boolean(link.via),
  })));
  return JSON.stringify({
    cells: stableSort(body.cells.map((cell) => ({
      playable: cell.playable,
      compound: cell.compound,
    }))),
    surfaceRoles,
    internalOpeningCount: body.boundaries.reduce((total, boundary) => (
      total + boundary.openings.filter(({ internal }) => internal).length
    ), 0),
    linkRoles,
    mechanisms: stableSort(body.mechanisms.map(({ type, recallable, automatic, states }) => ({
      type,
      recallable,
      automatic,
      stableStateCount: states.length,
    }))),
    environments: stableSort(body.environments.map(({ type, stableStateCount }) => ({
      type,
      stableStateCount,
    }))),
    falls: stableSort(body.falls.map(({ source, catchment, returnRequired }) => ({
      source,
      catchment,
      returnRequired,
    }))),
  });
}

export function deriveRegionChamberFamilySignatureV2(plan, regionId) {
  const evidence = deriveRegionChamberFamilyEvidenceV2(plan, regionId);
  return `family-d4:${hashSeed(evidence).toString(16).padStart(8, '0')}`;
}

function duplicateGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const group = groups.get(entry.signature) ?? [];
    group.push(entry.regionId);
    groups.set(entry.signature, group);
  }
  return [...groups]
    .filter(([, regionIds]) => regionIds.length > 1)
    .map(([signature, regionIds]) => ({ signature, regionIds: regionIds.sort() }))
    .sort((left, right) => left.signature.localeCompare(right.signature));
}

export function auditDungeonPlayableGeometryUniquenessV2(plan) {
  const placementById = new Map((plan.modulePlacements ?? []).map((placement) => [placement.id, placement]));
  const regions = plan.regions ?? [];
  const full = regions.map(({ id: regionId }) => ({
    regionId,
    signature: deriveRegionTopologySignatureV2(plan, regionId),
  }));
  const bodies = regions.map(({ id: regionId }) => ({
    regionId,
    signature: deriveRegionChamberBodySignatureV2(plan, regionId),
  }));
  const families = regions.map(({ id: regionId }) => ({
    regionId,
    signature: deriveRegionChamberFamilySignatureV2(plan, regionId),
  }));
  const nativePlacements = [...new Map(regions
    .map((region) => placementById.get(region.modulePlacementId))
    .filter((placement) => placement?.nativeIntegrationStatus === 'playable-plan-owned')
    .map((placement) => [placement.id, placement])).values()];
  const genericRegionIds = regions
    .filter((region) => placementById.get(region.modulePlacementId)?.nativeIntegrationStatus !== 'playable-plan-owned')
    .map(({ id }) => id)
    .sort();
  return Object.freeze({
    regionCount: regions.length,
    uniqueFullGeometryCount: new Set(full.map(({ signature }) => signature)).size,
    uniqueChamberBodyCount: new Set(bodies.map(({ signature }) => signature)).size,
    uniqueChamberFamilyCount: new Set(families.map(({ signature }) => signature)).size,
    fullDuplicateGroups: Object.freeze(duplicateGroups(full)),
    chamberBodyDuplicateGroups: Object.freeze(duplicateGroups(bodies)),
    chamberFamilyDuplicateGroups: Object.freeze(duplicateGroups(families)),
    nativePlacementCount: nativePlacements.length,
    nativeDescriptorCount: new Set(nativePlacements.map(({ descriptorId }) => descriptorId)).size,
    nativeDescriptorIds: Object.freeze(nativePlacements.map(({ descriptorId }) => descriptorId).sort()),
    genericRegionIds: Object.freeze(genericRegionIds),
  });
}

export function validatePhysicalPlayableGeometryUniquenessV2(plan, {
  requireDistinctChamberFamilies = true,
} = {}) {
  const audit = auditDungeonPlayableGeometryUniquenessV2(plan);
  const errors = audit.fullDuplicateGroups.map((group) => ({
    code: 'physical-playable-geometry-reused',
    message: `${group.regionIds.join(', ')} repeat D4-normalized playable geometry ${group.signature}.`,
    ...group,
  }));
  if (requireDistinctChamberFamilies) {
    errors.push(...audit.chamberFamilyDuplicateGroups.map((group) => ({
      code: 'physical-chamber-family-reused',
      message: `${group.regionIds.join(', ')} reuse chamber body family ${group.signature}; exits, labels, materials, or small props do not make a new room.`,
      ...group,
    })));
  }
  return Object.freeze({
    accepted: errors.length === 0,
    errors: Object.freeze(errors),
    audit,
  });
}

export function deriveRegionTopologySignatureV2(plan, regionId) {
  const evidence = deriveRegionTopologyEvidenceV2(plan, regionId);
  return `d4:${hashSeed(evidence).toString(16).padStart(8, '0')}`;
}

export function deriveDungeonTopologySignaturesV2(plan) {
  return Object.freeze(Object.fromEntries((plan.regions ?? []).map((region) => [
    region.id,
    deriveRegionTopologySignatureV2(plan, region.id),
  ])));
}

export default deriveDungeonTopologySignaturesV2;
