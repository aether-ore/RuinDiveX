/**
 * Renderer-free runtime contracts for the Industrial V4 supplement.
 *
 * This module deliberately has no Three.js or DungeonGenerator dependency. It
 * turns materialized records into immutable-ish data contracts that can be
 * checked before any scene object is created. Every public entry point is a
 * no-op unless the caller opts into the exact V4 mode constant, preserving the
 * immutable V1-V3 paths.
 */

export const INDUSTRIAL_SUPPLEMENT_V4_RUNTIME_CONTRACT_MODE =
  'industrial-supplement-v4';

export const INDUSTRIAL_SUPPLEMENT_ANCHOR_PLACEMENT_REQUEST_SCHEMA =
  'ruindivex-industrial-supplement-anchor-placement-request/v1';

export const INDUSTRIAL_SUPPLEMENT_ANCHOR_PLACEMENT_SCHEMA =
  'ruindivex-industrial-supplement-anchor-placement/v1';

export const INDUSTRIAL_SUPPLEMENT_STATE_BINDING_SCHEMA =
  'ruindivex-industrial-supplement-state-binding/v1';

export const INDUSTRIAL_SUPPLEMENT_LIVE_STATE_PARTICIPANT_SCHEMA =
  'ruindivex-industrial-supplement-live-state-participant/v1';

export const INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES = Object.freeze({
  REQUEST_MALFORMED: 'v4-anchor-placement-request-malformed',
  REQUEST_ID_DUPLICATE: 'v4-anchor-placement-request-id-duplicate',
  SUPPORT_CELLS_MISSING: 'v4-anchor-placement-support-cells-missing',
  SUPPORT_ID_AMBIGUOUS: 'v4-anchor-placement-support-id-ambiguous',
  NO_LEGAL_SUPPORT: 'v4-anchor-placement-no-legal-support',
  UNWALKABLE_SUPPORT: 'v4-anchor-placement-unwalkable-support',
  TIER_MISMATCH: 'v4-anchor-placement-tier-mismatch',
  ELEVATION_MISMATCH: 'v4-anchor-placement-elevation-mismatch',
  FORBIDDEN_FOOTPRINT: 'v4-anchor-placement-forbidden-footprint',
  RESERVATION_CONFLICT: 'v4-anchor-placement-reservation-conflict',
  FAR_SIDE_REQUIRED: 'v4-anchor-placement-far-side-required',
  STATE_BINDING_MALFORMED: 'v4-state-binding-malformed',
  STATE_KIND_INVALID: 'v4-state-binding-kind-invalid',
  STATE_RUNTIME_ID_DUPLICATE: 'v4-state-runtime-id-duplicate',
  STATE_ID_UNBOUND: 'v4-state-runtime-id-unbound',
  STATE_ID_UNADVERTISED: 'v4-state-runtime-id-unadvertised',
  STATE_OWNER_AMBIGUOUS: 'v4-state-owner-ambiguous',
  STATE_CONSUMER_AMBIGUOUS: 'v4-state-consumer-ambiguous',
  STATE_OWNER_IDENTITY_MISMATCH: 'v4-state-owner-identity-mismatch',
  STATE_CONSUMER_IDENTITY_MISMATCH: 'v4-state-consumer-identity-mismatch',
  STATE_LIVE_COMPONENT_MALFORMED: 'v4-state-live-component-malformed',
  STATE_LIVE_COMPONENT_DUPLICATE: 'v4-state-live-component-duplicate',
  STATE_REQUIRED_KIND_MISSING: 'v4-state-required-kind-missing',
});

export const INDUSTRIAL_SUPPLEMENT_RUNTIME_STATE_KINDS = Object.freeze([
  'encounter-cleared',
  'mechanism-activated',
  'reward-claimed',
  'lift-enabled',
  'lift-position',
  'ladder-deployed',
]);

const RUNTIME_STATE_KIND_SET = new Set(INDUSTRIAL_SUPPLEMENT_RUNTIME_STATE_KINDS);
const EPSILON = 1e-6;
const DEFAULT_ELEVATION_TOLERANCE_METERS = 0.08;
const DEFAULT_RESERVATION_RADIUS_METERS = Object.freeze({
  'encounter-role': 1.4,
  reward: 0.8,
  hazard: 0.8,
  mechanism: 0.8,
  'shortcut-control': 1.4,
});

function clonePlainValue(value) {
  if (Array.isArray(value)) return value.map(clonePlainValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => (
    [key, clonePlainValue(entry)]
  )));
}

function asArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return [value];
}

function finiteNumber(value, fallback = null) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function stringOrNull(value) {
  if (value == null || String(value).length === 0) return null;
  return String(value);
}

function stableIdPart(value) {
  return String(value ?? 'unnamed')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unnamed';
}

function sortedUniqueStrings(values) {
  return [...new Set(asArray(values).filter((value) => value != null).map(String))]
    .sort((left, right) => left.localeCompare(right));
}

function stableRecords(records, idOf = (record) => record?.id) {
  return [...asArray(records)].sort((left, right) => (
    String(idOf(left) ?? '').localeCompare(String(idOf(right) ?? ''))
  ));
}

function pointOf(record) {
  const point = record?.position ?? record?.worldPosition ?? record?.center ?? null;
  if (!point) return null;
  const x = finiteNumber(point.x);
  const y = finiteNumber(point.y ?? record?.elevation ?? record?.worldElevation);
  const z = finiteNumber(point.z);
  if (x == null || z == null) return null;
  return { x, y: y ?? 0, z };
}

function makeError(code, {
  recordId = null,
  ownerId = null,
  runtimeStateId = null,
  message = null,
  details = null,
} = {}) {
  return {
    code,
    recordId: stringOrNull(recordId),
    ownerId: stringOrNull(ownerId),
    runtimeStateId: stringOrNull(runtimeStateId),
    ...(message ? { message: String(message) } : {}),
    ...(details ? { details: clonePlainValue(details) } : {}),
  };
}

function stableErrors(errors) {
  return [...errors].sort((left, right) => (
    String(left.code).localeCompare(String(right.code))
      || String(left.recordId ?? '').localeCompare(String(right.recordId ?? ''))
      || String(left.runtimeStateId ?? '').localeCompare(String(right.runtimeStateId ?? ''))
      || String(left.ownerId ?? '').localeCompare(String(right.ownerId ?? ''))
  ));
}

function inactiveResult(extra = {}) {
  return {
    active: false,
    accepted: true,
    errors: [],
    ...extra,
  };
}

export function isIndustrialSupplementV4RuntimeContractMode(mode) {
  return mode === INDUSTRIAL_SUPPLEMENT_V4_RUNTIME_CONTRACT_MODE;
}

function supportCellId(record) {
  return stringOrNull(
    record?.supportFloorCellId
      ?? record?.supportCellId
      ?? record?.augmentationFloorCellId
      ?? record?.floorCellId
      ?? record?.transferCellId
      ?? record?.authoritativeFloorCellId
      ?? record?.id,
  );
}

function roomFloorCells(room) {
  const floorCells = asArray(room?.augmentationFloorTiers)
    .flatMap((tier) => asArray(tier?.worldCells).map((cell) => ({
      ...cell,
      roomId: cell.roomId ?? room.id,
      floorTierId: cell.floorTierId ?? tier.id ?? tier.localTierId ?? null,
      floorTierRuntimeId: cell.floorTierRuntimeId ?? tier.runtimeId ?? null,
      supportKind: cell.supportKind ?? 'floor-cell',
    })));
  const transferCells = asArray(room?.augmentationTransfers)
    .flatMap((transfer) => asArray(transfer?.worldCells).map((cell) => ({
      ...cell,
      roomId: cell.roomId ?? room.id,
      transferId: cell.transferId ?? transfer.id,
      supportKind: cell.supportKind ?? 'transfer-cell',
    })));
  return [...floorCells, ...transferCells];
}

