import { PROGRESSION_ROOM_BANDS } from '../DungeonProgression.js';

export const INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID = 'industrial-supplement-preview-v1';
export const INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID = 'industrial-supplement-preview-v2';
export const INDUSTRIAL_EXTENSION_REGION_ID = 'industrial-v1:main-region';
export const INDUSTRIAL_THEME_REVISION = 'industrial-v1-presentation-r1';
export const INDUSTRIAL_THEME_CONTENT_HASH = 'industrial-v1-assets-2026-07-28';

const HOST_SCHEMA = 'ruindivex-dungeon-extension-host/v1';
const REGION_THEME_SCHEMA = 'ruindivex-dungeon-region-theme/v1';
const BRANCH_ROOM_IDS = Object.freeze([
  'enemyNest',
  'keycardRoom',
  'trapRoom',
  'bonusVault',
]);

const PADDED_EDGE_IDS = new Set([
  'entrance_enemyNest',
  'enemyNest_keycardRoom',
  'keycardRoom_trapRoom',
  'trapRoom_coolantRelayRoom',
  'trapRoom_conveyorRoom',
  'conveyorRoom_bonusVault',
]);

function clonePoint(point = {}) {
  return {
    x: Number(point.x ?? 0),
    z: Number(point.z ?? 0),
  };
}

function createThemeBinding() {
  return {
    schema: REGION_THEME_SCHEMA,
    parentMapId: 'industrial-v1',
    parentMapRevision: 'industrial-v1-layout-r1',
    parentRegionId: INDUSTRIAL_EXTENSION_REGION_ID,
    themeRef: {
      id: 'industrial-v1',
      revision: INDUSTRIAL_THEME_REVISION,
      contentHash: INDUSTRIAL_THEME_CONTENT_HASH,
    },
    presentationVariantId: 'inherit-parent-room-variant',
    localLightingProfileId: 'industrial-v1-local-fixtures',
    soundscapeProfileId: 'industrial-v1-ambient',
  };
}

function roomSocketCandidates(room, tileSize) {
  const halfWidth = Math.floor(Number(room.width ?? 1) / 2);
  const halfDepth = Math.floor(Number(room.depth ?? 1) / 2);
  const elevation = Number(room.plannedBaseElevation ?? room.baseElevation ?? 0);
  return [
    { side: 'east', x: room.x + halfWidth, z: room.z, facingX: 1, facingZ: 0 },
    { side: 'west', x: room.x - halfWidth, z: room.z, facingX: -1, facingZ: 0 },
    { side: 'south', x: room.x, z: room.z + halfDepth, facingX: 0, facingZ: 1 },
    { side: 'north', x: room.x, z: room.z - halfDepth, facingX: 0, facingZ: -1 },
  ].map((candidate) => {
    const id = `${INDUSTRIAL_EXTENSION_REGION_ID}:socket:${room.id}:${candidate.side}`;
    return {
      id,
      nodeId: room.id,
      roomId: room.id,
      level: 0,
      elevation,
      position: {
        x: candidate.x * tileSize,
        y: elevation,
        z: candidate.z * tileSize,
      },
      facing: {
        x: candidate.facingX,
        y: 0,
        z: candidate.facingZ,
      },
      widthMeters: tileSize * 3,
      heightMeters: 3.6,
      availableDepthMeters: tileSize * 28,
      connectorFamily: 'service-gallery',
      connectorFamilies: ['service-gallery'],
      landingWidthTiles: 3,
      clearanceHeightMeters: 3.6,
      ...candidate,
    };
  });
}

