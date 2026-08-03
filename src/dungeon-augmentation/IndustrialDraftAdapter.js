import {
  cloneDungeonAugmentationValue,
  deepFreezeDungeonAugmentationValue,
  hashCanonicalValue,
} from './canonical.js';
import { createIndustrialExtensionHost } from './IndustrialExtensionHost.js';

const BASE_DRAFT_SCHEMA = 'ruindivex-industrial-v1-extension-draft/v1';
const DEFAULT_ROOM_HEIGHT_METERS = 5.6;
// Older connector plans do not describe their vertical reservation, so their
// footprints remain unavailable at every elevation. Connector-family plans
// carry exact renderer-authored vertical intervals and can safely coexist with
// genuinely separated stacked geometry. This stays an adapter constraint so
// the generic planner does not need Industrial-specific fallback behavior.
const INDUSTRIAL_PROJECTED_COLUMN_HEIGHT_METERS = 2048;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cloneSocket(socket = null, tileSize = 2.8) {
  if (!socket) return null;
  return {
    id: socket.id ?? null,
    roomId: socket.roomId ?? null,
    role: socket.role ?? null,
    level: finiteNumber(socket.level),
    elevation: finiteNumber(socket.elevation),
    x: finiteNumber(socket.x),
    z: finiteNumber(socket.z),
    position: {
      x: finiteNumber(socket.x) * tileSize,
      y: finiteNumber(socket.elevation),
      z: finiteNumber(socket.z) * tileSize,
    },
    facingX: finiteNumber(socket.facingX),
    facingZ: finiteNumber(socket.facingZ),
    matchingSocketId: socket.matchingSocketId ?? null,
  };
}

function createRoomRecord(room, tileSize) {
  const widthTiles = Math.max(1, finiteNumber(room.width, 1));
  const depthTiles = Math.max(1, finiteNumber(room.depth, 1));
  const floorY = finiteNumber(room.baseElevation ?? room.plannedBaseElevation);
  const height = Math.max(
    DEFAULT_ROOM_HEIGHT_METERS,
    finiteNumber(room.ceilingHeight, DEFAULT_ROOM_HEIGHT_METERS),
  );
  const occupiedVolume = {
    id: `base:room:${room.id}:occupied`,
    ownerId: room.id,
    center: {
      x: finiteNumber(room.x) * tileSize,
      y: floorY + height * 0.5,
      z: finiteNumber(room.z) * tileSize,
    },
    size: {
      x: widthTiles * tileSize,
      y: height,
      z: depthTiles * tileSize,
    },
  };
  const dropBounds = room?.dropSpace?.lowerBounds;
  const dropMinimumX = Number(dropBounds?.minX);
  const dropMaximumX = Number(dropBounds?.maxX);
  const dropMinimumZ = Number(dropBounds?.minZ);
  const dropMaximumZ = Number(dropBounds?.maxZ);
  const hasDropBounds = [
    dropMinimumX,
    dropMaximumX,
    dropMinimumZ,
    dropMaximumZ,
  ].every(Number.isFinite)
    && dropMaximumX >= dropMinimumX
    && dropMaximumZ >= dropMinimumZ;
  const declaredLowerY = floorY + finiteNumber(room?.dropSpace?.lowerElevation);
  const resolvedLowerY = room.minY != null && Number.isFinite(Number(room.minY))
    ? Math.min(declaredLowerY, Number(room.minY))
    : declaredLowerY;
  const resolvedUpperY = room.maxY != null && Number.isFinite(Number(room.maxY))
    ? Number(room.maxY)
    : room.ceilingY != null && Number.isFinite(Number(room.ceilingY))
      ? Number(room.ceilingY)
      : floorY + height;
  const dropSpaceOccupiedVolume = hasDropBounds && resolvedUpperY > resolvedLowerY
    ? {
        id: `base:room:${room.id}:drop-space-occupied`,
        ownerId: room.id,
        center: {
          x: (dropMinimumX + dropMaximumX) * tileSize * 0.5,
          y: (resolvedLowerY + resolvedUpperY) * 0.5,
          z: (dropMinimumZ + dropMaximumZ) * tileSize * 0.5,
        },
        size: {
          x: (dropMaximumX - dropMinimumX + 1) * tileSize,
          y: resolvedUpperY - resolvedLowerY,
          z: (dropMaximumZ - dropMinimumZ + 1) * tileSize,
        },
        purpose: 'industrial-authored-drop-space-occupied',
      }
    : null;
  return {
    id: String(room.id ?? ''),
    type: String(room.type ?? 'room'),
    archetypeId: room.archetypeId ?? null,
    progressionBand: finiteNumber(room.progressionBand),
    position: {
      x: finiteNumber(room.x) * tileSize,
      y: floorY,
      z: finiteNumber(room.z) * tileSize,
    },
    gridPosition: {
      x: finiteNumber(room.x),
      z: finiteNumber(room.z),
    },
    widthTiles,
    depthTiles,
    widthMeters: widthTiles * tileSize,
    depthMeters: depthTiles * tileSize,
    occupiedVolume,
    occupiedVolumes: [occupiedVolume, dropSpaceOccupiedVolume].filter(Boolean),
    sockets: (room.exitSockets ?? []).map((socket) => cloneSocket(socket, tileSize)),
  };
}