function boundedBlueprintAnchorFallbackSupportCellIds(room, anchor, declaredZoneIds = []) {
  if (
    anchor?.authoritativeBlueprintPlacement !== true
    || declaredZoneIds.length > 0
    || anchor?.reselectWithinDeclaredZoneAndTier === false
  ) {
    return [];
  }
  const exactId = supportCellId(anchor);
  if (!exactId) return [];
  const cells = roomFloorCells(room);
  const exact = cells.find((cell) => supportCellId(cell) === exactId);
  if (!exact?.localTile) return [];
  const exactElevation = finiteNumber(
    exact.localTile.elevation ?? exact.localElevation ?? exact.elevation ?? exact.position?.y,
  );
  const exactX = finiteNumber(exact.localTile.x);
  const exactZ = finiteNumber(exact.localTile.z);
  if (exactElevation == null || exactX == null || exactZ == null) return [];
  const floorTierRuntimeId = stringOrNull(
    anchor.floorTierRuntimeId ?? exact.floorTierRuntimeId,
  );
  const transferRuntimeId = stringOrNull(
    anchor.blueprintTransferRuntimeId ?? anchor.sourceTransferRuntimeId ?? exact.transferId,
  );
  if (!floorTierRuntimeId && !transferRuntimeId) return [];
  return cells
    .filter((candidate) => {
      const candidateId = supportCellId(candidate);
      const candidateX = finiteNumber(candidate.localTile?.x);
      const candidateZ = finiteNumber(candidate.localTile?.z);
      const candidateElevation = finiteNumber(
        candidate.localTile?.elevation
          ?? candidate.localElevation
          ?? candidate.elevation
          ?? candidate.position?.y,
      );
      if (
        !candidateId
        || candidateX == null
        || candidateZ == null
        || candidateElevation == null
        || String(candidate.roomId ?? room.id) !== String(room.id)
        || candidate.authoritative === false
        || Math.abs(candidateElevation - exactElevation) > EPSILON
        || Math.abs(candidateX - exactX) + Math.abs(candidateZ - exactZ) > 1 + EPSILON
      ) {
        return false;
      }
      if (floorTierRuntimeId) {
        return String(candidate.floorTierRuntimeId ?? '') === floorTierRuntimeId;
      }
      return String(candidate.transferId ?? '') === transferRuntimeId;
    })
    .sort((left, right) => {
      const leftDistance = Math.abs(finiteNumber(left.localTile?.x, 0) - exactX)
        + Math.abs(finiteNumber(left.localTile?.z, 0) - exactZ);
      const rightDistance = Math.abs(finiteNumber(right.localTile?.x, 0) - exactX)
        + Math.abs(finiteNumber(right.localTile?.z, 0) - exactZ);
      return Number(supportCellId(right) === exactId) - Number(supportCellId(left) === exactId)
        || leftDistance - rightDistance
        || String(supportCellId(left)).localeCompare(String(supportCellId(right)));
    })
    .map(supportCellId);
}

function zoneSupportCellIds(zone) {
  return sortedUniqueStrings(asArray(zone?.worldCells).map(supportCellId).filter(Boolean));
}

function roomZoneIndex(room) {
  const zones = stableRecords(room?.augmentationZones, (zone) => zone?.runtimeId ?? zone?.id);
  const byId = new Map();
  for (const zone of zones) {
    const ids = sortedUniqueStrings([
      zone.runtimeId,
      zone.id,
      zone.localZoneId,
      zone.zoneId,
    ]);
    for (const id of ids) byId.set(id, zone);
  }
  return { zones, byId };
}

function anchorPlacementKind(anchor) {
  const kind = String(anchor?.kind ?? anchor?.type ?? '');
  if (kind === 'spatial-role') return 'encounter-role';
  if (['reward', 'discovery'].includes(kind)) return 'reward';
  if (['trap', 'hazard', 'environmentalHazard'].includes(kind)) return 'hazard';
  if (['progression', 'mechanism', 'control'].includes(kind)) return 'mechanism';
  if (['encounter', 'enemyEncounter'].includes(kind)) return 'encounter-role';
  return null;
}

function anchorHasRuntimeRecipe(anchor) {
  return Boolean(
    anchor?.encounterRecipe
      || anchor?.rewardRecipe
      || anchor?.mechanismRecipe
      || anchor?.hazardRecipe
      || anchor?.discoveryRecipe
      || anchor?.runtimeStateId,
  );
}

function referencedSpatialAnchorIds(room) {
  return new Set(asArray(room?.augmentationAnchors).flatMap((anchor) => (
    asArray(anchor?.encounterRecipe?.spatialRoles)
      .flatMap((role) => asArray(role?.anchorIds).map(String))
  )));
}

function matchingEncounterSpatialRole(room, anchor) {
  const anchorId = String(anchor?.localAnchorId ?? anchor?.id ?? '');
  return asArray(room?.augmentationAnchors).flatMap((candidate) => (
    asArray(candidate?.encounterRecipe?.spatialRoles)
  )).find((role) => asArray(role?.anchorIds).map(String).includes(anchorId)) ?? null;
}

function declaredAnchorZoneIds(room, anchor) {
  const role = matchingEncounterSpatialRole(room, anchor);
  return sortedUniqueStrings([
    anchor?.blueprintZoneId,
    anchor?.floorZoneId,
    ...asArray(anchor?.allowedZoneIds),
    ...asArray(anchor?.validFloorZoneIds),
    ...asArray(role?.validFloorZoneIds),
    ...asArray(anchor?.encounterRecipe?.validFloorZoneIds),
    ...asArray(anchor?.hazardRecipe?.validFloorZoneIds),
    ...asArray(anchor?.mechanismRecipe?.validFloorZoneIds),
    ...asArray(anchor?.rewardRecipe?.validFloorZoneIds),
  ]);
}

function normalizeForbiddenFootprint(record, fallbackKind = 'forbidden-footprint') {
  if (!record) return null;
  const supportCellIds = sortedUniqueStrings([
    ...asArray(record.supportCellIds),
    ...asArray(record.worldCellIds),
    ...asArray(record.apertureFloorCellIds),
  ]);
  const hasAuthoritativeOccupiedSupportCellIds = Array.isArray(
    record.occupiedSupportCellIds,
  );
  const occupiedSupportCellIds = hasAuthoritativeOccupiedSupportCellIds
    ? sortedUniqueStrings(record.occupiedSupportCellIds)
    : null;
  return {
    id: String(record.id ?? record.runtimeId ?? `${fallbackKind}:anonymous`),
    kind: String(record.kind ?? record.collisionKind ?? fallbackKind),
    ownerId: stringOrNull(record.ownerId ?? record.roomId ?? record.nodeId),
    center: clonePlainValue(record.center ?? record.position ?? record.worldPosition ?? null),
    size: clonePlainValue(record.size ?? record.collisionFootprint ?? null),
    bounds: clonePlainValue(record.bounds ?? null),
    grid: clonePlainValue(record.grid ?? null),
    supportCellIds,
    ...(hasAuthoritativeOccupiedSupportCellIds ? { occupiedSupportCellIds } : {}),
    allowOwningAnchor: record.allowOwningAnchor === true,
    allowedPlacementKinds: sortedUniqueStrings(record.allowedPlacementKinds),
  };
}

function forbiddenFootprintsForRoom(room, anchor = null) {
  const records = [
    ...asArray(anchor?.forbiddenFootprints),
    ...asArray(room?.augmentationCollisionRecords).filter((record) => (
      (
        record?.blocking === true
          || record?.excludesFloor === true
          || record?.mustRemainClear === true
      )
        && String(record?.sourceKind ?? '') !== 'clear-route'
        && String(record?.collisionKind ?? '') !== 'clear-route-reservation'
    )),
    ...asArray(room?.augmentationCover).filter((record) => record?.blocksMovement !== false),
    ...asArray(room?.augmentationBlueprintFeatures).filter((record) => (
      ['cover', 'machine'].includes(String(record?.blueprintFeatureType ?? record?.type ?? ''))
        && (
          record?.blocking === true
            || record?.solid === true
            || record?.blocksMovement === true
        )
    )),
    ...asArray(room?.augmentationVoids),
    // Authored room anchors may deliberately occupy a route endpoint (for
    // example a control console at the end of its access path or an encounter
    // role on a traversable perch). Clear routes constrain geometry and the
    // separately-built shortcut-control request below; they are not blanket
    // blockers for the room's own authored anchor requests.
  ];
  return stableRecords(records.map((record) => normalizeForbiddenFootprint(record)).filter(Boolean))
    .filter((record, index, all) => index === all.findIndex(({ id }) => id === record.id));
}