function createSpliceEdge(plan, tileSize, themeBinding) {
  const logicalEdgeId = String(
    plan.logicalConnectionId
      ?? `${plan.fromRoomId}_${plan.toRoomId}`,
  );
  const progressionTier = Math.max(
    Number(PROGRESSION_ROOM_BANDS[plan.fromRoomId] ?? 0),
    Number(PROGRESSION_ROOM_BANDS[plan.toRoomId] ?? 0),
  );
  const fromPosition = {
    x: Number(plan.fromSocket?.x ?? plan.fullPath?.[0]?.x ?? 0) * tileSize,
    y: Number(plan.fromSocket?.elevation ?? plan.elevation ?? 0),
    z: Number(plan.fromSocket?.z ?? plan.fullPath?.[0]?.z ?? 0) * tileSize,
  };
  const toPosition = {
    x: Number(plan.toSocket?.x ?? plan.fullPath?.at?.(-1)?.x ?? 0) * tileSize,
    y: Number(plan.toSocket?.elevation ?? plan.elevation ?? 0),
    z: Number(plan.toSocket?.z ?? plan.fullPath?.at?.(-1)?.z ?? 0) * tileSize,
  };
  return {
    id: `${INDUSTRIAL_EXTENSION_REGION_ID}:splice:${logicalEdgeId}`,
    edgeId: logicalEdgeId,
    logicalEdgeId,
    physicalConnectionId: plan.id,
    fromRoomId: plan.fromRoomId,
    toRoomId: plan.toRoomId,
    doorId: plan.doorId ?? null,
    gateId: plan.doorId ?? null,
    credentialRequirement: plan.doorId ?? null,
    progressionTier,
    dominanceBoundary: plan.doorId
      ? `${logicalEdgeId}:gate:${plan.doorId}`
      : `${logicalEdgeId}:ungated`,
    connectorFamily: 'service-gallery',
    level: Number(plan.level ?? 0),
    elevation: Number(plan.elevation ?? 0),
    availableLengthMeters: Math.max(tileSize * 9, (plan.fullPath?.length ?? 0) * tileSize),
    path: (plan.fullPath ?? []).map((point) => ({
      x: Number(point.x ?? 0) * tileSize,
      y: Number(plan.elevation ?? 0),
      z: Number(point.z ?? 0) * tileSize,
    })),
    fullPath: (plan.fullPath ?? []).map(clonePoint),
    from: {
      nodeId: plan.fromRoomId,
      socketId: plan.fromSocket?.id ?? `${plan.id}:from`,
      position: fromPosition,
      facing: {
        x: Number(plan.fromSocket?.facingX ?? 0),
        y: 0,
        z: Number(plan.fromSocket?.facingZ ?? 0),
      },
    },
    to: {
      nodeId: plan.toRoomId,
      socketId: plan.toSocket?.id ?? `${plan.id}:to`,
      position: toPosition,
      facing: {
        x: Number(plan.toSocket?.facingX ?? 0),
        y: 0,
        z: Number(plan.toSocket?.facingZ ?? 0),
      },
    },
    sourceThemeBinding: themeBinding,
    destinationThemeBinding: themeBinding,
    fromSocket: plan.fromSocket ? { ...plan.fromSocket } : null,
    toSocket: plan.toSocket ? { ...plan.toSocket } : null,
  };
}

/**
 * Builds Industrial V1's opt-in host description from a renderer-free base
 * draft. The returned object owns no Three.js values and grants no progression
 * authority to the supplement preview.
 */
export function createIndustrialExtensionHost({
  basePlanHash,
  baseDraft = null,
  rooms = [],
  connectionPlans = [],
  tileSize = 2.8,
} = {}) {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const themeBinding = createThemeBinding();
  const attachmentSockets = BRANCH_ROOM_IDS
    .map((roomId) => roomById.get(roomId))
    .filter(Boolean)
    .flatMap((room) => roomSocketCandidates(room, tileSize));
  const spliceEdges = connectionPlans
    .filter((plan) => Number(plan.level ?? 0) === 0)
    // Padding is initially limited to a flat service gallery with no authored
    // parallel upper route. This prevents an untouched alternate from becoming
    // a physical bypass around the padded edge.
    .filter((plan) => !plan.connectorVariant
      || plan.connectorVariant.traversalKind === 'walk')
    .filter((plan) => PADDED_EDGE_IDS.has(String(
      plan.logicalConnectionId ?? `${plan.fromRoomId}_${plan.toRoomId}`,
    )))
    .map((plan) => createSpliceEdge(plan, tileSize, themeBinding));

  return {
    schema: HOST_SCHEMA,
    basePlanHash: String(basePlanHash ?? baseDraft?.basePlanHash ?? ''),
    extensionRegions: [{
      id: INDUSTRIAL_EXTENSION_REGION_ID,
      themeBinding,
      attachmentSockets,
      spliceEdges,
      allowedProfileIds: [
        INDUSTRIAL_SUPPLEMENT_PREVIEW_PROFILE_ID,
        INDUSTRIAL_SUPPLEMENT_PREVIEW_V2_PROFILE_ID,
      ],
      delegatedProgressionBeats: [],
      themeCapabilities: {
        materials: [
          'primaryFloor', 'corridorFloor', 'wall', 'ceiling', 'ramp', 'catwalk',
          'support', 'rail', 'door', 'lockedDoor', 'cap', 'terminal', 'warning',
          'emissiveAccent',
          // Canonical grammar spellings remain renderer-neutral; the adapter
          // maps them onto the parent session's camel-case role identifiers.
          'primary-floor', 'corridor-floor', 'locked-door', 'emissive-accent',
        ],
        assets: [
          'support', 'arch', 'frame', 'prop', 'decal', 'control',
          'lightFixture', 'light-fixture', 'hazard', 'cap',
          'transitionFrame', 'transition-frame',
        ],
        connectors: [
          'service-gallery', 'slope', 'ladder', 'lift', 'track-trap',
          'transitionBay', 'transition-bay',
        ],
        transitions: ['levelTransitionBay', 'level-transition-bay'],
      },
    }],
  };
}

export function createIndustrialRegionThemeBinding() {
  return createThemeBinding();
}
