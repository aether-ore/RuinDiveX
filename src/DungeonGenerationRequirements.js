export const INDUSTRIAL_DUNGEON_GENERATION_CONTRACT_ID = 'ruindivex-dungeon-generation/v1';
export const MAGMA_DUNGEON_GENERATION_CONTRACT_ID = 'ruindivex-dungeon-generation/v2';
export const DUNGEON_GENERATION_CONTRACT_ID = MAGMA_DUNGEON_GENERATION_CONTRACT_ID;

export const DUNGEON_GENERATION_REQUIREMENTS = Object.freeze({
  tileSizeMeters: 2.8,
  socketBayMeters: 2.8,
  minimumEnclosedRoomWidthTiles: 9,
  minimumPrimaryRoomWidthTiles: 13,
  minimumConnectorWidthTiles: 3,
  minimumConnectorClearWidthMeters: 8.4,
  minimumConnectorPathTiles: 9,
  minimumConnectorStraightRunTiles: 7,
  minimumSlopeStraightRunTiles: 13,
  minimumLiftStraightRunTiles: 10,
  endpointFlatBufferTiles: 2,
  minimumLandingWidthMeters: 8.4,
  minimumLandingDepthMeters: 8.4,
  minimumDoorHeightMeters: 4.8,
  minimumPlayerHeadroomMeters: 3.6,
  minimumRoomSeparationTiles: 7,
  elevationTransferMeters: 14,
  minimumElevationConnectorCount: 3,
  maximumElevationConnectorCount: 5,
  maximumDungeonVerticalSpanMeters: 56,
  maximumElevationTransfersPerRootPath: 4,
  requiredElevationConnectorKinds: Object.freeze(['slope', 'ladder', 'automatic_lift']),
  requiredElevationDirections: Object.freeze(['ascending', 'descending']),
  slopeFlightCount: 2,
  slopeSegmentsPerFlight: 13,
  slopeRisePerFlightMeters: 7,
  liftPlatformWidthMeters: 8.4,
  liftPlatformDepthMeters: 8.4,
  liftShaftWidthMeters: 11.2,
  liftShaftDepthMeters: 11.2,
  liftSpeedMetersPerSecond: 1.8,
  liftDwellSeconds: 1.25,
  roomDimensionsMustBeOdd: true,
});

export function validateDungeonGenerationSpatialContract(dungeon, {
  primaryRoomPredicate = (room) => !['hub', 'camp', 'entrance'].includes(room.type),
  contractId = MAGMA_DUNGEON_GENERATION_CONTRACT_ID,
  requireSignedElevationComposition = true,
} = {}) {
  const errors = [];
  const warnings = [];
  const rooms = dungeon?.rooms ?? [];
  const floorTiles = dungeon?.floorTiles ?? [];
  const roomIds = new Set();
  const floorRoomIds = new Set(floorTiles.map((tile) => tile.roomId).filter(Boolean));
  const connectionPlans = dungeon?.connectionPlans ?? [];

  if (dungeon?.tileSize !== DUNGEON_GENERATION_REQUIREMENTS.tileSizeMeters) {
    errors.push(`tile-size:${dungeon?.tileSize}`);
  }
  for (const room of rooms) {
    if (!room?.id || roomIds.has(room.id)) errors.push(`duplicate-or-missing-room:${room?.id ?? 'unknown'}`);
    roomIds.add(room?.id);
    const minimumRoomWidth = ['hub', 'camp'].includes(room?.type)
      ? 7
      : DUNGEON_GENERATION_REQUIREMENTS.minimumEnclosedRoomWidthTiles;
    for (const [axis, value] of [['width', room?.width], ['depth', room?.depth]]) {
      if (!Number.isInteger(value) || value < minimumRoomWidth) {
        errors.push(`${room?.id}:${axis}-below-minimum:${value}`);
      }
      if (DUNGEON_GENERATION_REQUIREMENTS.roomDimensionsMustBeOdd && value % 2 === 0) {
        errors.push(`${room?.id}:${axis}-must-be-odd:${value}`);
      }
      if (primaryRoomPredicate(room) && value < DUNGEON_GENERATION_REQUIREMENTS.minimumPrimaryRoomWidthTiles) {
        errors.push(`${room?.id}:${axis}-below-primary-minimum:${value}`);
      }
    }
    if (!floorRoomIds.has(room.id)) errors.push(`${room.id}:missing-room-floor`);
    if ((room.ceilingHeight ?? 0) < DUNGEON_GENERATION_REQUIREMENTS.minimumPlayerHeadroomMeters) {
      warnings.push(`${room.id}:ceiling-height-not-declared`);
    }
  }

  const connectionIds = new Set((dungeon?.progression?.roomConnections ?? []).map(({ id }) => id));
  const flooredConnectionIds = new Set(floorTiles.map((tile) => tile.connectionId).filter(Boolean));
  for (const connectionId of connectionIds) {
    if (!flooredConnectionIds.has(connectionId)) errors.push(`${connectionId}:missing-connector-floor`);
  }

  const signedPlans = connectionPlans.filter((plan) => (
    Math.abs(Number(plan?.elevationDelta ?? 0)) > 0.001
  ));
  if (connectionPlans.length && requireSignedElevationComposition) {
    if (signedPlans.length < DUNGEON_GENERATION_REQUIREMENTS.minimumElevationConnectorCount
      || signedPlans.length > DUNGEON_GENERATION_REQUIREMENTS.maximumElevationConnectorCount) {
      errors.push(`signed-connector-count:${signedPlans.length}`);
    }
    const kinds = new Set(signedPlans.map((plan) => plan.connectorVariant?.traversalKind));
    for (const requiredKind of DUNGEON_GENERATION_REQUIREMENTS.requiredElevationConnectorKinds) {
      if (!kinds.has(requiredKind)) errors.push(`missing-signed-connector-kind:${requiredKind}`);
    }
    const directions = new Set(signedPlans.map((plan) => plan.direction));
    for (const requiredDirection of DUNGEON_GENERATION_REQUIREMENTS.requiredElevationDirections) {
      if (!directions.has(requiredDirection)) errors.push(`missing-signed-connector-direction:${requiredDirection}`);
    }
    for (const plan of signedPlans) {
      if (Math.abs(Math.abs(Number(plan.elevationDelta))
        - DUNGEON_GENERATION_REQUIREMENTS.elevationTransferMeters) > 0.001) {
        errors.push(`${plan.id}:invalid-elevation-transfer:${plan.elevationDelta}`);
      }
    }
    const roomElevations = rooms.map((room) => Number(room.baseElevation ?? 0));
    const verticalSpan = Math.max(...roomElevations) - Math.min(...roomElevations);
    if (verticalSpan > DUNGEON_GENERATION_REQUIREMENTS.maximumDungeonVerticalSpanMeters + 0.001) {
      errors.push(`vertical-span:${verticalSpan}`);
    }
  }

  return Object.freeze({
    contractId,
    accepted: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    roomCount: rooms.length,
    floorTileCount: floorTiles.length,
    signedConnectorCount: signedPlans.length,
  });
}