function requestForAnchor(room, anchor, options) {
  const placementKind = anchorPlacementKind(anchor);
  if (!placementKind) return null;
  const { byId } = roomZoneIndex(room);
  const declaredZoneIds = declaredAnchorZoneIds(room, anchor);
  const zones = declaredZoneIds.map((id) => byId.get(id)).filter(Boolean);
  const allowedZoneIds = sortedUniqueStrings(zones.map((zone) => zone.runtimeId ?? zone.id));
  const exactSupportCellId = stringOrNull(anchor.supportCellId);
  const localFallbackSupportCellIds = boundedBlueprintAnchorFallbackSupportCellIds(
    room,
    anchor,
    declaredZoneIds,
  );
  const allowedSupportCellIds = sortedUniqueStrings([
    exactSupportCellId,
    ...asArray(anchor.supportCellIds),
    ...zones.flatMap(zoneSupportCellIds),
    ...localFallbackSupportCellIds,
  ]);
  const id = `${anchor.id}:placement-request`;
  const requiredElevation = finiteNumber(
    anchor?.worldElevation ?? anchor?.position?.y ?? anchor?.worldPosition?.y,
  );
  return {
    schema: INDUSTRIAL_SUPPLEMENT_ANCHOR_PLACEMENT_REQUEST_SCHEMA,
    id,
    requestId: id,
    anchorId: String(anchor.id),
    localAnchorId: stringOrNull(anchor.localAnchorId),
    ownerKind: 'supplemental-anchor',
    ownerId: String(anchor.id),
    operationId: stringOrNull(anchor.operationId ?? room.augmentationOperationId),
    roomId: String(room.id),
    blueprintId: stringOrNull(room.augmentationBlueprintId),
    grammarId: stringOrNull(
      room.augmentationModuleTemplateId
        ?? room.augmentationPhysicalModuleKind
        ?? room.archetypeId,
    ),
    placementKind,
    requestedPosition: clonePlainValue(pointOf(anchor)),
    exactSupportCellId,
    allowedSupportCellIds,
    localFallbackSupportCellIds,
    declaredZoneIds,
    allowedZoneIds,
    requiredTierId: stringOrNull(anchor.floorTierId ?? anchor.requiredTierId),
    requiredTierRuntimeId: stringOrNull(
      anchor.floorTierRuntimeId ?? anchor.requiredTierRuntimeId,
    ),
    requiredElevation,
    elevationToleranceMeters: finiteNumber(
      anchor.elevationToleranceMeters,
      options.elevationToleranceMeters,
    ),
    forbiddenFootprints: forbiddenFootprintsForRoom(room, anchor),
    reservationRadiusMeters: Math.max(0, finiteNumber(
      anchor.reservationRadiusMeters,
      options.reservationRadiusMetersByKind?.[placementKind]
        ?? DEFAULT_RESERVATION_RADIUS_METERS[placementKind]
        ?? 0.8,
    )),
    requiresFarSide: false,
    farSideRoomId: null,
    reselectWithinDeclaredZoneAndTier: anchor.reselectWithinDeclaredZoneAndTier !== false,
    authoritative: true,
    rendererFree: true,
  };
}

function isShortcutPlan(plan) {
  return Boolean(
    ['shortcut-lift', 'drop-ladder'].includes(String(plan?.shortcutMode ?? ''))
      || plan?.oneSideActivatedShortcut === true
      || plan?.shortcutActivationSide != null,
  );
}

function seamSupportCellIds(plan) {
  return sortedUniqueStrings([
    ...asArray(plan?.endpointSeams).flatMap((seam) => (
      asArray(seam?.orderedCells).map(supportCellId)
    )),
    ...asArray(plan?.authoritativeSocketSeams).flatMap((seam) => (
      asArray(seam?.orderedCells ?? seam?.cells).map(supportCellId)
    )),
    ...asArray(plan?.authoritativeSocketSeamFloorCellIds),
  ]);
}

function requestForShortcut(plan, room, options) {
  const { zones } = roomZoneIndex(room);
  const safeZones = zones.filter((zone) => (
    !['hazard'].includes(String(zone?.zoneKind ?? ''))
      && (asArray(zone?.validFor).length === 0 || asArray(zone.validFor).includes('player'))
  ));
  const floorCells = roomFloorCells(room);
  const exactSupportCellId = stringOrNull(
    plan.shortcutControlSupportCellId
      ?? plan.shortcutMechanismPlacement?.supportFloorCellId
      ?? plan.authoritativeAnchorPlacement?.supportFloorCellId,
  );
  const allowedSupportCellIds = sortedUniqueStrings([
    exactSupportCellId,
    ...asArray(plan.shortcutControlAllowedSupportCellIds),
    ...safeZones.flatMap(zoneSupportCellIds),
    ...(safeZones.length === 0 ? floorCells.map(supportCellId) : []),
  ]);
  const requestedPosition = pointOf(
    plan.shortcutControlPosition
      ?? plan.shortcutMechanismPlacement
      ?? plan.toSocket
      ?? plan.destinationSocket,
  );
  const id = `${plan.id}:shortcut-control:placement-request`;
  const clearRouteCellIds = asArray(room?.augmentationClearRoutes)
    .flatMap((route) => asArray(route?.worldCellIds));
  const additionalForbidden = normalizeForbiddenFootprint({
    id: `${plan.id}:shortcut-control:forbidden-route-cells`,
    kind: 'shortcut-control-forbidden-route-cells',
    supportCellIds: [...clearRouteCellIds, ...seamSupportCellIds(plan)],
  });
  return {
    schema: INDUSTRIAL_SUPPLEMENT_ANCHOR_PLACEMENT_REQUEST_SCHEMA,
    id,
    requestId: id,
    anchorId: String(plan.shortcutMechanismId ?? `${plan.id}:shortcut-control`),
    localAnchorId: null,
    ownerKind: 'shortcut-control',
    ownerId: String(plan.shortcutMechanismId ?? `${plan.id}:shortcut-control`),
    operationId: stringOrNull(plan.operationId ?? plan.augmentationOperationId),
    connectionId: String(plan.id),
    roomId: String(room.id),
    placementKind: 'shortcut-control',
    requestedPosition: clonePlainValue(requestedPosition),
    exactSupportCellId,
    allowedSupportCellIds,
    declaredZoneIds: sortedUniqueStrings(safeZones.flatMap((zone) => [
      zone.localZoneId,
      zone.id,
    ])),
    allowedZoneIds: sortedUniqueStrings(safeZones.map((zone) => zone.runtimeId ?? zone.id)),
    requiredTierId: stringOrNull(plan.shortcutControlTierId),
    requiredTierRuntimeId: stringOrNull(plan.shortcutControlTierRuntimeId),
    requiredElevation: finiteNumber(
      plan.shortcutControlElevation ?? requestedPosition?.y,
    ),
    elevationToleranceMeters: finiteNumber(
      plan.shortcutControlElevationToleranceMeters,
      options.elevationToleranceMeters,
    ),
    forbiddenFootprints: stableRecords([
      ...forbiddenFootprintsForRoom(room),
      additionalForbidden,
    ].filter(Boolean)).filter((record, index, all) => (
      index === all.findIndex(({ id: candidateId }) => candidateId === record.id)
    )),
    reservationRadiusMeters: Math.max(0, finiteNumber(
      plan.shortcutControlReservationRadiusMeters,
      options.reservationRadiusMetersByKind?.['shortcut-control']
        ?? DEFAULT_RESERVATION_RADIUS_METERS['shortcut-control'],
    )),
    requiresFarSide: true,
    farSideRoomId: String(room.id),
    activationSide: stringOrNull(plan.shortcutActivationSide),
    reselectWithinDeclaredZoneAndTier: true,
    authoritative: true,
    rendererFree: true,
  };
}

/**
 * Builds deterministic renderer-free requests from already materialized rooms.
 * The result is atomic: `requests` is empty when any request is malformed;
 * `diagnosticRequests` retains the records for diagnostics.
 */