function createConnectionRecord(plan, tileSize) {
  return {
    id: String(plan.id ?? ''),
    logicalConnectionId: String(
      plan.logicalConnectionId ?? `${plan.fromRoomId}_${plan.toRoomId}`,
    ),
    fromRoomId: plan.fromRoomId ?? null,
    toRoomId: plan.toRoomId ?? null,
    doorId: plan.doorId ?? null,
    gateId: plan.doorId ?? null,
    credentialRequirement: plan.doorId ?? null,
    progressionTier: Math.max(
      finiteNumber(plan.fromProgressionTier),
      finiteNumber(plan.toProgressionTier),
    ),
    dominanceBoundary: plan.doorId
      ? `${plan.logicalConnectionId ?? plan.id}:gate:${plan.doorId}`
      : `${plan.logicalConnectionId ?? plan.id}:ungated`,
    level: finiteNumber(plan.level),
    elevation: finiteNumber(plan.elevation),
    connectorFamily: plan.connectorVariantId ?? 'service-gallery',
    connectorVariantId: plan.connectorVariantId ?? null,
    path: (plan.fullPath ?? []).map((point) => ({
      x: finiteNumber(point.x) * tileSize,
      y: finiteNumber(plan.elevation),
      z: finiteNumber(point.z) * tileSize,
    })),
    gridPath: (plan.fullPath ?? []).map((point) => ({
      x: finiteNumber(point.x),
      z: finiteNumber(point.z),
    })),
    fromSocket: cloneSocket(plan.fromSocket, tileSize),
    toSocket: cloneSocket(plan.toSocket, tileSize),
  };
}

function createConnectionVolumeRecords(plan, tileSize) {
  const logicalConnectionId = String(
    plan.logicalConnectionId ?? `${plan.fromRoomId}_${plan.toRoomId}`,
  );
  const elevation = finiteNumber(plan.elevation);
  const path = (plan.fullPath ?? []).map((point) => ({
    x: finiteNumber(point.x),
    z: finiteNumber(point.z),
  }));
  const uniquePath = [...new Map(path.map((point) => [
    `${point.x},${point.z}`,
    point,
  ])).values()];
  const createVolume = (point, index, purpose, width, height) => ({
    id: `base:connection:${plan.id}:${purpose}:${index}`,
    ownerId: logicalConnectionId,
    physicalConnectionId: String(plan.id ?? logicalConnectionId),
    logicalConnectionId,
    center: {
      x: point.x * tileSize,
      y: elevation + height * 0.5,
      z: point.z * tileSize,
    },
    size: { x: width, y: height, z: width },
    purpose,
  });
  const occupiedVolumes = uniquePath.map((point, index) => createVolume(
    point,
    index,
    'base-connection-occupied',
    tileSize * 0.94,
    3.6,
  ));
  const clearanceVolumes = uniquePath.map((point, index) => createVolume(
    point,
    index,
    'base-connection-camera-clearance',
    tileSize * 1.18,
    4.4,
  ));
  const landingIndices = [...new Set([0, Math.max(0, uniquePath.length - 1)])];
  const landingVolumes = landingIndices
    .map((index) => uniquePath[index] && createVolume(
      uniquePath[index],
      index,
      'base-connection-landing-clearance',
      tileSize * 1.5,
      4.4,
    ))
    .filter(Boolean);
  return { occupiedVolumes, clearanceVolumes, landingVolumes };
}