export function buildIndustrialSupplementAnchorPlacementRequests({
  mode,
  rooms = [],
  connectionPlans = [],
  elevationToleranceMeters = DEFAULT_ELEVATION_TOLERANCE_METERS,
  reservationRadiusMetersByKind = {},
} = {}) {
  if (!isIndustrialSupplementV4RuntimeContractMode(mode)) {
    return inactiveResult({ requests: [], diagnosticRequests: [] });
  }
  const options = {
    elevationToleranceMeters: Math.max(
      0,
      finiteNumber(elevationToleranceMeters, DEFAULT_ELEVATION_TOLERANCE_METERS),
    ),
    reservationRadiusMetersByKind,
  };
  const orderedRooms = stableRecords(rooms);
  const roomById = new Map(orderedRooms.map((room) => [String(room.id), room]));
  const requests = [];
  const errors = [];
  for (const room of orderedRooms) {
    if (!room?.id || room?.isDungeonSupplement !== true) continue;
    const referencedRoles = referencedSpatialAnchorIds(room);
    const anchors = stableRecords(room.augmentationAnchors);
    const hasLiveSpatialRoles = anchors.some((anchor) => (
      String(anchor?.kind ?? '') === 'spatial-role'
        && referencedRoles.has(String(anchor?.localAnchorId ?? anchor?.id ?? ''))
    ));
    for (const anchor of anchors) {
      const kind = String(anchor?.kind ?? '');
      if (anchor?.blueprintFeatureType && !anchorHasRuntimeRecipe(anchor)) continue;
      if (kind === 'spatial-role'
        && !referencedRoles.has(String(anchor?.localAnchorId ?? anchor?.id ?? ''))) continue;
      if (['encounter', 'enemyEncounter'].includes(kind) && hasLiveSpatialRoles) continue;
      if (!anchorHasRuntimeRecipe(anchor) && kind !== 'spatial-role') continue;
      const request = requestForAnchor(room, anchor, options);
      if (!request) continue;
      requests.push(request);
    }
  }
  for (const plan of stableRecords(connectionPlans)) {
    if (!plan?.id || !isShortcutPlan(plan)) continue;
    const farSideRoomId = stringOrNull(plan.farSideRoomId ?? plan.toRoomId);
    const farSideRoom = farSideRoomId ? roomById.get(farSideRoomId) : null;
    if (!farSideRoom || String(plan.shortcutActivationSide ?? '') !== 'far-side') {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.FAR_SIDE_REQUIRED,
        {
          recordId: plan.id,
          ownerId: plan.shortcutMechanismId,
          details: { farSideRoomId, activationSide: plan.shortcutActivationSide ?? null },
        },
      ));
      continue;
    }
    requests.push(requestForShortcut(plan, farSideRoom, options));
  }
  const requestIdCounts = new Map();
  for (const request of requests) {
    requestIdCounts.set(request.id, (requestIdCounts.get(request.id) ?? 0) + 1);
    if (!request.id || !request.ownerId || !request.roomId) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.REQUEST_MALFORMED,
        { recordId: request.id, ownerId: request.ownerId },
      ));
    }
    if (request.allowedSupportCellIds.length === 0) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.SUPPORT_CELLS_MISSING,
        { recordId: request.id, ownerId: request.ownerId },
      ));
    }
  }
  for (const [requestId, count] of requestIdCounts) {
    if (count <= 1) continue;
    errors.push(makeError(
      INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.REQUEST_ID_DUPLICATE,
      { recordId: requestId, details: { count } },
    ));
  }
  const diagnosticRequests = stableRecords(requests);
  const stable = stableErrors(errors);
  return {
    active: true,
    accepted: stable.length === 0,
    requests: stable.length === 0 ? clonePlainValue(diagnosticRequests) : [],
    diagnosticRequests: clonePlainValue(diagnosticRequests),
    errors: stable,
  };
}

function flattenSupportRecords(records, inherited = {}) {
  return asArray(records).flatMap((record) => {
    if (!record) return [];
    if (Array.isArray(record.worldCells)) {
      return record.worldCells.flatMap((cell) => flattenSupportRecords(cell, {
        roomId: record.roomId ?? inherited.roomId,
        floorTierId: record.floorTierId ?? record.id ?? inherited.floorTierId,
        floorTierRuntimeId: record.floorTierRuntimeId
          ?? record.runtimeId
          ?? inherited.floorTierRuntimeId,
        transferId: record.transferId ?? inherited.transferId,
      }));
    }
    const id = supportCellId(record);
    if (!id) return [];
    return [{
      ...record,
      supportCellId: id,
      roomId: stringOrNull(record.roomId ?? record.nodeId ?? inherited.roomId),
      floorTierId: stringOrNull(record.floorTierId ?? inherited.floorTierId),
      floorTierRuntimeId: stringOrNull(
        record.floorTierRuntimeId ?? inherited.floorTierRuntimeId,
      ),
      transferId: stringOrNull(record.transferId ?? inherited.transferId),
      position: pointOf(record),
      elevation: finiteNumber(
        record.elevation ?? record.worldElevation ?? record.position?.y ?? record.worldPosition?.y,
        0,
      ),
      floorKey: stringOrNull(record.floorKey),
      supportKind: String(record.supportKind ?? (
        record.transferCellId || record.transferId || inherited.transferId
          ? 'transfer-cell'
          : 'floor-cell'
      )),
    }];
  });
}

function normalizeWalkability(records, walkableFloorCellIds) {
  const byId = new Map();
  for (const record of asArray(records)) {
    const id = supportCellId(record) ?? stringOrNull(record?.supportCellId);
    if (!id) continue;
    const accepted = record.walkable !== false
      && record.blocked !== true
      && record.reachable !== false
      && record.returnable !== false
      && record.bidirectional !== false
      && record.accepted !== false;
    byId.set(id, accepted);
  }
  const allowedSet = walkableFloorCellIds == null
    ? null
    : new Set(asArray(walkableFloorCellIds).map(String));
  return { byId, allowedSet };
}

function normalizeZoneMembership(zones) {
  const idsBySupportId = new Map();
  for (const zone of asArray(zones)) {
    const zoneIds = sortedUniqueStrings([
      zone?.runtimeId,
      zone?.id,
      zone?.localZoneId,
      zone?.zoneId,
    ]);
    for (const id of zoneSupportCellIds(zone)) {
      const memberships = idsBySupportId.get(id) ?? new Set();
      for (const zoneId of zoneIds) memberships.add(zoneId);
      idsBySupportId.set(id, memberships);
    }
  }
  return idsBySupportId;
}

function pointInsideFootprint(candidate, footprint) {
  const point = candidate?.position;
  if (!point || !footprint) return false;
  if (asArray(footprint.supportCellIds).length > 0) return false;
  const grid = footprint.grid;
  if (grid && candidate.grid
    && finiteNumber(grid.x) != null && finiteNumber(grid.z) != null) {
    return Number(candidate.grid.x) === Number(grid.x)
      && Number(candidate.grid.z) === Number(grid.z);
  }
  const center = pointOf(footprint);
  const size = footprint.size ?? {};
  if (center && (finiteNumber(size.x ?? size.widthMeters) != null
    || finiteNumber(size.z ?? size.depthMeters) != null)) {
    const halfX = Math.max(0, finiteNumber(size.x ?? size.widthMeters, 0)) * 0.5;
    const halfZ = Math.max(0, finiteNumber(size.z ?? size.depthMeters, 0)) * 0.5;
    const halfY = finiteNumber(size.y ?? size.heightMeters);
    return Math.abs(point.x - center.x) <= halfX + EPSILON
      && Math.abs(point.z - center.z) <= halfZ + EPSILON
      && (halfY == null || Math.abs(point.y - center.y) <= halfY * 0.5 + EPSILON);
  }
  const bounds = footprint.bounds;
  if (bounds) {
    const usesGridBounds = candidate.grid
      && (finiteNumber(bounds.minGridX) != null || finiteNumber(bounds.maxGridX) != null
        || finiteNumber(bounds.minGridZ) != null || finiteNumber(bounds.maxGridZ) != null);
    const candidateX = usesGridBounds ? Number(candidate.grid.x) : point.x;
    const candidateZ = usesGridBounds ? Number(candidate.grid.z) : point.z;
    const minX = finiteNumber(usesGridBounds ? bounds.minGridX : bounds.minX, -Infinity);
    const maxX = finiteNumber(usesGridBounds ? bounds.maxGridX : bounds.maxX, Infinity);
    const minZ = finiteNumber(usesGridBounds ? bounds.minGridZ : bounds.minZ, -Infinity);
    const maxZ = finiteNumber(usesGridBounds ? bounds.maxGridZ : bounds.maxZ, Infinity);
    const minY = finiteNumber(bounds.minY ?? bounds.minimumY, -Infinity);
    const maxY = finiteNumber(bounds.maxY ?? bounds.maximumY, Infinity);
    return candidateX >= minX - EPSILON && candidateX <= maxX + EPSILON
      && candidateZ >= minZ - EPSILON && candidateZ <= maxZ + EPSILON
      && point.y >= minY - EPSILON && point.y <= maxY + EPSILON;
  }
  return false;
}

function candidateBlockedByFootprint(candidate, footprint, request) {
  if (!footprint) return false;
  if (footprint.ownerId && String(footprint.ownerId) === String(request.ownerId)
    && footprint.allowOwningAnchor === true) return false;
  if (asArray(footprint.allowedPlacementKinds).includes(request.placementKind)) return false;
  if (Array.isArray(footprint.occupiedSupportCellIds) && candidate.supportCellId) {
    return footprint.occupiedSupportCellIds.map(String).includes(String(candidate.supportCellId));
  }
  if (asArray(footprint.supportCellIds).map(String).includes(candidate.supportCellId)) return true;
  return pointInsideFootprint(candidate, footprint);
}

function reservationConflict(candidate, radius, reservation) {
  if (String(candidate.supportCellId) === String(reservation.supportCellId)) return true;
  const position = pointOf(reservation);
  if (!candidate.position || !position) return false;
  const verticalTolerance = Math.max(
    0.25,
    finiteNumber(reservation.verticalToleranceMeters, 0.75),
  );
  if (Math.abs(candidate.position.y - position.y) > verticalTolerance) return false;
  const combinedRadius = radius + Math.max(
    0,
    finiteNumber(reservation.reservationRadiusMeters ?? reservation.radiusMeters, 0),
  );
  const distanceSquared = (candidate.position.x - position.x) ** 2
    + (candidate.position.z - position.z) ** 2;
  return distanceSquared < combinedRadius ** 2 - EPSILON;
}

function candidateDistanceSquared(candidate, request) {
  const requested = request.requestedPosition;
  if (!requested || !candidate.position) return 0;
  return (candidate.position.x - requested.x) ** 2
    + (candidate.position.y - requested.y) ** 2
    + (candidate.position.z - requested.z) ** 2;
}

/**
 * Resolves all requests atomically against finalized physical records.
 */
export function resolveIndustrialSupplementAnchorPlacementRequests({
  mode,
  requests = [],
  floors = [],
  solids = [],
  hazards = [],
  zones = [],
  walkabilityRecords = [],
  walkableFloorCellIds = null,
  reservations = [],
} = {}) {
  if (!isIndustrialSupplementV4RuntimeContractMode(mode)) {
    return inactiveResult({ placements: [], diagnosticPlacements: [], reservations: [] });
  }
  const errors = [];
  const supportRecords = flattenSupportRecords(floors);
  const byId = new Map();
  const ambiguousIds = new Set();
  for (const record of supportRecords) {
    if (byId.has(record.supportCellId)) ambiguousIds.add(record.supportCellId);
    else byId.set(record.supportCellId, record);
  }
  const zoneMembership = normalizeZoneMembership(zones);
  const walkability = normalizeWalkability(walkabilityRecords, walkableFloorCellIds);
  const globalForbidden = [
    ...asArray(solids).filter((record) => record?.blocking !== false),
    ...asArray(hazards).filter((record) => (
      record?.excludesPlacement !== false && record?.active !== false
    )),
  ].map((record) => normalizeForbiddenFootprint(record, 'finalized-blocker')).filter(Boolean);
  const committedReservations = asArray(reservations).map(clonePlainValue);
  const diagnosticPlacements = [];
  for (const request of stableRecords(requests)) {
    if (!request?.id || !request?.roomId || !request?.ownerId) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.REQUEST_MALFORMED,
        { recordId: request?.id, ownerId: request?.ownerId },
      ));
      continue;
    }
    const exactId = stringOrNull(request.exactSupportCellId);
    const allowedIds = new Set(asArray(request.allowedSupportCellIds).map(String));
    const allowedZoneIds = new Set(asArray(request.allowedZoneIds).map(String));
    const poolIds = new Set(allowedIds);
    if (exactId) poolIds.add(exactId);
    if (allowedZoneIds.size > 0) {
      for (const [id, memberships] of zoneMembership) {
        if ([...memberships].some((zoneId) => allowedZoneIds.has(zoneId))) poolIds.add(id);
      }
    }
    const missingIds = [...poolIds].filter((id) => !byId.has(id));
    const pool = [...poolIds].map((id) => byId.get(id)).filter(Boolean);
    for (const id of [...poolIds].filter((candidateId) => ambiguousIds.has(candidateId))) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.SUPPORT_ID_AMBIGUOUS,
        { recordId: request.id, ownerId: request.ownerId, details: { supportCellId: id } },
      ));
    }
    if (pool.length === 0) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.SUPPORT_CELLS_MISSING,
        {
          recordId: request.id,
          ownerId: request.ownerId,
          details: { missingSupportCellIds: missingIds.sort() },
        },
      ));
      continue;
    }
    const rejectionCounts = {
      farSide: 0,
      tier: 0,
      elevation: 0,
      walkability: 0,
      forbidden: 0,
      reservation: 0,
    };
    const blockingFootprintIds = new Set();
    const blockingReservationsById = new Map();
    const unwalkableSupportDetails = [];
    const candidates = [];
    for (const candidate of pool) {
      if (request.requiresFarSide === true
        && String(candidate.roomId ?? '') !== String(request.farSideRoomId ?? '')) {
        rejectionCounts.farSide += 1;
        continue;
      }
      if (String(candidate.roomId ?? '') !== String(request.roomId)) {
        rejectionCounts.farSide += 1;
        continue;
      }
      if (request.requiredTierId
        && String(candidate.floorTierId ?? '') !== String(request.requiredTierId)) {
        rejectionCounts.tier += 1;
        continue;
      }
      if (request.requiredTierRuntimeId
        && String(candidate.floorTierRuntimeId ?? '') !== String(request.requiredTierRuntimeId)) {
        rejectionCounts.tier += 1;
        continue;
      }
      const requiredElevation = finiteNumber(request.requiredElevation);
      const tolerance = Math.max(0, finiteNumber(
        request.elevationToleranceMeters,
        DEFAULT_ELEVATION_TOLERANCE_METERS,
      ));
      if (requiredElevation != null
        && Math.abs(candidate.elevation - requiredElevation) > tolerance + EPSILON) {
        rejectionCounts.elevation += 1;
        continue;
      }
      const baseWalkable = candidate.walkable !== false
        && candidate.blocked !== true
        && candidate.reachable !== false
        && candidate.returnable !== false;
      const recordedWalkable = !walkability.byId.has(candidate.supportCellId)
        || walkability.byId.get(candidate.supportCellId) === true;
      const allowlistedWalkable = walkability.allowedSet == null
        || walkability.allowedSet.has(candidate.supportCellId);
      if (!baseWalkable || !recordedWalkable || !allowlistedWalkable) {
        unwalkableSupportDetails.push({
          supportCellId: candidate.supportCellId,
          baseWalkable,
          recordedWalkable,
          allowlistedWalkable,
          walkable: candidate.walkable,
          blocked: candidate.blocked,
          reachable: candidate.reachable,
          returnable: candidate.returnable,
          walkabilityIntent: candidate.walkabilityIntent ?? null,
          floorKey: candidate.floorKey ?? null,
          reachableFloorKeyMember: candidate.reachableFloorKeyMember ?? null,
          coveredByAuthoritativeFloorKey: candidate.coveredByAuthoritativeFloorKey ?? null,
          blockingSolidZoneIds: sortedUniqueStrings(candidate.blockingSolidZoneIds),
        });
        rejectionCounts.walkability += 1;
        continue;
      }
      const blockingFootprint = [
        ...asArray(request.forbiddenFootprints),
        ...globalForbidden,
      ].find((footprint) => candidateBlockedByFootprint(candidate, footprint, request));
      if (blockingFootprint) {
        blockingFootprintIds.add(String(blockingFootprint.id ?? '(unnamed-footprint)'));
        rejectionCounts.forbidden += 1;
        continue;
      }
      const radius = Math.max(0, finiteNumber(request.reservationRadiusMeters, 0));
      const blockingReservation = committedReservations.find((reservation) => (
        reservationConflict(candidate, radius, reservation)
      ));
      if (blockingReservation) {
        const reservationId = String(
          blockingReservation.id
            ?? blockingReservation.requestId
            ?? blockingReservation.ownerId
            ?? '(unnamed-reservation)',
        );
        blockingReservationsById.set(reservationId, {
          id: blockingReservation.id ?? null,
          requestId: blockingReservation.requestId ?? null,
          ownerId: blockingReservation.ownerId ?? null,
          supportCellId: blockingReservation.supportCellId ?? null,
          position: clonePlainValue(blockingReservation.position ?? null),
          reservationRadiusMeters: finiteNumber(
            blockingReservation.reservationRadiusMeters,
            0,
          ),
        });
        rejectionCounts.reservation += 1;
        continue;
      }
      candidates.push(candidate);
    }
    const exactIsLegal = exactId && candidates.some(({ supportCellId: id }) => id === exactId);
    const ordered = [...candidates].sort((left, right) => (
      Number(right.supportCellId === exactId) - Number(left.supportCellId === exactId)
        || candidateDistanceSquared(left, request) - candidateDistanceSquared(right, request)
        || left.supportCellId.localeCompare(right.supportCellId)
    ));
    let selected = ordered[0] ?? null;
    if (exactId && !exactIsLegal && request.reselectWithinDeclaredZoneAndTier === false) {
      selected = null;
    }
    if (!selected) {
      const total = pool.length;
      let code = INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.NO_LEGAL_SUPPORT;
      if (rejectionCounts.farSide === total) {
        code = INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.FAR_SIDE_REQUIRED;
      } else if (rejectionCounts.tier === total) {
        code = INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.TIER_MISMATCH;
      } else if (rejectionCounts.elevation === total) {
        code = INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.ELEVATION_MISMATCH;
      } else if (rejectionCounts.walkability === total) {
        code = INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.UNWALKABLE_SUPPORT;
      } else if (rejectionCounts.forbidden === total) {
        code = INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.FORBIDDEN_FOOTPRINT;
      } else if (rejectionCounts.reservation === total) {
        code = INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.RESERVATION_CONFLICT;
      }
      errors.push(makeError(code, {
        recordId: request.id,
        ownerId: request.ownerId,
        details: {
          candidateCount: total,
          rejectionCounts,
          placementKind: request.placementKind,
          roomId: request.roomId,
          blueprintId: request.blueprintId ?? null,
          grammarId: request.grammarId ?? null,
          exactSupportCellId: exactId,
          candidateSupportCellIds: pool.map(({ supportCellId }) => supportCellId).sort(),
          unwalkableSupportDetails,
          blockingFootprintIds: [...blockingFootprintIds].sort(),
          blockingReservations: [...blockingReservationsById.values()],
        },
      }));
      continue;
    }
    const membership = sortedUniqueStrings([
      ...asArray(selected.zoneIds),
      ...(zoneMembership.get(selected.supportCellId) ?? []),
    ]);
    const placement = {
      schema: INDUSTRIAL_SUPPLEMENT_ANCHOR_PLACEMENT_SCHEMA,
      id: `${request.id}:placement`,
      requestId: request.id,
      anchorId: request.anchorId,
      ownerKind: request.ownerKind,
      ownerId: request.ownerId,
      operationId: request.operationId ?? null,
      connectionId: request.connectionId ?? null,
      roomId: selected.roomId,
      placementKind: request.placementKind,
      supportFloorCellId: selected.supportCellId,
      supportKind: selected.supportKind,
      floorKey: selected.floorKey,
      floorTierId: selected.floorTierId,
      floorTierRuntimeId: selected.floorTierRuntimeId,
      elevation: selected.elevation,
      position: clonePlainValue(selected.position),
      allowedZoneIds: membership,
      selectionSource: selected.supportCellId === exactId
        ? 'exact-support-cell'
        : 'declared-zone-tier-reselection',
      requiresFarSide: request.requiresFarSide === true,
      farSideRoomId: request.farSideRoomId ?? null,
      reservationRadiusMeters: Math.max(0, finiteNumber(request.reservationRadiusMeters, 0)),
      authoritative: true,
      rendererFree: true,
    };
    diagnosticPlacements.push(placement);
    committedReservations.push({
      id: `${placement.id}:reservation`,
      requestId: request.id,
      ownerId: request.ownerId,
      supportCellId: selected.supportCellId,
      position: clonePlainValue(selected.position),
      reservationRadiusMeters: placement.reservationRadiusMeters,
    });
  }
  const stable = stableErrors(errors);
  return {
    active: true,
    accepted: stable.length === 0,
    placements: stable.length === 0 ? clonePlainValue(diagnosticPlacements) : [],
    diagnosticPlacements: clonePlainValue(diagnosticPlacements),
    reservations: stable.length === 0 ? clonePlainValue(committedReservations) : [],
    diagnosticReservations: clonePlainValue(committedReservations),
    errors: stable,
  };
}