function createProjectedConnectionVolumes(plan, volumeRecord, tileSize) {
  const logicalConnectionId = String(
    plan.logicalConnectionId ?? `${plan.fromRoomId}_${plan.toRoomId}`,
  );
  const physicalConnectionId = String(plan.id ?? logicalConnectionId);
  const familyColumns = Array.isArray(plan.familyReservedFootprintColumns)
    ? plan.familyReservedFootprintColumns
    : [];
  const hasCompleteFamilyCoordinates = familyColumns.length > 0
    && familyColumns.every((point) => (
      Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.z))
    ));

  if (hasCompleteFamilyCoordinates) {
    const uniqueColumns = [...new Map(familyColumns.map((point) => {
      const x = Number(point.x);
      const z = Number(point.z);
      const minY = Number(point?.minY);
      const maxY = Number(point?.maxY);
      const hasExactVerticalExtent = Number.isFinite(minY)
        && Number.isFinite(maxY)
        && maxY > minY;
      const verticalExtent = hasExactVerticalExtent ? { minY, maxY } : null;
      const key = verticalExtent
        ? `${x},${z}@${minY}:${maxY}`
        : `${x},${z}@fail-closed`;
      return [key, { x, z, verticalExtent }];
    })).values()];

    return uniqueColumns.map(({ x, z, verticalExtent }, index) => ({
      id: `base:connection:${plan.id}:family-reserved:${index}:industrial-projected-column`,
      ownerId: logicalConnectionId,
      physicalConnectionId,
      logicalConnectionId,
      center: {
        x: x * tileSize,
        y: verticalExtent
          ? (verticalExtent.minY + verticalExtent.maxY) * 0.5
          : 0,
        z: z * tileSize,
      },
      size: {
        x: tileSize * 1.18,
        y: verticalExtent
          ? verticalExtent.maxY - verticalExtent.minY
          : INDUSTRIAL_PROJECTED_COLUMN_HEIGHT_METERS,
        z: tileSize * 1.18,
      },
      purpose: 'industrial-single-owner-xz-connector-column',
      protectedReason: verticalExtent
        ? 'industrial-renderer-connector-reserved-vertical-interval'
        : 'industrial-renderer-connector-missing-vertical-extents',
    }));
  }

  // Missing or unusable family metadata preserves the legacy fail-closed
  // centerline projection. This also handles malformed family coordinates,
  // rather than silently dropping protection for the authored connector.
  return volumeRecord.clearanceVolumes.map((volume) => ({
    ...cloneDungeonAugmentationValue(volume),
    id: `${volume.id}:industrial-projected-column`,
    center: {
      ...cloneDungeonAugmentationValue(volume.center),
      y: 0,
    },
    size: {
      ...cloneDungeonAugmentationValue(volume.size),
      y: INDUSTRIAL_PROJECTED_COLUMN_HEIGHT_METERS,
    },
    purpose: 'industrial-single-owner-xz-connector-column',
    protectedReason: 'industrial-renderer-does-not-support-stacked-room-columns',
  }));
}

/**
 * Captures only renderer-free Industrial planning data. This snapshot is never
 * handed back to the legacy generator for mutation; the overlay is applied to
 * separate effective arrays after core validation succeeds.
 */
export function createIndustrialBaseDraft({
  rooms = [],
  connectionPlans = [],
  basePlanHash = null,
  tileSize = 2.8,
  difficulty = 1,
} = {}) {
  const roomRecords = rooms.map((room) => createRoomRecord(room, tileSize));
  const connectionRecords = connectionPlans.map((plan) => createConnectionRecord(plan, tileSize));
  const connectionVolumeRecords = connectionPlans.map((plan) => (
    createConnectionVolumeRecords(plan, tileSize)
  ));
  const fingerprintSource = {
    rooms: roomRecords,
    connectionPlans: connectionRecords,
    tileSize,
    difficulty,
  };
  const resolvedBasePlanHash = basePlanHash || hashCanonicalValue(
    fingerprintSource,
    { namespace: 'ruindivex-industrial-v1-base-plan/v1' },
  );
  const protectedVolumes = roomRecords
    .filter((room) => room.id === 'bossRoom')
    .map((room) => ({
      ...cloneDungeonAugmentationValue(room.occupiedVolume),
      id: `base:protected:${room.id}`,
      protectedReason: 'boss-arena-ineligible',
    }));
  const projectedConnectionVolumes = connectionPlans.flatMap((plan, index) => (
    createProjectedConnectionVolumes(plan, connectionVolumeRecords[index], tileSize)
  ));
  return deepFreezeDungeonAugmentationValue({
    schema: BASE_DRAFT_SCHEMA,
    basePlanHash: resolvedBasePlanHash,
    planHash: resolvedBasePlanHash,
    tileSize,
    difficulty: Math.max(1, Math.trunc(finiteNumber(difficulty, 1))),
    rooms: roomRecords,
    connectionPlans: connectionRecords,
    // Multi-tier authored rooms can contribute narrower occupied sub-volumes
    // in addition to their ordinary baseElevation..ceiling body. Keep every
    // deterministic record in the canonical collision input rather than
    // silently projecting only the singular legacy room volume.
    occupiedVolumes: roomRecords.flatMap((room) => room.occupiedVolumes),
    connectionOccupiedVolumes: connectionVolumeRecords
      .flatMap((record) => record.occupiedVolumes),
    connectionClearanceVolumes: connectionVolumeRecords
      .flatMap((record) => record.clearanceVolumes),
    connectionLandingVolumes: connectionVolumeRecords
      .flatMap((record) => record.landingVolumes),
    protectedVolumes: [...protectedVolumes, ...projectedConnectionVolumes],
  });
}

export function createIndustrialAugmentationHost({
  baseDraft,
  rooms = [],
  connectionPlans = [],
  tileSize = 2.8,
  profileId = null,
} = {}) {
  return createIndustrialExtensionHost({
    basePlanHash: baseDraft?.basePlanHash,
    baseDraft,
    rooms,
    connectionPlans,
    tileSize,
    profileId,
  });
}