function semanticAnchorStateKind(anchor) {
  const kind = String(anchor?.kind ?? anchor?.type ?? '');
  if (['encounter', 'enemyEncounter'].includes(kind) && anchor?.encounterRecipe) {
    return 'encounter-cleared';
  }
  if (['reward', 'discovery'].includes(kind)
    && (anchor?.rewardRecipe || anchor?.discoveryRecipe)) return 'reward-claimed';
  if (['progression', 'mechanism', 'control'].includes(kind)
    && anchor?.mechanismRecipe) return 'mechanism-activated';
  return null;
}

function stateBinding({
  runtimeStateId,
  localStateId = null,
  stateKind,
  ownerKind,
  ownerId,
  consumerKind,
  consumerId,
  sourceRuntimeStateId = null,
}) {
  return {
    schema: INDUSTRIAL_SUPPLEMENT_STATE_BINDING_SCHEMA,
    id: `${runtimeStateId}:binding`,
    runtimeStateId,
    localStateId: localStateId ?? runtimeStateId.split(':').at(-1),
    stateKind,
    owner: { kind: ownerKind, id: ownerId },
    consumer: { kind: consumerKind, id: consumerId },
    ownerKind,
    ownerId,
    consumerKind,
    consumerId,
    sourceRuntimeStateId: stringOrNull(sourceRuntimeStateId),
    persistent: true,
    namespaced: true,
    authoritative: true,
  };
}

function transferStateBindings(transfer) {
  const id = String(transfer.id ?? transfer.runtimeId ?? '');
  const kind = String(transfer.traversalKind ?? transfer.form ?? transfer.kind ?? '');
  const sourceRecords = stableRecords(transfer.stateRecords);
  const sourceStateId = (...patterns) => sourceRecords.find((record) => (
    patterns.some((pattern) => pattern.test(String(
      record?.localStateId ?? record?.stateKind ?? record?.runtimeStateId ?? '',
    )))
  ))?.runtimeStateId ?? null;
  if (!id) return [];
  if (/lift/i.test(kind)) {
    return [
      stateBinding({
        runtimeStateId: `${id}:state:lift-enabled`,
        stateKind: 'lift-enabled',
        ownerKind: 'physical-transfer',
        ownerId: id,
        consumerKind: 'lift-availability-runtime',
        consumerId: `${id}:availability-runtime`,
        sourceRuntimeStateId: sourceStateId(/enabled/i, /lift(?!.*position)/i),
      }),
      stateBinding({
        runtimeStateId: `${id}:state:lift-position`,
        stateKind: 'lift-position',
        ownerKind: 'physical-transfer',
        ownerId: id,
        consumerKind: 'lift-motion-runtime',
        consumerId: `${id}:motion-runtime`,
        sourceRuntimeStateId: sourceStateId(/position/i),
      }),
    ];
  }
  if (/ladder/i.test(kind)) {
    return [stateBinding({
      runtimeStateId: `${id}:state:ladder-deployed`,
      stateKind: 'ladder-deployed',
      ownerKind: 'physical-transfer',
      ownerId: id,
      consumerKind: 'ladder-deployment-runtime',
      consumerId: `${id}:deployment-runtime`,
      sourceRuntimeStateId: sourceStateId(/deployed/i, /ladder/i),
    })];
  }
  return [];
}

function shortcutStateBindings(plan) {
  if (!isShortcutPlan(plan)) return [];
  const planId = String(plan.id ?? '');
  if (!planId) return [];
  const mechanismId = String(plan.shortcutMechanismId ?? `${planId}:shortcut-control`);
  const result = [stateBinding({
    runtimeStateId: `${mechanismId}:state:mechanism-activated`,
    stateKind: 'mechanism-activated',
    ownerKind: 'shortcut-control',
    ownerId: mechanismId,
    consumerKind: 'shortcut-connection',
    consumerId: planId,
    sourceRuntimeStateId: plan.shortcutStateId,
  })];
  if (String(plan.shortcutMode) === 'shortcut-lift') {
    result.push(
      stateBinding({
        runtimeStateId: `${planId}:state:lift-enabled`,
        stateKind: 'lift-enabled',
        ownerKind: 'shortcut-control',
        ownerId: mechanismId,
        consumerKind: 'shortcut-lift-availability-runtime',
        consumerId: `${planId}:lift-availability-runtime`,
        sourceRuntimeStateId: plan.shortcutStateId,
      }),
      stateBinding({
        runtimeStateId: `${planId}:state:lift-position`,
        stateKind: 'lift-position',
        ownerKind: 'shortcut-lift',
        ownerId: planId,
        consumerKind: 'shortcut-lift-motion-runtime',
        consumerId: `${planId}:lift-motion-runtime`,
      }),
    );
  }
  if (String(plan.shortcutMode) === 'drop-ladder') {
    result.push(stateBinding({
      runtimeStateId: `${planId}:state:ladder-deployed`,
      stateKind: 'ladder-deployed',
      ownerKind: 'shortcut-control',
      ownerId: mechanismId,
      consumerKind: 'shortcut-ladder-runtime',
      consumerId: `${planId}:ladder-runtime`,
      sourceRuntimeStateId: plan.shortcutStateId,
    }));
  }
  return result;
}

function bindingParticipants(binding, participantKind) {
  const plural = binding?.[`${participantKind}s`];
  if (Array.isArray(plural)) return plural.filter(Boolean).map((entry) => ({
    kind: stringOrNull(entry?.kind ?? entry?.[`${participantKind}Kind`]),
    id: stringOrNull(entry?.id ?? entry?.[`${participantKind}Id`]),
  }));
  const direct = binding?.[participantKind];
  if (direct) return [{
    kind: stringOrNull(direct.kind ?? direct[`${participantKind}Kind`]),
    id: stringOrNull(direct.id ?? direct[`${participantKind}Id`]),
  }];
  const id = stringOrNull(binding?.[`${participantKind}Id`]);
  return id ? [{ kind: stringOrNull(binding?.[`${participantKind}Kind`]), id }] : [];
}

function participantRecordsByState(records) {
  const result = new Map();
  for (const record of asArray(records)) {
    const stateId = stringOrNull(record?.runtimeStateId ?? record?.stateId);
    if (!stateId) continue;
    const entries = result.get(stateId) ?? [];
    entries.push(record);
    result.set(stateId, entries);
  }
  return result;
}

function liveParticipantIdentity(record, participantKind) {
  return {
    kind: stringOrNull(
      record?.[`${participantKind}Kind`]
        ?? record?.participantKind
        ?? record?.componentKind,
    ),
    id: stringOrNull(
      record?.[`${participantKind}Id`]
        ?? record?.participantId
        ?? record?.componentId,
    ),
  };
}

/** Validates exact owner/consumer cardinality for every advertised V4 state. */
export function validateIndustrialSupplementStateBindings({
  mode,
  bindings = [],
  advertisedStateIds = null,
  liveOwners = null,
  liveConsumers = null,
  requiredStateKinds = [],
} = {}) {
  if (!isIndustrialSupplementV4RuntimeContractMode(mode)) {
    return inactiveResult({ bindings: [], advertisedStateIds: [] });
  }
  const errors = [];
  const orderedBindings = stableRecords(bindings, (binding) => binding?.runtimeStateId);
  const bindingsByStateId = new Map();
  for (const binding of orderedBindings) {
    const stateId = stringOrNull(binding?.runtimeStateId);
    if (!stateId) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_BINDING_MALFORMED,
        { recordId: binding?.id },
      ));
      continue;
    }
    const group = bindingsByStateId.get(stateId) ?? [];
    group.push(binding);
    bindingsByStateId.set(stateId, group);
    if (!RUNTIME_STATE_KIND_SET.has(String(binding.stateKind ?? ''))) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_KIND_INVALID,
        { recordId: binding.id, runtimeStateId: stateId },
      ));
    }
    const owners = bindingParticipants(binding, 'owner');
    const consumers = bindingParticipants(binding, 'consumer');
    if (owners.length !== 1 || !owners[0].id || !owners[0].kind) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_OWNER_AMBIGUOUS,
        { recordId: binding.id, runtimeStateId: stateId, details: { count: owners.length } },
      ));
    }
    if (consumers.length !== 1 || !consumers[0].id || !consumers[0].kind) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_CONSUMER_AMBIGUOUS,
        { recordId: binding.id, runtimeStateId: stateId, details: { count: consumers.length } },
      ));
    }
  }
  for (const [stateId, group] of bindingsByStateId) {
    if (group.length <= 1) continue;
    errors.push(makeError(
      INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_RUNTIME_ID_DUPLICATE,
      { runtimeStateId: stateId, details: { count: group.length } },
    ));
  }
  const advertised = advertisedStateIds == null
    ? sortedUniqueStrings([...bindingsByStateId.keys()])
    : sortedUniqueStrings(advertisedStateIds);
  const advertisedSet = new Set(advertised);
  for (const stateId of advertised) {
    if ((bindingsByStateId.get(stateId) ?? []).length === 1) continue;
    errors.push(makeError(
      INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_ID_UNBOUND,
      { runtimeStateId: stateId },
    ));
  }
  if (advertisedStateIds != null) {
    for (const stateId of bindingsByStateId.keys()) {
      if (advertisedSet.has(stateId)) continue;
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_ID_UNADVERTISED,
        { runtimeStateId: stateId },
      ));
    }
  }
  const ownerRecords = liveOwners == null ? null : participantRecordsByState(liveOwners);
  const consumerRecords = liveConsumers == null ? null : participantRecordsByState(liveConsumers);
  for (const [participantKind, recordsByState] of [
    ['owner', ownerRecords],
    ['consumer', consumerRecords],
  ]) {
    if (!recordsByState) continue;
    for (const stateId of recordsByState.keys()) {
      if (advertisedSet.has(stateId)) continue;
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_ID_UNADVERTISED,
        {
          runtimeStateId: stateId,
          details: { source: `live-${participantKind}s` },
        },
      ));
    }
  }
  for (const stateId of advertised) {
    if (ownerRecords && (ownerRecords.get(stateId) ?? []).length !== 1) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_OWNER_AMBIGUOUS,
        {
          runtimeStateId: stateId,
          details: { count: (ownerRecords.get(stateId) ?? []).length, source: 'live-owners' },
        },
      ));
    }
    if (consumerRecords && (consumerRecords.get(stateId) ?? []).length !== 1) {
      errors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_CONSUMER_AMBIGUOUS,
        {
          runtimeStateId: stateId,
          details: { count: (consumerRecords.get(stateId) ?? []).length, source: 'live-consumers' },
        },
      ));
    }
    const bindingGroup = bindingsByStateId.get(stateId) ?? [];
    const declaredBinding = bindingGroup.length === 1 ? bindingGroup[0] : null;
    if (!declaredBinding) continue;
    for (const [participantKind, recordsByState, mismatchCode] of [
      [
        'owner',
        ownerRecords,
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_OWNER_IDENTITY_MISMATCH,
      ],
      [
        'consumer',
        consumerRecords,
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_CONSUMER_IDENTITY_MISMATCH,
      ],
    ]) {
      const liveRecords = recordsByState?.get(stateId) ?? [];
      if (liveRecords.length !== 1) continue;
      const [declaredParticipant] = bindingParticipants(declaredBinding, participantKind);
      const liveParticipant = liveParticipantIdentity(liveRecords[0], participantKind);
      if (!declaredParticipant?.id || !declaredParticipant?.kind) continue;
      if (liveParticipant.id === declaredParticipant.id
        && liveParticipant.kind === declaredParticipant.kind) continue;
      errors.push(makeError(mismatchCode, {
        recordId: liveRecords[0]?.id,
        runtimeStateId: stateId,
        details: {
          source: `live-${participantKind}s`,
          expected: declaredParticipant,
          actual: liveParticipant,
        },
      }));
    }
  }
  const presentKinds = new Set(orderedBindings.map(({ stateKind }) => String(stateKind)));
  for (const stateKind of sortedUniqueStrings(requiredStateKinds)) {
    if (presentKinds.has(stateKind)) continue;
    errors.push(makeError(
      INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_REQUIRED_KIND_MISSING,
      { recordId: stateKind },
    ));
  }
  const stable = stableErrors(errors);
  return {
    active: true,
    accepted: stable.length === 0,
    bindings: clonePlainValue(orderedBindings),
    advertisedStateIds: advertised,
    errors: stable,
  };
}

/**
 * Expands renderer-free runtime component descriptors into exact live owner
 * and consumer inventories, then proves that they are a one-to-one physical
 * realization of the advertised state bindings.
 *
 * A component descriptor is intentionally explicit:
 * `{ id, kind, ownedRuntimeStateIds, consumedRuntimeStateIds }`. Generic
 * `runtimeStateIds` are not accepted because they do not identify which side
 * of the state contract the component implements.
 */
export function buildIndustrialSupplementLiveStateBindingInventory({
  mode,
  bindings = [],
  advertisedStateIds = null,
  components = [],
  requiredStateKinds = [],
} = {}) {
  if (!isIndustrialSupplementV4RuntimeContractMode(mode)) {
    return inactiveResult({
      bindings: [],
      advertisedStateIds: [],
      components: [],
      diagnosticComponents: [],
      liveOwners: [],
      diagnosticLiveOwners: [],
      liveConsumers: [],
      diagnosticLiveConsumers: [],
    });
  }

  const componentErrors = [];
  const diagnosticComponents = stableRecords(components, (component) => (
    `${component?.kind ?? ''}:${component?.id ?? ''}`
  )).map(clonePlainValue);
  const liveOwners = [];
  const liveConsumers = [];
  const componentIdentityCounts = new Map();
  const bindingKindByStateId = new Map();
  for (const binding of asArray(bindings)) {
    const stateId = stringOrNull(binding?.runtimeStateId);
    if (!stateId) continue;
    const kinds = bindingKindByStateId.get(stateId) ?? [];
    kinds.push(stringOrNull(binding?.stateKind));
    bindingKindByStateId.set(stateId, kinds);
  }

  for (const component of diagnosticComponents) {
    const componentId = stringOrNull(component?.id);
    const componentKind = stringOrNull(component?.kind);
    const ownedStateIds = asArray(component?.ownedRuntimeStateIds);
    const consumedStateIds = asArray(component?.consumedRuntimeStateIds);
    if (!componentId || !componentKind
      || (ownedStateIds.length === 0 && consumedStateIds.length === 0)) {
      componentErrors.push(makeError(
        INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_LIVE_COMPONENT_MALFORMED,
        {
          recordId: componentId,
          details: {
            componentKind,
            ownedStateCount: ownedStateIds.length,
            consumedStateCount: consumedStateIds.length,
          },
        },
      ));
      continue;
    }
    const componentIdentity = `${componentKind}\u0000${componentId}`;
    componentIdentityCounts.set(
      componentIdentity,
      (componentIdentityCounts.get(componentIdentity) ?? 0) + 1,
    );
    for (const [participantKind, stateIds, destination] of [
      ['owner', ownedStateIds, liveOwners],
      ['consumer', consumedStateIds, liveConsumers],
    ]) {
      for (const [stateIndex, rawStateId] of stateIds.entries()) {
        const runtimeStateId = stringOrNull(rawStateId);
        if (!runtimeStateId) {
          componentErrors.push(makeError(
            INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_LIVE_COMPONENT_MALFORMED,
            {
              recordId: componentId,
              details: { componentKind, participantKind, stateIndex },
            },
          ));
          continue;
        }
        const stateKinds = bindingKindByStateId.get(runtimeStateId) ?? [];
        destination.push({
          schema: INDUSTRIAL_SUPPLEMENT_LIVE_STATE_PARTICIPANT_SCHEMA,
          id: `${componentKind}:${componentId}:${participantKind}:${runtimeStateId}:${stateIndex}`,
          runtimeStateId,
          stateKind: stateKinds.length === 1 ? stateKinds[0] : null,
          participantRole: participantKind,
          participantKind: componentKind,
          participantId: componentId,
          componentKind,
          componentId,
          [`${participantKind}Kind`]: componentKind,
          [`${participantKind}Id`]: componentId,
          authoritative: true,
          rendererFree: true,
        });
      }
    }
  }
  for (const [componentIdentity, count] of componentIdentityCounts) {
    if (count <= 1) continue;
    const [componentKind, componentId] = componentIdentity.split('\u0000');
    componentErrors.push(makeError(
      INDUSTRIAL_SUPPLEMENT_RUNTIME_CONTRACT_ERROR_CODES.STATE_LIVE_COMPONENT_DUPLICATE,
      {
        recordId: componentId,
        details: { componentKind, count },
      },
    ));
  }

  const orderedOwners = stableRecords(liveOwners, (record) => record.id);
  const orderedConsumers = stableRecords(liveConsumers, (record) => record.id);
  const validation = validateIndustrialSupplementStateBindings({
    mode,
    bindings,
    advertisedStateIds,
    liveOwners: orderedOwners,
    liveConsumers: orderedConsumers,
    requiredStateKinds,
  });
  const errors = stableErrors([...componentErrors, ...validation.errors]);
  const accepted = errors.length === 0;
  return {
    active: true,
    accepted,
    bindings: clonePlainValue(validation.bindings),
    advertisedStateIds: [...validation.advertisedStateIds],
    components: accepted ? clonePlainValue(diagnosticComponents) : [],
    diagnosticComponents: clonePlainValue(diagnosticComponents),
    liveOwners: accepted ? clonePlainValue(orderedOwners) : [],
    diagnosticLiveOwners: clonePlainValue(orderedOwners),
    liveConsumers: accepted ? clonePlainValue(orderedConsumers) : [],
    diagnosticLiveConsumers: clonePlainValue(orderedConsumers),
    errors,
  };
}

/**
 * Builds per-anchor/per-transfer semantic state IDs, then validates the exact
 * binding cardinality. Existing broad operation IDs are reported as sources,
 * never reused as the new runtime identity.
 */
export function buildIndustrialSupplementStateBindings({
  mode,
  rooms = [],
  connectionPlans = [],
  additionalBindings = [],
} = {}) {
  if (!isIndustrialSupplementV4RuntimeContractMode(mode)) {
    return inactiveResult({
      bindings: [],
      advertisedStateIds: [],
      sourceStateIdRemap: {},
    });
  }
  const bindings = [];
  const sourceStateIdRemap = new Map();
  const register = (binding) => {
    bindings.push(binding);
    if (!binding.sourceRuntimeStateId) return;
    const ids = sourceStateIdRemap.get(binding.sourceRuntimeStateId) ?? [];
    ids.push(binding.runtimeStateId);
    sourceStateIdRemap.set(binding.sourceRuntimeStateId, ids);
  };
  for (const room of stableRecords(rooms)) {
    if (!room?.id || room?.isDungeonSupplement !== true) continue;
    for (const anchor of stableRecords(room.augmentationAnchors)) {
      const stateKind = semanticAnchorStateKind(anchor);
      if (!stateKind) continue;
      const anchorId = String(anchor.id);
      register(stateBinding({
        runtimeStateId: `${anchorId}:state:${stateKind}`,
        localStateId: stateKind,
        stateKind,
        ownerKind: 'supplemental-anchor',
        ownerId: anchorId,
        consumerKind: `${stateKind}-runtime`,
        consumerId: stateKind === 'encounter-cleared'
          ? String(anchor.encounterId ?? `${room.id}:encounter`)
          : anchorId,
        sourceRuntimeStateId: anchor.runtimeStateId,
      }));
    }
    const transfers = [
      ...asArray(room.augmentationTransfers),
      ...asArray(room.augmentationPhysicalRealization?.transfers),
    ];
    const uniqueTransfers = stableRecords(transfers)
      .filter((transfer, index, all) => index === all.findIndex((candidate) => (
        String(candidate?.id) === String(transfer?.id)
      )));
    for (const transfer of uniqueTransfers) {
      for (const binding of transferStateBindings(transfer)) register(binding);
    }
  }
  for (const plan of stableRecords(connectionPlans)) {
    for (const binding of shortcutStateBindings(plan)) register(binding);
  }
  for (const binding of additionalBindings) register(clonePlainValue(binding));
  const advertisedStateIds = sortedUniqueStrings(bindings.map(({ runtimeStateId }) => runtimeStateId));
  const validation = validateIndustrialSupplementStateBindings({
    mode,
    bindings,
    advertisedStateIds,
  });
  return {
    ...validation,
    bindings: validation.accepted ? validation.bindings : [],
    diagnosticBindings: validation.bindings,
    sourceStateIdRemap: Object.fromEntries([...sourceStateIdRemap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sourceId, runtimeIds]) => [sourceId, sortedUniqueStrings(runtimeIds)])),
  };
}
